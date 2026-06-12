'use strict';

const crypto = require('crypto');
const { getPlatformPrisma, getTenantPrisma } = require('../config/database');
const env = require('../config/env');

const DEMO_TENANT_SCHEMA = 'tenant_demo';
const SESSION_DAYS = 30;
const GUEST_DAYS = 1;
let platformReadyPromise;

async function ensurePlatformReady() {
  if (!platformReadyPromise) {
    platformReadyPromise = (async () => {
      const prisma = getPlatformPrisma();
      await executeSqlBatch(prisma, platformTablesSql());
      await ensurePublicLegacyColumns(prisma);
      const demo = await ensureDemoRestaurant();
      await ensureTenantSchema(demo.tenantSchema);
      await copyPublicDataToTenant(demo.tenantSchema);
    })().catch((err) => {
      platformReadyPromise = null;
      throw err;
    });
  }
  return platformReadyPromise;
}

async function ensurePublicLegacyColumns(prisma = getPlatformPrisma()) {
  await executeSqlBatch(prisma, `
    ALTER TABLE IF EXISTS "ordenes" ADD COLUMN IF NOT EXISTS "comensales" INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS "personas" ADD COLUMN IF NOT EXISTS "activo" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE IF EXISTS "cobros" ADD COLUMN IF NOT EXISTS "propina" DECIMAL(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS "cobros" ADD COLUMN IF NOT EXISTS "procesador" TEXT;
    ALTER TABLE IF EXISTS "cobros" ADD COLUMN IF NOT EXISTS "detalle" TEXT;
    ALTER TABLE IF EXISTS "webhook_logs" ADD COLUMN IF NOT EXISTS "error" TEXT;
  `);
}

async function ensureDemoRestaurant() {
  const prisma = getPlatformPrisma();
  const existing = await prisma.platformRestaurant.findUnique({
    where: { tenantSchema: DEMO_TENANT_SCHEMA },
  });
  if (existing) return existing;

  return prisma.platformRestaurant.create({
    data: {
      tenantSchema: DEMO_TENANT_SCHEMA,
      slug: 'demo-restaurant',
      name: 'Demo Restaurant',
      legalName: env.RESTAURANT_RAZON_SOCIAL,
      ruc: env.RESTAURANT_RUC,
      address: env.RESTAURANT_DIRECCION,
      city: 'Guayaquil',
      phone: '+593 2 222-3344',
      email: 'ventas@demo-restaurante.ec',
      serviceChargeEnabled: true,
      serviceChargeRate: 0.10,
      setupCompleted: true,
    },
  });
}

async function registerRestaurant(body) {
  await ensurePlatformReady();

  const ownerName = clean(body.owner_name || body.ownerName);
  const email = clean(body.email || body.owner_email || body.ownerEmail).toLowerCase();
  const password = String(body.password || '');
  const name = clean(body.restaurant_name || body.name);

  if (!ownerName || !email || !password || !name) {
    badRequest('Se requieren nombre del dueno, email, password y restaurante.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    badRequest('Email invalido.');
  }
  if (password.length < 8) {
    badRequest('La contrasena debe tener al menos 8 caracteres.');
  }

  const prisma = getPlatformPrisma();
  const existing = await prisma.platformUser.findUnique({ where: { email } });
  if (existing) conflict('Ese email ya tiene una cuenta. Usa iniciar sesion.');

  const slugBase = slugify(name);
  const slug = await uniqueRestaurantSlug(slugBase);
  const tenantSchema = uniqueTenantSchema(slug);
  await ensureTenantSchema(tenantSchema);

  const passwordHash = hashPassword(password);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.platformUser.create({
      data: { name: ownerName, email, passwordHash },
    });
    const restaurant = await tx.platformRestaurant.create({
      data: {
        tenantSchema,
        slug,
        name,
        legalName: clean(body.legal_name || body.legalName) || null,
        ruc: clean(body.ruc) || null,
        address: clean(body.address || body.direccion) || null,
        city: clean(body.city || body.ciudad) || null,
        phone: clean(body.phone || body.telefono) || null,
        email: clean(body.restaurant_email || body.restaurantEmail || email) || null,
        serviceChargeEnabled: body.service_charge_enabled !== undefined
          ? Boolean(body.service_charge_enabled)
          : true,
        serviceChargeRate: 0.10,
        setupCompleted: false,
      },
    });
    await tx.platformMembership.create({
      data: { userId: user.id, restaurantId: restaurant.id, role: 'owner' },
    });
    return { user, restaurant };
  });

  const token = await createSession(result.user.id, result.restaurant.id);
  return formatAuthResponse(result.user, result.restaurant, 'owner', token);
}

async function login(body) {
  await ensurePlatformReady();

  const email = clean(body.email).toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) badRequest('Se requieren email y contrasena.');

  const prisma = getPlatformPrisma();
  const user = await prisma.platformUser.findUnique({
    where: { email },
    include: {
      memberships: {
        include: { restaurant: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    unauthorized('Email o contrasena incorrectos.');
  }
  const membership = user.memberships[0];
  if (!membership) unauthorized('La cuenta no tiene restaurante asignado.');

  const token = await createSession(user.id, membership.restaurantId);
  return formatAuthResponse(user, membership.restaurant, membership.role, token);
}

async function guestLogin() {
  await ensurePlatformReady();

  const prisma = getPlatformPrisma();
  const restaurant = await ensureDemoRestaurant();
  const suffix = crypto.randomBytes(5).toString('hex');
  const email = `guest-${suffix}@demo.mesita.local`;
  const passwordHash = hashPassword(crypto.randomBytes(16).toString('hex'));

  const user = await prisma.platformUser.create({
    data: {
      name: 'Invitado',
      email,
      passwordHash,
      memberships: {
        create: {
          restaurantId: restaurant.id,
          role: 'owner',
        },
      },
    },
  });

  const token = await createSession(user.id, restaurant.id, GUEST_DAYS);
  return formatAuthResponse(user, restaurant, 'owner', token);
}

async function logout(token) {
  if (!token) return { ok: true };
  const prisma = getPlatformPrisma();
  await prisma.platformSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { ok: true };
}

async function authenticateSession(token) {
  await ensurePlatformReady();
  if (!token) unauthorized('Missing bearer token.');
  const prisma = getPlatformPrisma();
  const session = await prisma.platformSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: true,
      restaurant: true,
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    unauthorized('Sesion expirada. Inicia sesion nuevamente.');
  }
  if (!session.user.isActive) unauthorized('Usuario inactivo.');

  const membership = await prisma.platformMembership.findUnique({
    where: {
      userId_restaurantId: {
        userId: session.userId,
        restaurantId: session.restaurantId,
      },
    },
  });
  if (!membership) unauthorized('No tienes acceso a este restaurante.');

  return {
    user: publicUser(session.user),
    restaurant: publicRestaurant(session.restaurant),
    role: membership.role,
    tenantSchema: session.restaurant.tenantSchema,
  };
}

async function getDemoAuthContext() {
  await ensurePlatformReady();
  const restaurant = await ensureDemoRestaurant();
  return {
    user: null,
    restaurant: publicRestaurant(restaurant),
    role: 'owner',
    tenantSchema: restaurant.tenantSchema,
    legacyApiKey: true,
  };
}

async function completeSetup(restaurantId, body) {
  const prisma = getPlatformPrisma();
  const restaurant = await prisma.platformRestaurant.findUniqueOrThrow({
    where: { id: restaurantId },
  });
  await ensureTenantSchema(restaurant.tenantSchema);

  const tenant = getTenantPrisma(restaurant.tenantSchema);
  const seedMenu = body.seed_menu !== undefined ? Boolean(body.seed_menu) : true;
  const requestedAreas = Array.isArray(body.areas)
    ? body.areas
      .map((area) => ({
        name: clean(area.name || area.nombre || area.ubicacion),
        count: clampInt(area.count || area.mesas || area.mesa_count || 1, 1, 40),
      }))
      .filter((area) => area.name)
    : [];

  if (requestedAreas.length) {
    let mesaIndex = 1;
    for (const area of requestedAreas) {
      for (let i = 1; i <= area.count && mesaIndex <= 80; i += 1) {
        const id = `mesa-${String(mesaIndex).padStart(2, '0')}`;
        await tenant.mesa.upsert({
          where: { id },
          create: {
            id,
            nombre: `Mesa ${i}`,
            capacidad: 4,
            ubicacion: area.name,
            estado: 'L',
            activa: true,
          },
          update: {},
        });
        mesaIndex += 1;
      }
    }
  } else {
    const mesaCount = clampInt(body.mesa_count ?? body.mesaCount ?? 10, 1, 80);
    for (let i = 1; i <= mesaCount; i += 1) {
      await tenant.mesa.upsert({
        where: { id: `mesa-${String(i).padStart(2, '0')}` },
        create: {
          id: `mesa-${String(i).padStart(2, '0')}`,
          nombre: `Mesa ${i}`,
          capacidad: 4,
          ubicacion: i <= 6 ? 'Salon' : 'Terraza',
          estado: 'L',
          activa: true,
        },
        update: {},
      });
    }
  }

  if (seedMenu) await seedStarterMenu(tenant);

  const updated = await prisma.platformRestaurant.update({
    where: { id: restaurant.id },
    data: { setupCompleted: true },
  });
  return publicRestaurant(updated);
}

async function getSettings(restaurantId) {
  const prisma = getPlatformPrisma();
  const restaurant = await prisma.platformRestaurant.findUniqueOrThrow({
    where: { id: restaurantId },
  });
  return publicRestaurant(restaurant);
}

async function updateSettings(restaurantId, body) {
  const prisma = getPlatformPrisma();
  const data = {};
  if (body.name !== undefined || body.restaurant_name !== undefined) data.name = clean(body.name || body.restaurant_name);
  if (body.legal_name !== undefined || body.legalName !== undefined) data.legalName = clean(body.legal_name || body.legalName) || null;
  if (body.ruc !== undefined) data.ruc = clean(body.ruc) || null;
  if (body.address !== undefined || body.direccion !== undefined) data.address = clean(body.address || body.direccion) || null;
  if (body.city !== undefined || body.ciudad !== undefined) data.city = clean(body.city || body.ciudad) || null;
  if (body.phone !== undefined || body.telefono !== undefined) data.phone = clean(body.phone || body.telefono) || null;
  if (body.email !== undefined) data.email = clean(body.email) || null;
  if (body.service_charge_enabled !== undefined || body.serviceChargeEnabled !== undefined) {
    data.serviceChargeEnabled = Boolean(body.service_charge_enabled ?? body.serviceChargeEnabled);
  }
  if (body.service_charge_rate !== undefined || body.serviceChargeRate !== undefined) {
    const rate = Number(body.service_charge_rate ?? body.serviceChargeRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.3) badRequest('service_charge_rate debe estar entre 0 y 0.30.');
    data.serviceChargeRate = rate;
  }

  const updated = await prisma.platformRestaurant.update({
    where: { id: restaurantId },
    data,
  });
  return publicRestaurant(updated);
}

async function createSession(userId, restaurantId, days = SESSION_DAYS) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await getPlatformPrisma().platformSession.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      restaurantId,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

async function seedStarterMenu(prisma) {
  const categories = [
    ['cat-entradas', 'Entradas', 1],
    ['cat-platos', 'Platos Fuertes', 2],
    ['cat-bebidas', 'Bebidas', 3],
    ['cat-postres', 'Postres', 4],
  ];
  for (const [id, nombre, orden] of categories) {
    await prisma.categoria.upsert({ where: { id }, create: { id, nombre, orden }, update: {} });
  }
  const products = [
    ['prod-ceviche', 'Ceviche Mixto', 'Camarones, pulpo y pescado', 8.50, 'cat-entradas'],
    ['prod-patacones', 'Patacones con Queso', 'Patacones fritos con queso', 4.00, 'cat-entradas'],
    ['prod-seco', 'Seco de Pollo', 'Con arroz y menestra', 9.50, 'cat-platos'],
    ['prod-pescado', 'Filete de Pescado', 'A la plancha con arroz', 12.00, 'cat-platos'],
    ['prod-cola', 'Gaseosa', '350ml', 2.00, 'cat-bebidas'],
    ['prod-jugo', 'Jugo Natural', 'Naranja o mora', 2.50, 'cat-bebidas'],
    ['prod-helado', 'Helado Artesanal', '2 bolas', 3.50, 'cat-postres'],
  ];
  for (const [id, nombre, descripcion, precio, categoriaId] of products) {
    await prisma.producto.upsert({
      where: { id },
      create: { id, nombre, descripcion, precio, categoriaId, porcentajeIva: 15, disponible: true },
      update: {},
    });
  }
}

async function uniqueRestaurantSlug(base) {
  const prisma = getPlatformPrisma();
  let candidate = base || 'restaurante';
  for (let i = 0; i < 20; i += 1) {
    const slug = i === 0 ? candidate : `${candidate}-${i + 1}`;
    const existing = await prisma.platformRestaurant.findUnique({ where: { slug } });
    if (!existing) return slug;
  }
  return `${candidate}-${crypto.randomBytes(3).toString('hex')}`;
}

function uniqueTenantSchema(slug) {
  const safe = String(slug || 'restaurante').replace(/[^a-z0-9_]/g, '_').slice(0, 42);
  return `tenant_${safe}_${crypto.randomBytes(3).toString('hex')}`;
}

async function ensureTenantSchema(schemaName) {
  const prisma = getPlatformPrisma();
  const schema = quoteIdent(schemaName);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema};`);
  await executeSqlBatch(prisma, tenantTablesSql(schema));
}

async function copyPublicDataToTenant(schemaName) {
  const prisma = getPlatformPrisma();
  const schema = quoteIdent(schemaName);
  const tables = [
    ['categorias', '"id", "nombre", "orden", "activa", "createdAt"'],
    ['productos', '"id", "codigo", "nombre", "descripcion", "precio", "categoriaId", "porcentajeIva", "disponible", "createdAt", "updatedAt"'],
    ['mesas', '"id", "nombre", "capacidad", "estado", "ubicacion", "activa", "createdAt", "updatedAt"'],
    ['personas', '"id", "cedula", "ruc", "razonSocial", "tipo", "email", "telefonos", "direccion", "esExtranjero", "activo", "createdAt", "updatedAt"'],
    ['ordenes', '"id", "mesaId", "estado", "descripcion", "mesero", "comensales", "createdAt", "updatedAt", "cerradaAt"'],
    ['orden_detalles', '"id", "ordenId", "productoId", "nombre", "cantidad", "precio", "porcentajeIva", "porcentajeDescuento", "createdAt", "updatedAt"'],
    ['documentos', '"id", "ordenId", "personaId", "pos", "fechaEmision", "tipoDocumento", "tipoRegistro", "estado", "electronico", "descripcion", "subtotal0", "subtotal15", "iva", "servicio", "total", "autorizacionSRI", "urlRide", "urlXml", "claveAcceso", "clienteCedula", "clienteRuc", "clienteRazonSocial", "clienteTipo", "clienteEmail", "clienteTelefonos", "clienteDireccion", "clienteExtranjero", "createdAt", "updatedAt"'],
    ['documento_detalles', '"id", "documentoId", "productoId", "cantidad", "precio", "porcentajeIva", "porcentajeDescuento", "baseCero", "baseGravable", "baseNoGravable", "createdAt"'],
    ['cobros', '"id", "documentoId", "formaCobro", "monto", "propina", "procesador", "detalle", "referencia", "createdAt"'],
    ['webhook_logs', '"id", "fuente", "evento", "payload", "procesado", "error", "createdAt"'],
    ['mesitaqr_sessions', '"id", "sessionId", "mesaId", "ordenId", "montoTotal", "qrCode", "qrUrl", "estado", "expiraEn", "paidAt", "createdAt", "updatedAt"'],
  ];

  for (const [table, columns] of tables) {
    if (await tableExists('public', table)) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO ${schema}."${table}" (${columns})
        SELECT ${columns} FROM public."${table}"
        ON CONFLICT DO NOTHING;
      `);
    }
  }
}

async function tableExists(schemaName, tableName) {
  const rows = await getPlatformPrisma().$queryRawUnsafe(
    'SELECT to_regclass($1)::text AS name',
    `${schemaName}.${tableName}`
  );
  return Boolean(rows?.[0]?.name);
}

function platformTablesSql() {
  return `
    CREATE TABLE IF NOT EXISTS "platform_users" (
      "id" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "platform_users_email_key" ON "platform_users"("email");

    CREATE TABLE IF NOT EXISTS "platform_restaurants" (
      "id" TEXT NOT NULL,
      "tenantSchema" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "legalName" TEXT,
      "ruc" TEXT,
      "address" TEXT,
      "city" TEXT,
      "phone" TEXT,
      "email" TEXT,
      "serviceChargeEnabled" BOOLEAN NOT NULL DEFAULT true,
      "serviceChargeRate" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
      "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "platform_restaurants_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "platform_restaurants_tenantSchema_key" ON "platform_restaurants"("tenantSchema");
    CREATE UNIQUE INDEX IF NOT EXISTS "platform_restaurants_slug_key" ON "platform_restaurants"("slug");

    CREATE TABLE IF NOT EXISTS "platform_memberships" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "restaurantId" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'server',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "platform_memberships_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "platform_memberships_userId_restaurantId_key" ON "platform_memberships"("userId", "restaurantId");
    CREATE INDEX IF NOT EXISTS "platform_memberships_restaurantId_idx" ON "platform_memberships"("restaurantId");

    CREATE TABLE IF NOT EXISTS "platform_sessions" (
      "id" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "restaurantId" TEXT NOT NULL,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "revokedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "platform_sessions_tokenHash_key" ON "platform_sessions"("tokenHash");
    CREATE INDEX IF NOT EXISTS "platform_sessions_userId_idx" ON "platform_sessions"("userId");
    CREATE INDEX IF NOT EXISTS "platform_sessions_restaurantId_idx" ON "platform_sessions"("restaurantId");
    CREATE INDEX IF NOT EXISTS "platform_sessions_expiresAt_idx" ON "platform_sessions"("expiresAt");
  `;
}

async function executeSqlBatch(prisma, sql) {
  const statements = String(sql)
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

function tenantTablesSql(schema) {
  return `
    CREATE TABLE IF NOT EXISTS ${schema}."mesas" (
      "id" TEXT NOT NULL,
      "nombre" TEXT NOT NULL,
      "capacidad" INTEGER NOT NULL DEFAULT 4,
      "estado" TEXT NOT NULL DEFAULT 'L',
      "ubicacion" TEXT,
      "activa" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "mesas_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS ${schema}."categorias" (
      "id" TEXT NOT NULL,
      "nombre" TEXT NOT NULL,
      "orden" INTEGER NOT NULL DEFAULT 0,
      "activa" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS ${schema}."productos" (
      "id" TEXT NOT NULL,
      "codigo" TEXT,
      "nombre" TEXT NOT NULL,
      "descripcion" TEXT,
      "precio" DECIMAL(10,2) NOT NULL,
      "categoriaId" TEXT,
      "porcentajeIva" INTEGER NOT NULL DEFAULT 15,
      "disponible" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "productos_codigo_key" ON ${schema}."productos"("codigo");

    CREATE TABLE IF NOT EXISTS ${schema}."personas" (
      "id" TEXT NOT NULL,
      "cedula" TEXT,
      "ruc" TEXT,
      "razonSocial" TEXT NOT NULL,
      "tipo" TEXT NOT NULL DEFAULT 'N',
      "email" TEXT,
      "telefonos" TEXT,
      "direccion" TEXT,
      "esExtranjero" BOOLEAN NOT NULL DEFAULT false,
      "activo" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "personas_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "personas_cedula_key" ON ${schema}."personas"("cedula");

    CREATE TABLE IF NOT EXISTS ${schema}."ordenes" (
      "id" TEXT NOT NULL,
      "mesaId" TEXT NOT NULL,
      "estado" TEXT NOT NULL DEFAULT 'A',
      "descripcion" TEXT,
      "mesero" TEXT,
      "comensales" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "cerradaAt" TIMESTAMP(3),
      CONSTRAINT "ordenes_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "ordenes_mesaId_idx" ON ${schema}."ordenes"("mesaId");

    CREATE TABLE IF NOT EXISTS ${schema}."orden_detalles" (
      "id" TEXT NOT NULL,
      "ordenId" TEXT NOT NULL,
      "productoId" TEXT,
      "nombre" TEXT NOT NULL,
      "cantidad" DECIMAL(10,2) NOT NULL DEFAULT 1,
      "precio" DECIMAL(10,2) NOT NULL,
      "porcentajeIva" INTEGER NOT NULL DEFAULT 15,
      "porcentajeDescuento" DECIMAL(5,2) NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "orden_detalles_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "orden_detalles_ordenId_idx" ON ${schema}."orden_detalles"("ordenId");

    CREATE TABLE IF NOT EXISTS ${schema}."documentos" (
      "id" TEXT NOT NULL,
      "ordenId" TEXT,
      "personaId" TEXT,
      "pos" TEXT,
      "fechaEmision" TEXT NOT NULL,
      "tipoDocumento" TEXT NOT NULL,
      "tipoRegistro" TEXT NOT NULL DEFAULT 'CLI',
      "estado" TEXT NOT NULL DEFAULT 'P',
      "electronico" BOOLEAN NOT NULL DEFAULT true,
      "descripcion" TEXT,
      "subtotal0" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "subtotal15" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "iva" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "servicio" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "autorizacionSRI" TEXT,
      "urlRide" TEXT,
      "urlXml" TEXT,
      "claveAcceso" TEXT,
      "clienteCedula" TEXT,
      "clienteRuc" TEXT,
      "clienteRazonSocial" TEXT,
      "clienteTipo" TEXT,
      "clienteEmail" TEXT,
      "clienteTelefonos" TEXT,
      "clienteDireccion" TEXT,
      "clienteExtranjero" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "documentos_tipoDocumento_idx" ON ${schema}."documentos"("tipoDocumento");
    CREATE INDEX IF NOT EXISTS "documentos_fechaEmision_idx" ON ${schema}."documentos"("fechaEmision");
    CREATE INDEX IF NOT EXISTS "documentos_clienteCedula_idx" ON ${schema}."documentos"("clienteCedula");

    CREATE TABLE IF NOT EXISTS ${schema}."documento_detalles" (
      "id" TEXT NOT NULL,
      "documentoId" TEXT NOT NULL,
      "productoId" TEXT,
      "cantidad" DECIMAL(10,2) NOT NULL,
      "precio" DECIMAL(10,2) NOT NULL,
      "porcentajeIva" INTEGER NOT NULL DEFAULT 15,
      "porcentajeDescuento" DECIMAL(5,2) NOT NULL DEFAULT 0,
      "baseCero" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "baseGravable" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "baseNoGravable" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "documento_detalles_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "documento_detalles_documentoId_idx" ON ${schema}."documento_detalles"("documentoId");

    CREATE TABLE IF NOT EXISTS ${schema}."cobros" (
      "id" TEXT NOT NULL,
      "documentoId" TEXT NOT NULL,
      "formaCobro" TEXT NOT NULL,
      "monto" DECIMAL(10,2) NOT NULL,
      "propina" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "procesador" TEXT,
      "detalle" TEXT,
      "referencia" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "cobros_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "cobros_documentoId_idx" ON ${schema}."cobros"("documentoId");

    CREATE TABLE IF NOT EXISTS ${schema}."webhook_logs" (
      "id" TEXT NOT NULL,
      "fuente" TEXT NOT NULL,
      "evento" TEXT NOT NULL,
      "payload" JSONB NOT NULL,
      "procesado" BOOLEAN NOT NULL DEFAULT false,
      "error" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS ${schema}."mesitaqr_sessions" (
      "id" TEXT NOT NULL,
      "sessionId" TEXT NOT NULL,
      "mesaId" TEXT NOT NULL,
      "ordenId" TEXT NOT NULL,
      "montoTotal" DECIMAL(10,2) NOT NULL,
      "qrCode" TEXT NOT NULL,
      "qrUrl" TEXT NOT NULL,
      "estado" TEXT NOT NULL DEFAULT 'pendiente',
      "expiraEn" TIMESTAMP(3) NOT NULL,
      "paidAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "mesitaqr_sessions_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "mesitaqr_sessions_sessionId_key" ON ${schema}."mesitaqr_sessions"("sessionId");
    CREATE INDEX IF NOT EXISTS "mesitaqr_sessions_mesaId_idx" ON ${schema}."mesitaqr_sessions"("mesaId");

    ALTER TABLE ${schema}."ordenes" ADD COLUMN IF NOT EXISTS "comensales" INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${schema}."cobros" ADD COLUMN IF NOT EXISTS "propina" DECIMAL(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE ${schema}."cobros" ADD COLUMN IF NOT EXISTS "procesador" TEXT;
    ALTER TABLE ${schema}."cobros" ADD COLUMN IF NOT EXISTS "detalle" TEXT;
  `;
}

function publicRestaurant(r) {
  return {
    id: r.id,
    tenant_schema: r.tenantSchema,
    slug: r.slug,
    name: r.name,
    legal_name: r.legalName,
    ruc: r.ruc,
    address: r.address,
    city: r.city,
    phone: r.phone,
    email: r.email,
    service_charge_enabled: r.serviceChargeEnabled,
    service_charge_rate: Number(r.serviceChargeRate ?? 0.10),
    setup_completed: r.setupCompleted,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name };
}

function formatAuthResponse(user, restaurant, role, session) {
  return {
    token: session.token,
    expires_at: session.expiresAt,
    user: publicUser(user),
    restaurant: publicRestaurant(restaurant),
    role,
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${key}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, parts[1], expected.length);
  try {
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function slugify(value) {
  const slug = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44);
  return slug || 'restaurante';
}

function quoteIdent(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error('Invalid tenant schema name.');
  }
  return `"${value}"`;
}

function clean(value) {
  return String(value || '').trim();
}

function clampInt(value, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  throw err;
}

function unauthorized(message) {
  const err = new Error(message);
  err.statusCode = 401;
  throw err;
}

function conflict(message) {
  const err = new Error(message);
  err.statusCode = 409;
  throw err;
}

module.exports = {
  DEMO_TENANT_SCHEMA,
  ensurePlatformReady,
  ensureDemoRestaurant,
  ensureTenantSchema,
  getDemoAuthContext,
  registerRestaurant,
  login,
  guestLogin,
  logout,
  authenticateSession,
  completeSetup,
  getSettings,
  updateSettings,
  publicRestaurant,
};
