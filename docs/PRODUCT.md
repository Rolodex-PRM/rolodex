# Rolodex product spec

Rolodex is a self-hosted personal relationship manager and CardDAV server. Immich remains the owner of photos and face recognition. Rolodex stores the association between an Immich person and a contact, and it does not copy the photo library.

This repository's first build covers Phase 1 behavior and the full initial database schema.

## Phase 1

- Accounts, server sessions, and CardDAV application passwords
- Workspaces with owner, administrator, editor, contributor, and viewer roles
- Contacts, methods, addresses, tags, profile photos, and search
- Multiple address books, vCard import and export, and preservation of unknown vCard properties
- CardDAV discovery, ETags, sync tokens, and bidirectional contact changes
- PostgreSQL backups

CRM fields on a contact, including how you met and interests, are stored separately from the vCard. The private `notes` table is not read or written in this phase, and CardDAV never serializes it.

## Later phases, already in the schema

Relationships, households, organizations, activities, notes, tasks, reminders, custom fields, audit logs, and Immich instance, person, asset, and mapping tables are migrated now and have no API yet.

The full requirements for those phases are the product requirements used to start this repository: contacts and relationships, organizations and households, notes and activity, tasks, sharing, Immich linking, CardDAV, search, and the five-phase roadmap.
