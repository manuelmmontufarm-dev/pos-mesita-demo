# POS Mesita Demo — Claude Code Context

## What This Is
A demo REST API for a restaurant POS system, built to test MesitaQR (Paga Ya) QR payment integration and Contifico (Ecuador ERP) compatibility.

**Live URL:** https://pos-mesita-demo-production.up.railway.app  
**Swagger UI:** https://pos-mesita-demo-production.up.railway.app/sistema/api/v1/docs  
**Auth:** browser users use email/password sessions; legacy API-key access is stored only in environment variables.

## Stack
- Node.js + Express (plain JavaScript, CommonJS)
- Prisma ORM + PostgreSQL (Supabase)
- Deployed on Railway (auto-deploys on push to `main`)

## Project Structure
```
src/
├── api/v1/          ← Route handlers (mesa, orden, documento, persona, producto, mesitaqr)
├── services/        ← Business logic
├── adapters/        ← contificoAdapter.js, mesitaqrAdapter.js
├── middlewares/     ← auth.js (Bearer session + legacy Token auth), errorHandler.js, logger.js
├── config/          ← env.js, constants.js, database.js
└── app.js           ← Express entry point
prisma/
└── schema.prisma    ← Platform + tenant POS database schema
scripts/seed.js      ← Seeds categories, products, tables, demo customer
tests/               ← Jest + Supertest (Prisma mocked)
```

## Key Domain Concepts
- **Mesa** — restaurant table; estados: L=Libre, O=Ocupada, P=Pagando, C=Cerrada
- **Orden** — open order on a table; estados: A=Abierta, C=Cerrada, X=Cancelada
- **Documento** — PRE (pre-factura) or FAC (factura); Contifico-compatible field names
- **MesitaqrSession** — QR payment session; estados: pendiente, pagado, expirado
- **IVA = 15%** (Ecuador, Ley 004, April 2024)
- **Servicio = 10%** service charge, configurable per restaurant

## Auth
Browser users log in with email/password and then use `Authorization: Bearer <session>`.
Legacy integrations may still use `Authorization: Token <API_KEY>`; do not commit real API keys.

## Local Development
```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and API_KEY
npx prisma generate
npm run dev
```

To reset and reseed the database:
```bash
DATABASE_URL="..." npx prisma db push
DATABASE_URL="..." node scripts/seed.js
```

## Deployment
- Push to `main` → Railway auto-deploys
- Database is on Supabase (session pooler, port 5432)
- `DATABASE_URL` uses port 5432 (session pooler) for local commands
- Railway `DATABASE_URL` uses port 6543 (transaction pooler)

## Environment Variables
| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase connection string |
| `API_KEY` | Auth token for all API calls |
| `APP_BASE_URL` | Public URL (Railway domain) |
| `MESITAQR_WEBHOOK_SECRET` | HMAC secret for webhook verification |
| `NODE_ENV` | `production` on Railway |
| `CONTIFICO_ENABLED` | Set `true` to forward to live Contifico API |
| `CONTIFICO_TOKEN` | Live Contifico API token |

## Important Files
- `src/adapters/contificoAdapter.js` — Swap `CONTIFICO_ENABLED=true` to go live
- `src/services/mesitaqrService.js` — Full QR payment flow + webhook handler
- `src/config/constants.js` — IVA_RATE, SERVICE_RATE, estado codes
- `docs/mesitaqr-integration.md` — 8-step curl walkthrough
- `docs/contifico-compatibility.md` — Field mapping + live swap guide

## Running Tests
```bash
npm test   # Jest + Supertest, no database needed (Prisma is mocked)
```
