CREATE TABLE "chat_message_marks" (
  "message_id" UUID NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "scope_id" UUID NOT NULL,
  "kind" VARCHAR(8) NOT NULL CHECK ("kind" IN ('star', 'pin')),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("message_id", "scope_id", "kind")
);
CREATE INDEX "chat_message_marks_scope_id_kind_created_at_idx"
  ON "chat_message_marks" ("scope_id", "kind", "created_at");
