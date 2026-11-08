# Rolodex plugins — registry

This folder is a static index. A Rolodex server reads `registry/plugins/*.json` and shows those plugins under Admin → Plugins. There is no account and no install service.

Community pages are third-party software. They run in a sandboxed frame. Rolodex does not audit entries in this index. Each entry pins one GitHub **release** archive with its SHA-256. The server downloads that file, checks the hash, and unpacks `rolodex-plugin.json` and the HTML page. It does not clone the repository, and it does not follow a branch.

`rolodex` is the versions that page supports, for example `>=0.1.0 <1.0.0`. A page whose range excludes this server stays listed and cannot be installed.

## Add a plugin

1. Build the page with `@rolodex/plugin-sdk` (`rolodex-plugin create`, then `rolodex-plugin validate`). Set `rolodex` to the versions it supports.
2. Publish a GitHub release. Attach `plugin.zip` containing `rolodex-plugin.json` and the HTML page. The tag is the plugin version, such as `v1.0.0`.
3. Open a pull request that adds one file, `registry/plugins/<id>.json`. Copy `schema/example-entry.json`. Set `release` to that tag and `sha256` to the archive hash. Do not put the HTML here.
4. Regenerate the index with `node registry/build-index.mjs`. `registry/dist/index.json` is the file another server can fetch. Do not edit `dist/` by hand.

`id` matches `rolodex-plugin.json`. The manifest inside the zip must use the same `id`, `version`, and `rolodex` range as the registry entry.
