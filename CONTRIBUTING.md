# Contributing to Rolodex

Thanks for helping. Rolodex is a self-hosted relationship manager: one
server holds people, the calendar, tasks, and the history of how you know
someone, and phones sync through CardDAV and CalDAV.

Rolodex is in active development and has not reached 1.0, so breaking
changes are still possible. The project is small and has one maintainer,
so small, focused contributions land fastest.

## Ground rules

- Be kind and direct. See CODE_OF_CONDUCT.md.
- All contributions are licensed under the GNU Affero General Public
  License v3.0 only, the same license as the project. By contributing,
  you agree your work is released under that license.
- Sign off your commits with `git commit -s`. That records that you have
  the right to contribute the work, in the style of the Developer
  Certificate of Origin.
- Do not include secrets, passwords, tokens, real contact details, or
  real personal data in a commit, an issue, a test, or a screenshot.
  Use clearly fake values such as `example.com` addresses.
- Do not bump version numbers in a pull request. The maintainer bumps
  versions when a release is cut, so the tag, the package versions, and
  the changelog stay in step.

## Before you start

- For a bug, check the open issues first. If one already exists, add a
  comment with a reproduction instead of opening a duplicate.
- For a feature or a larger change, open an issue first and describe the
  problem you want to solve. That saves work on both sides if the
  direction needs adjusting.
- Small fixes, such as a typo, a broken link, or an obvious bug, can go
  straight to a pull request.

## Development setup

You need Node.js 22 or newer and pnpm 10.33.3. Corepack ships with Node
and can provide pnpm.

```sh
cp .env.example .env
docker compose up postgres -d
pnpm install
pnpm db:migrate
```

Then start the app in four terminals:

```sh
pnpm dev:api
pnpm dev:carddav
pnpm dev:web
pnpm dev:gateway
```

The gateway listens on `PORT` (8080 by default). Open
`http://localhost:4181` for the dev website. The first person to sign up
creates the administrator account. The README has the full setup, the
ports table, and the Docker instructions.

## Tests and checks

Run the checks before opening a pull request:

```sh
pnpm test
pnpm typecheck
```

`pnpm --filter @rolodex/core test` checks the contact, calendar, and
sign-in helpers. `pnpm --filter @rolodex/carddav test` runs the CardDAV
and CalDAV sync scenarios and needs `DATABASE_URL` to point at a migrated
database. If you cannot run a check, say so in the pull request and say
which checks you did run.

There is no formatter or linter configured yet, so match the style of the
surrounding code: TypeScript, small functions, and plain names.

## Pull requests

- Keep a pull request to one change. A bug fix, a feature, and a refactor
  in one pull request are hard to review.
- Explain what changed and why, and how you tested it. Add screenshots
  for a visible change.
- Update the docs when behavior changes. `docs/PRODUCT.md` describes
  field-by-field behavior, roles, and admin pages, and the README
  describes setup.
- Add an entry under `Unreleased` in CHANGELOG.md for a user-visible
  change.
- Keep the pull request template checklist honest. Do not tick a box for
  a test you did not run.

## Plugins

Rolodex has a plugin system. See `plugin-sdk/README.md` for the plugin
SDK, `plugins/README.md` for the bundled plugins, and `registry/README.md`
for the plugin registry. Plugins are installed from pinned release tag
archives, so a plugin pull request should say which release it targets.

## Reporting bugs and security problems

- Questions: ask in Discussions, in the Q&A category, not in an issue.
- Ideas: talk them through in Discussions, in the Ideas category, before
  opening a feature request.
- Bugs: open an issue with the bug report template. Include the Rolodex
  version or Docker image tag, how you deployed it, and steps to
  reproduce it.
- Security problems: do not open a public issue. See SECURITY.md.
