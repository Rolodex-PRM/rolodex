# Rolodex

Rolodex is a self-hosted relationship manager. One server holds the people, the calendar, the tasks, and the history. A phone or computer syncs the address book through CardDAV and the calendar and tasks through CalDAV. Photos can stay in Immich. An owner can also check an outside mailbox and calendar. The product definition is in [docs/PRODUCT.md](docs/PRODUCT.md).

The first visit creates the administrator. After that, registration is invite-only until an administrator turns open registration on under Admin → Security.

## What reaches a phone

The phone receives the name, phone numbers, email addresses, postal address, birthday, and the card note. How you met, interests, private notes, and tags stay in Rolodex. The website password does not work on the phone. Create a named client password under Settings and use that.

## Ports

Host ports live in `.env`. The defaults stay off the ports most other Docker stacks already use. Postgres and object storage are published on `127.0.0.1` only.

| Service | Variable | Default | Where it is reached |
| --- | --- | --- | --- |
| Postgres | `POSTGRES_PORT` | 5472 | `127.0.0.1:5472` (5432 inside Compose) |
| Object storage | `S3_PORT` | 9100 | `127.0.0.1:9100` (9000 inside Compose) |
| Storage console | `S3_CONSOLE_PORT` | 9101 | `127.0.0.1:9101` |
| API | `API_PORT` | 4100 | `http://localhost:4100` |
| CardDAV / CalDAV | `CARDDAV_PORT` | 4101 | Dev: `http://localhost:4101`. Docker: HTTPS on this port |
| Web image | `WEB_PORT` | 4180 | Redirects to `https://PUBLIC_HOST:WEB_TLS_PORT` |
| Web TLS | `WEB_TLS_PORT` | 4443 | `https://PUBLIC_HOST:4443` |
| Expo dev server | `WEB_DEV_PORT` | 4181 | `http://localhost:4181` |

If a port is already taken, change that variable and the URL that uses it (`DATABASE_URL`, `S3_ENDPOINT`, `EXPO_PUBLIC_API_URL`, `PUBLIC_CARDDAV_URL`, or `CORS_ORIGIN`). Then run `docker compose up -d`.

## Run on this machine

1. Copy the environment file: `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`). Comments in that file call out what to change for production.
2. Start the data services: `docker compose up postgres minio -d`. Object storage uses the [Silo](https://github.com/pgsty/silo) image because the upstream MinIO registry images are no longer anonymously pullable. The API creates the `rolodex` bucket on startup.
3. Install and migrate: `pnpm install` then `pnpm db:migrate`.
4. Start the app in three terminals:
   - `pnpm dev:api`
   - `pnpm dev:carddav`
   - `pnpm dev:web`

Open `http://localhost:4181`. The first person creates the administrator account. The dev server reads `EXPO_PUBLIC_API_URL` from `.env` and calls the API at `http://localhost:4100`.

Local CardDAV stays HTTP unless you set certificate paths. Point a phone at the machine's LAN address instead of `localhost`, and leave SSL off for a plain `http` URL. Create a client password under Settings. The account password is only for the website.

Sessions are stored on the server and sent as an HTTP-only cookie. The web app also keeps the session token for the `Authorization` header, because the dev server and API are on different ports.

## Run the whole stack in Docker

Set `PUBLIC_HOST` to the name or address phones and browsers should use, for example `192.168.1.140`, before the first start. Compose generates a certificate for that host. If the certificate was already created for localhost, delete the `certs` volume and start again.

```sh
cp .env.example .env
docker compose up -d --build
```

- Web: `http://localhost:4180` redirects to `https://PUBLIC_HOST:4443`
- API: `http://localhost:4100` (`API_PORT`). The site calls `/api` on the same origin.
- CardDAV and CalDAV: `https://PUBLIC_HOST:4101` when the certificate exists
- Storage console: `http://127.0.0.1:9101`

Compose builds two Rolodex images: `rolodex` and the web image. The `rolodex` container migrates the database, then serves the API on port 3000 and CardDAV on port 3001. The web container serves the site and proxies `/api` to that container. On a phone, turn SSL on, trust the generated certificate, and put only the host in the Server field. The port goes in Advanced.

Replace `POSTGRES_PASSWORD`, `S3_SECRET_KEY`, and `CREDENTIALS_KEY` before anyone else can reach the machine. If the database volume already exists, change the password in `.env` and inside Postgres together. The sample values in `.env.example` are live defaults, not placeholders that Docker ignores.

## Backups

`scripts/backup.sh` writes a PostgreSQL dump and a tar of the object-storage volume. `scripts/restore.sh backups/<stamp>` restores both. An owner can also download a database dump from Settings when `pg_dump` is on the PATH.

## Tests

`pnpm --filter @rolodex/core test` checks contact, calendar, and sign-in helpers. `pnpm --filter @rolodex/carddav test` runs the CardDAV and CalDAV sync scenarios when `DATABASE_URL` points at a migrated database.
