# Rolodex plugin skill

Instructions for a coding agent that is building, checking, or listing a Rolodex plugin.

Copy `skills/rolodex-plugin` into the repository where the plugin is built:

- Cursor: `.cursor/skills/rolodex-plugin`
- Other SKILL.md agents: the skills directory that agent reads

The skill follows the same contract as `plugin-sdk/` and `registry/` in the Rolodex repository. A plugin is one sandboxed page. It is not a server process, and it cannot change people.
