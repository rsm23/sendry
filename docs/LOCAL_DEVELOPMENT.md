# Local development

This guide starts the complete Sendry development stack with durable demo data. The application runs on the host for fast reloads; PostgreSQL, Redis, MinIO, and ClamAV run in Docker.

## Requirements

- Node.js 24 or newer
- pnpm 11 or newer (Corepack is fine)
- Docker Desktop with Docker Compose

## First run on a fresh checkout

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev:setup
pnpm dev
```

Open <http://localhost:5173> and sign in with:

```text
Email: qa@sendry.local
Password: TestPass123!
```

`pnpm dev:setup` waits for the local infrastructure, applies every pending PostgreSQL migration, and seeds both databases. It is safe to run again: the demo records use stable IDs and are updated or skipped without deleting records you created.

The seed covers both data stores because Sendry is in a staged database transition:

- SQLite (`DATABASE_PATH`) owns authentication and the legacy email product areas.
- PostgreSQL (`DATABASE_URL`) owns the native multi-channel contacts, campaigns, connections, conversations, and inbox data.

The local stream provider exercises delivery code without sending messages to real recipients.

## Everyday startup

The Docker volumes and SQLite file retain data between runs. After the first setup:

```bash
pnpm dev:services
pnpm dev
```

To stop the infrastructure while keeping all data:

```bash
docker compose stop postgres redis minio clamav
```

## Migrations and seed data

After pulling a change that adds a migration, run:

```bash
pnpm db:migrate
```

To restore or refresh the stable demo records without erasing other local data:

```bash
pnpm db:seed
```

To do both in order:

```bash
pnpm db:setup
```

Create a new migration only after changing `server/multichannel/schema.ts`:

```bash
pnpm db:generate
```

Review the generated SQL under `drizzle/`, then apply and verify it:

```bash
pnpm db:migrate
pnpm typecheck
pnpm test
```

Do not add demo data to a schema migration. Migrations must remain production-safe; `pnpm db:seed` is the explicit, repeatable development-data step.

## Full Docker run

To build and run the production-shaped app, worker, and all dependencies locally:

```bash
docker compose up --build
```

Open <http://localhost:4010>. With the default local `SEED_DEMO=true`, the app service migrates PostgreSQL and runs the idempotent seed before it starts. Set `SEED_DEMO=false` for an empty setup flow.

To publish the container on another local port, set both the port and matching public URL:

```bash
APP_PORT=4011 DOCKER_APP_URL=http://localhost:4011 docker compose up --build
```

## Useful checks

```bash
docker compose ps
curl http://127.0.0.1:4010/api/setup/status
pnpm verify
pnpm test:e2e
```

Service endpoints used by host development:

| Service | Endpoint |
| --- | --- |
| Web | `http://127.0.0.1:5173` |
| API | `http://127.0.0.1:4010` |
| PostgreSQL | `127.0.0.1:5432` |
| Redis | `127.0.0.1:6379` |
| MinIO API | `http://127.0.0.1:9000` |
| MinIO console | `http://127.0.0.1:9001` |
| ClamAV | `127.0.0.1:3310` |

If a host port is already in use, override `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_API_PORT`, or `CLAMAV_PORT` for Docker and update the corresponding URL in `.env`.

## Resetting local data

Reset only when you intentionally want to lose all local Sendry data:

```bash
docker compose down --volumes
```

Then remove `data/sendry.db`, `data/sendry.db-shm`, and `data/sendry.db-wal`, and repeat the first-run commands. The volume removal and database-file removal are destructive and cannot be undone without a backup.
