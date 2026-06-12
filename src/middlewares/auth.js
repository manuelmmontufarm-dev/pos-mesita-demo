'use strict';

const env = require('../config/env');
const { getTenantPrisma, runWithRequestContext } = require('../config/database');
const platformService = require('../services/platformService');

/**
 * Auth middleware.
 *
 * Supported modes:
 * - Authorization: Bearer <session> for logged-in restaurant users
 * - Authorization: Token <API_KEY> for legacy Contifico/demo API access
 *
 * Every endpoint except health, auth, docs and MesitaQR webhook requires auth.
 */
async function requireApiKey(req, res, next) {
  if (
    req.path === '/health/' ||
    req.path === '/mesitaqr/webhook/' ||
    req.path.startsWith('/auth/') ||
    req.path === '/auth' ||
    req.path.startsWith('/docs') ||
    req.path === '/openapi.json'
  ) {
    return next();
  }

  try {
    const authHeader = req.headers['authorization'] || '';
    const [scheme, token] = authHeader.split(' ');

    if (!scheme || !token) {
      return res.status(401).json({
        error: 'Unauthorized',
        detail: 'Missing Authorization header. Use Bearer <session> or Token <API_KEY>.',
      });
    }

    let authContext;
    if (scheme === 'Bearer') {
      authContext = await platformService.authenticateSession(token);
    } else if (scheme === 'Token' && token === env.API_KEY) {
      if (env.NODE_ENV === 'test') {
        return runWithRequestContext({ auth: { legacyApiKey: true } }, next);
      }
      authContext = await platformService.getDemoAuthContext();
    } else {
      return res.status(401).json({
        error: 'Unauthorized',
        detail: 'Invalid credentials.',
      });
    }

    req.auth = authContext;
    const prisma = getTenantPrisma(authContext.tenantSchema);
    return runWithRequestContext({
      prisma,
      auth: authContext,
      restaurant: authContext.restaurant,
      tenantSchema: authContext.tenantSchema,
    }, next);
  } catch (err) {
    const status = err.statusCode || err.status || 500;
    return res.status(status).json({
      error: status === 401 ? 'Unauthorized' : err.message,
      detail: env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
}

module.exports = { requireApiKey };
