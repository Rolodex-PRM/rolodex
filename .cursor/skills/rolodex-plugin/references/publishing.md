# Listing a plugin

The community catalog is **[Rolodex-PRM/rolodex-plugins](https://github.com/Rolodex-PRM/rolodex-plugins)**. Rolodex downloads its `dist/index.json`. Listing a plugin does not require a Rolodex release.

1. Publish the plugin as a public GitHub release. Tag it with the plugin version, such as `v1.0.0`. Keep `rolodex-plugin.json` and the HTML page at the repository root.
2. Open a PR in `rolodex-plugins` that adds only `registry/plugins/<id>.json` (copy that repo’s `schema/example-entry.json`).
3. Set `repo` to `owner/name`, `release` to that tag, and `sha256` to the SHA-256 of `https://github.com/owner/name/archive/refs/tags/v1.0.0.zip`.
4. Set `rolodex` to the versions the page supports, such as `>=0.1.0 <1.0.0`. The same range belongs in `rolodex-plugin.json`.
5. Match `id`, `name`, `version`, `description`, `entry`, and `settings` to `rolodex-plugin.json`.

After the PR merges, ship new tags on **your** plugin repo. The registry sync workflow refreshes the pin; you usually do not need another catalog PR for routine bumps.

A Rolodex server fetches the remote index (override with `PLUGIN_REGISTRY_URL`). When `rolodex` includes the running version, it downloads that release, checks the hash, and unpacks the page. The server does not clone the repository.
