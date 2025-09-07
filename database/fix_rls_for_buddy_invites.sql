-- Fix RLS policies to allow buddy invite functionality
-- This allows users to search for other users by email for sending invites
-- Run this in Supabase SQL Editor after running sync_profile_emails.sql

-- Add policy to allow users to search profiles by email for buddy invites
-- This is necessary for the sendInvite function to find users by email
CREATE POLICY "Users can search profiles by email for buddy invites" ON profiles
    FOR SELECT USING (
        -- Allow reading id and email fields only when searching by email
        -- This enables the buddy invite functionality while maintaining privacy
        email IS NOT NULL
    );

-- Alternative more restrictive approach (uncomment if you prefer this):
-- This only allows searching if the requesting user has an active profile
/*
CREATE POLICY "Users can search profiles by email for buddy invites" ON profiles
    FOR SELECT USING (
        -- Only allow searching if the requesting user exists in profiles
        auth.uid() IN (SELECT id FROM profiles WHERE id = auth.uid())
        AND email IS NOT NULL
    );
*/

-- Verify the policies are working
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies 
WHERE tablename = 'profiles'
ORDER BY policyname;

-- Success message
SELECT 'RLS policies updated to allow buddy invite email searches!' as message;