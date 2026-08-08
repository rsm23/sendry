CREATE TYPE "public"."channel" AS ENUM('email', 'sms', 'whatsapp', 'push', 'chat', 'voice');--> statement-breakpoint
CREATE TYPE "public"."conversation_state" AS ENUM('open', 'waiting', 'snoozed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."delivery_state" AS ENUM('queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."message_purpose" AS ENUM('marketing', 'transactional', 'support');--> statement-breakpoint
CREATE TABLE "audience_memberships" (
	"brand_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"audience_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_memberships_contact_id_audience_id_pk" PRIMARY KEY("contact_id","audience_id")
);
--> statement-breakpoint
CREATE TABLE "brand_members" (
	"brand_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "brand_members_brand_id_user_id_pk" PRIMARY KEY("brand_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"default_timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"first_response_sla_minutes" integer DEFAULT 15 NOT NULL,
	"conversation_retention_days" integer DEFAULT 730 NOT NULL,
	"provider_payload_retention_days" integer DEFAULT 30 NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_events" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"conversation_id" text,
	"contact_id" text,
	"provider_call_id" text,
	"direction" text NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"state" text NOT NULL,
	"assigned_user_id" text,
	"duration_seconds" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "channel_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"legacy_campaign_id" text,
	"name" text NOT NULL,
	"channel" "channel" NOT NULL,
	"purpose" "message_purpose" NOT NULL,
	"sender_identity_id" text,
	"content" jsonb NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tracking_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"provider" text NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"label" text NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"purpose" "message_purpose" NOT NULL,
	"action" text NOT NULL,
	"legal_basis" text NOT NULL,
	"source" text NOT NULL,
	"policy_version" text NOT NULL,
	"proof" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"withdrawal_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"contact_id" text,
	"platform" text NOT NULL,
	"endpoint" text NOT NULL,
	"token" text,
	"public_key" text,
	"auth_secret" text,
	"origin" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_identifiers" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"verified_at" timestamp with time zone,
	"primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"contact_id" text,
	"channel" "channel" NOT NULL,
	"state" "conversation_state" DEFAULT 'open' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"assigned_user_id" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"waiting_since" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"first_response_due_at" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"campaign_id" text,
	"contact_id" text,
	"sender_identity_id" text,
	"channel" "channel" NOT NULL,
	"purpose" "message_purpose" NOT NULL,
	"destination" text NOT NULL,
	"content" jsonb NOT NULL,
	"state" "delivery_state" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"error_code" text,
	"error" text,
	"cost_micros" integer,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"state" "delivery_state" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"brand_id" text NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_brand_id_key_pk" PRIMARY KEY("brand_id","key")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"brand_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_brand_id_key_pk" PRIMARY KEY("brand_id","key")
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"detected_mime" text,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"scan_state" text DEFAULT 'quarantined' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"delivery_id" text,
	"channel" "channel" NOT NULL,
	"direction" text NOT NULL,
	"type" text DEFAULT 'message' NOT NULL,
	"sender" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"html" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_message_id" text,
	"message_id_header" text,
	"in_reply_to" text,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "delivery_state" DEFAULT 'sent' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"brand_id" text,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sender_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"normalized_identifier" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audience_memberships" ADD CONSTRAINT "audience_memberships_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_memberships" ADD CONSTRAINT "audience_memberships_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_campaigns" ADD CONSTRAINT "channel_campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_campaigns" ADD CONSTRAINT "channel_campaigns_sender_identity_id_sender_identities_id_fk" FOREIGN KEY ("sender_identity_id") REFERENCES "public"."sender_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_devices" ADD CONSTRAINT "contact_devices_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_devices" ADD CONSTRAINT "contact_devices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identifiers" ADD CONSTRAINT "contact_identifiers_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identifiers" ADD CONSTRAINT "contact_identifiers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_campaign_id_channel_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."channel_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_sender_identity_id_sender_identities_id_fk" FOREIGN KEY ("sender_identity_id") REFERENCES "public"."sender_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_identities" ADD CONSTRAINT "sender_identities_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_identities" ADD CONSTRAINT "sender_identities_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_suppressions" ADD CONSTRAINT "channel_suppressions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audience_memberships_brand_audience_idx" ON "audience_memberships" USING btree ("brand_id","audience_id");--> statement-breakpoint
CREATE INDEX "call_events_brand_started_idx" ON "call_events" USING btree ("brand_id","started_at");--> statement-breakpoint
CREATE INDEX "channel_campaigns_brand_status_idx" ON "channel_campaigns" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "channel_connections_brand_idx" ON "channel_connections" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "consent_contact_channel_purpose_idx" ON "consent_events" USING btree ("contact_id","channel","purpose","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_devices_brand_endpoint_unique" ON "contact_devices" USING btree ("brand_id","endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identifiers_brand_type_value_unique" ON "contact_identifiers" USING btree ("brand_id","type","normalized_value");--> statement-breakpoint
CREATE INDEX "contact_identifiers_contact_idx" ON "contact_identifiers" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contacts_brand_updated_idx" ON "contacts" USING btree ("brand_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_brand_queue_idx" ON "conversations" USING btree ("brand_id","state","assigned_user_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_brand_idempotency_unique" ON "deliveries" USING btree ("brand_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "deliveries_provider_message_idx" ON "deliveries" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE INDEX "delivery_events_delivery_time_idx" ON "delivery_events" USING btree ("delivery_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_objects_storage_key_unique" ON "media_objects" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_objects_brand_idx" ON "media_objects" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_email_thread_idx" ON "messages" USING btree ("message_id_header");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_provider_event_unique" ON "provider_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "provider_events_retention_idx" ON "provider_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "sender_identities_brand_channel_idx" ON "sender_identities" USING btree ("brand_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_suppressions_unique" ON "channel_suppressions" USING btree ("brand_id","channel","normalized_identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));