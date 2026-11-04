# Rolodex

Rolodex is a self-hosted relationship manager. One server holds the people, the calendar, the tasks, and the history. A phone or computer syncs the address book through CardDAV and the calendar and tasks through CalDAV. Photos can stay in Immich. An owner can also check an outside mailbox and calendar. The product definition is in [docs/PRODUCT.md](docs/PRODUCT.md).

The first visit creates the administrator. After that, registration is invite-only until an administrator turns open registration on under Admin → Security.

## What reaches a phone

The phone receives the name, phone numbers, email addresses, postal address, birthday, and the card note. How you met, interests, private notes, and tags stay in Rolodex. The website password does not work on the phone. Create a named client password under Settings and use that.

## Ports

Host ports live in `.env`. Postgres and object storage are published on `127.0.0.1` only. The website uses 80 and 443 so the public address has no port. If those are taken, change `WEB_PORT` and `WEB_TLS_PORT`.

| Service | Variable | Default | Where it is reached |
| --- | --- | --- | --- |
| Postgres | `POSTGRES_PORT` | 5472 | `127.0.0.1:5472` (5432 inside Compose) |
| Object storage | `S3_PORT` | 9100 | `127.0.0.1:9100` (9000 inside Compose) |
| Storage console | `S3_CONSOLE_PORT` | 9101 | `127.0.0.1:9101` |
| API | `API_PORT` | 4100 | `http://localhost:4100` |
| CardDAV / CalDAV | `CARDDAV_PORT` | 4101 | Dev only: `http://localhost:4101`. Docker uses the website address |
| Web HTTP | `WEB_PORT` | 80 | Redirects to the HTTPS address |
| Web HTTPS | `WEB_TLS_PORT` | 443 | `https://PUBLIC_HOST/` , or `https://PUBLIC_HOST:4443` when this is not 443 |
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

People use one address. Set `PUBLIC_HOST` to that name, for example `rolodex.demo.com`, before the first start. Compose generates a certificate for it. If the certificate was already created for localhost, delete the `certs` volume and start again.

```sh
cp .env.example .env
docker compose up -d --build
```

With `WEB_PORT=80` and `WEB_TLS_PORT=443`:

- `https://rolodex.demo.com/` is the website
- `https://rolodex.demo.com/api/` is the API
- `https://rolodex.demo.com/` also answers CardDAV and CalDAV, including `/.well-known/carddav` and `/.well-known/caldav`

A phone uses that same host. Turn SSL on, trust the generated certificate, and leave the port at 443. If 80 or 443 is already taken, set `WEB_PORT` and `WEB_TLS_PORT` to free ports. The address then keeps the TLS port, such as `https://rolodex.demo.com:4443/`. Plain HTTP on `WEB_PORT` redirects there.

Postgres, object storage, the raw API, and the raw CardDAV port stay on `127.0.0.1`. The website is the door everyone else uses. The storage console is `http://127.0.0.1:9101`.

Compose builds two Rolodex images: `rolodex` and the web image. The `rolodex` container migrates the database, then serves the API on port 3000 and CardDAV on port 3001 inside the Docker network. The web container is the only published site.

Replace `POSTGRES_PASSWORD`, `S3_SECRET_KEY`, and `CREDENTIALS_KEY` before anyone else can reach the machine. If the database volume already exists, change the password in `.env` and inside Postgres together. The sample values in `.env.example` are live defaults, not placeholders that Docker ignores.

## Backups

`scripts/backup.sh` writes a PostgreSQL dump and a tar of the object-storage volume. `scripts/restore.sh backups/<stamp>` restores both. An owner can also download a database dump from Settings when `pg_dump` is on the PATH.

## License

Rolodex is released under the GNU Affero General Public License v3.0 only. The terms are in [LICENSE](LICENSE). Someone who runs a modified copy as a network service has to offer that version's source to the people using the service.

## Tests

`pnpm --filter @rolodex/core test` checks contact, calendar, and sign-in helpers. `pnpm --filter @rolodex/carddav test` runs the CardDAV and CalDAV sync scenarios when `DATABASE_URL` points at a migrated database.
