# Rolodex plugin skill

Instructions for a coding agent that is building, checking, or listing a Rolodex plugin.

Copy `skills/rolodex-plugin` into the repository where the plugin is built:

- Cursor: `.cursor/skills/rolodex-plugin`
- Other SKILL.md agents: the skills directory that agent reads

The skill follows the same contract as `plugin-sdk/` here and the community catalog in [rolodex-plugins](https://github.com/Rolodex-PRM/rolodex-plugins). A plugin is one sandboxed page. It is not a server process, and it cannot change people.
