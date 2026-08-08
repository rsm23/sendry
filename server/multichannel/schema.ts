import { relations, sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const channelEnum = pgEnum('channel', ['email', 'sms', 'whatsapp', 'push', 'chat', 'voice'])
export const purposeEnum = pgEnum('message_purpose', ['marketing', 'transactional', 'support'])
export const deliveryStateEnum = pgEnum('delivery_state', ['queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'canceled'])
export const conversationStateEnum = pgEnum('conversation_state', ['open', 'waiting', 'snoozed', 'closed'])

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('users_email_unique').on(sql`lower(${table.email})`)])

export const brands = pgTable('brands', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  defaultTimezone: text('default_timezone').notNull().default('Europe/Paris'),
  firstResponseSlaMinutes: integer('first_response_sla_minutes').notNull().default(15),
  conversationRetentionDays: integer('conversation_retention_days').notNull().default(730),
  providerPayloadRetentionDays: integer('provider_payload_retention_days').notNull().default(30),
  allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const brandMembers = pgTable('brand_members', {
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
}, (table) => [primaryKey({ columns: [table.brandId, table.userId] })])

export const featureFlags = pgTable('feature_flags', {
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.brandId, table.key] })])

export const contacts = pgTable('contacts', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull().default(''),
  locale: text('locale').notNull().default('en'),
  timezone: text('timezone').notNull().default('Europe/Paris'),
  status: text('status').notNull().default('active'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
  legalHold: boolean('legal_hold').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [index('contacts_brand_updated_idx').on(table.brandId, table.updatedAt)])

export const contactIdentifiers = pgTable('contact_identifiers', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  value: text('value').notNull(),
  normalizedValue: text('normalized_value').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  primary: boolean('primary').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('contact_identifiers_brand_type_value_unique').on(table.brandId, table.type, table.normalizedValue),
  index('contact_identifiers_contact_idx').on(table.contactId),
])

export const audienceMemberships = pgTable('audience_memberships', {
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  audienceId: text('audience_id').notNull(),
  status: text('status').notNull().default('active'),
  customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.contactId, table.audienceId] }), index('audience_memberships_brand_audience_idx').on(table.brandId, table.audienceId)])

export const consentEvents = pgTable('consent_events', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  channel: channelEnum('channel').notNull(),
  purpose: purposeEnum('purpose').notNull(),
  action: text('action').notNull(),
  legalBasis: text('legal_basis').notNull(),
  source: text('source').notNull(),
  policyVersion: text('policy_version').notNull(),
  proof: jsonb('proof').$type<Record<string, unknown>>().notNull().default({}),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  withdrawalAt: timestamp('withdrawal_at', { withTimezone: true }),
}, (table) => [index('consent_contact_channel_purpose_idx').on(table.contactId, table.channel, table.purpose, table.capturedAt)])

export const contactDevices = pgTable('contact_devices', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  endpoint: text('endpoint').notNull(),
  token: text('token'),
  publicKey: text('public_key'),
  authSecret: text('auth_secret'),
  origin: text('origin'),
  active: boolean('active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('contact_devices_brand_endpoint_unique').on(table.brandId, table.endpoint)])

export const channelConnections = pgTable('channel_connections', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  label: text('label').notNull(),
  encryptedCredentials: text('encrypted_credentials').notNull(),
  status: text('status').notNull().default('pending'),
  isDefault: boolean('is_default').notNull().default(false),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('channel_connections_brand_idx').on(table.brandId)])

export const senderIdentities = pgTable('sender_identities', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').notNull().references(() => channelConnections.id, { onDelete: 'cascade' }),
  channel: channelEnum('channel').notNull(),
  label: text('label').notNull(),
  address: text('address').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  verified: boolean('verified').notNull().default(false),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('sender_identities_brand_channel_idx').on(table.brandId, table.channel)])

export const providerTemplates = pgTable('provider_templates', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull().references(() => channelConnections.id, { onDelete: 'cascade' }),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  channel: channelEnum('channel').notNull(),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(),
  language: text('language').notNull(),
  status: text('status').notNull(),
  category: text('category'),
  content: jsonb('content').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('provider_templates_connection_external_language_unique').on(table.connectionId, table.externalId, table.language)])

export const channelCampaigns = pgTable('channel_campaigns', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  legacyCampaignId: text('legacy_campaign_id'),
  name: text('name').notNull(),
  channel: channelEnum('channel').notNull(),
  purpose: purposeEnum('purpose').notNull(),
  senderIdentityId: text('sender_identity_id').references(() => senderIdentities.id, { onDelete: 'set null' }),
  content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  audience: jsonb('audience').$type<Record<string, unknown>>().notNull().default({}),
  trackingPolicy: jsonb('tracking_policy').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('channel_campaigns_brand_status_idx').on(table.brandId, table.status)])

export const deliveries = pgTable('deliveries', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  campaignId: text('campaign_id').references(() => channelCampaigns.id, { onDelete: 'set null' }),
  automationStepId: text('automation_step_id'),
  contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  senderIdentityId: text('sender_identity_id').references(() => senderIdentities.id, { onDelete: 'set null' }),
  channel: channelEnum('channel').notNull(),
  purpose: purposeEnum('purpose').notNull(),
  destination: text('destination').notNull(),
  content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  state: deliveryStateEnum('state').notNull().default('queued'),
  idempotencyKey: text('idempotency_key').notNull(),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  errorCode: text('error_code'),
  error: text('error'),
  costMicros: integer('cost_micros'),
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
}, (table) => [uniqueIndex('deliveries_brand_idempotency_unique').on(table.brandId, table.idempotencyKey), index('deliveries_provider_message_idx').on(table.provider, table.providerMessageId)])

export const automations = pgTable('automations', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  audienceId: text('audience_id'),
  name: text('name').notNull(),
  trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('automations_brand_idx').on(table.brandId)])

export const automationSteps = pgTable('automation_steps', {
  id: text('id').primaryKey(),
  automationId: text('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  delay: jsonb('delay').$type<Record<string, unknown>>().notNull().default({}),
  channel: channelEnum('channel').notNull().default('email'),
  senderIdentityId: text('sender_identity_id').references(() => senderIdentities.id, { onDelete: 'set null' }),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  consentPurpose: purposeEnum('consent_purpose').notNull().default('marketing'),
  trackingPolicy: jsonb('tracking_policy').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('automation_steps_position_unique').on(table.automationId, table.position)])

export const deliveryEvents = pgTable('delivery_events', {
  id: text('id').primaryKey(),
  deliveryId: text('delivery_id').notNull().references(() => deliveries.id, { onDelete: 'cascade' }),
  state: deliveryStateEnum('state').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('delivery_events_delivery_time_idx').on(table.deliveryId, table.occurredAt)])

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  channel: channelEnum('channel').notNull(),
  state: conversationStateEnum('state').notNull().default('open'),
  subject: text('subject').notNull().default(''),
  assignedUserId: text('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
  unreadCount: integer('unread_count').notNull().default(0),
  priority: text('priority').notNull().default('normal'),
  waitingSince: timestamp('waiting_since', { withTimezone: true }),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  firstResponseDueAt: timestamp('first_response_due_at', { withTimezone: true }),
  firstRespondedAt: timestamp('first_responded_at', { withTimezone: true }),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (table) => [index('conversations_brand_queue_idx').on(table.brandId, table.state, table.assignedUserId, table.lastMessageAt)])

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  deliveryId: text('delivery_id').references(() => deliveries.id, { onDelete: 'set null' }),
  channel: channelEnum('channel').notNull(),
  direction: text('direction').notNull(),
  type: text('type').notNull().default('message'),
  sender: text('sender').notNull().default(''),
  body: text('body').notNull().default(''),
  html: text('html'),
  attachments: jsonb('attachments').$type<Array<Record<string, unknown>>>().notNull().default([]),
  providerMessageId: text('provider_message_id'),
  messageIdHeader: text('message_id_header'),
  inReplyTo: text('in_reply_to'),
  references: jsonb('references').$type<string[]>().notNull().default([]),
  status: deliveryStateEnum('status').notNull().default('sent'),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('messages_conversation_created_idx').on(table.conversationId, table.createdAt), index('messages_email_thread_idx').on(table.messageIdHeader)])

export const callEvents = pgTable('call_events', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  providerCallId: text('provider_call_id'),
  direction: text('direction').notNull(),
  from: text('from').notNull(),
  to: text('to').notNull(),
  state: text('state').notNull(),
  assignedUserId: text('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
  durationSeconds: integer('duration_seconds'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (table) => [index('call_events_brand_started_idx').on(table.brandId, table.startedAt)])

export const providerEvents = pgTable('provider_events', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  brandId: text('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => [uniqueIndex('provider_events_provider_event_unique').on(table.provider, table.eventId), index('provider_events_retention_idx').on(table.receivedAt)])

export const suppressions = pgTable('channel_suppressions', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  channel: channelEnum('channel').notNull(),
  normalizedIdentifier: text('normalized_identifier').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('channel_suppressions_unique').on(table.brandId, table.channel, table.normalizedIdentifier)])

export const idempotencyRecords = pgTable('idempotency_records', {
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code').notNull(),
  response: jsonb('response').$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.brandId, table.key] }), index('idempotency_records_expiry_idx').on(table.expiresAt)])

export const mediaObjects = pgTable('media_objects', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(),
  originalName: text('original_name').notNull(),
  detectedMime: text('detected_mime'),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  scanState: text('scan_state').notNull().default('quarantined'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  availableAt: timestamp('available_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [uniqueIndex('media_objects_storage_key_unique').on(table.storageKey), index('media_objects_brand_idx').on(table.brandId)])

export const contactMergeSuggestions = pgTable('contact_merge_suggestions', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  sourceContactId: text('source_contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  targetContactId: text('target_contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => [uniqueIndex('contact_merge_suggestion_pair_unique').on(table.sourceContactId, table.targetContactId)])

export const contactRelations = relations(contacts, ({ many }) => ({ identifiers: many(contactIdentifiers), consents: many(consentEvents), devices: many(contactDevices), conversations: many(conversations) }))
export const conversationRelations = relations(conversations, ({ one, many }) => ({ contact: one(contacts, { fields: [conversations.contactId], references: [contacts.id] }), messages: many(messages) }))
