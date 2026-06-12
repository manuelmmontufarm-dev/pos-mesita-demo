'use strict';

const { getPrisma } = require('../config/database');
const { PAGINATION } = require('../config/constants');

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

/**
 * List productos with optional filters.
 * @param {object} opts - { categoria_id, nombre, disponible, result_size, result_page }
 */
async function listarProductos(opts = {}) {
  const prisma = getPrisma();
  const take = Math.min(parseInt(opts.result_size || PAGINATION.DEFAULT_PAGE_SIZE, 10), PAGINATION.MAX_PAGE_SIZE);
  const skip = (parseInt(opts.result_page || 1, 10) - 1) * take;

  const where = {};
  if (opts.categoria_id) where.categoriaId = opts.categoria_id;
  if (opts.nombre) where.nombre = { contains: opts.nombre, mode: 'insensitive' };
  if (opts.disponible !== undefined) where.disponible = opts.disponible === 'true' || opts.disponible === true;

  const [count, productos] = await Promise.all([
    prisma.producto.count({ where }),
    prisma.producto.findMany({
      where,
      skip,
      take,
      orderBy: { nombre: 'asc' },
      include: { categoria: true },
    }),
  ]);

  return { count, results: productos };
}

/**
 * Get a single producto by ID.
 * @param {string} id
 */
async function obtenerProducto(id) {
  const prisma = getPrisma();
  return prisma.producto.findUniqueOrThrow({
    where: { id },
    include: { categoria: true },
  });
}

/**
 * Create a producto.
 * @param {object} data - { codigo, nombre, descripcion, precio, categoria_id, porcentaje_iva, disponible }
 */
async function crearProducto(data) {
  const prisma = getPrisma();
  return prisma.producto.create({
    data: {
      codigo: data.codigo || null,
      nombre: data.nombre,
      descripcion: data.descripcion || null,
      precio: data.precio,
      categoriaId: data.categoria_id || null,
      porcentajeIva: data.porcentaje_iva !== undefined ? data.porcentaje_iva : 15,
      disponible: data.disponible !== undefined ? data.disponible : true,
    },
    include: { categoria: true },
  });
}

/**
 * Update a producto.
 * @param {string} id
 * @param {object} data
 */
async function actualizarProducto(id, data) {
  const prisma = getPrisma();
  const updateData = {};
  if (data.codigo !== undefined) updateData.codigo = data.codigo;
  if (data.nombre !== undefined) updateData.nombre = data.nombre;
  if (data.descripcion !== undefined) updateData.descripcion = data.descripcion;
  if (data.precio !== undefined) updateData.precio = data.precio;
  if (data.categoria_id !== undefined) updateData.categoriaId = data.categoria_id;
  if (data.porcentaje_iva !== undefined) updateData.porcentajeIva = data.porcentaje_iva;
  if (data.disponible !== undefined) updateData.disponible = data.disponible;

  return prisma.producto.update({
    where: { id },
    data: updateData,
    include: { categoria: true },
  });
}

async function eliminarProducto(id) {
  const prisma = getPrisma();
  return prisma.producto.update({
    where: { id },
    data: { disponible: false },
    include: { categoria: true },
  });
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

async function listarCategorias() {
  const prisma = getPrisma();
  return prisma.categoria.findMany({
    where: { activa: true },
    orderBy: { orden: 'asc' },
  });
}

async function crearCategoria(data) {
  const prisma = getPrisma();
  return prisma.categoria.create({
    data: {
      nombre: data.nombre,
      orden: data.orden || 0,
    },
  });
}

async function actualizarCategoria(id, data) {
  const prisma = getPrisma();
  const updateData = {};
  if (data.nombre !== undefined) updateData.nombre = data.nombre;
  if (data.orden !== undefined) updateData.orden = data.orden;
  if (data.activa !== undefined) updateData.activa = data.activa;
  return prisma.categoria.update({
    where: { id },
    data: updateData,
  });
}

async function eliminarCategoria(id) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.producto.updateMany({
      where: { categoriaId: id },
      data: { categoriaId: null },
    });
    return tx.categoria.update({
      where: { id },
      data: { activa: false },
    });
  });
}

module.exports = {
  listarProductos,
  obtenerProducto,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  listarCategorias,
  crearCategoria,
  actualizarCategoria,
  eliminarCategoria,
};
