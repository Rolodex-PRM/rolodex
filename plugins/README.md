# Rolodex plugins

A plugin adds one page to the bar under the main navigation. It cannot change people, settings, calendars, or any other part of Rolodex.

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
  "entry": "index.html"
}
```

`id` is lowercase letters, numbers, and dashes. `entry` is one HTML file in that folder. The page runs in a sandboxed frame. It cannot read the Rolodex session or call the network. After the `rolodex` event, `window.rolodex` offers:

- `me()` — the signed-in person's display name
- `contacts()` — id and display name for people this person can see
- `get(key)` and `set(key, value)` — text stored for this plugin, this person, and this workspace

An administrator turns the plugin on under Admin → Plugins. The page then appears in the second bar.
