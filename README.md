# Rolodex

Self-hosted personal relationship manager with CardDAV and CalDAV sync.

Accounts, workspaces, contacts, address books, calendar events, and tasks are included. Phones sync contacts and calendars with an application password. The product spec is in [docs/PRODUCT.md](docs/PRODUCT.md).

## Ports

Host ports live in `.env`. The defaults stay off the ports most other Docker stacks already use.

| Service | Variable | Default | Where it is reached |
| --- | --- | --- | --- |
| Postgres | `POSTGRES_PORT` | 5472 | `localhost:5472` (5432 inside Compose) |
| Redis | `REDIS_PORT` | 6479 | `localhost:6479` (6379 inside Compose) |
| Object storage | `S3_PORT` | 9100 | `localhost:9100` (9000 inside Compose) |
| Storage console | `S3_CONSOLE_PORT` | 9101 | `localhost:9101` |
| API | `API_PORT` | 4100 | `http://localhost:4100` |
| CardDAV / CalDAV | `CARDDAV_PORT` | 4101 | `http://localhost:4101` |
| Web image | `WEB_PORT` | 4180 | `http://localhost:4180` |
| Expo dev server | `WEB_DEV_PORT` | 4181 | `http://localhost:4181` |

If a port is already taken, change that variable and the URL that uses it (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `EXPO_PUBLIC_API_URL`, `PUBLIC_CARDDAV_URL`, or `CORS_ORIGIN`). Then run `docker compose up -d` and restart the API, CardDAV, and web processes.

## Run on this machine

1. Copy the environment file: `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`). Comments in that file call out what to change for production.
2. Start the data services: `docker compose up postgres redis minio -d`. Object storage uses the [Silo](https://github.com/pgsty/silo) image because the upstream MinIO registry images are no longer anonymously pullable. The API creates the `rolodex` bucket on startup.
3. Install and migrate: `pnpm install` then `pnpm db:migrate`.
4. Start the app in three terminals:
   - `pnpm dev:api`
   - `pnpm dev:carddav`
   - `pnpm dev:web`

Open `http://localhost:4181`. The dev server reads `EXPO_PUBLIC_API_URL` from `.env` and calls the API at `http://localhost:4100`. Sign up, then create an application password under Settings.

CardDAV accepts application passwords only. The account password is for the web app. Point a phone at `PUBLIC_CARDDAV_URL` (default `http://localhost:4101`) with the sign-in email and that application password. Use the machine's LAN address instead of `localhost` when the phone is on the same network. SSL stays off for a plain `http` URL.

Sessions are stored on the server and sent as an HTTP-only cookie. The web app also keeps the session token for the `Authorization` header, because the dev server and API are on different ports.

## Run the whole stack in Docker

From a machine with Docker:

```sh
cp .env.example .env
docker compose up -d --build
```

- Web: `http://localhost:4180` (`WEB_PORT`)
- API: `http://localhost:4100` (`API_PORT`)
- CardDAV and CalDAV: `http://localhost:4101` (`CARDDAV_PORT`)
- Storage console: `http://localhost:9101`

The web container serves the site and proxies `/api` to the API container, so the browser stays on `WEB_PORT`. CardDAV stays on its own published port. To point the static site at a different API origin, build with `--build-arg EXPO_PUBLIC_API_URL=https://rolodex.example.com`.

For a public host, set `COOKIE_SECURE=true`, put HTTPS in front of the web, API, and CardDAV ports, and set `CORS_ORIGIN`, `PUBLIC_CARDDAV_URL`, and `EXPO_PUBLIC_API_URL` to those `https` origins. Replace `POSTGRES_PASSWORD`, `S3_SECRET_KEY`, and `CREDENTIALS_KEY` before exposing the machine. Compose still publishes Postgres, Redis, and object storage on the host ports in `.env`; close those ports at the firewall if other machines should not reach them.

## Backups

`scripts/backup.sh` writes a PostgreSQL dump and a tar of the object-storage volume. `scripts/restore.sh backups/<stamp>` restores both. An owner can also trigger a database dump from Settings when `pg_dump` is on the PATH.

## Tests

`pnpm --filter @rolodex/core test` checks contact and calendar helpers. `pnpm --filter @rolodex/carddav test` runs the CardDAV and CalDAV sync scenarios when `DATABASE_URL` points at a migrated database.
