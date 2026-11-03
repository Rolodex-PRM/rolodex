ALTER TABLE "contacts" ADD COLUMN "cover_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "cover_mode" text DEFAULT 'cycle' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_cover_attachment_id_attachments_id_fk" FOREIGN KEY ("cover_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "interaction_files" (
	"attachment_id" uuid PRIMARY KEY NOT NULL,
	"activity_id" uuid,
	"note_id" uuid,
	CONSTRAINT "interaction_files_target" CHECK ((("activity_id" IS NOT NULL)::int + ("note_id" IS NOT NULL)::int) = 1)
);--> statement-breakpoint
ALTER TABLE "interaction_files" ADD CONSTRAINT "interaction_files_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_files" ADD CONSTRAINT "interaction_files_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_files" ADD CONSTRAINT "interaction_files_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;
