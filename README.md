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
npm run db:seed   # optional demo data (idempotent; not for production)
```

### 4. Run

```bash
npm run dev
# http://127.0.0.1:3001
```

## Docker Compose

```bash
cp .env.example .env
# set SESSION_SECRET
docker compose up --build -d
```

- Web: `http://127.0.0.1:3001`
- Postgres is **not** published publicly (compose network only). Expose the app via WireGuard or a private reverse proxy.

On container start the app runs `prisma migrate deploy` then `next start`.

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Dev server on `127.0.0.1:3001` |
| `npm run build` / `npm start` | Production build & serve |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Integration tests (13 invariants) |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Idempotent demo seed |
| `npm run bootstrap:admin` | Create/update admin (password via env, never logged) |
| `./scripts/backup.sh` | `pg_dump` → gzip |
| `./scripts/restore.sh <file.sql.gz>` | Restore dump |

## Pages

- **Machines** — inventory, server tabs, search/filter, drawer (overview / proxy history / activity)
- **Proxies** — inventory, billing status, unresolved cancellations
- **Wipeout** — closure checklists (template snapshotted at start)
- **Archive** — read-only closed records
- **Settings** — servers, companies, template, password, timezone, Proxmox status

## Optional Proxmox (read-only)

Set in `.env`:

```
PROXMOX_ENABLED=true
PROXMOX_HOST=https://pve.example:8006
PROXMOX_TOKEN_ID=user@pam!token
PROXMOX_TOKEN_SECRET=...
PROXMOX_TLS_INSECURE=false
```

Without these, the UI shows **Proxmox: Not configured**. TLS is validated by default; use a trusted CA rather than disabling verification when possible. Host `mock.proxmox.local` is treated as a connected mock for tests.

## Backup / restore

```bash
export DATABASE_URL=postgresql://vmcontrol:vmcontrol@127.0.0.1:5434/vmcontrol
./scripts/backup.sh
./scripts/restore.sh ./backups/vmcontrol-….sql.gz
```

## Security notes

- No default production credentials — use `bootstrap:admin`.
- Server-side sessions (HTTP-only cookies), origin checks on mutations, login throttling.
- Designed for private (e.g. WireGuard) access; login is still required.
- Secrets stay in env; never exposed in API errors or the UI.

## Tests

Use an isolated database (recommended name contains `vmcontrol_test`):

```bash
docker exec vmcontrol-db psql -U vmcontrol -d postgres -c 'CREATE DATABASE vmcontrol_test;'
DATABASE_URL=postgresql://vmcontrol:vmcontrol@127.0.0.1:5434/vmcontrol_test npx prisma migrate deploy
DATABASE_URL=postgresql://vmcontrol:vmcontrol@127.0.0.1:5434/vmcontrol_test npm test
```

## Design

Light **SLATE** desktop utility: off-white canvas, gray sidebar, pale mint primary actions, status dots with labels. See `IMPLEMENTATION.md` for build status.
