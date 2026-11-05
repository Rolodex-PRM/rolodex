import { contactTypes, workspaceRoles } from '@rolodex/db'
import { z } from 'zod'
import { AppError } from './errors'

const optionalText = (max: number) => z.string().max(max).nullish()

export const registerSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(120).optional(),
  invite: z.string().trim().max(200).optional(),
})

export const passwordResetSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(8).max(200),
})

export const registrationPolicySchema = z.object({
  inviteOnly: z.boolean(),
})

export const appearanceSchema = z.object({
  css: z.string().max(20000),
  userCss: z.boolean(),
})

export const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional(),
})

export const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

export const memberSchema = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(workspaceRoles),
})

export const memberRoleSchema = z.object({
  role: z.enum(workspaceRoles),
})

export const addressBookSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(500),
})

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().max(20).nullish(),
})

const methodSchema = z.object({
  kind: z.enum(['email', 'phone', 'social', 'messaging']),
  label: z.string().max(40).nullish(),
  value: z.string().trim().min(1).max(500),
  isPrimary: z.boolean().optional(),
})

const addressSchema = z.object({
  label: z.string().max(40).nullish(),
  street: z.string().max(200).nullish(),
  street2: z.string().max(200).nullish(),
  city: z.string().max(120).nullish(),
  region: z.string().max(120).nullish(),
  postalCode: z.string().max(40).nullish(),
  country: z.string().max(120).nullish(),
  lat: z.number().finite().min(-90).max(90).nullish(),
  lon: z.number().finite().min(-180).max(180).nullish(),
})

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
  .nullish()

export const contactSchema = z.object({
  addressBookId: z.string().uuid().optional(),
  addressBookIds: z.array(z.string().uuid()).max(20).optional(),
  type: z.enum(contactTypes).optional(),
  prefix: optionalText(40),
  firstName: optionalText(120),
  middleName: optionalText(120),
  lastName: optionalText(120),
  suffix: optionalText(40),
  preferredName: optionalText(120),
  nickname: optionalText(120),
  organizationName: optionalText(200),
  department: optionalText(120),
  title: optionalText(120),
  position: optionalText(120),
  birthday: dateField,
  anniversary: dateField,
  website: optionalText(500),
  cardNote: optionalText(8000),
  howWeMet: optionalText(2000),
  introducedByContactId: z.string().uuid().nullish(),
  preferredCommunication: optionalText(80),
  interests: optionalText(4000),
  personalDetails: optionalText(8000),
  professionalBackground: optionalText(8000),
  followUpFrequency: optionalText(80),
  methods: z.array(methodSchema).max(30).optional(),
  addresses: z.array(addressSchema).max(10).optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
})

export const importSchema = z.object({
  vcf: z.string().min(1).max(5_000_000),
  commit: z.boolean().optional(),
  decisions: z
    .array(
      z.object({
        fingerprint: z.string().min(1).max(80),
        action: z.enum(['create', 'skip']),
      }),
    )
    .max(5000)
    .optional(),
})

export const appPasswordSchema = z.object({
  label: z.string().trim().min(1).max(80),
})

export const cadenceValues = ['7', '14', '30', '90', '180', '365'] as const

export const relationshipTypeSchema = z.object({
  label: z.string().trim().min(1).max(80),
  reciprocalLabel: z.string().trim().min(1).max(80),
})

export const relationshipSchema = z.object({
  toContactId: z.string().uuid(),
  typeId: z.string().uuid(),
  side: z.enum(['label', 'reciprocal']),
})

const placeFields = {
  street: optionalText(200),
  city: optionalText(120),
  region: optionalText(120),
  postalCode: optionalText(40),
  country: optionalText(120),
}

export const organizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  industry: optionalText(200),
  website: optionalText(500),
  email: optionalText(200),
  phone: optionalText(80),
  ...placeFields,
  notes: optionalText(4000),
})

export const organizationMemberSchema = z.object({
  contactId: z.string().uuid(),
  department: optionalText(120),
  title: optionalText(120),
  isPrimary: z.boolean().optional(),
})

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  visibility: z.enum(['private', 'workspace']).optional(),
  contactId: z.string().uuid(),
})

export const activitySchema = z.object({
  type: z.string().trim().min(1).max(40),
  occurredAt: z.string().min(4).max(40),
  description: optionalText(4000),
  location: optionalText(200),
  visibility: z.enum(['private', 'workspace']).optional(),
  contactIds: z.array(z.string().uuid()).min(1).max(30),
})

export const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueAt: z.string().min(4).max(40).nullish(),
  priority: z.number().int().min(0).max(9).optional(),
  notes: z.string().trim().max(4000).optional().default(''),
  rrule: z.string().trim().max(200).nullish(),
  contactId: z.string().uuid().nullish(),
  activityId: z.string().uuid().nullish(),
  visibility: z.enum(['private', 'workspace']).optional(),
})

export const contactVisibilitySchema = z.object({
  visibility: z.enum(['workspace', 'restricted']),
})

export const contactOwnerSchema = z.object({
  userId: z.string().uuid(),
})

export const coverModeSchema = z.object({
  mode: z.enum(['image', 'cycle']),
})

export const contactGrantSchema = z
  .object({
    userId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    role: z.enum(['viewer', 'editor']),
  })
  .refine((value) => Boolean(value.userId) !== Boolean(value.groupId), { message: 'Choose a person or a group' })

export const userGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  minRole: z.enum(['viewer', 'editor']).default('viewer'),
})

export const userGroupUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  minRole: z.enum(['viewer', 'editor']).optional(),
})

export const userGroupMemberSchema = z.object({
  userId: z.string().uuid(),
})

export const contactDateSchema = z.object({
  label: z.string().trim().min(1).max(80),
  occursOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like YYYY-MM-DD'),
})

export const reminderSchema = z.object({
  type: z.string().trim().min(1).max(40),
  remindAt: z.string().min(4).max(40),
  recurrence: optionalText(40),
  contactId: z.string().uuid().nullish(),
  taskId: z.string().uuid().nullish(),
})

export const completeSchema = z.object({ completed: z.boolean() })

export const customFieldSchema = z.object({
  label: z.string().trim().min(1).max(80),
  fieldType: z.enum(['text', 'number', 'date', 'boolean']),
})

export const customValueSchema = z.object({
  value: z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]),
})

export const mapSettingsSchema = z.object({
  engine: z.enum(['leaflet', 'mapbox', 'maplibre']),
  templateId: z.string().max(40).optional().default('osm'),
  tileUrl: z.string().max(500).optional().default(''),
  cartoKey: z.string().max(200).optional().default(''),
  mapboxToken: z.string().max(300).optional().default(''),
  googleKey: z.string().max(300).optional().default(''),
})

export const addressLocationSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
})

export const addonSchema = z.object({
  enabled: z.boolean(),
})

export const aiSettingsSchema = z.object({
  baseUrl: z.string().trim().min(1).max(300),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().max(500).optional().default(''),
})

export const calendarEventSchema = z.object({
  type: z.string().trim().min(1).max(40),
  summary: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().default(''),
  date: z.string().trim().min(10).max(40),
  endDate: z.string().trim().min(10).max(40).optional(),
  allDay: z.boolean().optional().default(true),
  startTime: z.string().trim().max(8).nullish(),
  endTime: z.string().trim().max(8).nullish(),
  location: z.string().trim().max(300).optional().default(''),
  status: z.enum(['CONFIRMED', 'TENTATIVE', 'CANCELLED']).optional().default('CONFIRMED'),
  priority: z.number().int().min(0).max(9).optional().default(0),
  rrule: z.string().trim().max(200).nullish(),
  url: z.string().trim().max(500).optional().default(''),
  contactId: z.string().uuid().nullable().optional(),
})

export const immichInstanceSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  internalUrl: z.string().trim().min(1).max(300),
  externalUrl: z.string().trim().max(300).optional().default(''),
  apiKey: z.string().max(500).optional().default(''),
})

export const immichTestSchema = z.object({
  instanceId: z.string().uuid().optional(),
  internalUrl: z.string().trim().min(1).max(300),
  apiKey: z.string().max(500).optional().default(''),
})

export const immichLinkSchema = z.object({ personId: z.string().uuid() })

export const immichPhotoSchema = z.object({
  personId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
})

export const immichAssetSchema = z.object({ assetId: z.string().uuid() })

export const oauthSettingsSchema = z.object({
  enabled: z.boolean(),
  issuerUrl: z.string().trim().max(500).default(''),
  clientId: z.string().trim().max(500).default(''),
  clientSecret: z.string().max(500).default(''),
  tokenEndpointAuthMethod: z.enum(['client_secret_post', 'client_secret_basic', 'none']),
  scope: z.string().trim().min(1).max(300),
  idTokenSignedResponseAlg: z.enum(['RS256', 'ES256', 'HS256']),
  userinfoSignedResponseAlg: z.enum(['none', 'RS256', 'ES256']),
  prompt: z.string().trim().max(120).default(''),
  endSessionEndpoint: z.string().trim().max(500).default(''),
  requestTimeoutMs: z.number().int().min(1000).max(120_000),
  allowInsecureRequests: z.boolean(),
  nameClaim: z.string().trim().max(80).default('preferred_username'),
  roleClaim: z.string().trim().max(80).default(''),
  buttonText: z.string().trim().min(1).max(80),
  accountManagementUrl: z.string().trim().max(500).default(''),
  autoRegister: z.boolean(),
  autoLaunch: z.boolean(),
  appUrl: z.string().trim().max(500),
  publicUrl: z.string().trim().max(500),
  mobileRedirectOverride: z.boolean(),
  mobileRedirectUri: z.string().trim().max(500).default(''),
})

export const notificationSettingsSchema = z.object({
  appUrl: z.string().trim().max(500).default(''),
  email: z.object({
    enabled: z.boolean(),
    host: z.string().trim().max(255).default(''),
    port: z.number().int().min(1).max(65535),
    username: z.string().max(320).default(''),
    password: z.string().max(500).default(''),
    secure: z.boolean(),
    ignoreCertificateErrors: z.boolean(),
    from: z.string().trim().max(320).default(''),
  }),
  push: z.object({
    enabled: z.boolean(),
    subject: z.string().trim().max(320).default(''),
  }),
  webhook: z.object({
    enabled: z.boolean(),
    url: z.string().trim().max(500).default(''),
    secret: z.string().max(500).default(''),
  }),
})

export const notificationTestSchema = z.object({
  channel: z.enum(['email', 'push', 'webhook']),
})

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(300),
    auth: z.string().min(1).max(300),
  }),
})

export const oauthExchangeSchema = z.object({
  code: z.string().min(10).max(200),
})

export const mfaSchema = z.object({
  ticket: z.string().min(20).max(4000),
  code: z.string().trim().min(6).max(12),
  remember: z.boolean().optional(),
})

export const totpConfirmSchema = z.object({
  secret: z.string().trim().min(16).max(80),
  code: z.string().trim().min(6).max(12),
})

export const totpCodeSchema = z.object({
  code: z.string().trim().min(6).max(12),
})

export const twoFactorPolicySchema = z.object({
  required: z.boolean(),
  authenticator: z.boolean(),
  email: z.boolean(),
})

export const mfaTicketSchema = z.object({
  ticket: z.string().min(20).max(4000),
})

export const trashPolicySchema = z.object({
  retentionDays: z.number().int().min(1).max(3650),
})

export const mailboxAccountSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  host: z.string().trim().min(1).max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(200),
  password: z.string().max(200).optional(),
})

export const calendarAccountSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(8).max(500),
  username: z.string().trim().min(1).max(200),
  password: z.string().max(200).optional(),
})

export function parseBody<Schema extends z.ZodTypeAny>(schema: Schema, body: unknown): z.output<Schema> {
  const result = schema.safeParse(body)
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(' ')
    throw new AppError(400, message || 'Invalid request')
  }
  return result.data
}
