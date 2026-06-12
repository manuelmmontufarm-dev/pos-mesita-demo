'use strict';

/**
 * Tests for Documento endpoints — PRE and FAC creation (Contifico-compatible shapes).
 */

const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.API_KEY = 'test-api-key';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.APP_BASE_URL = 'http://localhost:3000';

const mockDoc = {
  id: 'doc-uuid-1',
  ordenId: null,
  personaId: 'persona-uuid-1',
  pos: null,
  fechaEmision: '10/06/2026',
  tipoDocumento: 'PRE',
  tipoRegistro: 'CLI',
  estado: 'P',
  electronico: true,
  descripcion: 'PRE MESA 5',
  subtotal0: 0,
  subtotal15: 18.26,
  iva: 2.74,
  servicio: 2.00,
  total: 23.00,
  autorizacionSRI: null,
  claveAcceso: null,
  urlRide: null,
  urlXml: null,
  clienteCedula: '0922054366',
  clienteRuc: '0922054366001',
  clienteRazonSocial: 'Juan Pérez',
  clienteTipo: 'N',
  clienteEmail: 'cliente@example.com',
  clienteTelefonos: '0988800001',
  clienteDireccion: 'Guayaquil',
  clienteExtranjero: false,
  cobros: [],
  detallesDoc: [
    {
      id: 'det-1',
      productoId: 'prod-1',
      cantidad: 2,
      precio: 8.50,
      porcentajeIva: 15,
      porcentajeDescuento: 0,
      baseCero: 0,
      baseGravable: 17.00,
      baseNoGravable: 0,
    },
  ],
  persona: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockFAC = {
  ...mockDoc,
  tipoDocumento: 'FAC',
  estado: 'F',
  autorizacionSRI: 'MOCK-AUTHORIZACION-123',
  claveAcceso: 'DEMO123456789',
  urlRide: 'https://demo.pos-mesita.ec/ride/DEMO123456789',
  urlXml: 'https://demo.pos-mesita.ec/xml/DEMO123456789',
  cobros: [{ id: 'cobro-1', formaCobro: 'EF', monto: 23.00, referencia: null, createdAt: new Date() }],
};

jest.mock('@prisma/client', () => {
  const prismaMock = {
    documento: {
      create: jest.fn().mockResolvedValue(mockDoc),
      findUnique: jest.fn().mockResolvedValue(mockDoc),
      findUniqueOrThrow: jest.fn().mockResolvedValue(mockDoc),
      findMany: jest.fn().mockResolvedValue([mockDoc]),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue(mockDoc),
    },
    documentoDetalle: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    cobro: {
      create: jest.fn().mockResolvedValue({ id: 'cobro-1', formaCobro: 'EF', monto: 23.00 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    persona: {
      upsert: jest.fn().mockResolvedValue({ id: 'persona-uuid-1', cedula: '0922054366' }),
      create: jest.fn().mockResolvedValue({ id: 'persona-uuid-1' }),
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'persona-uuid-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ id: 'persona-uuid-1' }),
    },
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };
  return { PrismaClient: jest.fn(() => prismaMock) };
});

let app;
beforeAll(() => {
  // Reset module registry to get a fresh app instance with these mocks
  jest.resetModules();
  app = require('../src/app');
});

const AUTH = { Authorization: 'Token test-api-key' };

const validPREBody = {
  fecha_emision: '10/06/2026',
  tipo_documento: 'PRE',
  tipo_registro: 'CLI',
  estado: 'P',
  electronico: true,
  descripcion: 'PRE MESA 5',
  subtotal_0: 0.00,
  subtotal_15: 18.26,
  iva: 2.74,
  servicio: 2.00,
  total: 23.00,
  cliente: {
    cedula: '0922054366',
    ruc: '0922054366001',
    razon_social: 'Juan Pérez',
    tipo: 'N',
    email: 'cliente@example.com',
    telefonos: '0988800001',
    direccion: 'Guayaquil',
    es_extranjero: false,
  },
  detalles: [
    {
      producto_id: 'prod-1',
      cantidad: 2.00,
      precio: 8.50,
      porcentaje_iva: 15,
      porcentaje_descuento: 0.00,
      base_cero: 0.00,
      base_gravable: 17.00,
      base_no_gravable: 0.00,
    },
  ],
  cobros: [],
};

// ---------------------------------------------------------------------------
// POST /documento/ — PRE
// ---------------------------------------------------------------------------
describe('POST /sistema/api/v1/documento/ — PRE (pre-factura)', () => {
  it('returns 400 without tipo_documento', async () => {
    const res = await request(app)
      .post('/sistema/api/v1/documento/')
      .set(AUTH)
      .send({ total: 23.00 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown tipo_documento', async () => {
    const res = await request(app)
      .post('/sistema/api/v1/documento/')
      .set(AUTH)
      .send({ ...validPREBody, tipo_documento: 'NOTA' });
    expect(res.status).toBe(400);
  });

  it('creates a valid PRE documento', async () => {
    const res = await request(app)
      .post('/sistema/api/v1/documento/')
      .set(AUTH)
      .send(validPREBody);

    expect(res.status).toBe(201);
    // Contifico-compatible response shape
    expect(res.body.tipo_documento).toBe('PRE');
    expect(res.body.fecha_emision).toBeDefined();
    expect(res.body.total).toBeDefined();
    expect(res.body.detalles).toBeDefined();
    expect(res.body.cobros).toBeDefined();
    expect(Array.isArray(res.body.detalles)).toBe(true);
    // PRE should NOT have SRI fields
    expect(res.body.autorizacion).toBeNull();
    expect(res.body.url_ride).toBeNull();
    expect(res.body.url_xml).toBeNull();
  });

  it('response includes cliente snapshot', async () => {
    const res = await request(app)
      .post('/sistema/api/v1/documento/')
      .set(AUTH)
      .send(validPREBody);

    expect(res.body.cliente).toBeDefined();
    expect(res.body.cliente.cedula).toBe('0922054366');
    expect(res.body.cliente.razon_social).toBeDefined();
  });

  it('rejects applied payments above the document total', async () => {
    const res = await request(app)
      .post('/sistema/api/v1/documento/')
      .set(AUTH)
      .send({
        ...validPREBody,
        cobros: [{ forma_cobro: 'TC', monto: 24.00 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no puede superar/i);
  });

  it('allows tips when the applied payment equals the document total', async () => {
    const res = await request(app)
      .post('/sistema/api/v1/documento/')
      .set(AUTH)
      .send({
        ...validPREBody,
        cobros: [{ forma_cobro: 'TC', monto: 23.00, propina: 2.00 }],
      });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// POST /documento/ — FAC
// ---------------------------------------------------------------------------
describe('POST /sistema/api/v1/documento/ — FAC (factura electrónica)', () => {
  beforeEach(() => {
    // Switch mock to return FAC document
    const { PrismaClient } = require('@prisma/client');
    const instance = new PrismaClient();
    instance.documento.create.mockResolvedValue(mockFAC);
    instance.documento.findUnique.mockResolvedValue(mockFAC);
  });

  it('creates a valid FAC documento with url_ride and url_xml', async () => {
    const body = { ...validPREBody, tipo_documento: 'FAC' };
    const res = await request(app)
      .post('/sistema/api/v1/documento/')
      .set(AUTH)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.tipo_documento).toBe('FAC');
    // FAC should have SRI fields
    expect(res.body.url_ride).toBeDefined();
    expect(res.body.url_xml).toBeDefined();
    expect(res.body.autorizacion).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GET /documento/
// ---------------------------------------------------------------------------
describe('GET /sistema/api/v1/documento/', () => {
  it('returns list with pagination', async () => {
    const res = await request(app)
      .get('/sistema/api/v1/documento/')
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeDefined();
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('accepts filter params', async () => {
    const res = await request(app)
      .get('/sistema/api/v1/documento/?tipo_documento=PRE&result_size=5&result_page=1')
      .set(AUTH);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PATCH /documento/:id/
// ---------------------------------------------------------------------------
describe('PATCH /sistema/api/v1/documento/:id/', () => {
  it('accepts estado update', async () => {
    const { PrismaClient } = require('@prisma/client');
    const instance = new PrismaClient();
    const updated = { ...mockDoc, estado: 'C', cobros: [], detallesDoc: [] };
    instance.documento.update.mockResolvedValue(updated);
    instance.documento.findUnique.mockResolvedValue(updated);

    const res = await request(app)
      .patch('/sistema/api/v1/documento/doc-uuid-1/')
      .set(AUTH)
      .send({ estado: 'C' });
    expect(res.status).toBe(200);
  });
});
