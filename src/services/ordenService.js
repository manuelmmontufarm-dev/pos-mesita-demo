'use strict';

const { getPrisma, getRequestContext } = require('../config/database');
const { ESTADO_ORDEN, ESTADO_MESA, PAGINATION, IVA_RATE, SERVICE_RATE } = require('../config/constants');
const mesaService = require('./mesaService');

/**
 * List ordenes with optional filters.
 * @param {object} opts - { mesa_id, estado, result_size, result_page }
 */
async function listarOrdenes(opts = {}) {
  const prisma = getPrisma();
  const take = Math.min(parseInt(opts.result_size || PAGINATION.DEFAULT_PAGE_SIZE, 10), PAGINATION.MAX_PAGE_SIZE);
  const skip = (parseInt(opts.result_page || 1, 10) - 1) * take;

  const where = {};
  if (opts.mesa_id) where.mesaId = opts.mesa_id;
  if (opts.estado) where.estado = opts.estado;

  const [count, ordenes] = await Promise.all([
    prisma.orden.count({ where }),
    prisma.orden.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        mesa: true,
        detalles: { include: { producto: true } },
      },
    }),
  ]);

  return { count, results: ordenes };
}

/**
 * Get a single orden with full detalles.
 * @param {string} id
 */
async function obtenerOrden(id) {
  const prisma = getPrisma();
  return prisma.orden.findUniqueOrThrow({
    where: { id },
    include: {
      mesa: true,
      detalles: {
        include: { producto: true },
        orderBy: { createdAt: 'asc' },
      },
      documentos: { orderBy: { createdAt: 'desc' } },
    },
  });
}

/**
 * Open a new orden on a mesa.
 * Also transitions mesa estado from L → O.
 * @param {object} data - { mesa_id, descripcion, mesero }
 */
async function abrirOrden(data) {
  const prisma = getPrisma();

  // Validate mesa exists
  const mesa = await prisma.mesa.findUniqueOrThrow({ where: { id: data.mesa_id } });

  // Create the orden
  const orden = await prisma.orden.create({
    data: {
      mesaId: mesa.id,
      descripcion: data.descripcion || null,
      mesero: data.mesero || null,
      estado: ESTADO_ORDEN.ABIERTA,
      comensales: Number.isFinite(Number(data.comensales)) ? Math.max(0, Math.min(20, parseInt(data.comensales, 10))) : 0,
    },
    include: { mesa: true, detalles: true },
  });

  // Mark mesa as OCUPADA
  await mesaService.actualizarMesa(mesa.id, { estado: ESTADO_MESA.OCUPADA });

  return orden;
}

/**
 * Add an item (detalle) to an open orden.
 * @param {string} ordenId
 * @param {object} data - { producto_id?, nombre?, cantidad, precio, porcentaje_iva, porcentaje_descuento }
 */
async function agregarDetalle(ordenId, data) {
  const prisma = getPrisma();

  // Ensure orden is open
  const orden = await prisma.orden.findUniqueOrThrow({ where: { id: ordenId } });
  if (orden.estado !== ESTADO_ORDEN.ABIERTA) {
    const err = new Error('La orden no está abierta.');
    err.statusCode = 409;
    throw err;
  }

  // Resolve name from producto if not provided
  let nombre = data.nombre;
  let precio = data.precio;
  if (data.producto_id && (!nombre || !precio)) {
    const producto = await prisma.producto.findUnique({ where: { id: data.producto_id } });
    if (producto) {
      nombre = nombre || producto.nombre;
      precio = precio !== undefined ? precio : Number(producto.precio);
    }
  }

  if (!nombre) {
    const err = new Error('Se requiere nombre del producto.');
    err.statusCode = 400;
    throw err;
  }

  const detalle = await prisma.ordenDetalle.create({
    data: {
      ordenId,
      productoId: data.producto_id || null,
      nombre,
      cantidad: data.cantidad || 1,
      precio: precio || 0,
      porcentajeIva: data.porcentaje_iva !== undefined ? data.porcentaje_iva : 15,
      porcentajeDescuento: data.porcentaje_descuento || 0,
    },
    include: { producto: true },
  });

  return detalle;
}

/**
 * Remove an item from an open orden.
 * @param {string} ordenId
 * @param {string} detalleId
 */
async function eliminarDetalle(ordenId, detalleId) {
  const prisma = getPrisma();

  const detalle = await prisma.ordenDetalle.findUniqueOrThrow({ where: { id: detalleId } });
  if (detalle.ordenId !== ordenId) {
    const err = new Error('El detalle no pertenece a esta orden.');
    err.statusCode = 400;
    throw err;
  }

  await prisma.ordenDetalle.delete({ where: { id: detalleId } });
  return { deleted: true };
}

/**
 * Update orden estado or descripcion.
 * @param {string} id
 * @param {object} data - { estado, descripcion }
 */
async function actualizarOrden(id, data) {
  const prisma = getPrisma();
  const updateData = {};
  if (data.estado !== undefined) updateData.estado = data.estado;
  if (data.descripcion !== undefined) updateData.descripcion = data.descripcion;
  if (data.mesero !== undefined) updateData.mesero = data.mesero;
  if (data.comensales !== undefined) {
    const n = parseInt(data.comensales, 10);
    if (Number.isFinite(n)) updateData.comensales = Math.max(0, Math.min(20, n));
  }
  if (data.estado === ESTADO_ORDEN.CERRADA) updateData.cerradaAt = new Date();

  return prisma.orden.update({
    where: { id },
    data: updateData,
    include: { mesa: true, detalles: true },
  });
}

/**
 * Calculate totals for an orden (applying 15% IVA + 10% servicio).
 * Returns Contifico-compatible total fields.
 * @param {string} ordenId
 */
async function calcularTotales(ordenId) {
  const prisma = getPrisma();
  const detalles = await prisma.ordenDetalle.findMany({ where: { ordenId } });

  let subtotal0 = 0;
  let subtotal15 = 0;

  for (const d of detalles) {
    const cant = Number(d.cantidad);
    const price = Number(d.precio);
    const desc = Number(d.porcentajeDescuento) / 100;
    const lineSubtotal = cant * price * (1 - desc);

    if (d.porcentajeIva === 0) {
      subtotal0 += lineSubtotal;
    } else {
      subtotal15 += lineSubtotal;
    }
  }

  const serviceSettings = getServiceSettings();
  const iva = round2(subtotal15 * IVA_RATE);
  const servicio = serviceSettings.enabled
    ? round2((subtotal0 + subtotal15) * serviceSettings.rate)
    : 0;
  const total = round2(subtotal0 + subtotal15 + iva + servicio);

  return {
    subtotal_0: round2(subtotal0),
    subtotal_15: round2(subtotal15),
    iva,
    servicio,
    service_enabled: serviceSettings.enabled,
    service_rate: serviceSettings.rate,
    total,
  };
}

function getServiceSettings() {
  const restaurant = getRequestContext().restaurant;
  if (!restaurant) return { enabled: true, rate: SERVICE_RATE };
  const rate = Number(restaurant.service_charge_rate ?? restaurant.serviceChargeRate ?? SERVICE_RATE);
  const enabled = Boolean(restaurant.service_charge_enabled ?? restaurant.serviceChargeEnabled ?? true);
  return {
    enabled,
    rate: Number.isFinite(rate) ? rate : SERVICE_RATE,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  listarOrdenes,
  obtenerOrden,
  abrirOrden,
  agregarDetalle,
  eliminarDetalle,
  actualizarOrden,
  calcularTotales,
};
