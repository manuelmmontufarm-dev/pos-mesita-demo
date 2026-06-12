'use strict';

const express = require('express');
const router = express.Router();
const platformService = require('../../services/platformService');
const { asyncHandler } = require('../../middlewares/errorHandler');

router.post('/register', asyncHandler(async (req, res) => {
  const result = await platformService.registerRestaurant(req.body || {});
  res.status(201).json(result);
}));

router.post('/login', asyncHandler(async (req, res) => {
  const result = await platformService.login(req.body || {});
  res.json(result);
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const token = bearerToken(req);
  const result = await platformService.logout(token);
  res.json(result);
}));

router.get('/me', asyncHandler(async (req, res) => {
  const token = bearerToken(req);
  const auth = await platformService.authenticateSession(token);
  res.json(auth);
}));

function bearerToken(req) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  return scheme === 'Bearer' ? token : '';
}

module.exports = router;
