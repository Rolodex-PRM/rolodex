# Changelog

All notable changes to Rolodex are listed here. The format follows
Keep a Changelog, and the project uses semantic versioning. A release is
cut by publishing a GitHub release, which publishes the matching Docker
image tags.

## Unreleased

## 0.3.0 - 2026-11-20

Multi-arch Docker support: the same Hub tags work on amd64 and arm64 hosts.

### Added

- Multi-arch Docker images for `linux/amd64` and `linux/arm64`, published
  together under the usual release and `:dev` tags.
- Documentation site pages for Quick start, Docker Compose, Environment
  variables, and a public roadmap through 1.0.
- A staging → main release gate
  (`scripts/check-release-docs.mjs`) that requires a version bump, a
  dated changelog heading, and a matching `docs/version.json`.

### Changed

- Docker CI and publish build each architecture on a native runner
  (`ubuntu-latest` and `ubuntu-24.04-arm`) and merge digests into one
  manifest, instead of cross-building arm64 under QEMU.
- JS and web export stages in the Dockerfile build on the host platform;
  the final stage still installs native addons for the target arch.
- Workspace package versions and `docs/version.json` are aligned at
  0.3.0 for this release.

### Fixed

- Docker image: require Alpine `nginx>=1.30.7-r0` and `openssl>=3.5.9-r1`,
  and run `apk upgrade` before installing packages, so rebuilds clear
  the critical nginx and high openssl CVEs reported on
  `gallinij/rolodex:dev`.
- Arm64 image builds no longer crash during `pnpm install` with SIGILL
  (exit 132) under QEMU.

## 0.2.0 - 2026-11-18

Interim release notes for work that landed after 0.1.3 and before the
multi-arch 0.3.0 cut. No separate 0.2.0 Docker tag was published; these
changes ship with 0.3.0.

### Added

- A Docker Hub `:dev` channel (and short `dev-<sha>` tags) that can be
  published by hand without moving `latest`.
- SECURITY.md, with a private vulnerability reporting path and a list of
  supported versions.
- CONTRIBUTING.md, with setup, tests, and pull request guidance.
- CODE_OF_CONDUCT.md.
- Bug report and feature request issue templates, and a pull request
  template.
- Documentation and plugin request issue templates.
- Discussion category forms for Q&A and Ideas, in
  `.github/DISCUSSION_TEMPLATE/`.

### Changed

- Plugin discovery uses the remote
  [rolodex-plugins](https://github.com/Rolodex-PRM/rolodex-plugins)
  catalog (`dist/index.json`) instead of the in-repo `registry/plugins`
  files. Override with `PLUGIN_REGISTRY_URL` / `PLUGIN_REGISTRY_DIR`.
  Catalog updates no longer require a Rolodex release.
- The production Docker image runs on Alpine Linux.

### Fixed

- Contacts: bulk actions, phone number formatting, auth reset flows, and
  map loading.
- Reverse-proxy / Docker gateway configuration for the single published
  HTTP port.
- README: corrected the Docker publishing note. A push to `main` does
  not publish an image. Publishing a GitHub release does.
- `.env.example`: corrected the published image name to
  `gallinij/rolodex:latest`.

## 0.1.3 - 2026-11-11

### Fixed

- Hardened the Docker build and pruned dependencies, including a large
  reduction in the lockfile.
- Sped up the contacts map for hundreds of people.
- Refreshed the README screenshots and added the active development
  notice.

## 0.1.2 - 2026-11-09

### Added

- A flipping Rolodex mark and force-directed network graphs.
- Full-bleed, responsive plugin pages.

### Changed

- The Docker publish workflow can now be run by hand with
  `workflow_dispatch`.

## 0.1.1 - 2026-11-08

### Added

- Docker image publishing on release, with semver tags and `latest`.
- Plugins are installed from pinned release tag archives.

## 0.1.0 - 2026-11-08

First public release.

### Added

- Self-hosted people, calendar, and tasks, with CardDAV and CalDAV sync
  from one container on one port.
- Contact import from vCard or a spreadsheet, contact paging and editing,
  and suggested family and coworker links.
- Plugin records, files, and contact pages, a plugin catalog, and a
  plugin registry.
- Two-factor sign-in, trash with retention, outside mail, and invite-only
  registration after the first administrator.
- Home-screen icons and richer contact details.
