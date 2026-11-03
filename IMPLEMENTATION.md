# VM Control — implementation checklist

## Scaffold
- [x] Next.js + TypeScript + Tailwind + ESLint
- [x] Prisma + PostgreSQL schema/migrations
- [x] Docker Compose + Dockerfile + .env.example
- [x] Auth (sessions, bootstrap, throttling)

## Domain
- [x] Servers / Companies CRUD
- [x] Machines (create/edit/migrate/filter/search/pagination)
- [x] Proxies + rotate (atomic, history, reuse warning helper)
- [x] Wipeout checklist (template snapshot, N/A, complete→archive)
- [x] Archive (read-only)
- [x] Settings (template, password, timezone, Proxmox status)
- [x] Activity/audit events
- [x] Proxmox mock adapter (“Not configured”)

## Quality
- [x] Idempotent seed
- [x] Integration tests (13 invariants) — all passed
- [x] Typecheck / lint / production build — passed
- [x] README + backup/restore
- [x] Handoff + screenshots
