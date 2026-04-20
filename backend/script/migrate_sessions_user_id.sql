-- backend/script/migrate_sessions_user_id.sql
-- Adds user_id to the sessions table for user-scoped data isolation.

-- 1. Add nullable column (safe to run while app is running)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id UUID;

-- 2. Backfill from parent team (sessions that have a team_id get the team's user_id)
UPDATE sessions s
SET user_id = t.user_id
FROM teams t
WHERE s.team_id = t.id
  AND s.user_id IS NULL;

-- 3. Verify backfill (review output before proceeding — expect 0 or a small known count)
SELECT COUNT(*) AS orphaned_sessions FROM sessions WHERE user_id IS NULL;

-- 4. Add index for query performance
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
