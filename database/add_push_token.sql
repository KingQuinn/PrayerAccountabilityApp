-- Add push_token column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_push_token ON profiles(push_token);

-- Add comment for documentation
COMMENT ON COLUMN profiles.push_token IS 'Expo push notification token for sending notifications to user device';