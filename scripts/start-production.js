'use strict';

const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { normalizeDatabaseUrl } = require('../src/config/database');

async function ensureProductionSchema() {
  const prisma = new PrismaClient({
    datasources: {
      db: { url: normalizeDatabaseUrl(process.env.DATABASE_URL) },
    },
  });
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE IF EXISTS "ordenes" ADD COLUMN IF NOT EXISTS "comensales" INTEGER NOT NULL DEFAULT 0');
    await prisma.$executeRawUnsafe('ALTER TABLE IF EXISTS "personas" ADD COLUMN IF NOT EXISTS "activo" BOOLEAN NOT NULL DEFAULT true');
    await prisma.$executeRawUnsafe('ALTER TABLE IF EXISTS "cobros" ADD COLUMN IF NOT EXISTS "propina" DECIMAL(10,2) NOT NULL DEFAULT 0');
    await prisma.$executeRawUnsafe('ALTER TABLE IF EXISTS "cobros" ADD COLUMN IF NOT EXISTS "procesador" TEXT');
    await prisma.$executeRawUnsafe('ALTER TABLE IF EXISTS "cobros" ADD COLUMN IF NOT EXISTS "detalle" TEXT');
    await prisma.$executeRawUnsafe('ALTER TABLE IF EXISTS "webhook_logs" ADD COLUMN IF NOT EXISTS "error" TEXT');
    console.info('[DB] Production schema ready');
  } finally {
    await prisma.$disconnect();
  }
}

function startServer() {
  const child = spawn('node', ['src/app.js'], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

ensureProductionSchema()
  .then(startServer)
  .catch((error) => {
    console.error('[DB] Failed to prepare production schema:', error);
    process.exit(1);
  });
