import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

export const workspaceRoles = ['owner', 'administrator', 'editor', 'contributor', 'viewer'] as const
export type WorkspaceRole = (typeof workspaceRoles)[number]

export const contactGrantRoles = ['viewer', 'editor'] as const
export type ContactGrantRole = (typeof contactGrantRoles)[number]

export const contactTypes = [
  'individual',
  'organization',
  'business',
  'household',
  'professional_service',
  'custom',
] as const
export type ContactType = (typeof contactTypes)[number]

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  emailOtpHash: text('email_otp_hash'),
  emailOtpExpiresAt: timestamp('email_otp_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const appPasswords = pgTable('app_passwords', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  passwordHash: text('password_hash').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<WorkspaceRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('workspace_member_idx').on(table.workspaceId, table.userId)],
)

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  storageKey: text('storage_key').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').$type<ContactType>().notNull().default('individual'),
    prefix: text('prefix'),
    firstName: text('first_name'),
    middleName: text('middle_name'),
    lastName: text('last_name'),
    suffix: text('suffix'),
    preferredName: text('preferred_name'),
    nickname: text('nickname'),
    displayName: text('display_name').notNull(),
    organizationName: text('organization_name'),
    department: text('department'),
    title: text('title'),
    position: text('position'),
    birthday: date('birthday'),
    anniversary: date('anniversary'),
    website: text('website'),
    cardNote: text('card_note'),
    howWeMet: text('how_we_met'),
    introducedByContactId: uuid('introduced_by_contact_id').references((): AnyPgColumn => contacts.id, {
      onDelete: 'set null',
    }),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
    preferredCommunication: text('preferred_communication'),
    interests: text('interests'),
    personalDetails: text('personal_details'),
    professionalBackground: text('professional_background'),
    followUpFrequency: text('follow_up_frequency'),
    customAttributes: jsonb('custom_attributes').notNull().default({}),
    photoAttachmentId: uuid('photo_attachment_id').references(() => attachments.id, { onDelete: 'set null' }),
    coverAttachmentId: uuid('cover_attachment_id').references(() => attachments.id, { onDelete: 'set null' }),
    coverMode: text('cover_mode').notNull().default('cycle'),
    visibility: text('visibility').notNull().default('workspace'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('contacts_workspace_idx').on(table.workspaceId),
    index('contacts_display_name_idx').on(table.displayName),
    index('contacts_active_idx').on(table.workspaceId).where(sql`deleted_at is null`),
  ],
)

export const contactGrants = pgTable(
  'contact_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<ContactGrantRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('contact_grant_idx').on(table.contactId, table.userId)],
)

export const userGroups = pgTable(
  'user_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    minRole: text('min_role').$type<ContactGrantRole>().notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('user_group_name_idx').on(table.workspaceId, table.name)],
)

export const workspaceInvites = pgTable('workspace_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').$type<WorkspaceRole>().notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const passwordResets = pgTable('password_resets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userGroupMembers = pgTable(
  'user_group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => userGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
)

export const contactGroupGrants = pgTable(
  'contact_group_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => userGroups.id, { onDelete: 'cascade' }),
    role: text('role').$type<ContactGrantRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('contact_group_grant_idx').on(table.contactId, table.groupId)],
)

export const contactDates = pgTable('contact_dates', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  occursOn: date('occurs_on').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const contactMethods = pgTable(
  'contact_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    label: text('label').notNull().default(''),
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('contact_methods_contact_idx').on(table.contactId),
    index('contact_methods_normalized_idx').on(table.normalizedValue),
  ],
)

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default('home'),
    street: text('street').notNull().default(''),
    street2: text('street2').notNull().default(''),
    city: text('city').notNull().default(''),
    region: text('region').notNull().default(''),
    postalCode: text('postal_code').notNull().default(''),
    country: text('country').notNull().default(''),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('addresses_contact_idx').on(table.contactId)],
)

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tag_name_idx').on(table.workspaceId, table.name)],
)

export const contactTags = pgTable(
  'contact_tags',
  {
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.contactId, table.tagId] })],
)

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    industry: text('industry'),
    website: text('website'),
    email: text('email'),
    phone: text('phone'),
    street: text('street'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    country: text('country'),
    parentOrganizationId: uuid('parent_organization_id').references((): AnyPgColumn => organizations.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('organizations_workspace_idx').on(table.workspaceId)],
)

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    department: text('department'),
    title: text('title'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (table) => [uniqueIndex('org_membership_idx').on(table.organizationId, table.contactId)],
)

export const relationshipTypes = pgTable(
  'relationship_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    reciprocalLabel: text('reciprocal_label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('relationship_types_pair_idx').on(
      table.workspaceId,
      sql`least(lower(${table.label}), lower(${table.reciprocalLabel}))`,
      sql`greatest(lower(${table.label}), lower(${table.reciprocalLabel}))`,
    ),
  ],
)

export const relationships = pgTable(
  'relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    relationshipTypeId: uuid('relationship_type_id').references(() => relationshipTypes.id, { onDelete: 'set null' }),
    fromContactId: uuid('from_contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    toContactId: uuid('to_contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    type: text('type').notNull(),
    reciprocalType: text('reciprocal_type'),
    description: text('description'),
    origin: text('origin').notNull().default('explicit'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('relationships_from_idx').on(table.fromContactId),
    index('relationships_to_idx').on(table.toContactId),
    uniqueIndex('relationships_edge_idx').on(table.workspaceId, table.fromContactId, table.toContactId, sql`lower(${table.type})`),
  ],
)

export const relationshipDismissals = pgTable(
  'relationship_dismissals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fromContactId: uuid('from_contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    toContactId: uuid('to_contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('relationship_dismissals_edge_idx').on(table.workspaceId, table.fromContactId, table.toContactId, sql`lower(${table.type})`)],
)

export const userRelationships = pgTable(
  'user_relationships',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId, table.contactId] })],
)

export const workspacePlugins = pgTable(
  'workspace_plugins',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    pluginId: text('plugin_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    settings: jsonb('settings').$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.pluginId] })],
)

export const pluginRecords = pgTable(
  'plugin_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pluginId: text('plugin_id').notNull(),
    recordKey: text('record_key').notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('plugin_records_key_idx').on(table.workspaceId, table.userId, table.pluginId, table.recordKey)],
)

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  street: text('street'),
  city: text('city'),
  region: text('region'),
  postalCode: text('postal_code'),
  country: text('country'),
  visibility: text('visibility').notNull().default('workspace'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export const householdMembers = pgTable(
  'household_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    role: text('role'),
  },
  (table) => [uniqueIndex('household_member_idx').on(table.householdId, table.contactId)],
)

export const addressBooks = pgTable(
  'address_books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    urlSegment: text('url_segment').notNull().unique(),
    syncToken: bigint('sync_token', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('address_books_workspace_idx').on(table.workspaceId)],
)

export const addressBookMembers = pgTable(
  'address_book_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    addressBookId: uuid('address_book_id')
      .notNull()
      .references(() => addressBooks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<WorkspaceRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('address_book_member_idx').on(table.addressBookId, table.userId)],
)

export const contactResources = pgTable(
  'contact_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    addressBookId: uuid('address_book_id')
      .notNull()
      .references(() => addressBooks.id, { onDelete: 'cascade' }),
    uid: text('uid').notNull(),
    etag: text('etag').notNull(),
    vcardText: text('vcard_text').notNull(),
    unknownProperties: jsonb('unknown_properties').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('contact_resource_uid_idx').on(table.addressBookId, table.uid),
    index('contact_resources_contact_idx').on(table.contactId),
  ],
)

export const addressBookChanges = pgTable(
  'address_book_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    addressBookId: uuid('address_book_id')
      .notNull()
      .references(() => addressBooks.id, { onDelete: 'cascade' }),
    syncToken: bigint('sync_token', { mode: 'number' }).notNull(),
    uid: text('uid').notNull(),
    deleted: boolean('deleted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('address_book_changes_token_idx').on(table.addressBookId, table.syncToken)],
)

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    description: text('description'),
    location: text('location'),
    visibility: text('visibility').notNull().default('workspace'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('activities_workspace_idx').on(table.workspaceId, table.occurredAt)],
)

export const activityContacts = pgTable(
  'activity_contacts',
  {
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.activityId, table.contactId] })],
)

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    visibility: text('visibility').notNull().default('private'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('notes_contact_idx').on(table.contactId)],
)

export const interactionFiles = pgTable('interaction_files', {
  attachmentId: uuid('attachment_id')
    .primaryKey()
    .references(() => attachments.id, { onDelete: 'cascade' }),
  activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'cascade' }),
  noteId: uuid('note_id').references(() => notes.id, { onDelete: 'cascade' }),
})

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    uid: text('uid').notNull(),
    title: text('title').notNull(),
    visibility: text('visibility').notNull().default('workspace'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    priority: integer('priority').notNull().default(0),
    notes: text('notes'),
    rrule: text('rrule'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('tasks_uid_idx').on(table.workspaceId, table.uid)],
)

export const reminders = pgTable('reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  remindAt: timestamp('remind_at', { withTimezone: true }).notNull(),
  recurrence: text('recurrence'),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull().default('contact'),
    key: text('key').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('custom_field_key_idx').on(table.workspaceId, table.entityType, table.key)],
)

export const customFieldValues = pgTable(
  'custom_field_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('custom_field_value_idx').on(table.definitionId, table.entityId)],
)

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('disconnected'),
  settings: jsonb('settings').notNull().default({}),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const mailboxMessages = pgTable(
  'mailbox_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    externalId: text('external_id').notNull(),
    subject: text('subject').notNull(),
    correspondent: text('correspondent').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('mailbox_message_idx').on(table.integrationId, table.externalId)],
)

export const integrationCredentials = pgTable('integration_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  integrationId: uuid('integration_id')
    .notNull()
    .unique()
    .references(() => integrations.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  nonce: text('nonce').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const immichInstances = pgTable('immich_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  integrationId: uuid('integration_id')
    .notNull()
    .references(() => integrations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  internalUrl: text('internal_url').notNull(),
  externalUrl: text('external_url').notNull(),
  status: text('status').notNull().default('disconnected'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const immichPeople = pgTable(
  'immich_people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => immichInstances.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    name: text('name'),
    thumbnailPath: text('thumbnail_path'),
    assetCount: integer('asset_count'),
    isHidden: boolean('is_hidden').notNull().default(false),
    raw: jsonb('raw').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('immich_people_external_idx').on(table.instanceId, table.externalId)],
)

export const contactExternalIdentities = pgTable(
  'contact_external_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    instanceId: uuid('instance_id').references(() => immichInstances.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('external_identity_idx').on(table.instanceId, table.externalId)],
)

export const immichAssets = pgTable(
  'immich_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => immichInstances.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    kind: text('kind'),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    thumbnailPath: text('thumbnail_path'),
    raw: jsonb('raw').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('immich_asset_external_idx').on(table.instanceId, table.externalId)],
)

export const activityAssets = pgTable(
  'activity_assets',
  {
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    immichAssetId: uuid('immich_asset_id')
      .notNull()
      .references(() => immichAssets.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.activityId, table.immichAssetId] })],
)

export const syncJobs = pgTable('sync_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  integrationId: uuid('integration_id').references(() => integrations.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const serverSettings = pgTable('server_settings', {
  key: text('key').primaryKey(),
  settings: jsonb('settings').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const serverSecrets = pgTable('server_secrets', {
  key: text('key').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  nonce: text('nonce').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    email: text('email'),
    role: text('role'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('oauth_account_idx').on(table.issuer, table.subject)],
)

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  nonce: text('nonce').notNull(),
  verifier: text('verifier').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const oauthExchanges = pgTable('oauth_exchanges', {
  codeHash: text('code_hash').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  nonce: text('nonce').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: text('channel').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('notification_delivery_idx').on(table.channel, table.dedupeKey)],
)

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    uid: text('uid').notNull(),
    type: text('type').notNull(),
    summary: text('summary').notNull(),
    description: text('description'),
    location: text('location'),
    status: text('status').notNull().default('CONFIRMED'),
    priority: integer('priority').notNull().default(0),
    rrule: text('rrule'),
    url: text('url'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }),
    allDay: boolean('all_day').notNull().default(false),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('calendar_events_uid_idx').on(table.workspaceId, table.uid),
    index('calendar_events_start_idx').on(table.workspaceId, table.startAt),
  ],
)

export const aiSuggestions = pgTable(
  'ai_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    value: text('value').notNull(),
    sourceUrl: text('source_url').notNull(),
    excerpt: text('excerpt').notNull(),
    status: text('status').notNull().default('pending'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [index('ai_suggestions_contact_idx').on(table.contactId, table.status)],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    diff: jsonb('diff'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_logs_workspace_idx').on(table.workspaceId, table.createdAt)],
)
