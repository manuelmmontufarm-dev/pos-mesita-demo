'use strict';

const { PrismaClient } = require('@prisma/client');
const { AsyncLocalStorage } = require('async_hooks');
const env = require('./env');

// Platform client talks to public schema. Tenant clients talk to per-restaurant schemas.
let platformPrisma;
const tenantClients = new Map();
const requestContext = new AsyncLocalStorage();

function normalizeDatabaseUrl(url, schemaName) {
  if (!url) return url;

  try {
    const parsed = new URL(url);
    const isSupabasePooler =
      parsed.hostname.endsWith('.pooler.supabase.com') && parsed.port === '6543';

    if (isSupabasePooler) {
      if (!parsed.searchParams.has('pgbouncer')) {
        parsed.searchParams.set('pgbouncer', 'true');
      }
      if (!parsed.searchParams.has('connection_limit')) {
        parsed.searchParams.set('connection_limit', '1');
      }
    }

    if (schemaName) {
      parsed.searchParams.set('schema', schemaName);
    }

    return parsed.toString();
  } catch (_) {
    return url;
  }
}

function createPrismaClient(schemaName) {
  return new PrismaClient({
    datasources: {
      db: { url: normalizeDatabaseUrl(env.DATABASE_URL, schemaName) },
    },
    log: env.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'],
  });
}

function getPlatformPrisma() {
  if (!platformPrisma) {
    platformPrisma = new PrismaClient({
      datasources: {
        db: { url: normalizeDatabaseUrl(env.DATABASE_URL) },
      },
      log: env.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
    });
  }
  return platformPrisma;
}

function getTenantPrisma(schemaName) {
  if (!schemaName) return getPlatformPrisma();
  if (!tenantClients.has(schemaName)) {
    tenantClients.set(schemaName, createPrismaClient(schemaName));
  }
  return tenantClients.get(schemaName);
}

function getPrisma() {
  const ctx = requestContext.getStore();
  return ctx?.prisma || getPlatformPrisma();
}

function getRequestContext() {
  return requestContext.getStore() || {};
}

function runWithRequestContext(ctx, next) {
  return requestContext.run(ctx || {}, next);
}

async function connectDatabase() {
  const client = getPlatformPrisma();
  try {
    await client.$connect();
    console.info('[DB] Connected to PostgreSQL via Prisma');
    return client;
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    throw err;
  }
}

async function disconnectDatabase() {
  if (platformPrisma) {
    await platformPrisma.$disconnect();
    platformPrisma = null;
    console.info('[DB] Disconnected from PostgreSQL');
  }
  for (const client of tenantClients.values()) await client.$disconnect();
  tenantClients.clear();
}

module.exports = {
  getPrisma,
  getPlatformPrisma,
  getTenantPrisma,
  getRequestContext,
  runWithRequestContext,
  connectDatabase,
  disconnectDatabase,
  normalizeDatabaseUrl,
};
