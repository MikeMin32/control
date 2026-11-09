# VM Control

Private inventory and lifecycle tool for virtual machines across multiple Proxmox servers.

**v1 automation boundary:** proxy rotate and wipeout checklists are database/attestation only. The app does **not** SSH, edit GOST, cancel provider subscriptions, delete email accounts, or destroy VMs. Optional Proxmox integration is read-only.

## Stack

Next.js (TypeScript) · Tailwind · PostgreSQL · Prisma · Docker Compose

## Quick start (local)

### 1. Database

```bash
docker run -d --name vmcontrol-db \
  -e POSTGRES_USER=vmcontrol \
  -e POSTGRES_PASSWORD=vmcontrol \
  -e POSTGRES_DB=vmcontrol \
  -p 127.0.0.1:5434:5432 \
  postgres:16-alpine
```

### 2. Environment

```bash
cp .env.example .env
# Edit SESSION_SECRET and DATABASE_URL as needed
```

### 3. Migrate, admin, seed

```bash
npm install
npx prisma migrate deploy
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='your-long-password' npm run bootstrap:admin
npm run db:seed   # optional demo data (idempotent; NEVER for production)
```

### 4. Run

```bash
npm run dev
# http://127.0.0.1:3001
```

## Production (Docker Compose)

Intended for a **private** host (WireGuard / SSH tunnel / private reverse proxy). Compose binds the app to `127.0.0.1:3001` only. Postgres is **not** published.

### Production does not auto-seed

Container start runs `prisma migrate deploy` then `next start` only. Demo `db:seed` is never invoked. Create the first admin with `bootstrap:admin` after first boot.

### Exact start

```bash
cp .env.example .env
# Required: SESSION_SECRET, POSTGRES_PASSWORD (strong values)
# Set APP_URL to the URL users will use (origin checks)

# Record version before replace (git SHA / image tag)
git rev-parse HEAD

# Backup existing DB first if upgrading (see Backup / restore)
# export DATABASE_URL=... && ./scripts/backup.sh

docker compose up --build -d

# Wait for health
curl -fsS http://127.0.0.1:3001/api/health

# First deploy only — create admin (no demo seed)
docker compose exec app sh -c \
  'ADMIN_EMAIL=you@example.com ADMIN_PASSWORD="…" npx tsx scripts/bootstrap-admin.ts'
```

- App: `http://127.0.0.1:3001` (reach via WireGuard / tunnel)
- Health: `GET /api/health` → `{ ok: true, db: "up" }`
- Migrations apply on every container start (`migrate deploy`). **Code revert does not reverse migrations** — restore from backup if you must roll back schema.

### Upgrade / replace

1. `./scripts/backup.sh` (or `docker compose exec db pg_dump …`) and note current git SHA / image id  
2. `docker compose up --build -d` (build → migrate → start)  
3. Verify `/api/health`, login, and an authenticated page (Machines / Proxies)  
4. Do **not** run `db:seed` against production

### Rollback

- **App only:** redeploy the previous image/SHA; DB stays as migrated.  
- **Schema issue:** restore the pre-upgrade dump with `./scripts/restore.sh` (destructive to current DB state). Migrations are forward-only.

### Dev → prod data

Never point prod at a shared/dev database. Copy data only with an **explicit** backup + restore into the production Postgres volume.

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Dev server on `127.0.0.1:3001` |
| `npm run build` / `npm start` | Local prod build & serve (`.next-build`, port 3001) |
| `npm run start:prod` | Container/prod serve (`.next`, `0.0.0.0:$PORT`) |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Integration tests (business invariants) |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Idempotent **demo** seed — not for production |
| `npm run bootstrap:admin` | Create/update admin (password via env, never logged) |
| `./scripts/backup.sh` | `pg_dump` → gzip |
| `./scripts/restore.sh <file.sql.gz>` | Restore dump |

## Pages

- **Machines** — inventory, server tabs, search/filter, drawer (overview / proxy history / activity / setup)
- **Proxies** — VM / Dolphin tabs, billing, purchase-source Dolphin, connection proxies
- **Dolphin** — accounts, connection proxy, linked VM, wallets
- **Wipeout** — closure checklists (template snapshotted at start)
- **Archive** — read-only closed records
- **Settings** — servers, companies, templates, password, timezone, Proxmox status

## Optional Proxmox (read-only)

Set in `.env`:

```
PROXMOX_ENABLED=true
PROXMOX_HOST=https://pve.example:8006
PROXMOX_TOKEN_ID=user@pam!token
PROXMOX_TOKEN_SECRET=...
PROXMOX_TLS_INSECURE=false
```

Without these, the UI shows **Proxmox: Not configured**. TLS is validated by default.

## Backup / restore

```bash
export DATABASE_URL=postgresql://vmcontrol:vmcontrol@127.0.0.1:5434/vmcontrol
./scripts/backup.sh
./scripts/restore.sh ./backups/vmcontrol-….sql.gz
```

Compose (example):

```bash
docker compose exec -T db pg_dump -U vmcontrol vmcontrol | gzip > ./backups/vmcontrol-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
```

## Security notes

- No default production credentials — use `bootstrap:admin`.
- Compose requires `SESSION_SECRET` and `POSTGRES_PASSWORD` (no weak defaults).
- Server-side sessions (HTTP-only cookies), origin checks on mutations, login throttling.
- Designed for private (e.g. WireGuard) access; login is still required.
- Secrets stay in env (`.env` is gitignored); never exposed in API errors or the UI.

## Tests

Use an isolated database (recommended name contains `vmcontrol_test`):

```bash
docker exec vmcontrol-db psql -U vmcontrol -d postgres -c 'CREATE DATABASE vmcontrol_test;'
DATABASE_URL=postgresql://vmcontrol:vmcontrol@127.0.0.1:5434/vmcontrol_test npx prisma migrate deploy
npm test
```

## Design

Light **SLATE** desktop utility: off-white canvas, gray sidebar, pale mint primary actions, status dots with labels. See `IMPLEMENTATION.md` for build status.
