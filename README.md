# pos-mesita-demo

Demo POS REST API for **MesitaQR / Paga Ya** integration testing — deployed on Railway, compatible with Contifico's API v1/v2 schema.

[![CI](https://github.com/jdonoso1/pos-mesita-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/jdonoso1/pos-mesita-demo/actions)

---

## What This Is

A lightweight Express API that:

- Exposes a complete restaurant POS (`mesa`, `orden`, `documento`, `persona`, `producto`)
- Implements the full MesitaQR QR payment flow with HMAC-verified webhooks
- Uses Contifico's exact field names and response envelope throughout
- Auto-creates a FAC documento when a QR payment webhook arrives
- Mocks SRI Ecuador electronic invoice authorization (swap with real Contifico in one env var)

**Tech stack:** Node.js · Express · Prisma · PostgreSQL (Supabase) · Railway

---

## Architecture

```
src/
├── api/v1/          ← Thin route handlers (one file per resource)
├── services/        ← Business logic — adapter-agnostic
├── adapters/        ← Schema transformers (swap here for live Contifico/MesitaQR)
├── middlewares/     ← Auth, error handler, logger
├── config/          ← env, constants, DB
└── app.js           ← Express setup + Swagger
```

The entire Contifico wiring lives in `src/adapters/contificoAdapter.js`.
Set `CONTIFICO_ENABLED=true` to go live — no service changes needed.
See [`docs/contifico-compatibility.md`](docs/contifico-compatibility.md) for the full swap guide.

---

## Quick Start (Local)

```bash
# 1. Clone and install
git clone https://github.com/jdonoso1/pos-mesita-demo
cd pos-mesita-demo
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and API_KEY

# 3. Run DB migrations and seed
npx prisma migrate deploy
node scripts/seed.js

# 4. Start
npm run dev
```

Open:
- Dashboard: http://localhost:3000
- Swagger UI: http://localhost:3000/sistema/api/v1/docs
- Health: http://localhost:3000/sistema/api/v1/health/

**With Docker:**
```bash
cp .env.example .env
docker compose up --build
```

---

## Deploying to Railway (Free Tier)

### Step 1 — Push code to GitHub

```bash
# First time setup — you need a GitHub Personal Access Token (PAT)
# Get one at: https://github.com/settings/tokens/new
# Scopes needed: repo (full control of private repositories)

# Initialize and push
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/jdonoso1/pos-mesita-demo.git
git push -u origin main
```

### Step 2 — Set up the database on Supabase

1. Go to https://supabase.com → New project → note the password
2. Settings → Database → Connection string → URI → copy it
3. This is your `DATABASE_URL`

### Step 3 — Deploy on Railway

1. Go to https://railway.app → New Project → Deploy from GitHub repo
2. Select `jdonoso1/pos-mesita-demo`
3. Railway detects the `Dockerfile` automatically
4. Add environment variables (Settings → Variables):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Supabase connection string |
| `API_KEY` | A strong random string (your API key) |
| `APP_BASE_URL` | Your Railway public URL (e.g. `https://pos-mesita-demo.up.railway.app`) |
| `MESITAQR_WEBHOOK_SECRET` | Any strong random secret |
| `NODE_ENV` | `production` |

5. Railway auto-deploys on every push to `main`

### Step 4 — Test the live deployment

```bash
export URL=https://pos-mesita-demo.up.railway.app
export KEY=your_api_key_here

# Health check (no auth required)
curl $URL/sistema/api/v1/health/

# List mesas
curl $URL/sistema/api/v1/mesa/ -H "Authorization: Token $KEY"

# Seed the database
# (run this once from your local machine pointing to the prod DATABASE_URL)
DATABASE_URL="your_supabase_url" node scripts/seed.js
```

---

## API Endpoints

All endpoints require `Authorization: Token <API_KEY>`.

Base path: `/sistema/api/v1/`

| Method | Path | Description |
|---|---|---|
| GET | `/mesa/` | List tables |
| GET | `/mesa/:id/` | Table + active order |
| POST | `/mesa/` | Create table |
| PATCH | `/mesa/:id/` | Update table state |
| GET | `/orden/` | List orders |
| GET | `/orden/:id/` | Order with items |
| POST | `/orden/` | Open order on table |
| POST | `/orden/:id/detalle/` | Add item to order |
| DELETE | `/orden/:id/detalle/:detalleId/` | Remove item |
| PATCH | `/orden/:id/` | Update order |
| GET | `/orden/:id/totales/` | Calculate totals (15% IVA + 10% servicio) |
| GET | `/documento/` | List invoices/pre-bills |
| GET | `/documento/:id/` | Invoice detail with url_ride + url_xml |
| POST | `/documento/` | Create PRE or FAC |
| PATCH | `/documento/:id/` | Update state or add cobro |
| GET | `/persona/` | List customers |
| POST | `/persona/` | Create customer |
| PATCH | `/persona/:id/` | Update customer |
| GET | `/producto/` | List menu items |
| POST | `/producto/` | Create menu item |
| POST | `/mesitaqr/solicitar-pago/` | Initiate QR payment |
| GET | `/mesitaqr/estado/:session_id/` | Poll payment status |
| POST | `/mesitaqr/webhook/` | Receive Paga Ya payment confirmation |
| GET | `/health/` | Health check (no auth) |

Full interactive docs at `/sistema/api/v1/docs` (Swagger UI).

---

## Key Design Decisions

**IVA 15%** — Ecuador's current rate since April 2024. All calculations use `subtotal_15`.

**Contifico field names** — `fecha_emision`, `tipo_documento`, `razon_social`, `cobros`, `detalles` match Contifico v2 exactly. Switching to live Contifico = set one env var.

**Stateless** — No in-memory state; Railway's free tier can sleep/wake without data loss.

**HMAC webhooks** — `X-MesitaQR-Signature` verified with `crypto.timingSafeEqual` to prevent timing attacks.

---

## Running Tests

```bash
npm test
```

Tests use Jest + Supertest with mocked Prisma — no database required.

---

## Further Reading

- [Production Handoff](docs/production-handoff.md)
- [Deployment Guide (GitHub + Supabase + Railway)](docs/deployment-guide.md)
- [MesitaQR Integration Guide](docs/mesitaqr-integration.md)
- [Contifico Compatibility Guide](docs/contifico-compatibility.md)
- [Full API Reference](docs/api-reference.md)
