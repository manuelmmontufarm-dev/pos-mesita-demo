'use strict';

const { getPrisma } = require('../config/database');
const { ESTADO_MESA, PAGINATION } = require('../config/constants');

/**
 * List all mesas with optional filters.
 * @param {object} opts - { estado, activa, result_size, result_page }
 * @returns {Promise<{count: number, results: object[]}>}
 */
async function listarMesas(opts = {}) {
  const prisma = getPrisma();
  const take = Math.min(parseInt(opts.result_size || PAGINATION.DEFAULT_PAGE_SIZE, 10), PAGINATION.MAX_PAGE_SIZE);
  const skip = (parseInt(opts.result_page || 1, 10) - 1) * take;

  const where = {};
  if (opts.estado) where.estado = opts.estado;
  if (opts.activa !== undefined) where.activa = opts.activa === 'true' || opts.activa === true;

  const [count, mesas] = await Promise.all([
    prisma.mesa.count({ where }),
    prisma.mesa.findMany({
      where,
      skip,
      take,
      orderBy: { nombre: 'asc' },
      include: {
        ordenes: {
          where: { estado: 'A' },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    }),
  ]);

  return { count, results: mesas };
}

/**
 * Get a single mesa by ID, including its active orden.
 * @param {string} id
 * @returns {Promise<object>}
 */
async function obtenerMesa(id) {
  const prisma = getPrisma();
  const mesa = await prisma.mesa.findUniqueOrThrow({
    where: { id },
    include: {
      ordenes: {
        where: { estado: 'A' },
        take: 1,
        orderBy: { createdAt: 'desc' },
        include: { detalles: true },
      },
    },
  });
  return mesa;
}

/**
 * Create a new mesa.
 * @param {object} data - { nombre, capacidad, ubicacion }
 * @returns {Promise<object>}
 */
async function crearMesa(data) {
  const prisma = getPrisma();
  return prisma.mesa.create({
    data: {
      nombre: data.nombre,
      capacidad: data.capacidad || 4,
      ubicacion: data.ubicacion || null,
      estado: ESTADO_MESA.LIBRE,
      activa: true,
    },
  });
}

/**
 * Update mesa estado or config.
 * @param {string} id
 * @param {object} data - { estado, capacidad, ubicacion, activa }
 * @returns {Promise<object>}
 */
async function actualizarMesa(id, data) {
  const prisma = getPrisma();
  const updateData = {};
  if (data.nombre !== undefined) updateData.nombre = data.nombre;
  if (data.estado !== undefined) updateData.estado = data.estado;
  if (data.capacidad !== undefined) updateData.capacidad = data.capacidad;
  if (data.ubicacion !== undefined) updateData.ubicacion = data.ubicacion;
  if (data.activa !== undefined) updateData.activa = data.activa;

  return prisma.mesa.update({
    where: { id },
    data: updateData,
  });
}

async function eliminarMesa(id) {
  return actualizarMesa(id, { activa: false });
}

/**
 * Set mesa estado to PAGANDO when a QR payment is initiated.
 * @param {string} id
 */
async function marcarPagando(id) {
  return actualizarMesa(id, { estado: ESTADO_MESA.PAGANDO });
}

/**
 * Set mesa estado to LIBRE after successful payment + document close.
 * @param {string} id
 */
async function liberarMesa(id) {
  return actualizarMesa(id, { estado: ESTADO_MESA.LIBRE });
}

module.exports = {
  listarMesas,
  obtenerMesa,
  crearMesa,
  actualizarMesa,
  eliminarMesa,
  marcarPagando,
  liberarMesa,
};
