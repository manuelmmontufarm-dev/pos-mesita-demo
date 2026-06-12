'use strict';

require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const path = require('path');

const env = require('./config/env');
const logger = require('./middlewares/logger');
const { requireApiKey } = require('./middlewares/auth');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');
const { connectDatabase } = require('./config/database');
const apiV1Router = require('./api/v1/index');
const { ensurePlatformReady } = require('./services/platformService');

const app = express();

// ---------------------------------------------------------------------------
// Security & infrastructure middleware
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // disabled so Swagger UI inline scripts work
}));
app.use(cors());
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// Rate limiting — 200 req/min per IP (Railway free tier safe)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsers (applied before routes that need JSON)
// Note: mesitaqr/webhook/ applies express.raw() at the route level for HMAC verification
app.use('/sistema/api/v1/mesitaqr/webhook/', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files (demo dashboard)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// Swagger / OpenAPI docs  — served at /sistema/api/v1/docs/
// ---------------------------------------------------------------------------
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'POS Mesita Demo API',
      version: '1.0.0',
      description: `
Demo POS REST API for MesitaQR + Contifico integration testing.

**Auth:** Use \`Authorization: Bearer <session>\` after login, or legacy \`Authorization: Token <API_KEY>\`.

**Base path:** \`/sistema/api/v1/\`

**Ecuador IVA:** 15% (Ley 004, effective 1 Apr 2024)

**Date format:** DD/MM/YYYY (Contifico convention)
      `,
      contact: { name: 'jdonoso1', url: 'https://github.com/jdonoso1/pos-mesita-demo' },
      license: { name: 'MIT' },
    },
    servers: [
      { url: '/sistema/api/v1', description: 'Current server' },
    ],
    components: {
      securitySchemes: {
        TokenAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'Use format: Token <your_api_key>',
        },
      },
      schemas: {
        DocumentoInput: {
          type: 'object',
          required: ['tipo_documento', 'fecha_emision', 'total'],
          properties: {
            pos: { type: 'string', description: 'Contifico POS UUID' },
            fecha_emision: { type: 'string', example: '10/06/2026' },
            tipo_documento: { type: 'string', enum: ['PRE', 'FAC'] },
            tipo_registro: { type: 'string', default: 'CLI' },
            estado: { type: 'string', enum: ['P', 'C', 'A', 'F'], default: 'P' },
            electronico: { type: 'boolean', default: true },
            descripcion: { type: 'string', example: 'FACTURA MESA 5' },
            subtotal_0: { type: 'number', example: 0.00 },
            subtotal_15: { type: 'number', example: 18.26 },
            iva: { type: 'number', example: 2.74 },
            servicio: { type: 'number', example: 2.00 },
            total: { type: 'number', example: 23.00 },
            cliente: {
              type: 'object',
              properties: {
                cedula: { type: 'string', example: '0922054366' },
                ruc: { type: 'string', example: '0922054366001' },
                razon_social: { type: 'string', example: 'Juan Pérez' },
                tipo: { type: 'string', enum: ['N', 'J'], default: 'N' },
                email: { type: 'string', example: 'cliente@example.com' },
                telefonos: { type: 'string', example: '0988800001' },
                direccion: { type: 'string', example: 'Guayaquil, Ecuador' },
                es_extranjero: { type: 'boolean', default: false },
              },
            },
            detalles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  producto_id: { type: 'string' },
                  cantidad: { type: 'number', example: 2.00 },
                  precio: { type: 'number', example: 8.50 },
                  porcentaje_iva: { type: 'integer', example: 15 },
                  porcentaje_descuento: { type: 'number', example: 0 },
                  base_cero: { type: 'number', example: 0 },
                  base_gravable: { type: 'number', example: 17.00 },
                  base_no_gravable: { type: 'number', example: 0 },
                },
              },
            },
            cobros: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  forma_cobro: { type: 'string', enum: ['EF', 'TC', 'TD', 'TR', 'CH'] },
                  monto: { type: 'number', example: 23.00 },
                },
              },
            },
          },
        },
      },
    },
    security: [{ TokenAuth: [] }],
  },
  apis: [path.join(__dirname, 'api', 'v1', '*.js')],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use(
  '/sistema/api/v1/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'POS Mesita Demo — API Docs',
    swaggerOptions: { persistAuthorization: true },
  })
);

// Raw OpenAPI JSON
app.get('/sistema/api/v1/openapi.json', (req, res) => {
  res.json(swaggerSpec);
});

// ---------------------------------------------------------------------------
// API routes (protected by API key)
// ---------------------------------------------------------------------------
app.get('/sistema/api/v1/health/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pos-mesita-demo',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.use('/sistema/api/v1', requireApiKey, apiV1Router);

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// ---------------------------------------------------------------------------
// Error handling (must be last)
// ---------------------------------------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------
const PORT = env.PORT;

async function start() {
  try {
    await connectDatabase();
    await ensurePlatformReady();
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`POS Mesita Demo running on port ${PORT}`);
      logger.info(`Swagger UI: http://localhost:${PORT}/sistema/api/v1/docs`);
      logger.info(`Dashboard:  http://localhost:${PORT}/index.html`);
      logger.info(`API base:   http://localhost:${PORT}/sistema/api/v1/`);
    });
  } catch (err) {
    logger.error('Startup failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = app; // exported for tests
module.exports.start = start;
