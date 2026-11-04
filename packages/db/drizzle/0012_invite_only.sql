INSERT INTO "server_settings" ("key", "settings")
VALUES ('auth.registration', '{"inviteOnly": true}')
ON CONFLICT ("key") DO UPDATE
SET "settings" = jsonb_set("server_settings"."settings", '{inviteOnly}', 'true'::jsonb),
    "updated_at" = now();
