-- Fix prayer_checkins table schema to resolve app freezing issue
-- Run this in your Supabase SQL Editor

-- First, let's check what columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'prayer_checkins' 
ORDER BY ordinal_position;

-- Add missing columns if they don't exist
ALTER TABLE prayer_checkins ADD COLUMN IF NOT EXISTS prayer TEXT;
ALTER TABLE prayer_checkins ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT true;
ALTER TABLE prayer_checkins ADD COLUMN IF NOT EXISTS day DATE;

-- Update existing data to populate new columns (skip if no timestamp column exists)
-- UPDATE prayer_checkins 
-- SET 
--     day = CURRENT_DATE,
--     completed = true
-- WHERE day IS NULL OR completed IS NULL;
-- Note: Uncomment and modify above if you have a timestamp column to derive day from

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_user_day ON prayer_checkins(user_id, day);
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_prayer ON prayer_checkins(prayer);
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_completed ON prayer_checkins(completed);

-- Add constraint to ensure valid prayer names (only if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'check_prayer_valid' 
        AND table_name = 'prayer_checkins'
    ) THEN
        ALTER TABLE prayer_checkins 
        ADD CONSTRAINT check_prayer_valid 
        CHECK (prayer IN ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha'));
    END IF;
END $$;

-- Remove duplicate entries (keep the most recent one for each user/prayer/day combination)
DELETE FROM prayer_checkins 
WHERE id NOT IN (
    SELECT DISTINCT ON (user_id, prayer, day) id 
    FROM prayer_checkins 
    ORDER BY user_id, prayer, day, id DESC
);

-- Add unique constraint to prevent future duplicates (only if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'unique_user_prayer_day' 
        AND table_name = 'prayer_checkins'
    ) THEN
        ALTER TABLE prayer_checkins 
        ADD CONSTRAINT unique_user_prayer_day 
        UNIQUE (user_id, prayer, day);
    END IF;
END $$;

-- Verify the fix by checking the updated structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'prayer_checkins' 
ORDER BY ordinal_position;

-- Check if data was migrated correctly
SELECT COUNT(*) as total_records, 
       COUNT(CASE WHEN prayer IS NOT NULL THEN 1 END) as records_with_prayer,
       COUNT(CASE WHEN day IS NOT NULL THEN 1 END) as records_with_day
FROM prayer_checkins;

SELECT 'Database schema fix completed successfully!' as message;