-- Platform login + restaurant tenant registry.
CREATE TABLE IF NOT EXISTS "platform_users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_users_email_key" ON "platform_users"("email");

CREATE TABLE IF NOT EXISTS "platform_restaurants" (
  "id" TEXT NOT NULL,
  "tenantSchema" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "ruc" TEXT,
  "address" TEXT,
  "city" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "serviceChargeEnabled" BOOLEAN NOT NULL DEFAULT true,
  "serviceChargeRate" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
  "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_restaurants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_restaurants_tenantSchema_key" ON "platform_restaurants"("tenantSchema");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_restaurants_slug_key" ON "platform_restaurants"("slug");

CREATE TABLE IF NOT EXISTS "platform_memberships" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'server',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_memberships_userId_restaurantId_key" ON "platform_memberships"("userId", "restaurantId");
CREATE INDEX IF NOT EXISTS "platform_memberships_restaurantId_idx" ON "platform_memberships"("restaurantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_memberships_userId_fkey'
  ) THEN
    ALTER TABLE "platform_memberships"
      ADD CONSTRAINT "platform_memberships_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_memberships_restaurantId_fkey'
  ) THEN
    ALTER TABLE "platform_memberships"
      ADD CONSTRAINT "platform_memberships_restaurantId_fkey"
      FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "platform_sessions" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_sessions_tokenHash_key" ON "platform_sessions"("tokenHash");
CREATE INDEX IF NOT EXISTS "platform_sessions_userId_idx" ON "platform_sessions"("userId");
CREATE INDEX IF NOT EXISTS "platform_sessions_restaurantId_idx" ON "platform_sessions"("restaurantId");
CREATE INDEX IF NOT EXISTS "platform_sessions_expiresAt_idx" ON "platform_sessions"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_sessions_userId_fkey'
  ) THEN
    ALTER TABLE "platform_sessions"
      ADD CONSTRAINT "platform_sessions_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_sessions_restaurantId_fkey'
  ) THEN
    ALTER TABLE "platform_sessions"
      ADD CONSTRAINT "platform_sessions_restaurantId_fkey"
      FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Payment metadata used by the POS payment modal.
ALTER TABLE IF EXISTS "personas" ADD COLUMN IF NOT EXISTS "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE IF EXISTS "cobros" ADD COLUMN IF NOT EXISTS "propina" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS "cobros" ADD COLUMN IF NOT EXISTS "procesador" TEXT;
ALTER TABLE IF EXISTS "cobros" ADD COLUMN IF NOT EXISTS "detalle" TEXT;
ALTER TABLE IF EXISTS "webhook_logs" ADD COLUMN IF NOT EXISTS "error" TEXT;
