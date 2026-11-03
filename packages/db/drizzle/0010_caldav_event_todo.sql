ALTER TABLE "calendar_events" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "status" text DEFAULT 'CONFIRMED' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "rrule" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "uid" text;--> statement-breakpoint
UPDATE "tasks" SET "uid" = gen_random_uuid()::text WHERE "uid" IS NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "uid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "rrule" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_uid_idx" ON "tasks" USING btree ("workspace_id","uid");
