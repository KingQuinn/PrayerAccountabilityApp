# Database Setup Instructions

## Initial Setup

The authentication issues you're experiencing are likely due to missing database tables and Row Level Security (RLS) policies. Follow these steps to set up your Supabase database:

### 1. Run the Initial Schema

1. Open your Supabase dashboard
2. Go to the SQL Editor
3. Copy and paste the contents of `init_schema.sql` into the editor
4. Click "Run" to execute the script

This will create:
- `profiles` table with proper RLS policies
- `buddy_links` table for user connections
- `prayer_completions` table for streak tracking
- `prayer_checkins` table for real-time updates
- `nudges` table for buddy messages
- All necessary indexes and triggers
- Automatic profile creation on user signup

### 2. Run Migration Files (if needed)

After running the initial schema, you can run the migration files:

1. `add_streak_tracking.sql` - Adds streak calculation functions
2. `add_push_token.sql` - Adds push notification support

### 3. Verify Setup

After running the schema, verify that:

1. All tables exist in your Supabase dashboard
2. RLS is enabled on all tables
3. Policies are created for each table
4. The `handle_new_user()` trigger is active

### 4. Test Authentication

Try creating a new user account. You should see:

1. User created in `auth.users`
2. Profile automatically created in `profiles` table
3. No authentication errors in the app

## Common Issues

### "new row violates row-level security policy"
- This means RLS policies are missing or incorrect
- Re-run the `init_schema.sql` file

### "relation 'profiles' does not exist"
- The profiles table hasn't been created
- Run the `init_schema.sql` file

### "permission denied for table profiles"
- RLS policies are missing
- Check that all policies were created correctly

## Authentication Flow

1. User signs up via `supabase.auth.signUp()`
2. Supabase creates user in `auth.users` table
3. `handle_new_user()` trigger automatically creates profile
4. App calls `upsertProfile()` to update profile data
5. Streak tracking is initialized for new users

## Troubleshooting

If you're still experiencing issues:

1. Check the browser console for detailed error messages
2. Check Supabase logs in the dashboard
3. Verify your RLS policies allow the operations you're trying to perform
4. Ensure your Supabase URL and anon key are correct in `.env`

## Security Notes

- All tables use Row Level Security (RLS)
- Users can only access their own data
- Buddy relationships are properly secured
- Push tokens are protected per user