-- The Supabase project keeps bot data in an unexposed schema.
-- The runtime role journal_bot_app is created separately with a unique password.

CREATE TABLE IF NOT EXISTS journal_bot.subscriptions (
  chat_id BIGINT NOT NULL,
  group_id TEXT NOT NULL,
  student_id INTEGER NOT NULL,
  student_name TEXT NOT NULL,
  subjects TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, group_id, student_id)
);
CREATE INDEX IF NOT EXISTS subscriptions_group_idx ON journal_bot.subscriptions (group_id);

CREATE TABLE IF NOT EXISTS journal_bot.journal_snapshots (
  group_id TEXT PRIMARY KEY,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  marks JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_bot.grade_notifications (
  chat_id BIGINT NOT NULL,
  fingerprint TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS journal_bot.journal_source_versions (
  group_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_bot.journal_group_sources (
  group_id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_bot.lecture_subscriptions (
  chat_id BIGINT NOT NULL,
  group_name TEXT NOT NULL,
  video BOOLEAN NOT NULL DEFAULT false,
  lecture BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, group_name)
);
CREATE INDEX IF NOT EXISTS lecture_subscriptions_group_idx ON journal_bot.lecture_subscriptions (group_name);

CREATE TABLE IF NOT EXISTS journal_bot.lecture_deliveries (
  event_key TEXT NOT NULL,
  chat_id BIGINT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  PRIMARY KEY (event_key, chat_id)
);

CREATE TABLE IF NOT EXISTS journal_bot.bot_chats (
  chat_id BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_bot.broadcast_arms (
  chat_id BIGINT PRIMARY KEY,
  after_message_id INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS journal_bot.broadcast_jobs (
  id BIGSERIAL PRIMARY KEY,
  source_chat_id BIGINT NOT NULL,
  source_message_id INTEGER NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_chat_id, source_message_id)
);

CREATE TABLE IF NOT EXISTS journal_bot.broadcast_deliveries (
  job_id BIGINT NOT NULL REFERENCES journal_bot.broadcast_jobs(id),
  chat_id BIGINT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  PRIMARY KEY (job_id, chat_id)
);
CREATE INDEX IF NOT EXISTS broadcast_deliveries_pending_idx
  ON journal_bot.broadcast_deliveries (job_id, chat_id) WHERE state IN ('pending', 'sending');

CREATE TABLE IF NOT EXISTS journal_bot.telegram_widget_settings (
  scope TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The application repeats CREATE TABLE/INDEX IF NOT EXISTS at startup, so it
-- must own the tables even when the initial migration was run by postgres.
GRANT journal_bot_app TO postgres;
DO $$
DECLARE row record;
BEGIN
  FOR row IN SELECT tablename FROM pg_tables WHERE schemaname = 'journal_bot' LOOP
    EXECUTE format('ALTER TABLE journal_bot.%I OWNER TO journal_bot_app', row.tablename);
  END LOOP;
END $$;
ALTER SCHEMA journal_bot OWNER TO journal_bot_app;

GRANT USAGE ON SCHEMA journal_bot TO journal_bot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA journal_bot TO journal_bot_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA journal_bot TO journal_bot_app;

ALTER TABLE journal_bot.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.journal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.grade_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.journal_source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.journal_group_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.lecture_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.lecture_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.bot_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.broadcast_arms ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.broadcast_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.broadcast_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_bot.telegram_widget_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY journal_bot_app_access ON journal_bot.subscriptions FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.journal_snapshots FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.grade_notifications FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.journal_source_versions FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.journal_group_sources FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.lecture_subscriptions FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.lecture_deliveries FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.bot_chats FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.broadcast_arms FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.broadcast_jobs FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.broadcast_deliveries FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
CREATE POLICY journal_bot_app_access ON journal_bot.telegram_widget_settings FOR ALL TO journal_bot_app USING (true) WITH CHECK (true);
