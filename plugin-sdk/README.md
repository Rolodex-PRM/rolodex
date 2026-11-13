# Rolodex plugin SDK

The contract for a Rolodex plugin page. The host injects `window.rolodex` into a sandboxed frame. This package is how you describe the page, try the bridge without a server, and check the manifest before you copy the folder onto a server.

Next to this package:

- [rolodex-plugins](https://github.com/Rolodex-PRM/rolodex-plugins) is the community catalog. One JSON file per plugin. The code stays in your repository.
- `plugin-skill/` teaches a coding agent the same rules. Copy `plugin-skill/skills/rolodex-plugin` into the repository where you build the plugin.

You can build and run a plugin with only a folder under `plugins/`. The remote catalog matters when another Rolodex should list it.

## Commands

From this repository:

```
pnpm --filter @rolodex/plugin-sdk cli -- create field-notes
pnpm --filter @rolodex/plugin-sdk cli -- validate field-notes
```

`create` writes `rolodex-plugin.json`, `index.html`, and a short README. `validate` fails when the manifest or the entry file is wrong.

## What the page can call

After the `rolodex` event:

- `me()` — display name of the signed-in person
- `contacts()` — `id` and `displayName` for up to 200 people that person can see
- `settings()` — text and boolean values an administrator saved for this plugin
- `get(key)` and `set(key, value)` — text stored for this plugin, this person, and this workspace

`createMockHost()` returns that same surface in memory, including the key and length limits, so a test does not need Rolodex running.

A plugin that needs more declares `permissions` in the manifest. The host enforces that list:

- `contacts:read` — paged people with email, phone, tags, addresses, and relationship type
- `data:own` — JSON records owned by the plugin and the workspace
- `files:own` — CSV, spreadsheet, PDF, JSON, or text exports
- `ai:suggest` — a text suggestion from the workspace AI add-on
- `profile:section` — the page also opens on a contact, with `contactId` set

`get` and `set` stay personal notes and do not need a permission. `contacts()` stays id and display name. The plugin still cannot edit Rolodex people, and the frame’s content-security policy sets `connect-src 'none'`.
