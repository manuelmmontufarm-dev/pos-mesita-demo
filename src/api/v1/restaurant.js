'use strict';

const express = require('express');
const router = express.Router();
const platformService = require('../../services/platformService');
const { asyncHandler } = require('../../middlewares/errorHandler');

router.get('/settings', asyncHandler(async (req, res) => {
  const restaurantId = req.auth?.restaurant?.id;
  if (!restaurantId) return res.status(401).json({ error: 'Unauthorized' });
  const settings = await platformService.getSettings(restaurantId);
  res.json(settings);
}));

router.patch('/settings', asyncHandler(async (req, res) => {
  const restaurantId = req.auth?.restaurant?.id;
  if (!restaurantId) return res.status(401).json({ error: 'Unauthorized' });
  const settings = await platformService.updateSettings(restaurantId, req.body || {});
  res.json(settings);
}));

router.post('/setup', asyncHandler(async (req, res) => {
  const restaurantId = req.auth?.restaurant?.id;
  if (!restaurantId) return res.status(401).json({ error: 'Unauthorized' });
  const restaurant = await platformService.completeSetup(restaurantId, req.body || {});
  res.json(restaurant);
}));

module.exports = router;
