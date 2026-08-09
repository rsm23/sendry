import Database from 'better-sqlite3'
import { hashSync } from 'bcryptjs'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { encryptCredentials } from './multichannel/crypto'

export type AppDatabase = Database.Database

const schema = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  theme TEXT NOT NULL DEFAULT 'system',
  sidebar_shortcut INTEGER NOT NULL DEFAULT 1,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_recovery_codes TEXT NOT NULL DEFAULT '[]',
  password_reset_token TEXT,
  password_reset_expires TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  challenge TEXT NOT NULL,
  name TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  default_timezone TEXT NOT NULL,
  default_language TEXT NOT NULL DEFAULT 'en',
  rows_per_page INTEGER NOT NULL DEFAULT 25,
  strict_delete INTEGER NOT NULL DEFAULT 0,
  api_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  reply_to TEXT NOT NULL,
  logo_path TEXT,
  provider TEXT NOT NULL DEFAULT 'stream',
  provider_config TEXT NOT NULL DEFAULT '{}',
  custom_domain TEXT,
  custom_domain_protocol TEXT NOT NULL DEFAULT 'https',
  custom_domain_enabled INTEGER NOT NULL DEFAULT 0,
  recaptcha_site_key TEXT,
  recaptcha_secret_key TEXT,
  openai_api_key TEXT,
  ai_provider TEXT NOT NULL DEFAULT '',
  ai_provider_config TEXT NOT NULL DEFAULT '{}',
  ai_encrypted_api_key TEXT,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  default_query TEXT NOT NULL DEFAULT '',
  test_prefix TEXT NOT NULL DEFAULT '[Test]',
  allowed_attachments TEXT NOT NULL DEFAULT '["jpg","jpeg","png","gif","pdf","zip"]',
  list_sort TEXT NOT NULL DEFAULT 'date',
  template_sort TEXT NOT NULL DEFAULT 'date',
  default_opt_in TEXT NOT NULL DEFAULT 'double',
  hide_hidden_lists INTEGER NOT NULL DEFAULT 1,
  privacy_mode TEXT NOT NULL DEFAULT 'identified',
  opens_tracking TEXT NOT NULL DEFAULT 'identified',
  clicks_tracking TEXT NOT NULL DEFAULT 'identified',
  consent_campaigns_only INTEGER NOT NULL DEFAULT 0,
  consent_automations_only INTEGER NOT NULL DEFAULT 0,
  consent_options_enabled INTEGER NOT NULL DEFAULT 1,
  monthly_limit INTEGER NOT NULL DEFAULT -1,
  current_usage INTEGER NOT NULL DEFAULT 0,
  reset_day INTEGER NOT NULL DEFAULT 1,
  usage_reset_at TEXT,
  limit_never_expires INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  delivery_fee REAL NOT NULL DEFAULT 0,
  recipient_fee REAL NOT NULL DEFAULT 0,
  notify_campaign_sent INTEGER NOT NULL DEFAULT 1,
  report_rows INTEGER NOT NULL DEFAULT 25,
  rss_enabled INTEGER NOT NULL DEFAULT 1,
  first_response_sla_minutes INTEGER NOT NULL DEFAULT 15,
  conversation_retention_days INTEGER NOT NULL DEFAULT 730,
  provider_payload_retention_days INTEGER NOT NULL DEFAULT 30,
  allowed_origins TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_members (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'client',
  permissions TEXT NOT NULL DEFAULT '["campaigns","templates","lists","reports"]',
  created_at TEXT NOT NULL,
  UNIQUE(brand_id, user_id)
);

CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  opt_in TEXT NOT NULL DEFAULT 'double',
  subscribe_url TEXT,
  confirm_url TEXT,
  already_subscribed_url TEXT,
  reconsent_url TEXT,
  no_consent_url TEXT,
  unsubscribe_url TEXT,
  unsubscribe_scope TEXT NOT NULL DEFAULT 'list',
  unsubscribe_confirmation INTEGER NOT NULL DEFAULT 0,
  thank_you_enabled INTEGER NOT NULL DEFAULT 0,
  thank_you_subject TEXT NOT NULL DEFAULT '',
  thank_you_html TEXT NOT NULL DEFAULT '',
  confirmation_subject TEXT NOT NULL DEFAULT 'Please confirm your subscription',
  confirmation_html TEXT NOT NULL DEFAULT '<p><a href="[confirmation_link]">Confirm subscription</a></p>',
  goodbye_enabled INTEGER NOT NULL DEFAULT 0,
  goodbye_subject TEXT NOT NULL DEFAULT '',
  goodbye_html TEXT NOT NULL DEFAULT '',
  consent_enabled INTEGER NOT NULL DEFAULT 0,
  marketing_permission TEXT NOT NULL DEFAULT '',
  what_to_expect TEXT NOT NULL DEFAULT '',
  form_fields TEXT NOT NULL DEFAULT '["name","email"]',
  hidden INTEGER NOT NULL DEFAULT 0,
  preference_visible INTEGER NOT NULL DEFAULT 1,
  preference_name TEXT,
  preference_description TEXT,
  preference_sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_fields (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text','date','number','boolean')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(list_id, name)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'active',
  custom_values TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'admin',
  ip TEXT,
  country TEXT,
  referrer TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT,
  confirmation_token TEXT,
  confirmed_at TEXT,
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT,
  last_campaign_id TEXT,
  last_automation_step_id TEXT,
  UNIQUE(list_id, email)
);

CREATE INDEX IF NOT EXISTS subscribers_list_status ON subscribers(list_id, status);
CREATE INDEX IF NOT EXISTS subscribers_email ON subscribers(email);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'all',
  last_count INTEGER NOT NULL DEFAULT 0,
  last_computed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segment_conditions (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  group_no INTEGER NOT NULL DEFAULT 0,
  field TEXT NOT NULL,
  operator TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  plain_text TEXT NOT NULL DEFAULT '',
  html_text TEXT NOT NULL DEFAULT '',
  editor_mode TEXT NOT NULL DEFAULT 'blocks',
  editor_data TEXT NOT NULL DEFAULT '{}',
  thumbnail_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  reply_to TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  html_text TEXT NOT NULL DEFAULT '',
  editor_mode TEXT NOT NULL DEFAULT 'blocks',
  editor_data TEXT NOT NULL DEFAULT '{}',
  query_string TEXT NOT NULL DEFAULT '',
  web_language TEXT NOT NULL DEFAULT 'en',
  attachments TEXT NOT NULL DEFAULT '[]',
  opens_tracking TEXT NOT NULL DEFAULT 'identified',
  clicks_tracking TEXT NOT NULL DEFAULT 'identified',
  check_links INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  timezone TEXT,
  started_at TEXT,
  sent_at TEXT,
  stopped_at TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS campaigns_brand_status ON campaigns(brand_id, status);

CREATE TABLE IF NOT EXISTS campaign_targets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'include',
  UNIQUE(campaign_id, kind, target_id, mode)
);

CREATE TABLE IF NOT EXISTS campaign_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  link_url TEXT,
  country TEXT,
  user_agent TEXT,
  ip TEXT,
  occurred_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS campaign_events_report ON campaign_events(campaign_id, type, occurred_at);

CREATE TABLE IF NOT EXISTS campaign_links (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(campaign_id, url)
);

CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('drip','annual','date')),
  date_field_id TEXT REFERENCES custom_fields(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_steps (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  offset_value INTEGER NOT NULL DEFAULT 0,
  offset_unit TEXT NOT NULL DEFAULT 'minutes',
  offset_direction TEXT NOT NULL DEFAULT 'after',
  subject TEXT NOT NULL,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  reply_to TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  html_text TEXT NOT NULL DEFAULT '',
  editor_mode TEXT NOT NULL DEFAULT 'blocks',
  editor_data TEXT NOT NULL DEFAULT '{}',
  query_string TEXT NOT NULL DEFAULT '',
  opens_tracking TEXT NOT NULL DEFAULT 'identified',
  clicks_tracking TEXT NOT NULL DEFAULT 'identified',
  channel TEXT NOT NULL DEFAULT 'email',
  sender_identity_id TEXT,
  channel_payload TEXT NOT NULL DEFAULT '{}',
  consent_purpose TEXT NOT NULL DEFAULT 'marketing',
  tracking_policy TEXT NOT NULL DEFAULT '{}',
  segment_include TEXT NOT NULL DEFAULT '[]',
  segment_exclude TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(automation_id, position)
);

CREATE TABLE IF NOT EXISTS automation_deliveries (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES automation_steps(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  error TEXT,
  UNIQUE(step_id, subscriber_id, scheduled_at)
);

CREATE TABLE IF NOT EXISTS automation_events (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES automation_steps(id) ON DELETE CASCADE,
  delivery_id TEXT REFERENCES automation_deliveries(id) ON DELETE SET NULL,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  link_url TEXT,
  country TEXT,
  user_agent TEXT,
  ip TEXT,
  occurred_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS automation_events_step_type ON automation_events(step_id,type);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  action_type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '{}',
  action_config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id TEXT PRIMARY KEY,
  rule_id TEXT REFERENCES rules(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  payload TEXT NOT NULL,
  status_code INTEGER,
  response TEXT,
  attempted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppressions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  reason TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  UNIQUE(brand_id, email)
);

CREATE TABLE IF NOT EXISTS blocked_domains (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  domain TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  UNIQUE(brand_id, domain)
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES files(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('file','folder')),
  name TEXT NOT NULL,
  storage_name TEXT,
  mime_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_events (
  id TEXT PRIMARY KEY,
  brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT,
  event_type TEXT NOT NULL,
  email TEXT,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE(provider, external_id, event_type)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  run_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  locked_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status, run_at);

CREATE TABLE IF NOT EXISTS preference_events (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  action TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  analysis TEXT NOT NULL,
  score INTEGER,
  source TEXT NOT NULL DEFAULT 'provider',
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '["*"]',
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'paypal',
  status TEXT NOT NULL DEFAULT 'pending',
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Transitional multichannel tables. PostgreSQL is the production source of
-- truth; these tables keep local development and migration verification fully
-- runnable until the final SQLite cutover release.
CREATE TABLE IF NOT EXISTS feature_flags (
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (brand_id, key)
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  country TEXT,
  attributes TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contacts_brand_name ON contacts(brand_id, display_name);

CREATE TABLE IF NOT EXISTS contact_identifiers (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('email','phone','whatsapp')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  verified_at TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(brand_id, type, normalized_value)
);

CREATE TABLE IF NOT EXISTS contact_memberships (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  custom_values TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(contact_id, list_id)
);

CREATE TABLE IF NOT EXISTS consent_events (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('marketing','transactional','support')),
  status TEXT NOT NULL CHECK(status IN ('granted','withdrawn','objected','expired')),
  source TEXT NOT NULL,
  legal_basis TEXT NOT NULL DEFAULT 'consent',
  policy_version TEXT NOT NULL DEFAULT '2026-08',
  proof TEXT NOT NULL DEFAULT '{}',
  captured_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS consent_contact_channel ON consent_events(contact_id, channel, captured_at);

CREATE TABLE IF NOT EXISTS contact_devices (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('web','ios','android')),
  provider TEXT NOT NULL CHECK(provider IN ('webpush','fcm')),
  token TEXT,
  endpoint TEXT,
  subscription TEXT NOT NULL DEFAULT '{}',
  app_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(brand_id, provider, token),
  UNIQUE(brand_id, provider, endpoint)
);

CREATE TABLE IF NOT EXISTS channel_connections (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  encrypted_config TEXT NOT NULL DEFAULT '{}',
  capabilities TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'unverified',
  is_default INTEGER NOT NULL DEFAULT 0,
  last_tested_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(brand_id, channel, provider, name)
);

CREATE TABLE IF NOT EXISTS sender_identities (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  address TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connection_id, address)
);

CREATE TABLE IF NOT EXISTS channel_campaigns (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('email','sms','whatsapp','push')),
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'marketing',
  sender_identity_id TEXT REFERENCES sender_identities(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  timezone TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS channel_campaign_brand_status ON channel_campaigns(brand_id, status);

CREATE TABLE IF NOT EXISTS channel_campaign_targets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES channel_campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('list','segment')),
  target_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('include','exclude')),
  UNIQUE(campaign_id, kind, target_id, mode)
);

CREATE TABLE IF NOT EXISTS channel_deliveries (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES channel_campaigns(id) ON DELETE CASCADE,
  automation_step_id TEXT REFERENCES automation_steps(id) ON DELETE CASCADE,
  conversation_id TEXT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  purpose TEXT NOT NULL,
  sender_identity_id TEXT REFERENCES sender_identities(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  idempotency_key TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  cost REAL,
  currency TEXT,
  error_code TEXT,
  error_message TEXT,
  queued_at TEXT NOT NULL,
  accepted_at TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  failed_at TEXT,
  UNIQUE(brand_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS channel_delivery_status ON channel_deliveries(status, queued_at);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  unread_count INTEGER NOT NULL DEFAULT 0,
  first_response_due_at TEXT,
  first_responded_at TEXT,
  snoozed_until TEXT,
  last_channel TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_queue ON conversations(brand_id, status, last_message_at);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','internal')),
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL DEFAULT '',
  html TEXT,
  media TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  provider_message_id TEXT,
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reply_to_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_message_id)
);
CREATE INDEX IF NOT EXISTS conversation_message_timeline ON conversation_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS conversation_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS call_sessions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'twilio',
  provider_call_id TEXT,
  direction TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT,
  answered_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_call_id)
);

CREATE TABLE IF NOT EXISTS chat_widgets (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  greeting TEXT NOT NULL DEFAULT 'Bonjour! How can we help?',
  allowed_origins TEXT NOT NULL DEFAULT '[]',
  privacy_url TEXT,
  accent_color TEXT NOT NULL DEFAULT '#075ee8',
  offline_capture INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_templates (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL,
  category TEXT,
  content TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(connection_id, external_id, language)
);

CREATE TABLE IF NOT EXISTS channel_suppressions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  normalized_identifier TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  UNIQUE(brand_id, channel, normalized_identifier)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, key)
);

CREATE TABLE IF NOT EXISTS multichannel_provider_events (
  id TEXT PRIMARY KEY,
  connection_id TEXT REFERENCES channel_connections(id) ON DELETE CASCADE,
  brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  UNIQUE(provider, external_id, event_type)
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  delivery_id TEXT REFERENCES channel_deliveries(id) ON DELETE SET NULL,
  units INTEGER NOT NULL DEFAULT 1,
  provider_cost REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_merge_suggestions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  target_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(source_contact_id, target_contact_id)
);
`

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()

export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function openDatabase(path = process.env.DATABASE_PATH ?? './data/sendry.db') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true })
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.exec(schema)
  const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
  if (!userColumns.some((column) => column.name === 'totp_recovery_codes')) db.exec("ALTER TABLE users ADD COLUMN totp_recovery_codes TEXT NOT NULL DEFAULT '[]'")
  const brandColumns = db.prepare('PRAGMA table_info(brands)').all() as Array<{ name: string }>
  if (!brandColumns.some((column) => column.name === 'usage_reset_at')) db.exec('ALTER TABLE brands ADD COLUMN usage_reset_at TEXT')
  if (!brandColumns.some((column) => column.name === 'first_response_sla_minutes')) db.exec('ALTER TABLE brands ADD COLUMN first_response_sla_minutes INTEGER NOT NULL DEFAULT 15')
  if (!brandColumns.some((column) => column.name === 'conversation_retention_days')) db.exec('ALTER TABLE brands ADD COLUMN conversation_retention_days INTEGER NOT NULL DEFAULT 730')
  if (!brandColumns.some((column) => column.name === 'provider_payload_retention_days')) db.exec('ALTER TABLE brands ADD COLUMN provider_payload_retention_days INTEGER NOT NULL DEFAULT 30')
  if (!brandColumns.some((column) => column.name === 'allowed_origins')) db.exec("ALTER TABLE brands ADD COLUMN allowed_origins TEXT NOT NULL DEFAULT '[]'")
  if (!brandColumns.some((column) => column.name === 'ai_provider')) db.exec("ALTER TABLE brands ADD COLUMN ai_provider TEXT NOT NULL DEFAULT ''")
  if (!brandColumns.some((column) => column.name === 'ai_provider_config')) db.exec("ALTER TABLE brands ADD COLUMN ai_provider_config TEXT NOT NULL DEFAULT '{}'")
  if (!brandColumns.some((column) => column.name === 'ai_encrypted_api_key')) db.exec('ALTER TABLE brands ADD COLUMN ai_encrypted_api_key TEXT')
  const automationStepColumns = db.prepare('PRAGMA table_info(automation_steps)').all() as Array<{ name: string }>
  if (!automationStepColumns.some((column) => column.name === 'channel')) db.exec("ALTER TABLE automation_steps ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'")
  if (!automationStepColumns.some((column) => column.name === 'sender_identity_id')) db.exec('ALTER TABLE automation_steps ADD COLUMN sender_identity_id TEXT')
  if (!automationStepColumns.some((column) => column.name === 'channel_payload')) db.exec("ALTER TABLE automation_steps ADD COLUMN channel_payload TEXT NOT NULL DEFAULT '{}'")
  if (!automationStepColumns.some((column) => column.name === 'consent_purpose')) db.exec("ALTER TABLE automation_steps ADD COLUMN consent_purpose TEXT NOT NULL DEFAULT 'marketing'")
  if (!automationStepColumns.some((column) => column.name === 'tracking_policy')) db.exec("ALTER TABLE automation_steps ADD COLUMN tracking_policy TEXT NOT NULL DEFAULT '{}'")
  const deliverySchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='automation_deliveries'").get() as { sql: string } | undefined
  if (deliverySchema?.sql.includes('UNIQUE(step_id, subscriber_id)')) db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE automation_deliveries_next (
      id TEXT PRIMARY KEY,
      step_id TEXT NOT NULL REFERENCES automation_steps(id) ON DELETE CASCADE,
      subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued', scheduled_at TEXT NOT NULL, sent_at TEXT, error TEXT,
      UNIQUE(step_id, subscriber_id, scheduled_at)
    );
    INSERT INTO automation_deliveries_next SELECT * FROM automation_deliveries;
    DROP TABLE automation_deliveries;
    ALTER TABLE automation_deliveries_next RENAME TO automation_deliveries;
    PRAGMA foreign_keys = ON;
  `)
  return db
}

export function seedDatabase(db: AppDatabase) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  if (count.count > 0) return

  const now = iso()
  const userId = 'usr_qa_admin'
  const workspaceId = 'wsp_atlas'
  const brandId = 'brd_atlas'
  const listId = 'lst_product_updates'
  const campaignId = 'cmp_august_notes'

  const insert = db.transaction(() => {
    db.prepare(`INSERT INTO users (id,name,email,password_hash,language,timezone,theme,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(userId, 'QA Admin', 'qa@sendry.local', hashSync('TestPass123!', 12), 'en', 'Europe/Paris', 'light', now, now)
    db.prepare(`INSERT INTO workspaces (id,name,company,owner_id,default_timezone,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(workspaceId, 'Atlas', 'Atlas Studio', userId, 'Europe/Paris', now, now)
    db.prepare(`INSERT INTO brands (id,workspace_id,name,from_name,from_email,reply_to,provider,provider_config,monthly_limit,current_usage,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(brandId, workspaceId, 'Atlas', 'Atlas Team', 'hello@atlas.test', 'support@atlas.test', 'stream', JSON.stringify({ mode: 'stream', healthy: true, dailyRemaining: 42380, sendRate: 14 }), 150000, 21560, now, now)
    db.prepare(`INSERT INTO brand_members (id,brand_id,user_id,role,permissions,created_at) VALUES (?,?,?,?,?,?)`)
      .run('mem_qa_admin', brandId, userId, 'owner', JSON.stringify(['*']), now)
    db.prepare(`INSERT INTO lists (id,brand_id,name,opt_in,preference_name,preference_description,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(listId, brandId, 'Product updates', 'double', 'Product updates', 'Product news, practical guides and release notes.', now, now)
    db.prepare(`INSERT INTO custom_fields (id,list_id,name,type,position,created_at) VALUES (?,?,?,?,?,?)`)
      .run('fld_company', listId, 'Company', 'text', 0, now)
    db.prepare(`INSERT INTO custom_fields (id,list_id,name,type,position,created_at) VALUES (?,?,?,?,?,?)`)
      .run('fld_birthday', listId, 'Birthday', 'date', 1, now)

    const subscribers = [
      ['sub_ada', 'Ada Lovelace', 'ada@example.test', 'active', 'GB', 'web_form', -22 * 86400000],
      ['sub_grace', 'Grace Hopper', 'grace@example.test', 'active', 'US', 'api', -39 * 86400000],
      ['sub_alan', 'Alan Turing', 'alan@example.test', 'unsubscribed', 'GB', 'import', -41 * 86400000],
      ['sub_katherine', 'Katherine Johnson', 'katherine@example.test', 'bounced', 'US', 'web_form', -44 * 86400000],
      ['sub_claude', 'Claude Shannon', 'claude@example.test', 'complaint', 'US', 'api', -48 * 86400000],
      ['sub_edith', 'Edith Clarke', 'edith@example.test', 'active', 'US', 'web_form', -52 * 86400000],
      ['sub_marvin', 'Marvin Minsky', 'marvin@example.test', 'active', 'US', 'api', -57 * 86400000],
      ['sub_lina', 'Lina Vrålstad', 'lina@example.test', 'active', 'FI', 'import', -61 * 86400000],
    ] as const
    const subscriberStmt = db.prepare(`INSERT INTO subscribers
      (id,list_id,name,email,status,custom_values,source,country,consent,consent_at,confirmed_at,joined_at,updated_at,last_activity_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const [id, name, email, status, country, source, joinedOffset] of subscribers) {
      subscriberStmt.run(id, listId, name, email, status, JSON.stringify({ Company: id === 'sub_ada' ? 'Analytical Engine Co.' : '' }), source, country, 1, iso(joinedOffset), iso(joinedOffset), iso(joinedOffset), now, iso(-2 * 3600000))
    }

    db.prepare(`INSERT INTO segments (id,list_id,name,match_mode,last_count,last_computed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run('seg_engaged', listId, 'Engaged in 30 days', 'all', 4217, now, now, now)
    db.prepare(`INSERT INTO segment_conditions (id,segment_id,group_no,field,operator,value,position)
      VALUES (?,?,?,?,?,?,?)`).run('con_engaged', 'seg_engaged', 0, 'last_activity_at', 'after', iso(-30 * 86400000), 0)

    const templates = [
      ['tpl_basic', 'Basic', '<h1>[subject]</h1><p>Write your message here.</p>'],
      ['tpl_basic_dark', 'Basic dark', '<div style="background:#111;color:#fff;padding:32px"><h1>[subject]</h1></div>'],
      ['tpl_weekly', 'Fresh picks weekly', '<h1>Fresh picks</h1><p>Your curated weekly selection.</p>'],
      ['tpl_escape', 'Your escape deals', '<h1>Your next escape</h1><p>Hand-picked offers inside.</p>'],
    ] as const
    const templateStmt = db.prepare(`INSERT INTO templates (id,brand_id,name,subject,html_text,editor_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    for (const [id, name, html] of templates) templateStmt.run(id, brandId, name, name, html, '{}', now, now)

    db.prepare(`INSERT INTO campaigns
      (id,brand_id,label,subject,from_name,from_email,reply_to,plain_text,html_text,status,total_recipients,delivered,created_at,updated_at,sent_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(campaignId, brandId, 'Monthly update on product', 'August product notes', 'Atlas Team', 'hello@atlas.test', 'support@atlas.test', 'Product improvements and practical notes.', '<h1>What is new in Atlas</h1><p>We shipped useful improvements this month.</p><p><a href="https://example.test/product">Explore the update</a></p><p>[unsubscribe]</p>', 'sent', 12842, 12725, iso(-5 * 86400000), now, iso(-2 * 86400000))
    db.prepare(`INSERT INTO campaign_targets (id,campaign_id,kind,target_id,mode) VALUES (?,?,?,?,?)`)
      .run('tgt_august', campaignId, 'list', listId, 'include')

    const eventStmt = db.prepare(`INSERT INTO campaign_events (id,campaign_id,subscriber_id,type,link_url,country,occurred_at) VALUES (?,?,?,?,?,?,?)`)
    const eventTypes = [
      ['evt_1', 'sub_ada', 'delivered', null, 'GB', -48],
      ['evt_2', 'sub_grace', 'delivered', null, 'US', -47],
      ['evt_3', 'sub_ada', 'open', null, 'GB', -40],
      ['evt_4', 'sub_grace', 'open', null, 'US', -36],
      ['evt_5', 'sub_ada', 'click', 'https://example.test/product', 'GB', -34],
      ['evt_6', 'sub_grace', 'click', 'https://example.test/docs', 'US', -28],
      ['evt_7', 'sub_alan', 'unsubscribe', null, 'GB', -20],
      ['evt_8', 'sub_katherine', 'bounce', null, 'US', -16],
      ['evt_9', 'sub_claude', 'complaint', null, 'US', -12],
    ] as const
    for (const [id, subscriberId, type, link, country, hours] of eventTypes) eventStmt.run(id, campaignId, subscriberId, type, link, country, iso(hours * 3600000))
    db.prepare(`INSERT INTO campaign_links (id,campaign_id,url,created_at) VALUES (?,?,?,?)`).run('lnk_product', campaignId, 'https://example.test/product', now)
    db.prepare(`INSERT INTO campaign_links (id,campaign_id,url,created_at) VALUES (?,?,?,?)`).run('lnk_docs', campaignId, 'https://example.test/docs', now)

    db.prepare(`INSERT INTO campaigns (id,brand_id,label,subject,from_name,from_email,reply_to,status,total_recipients,delivered,started_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('cmp_sending', brandId, 'Monthly update on product', 'August delivery notes', 'Atlas Team', 'hello@atlas.test', 'support@atlas.test', 'sending', 34218, 23268, iso(-30 * 60000), iso(-3 * 86400000), now)
    db.prepare(`INSERT INTO campaigns (id,brand_id,label,subject,from_name,from_email,reply_to,status,total_recipients,scheduled_at,timezone,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('cmp_scheduled', brandId, 'Welcome new members', 'Member welcome', 'Atlas Team', 'hello@atlas.test', 'support@atlas.test', 'scheduled', 12540, iso(4 * 3600000), 'Europe/Paris', iso(-2 * 86400000), now)
    db.prepare(`INSERT INTO campaigns (id,brand_id,label,subject,from_name,from_email,reply_to,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('cmp_draft', brandId, 'Q3 highlights', 'Quarterly round-up', 'Atlas Team', 'hello@atlas.test', 'support@atlas.test', 'draft', iso(-86400000), now)

    db.prepare(`INSERT INTO automations (id,list_id,name,type,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run('aut_onboarding', listId, 'Onboarding series', 'drip', 1, now, now)
    db.prepare(`INSERT INTO automation_steps (id,automation_id,position,offset_value,offset_unit,offset_direction,subject,from_name,from_email,reply_to,html_text,sent_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('ast_welcome', 'aut_onboarding', 0, 0, 'minutes', 'after', 'Welcome to Atlas', 'Atlas Team', 'hello@atlas.test', 'support@atlas.test', '<h1>Welcome, [Name]</h1><p>We are glad you are here.</p>', 3421, now, now)
    db.prepare(`INSERT INTO automations (id,list_id,name,type,date_field_id,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('aut_annual', listId, 'Annual product round-up', 'annual', 'fld_birthday', 1, now, now)
    db.prepare(`INSERT INTO automations (id,list_id,name,type,date_field_id,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('aut_reengage', listId, 'Re-engagement reminder', 'date', 'fld_birthday', 0, now, now)

    db.prepare(`INSERT INTO rules (id,brand_id,name,trigger_type,action_type,scope,action_config,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('rul_campaign_sent', brandId, 'Notify the team after delivery', 'campaign_sent', 'email', JSON.stringify({ brandId }), JSON.stringify({ email: 'hello@atlas.test' }), now, now)
    db.prepare(`INSERT INTO rules (id,brand_id,name,trigger_type,action_type,scope,action_config,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('rul_new_subscriber', brandId, 'Post new subscribers to CRM', 'subscribe', 'webhook', JSON.stringify({ listId }), JSON.stringify({ endpoint: 'https://example.test/hooks/subscriber' }), now, now)

    db.prepare(`INSERT INTO suppressions (id,brand_id,email,reason,created_at) VALUES (?,?,?,?,?)`).run('sup_blocked', brandId, 'blocked@example.test', 'manual', now)
    db.prepare(`INSERT INTO blocked_domains (id,brand_id,domain,created_at) VALUES (?,?,?,?)`).run('dom_disposable', brandId, 'mailinator.example', now)
    db.prepare(`INSERT INTO files (id,brand_id,kind,name,created_at,updated_at) VALUES (?,?,?,?,?,?)`).run('dir_logos', brandId, 'folder', 'logos', now, now)
    db.prepare(`INSERT INTO files (id,brand_id,kind,name,created_at,updated_at) VALUES (?,?,?,?,?,?)`).run('dir_attachments', brandId, 'folder', 'attachments', now, now)

    const apiToken = 'snd_test_local_key'
    db.prepare(`INSERT INTO api_tokens (id,workspace_id,name,token_prefix,token_hash,scopes,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run('tok_local', workspaceId, 'Local QA', apiToken.slice(0, 8), tokenHash(apiToken), JSON.stringify(['*']), now)
    db.prepare(`INSERT INTO ai_analyses (id,brand_id,entity_type,entity_id,analysis,score,source,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('ana_august', brandId, 'campaign', campaignId, 'Strong engagement and stable deliverability. The product link produced the highest intent. Consider sending the next issue at the same local time and testing a shorter subject.', 87, 'fixture', now, now)

    for (const key of ['multichannel_core', 'sms', 'whatsapp', 'push', 'inbox', 'chat', 'voice']) db.prepare(`INSERT INTO feature_flags (brand_id,key,enabled,updated_at) VALUES (?,?,1,?)`).run(brandId, key, now)
    const demoContacts = [
      ['ctc_sofia', 'Sofia Martin', 'sofia.martin@example.test', '+33612010203', 'fr', 'Europe/Paris'],
      ['ctc_marcus', 'Marcus Chen', 'marcus.chen@example.test', '+447700900123', 'en', 'Europe/London'],
      ['ctc_amelie', 'Amélie Dubois', 'amelie.dubois@example.test', '+33628300405', 'fr', 'Europe/Paris'],
      ['ctc_noah', 'Noah Williams', 'noah.williams@example.test', '+14155550123', 'en', 'America/Los_Angeles'],
      ['ctc_lina', 'Lina Vrålstad', 'lina.vralstad@example.test', '+358401234567', 'en', 'Europe/Helsinki'],
    ] as const
    for (const [contactId, name, email, phone, locale, timezone] of demoContacts) {
      db.prepare(`INSERT INTO contacts (id,brand_id,display_name,locale,timezone,attributes,created_at,updated_at) VALUES (?,?,?,?,?,'{}',?,?)`).run(contactId, brandId, name, locale, timezone, iso(-30 * 86400000), now)
      db.prepare(`INSERT INTO contact_identifiers (id,contact_id,brand_id,type,value,normalized_value,is_primary,created_at) VALUES (?,?,?,?,?,?,1,?)`).run(`cid_${contactId}_email`, contactId, brandId, 'email', email, email, now)
      db.prepare(`INSERT INTO contact_identifiers (id,contact_id,brand_id,type,value,normalized_value,is_primary,created_at) VALUES (?,?,?,?,?,?,0,?)`).run(`cid_${contactId}_phone`, contactId, brandId, 'phone', phone, phone, now)
      db.prepare(`INSERT INTO contact_identifiers (id,contact_id,brand_id,type,value,normalized_value,is_primary,created_at) VALUES (?,?,?,?,?,?,0,?)`).run(`cid_${contactId}_wa`, contactId, brandId, 'whatsapp', phone, phone, now)
      for (const channel of ['email', 'sms', 'whatsapp', 'push', 'voice']) db.prepare(`INSERT INTO consent_events (id,brand_id,contact_id,channel,purpose,status,source,legal_basis,policy_version,proof,captured_at,expires_at,created_at) VALUES (?,?,?,?,?,'granted','demo','consent','2026-08',?,?,?,?)`).run(`cns_${contactId}_${channel}`, brandId, contactId, channel, 'marketing', JSON.stringify({ fixture: true }), iso(-20 * 86400000), iso(345 * 86400000), now)
    }
    const localEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY ?? process.env.SESSION_SECRET ?? 'sendry-local-session-secret-change-before-deployment'
    db.prepare(`INSERT INTO channel_connections (id,brand_id,channel,provider,name,encrypted_config,capabilities,status,is_default,last_tested_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('cnn_stream_sms', brandId, 'sms', 'stream', 'SMS sandbox', encryptCredentials({}, localEncryptionKey), JSON.stringify(['delivery_callbacks', 'segmentation']), 'active', 1, now, now, now)
    db.prepare(`INSERT INTO channel_connections (id,brand_id,channel,provider,name,encrypted_config,capabilities,status,is_default,last_tested_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('cnn_stream_whatsapp', brandId, 'whatsapp', 'stream', 'WhatsApp sandbox', encryptCredentials({}, localEncryptionKey), JSON.stringify(['templates', 'read_receipts']), 'active', 1, now, now, now)
    db.prepare(`INSERT INTO channel_connections (id,brand_id,channel,provider,name,encrypted_config,capabilities,status,is_default,last_tested_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('cnn_stream_push', brandId, 'push', 'stream', 'Push sandbox', encryptCredentials({}, localEncryptionKey), JSON.stringify(['webpush']), 'active', 1, now, now, now)
    const identities = [
      ['snd_stream_sms', 'cnn_stream_sms', 'sms', '+33184801422', 'Atlas SMS'],
      ['snd_stream_whatsapp', 'cnn_stream_whatsapp', 'whatsapp', '+33184801422', 'Atlas WhatsApp'],
      ['snd_stream_push', 'cnn_stream_push', 'push', 'atlas-web', 'Atlas Web Push'],
    ] as const
    for (const [senderId, connectionId, channel, address, display] of identities) db.prepare(`INSERT INTO sender_identities (id,connection_id,brand_id,channel,address,display_name,status,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,'active','{}',?,?)`).run(senderId, connectionId, brandId, channel, address, display, now, now)
    const channelCampaigns = [
      ['mcp_flash_sms', 'sms', 'Weekend flash sale', 'marketing', 'snd_stream_sms', JSON.stringify({ channel: 'sms', body: 'Atlas members: your early-access selection is ready. Explore it here: https://atlas.test/early', media: [], shorten_links: true }), 'draft'],
      ['mcp_delivery_wa', 'whatsapp', 'Order delivery updates', 'transactional', 'snd_stream_whatsapp', JSON.stringify({ channel: 'whatsapp', body: 'Your Atlas order is on its way.', media: [], buttons: [] }), 'sent'],
      ['mcp_release_push', 'push', 'Product release alert', 'marketing', 'snd_stream_push', JSON.stringify({ channel: 'push', title: 'Atlas 4.2 is live', body: 'See the faster workspace and new reports.', target_url: 'https://atlas.test/releases/4-2', data: {} }), 'scheduled'],
    ] as const
    for (const [id, channel, name, purpose, senderId, content, status] of channelCampaigns) db.prepare(`INSERT INTO channel_campaigns (id,brand_id,channel,name,purpose,sender_identity_id,content,status,scheduled_at,timezone,total_recipients,accepted,delivered,read_count,failed,estimated_cost,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'Europe/Paris',?,?,?,?,?,?,?,?)`).run(id, brandId, channel, name, purpose, senderId, content, status, status === 'scheduled' ? iso(6 * 3600000) : null, status === 'draft' ? 0 : 1248, status === 'draft' ? 0 : 1234, status === 'draft' ? 0 : 1210, channel === 'whatsapp' ? 844 : 0, 14, channel === 'sms' ? 82.5 : 0, iso(-4 * 86400000), now)

    const conversationFixtures = [
      ['cnv_sofia', 'ctc_sofia', 'open', null, 2, 'whatsapp', -4, 'I still need help changing my delivery address.'],
      ['cnv_marcus', 'ctc_marcus', 'waiting', userId, 0, 'email', -18, 'Thanks, that solved it.'],
      ['cnv_amelie', 'ctc_amelie', 'open', null, 1, 'sms', -31, 'ARRET'],
      ['cnv_noah', 'ctc_noah', 'open', userId, 3, 'chat', -46, 'Can I add another teammate to my plan?'],
      ['cnv_lina', 'ctc_lina', 'snoozed', userId, 0, 'voice', -95, 'Missed call — follow up tomorrow.'],
    ] as const
    for (const [conversationId, contactId, status, assigned, unread, channel, minutes, preview] of conversationFixtures) {
      const createdAt = iso((minutes - 25) * 60000), messageAt = iso(minutes * 60000)
      db.prepare(`INSERT INTO conversations (id,brand_id,contact_id,status,assigned_user_id,unread_count,first_response_due_at,snoozed_until,last_channel,last_message_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(conversationId, brandId, contactId, status, assigned, unread, iso((minutes - 10) * 60000), status === 'snoozed' ? iso(18 * 3600000) : null, channel, messageAt, createdAt, now)
      db.prepare(`INSERT INTO conversation_messages (id,conversation_id,brand_id,contact_id,channel,direction,kind,body,media,status,metadata,created_at) VALUES (?,?,?,?,?,'inbound','text',?,'[]','delivered','{}',?)`).run(`msg_${conversationId}_last`, conversationId, brandId, contactId, channel, preview, messageAt)
      db.prepare(`INSERT INTO conversation_messages (id,conversation_id,brand_id,contact_id,channel,direction,kind,body,media,status,metadata,created_at) VALUES (?,?,?,?,?,'outbound','text',?,'[]','delivered','{}',?)`).run(`msg_${conversationId}_first`, conversationId, brandId, contactId, channel, channel === 'chat' ? 'Hi! I can help with your workspace.' : 'Hello — thanks for contacting Atlas support.', createdAt)
    }
    db.prepare(`UPDATE conversation_messages SET channel='chat',direction='inbound',body=?,created_at=? WHERE id='msg_cnv_sofia_first'`).run("Hi! I'm interested in the Atelier Chair. Is it in stock?", iso(-29 * 60000))
    db.prepare(`INSERT INTO conversation_messages (id,conversation_id,brand_id,contact_id,channel,direction,kind,body,media,status,metadata,created_at) VALUES ('msg_sofia_sms','cnv_sofia',?, 'ctc_sofia','sms','outbound','text',?,'[]','delivered','{}',?)`).run(brandId, 'Yes, the Atelier Chair is in stock. Would you like delivery details?', iso(-24 * 60000))
    db.prepare(`INSERT INTO conversation_messages (id,conversation_id,brand_id,contact_id,channel,direction,kind,body,media,status,metadata,created_at) VALUES ('msg_sofia_email','cnv_sofia',?, 'ctc_sofia','email','inbound','text',?,'[]','delivered',? ,?)`).run(brandId, "Thanks for the quick reply. I'd like to schedule delivery for Friday if possible.", JSON.stringify({ subject: 'Re: Atelier Chair availability', message_id: '<sofia-email@example.test>' }), iso(-14 * 60000))
    db.prepare(`INSERT INTO conversation_messages (id,conversation_id,brand_id,contact_id,channel,direction,kind,body,media,status,metadata,created_at) VALUES ('msg_sofia_call','cnv_sofia',?, 'ctc_sofia','voice','outbound','call',?,'[]','delivered','{}',?)`).run(brandId, 'Spoke with Sofia about the delivery window · 3m 12s', iso(-9 * 60000))
    db.prepare(`INSERT INTO chat_widgets (id,brand_id,public_key,name,greeting,allowed_origins,privacy_url,accent_color,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)`).run('wdg_atlas', brandId, 'atlas_demo', 'Atlas support', 'Hi! How can the Atlas team help?', JSON.stringify(['http://localhost:5173', 'http://127.0.0.1:5173']), 'https://atlas.test/privacy', '#075ee8', now, now)
    db.prepare(`INSERT INTO call_sessions (id,conversation_id,brand_id,contact_id,assigned_user_id,provider,direction,from_address,to_address,status,started_at,ended_at,duration_seconds,notes,created_at) VALUES (?,?,?,?,?,'twilio','inbound',?,?,'missed',?,?,0,?,?)`).run('cal_lina_missed', 'cnv_lina', brandId, 'ctc_lina', userId, '+358401234567', '+33184801422', iso(-100 * 60000), iso(-99.5 * 60000), 'Follow up tomorrow morning.', iso(-100 * 60000))
  })

  insert()
}

export function createDatabase(path?: string) {
  const db = openDatabase(path)
  if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO === 'true') seedDatabase(db)
  return db
}

export function audit(db: AppDatabase, action: string, entityType: string, entityId?: string, userId?: string, brandId?: string, metadata: unknown = {}) {
  db.prepare(`INSERT INTO audit_log (id,user_id,brand_id,action,entity_type,entity_id,metadata,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), userId ?? null, brandId ?? null, action, entityType, entityId ?? null, JSON.stringify(metadata), iso())
}
