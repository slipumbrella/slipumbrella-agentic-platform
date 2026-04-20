CREATE TABLE IF NOT EXISTS token_usage (
    id            BIGSERIAL PRIMARY KEY,
    session_id    TEXT        NOT NULL,
    agent_id      TEXT        NOT NULL,
    agent_role    TEXT        NOT NULL DEFAULT '',
    model_id      TEXT        NOT NULL DEFAULT '',
    input_tokens  INTEGER     NOT NULL DEFAULT 0,
    output_tokens INTEGER     NOT NULL DEFAULT 0,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_usage_session  ON token_usage (session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_recorded ON token_usage (recorded_at);
