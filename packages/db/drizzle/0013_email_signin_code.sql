ALTER TABLE "users" ADD COLUMN "email_otp_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_otp_expires_at" timestamp with time zone;
