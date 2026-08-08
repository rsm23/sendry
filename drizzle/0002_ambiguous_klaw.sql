CREATE TABLE "contact_merge_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"source_contact_id" text NOT NULL,
	"target_contact_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"status" text NOT NULL,
	"category" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "automation_step_id" text;--> statement-breakpoint
ALTER TABLE "contact_merge_suggestions" ADD CONSTRAINT "contact_merge_suggestions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_suggestions" ADD CONSTRAINT "contact_merge_suggestions_source_contact_id_contacts_id_fk" FOREIGN KEY ("source_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_suggestions" ADD CONSTRAINT "contact_merge_suggestions_target_contact_id_contacts_id_fk" FOREIGN KEY ("target_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_templates" ADD CONSTRAINT "provider_templates_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_templates" ADD CONSTRAINT "provider_templates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_merge_suggestion_pair_unique" ON "contact_merge_suggestions" USING btree ("source_contact_id","target_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_templates_connection_external_language_unique" ON "provider_templates" USING btree ("connection_id","external_id","language");