-- Migration to add username field to profiles table
-- This allows users to set custom display names instead of using email-based names

-- Add username column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT;

-- Create index for username lookups
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- Add unique constraint to prevent duplicate usernames (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_unique 
  ON profiles(LOWER(username)) 
  WHERE username IS NOT NULL;

-- Add check constraint to ensure username meets basic requirements
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_username_valid' 
        AND table_name = 'profiles'
    ) THEN
        ALTER TABLE profiles ADD CONSTRAINT chk_username_valid 
          CHECK (username IS NULL OR (LENGTH(username) >= 3 AND LENGTH(username) <= 30 AND username ~ '^[a-zA-Z0-9_]+$'));
    END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN profiles.username IS 'Optional custom username for display purposes. Must be 3-30 characters, alphanumeric and underscores only';

-- Update RLS policies to allow users to view usernames of their buddies
-- This policy allows users to see usernames of people they have buddy relationships with
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE policyname = 'Users can view buddy usernames' 
        AND tablename = 'profiles'
    ) THEN
        CREATE POLICY "Users can view buddy usernames" ON profiles
            FOR SELECT USING (
                id = auth.uid() OR  -- Users can always see their own profile
                id IN (
                    -- Users can see profiles of their accepted buddies
                    SELECT user_a FROM buddy_links WHERE user_b = auth.uid() AND status = 'accepted'
                    UNION
                    SELECT user_b FROM buddy_links WHERE user_a = auth.uid() AND status = 'accepted'
                    UNION
                    -- Users can see profiles of pending requests (both sent and received)
                    SELECT user_a FROM buddy_links WHERE user_b = auth.uid() AND status = 'pending'
                    UNION
                    SELECT user_b FROM buddy_links WHERE user_a = auth.uid() AND status = 'pending'
                )
            );
    END IF;
END $$;