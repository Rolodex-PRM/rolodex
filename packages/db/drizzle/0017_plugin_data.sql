CREATE TABLE "plugin_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "plugin_id" text NOT NULL,
  "collection" text NOT NULL,
  "document_key" text NOT NULL,
  "body" jsonb NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "plugin_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "plugin_id" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "plugin_documents" ADD CONSTRAINT "plugin_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_files" ADD CONSTRAINT "plugin_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_documents_key_idx" ON "plugin_documents" ("workspace_id","plugin_id","collection","document_key");--> statement-breakpoint
CREATE INDEX "plugin_documents_collection_idx" ON "plugin_documents" ("workspace_id","plugin_id","collection");--> statement-breakpoint
CREATE INDEX "plugin_files_plugin_idx" ON "plugin_files" ("workspace_id","plugin_id");
