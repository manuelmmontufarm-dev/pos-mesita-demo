'use strict';

/**
 * @swagger
 * tags:
 *   name: Productos
 *   description: Catálogo de productos del menú
 */

const express = require('express');
const router = express.Router();
const catalogoService = require('../../services/catalogoService');
const { asyncHandler } = require('../../middlewares/errorHandler');

/**
 * @swagger
 * /producto/:
 *   get:
 *     summary: Listar productos del catálogo
 *     tags: [Productos]
 *     security:
 *       - TokenAuth: []
 *     parameters:
 *       - in: query
 *         name: categoria_id
 *         schema: { type: string }
 *       - in: query
 *         name: nombre
 *         schema: { type: string }
 *         description: Búsqueda parcial por nombre
 *       - in: query
 *         name: disponible
 *         schema: { type: boolean }
 *       - in: query
 *         name: result_size
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: result_page
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: Lista de productos
 */
router.get('/', asyncHandler(async (req, res) => {
  const result = await catalogoService.listarProductos(req.query);
  res.json({ count: result.count, results: result.results.map(formatProducto) });
}));

router.get('/categoria/', asyncHandler(async (req, res) => {
  const categorias = await catalogoService.listarCategorias();
  res.json(categorias.map(formatCategoria));
}));

router.post('/categoria/', asyncHandler(async (req, res) => {
  if (!req.body.nombre) {
    return res.status(400).json({ error: 'Se requiere nombre.' });
  }
  const categoria = await catalogoService.crearCategoria(req.body);
  res.status(201).json(formatCategoria(categoria));
}));

router.patch('/categoria/:id/', asyncHandler(async (req, res) => {
  const categoria = await catalogoService.actualizarCategoria(req.params.id, req.body);
  res.json(formatCategoria(categoria));
}));

router.delete('/categoria/:id/', asyncHandler(async (req, res) => {
  await catalogoService.eliminarCategoria(req.params.id);
  res.status(204).send();
}));

/**
 * @swagger
 * /producto/{id}/:
 *   get:
 *     summary: Obtener producto por ID
 *     tags: [Productos]
 *     security:
 *       - TokenAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Producto
 *       404:
 *         description: No encontrado
 */
router.get('/:id/', asyncHandler(async (req, res) => {
  const p = await catalogoService.obtenerProducto(req.params.id);
  res.json(formatProducto(p));
}));

/**
 * @swagger
 * /producto/:
 *   post:
 *     summary: Crear producto (admin)
 *     tags: [Productos]
 *     security:
 *       - TokenAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, precio]
 *             properties:
 *               codigo: { type: string, example: "PROD-001" }
 *               nombre: { type: string, example: "Ceviche Mixto" }
 *               descripcion: { type: string }
 *               precio: { type: number, example: 8.50 }
 *               categoria_id: { type: string }
 *               porcentaje_iva: { type: integer, example: 15 }
 *               disponible: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Producto creado
 */
router.post('/', asyncHandler(async (req, res) => {
  if (!req.body.nombre || req.body.precio === undefined) {
    return res.status(400).json({ error: 'Se requieren nombre y precio.' });
  }
  const p = await catalogoService.crearProducto(req.body);
  res.status(201).json(formatProducto(p));
}));

/**
 * @swagger
 * /producto/{id}/:
 *   patch:
 *     summary: Actualizar producto
 *     tags: [Productos]
 *     security:
 *       - TokenAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Producto actualizado
 */
router.patch('/:id/', asyncHandler(async (req, res) => {
  const p = await catalogoService.actualizarProducto(req.params.id, req.body);
  res.json(formatProducto(p));
}));

router.delete('/:id/', asyncHandler(async (req, res) => {
  await catalogoService.eliminarProducto(req.params.id);
  res.status(204).send();
}));

function formatProducto(p) {
  return {
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    descripcion: p.descripcion,
    precio: Number(p.precio),
    categoria_id: p.categoriaId,
    categoria: p.categoria ? { id: p.categoria.id, nombre: p.categoria.nombre } : null,
    porcentaje_iva: p.porcentajeIva,
    disponible: p.disponible,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

function formatCategoria(c) {
  return {
    id: c.id,
    nombre: c.nombre,
    orden: c.orden,
    activa: c.activa,
    created_at: c.createdAt,
  };
}

module.exports = router;
