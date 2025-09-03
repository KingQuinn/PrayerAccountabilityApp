-- Fix prayer_checkins table structure to match application expectations
-- This migration aligns the database schema with the buddy.tsx code requirements

-- First, let's see what we have and what we need:
-- Current schema: prayer_checkins(id, user_id, prayer_name, checked_in_at, created_at)
-- Code expects: prayer_checkins(user_id, prayer, completed, day)

-- Add missing columns to prayer_checkins table
ALTER TABLE prayer_checkins 
ADD COLUMN IF NOT EXISTS prayer TEXT,
ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS day DATE;

-- Update existing data to populate new columns
UPDATE prayer_checkins 
SET 
    prayer = prayer_name,
    day = DATE(checked_in_at),
    completed = true
WHERE prayer IS NULL OR day IS NULL;

-- Create index for better performance on the new columns
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_user_day ON prayer_checkins(user_id, day);
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_prayer ON prayer_checkins(prayer);
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_completed ON prayer_checkins(completed);

-- Update RLS policies to work with the new structure
-- The existing policies should still work, but let's make sure they're optimal

-- Add constraints to ensure data integrity
ALTER TABLE prayer_checkins 
ADD CONSTRAINT IF NOT EXISTS check_prayer_valid 
CHECK (prayer IN ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha'));

-- Add unique constraint to prevent duplicate prayer entries per user per day
-- First remove any existing duplicates
DELETE FROM prayer_checkins 
WHERE id NOT IN (
    SELECT DISTINCT ON (user_id, prayer, day) id 
    FROM prayer_checkins 
    ORDER BY user_id, prayer, day, checked_in_at DESC
);

-- Now add the unique constraint
ALTER TABLE prayer_checkins 
ADD CONSTRAINT IF NOT EXISTS unique_user_prayer_day 
UNIQUE (user_id, prayer, day);

-- Add comments for documentation
COMMENT ON COLUMN prayer_checkins.prayer IS 'Prayer name: fajr, dhuhr, asr, maghrib, or isha';
COMMENT ON COLUMN prayer_checkins.completed IS 'Whether the prayer was completed (always true for check-ins)';
COMMENT ON COLUMN prayer_checkins.day IS 'Date of the prayer check-in';

-- Success message
SELECT 'Prayer checkins table structure fixed successfully!' as message;