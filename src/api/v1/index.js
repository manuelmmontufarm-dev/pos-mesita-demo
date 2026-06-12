'use strict';

/**
 * API v1 router — mounts all resource routes under /sistema/api/v1/
 * All routes are protected by requireApiKey middleware (applied in app.js).
 */

const express = require('express');
const router = express.Router();

const mesaRouter = require('./mesa');
const ordenRouter = require('./orden');
const documentoRouter = require('./documento');
const personaRouter = require('./persona');
const productoRouter = require('./producto');
const mesitaqrRouter = require('./mesitaqr');
const authRouter = require('./auth');
const restaurantRouter = require('./restaurant');

// Health check (unauthenticated)
router.get('/health/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pos-mesita-demo',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Resource routes
router.use('/auth', authRouter);
router.use('/restaurant', restaurantRouter);
router.use('/mesa', mesaRouter);
router.use('/orden', ordenRouter);
router.use('/documento', documentoRouter);
router.use('/persona', personaRouter);
router.use('/producto', productoRouter);
router.use('/mesitaqr', mesitaqrRouter);

module.exports = router;
