CREATE TABLE "automation_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"position" integer NOT NULL,
	"delay" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" "channel" DEFAULT 'email' NOT NULL,
	"sender_identity_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_purpose" "message_purpose" DEFAULT 'marketing' NOT NULL,
	"tracking_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"audience_id" text,
	"name" text NOT NULL,
	"trigger" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_steps" ADD CONSTRAINT "automation_steps_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_steps" ADD CONSTRAINT "automation_steps_sender_identity_id_sender_identities_id_fk" FOREIGN KEY ("sender_identity_id") REFERENCES "public"."sender_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_steps_position_unique" ON "automation_steps" USING btree ("automation_id","position");--> statement-breakpoint
CREATE INDEX "automations_brand_idx" ON "automations" USING btree ("brand_id");