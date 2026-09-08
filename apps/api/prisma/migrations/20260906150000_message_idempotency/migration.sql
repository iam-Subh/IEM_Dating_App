ALTER TABLE "messages" ADD COLUMN "client_message_id" VARCHAR(100);

DELETE FROM "chat_sessions" a
USING "chat_sessions" b
WHERE a."match_id" = b."match_id" AND a."id" > b."id";

CREATE UNIQUE INDEX "messages_sender_id_client_message_id_key"
ON "messages"("sender_id", "client_message_id");

CREATE UNIQUE INDEX "chat_sessions_match_id_key"
ON "chat_sessions"("match_id");
