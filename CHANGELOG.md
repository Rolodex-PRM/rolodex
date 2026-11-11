# Changelog

All notable changes to Rolodex are listed here. The format follows
Keep a Changelog, and the project uses semantic versioning. A release is
cut by publishing a GitHub release, which publishes the matching Docker
image tags.

## Unreleased

### Added

- SECURITY.md, with a private vulnerability reporting path and a list of
  supported versions.
- CONTRIBUTING.md, with setup, tests, and pull request guidance.
- CODE_OF_CONDUCT.md.
- Bug report and feature request issue templates, and a pull request
  template.
- Documentation and plugin request issue templates.
- Discussion category forms for Q&A and Ideas, in
  `.github/DISCUSSION_TEMPLATE/`. They take effect once Discussions is
  enabled for the repository.
- This changelog.

### Fixed

- README: corrected the Docker publishing note. A push to `main` does
  not publish an image. Publishing a GitHub release does.
- `.env.example`: corrected the published image name from
  `rolodexprm/rolodex:0.1.0` to `gallinij/rolodex:0.1.3`.
- Package versions: the root package and all workspace packages were
  still at 0.1.0 while the releases had reached v0.1.3. They now match
  the current release, 0.1.3.

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
