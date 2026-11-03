ALTER TABLE "relationships" ADD COLUMN "origin" text DEFAULT 'explicit' NOT NULL;--> statement-breakpoint
DELETE FROM "relationships" AS newer
USING "relationships" AS older
WHERE newer.id > older.id
  AND newer.workspace_id = older.workspace_id
  AND newer.from_contact_id = older.from_contact_id
  AND newer.to_contact_id = older.to_contact_id
  AND lower(newer.type) = lower(older.type);--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_edge_idx" ON "relationships" ("workspace_id", "from_contact_id", "to_contact_id", lower("type"));--> statement-breakpoint
CREATE TABLE "relationship_dismissals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "from_contact_id" uuid NOT NULL,
  "to_contact_id" uuid NOT NULL,
  "type" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "relationship_dismissals" ADD CONSTRAINT "relationship_dismissals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_dismissals" ADD CONSTRAINT "relationship_dismissals_from_contact_id_contacts_id_fk" FOREIGN KEY ("from_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_dismissals" ADD CONSTRAINT "relationship_dismissals_to_contact_id_contacts_id_fk" FOREIGN KEY ("to_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_dismissals_edge_idx" ON "relationship_dismissals" ("workspace_id", "from_contact_id", "to_contact_id", lower("type"));
