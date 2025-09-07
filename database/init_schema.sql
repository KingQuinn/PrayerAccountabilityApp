-- Initial database schema setup for Prayer Accountability App
-- This file should be run in Supabase SQL Editor to set up the database

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    tz TEXT DEFAULT 'UTC',
    calc_method TEXT DEFAULT 'MuslimWorldLeague',
    madhab TEXT DEFAULT 'Shafi',
    high_lat_rule TEXT DEFAULT 'MiddleOfTheNight',
    grace_minutes INTEGER DEFAULT 30,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    streak_updated_at DATE,
    push_token TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security on profiles table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for profiles table
-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Users can delete their own profile
CREATE POLICY "Users can delete own profile" ON profiles
    FOR DELETE USING (auth.uid() = id);

-- Create buddy_links table
CREATE TABLE IF NOT EXISTS buddy_links (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_a UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    user_b UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_a, user_b)
);

-- Enable RLS on buddy_links
ALTER TABLE buddy_links ENABLE ROW LEVEL SECURITY;

-- RLS policies for buddy_links
CREATE POLICY "Users can view their buddy links" ON buddy_links
    FOR SELECT USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY "Users can create buddy links" ON buddy_links
    FOR INSERT WITH CHECK (auth.uid() = user_a);

CREATE POLICY "Users can update their buddy links" ON buddy_links
    FOR UPDATE USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY "Users can delete their buddy links" ON buddy_links
    FOR DELETE USING (auth.uid() = user_a OR auth.uid() = user_b);

-- Create prayer_completions table
CREATE TABLE IF NOT EXISTS prayer_completions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, day)
);

-- Enable RLS on prayer_completions
ALTER TABLE prayer_completions ENABLE ROW LEVEL SECURITY;

-- RLS policies for prayer_completions
CREATE POLICY "Users can view own prayer completions" ON prayer_completions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own prayer completions" ON prayer_completions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prayer completions" ON prayer_completions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own prayer completions" ON prayer_completions
    FOR DELETE USING (auth.uid() = user_id);

-- Create prayer_checkins table
CREATE TABLE IF NOT EXISTS prayer_checkins (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    prayer TEXT NOT NULL CHECK (prayer IN ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha')),
    day DATE NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on prayer_checkins
ALTER TABLE prayer_checkins ENABLE ROW LEVEL SECURITY;

-- RLS policies for prayer_checkins
CREATE POLICY "Users can view prayer checkins" ON prayer_checkins
    FOR SELECT USING (
        auth.uid() = user_id OR 
        auth.uid() IN (
            SELECT user_a FROM buddy_links WHERE user_b = prayer_checkins.user_id AND status = 'accepted'
            UNION
            SELECT user_b FROM buddy_links WHERE user_a = prayer_checkins.user_id AND status = 'accepted'
        )
    );

CREATE POLICY "Users can insert own prayer checkins" ON prayer_checkins
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prayer checkins" ON prayer_checkins
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own prayer checkins" ON prayer_checkins
    FOR DELETE USING (auth.uid() = user_id);

-- Create nudges table
CREATE TABLE IF NOT EXISTS nudges (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    from_user UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    to_user UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on nudges
ALTER TABLE nudges ENABLE ROW LEVEL SECURITY;

-- RLS policies for nudges
CREATE POLICY "Users can view their nudges" ON nudges
    FOR SELECT USING (auth.uid() = from_user OR auth.uid() = to_user);

CREATE POLICY "Users can send nudges to buddies" ON nudges
    FOR INSERT WITH CHECK (
        auth.uid() = from_user AND
        to_user IN (
            SELECT user_a FROM buddy_links WHERE user_b = auth.uid() AND status = 'accepted'
            UNION
            SELECT user_b FROM buddy_links WHERE user_a = auth.uid() AND status = 'accepted'
        )
    );

CREATE POLICY "Users can delete their sent nudges" ON nudges
    FOR DELETE USING (auth.uid() = from_user);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_current_streak ON profiles(current_streak);
CREATE INDEX IF NOT EXISTS idx_profiles_last_active ON profiles(last_active_at);
CREATE INDEX IF NOT EXISTS idx_profiles_streak_updated ON profiles(streak_updated_at);
CREATE INDEX IF NOT EXISTS idx_profiles_push_token ON profiles(push_token);

CREATE INDEX IF NOT EXISTS idx_buddy_links_user_a ON buddy_links(user_a);
CREATE INDEX IF NOT EXISTS idx_buddy_links_user_b ON buddy_links(user_b);
CREATE INDEX IF NOT EXISTS idx_buddy_links_status ON buddy_links(status);

CREATE INDEX IF NOT EXISTS idx_prayer_completions_user_day ON prayer_completions(user_id, day);
CREATE INDEX IF NOT EXISTS idx_prayer_completions_day ON prayer_completions(day);

CREATE INDEX IF NOT EXISTS idx_prayer_checkins_user_id ON prayer_checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_user_day ON prayer_checkins(user_id, day);
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_prayer ON prayer_checkins(prayer);
CREATE INDEX IF NOT EXISTS idx_prayer_checkins_completed ON prayer_checkins(completed);

-- Add unique constraint to prevent duplicate entries
ALTER TABLE prayer_checkins ADD CONSTRAINT unique_user_prayer_day UNIQUE (user_id, prayer, day);

CREATE INDEX IF NOT EXISTS idx_nudges_from_user ON nudges(from_user);
CREATE INDEX IF NOT EXISTS idx_nudges_to_user ON nudges(to_user);
CREATE INDEX IF NOT EXISTS idx_nudges_created_at ON nudges(created_at);

-- Add comment for documentation
COMMENT ON TABLE profiles IS 'User profiles with prayer settings and streak data';
COMMENT ON TABLE buddy_links IS 'Connections between users for accountability';
COMMENT ON TABLE prayer_completions IS 'Daily prayer completion records for streak calculation';
COMMENT ON TABLE prayer_checkins IS 'Real-time prayer check-ins for buddy visibility';
COMMENT ON TABLE nudges IS 'Messages sent between accountability buddies';
COMMENT ON COLUMN profiles.push_token IS 'Expo push notification token for sending notifications to user device';

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_buddy_links_updated_at BEFORE UPDATE ON buddy_links
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create profile on user signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- Success message
SELECT 'Database schema initialized successfully!' as message;