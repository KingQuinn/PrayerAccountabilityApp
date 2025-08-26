-- Add streak tracking and last active functionality to the database

-- Create prayer_completions table if it doesn't exist
CREATE TABLE IF NOT EXISTS prayer_completions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, day)
);

-- Create index for better performance on prayer_completions
CREATE INDEX IF NOT EXISTS idx_prayer_completions_user_day ON prayer_completions(user_id, day);
CREATE INDEX IF NOT EXISTS idx_prayer_completions_day ON prayer_completions(day);

-- Add streak and last active columns to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS streak_updated_at DATE;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_current_streak ON profiles(current_streak);
CREATE INDEX IF NOT EXISTS idx_profiles_last_active ON profiles(last_active_at);
CREATE INDEX IF NOT EXISTS idx_profiles_streak_updated ON profiles(streak_updated_at);

-- Add comments for documentation
COMMENT ON COLUMN profiles.current_streak IS 'Current consecutive days of completing all 5 daily prayers';
COMMENT ON COLUMN profiles.longest_streak IS 'Longest streak of consecutive days completing all prayers';
COMMENT ON COLUMN profiles.last_active_at IS 'Timestamp of last user activity in the app';
COMMENT ON COLUMN profiles.streak_updated_at IS 'Date when streak was last calculated/updated';

-- Create a function to calculate streak for a user
CREATE OR REPLACE FUNCTION calculate_user_streak(user_id_param UUID)
RETURNS TABLE(current_streak INTEGER, longest_streak INTEGER) AS $$
DECLARE
    current_count INTEGER := 0;
    longest_count INTEGER := 0;
    temp_count INTEGER := 0;
    completion_date DATE;
    prev_date DATE;
    first_iteration BOOLEAN := TRUE;
BEGIN
    -- Get all completion dates in descending order
    FOR completion_date IN
        SELECT day FROM prayer_completions 
        WHERE user_id = user_id_param 
        ORDER BY day DESC
    LOOP
        IF first_iteration THEN
            -- Start counting from the most recent completion
            current_count := 1;
            temp_count := 1;
            prev_date := completion_date;
            first_iteration := FALSE;
        ELSE
            -- Check if this date is consecutive to the previous one
            IF completion_date = prev_date - INTERVAL '1 day' THEN
                current_count := current_count + 1;
                temp_count := temp_count + 1;
            ELSE
                -- Streak broken, update longest if needed
                IF temp_count > longest_count THEN
                    longest_count := temp_count;
                END IF;
                
                -- If this is not the current streak (gap found), reset current_count
                IF prev_date != (SELECT MAX(day) FROM prayer_completions WHERE user_id = user_id_param) THEN
                    current_count := 0;
                END IF;
                
                temp_count := 1;
            END IF;
            prev_date := completion_date;
        END IF;
    END LOOP;
    
    -- Final check for longest streak
    IF temp_count > longest_count THEN
        longest_count := temp_count;
    END IF;
    
    -- If no completions found, both streaks are 0
    IF first_iteration THEN
        current_count := 0;
        longest_count := 0;
    END IF;
    
    -- Preserve current streak - don't reset to 0
    -- The streak represents the last consecutive days completed
    -- It should only be recalculated when new completions are added
    
    RETURN QUERY SELECT current_count, longest_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to update all user streaks
CREATE OR REPLACE FUNCTION update_all_streaks()
RETURNS INTEGER AS $$
DECLARE
    user_record RECORD;
    streak_result RECORD;
    updated_count INTEGER := 0;
BEGIN
    FOR user_record IN SELECT id FROM profiles LOOP
        SELECT * INTO streak_result FROM calculate_user_streak(user_record.id);
        
        UPDATE profiles 
        SET 
            current_streak = GREATEST(current_streak, streak_result.current_streak),
            longest_streak = GREATEST(longest_streak, streak_result.longest_streak),
            streak_updated_at = CURRENT_DATE
        WHERE id = user_record.id;
        
        updated_count := updated_count + 1;
    END LOOP;
    
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to update last active timestamp
CREATE OR REPLACE FUNCTION update_last_active(user_id_param UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE profiles 
    SET last_active_at = NOW()
    WHERE id = user_id_param;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to automatically update streaks when prayer_completions changes
CREATE OR REPLACE FUNCTION trigger_update_streak()
RETURNS TRIGGER AS $$
DECLARE
    streak_result RECORD;
BEGIN
    -- Get the user_id from the affected row
    IF TG_OP = 'DELETE' THEN
        SELECT * INTO streak_result FROM calculate_user_streak(OLD.user_id);
        UPDATE profiles 
        SET 
            current_streak = streak_result.current_streak,
            longest_streak = GREATEST(longest_streak, streak_result.longest_streak),
            streak_updated_at = CURRENT_DATE
        WHERE id = OLD.user_id;
    ELSE
        SELECT * INTO streak_result FROM calculate_user_streak(NEW.user_id);
        UPDATE profiles 
        SET 
            current_streak = GREATEST(current_streak, streak_result.current_streak),
            longest_streak = GREATEST(longest_streak, streak_result.longest_streak),
            streak_updated_at = CURRENT_DATE
        WHERE id = NEW.user_id;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS update_streak_trigger ON prayer_completions;
CREATE TRIGGER update_streak_trigger
    AFTER INSERT OR UPDATE OR DELETE ON prayer_completions
    FOR EACH ROW EXECUTE FUNCTION trigger_update_streak();

-- Initial calculation of streaks for existing users
SELECT update_all_streaks();