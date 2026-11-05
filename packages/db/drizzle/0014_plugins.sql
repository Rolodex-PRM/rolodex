CREATE TABLE "workspace_plugins" (
  "workspace_id" uuid NOT NULL,
  "plugin_id" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_plugins_workspace_id_plugin_id_pk" PRIMARY KEY("workspace_id","plugin_id")
);--> statement-breakpoint
CREATE TABLE "plugin_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "plugin_id" text NOT NULL,
  "record_key" text NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "workspace_plugins" ADD CONSTRAINT "workspace_plugins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_records" ADD CONSTRAINT "plugin_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_records" ADD CONSTRAINT "plugin_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_records_key_idx" ON "plugin_records" ("workspace_id","user_id","plugin_id","record_key");
