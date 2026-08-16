CREATE TABLE "conversation_agent_states" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"widget_id" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"widget_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_estimate" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"widget_id" text NOT NULL,
	"file_id" text NOT NULL,
	"file_version_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"parser_version" text NOT NULL,
	"embedding_profile" text NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_by" text,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_retrieval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"widget_id" text NOT NULL,
	"conversation_id" text,
	"query_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"provider" text,
	"model" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_agent_states" ADD CONSTRAINT "conversation_agent_states_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_retrieval_runs" ADD CONSTRAINT "knowledge_retrieval_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_agent_states_widget_idx" ON "conversation_agent_states" USING btree ("widget_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_document_ordinal_unique" ON "knowledge_chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_widget_idx" ON "knowledge_chunks" USING btree ("widget_id","document_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_fts_idx" ON "knowledge_chunks" USING gin (to_tsvector('simple', "content"));--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_job_unique" ON "knowledge_documents" USING btree ("widget_id","file_id","file_version_id","parser_version","embedding_profile");--> statement-breakpoint
CREATE INDEX "knowledge_documents_widget_status_idx" ON "knowledge_documents" USING btree ("widget_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_retrieval_runs_widget_idx" ON "knowledge_retrieval_runs" USING btree ("widget_id","created_at");
