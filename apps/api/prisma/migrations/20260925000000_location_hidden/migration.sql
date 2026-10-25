-- "Hide me while I'm here" (LOCATION_SPEC.md 7): an explicit hidden state.
-- Previously a fix inside a hidden place only skipped the write, which left
-- the person discoverable from wherever they were last shown.
ALTER TABLE "users" ADD COLUMN "location_hidden_at" TIMESTAMP(3);
