-- SQL script to sync profile emails with auth.users
-- Run this in Supabase SQL Editor to fix email synchronization issues

-- 1) Backfill existing profiles with current emails from auth.users
-- This handles any profiles that might have missing or outdated email addresses
UPDATE public.profiles p 
SET email = au.email 
FROM auth.users au 
WHERE p.id = au.id 
AND (p.email IS DISTINCT FROM au.email);

-- 2) Create or replace the trigger function to keep profiles.email synced
-- This ensures future email changes in auth.users are automatically reflected in profiles
CREATE OR REPLACE FUNCTION public.sync_profile_email() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
AS $$ 
BEGIN 
    -- Update the corresponding profile when auth.users email changes
    UPDATE public.profiles 
    SET email = NEW.email, updated_at = NOW()
    WHERE id = NEW.id;
    
    RETURN NEW; 
END;
$$;

-- 3) Create trigger on auth.users to automatically sync email changes
-- This trigger fires whenever a user's email is updated in auth.users
DROP TRIGGER IF EXISTS sync_profile_email_trigger ON auth.users;
CREATE TRIGGER sync_profile_email_trigger
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_profile_email();

-- 4) Verify the sync worked by checking for any mismatched emails
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
JOIN auth.users au ON p.id = au.id
ORDER BY status DESC, p.created_at;

-- Success message
SELECT 'Profile email synchronization completed successfully!' as message;
SELECT 'Trigger created to keep emails in sync automatically.' as message;