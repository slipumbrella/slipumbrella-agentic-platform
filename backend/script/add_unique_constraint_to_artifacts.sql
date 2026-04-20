-- Migration: Add unique constraint to artifacts table
-- Purpose: Prevent duplicate artifacts for the same team_id + file_id combination
-- Date: 2026-03-24
--
-- Run this script to apply the migration:
--   psql postgresql://USER:PASSWORD@HOST:PORT/DBNAME -f add_unique_constraint_to_artifacts.sql
--
-- Or connect to your database and run:
--   \i add_unique_constraint_to_artifacts.sql

-- Step 1: Remove any existing duplicate rows (keep the oldest one)
DELETE FROM artifacts a
USING artifacts b
WHERE a.team_id = b.team_id
  AND a.file_id = b.file_id
  AND a.created_at < b.created_at;

-- Step 2: Create the unique index (required for ON CONFLICT to work)
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_team_file
ON artifacts (team_id, file_id);

-- Step 3: Verify the index was created
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'artifacts'
  AND indexname = 'idx_artifacts_team_file';

-- Done! The Python code can now use ON CONFLICT (team_id, file_id) DO UPDATE
