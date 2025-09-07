# Email Synchronization Solution for Buddy Invites

## Problem
The email invite functionality was failing with "user not found" errors because:
1. The `profiles.email` column might not be properly synced with `auth.users.email`
2. Row Level Security (RLS) policies were preventing users from searching other profiles by email
3. Some profiles might have missing or outdated email addresses

## Solution Overview
This solution implements a comprehensive email synchronization system that:
1. Backfills any missing emails from `auth.users` to `profiles`
2. Creates a trigger to keep emails automatically synced
3. Updates RLS policies to allow email searches for buddy invites
4. Maintains data privacy while enabling the invite functionality

## Implementation Steps

### Step 1: Run Email Synchronization Script
1. Open your Supabase project dashboard
2. Go to the SQL Editor
3. Copy and paste the contents of `sync_profile_emails.sql`
4. Execute the script

This will:
- Update any profiles with missing or mismatched emails
- Create a trigger function to keep emails in sync automatically
- Set up a trigger that fires when auth.users email changes
- Verify the synchronization worked

### Step 2: Fix RLS Policies for Buddy Invites
1. In the same SQL Editor
2. Copy and paste the contents of `fix_rls_for_buddy_invites.sql`
3. Execute the script

This will:
- Add a new RLS policy allowing users to search profiles by email
- Enable the buddy invite functionality while maintaining security
- Show all current policies for verification

### Step 3: Test the Functionality
1. Restart your Expo development server
2. Try sending a buddy invite using an email that exists in your database
3. The invite should now work without "user not found" errors

## Technical Details

### Database Schema
The `profiles` table already has:
- `email TEXT` column with proper indexing
- Existing trigger for new user creation
- RLS policies for basic CRUD operations

### New Components Added
1. **Sync Trigger**: Automatically updates `profiles.email` when `auth.users.email` changes
2. **RLS Policy**: Allows searching profiles by email for invite functionality
3. **Backfill Query**: One-time sync of existing data

### Security Considerations
- The new RLS policy only allows reading `id` and `email` fields
- Users can only search profiles that have non-null email addresses
- All other profile data remains protected by existing policies
- The trigger function runs with SECURITY DEFINER for proper permissions

## Verification

After running both scripts, you can verify the solution by:

1. **Check Email Sync Status**:
   ```sql
   SELECT 
       p.id,
       p.email as profile_email,
       au.email as auth_email,
       CASE 
           WHEN p.email = au.email THEN '✅ Synced'
           WHEN p.email IS NULL THEN '⚠️ Profile email is NULL'
           ELSE '❌ Mismatch'
       END as status
   FROM public.profiles p
   JOIN auth.users au ON p.id = au.id;
   ```

2. **Test Buddy Invite**: Try inviting a user whose email you know exists in the database

3. **Check RLS Policies**:
   ```sql
   SELECT policyname, cmd, qual 
   FROM pg_policies 
   WHERE tablename = 'profiles';
   ```

## Troubleshooting

### If invites still fail:
1. Verify the SQL scripts ran without errors
2. Check that the target user's email exists in both `auth.users` and `profiles`
3. Ensure the email search is case-sensitive and matches exactly
4. Restart your application server

### If you see permission errors:
1. Make sure you're running the SQL as a database admin
2. Check that the RLS policies are properly created
3. Verify the trigger function has SECURITY DEFINER

## Maintenance

Once implemented, this solution is self-maintaining:
- New users automatically get profiles with emails (existing trigger)
- Email changes in auth.users automatically sync to profiles (new trigger)
- No manual intervention required for future users

## Files Created
- `sync_profile_emails.sql` - Main synchronization script
- `fix_rls_for_buddy_invites.sql` - RLS policy updates
- `EMAIL_SYNC_SOLUTION.md` - This documentation