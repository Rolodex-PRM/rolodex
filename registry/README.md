# Plugin registry (moved)

The community plugin catalog lives in **[Rolodex-PRM/rolodex-plugins](https://github.com/Rolodex-PRM/rolodex-plugins)**.

Rolodex fetches:

```
https://raw.githubusercontent.com/Rolodex-PRM/rolodex-plugins/main/dist/index.json
```

That index updates when plugins are listed or synced there. It is not tied to a Rolodex release.

To list a plugin: open a PR in `rolodex-plugins` that adds one file, `registry/plugins/<id>.json`. See that repo’s README.

### Local / offline

- `PLUGIN_REGISTRY_URL=` — disable the remote fetch
- `PLUGIN_REGISTRY_DIR=/path/to/entries` — read `*.json` entries from a folder (used when remote is disabled or empty)
- Bundled example pages still load from `plugins/` on disk; they do not need a catalog entry
