# Rolodex plugins

A plugin adds one page to the bar under the main navigation. It cannot change people, settings, calendars, or any other part of Rolodex.

The plugin space has three parts:

- `plugin-sdk/` — manifest checks, `createMockHost`, and the `rolodex-plugin` command
- [rolodex-plugins](https://github.com/Rolodex-PRM/rolodex-plugins) — community catalog (`dist/index.json`); the page itself stays in its own repository
- `plugin-skill/` — instructions a coding agent follows when it builds a plugin

Put a folder in `plugins/` (or in `DATA_DIR/plugins`, or the directory named by `PLUGINS_DIR`):

```
plugins/my-page/rolodex-plugin.json
plugins/my-page/index.html
```

`rolodex-plugin.json`:

```json
{
  "id": "my-page",
  "name": "My page",
  "version": "1.0.0",
  "description": "What this page is for.",
  "entry": "index.html",
  "rolodex": ">=0.1.0 <1.0.0",
  "settings": [
    { "key": "heading", "label": "Heading", "type": "text" }
  ]
}
```

`id` is lowercase letters, numbers, and dashes. `entry` is one HTML file in that folder. `rolodex` is the host versions this page runs on. `>=0.1.0 <1.0.0` means Rolodex 0.1.0 and later, before 1.0.0. A bare `v0.1.0` means that version only. Discover downloads the pinned tag archive for a listed plugin, and the manifest in that archive must declare the same range. The page runs in a sandboxed frame. It cannot read the Rolodex session or call the network. After the `rolodex` event, `window.rolodex` offers:

- `me()` — the signed-in person's display name
- `contacts()` — id and display name for people this person can see
- `get(key)` and `set(key, value)` — text stored for this plugin, this person, and this workspace
- `settings()` — the values an administrator saved for this plugin

A plugin that needs more lists `permissions` in the manifest. The host rejects a call the manifest does not name.

- `contacts:read` — `contactsPage(offset)`, 100 people at a time, with name, email, phone, tags, addresses, and relationship type
- `data:own` — `records.list`, `get`, `put`, and `remove` for JSON that belongs to this plugin and the workspace
- `files:own` — store a CSV, spreadsheet, PDF, JSON, or text export and download it through the Rolodex window
- `ai:suggest` — `suggest(prompt)` returns text from the workspace AI add-on and writes nothing
- `profile:section` — the same page also opens on a contact, with `window.rolodex.contactId` set

`settings` is optional. Each item has a `key`, a `label`, and a `type` of `text` or `boolean`. Installed plugins show those fields under Settings. Admin → Plugins lists the permissions a plugin declared.

An administrator turns the plugin on under Admin → Plugins. The page then appears in the second bar.
