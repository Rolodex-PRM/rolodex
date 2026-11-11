# Security Policy

Rolodex stores personal information: contacts, calendars, tasks, and notes.
Please report security problems privately so they can be fixed before
they are discussed in public.

## Supported versions

Rolodex is in active development and has not reached 1.0. Only the latest
release is supported with security fixes.

| Version | Supported |
| ------- | --------- |
| Latest release (currently 0.1.x) | Yes |
| Older releases | No, please upgrade to the latest release |

If you are running the Docker image, use the newest tagged release rather
than an older pinned tag. `latest` always points at the newest release.

## How to report a vulnerability

Do not open a public GitHub issue for a security problem.

Preferred: use GitHub private vulnerability reporting on this repository
(Security tab, then "Report a vulnerability"). That keeps the report
private until a fix is ready.

Alternative: email gallinij@gmail.com with the subject
`[Rolodex security]`. If you use email, please say whether you want to be
credited in the fix notes.

Please include, where you can:

- The Rolodex version or Docker image tag and digest you tested.
- How you deployed it (Docker Compose, a reverse proxy, local development).
- Steps to reproduce the problem.
- What an attacker could do with it, and what data would be affected.
- Any logs or screenshots, with secrets, passwords, tokens, and personal
  contact details removed.

## What happens next

The maintainer aims to acknowledge a report within a few business days,
confirm whether it is a real problem, and work on a fix. You will be told
when a fixed release is published. Please give the project time to fix the
problem before disclosing it publicly. If a fix will take longer than
expected, the maintainer will say so rather than leave you without news.

Security fixes are released as a new tagged version and noted in
CHANGELOG.md. The details of a vulnerability are not published until a fix
is available, unless the problem is already being exploited and users need
to protect themselves first.

## Scope

In scope:

- Authentication and session handling, including the website sign-in,
  second factor, invite-only registration, and CardDAV and CalDAV client
  passwords.
- Authorization, including workspace roles and who can see or change a
  person, event, or task.
- Data exposure through the API, the website, CardDAV, CalDAV, plugins,
  exports, backups, and logs.
- Injection, cross-site scripting, and request forgery in Rolodex itself.
- Problems in the Docker image or the default deployment that would expose
  a fresh install.

Out of scope:

- Reports about third-party services (Postgres, Immich, an external mail
  provider, a reverse proxy, or a phone operating system) unless the
  problem is caused by how Rolodex uses them.
- Social engineering, physical access to a server, or attacks that need a
  user to install malware or hand over a password.
- Missing features, such as a security control that is not documented as
  existing. Those belong in a public feature request instead.
- The sample values in `.env.example`. They are not live secrets. They
  must be replaced before production use, and the README says so. If
  Rolodex accepts a sample value in production without warning, that is
  a real report, and it is in scope.

## Protecting your own install

- Replace `POSTGRES_PASSWORD` and `CREDENTIALS_KEY` in `.env` before
  anyone else can reach the machine.
- Keep Rolodex behind HTTPS, using a reverse proxy or tunnel. Rolodex
  itself serves plain HTTP on its one port.
- Keep registration invite-only unless you mean to open it.
- Keep backups encrypted or in a place only you can reach. A database
  dump contains your contacts.
