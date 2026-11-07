# Rolodex plugins — registry

This folder is a static index. A Rolodex server reads `registry/plugins/*.json` and shows those plugins under Admin → Plugins. There is no account and no install service. The plugin’s code stays in the repository named by `repo`, at `path`.

Community pages are third-party software. They run in a sandboxed frame and can use only the plugin bridge (`me`, `contacts`, `settings`, `get`, `set`). Review a plugin before you copy its folder onto a server. Rolodex does not audit entries in this index.

## Add a plugin

1. Build the page with `@rolodex/plugin-sdk` (`rolodex-plugin create`, then `rolodex-plugin validate`).
2. Put the folder in a public git repository.
3. Open a pull request that adds one file, `registry/plugins/<id>.json`. Copy `schema/example-entry.json`. Do not put the HTML here.
4. Regenerate the index with `node registry/build-index.mjs`. `registry/dist/index.json` is the file another server can fetch. Do not edit `dist/` by hand.

`id` matches `rolodex-plugin.json`. `path` is a folder inside the repository, never a parent directory.

A listed plugin appears in Discover after its folder is on the server. Until then the row says to add that folder under `plugins/`.
