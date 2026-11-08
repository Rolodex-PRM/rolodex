# Listing a plugin

The registry is `registry/` in the Rolodex repository. It stores no HTML.

1. Publish the plugin as a GitHub release. Attach `plugin.zip` with `rolodex-plugin.json` and the HTML page. Tag it with the plugin version, such as `v1.0.0`.
2. Add `registry/plugins/<id>.json`. Start from `registry/schema/example-entry.json`.
3. Set `repo` to `owner/name`, `release` to that tag, and `sha256` to the SHA-256 of `plugin.zip`.
4. Set `rolodex` to the versions the page supports, such as `>=0.1.0 <1.0.0`. The same range belongs in `rolodex-plugin.json`.
5. Match `id`, `name`, `version`, `description`, `entry`, and `settings` to `rolodex-plugin.json`.
6. Run `node registry/build-index.mjs`. Commit the new entry and the generated `registry/dist/index.json`.

A Rolodex server reads `registry/plugins`. When `rolodex` includes the running version, it downloads that release, checks the hash, and unpacks the page. A range that excludes this server stays listed and cannot be installed. The server does not clone the repository.
