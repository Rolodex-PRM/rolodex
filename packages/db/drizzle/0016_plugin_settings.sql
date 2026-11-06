ALTER TABLE "workspace_plugins" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
