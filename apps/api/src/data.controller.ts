import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  addOrganizationMember,
  agenda,
  addressBookSchema,
  addressLocationSchema,
  contactSchema,
  contactAccess,
  contactGrantSchema,
  contactOwnerSchema,
  coverModeSchema,
  contactVisibilitySchema,
  contactOrganizations,
  completeTask,
  completeSchema,
  createActivity,
  createAddressBook,
  createContact,
  createCustomField,
  createNote,
  createOrganization,
  createRelationship,
  createRelationshipType,
  createReminder,
  linkInteractionFile,
  unlinkInteractionFile,
  readableInteractionFile,
  createTag,
  createTask,
  createWorkspace,
  customFieldSchema,
  customValueSchema,
  deleteActivity,
  deleteAddressBook,
  deleteContact,
  deleteNote,
  deleteOrganization,
  deleteRelationship,
  deleteRelationshipType,
  deleteTask,
  exportAddressBook,
  getContact,
  grantContact,
  grantContactGroup,
  revokeContactGroupGrant,
  listContactDates,
  addContactDate,
  deleteContactDate,
  listUserGroups,
  createUserGroup,
  updateUserGroup,
  deleteUserGroup,
  addUserGroupMember,
  removeUserGroupMember,
  userGroupSchema,
  userGroupUpdateSchema,
  registrationPolicySchema,
  appearanceSchema,
  userGroupMemberSchema,
  contactDateSchema,
  listAudit,
  getOauthSettings,
  setOauthSettings,
  unlinkOauthAccounts,
  getNotificationSettings,
  setNotificationSettings,
  sendNotificationTest,
  oauthSettingsSchema,
  notificationSettingsSchema,
  notificationTestSchema,
  getMapSettings,
  addonSchema,
  listAddons,
  revokeContactGrant,
  setAddon,
  setContactOwner,
  setContactVisibility,
  attachImmichAsset,
  contactImmich,
  deleteImmichInstance,
  detachImmichAsset,
  immichAssetSchema,
  immichInstanceSchema,
  immichLinkSchema,
  immichPhotoSchema,
  immichTestSchema,
  linkImmichPerson,
  listImmichInstances,
  readImmichImage,
  readImmichProfileImage,
  saveImmichInstance,
  searchImmichPeople,
  syncWorkspaceImmich,
  testImmichConnection,
  unlinkImmichPerson,
  importAddressBook,
  importSchema,
  listActivities,
  listAddressBooks,
  listBookShares,
  listContacts,
  findDuplicates,
  mergeContacts,
  workspaceNetwork,
  egoNetwork,
  contactSummary,
  enrichContact,
  calendarMonth,
  calendarIcs,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  calendarEventSchema,
  getAiSettings,
  setAiSettings,
  testAiConnection,
  listSuggestions,
  suggestContactFields,
  approveSuggestion,
  rejectSuggestion,
  aiSettingsSchema,
  photoMemories,
  locateContact,
  listCustomFields,
  listMembers,
  inviteUser,
  sendPasswordReset,
  registrationPolicy,
  setRegistrationPolicy,
  publicAppearance,
  setAppearance,
  listNotes,
  listWorkspaceNotes,
  listRelationshipTypes,
  listOrganizations,
  listRelationships,
  listTags,
  listTasks,
  listWorkspaces,
  mapSettingsSchema,
  memberRoleSchema,
  memberSchema,
  noteSchema,
  organizationMemberSchema,
  organizationMembers,
  organizationSchema,
  parseBody,
  placeDetails,
  placeProviders,
  relationshipSchema,
  relationshipTypeSchema,
  reminderSchema,
  reverseWorkspacePlace,
  removeOrganizationMember,
  searchPlaces,
  searchWorkspacePlaces,
  activitySchema,
  addMember,
  removeMember,
  setContactPhoto,
  setContactCover,
  setContactCoverMode,
  setCustomValue,
  shareAddressBook,
  tagSchema,
  taskSchema,
  updateAddressBook,
  updateContact,
  updateOrganization,
  updateMapSettings,
  unshareAddressBook,
  updateMemberRole,
  workspacePlaceDetails,
  workspaceSchema,
  AppError,
  createRateLimiter,
} from '@rolodex/core'
import { attachments, type Database } from '@rolodex/db'
import { and, eq } from 'drizzle-orm'
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { AuthGuard, DB, STORAGE, type AuthedRequest } from './http'
import { deleteObject, fileKey, getObject, photoKey, putObject, type objectStorage } from './storage'

type Storage = ReturnType<typeof objectStorage>

const images = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const placeLimiter = createRateLimiter(30, 60_000)

@Controller()
@UseGuards(AuthGuard)
export class DataController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  @Get('workspaces')
  workspaces(@Req() req: AuthedRequest) {
    return listWorkspaces(this.db, req.user.id)
  }

  @Post('workspaces')
  async createWorkspace(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(workspaceSchema, body)
    const workspace = await createWorkspace(this.db, req.user.id, input.name)
    const book = await createAddressBook(this.db, req.user.id, workspace.id, 'Contacts')
    return { ...workspace, addressBookId: book.id }
  }

  @Get('workspaces/:workspaceId/members')
  members(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listMembers(this.db, req.user.id, workspaceId)
  }

  @Post('workspaces/:workspaceId/members')
  addMember(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = parseBody(memberSchema, body)
    return addMember(this.db, req.user.id, workspaceId, input.email, input.role)
  }

  @Patch('workspaces/:workspaceId/members/:memberId')
  updateMember(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(memberRoleSchema, body)
    return updateMemberRole(this.db, req.user.id, workspaceId, memberId, input.role)
  }

  @Get('workspaces/:workspaceId/registration')
  registration(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return registrationPolicy(this.db).then(async (policy) => {
      await listMembers(this.db, req.user.id, workspaceId)
      return policy
    })
  }

  @Put('workspaces/:workspaceId/registration')
  setRegistration(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = parseBody(registrationPolicySchema, body)
    return setRegistrationPolicy(this.db, req.user.id, workspaceId, input.inviteOnly)
  }

  @Post('workspaces/:workspaceId/invites')
  invite(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = parseBody(memberSchema, body)
    return inviteUser(this.db, req.user.id, workspaceId, input.email, input.role)
  }

  @Post('workspaces/:workspaceId/members/:memberId/reset')
  resetMember(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
  ) {
    return sendPasswordReset(this.db, req.user.id, workspaceId, memberId)
  }

  @Delete('workspaces/:workspaceId/members/:memberId')
  async removeMember(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
  ) {
    await removeMember(this.db, req.user.id, workspaceId, memberId)
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/tags')
  tags(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listTags(this.db, req.user.id, workspaceId)
  }

  @Post('workspaces/:workspaceId/tags')
  createTag(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = parseBody(tagSchema, body)
    return createTag(this.db, req.user.id, workspaceId, input.name, input.color)
  }

  @Get('workspaces/:workspaceId/contacts')
  contacts(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Query('q') q?: string,
    @Query('addressBookId') addressBookId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('city') city?: string,
    @Query('organization') organization?: string,
    @Query('relationship') relationship?: string,
    @Query('tag') tag?: string,
    @Query('birthdayMonth') birthdayMonth?: string,
    @Query('quietDays') quietDays?: string,
  ) {
    return listContacts(this.db, req.user.id, workspaceId, {
      q,
      addressBookId,
      city,
      organization,
      relationship,
      tag,
      birthdayMonth: birthdayMonth ? Number(birthdayMonth) : undefined,
      quietDays: quietDays ? Number(quietDays) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }

  @Get('search')
  search(@Req() req: AuthedRequest, @Query('workspaceId') workspaceId?: string, @Query('q') q?: string) {
    if (!workspaceId) throw new AppError(400, 'workspaceId is required')
    return listContacts(this.db, req.user.id, workspaceId, { q })
  }

  @Post('workspaces/:workspaceId/contacts')
  createContact(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return createContact(this.db, req.user.id, workspaceId, parseBody(contactSchema, body))
  }

  @Get('workspaces/:workspaceId/contacts/:contactId')
  contact(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return getContact(this.db, req.user.id, workspaceId, contactId)
  }

  @Get('workspaces/:workspaceId/audit')
  audit(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listAudit(this.db, req.user.id, workspaceId)
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/audit')
  contactAudit(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return listAudit(this.db, req.user.id, workspaceId, contactId)
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/access')
  access(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return contactAccess(this.db, req.user.id, workspaceId, contactId)
  }

  @Put('workspaces/:workspaceId/contacts/:contactId/access')
  changeAccess(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Body() body: unknown) {
    const input = parseBody(contactVisibilitySchema, body)
    return setContactVisibility(this.db, req.user.id, workspaceId, contactId, input.visibility)
  }

  @Put('workspaces/:workspaceId/contacts/:contactId/owner')
  changeOwner(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Body() body: unknown) {
    const input = parseBody(contactOwnerSchema, body)
    return setContactOwner(this.db, req.user.id, workspaceId, contactId, input.userId)
  }

  @Post('workspaces/:workspaceId/contacts/:contactId/grants')
  addGrant(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Body() body: unknown) {
    const input = parseBody(contactGrantSchema, body)
    if (input.groupId) return grantContactGroup(this.db, req.user.id, workspaceId, contactId, input.groupId, input.role)
    return grantContact(this.db, req.user.id, workspaceId, contactId, input.userId!, input.role)
  }

  @Delete('workspaces/:workspaceId/contacts/:contactId/groups/:groupId')
  removeGroupGrant(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @Param('groupId') groupId: string,
  ) {
    return revokeContactGroupGrant(this.db, req.user.id, workspaceId, contactId, groupId)
  }

  @Get('workspaces/:workspaceId/groups')
  groups(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listUserGroups(this.db, req.user.id, workspaceId)
  }

  @Post('workspaces/:workspaceId/groups')
  createGroup(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return createUserGroup(this.db, req.user.id, workspaceId, parseBody(userGroupSchema, body))
  }

  @Patch('workspaces/:workspaceId/groups/:groupId')
  updateGroup(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('groupId') groupId: string, @Body() body: unknown) {
    return updateUserGroup(this.db, req.user.id, workspaceId, groupId, parseBody(userGroupUpdateSchema, body))
  }

  @Delete('workspaces/:workspaceId/groups/:groupId')
  async removeGroup(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('groupId') groupId: string) {
    await deleteUserGroup(this.db, req.user.id, workspaceId, groupId)
    return { ok: true }
  }

  @Post('workspaces/:workspaceId/groups/:groupId/members')
  addGroupMember(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('groupId') groupId: string, @Body() body: unknown) {
    return addUserGroupMember(this.db, req.user.id, workspaceId, groupId, parseBody(userGroupMemberSchema, body))
  }

  @Delete('workspaces/:workspaceId/groups/:groupId/members/:memberId')
  async removeGroupMember(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('groupId') groupId: string,
    @Param('memberId') memberId: string,
  ) {
    await removeUserGroupMember(this.db, req.user.id, workspaceId, groupId, memberId)
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/dates')
  dates(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return listContactDates(this.db, req.user.id, workspaceId, contactId)
  }

  @Post('workspaces/:workspaceId/contacts/:contactId/dates')
  createDate(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Body() body: unknown) {
    return addContactDate(this.db, req.user.id, workspaceId, contactId, parseBody(contactDateSchema, body))
  }

  @Delete('workspaces/:workspaceId/contacts/:contactId/dates/:dateId')
  async removeDate(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @Param('dateId') dateId: string,
  ) {
    await deleteContactDate(this.db, req.user.id, workspaceId, contactId, dateId)
    return { ok: true }
  }

  @Delete('workspaces/:workspaceId/contacts/:contactId/grants/:userId')
  async removeGrant(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @Param('userId') granteeId: string,
  ) {
    return revokeContactGrant(this.db, req.user.id, workspaceId, contactId, granteeId)
  }

  @Patch('workspaces/:workspaceId/contacts/:contactId')
  updateContact(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @Body() body: unknown,
  ) {
    return updateContact(this.db, req.user.id, workspaceId, contactId, parseBody(contactSchema, body))
  }

  @Delete('workspaces/:workspaceId/contacts/:contactId')
  async deleteContact(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
  ) {
    await deleteContact(this.db, req.user.id, workspaceId, contactId)
    return { ok: true }
  }

  @Put('workspaces/:workspaceId/contacts/:contactId/location')
  placeContact(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(addressLocationSchema, body)
    return locateContact(this.db, req.user.id, workspaceId, contactId, input.lat, input.lon)
  }

  @Post('workspaces/:workspaceId/contacts/:contactId/photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async uploadPhoto(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @UploadedFile() file?: { mimetype: string; buffer: Buffer; originalname: string; size: number },
  ) {
    if (!file) throw new AppError(400, 'Choose an image file')
    await this.storeContactPhoto(req.user.id, workspaceId, contactId, file.buffer, file.mimetype, file.originalname || 'photo')
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/photo')
  async photo(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @Res() res: Response,
  ) {
    const contact = await getContact(this.db, req.user.id, workspaceId, contactId)
    if (!contact.photoAttachmentId) throw new AppError(404, 'No photo')
    const [attachment] = await this.db.select().from(attachments).where(eq(attachments.id, contact.photoAttachmentId)).limit(1)
    if (!attachment) throw new AppError(404, 'No photo')
    const object = await getObject(this.storage, attachment.storageKey)
    res.setHeader('Content-Type', object.contentType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(object.bytes)
  }

  @Post('workspaces/:workspaceId/contacts/:contactId/cover')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async uploadCover(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @UploadedFile() file?: { mimetype: string; buffer: Buffer; originalname: string; size: number },
  ) {
    if (!file) throw new AppError(400, 'Choose an image file')
    if (!images.has(file.mimetype)) throw new AppError(400, 'Use a JPEG, PNG, WebP, or GIF image')
    const contact = await getContact(this.db, req.user.id, workspaceId, contactId)
    const key = fileKey(workspaceId, `contacts/${contactId}/cover`, file.originalname || 'cover')
    await putObject(this.storage, key, file.buffer, file.mimetype)
    const [attachment] = await this.db
      .insert(attachments)
      .values({ workspaceId, ownerId: req.user.id, storageKey: key, filename: file.originalname || 'cover', contentType: file.mimetype, sizeBytes: file.buffer.length })
      .returning()
    if (!attachment) throw new AppError(500, 'Could not store the cover')
    await setContactCover(this.db, req.user.id, workspaceId, contactId, attachment.id)
    if (contact.coverAttachmentId && contact.coverAttachmentId !== attachment.id) await this.removeAttachment(contact.coverAttachmentId)
    return getContact(this.db, req.user.id, workspaceId, contactId)
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/cover')
  async cover(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @Res() res: Response,
  ) {
    const contact = await getContact(this.db, req.user.id, workspaceId, contactId)
    if (!contact.coverAttachmentId) throw new AppError(404, 'No cover photo')
    const [attachment] = await this.db.select().from(attachments).where(eq(attachments.id, contact.coverAttachmentId)).limit(1)
    if (!attachment) throw new AppError(404, 'No cover photo')
    const object = await getObject(this.storage, attachment.storageKey)
    res.setHeader('Content-Type', object.contentType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(object.bytes)
  }

  @Put('workspaces/:workspaceId/contacts/:contactId/cover')
  setCoverMode(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Body() body: unknown) {
    const input = parseBody(coverModeSchema, body)
    return setContactCoverMode(this.db, req.user.id, workspaceId, contactId, input.mode)
  }

  @Delete('workspaces/:workspaceId/contacts/:contactId/cover')
  async deleteCover(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    const contact = await getContact(this.db, req.user.id, workspaceId, contactId)
    await setContactCover(this.db, req.user.id, workspaceId, contactId, null)
    if (contact.coverAttachmentId) await this.removeAttachment(contact.coverAttachmentId)
    return getContact(this.db, req.user.id, workspaceId, contactId)
  }

  @Delete('workspaces/:workspaceId/contacts/:contactId/photo')
  async deletePhoto(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
  ) {
    const contact = await getContact(this.db, req.user.id, workspaceId, contactId)
    await setContactPhoto(this.db, req.user.id, workspaceId, contactId, null)
    if (contact.photoAttachmentId) await this.removeAttachment(contact.photoAttachmentId)
    return { ok: true }
  }

  @Get('places')
  places(@Req() req: AuthedRequest, @Query('q') q = '', @Query('provider') provider = 'osm') {
    if (!placeLimiter(req.user.id)) throw new AppError(429, 'Too many address searches. Wait a moment.')
    return searchPlaces(q, provider === 'google' ? 'google' : 'osm')
  }

  @Get('places/providers')
  providers() {
    return placeProviders()
  }

  @Get('places/google/:placeId')
  googlePlace(@Param('placeId') placeId: string) {
    return placeDetails('google', placeId)
  }

  @Get('workspaces/:workspaceId/map')
  mapSettings(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return getMapSettings(this.db, req.user.id, workspaceId)
  }

  @Put('workspaces/:workspaceId/map')
  saveMap(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = parseBody(mapSettingsSchema, body)
    return updateMapSettings(this.db, req.user.id, workspaceId, {
      engine: input.engine,
      templateId: input.templateId ?? 'osm',
      tileUrl: input.tileUrl ?? '',
      cartoKey: input.cartoKey ?? '',
      mapboxToken: input.mapboxToken ?? '',
      googleKey: input.googleKey ?? '',
    })
  }

  @Get('workspaces/:workspaceId/places')
  workspacePlaces(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Query('q') q = '') {
    if (!placeLimiter(req.user.id)) throw new AppError(429, 'Too many address searches. Wait a moment.')
    return searchWorkspacePlaces(this.db, req.user.id, workspaceId, q)
  }

  @Get('workspaces/:workspaceId/places/details')
  workspacePlace(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Query('id') id = '') {
    if (!placeLimiter(req.user.id)) throw new AppError(429, 'Too many address searches. Wait a moment.')
    return workspacePlaceDetails(this.db, req.user.id, workspaceId, id)
  }

  @Get('workspaces/:workspaceId/places/reverse')
  reversePlace(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Query('lat') lat = '', @Query('lon') lon = '') {
    if (!placeLimiter(req.user.id)) throw new AppError(429, 'Too many address searches. Wait a moment.')
    return reverseWorkspacePlace(this.db, req.user.id, workspaceId, Number(lat), Number(lon))
  }

  @Get('workspaces/:workspaceId/agenda')
  workspaceAgenda(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return agenda(this.db, req.user.id, workspaceId)
  }

  @Get('workspaces/:workspaceId/network')
  network(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return workspaceNetwork(this.db, req.user.id, workspaceId)
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/network')
  contactNetwork(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return egoNetwork(this.db, req.user.id, workspaceId, contactId)
  }

  @Get('workspaces/:workspaceId/duplicates')
  duplicates(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return findDuplicates(this.db, req.user.id, workspaceId)
  }

  @Post('workspaces/:workspaceId/contacts/:contactId/merge')
  merge(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Body() body: { duplicateId?: string }) {
    if (!body.duplicateId) throw new AppError(400, 'Choose the duplicate to merge')
    return mergeContacts(this.db, req.user.id, workspaceId, contactId, body.duplicateId)
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/summary')
  summary(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return contactSummary(this.db, req.user.id, workspaceId, contactId)
  }

  @Post('workspaces/:workspaceId/contacts/:contactId/enrich')
  enrich(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return enrichContact(this.db, req.user.id, workspaceId, contactId)
  }

  @Get('workspaces/:workspaceId/calendar')
  calendar(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Query('year') year?: string, @Query('month') month?: string) {
    const now = new Date()
    return calendarMonth(this.db, req.user.id, workspaceId, year ? Number(year) : now.getFullYear(), month ? Number(month) : now.getMonth() + 1)
  }

  @Get('workspaces/:workspaceId/calendar.ics')
  async calendarFile(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Query('year') year: string, @Query('month') month: string, @Res() res: Response) {
    const now = new Date()
    const data = await calendarMonth(this.db, req.user.id, workspaceId, year ? Number(year) : now.getFullYear(), month ? Number(month) : now.getMonth() + 1)
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="rolodex.ics"')
    res.send(calendarIcs(data.events))
  }

  @Post('workspaces/:workspaceId/calendar/events')
  createEvent(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return createCalendarEvent(this.db, req.user.id, workspaceId, parseBody(calendarEventSchema, body))
  }

  @Patch('workspaces/:workspaceId/calendar/events/:eventId')
  editEvent(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('eventId') eventId: string, @Body() body: unknown) {
    return updateCalendarEvent(this.db, req.user.id, workspaceId, eventId, parseBody(calendarEventSchema, body))
  }

  @Delete('workspaces/:workspaceId/calendar/events/:eventId')
  async removeEvent(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('eventId') eventId: string) {
    await deleteCalendarEvent(this.db, req.user.id, workspaceId, eventId)
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/ai')
  aiSettings(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return getAiSettings(this.db, req.user.id, workspaceId)
  }

  @Put('workspaces/:workspaceId/ai')
  saveAi(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return setAiSettings(this.db, req.user.id, workspaceId, parseBody(aiSettingsSchema, body))
  }

  @Post('workspaces/:workspaceId/ai/test')
  testAi(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return testAiConnection(this.db, req.user.id, workspaceId)
  }

  @Get('workspaces/:workspaceId/ai/suggestions')
  suggestions(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Query('contactId') contactId?: string, @Query('status') status?: string) {
    return listSuggestions(this.db, req.user.id, workspaceId, contactId, status || 'pending')
  }

  @Post('workspaces/:workspaceId/contacts/:contactId/ai/suggest')
  suggest(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return suggestContactFields(this.db, req.user.id, workspaceId, contactId)
  }

  @Post('workspaces/:workspaceId/ai/suggestions/:suggestionId/approve')
  approve(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('suggestionId') suggestionId: string) {
    return approveSuggestion(this.db, req.user.id, workspaceId, suggestionId)
  }

  @Post('workspaces/:workspaceId/ai/suggestions/:suggestionId/reject')
  reject(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('suggestionId') suggestionId: string) {
    return rejectSuggestion(this.db, req.user.id, workspaceId, suggestionId)
  }

  @Get('workspaces/:workspaceId/memories')
  memories(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return photoMemories(this.db, req.user.id, workspaceId)
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/relationships')
  relationships(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return listRelationships(this.db, req.user.id, workspaceId, contactId)
  }

  @Post('workspaces/:workspaceId/contacts/:contactId/relationships')
  addRelationship(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Body() body: unknown) {
    return createRelationship(this.db, req.user.id, workspaceId, contactId, parseBody(relationshipSchema, body))
  }

  @Delete('workspaces/:workspaceId/relationships/:relationshipId')
  async removeRelationship(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('relationshipId') relationshipId: string) {
    await deleteRelationship(this.db, req.user.id, workspaceId, relationshipId)
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/relationship-types')
  relationshipTypes(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listRelationshipTypes(this.db, req.user.id, workspaceId)
  }

  @Post('workspaces/:workspaceId/relationship-types')
  addRelationshipType(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return createRelationshipType(this.db, req.user.id, workspaceId, parseBody(relationshipTypeSchema, body))
  }

  @Delete('workspaces/:workspaceId/relationship-types/:typeId')
  async removeRelationshipType(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('typeId') typeId: string) {
    await deleteRelationshipType(this.db, req.user.id, workspaceId, typeId)
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/organizations')
  organizations(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listOrganizations(this.db, req.user.id, workspaceId)
  }

  @Post('workspaces/:workspaceId/organizations')
  addOrganization(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return createOrganization(this.db, req.user.id, workspaceId, parseBody(organizationSchema, body))
  }

  @Patch('workspaces/:workspaceId/organizations/:organizationId')
  editOrganization(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('organizationId') organizationId: string, @Body() body: unknown) {
    return updateOrganization(this.db, req.user.id, workspaceId, organizationId, parseBody(organizationSchema, body))
  }

  @Delete('workspaces/:workspaceId/organizations/:organizationId')
  async removeOrganization(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('organizationId') organizationId: string) {
    await deleteOrganization(this.db, req.user.id, workspaceId, organizationId)
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/organizations/:organizationId/members')
  orgMembers(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('organizationId') organizationId: string) {
    return organizationMembers(this.db, req.user.id, workspaceId, organizationId)
  }

  @Post('workspaces/:workspaceId/organizations/:organizationId/members')
  addToOrganization(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('organizationId') organizationId: string, @Body() body: unknown) {
    return addOrganizationMember(this.db, req.user.id, workspaceId, organizationId, parseBody(organizationMemberSchema, body))
  }

  @Delete('workspaces/:workspaceId/organizations/:organizationId/members/:contactId')
  async removeFromOrganization(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('organizationId') organizationId: string,
    @Param('contactId') contactId: string,
  ) {
    await removeOrganizationMember(this.db, req.user.id, workspaceId, organizationId, contactId)
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/organizations')
  personOrganizations(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return contactOrganizations(this.db, req.user.id, workspaceId, contactId)
  }

  @Get('workspaces/:workspaceId/notes')
  workspaceNotes(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listWorkspaceNotes(this.db, req.user.id, workspaceId)
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/notes')
  notes(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return listNotes(this.db, req.user.id, workspaceId, contactId)
  }

  @Post('workspaces/:workspaceId/notes')
  addNote(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return createNote(this.db, req.user.id, workspaceId, parseBody(noteSchema, body))
  }

  @Post('workspaces/:workspaceId/notes/:noteId/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  addNoteFile(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('noteId') noteId: string,
    @UploadedFile() file?: { mimetype: string; buffer: Buffer; originalname: string; size: number },
  ) {
    return this.storeInteractionFile(req.user.id, workspaceId, { noteId }, file)
  }

  @Delete('workspaces/:workspaceId/notes/:noteId')
  async removeNote(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('noteId') noteId: string) {
    await deleteNote(this.db, req.user.id, workspaceId, noteId)
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/activities')
  activities(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Query('contactId') contactId?: string) {
    return listActivities(this.db, req.user.id, workspaceId, contactId)
  }

  @Post('workspaces/:workspaceId/activities/:activityId/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  addActivityFile(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('activityId') activityId: string,
    @UploadedFile() file?: { mimetype: string; buffer: Buffer; originalname: string; size: number },
  ) {
    return this.storeInteractionFile(req.user.id, workspaceId, { activityId }, file)
  }

  @Get('workspaces/:workspaceId/files/:attachmentId')
  async interactionFile(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const file = await readableInteractionFile(this.db, req.user.id, workspaceId, attachmentId)
    const object = await getObject(this.storage, file.storageKey)
    const name = file.filename.replace(/["\r\n]/g, '')
    res.setHeader('Content-Type', object.contentType || file.contentType)
    res.setHeader('Content-Disposition', `inline; filename="${name}"`)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(object.bytes)
  }

  @Delete('workspaces/:workspaceId/files/:attachmentId')
  async removeInteractionFile(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('attachmentId') attachmentId: string) {
    const id = await unlinkInteractionFile(this.db, req.user.id, workspaceId, attachmentId)
    await this.removeAttachment(id)
    return { ok: true }
  }

  @Post('workspaces/:workspaceId/activities')
  addActivity(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return createActivity(this.db, req.user.id, workspaceId, parseBody(activitySchema, body))
  }

  @Delete('workspaces/:workspaceId/activities/:activityId')
  async removeActivity(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('activityId') activityId: string) {
    await deleteActivity(this.db, req.user.id, workspaceId, activityId)
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/tasks')
  tasks(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Query('contactId') contactId?: string) {
    return listTasks(this.db, req.user.id, workspaceId, contactId)
  }

  @Post('workspaces/:workspaceId/tasks')
  addTask(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return createTask(this.db, req.user.id, workspaceId, parseBody(taskSchema, body))
  }

  @Post('workspaces/:workspaceId/tasks/:taskId/complete')
  finishTask(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Body() body: unknown) {
    const input = parseBody(completeSchema, body)
    return completeTask(this.db, req.user.id, workspaceId, taskId, input.completed)
  }

  @Delete('workspaces/:workspaceId/tasks/:taskId')
  async removeTask(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string) {
    await deleteTask(this.db, req.user.id, workspaceId, taskId)
    return { ok: true }
  }

  @Post('workspaces/:workspaceId/reminders')
  addReminder(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return createReminder(this.db, req.user.id, workspaceId, parseBody(reminderSchema, body))
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/fields')
  fields(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return listCustomFields(this.db, req.user.id, workspaceId, contactId)
  }

  @Post('workspaces/:workspaceId/fields')
  addField(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return createCustomField(this.db, req.user.id, workspaceId, parseBody(customFieldSchema, body))
  }

  @Put('workspaces/:workspaceId/contacts/:contactId/fields/:definitionId')
  saveField(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @Param('definitionId') definitionId: string,
    @Body() body: unknown,
  ) {
    return setCustomValue(this.db, req.user.id, workspaceId, contactId, definitionId, parseBody(customValueSchema, body))
  }

  @Get('workspaces/:workspaceId/address-books')
  addressBooks(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listAddressBooks(this.db, req.user.id, workspaceId)
  }

  @Post('workspaces/:workspaceId/address-books')
  createBook(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = parseBody(addressBookSchema, body)
    return createAddressBook(this.db, req.user.id, workspaceId, input.name, undefined, input.description)
  }

  @Patch('workspaces/:workspaceId/address-books/:bookId')
  updateBook(
    @Req() req: AuthedRequest,
    @Param('bookId') bookId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(addressBookSchema.partial(), body)
    return updateAddressBook(this.db, req.user.id, bookId, input)
  }

  @Delete('workspaces/:workspaceId/address-books/:bookId')
  async deleteBook(@Req() req: AuthedRequest, @Param('bookId') bookId: string) {
    await deleteAddressBook(this.db, req.user.id, bookId)
    return { ok: true }
  }

  @Get('workspaces/:workspaceId/address-books/:bookId/export')
  async exportBook(@Req() req: AuthedRequest, @Param('bookId') bookId: string, @Res() res: Response) {
    const file = await exportAddressBook(this.db, req.user.id, bookId)
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
    res.send(file.body)
  }

  @Get('workspaces/:workspaceId/address-books/:bookId/shares')
  bookShares(@Req() req: AuthedRequest, @Param('bookId') bookId: string) {
    return listBookShares(this.db, req.user.id, bookId)
  }

  @Post('workspaces/:workspaceId/address-books/:bookId/shares')
  shareBook(@Req() req: AuthedRequest, @Param('bookId') bookId: string, @Body() body: unknown) {
    const input = parseBody(memberSchema, body)
    return shareAddressBook(this.db, req.user.id, bookId, input.email, input.role)
  }

  @Delete('workspaces/:workspaceId/address-books/:bookId/shares/:memberId')
  async unshareBook(@Req() req: AuthedRequest, @Param('bookId') bookId: string, @Param('memberId') memberId: string) {
    await unshareAddressBook(this.db, req.user.id, bookId, memberId)
    return { ok: true }
  }

  @Post('workspaces/:workspaceId/address-books/:bookId/import')
  importBook(@Req() req: AuthedRequest, @Param('bookId') bookId: string, @Body() body: unknown) {
    return importAddressBook(this.db, req.user.id, bookId, parseBody(importSchema, body))
  }

  @Post('backups')
  async backup(@Req() req: AuthedRequest) {
    const workspaces = await listWorkspaces(this.db, req.user.id)
    if (!workspaces.some((workspace) => workspace.role === 'owner')) {
      throw new AppError(403, 'Only an owner can create a backup')
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = join(process.env.BACKUP_DIR || 'backups', stamp)
    await mkdir(dir, { recursive: true })
    await dumpDatabase(join(dir, 'database.sql'))
    return { ok: true, path: dir }
  }

  @Get('workspaces/:workspaceId/appearance')
  appearance(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return publicAppearance(this.db).then(async (appearance) => {
      await listMembers(this.db, req.user.id, workspaceId)
      return appearance
    })
  }

  @Put('workspaces/:workspaceId/appearance')
  saveAppearance(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return setAppearance(this.db, req.user.id, workspaceId, parseBody(appearanceSchema, body))
  }

  @Get('workspaces/:workspaceId/addons')
  addons(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listAddons(this.db, req.user.id, workspaceId)
  }

  @Put('workspaces/:workspaceId/addons/:addonId')
  updateAddon(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('addonId') addonId: string, @Body() body: unknown) {
    const input = parseBody(addonSchema, body)
    return setAddon(this.db, req.user.id, workspaceId, addonId, input.enabled)
  }

  @Get('workspaces/:workspaceId/immich')
  immichInstances(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listImmichInstances(this.db, req.user.id, workspaceId)
  }

  @Post('workspaces/:workspaceId/immich')
  addImmich(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return saveImmichInstance(this.db, req.user.id, workspaceId, parseBody(immichInstanceSchema, body))
  }

  @Patch('workspaces/:workspaceId/immich/:instanceId')
  editImmich(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('instanceId') instanceId: string, @Body() body: unknown) {
    const input = parseBody(immichInstanceSchema, body)
    return saveImmichInstance(this.db, req.user.id, workspaceId, { ...input, id: instanceId })
  }

  @Delete('workspaces/:workspaceId/immich/:instanceId')
  async removeImmich(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('instanceId') instanceId: string) {
    await deleteImmichInstance(this.db, req.user.id, workspaceId, instanceId)
    return { ok: true }
  }

  @Post('workspaces/:workspaceId/immich/test')
  testImmich(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return testImmichConnection(this.db, req.user.id, workspaceId, parseBody(immichTestSchema, body))
  }

  @Post('workspaces/:workspaceId/immich/:instanceId/sync')
  syncImmich(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('instanceId') instanceId: string) {
    return syncWorkspaceImmich(this.db, req.user.id, workspaceId, instanceId)
  }

  @Get('workspaces/:workspaceId/immich/people')
  immichPeople(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Query('q') q = '') {
    return searchImmichPeople(this.db, req.user.id, workspaceId, q)
  }

  @Get('workspaces/:workspaceId/immich/people/:personId/thumbnail')
  async immichPersonThumbnail(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('personId') personId: string,
    @Res() res: Response,
  ) {
    const image = await readImmichImage(this.db, req.user.id, workspaceId, { personId })
    res.setHeader('Content-Type', image.contentType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(image.bytes)
  }

  @Get('workspaces/:workspaceId/immich/assets/:assetId/thumbnail')
  async immichAssetThumbnail(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('assetId') assetId: string,
    @Res() res: Response,
  ) {
    const image = await readImmichImage(this.db, req.user.id, workspaceId, { assetId })
    res.setHeader('Content-Type', image.contentType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(image.bytes)
  }

  @Get('workspaces/:workspaceId/contacts/:contactId/immich')
  contactPhotos(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string) {
    return contactImmich(this.db, req.user.id, workspaceId, contactId)
  }

  @Post('workspaces/:workspaceId/contacts/:contactId/immich')
  linkPerson(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Body() body: unknown) {
    const input = parseBody(immichLinkSchema, body)
    return linkImmichPerson(this.db, req.user.id, workspaceId, contactId, input.personId)
  }

  @Delete('workspaces/:workspaceId/contacts/:contactId/immich/:identityId')
  async unlinkPerson(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @Param('identityId') identityId: string,
  ) {
    await unlinkImmichPerson(this.db, req.user.id, workspaceId, contactId, identityId)
    return { ok: true }
  }

  @Post('workspaces/:workspaceId/contacts/:contactId/immich/photo')
  async immichProfilePhoto(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('contactId') contactId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(immichPhotoSchema, body)
    if (!input.personId && !input.assetId) throw new AppError(400, 'Choose a photo')
    const image = await readImmichProfileImage(this.db, req.user.id, workspaceId, input)
    await this.storeContactPhoto(req.user.id, workspaceId, contactId, image.bytes, image.contentType, 'immich-photo')
    return { ok: true }
  }

  @Post('workspaces/:workspaceId/activities/:activityId/immich')
  attachPhoto(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('activityId') activityId: string, @Body() body: unknown) {
    const input = parseBody(immichAssetSchema, body)
    return attachImmichAsset(this.db, req.user.id, workspaceId, activityId, input.assetId)
  }

  @Delete('workspaces/:workspaceId/activities/:activityId/immich/:assetId')
  async detachPhoto(
    @Req() req: AuthedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('activityId') activityId: string,
    @Param('assetId') assetId: string,
  ) {
    await detachImmichAsset(this.db, req.user.id, workspaceId, activityId, assetId)
    return { ok: true }
  }

  private async storeInteractionFile(
    userId: string,
    workspaceId: string,
    target: { noteId?: string; activityId?: string },
    file?: { mimetype: string; buffer: Buffer; originalname: string; size: number },
  ) {
    if (!file?.buffer?.length) throw new AppError(400, 'Choose a file')
    const scope = target.noteId ? `notes/${target.noteId}` : `activities/${target.activityId}`
    const key = fileKey(workspaceId, scope, file.originalname || 'file')
    await putObject(this.storage, key, file.buffer, file.mimetype || 'application/octet-stream')
    const [attachment] = await this.db
      .insert(attachments)
      .values({
        workspaceId,
        ownerId: userId,
        storageKey: key,
        filename: file.originalname || 'file',
        contentType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.buffer.length,
      })
      .returning()
    if (!attachment) throw new AppError(500, 'Could not store the file')
    try {
      return await linkInteractionFile(this.db, userId, workspaceId, target, attachment.id)
    } catch (error) {
      await this.removeAttachment(attachment.id)
      throw error
    }
  }

  private async storeContactPhoto(userId: string, workspaceId: string, contactId: string, bytes: Buffer, contentType: string, filename: string) {
    if (!images.has(contentType)) throw new AppError(400, 'Use a JPEG, PNG, WebP, or GIF image')
    const contact = await getContact(this.db, userId, workspaceId, contactId)
    const key = photoKey(workspaceId, contactId, filename)
    await putObject(this.storage, key, bytes, contentType)
    const [attachment] = await this.db
      .insert(attachments)
      .values({ workspaceId, ownerId: userId, storageKey: key, filename, contentType, sizeBytes: bytes.length })
      .returning()
    if (!attachment) throw new AppError(500, 'Could not store the photo')
    const previous = contact.photoAttachmentId
    await setContactPhoto(this.db, userId, workspaceId, contactId, attachment.id)
    if (previous) await this.removeAttachment(previous)
  }

  private async removeAttachment(id: string) {
    const [attachment] = await this.db.select().from(attachments).where(eq(attachments.id, id)).limit(1)
    if (!attachment) return
    await this.db.delete(attachments).where(and(eq(attachments.id, id)))
    try {
      await deleteObject(this.storage, attachment.storageKey)
    } catch (error) {
      console.error('Could not delete stored photo', error)
    }
  }

  @Get('workspaces/:workspaceId/server/oauth')
  oauthSettings(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return getOauthSettings(this.db, req.user.id, workspaceId)
  }

  @Put('workspaces/:workspaceId/server/oauth')
  saveOauth(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return setOauthSettings(this.db, req.user.id, workspaceId, parseBody(oauthSettingsSchema, body))
  }

  @Post('workspaces/:workspaceId/server/oauth/unlink')
  unlinkOauth(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return unlinkOauthAccounts(this.db, req.user.id, workspaceId)
  }

  @Get('workspaces/:workspaceId/server/notifications')
  notificationSettings(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return getNotificationSettings(this.db, req.user.id, workspaceId)
  }

  @Put('workspaces/:workspaceId/server/notifications')
  saveNotifications(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return setNotificationSettings(this.db, req.user.id, workspaceId, parseBody(notificationSettingsSchema, body))
  }

  @Post('workspaces/:workspaceId/server/notifications/test')
  testNotification(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = parseBody(notificationTestSchema, body)
    return sendNotificationTest(this.db, req.user.id, workspaceId, input.channel)
  }
}

function dumpDatabase(file: string) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new AppError(500, 'DATABASE_URL is not configured')
  return new Promise<void>((resolve, reject) => {
    const child = spawn('pg_dump', ['--dbname', databaseUrl, '--clean', '--if-exists', '--no-owner'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    let errorText = ''
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      errorText += chunk.toString()
    })
    child.on('error', () => {
      reject(new AppError(501, 'pg_dump is not available. Run scripts/backup.sh from a host with PostgreSQL client tools.'))
    })
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new AppError(500, errorText.trim() || 'Backup failed'))
        return
      }
      writeFile(file, Buffer.concat(chunks))
        .then(() => resolve())
        .catch(reject)
    })
  })
}
