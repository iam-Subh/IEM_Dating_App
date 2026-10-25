-- In-app feedback (docs/FEEDBACK.md): bug reports with screenshots and a
-- screen recording, and the in-app rating.

CREATE SEQUENCE bug_report_reference_seq START 1001;

CREATE TABLE bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Shown to the person as #B-1001.
  reference INTEGER NOT NULL UNIQUE DEFAULT nextval('bug_report_reference_seq'),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Made on the phone: a retry of the same report is the same report.
  client_id VARCHAR(64) NOT NULL,
  area VARCHAR(30) NOT NULL,
  description TEXT NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'form',
  status VARCHAR(20) NOT NULL DEFAULT 'received',
  diagnostics JSONB,
  fixed_in_version VARCHAR(30),
  duplicate_of UUID REFERENCES bug_reports(id) ON DELETE SET NULL,
  staff_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE (user_id, client_id)
);
CREATE INDEX bug_reports_status_created_idx ON bug_reports (status, created_at DESC);
CREATE INDEX bug_reports_user_created_idx ON bug_reports (user_id, created_at DESC);

CREATE TABLE bug_report_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL,
  object_key VARCHAR(500) NOT NULL,
  content_type VARCHAR(60) NOT NULL,
  max_bytes INTEGER NOT NULL,
  size_bytes INTEGER,
  -- requested -> ready | rejected; purged once the files are deleted.
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  nudity_score REAL,
  -- Kept from staff until someone chooses to look (the nudity check flagged it).
  sensitive BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bug_report_attachments_report_idx ON bug_report_attachments (report_id);

CREATE TABLE app_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  app_version VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX app_ratings_created_idx ON app_ratings (created_at DESC);
CREATE INDEX app_ratings_user_idx ON app_ratings (user_id, created_at DESC);
