# POS Mesita Demo Production Handoff

Last updated: 2026-06-11

## Production URLs

- App: `https://pos-mesita-demo-production.up.railway.app/`
- API base: `https://pos-mesita-demo-production.up.railway.app/sistema/api/v1`
- Swagger/OpenAPI: `https://pos-mesita-demo-production.up.railway.app/sistema/api/v1/docs`
- Health check: `https://pos-mesita-demo-production.up.railway.app/sistema/api/v1/health/`

## Source Control

- GitHub repo: `manuelmmontufarm-dev/pos-mesita-demo`
- Production branch: `main`
- Railway auto-deploys from `main`.
- PR #1, `feat/pos-frontend-rewrite`, was merged into `main`.

## Railway

- Project: `empathetic-success`
- Environment: `production`
- Service: `pos-mesita-demo`
- Builder: Dockerfile
- Public domain: `pos-mesita-demo-production.up.railway.app`
- Runtime port: Railway injects `PORT`; current deployment uses `8080`.

### Required Railway Variables

Do not commit secret values to git. Store them in Railway Variables.

- `DATABASE_URL`: Supabase PostgreSQL pooler URL.
- `API_KEY`: API token for `Authorization: Token <API_KEY>`.
- `NODE_ENV`: `production`
- `APP_BASE_URL`: production app URL.
- `MESITAQR_BASE_URL`: `https://api.pagaya.ec`
- `MESITAQR_WEBHOOK_SECRET`: HMAC secret for MesitaQR webhook verification.
- `MESITAQR_QR_EXPIRY_MINUTES`: usually `15`.
- `CONTIFICO_BASE_URL`: `https://api.contifico.com/sistema/api/v1`
- `CONTIFICO_ENABLED`: `false` for demo/mock mode, `true` to forward FAC documents to Contifico.
- `CONTIFICO_TOKEN`: required only when `CONTIFICO_ENABLED=true`.
- `RESTAURANT_RUC`, `RESTAURANT_RAZON_SOCIAL`, `RESTAURANT_DIRECCION`: printed on demo receipts/invoices.

Do not hard-code the current production `API_KEY` in browser code. The browser uses login sessions for normal restaurant access; the legacy API key remains for integrations and emergency demo access only.

## Supabase

- Supabase project URL: `https://gvellbrujylqhemhgfnx.supabase.co`
- Database: PostgreSQL.
- Platform/login tables live in schema `public`.
- Restaurant POS data lives in per-restaurant schemas such as `tenant_demo`.
- Railway connects through the Supabase transaction pooler on port `6543`.
- The app automatically adds `pgbouncer=true&connection_limit=1` for Supabase transaction-pooler URLs so Prisma works reliably.

### Platform Tables

- `platform_users`: login users.
- `platform_restaurants`: tenant registry, restaurant details, service-charge settings.
- `platform_memberships`: user roles per restaurant (`owner`, `manager`, `server`).
- `platform_sessions`: hashed browser session tokens.

### Tenant POS Tables

- `mesas`: restaurant tables and their current status.
- `ordenes`: open/closed/cancelled table orders; includes `comensales` for diners count.
- `orden_detalles`: order line items.
- `productos`: menu products.
- `categorias`: product categories.
- `personas`: customers.
- `documentos`: PRE/FAC documents.
- `documento_detalles`: document line snapshots.
- `cobros`: payment rows for documents.
- `mesitaqr_sessions`: QR payment sessions.
- `webhook_logs`: webhook processing records.

## Data Flow

1. The browser loads the POS from Railway.
2. API calls go to `/sistema/api/v1/*` on the same Railway domain.
3. Browser users log in with `Authorization: Bearer <session>`.
4. Legacy integrations can still use `Authorization: Token <API_KEY>`, which maps to `Demo Restaurant`.
5. The auth middleware picks the restaurant tenant schema.
6. Express services use Prisma Client pointed at that tenant schema.
7. Prisma writes to Supabase PostgreSQL.
8. The POS reloads data by reading the same Supabase-backed API endpoints.

This means table status, orders, order items, documents, payments, customers, products, and diners count are stored in Supabase, not only in the browser.

## Important Behavior

- Mesa states:
  - `L`: Desocupada/libre
  - `O`: Ocupada
  - `P`: Pagando
  - `C`: Cerrada
- Orden states:
  - `A`: Abierta
  - `C`: Cerrada
  - `X`: Cancelada
- Precuenta is informational and should not close the mesa.
- Factura is definitive and should close the sale.
- `ordenes.comensales` stores the number of diners for an active order.
- `platform_restaurants.serviceChargeEnabled` controls whether the 10% service line is included in totals and printouts.
- Card/transfer payments cannot apply more than the account balance; any extra must be recorded as `cobros.propina`.
- Cash can be received above the balance only as change/vuelto; the stored `cobros.monto` stays capped to the balance.

## Production Smoke Tests

Health, no auth:

```bash
curl https://pos-mesita-demo-production.up.railway.app/sistema/api/v1/health/
```

List mesas, auth required:

```bash
curl -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  https://pos-mesita-demo-production.up.railway.app/sistema/api/v1/mesa/
```

Legacy API-key access still works for the demo tenant:

```bash
curl -H "Authorization: Token YOUR_API_KEY" \
  https://pos-mesita-demo-production.up.railway.app/sistema/api/v1/mesa/
```

Check OpenAPI server metadata:

```bash
curl https://pos-mesita-demo-production.up.railway.app/sistema/api/v1/openapi.json
```

## Local Development

```bash
npm install
cp .env.example .env
npx prisma generate
npm run dev
```

Seed demo data:

```bash
node scripts/seed.js
```

Run tests:

```bash
npm test
```

## Security Notes

- Rotate the Supabase database password if it was shared outside Railway/Supabase.
- Rotate `MESITAQR_WEBHOOK_SECRET` before live external integrations.
- Rotate `API_KEY` before real production usage.
- Do not commit full database URLs, passwords, real Contifico tokens, or live webhook secrets.
