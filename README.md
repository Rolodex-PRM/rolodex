# Rolodex

Self-hosted personal relationship manager and CardDAV server.

Phase 1 includes accounts, workspaces, contacts, address books, vCard import and export, and an iOS-compatible CardDAV service. The database also contains the later relationship, activity, task, and Immich tables so those phases do not require a schema rewrite. The product spec is in [docs/PRODUCT.md](docs/PRODUCT.md).

## Run locally

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL, Redis, and object storage: `docker compose up postgres redis minio -d`. Postgres is published on port 5434 and Redis on 6380 so they do not collide with other local databases. The API creates the `rolodex` bucket on startup. Object storage uses the [Silo](https://github.com/pgsty/silo) image because the upstream MinIO registry images are no longer anonymously pullable.
3. Install and migrate: `pnpm install` then `pnpm db:migrate`
4. Start the API, CardDAV service, and web app in three terminals:
   - `pnpm dev:api`
   - `pnpm dev:carddav`
   - `pnpm dev:web`

The web app runs at `http://localhost:8081` and calls `http://localhost:3000`. Sign up, then create an application password under Settings. Point iOS Contacts at `http://localhost:3001` with your email and that application password.

CardDAV accepts application passwords only. The account password is for the web app. Sessions are stored on the server and sent as an HTTP-only cookie. The Expo app also keeps the same session token for the `Authorization` header, because the dev server and API are on different ports.

## Backups

`scripts/backup.sh` writes a PostgreSQL dump and a tar of the MinIO volume. `scripts/restore.sh backups/<stamp>` restores both. An owner can also trigger a database dump from Settings when `pg_dump` is on the PATH.

## Tests

`pnpm --filter @rolodex/core test` checks vCard round-trips. `pnpm --filter @rolodex/carddav test` runs the CardDAV sync scenarios when `DATABASE_URL` points at a migrated database.
