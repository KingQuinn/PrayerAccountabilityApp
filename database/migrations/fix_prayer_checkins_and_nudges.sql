-- Migration to fix prayer_checkins and nudges table structure
-- This addresses schema mismatches between database and application code

-- Fix prayer_checkins table structure
-- Add missing columns that the application expects
ALTER TABLE prayer_checkins ADD COLUMN IF NOT EXISTS prayer TEXT;
ALTER TABLE prayer_checkins ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT true;
ALTER TABLE prayer_checkins ADD COLUMN IF NOT EXISTS day DATE;

-- Update existing prayer_checkins data
-- Set default prayer value for existing records (since prayer_name column doesn't exist)
UPDATE prayer_checkins SET prayer = 'fajr' WHERE prayer IS NULL;
-- Set completed to true for existing records (backward compatibility)
UPDATE prayer_checkins SET completed = true WHERE completed IS NULL;
-- Set day from created_at timestamp
UPDATE prayer_checkins SET day = created_at::date WHERE day IS NULL;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_prayer ON prayer_checkins(prayer);
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_day ON prayer_checkins(day);
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_user_day ON prayer_checkins(user_id, day);
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_completed ON prayer_checkins(completed);

-- Add constraints (only if they don't already exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_prayer_valid' 
        AND table_name = 'prayer_checkins'
    ) THEN
        ALTER TABLE prayer_checkins ADD CONSTRAINT chk_prayer_valid 
          CHECK (prayer IN ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha'));
    END IF;
END $$;

-- Add comments for documentation
COMMENT ON COLUMN prayer_checkins.prayer IS 'Prayer name (fajr, dhuhr, asr, maghrib, isha)';
COMMENT ON COLUMN prayer_checkins.completed IS 'Whether the prayer was completed (default true for backward compatibility)';
COMMENT ON COLUMN prayer_checkins.day IS 'Date of the prayer check-in for daily tracking';

-- Fix nudges table structure
-- Add missing columns to nudges table
ALTER TABLE nudges ADD COLUMN IF NOT EXISTS day DATE;
ALTER TABLE nudges ADD COLUMN IF NOT EXISTS prayer TEXT;

-- Update existing nudges data (set default values)
UPDATE nudges SET day = created_at::date WHERE day IS NULL;
UPDATE nudges SET prayer = 'fajr' WHERE prayer IS NULL;

-- Create indexes for nudges table
CREATE INDEX IF NOT EXISTS idx_nudges_day ON nudges(day);
CREATE INDEX IF NOT EXISTS idx_nudges_prayer ON nudges(prayer);
CREATE INDEX IF NOT EXISTS idx_nudges_to_user_day ON nudges(to_user, day);

-- Add constraints for nudges (only if they don't already exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_nudges_prayer_valid' 
        AND table_name = 'nudges'
    ) THEN
        ALTER TABLE nudges ADD CONSTRAINT chk_nudges_prayer_valid 
          CHECK (prayer IN ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha'));
    END IF;
END $$;

-- Add comments for nudges columns
COMMENT ON COLUMN nudges.day IS 'Date of the nudge for daily tracking';
COMMENT ON COLUMN nudges.prayer IS 'Prayer name being nudged about';

-- Note: After running this migration, you may want to consider dropping the old prayer_name column
-- from prayer_checkins table once you've verified everything works correctly:
-- ALTER TABLE prayer_checkins DROP COLUMN IF EXISTS prayer_name;