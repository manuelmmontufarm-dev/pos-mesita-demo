'use strict';

/**
 * @swagger
 * tags:
 *   name: Documentos
 *   description: Pre-facturas y facturas electrónicas (Contifico-compatible)
 */

const express = require('express');
const router = express.Router();
const documentoService = require('../../services/documentoService');
const { asyncHandler } = require('../../middlewares/errorHandler');

/**
 * @swagger
 * /documento/:
 *   get:
 *     summary: Listar documentos (facturas y pre-facturas)
 *     tags: [Documentos]
 *     security:
 *       - TokenAuth: []
 *     parameters:
 *       - in: query
 *         name: tipo_documento
 *         schema: { type: string, enum: [PRE, FAC] }
 *       - in: query
 *         name: fecha_emision
 *         schema: { type: string, example: "10/06/2026" }
 *         description: Filtrar por fecha en formato DD/MM/YYYY
 *       - in: query
 *         name: persona_identificacion
 *         schema: { type: string }
 *         description: Filtrar por cédula o RUC del cliente
 *       - in: query
 *         name: result_size
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: result_page
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: Lista de documentos
 */
router.get('/', asyncHandler(async (req, res) => {
  const result = await documentoService.listarDocumentos(req.query);
  res.json({
    count: result.count,
    results: result.results.map(formatDocumento),
  });
}));

/**
 * @swagger
 * /documento/{id}/:
 *   get:
 *     summary: Obtener documento completo (Contifico-shape con url_ride, url_xml, cobros[], detalles[])
 *     tags: [Documentos]
 *     security:
 *       - TokenAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Documento completo
 *       404:
 *         description: Documento no encontrado
 */
router.get('/:id/', asyncHandler(async (req, res) => {
  const doc = await documentoService.obtenerDocumento(req.params.id);
  res.json(formatDocumento(doc));
}));

/**
 * @swagger
 * /documento/:
 *   post:
 *     summary: Crear un documento (PRE o FAC). Body mirrors Contifico exactly.
 *     tags: [Documentos]
 *     security:
 *       - TokenAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DocumentoInput'
 *     responses:
 *       201:
 *         description: Documento creado
 *       400:
 *         description: Datos inválidos
 */
router.post('/', asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body.tipo_documento) {
    return res.status(400).json({ error: 'Se requiere tipo_documento (PRE o FAC).' });
  }
  if (!['PRE', 'FAC'].includes(body.tipo_documento)) {
    return res.status(400).json({ error: 'tipo_documento debe ser PRE o FAC.' });
  }
  const doc = await documentoService.crearDocumento(body);
  res.status(201).json(formatDocumento(doc));
}));

/**
 * @swagger
 * /documento/{id}/:
 *   patch:
 *     summary: Actualizar estado del documento o agregar cobro
 *     tags: [Documentos]
 *     security:
 *       - TokenAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               estado:
 *                 type: string
 *                 enum: [P, C, A, F]
 *                 description: P=Pendiente, C=Cobrado, A=Anulado, F=Facturado
 *               cobro:
 *                 type: object
 *                 properties:
 *                   forma_cobro: { type: string, enum: [EF, TC, TD, TR, CH] }
 *                   monto: { type: number }
 *                   propina: { type: number }
 *                   procesador: { type: string }
 *                   detalle: { type: string }
 *                   referencia: { type: string }
 *     responses:
 *       200:
 *         description: Documento actualizado
 */
router.patch('/:id/', asyncHandler(async (req, res) => {
  const doc = await documentoService.actualizarDocumento(req.params.id, req.body);
  res.json(formatDocumento(doc));
}));

// ---------------------------------------------------------------------------
// Response formatter — maps internal model → Contifico-compatible JSON shape
// ---------------------------------------------------------------------------

function formatDocumento(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    pos: doc.pos,
    fecha_emision: doc.fechaEmision,
    tipo_documento: doc.tipoDocumento,
    tipo_registro: doc.tipoRegistro,
    estado: doc.estado,
    electronico: doc.electronico,
    descripcion: doc.descripcion,
    subtotal_0: Number(doc.subtotal0 || 0),
    subtotal_15: Number(doc.subtotal15 || 0),
    iva: Number(doc.iva || 0),
    servicio: Number(doc.servicio || 0),
    total: Number(doc.total || 0),
    // SRI fields (null until FAC is issued)
    autorizacion: doc.autorizacionSRI || null,
    clave_acceso: doc.claveAcceso || null,
    url_ride: doc.urlRide || null,
    url_xml: doc.urlXml || null,
    // Cliente snapshot
    cliente: doc.clienteRazonSocial ? {
      cedula: doc.clienteCedula,
      ruc: doc.clienteRuc,
      razon_social: doc.clienteRazonSocial,
      tipo: doc.clienteTipo,
      email: doc.clienteEmail,
      telefonos: doc.clienteTelefonos,
      direccion: doc.clienteDireccion,
      es_extranjero: doc.clienteExtranjero,
    } : null,
    // Line items
    detalles: (doc.detallesDoc || []).map((d) => ({
      id: d.id,
      producto_id: d.productoId,
      cantidad: Number(d.cantidad),
      precio: Number(d.precio),
      porcentaje_iva: d.porcentajeIva,
      porcentaje_descuento: Number(d.porcentajeDescuento),
      base_cero: Number(d.baseCero),
      base_gravable: Number(d.baseGravable),
      base_no_gravable: Number(d.baseNoGravable),
    })),
    // Payment records
    cobros: (doc.cobros || []).map((c) => ({
      id: c.id,
      forma_cobro: c.formaCobro,
      monto: Number(c.monto),
      propina: Number(c.propina || 0),
      procesador: c.procesador || null,
      detalle: c.detalle || null,
      referencia: c.referencia,
      created_at: c.createdAt,
    })),
    orden_id: doc.ordenId,
    orden: doc.orden ? {
      id: doc.orden.id,
      estado: doc.orden.estado,
      mesa: doc.orden.mesa ? {
        id: doc.orden.mesa.id,
        nombre: doc.orden.mesa.nombre,
      } : null,
    } : null,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

module.exports = router;
