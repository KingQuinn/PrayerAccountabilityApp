import { supabase } from '../lib/supabase';
import dayjs from 'dayjs';

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastActive: string | null;
}

export interface UserStreakInfo {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastActiveAt: string | null;
  streakUpdatedAt: string | null;
}

class StreakService {
  /**
   * Update user's last active timestamp
   */
  async updateLastActive(userId: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('update_last_active', {
        user_id_param: userId
      });
      
      if (error) {
        console.error('Error updating last active:', error);
      }
    } catch (error) {
      console.error('Error updating last active:', error);
    }
  }

  /**
   * Calculate streak for a specific user
   */
  async calculateUserStreak(userId: string): Promise<{ currentStreak: number; longestStreak: number } | null> {
    try {
      const { data, error } = await supabase.rpc('calculate_user_streak', {
        user_id_param: userId
      });
      
      if (error) {
        console.error('Error calculating user streak:', error);
        return null;
      }
      
      return data?.[0] || { currentStreak: 0, longestStreak: 0 };
    } catch (error) {
      console.error('Error calculating user streak:', error);
      return null;
    }
  }

  /**
   * Get streak data for a user from the profiles table
   */
  async getUserStreakData(userId: string): Promise<StreakData | null> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('current_streak, longest_streak, last_active_at')
        .eq('id', userId)
        .single();
      
      if (error) {
        console.error('Error fetching user streak data:', error);
        return null;
      }
      
      return {
        currentStreak: data.current_streak || 0,
        longestStreak: data.longest_streak || 0,
        lastActive: data.last_active_at
      };
    } catch (error) {
      console.error('Error fetching user streak data:', error);
      return null;
    }
  }

  /**
   * Get streak data for multiple users (for buddy screen)
   */
  async getMultipleUsersStreakData(userIds: string[]): Promise<Record<string, StreakData>> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, current_streak, longest_streak, last_active_at')
        .in('id', userIds);
      
      if (error) {
        console.error('Error fetching multiple users streak data:', error);
        return {};
      }
      
      const result: Record<string, StreakData> = {};
      data?.forEach(user => {
        result[user.id] = {
          currentStreak: user.current_streak || 0,
          longestStreak: user.longest_streak || 0,
          lastActive: user.last_active_at
        };
      });
      
      return result;
    } catch (error) {
      console.error('Error fetching multiple users streak data:', error);
      return {};
    }
  }

  /**
   * Update all user streaks (admin function)
   */
  async updateAllStreaks(): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('update_all_streaks');
      
      if (error) {
        console.error('Error updating all streaks:', error);
        return 0;
      }
      
      return data || 0;
    } catch (error) {
      console.error('Error updating all streaks:', error);
      return 0;
    }
  }

  /**
   * Format last active time for display
   */
  formatLastActive(lastActiveAt: string | null): string {
    if (!lastActiveAt) return 'Never';
    
    const now = dayjs();
    const lastActive = dayjs(lastActiveAt);
    const diffMinutes = now.diff(lastActive, 'minute');
    const diffHours = now.diff(lastActive, 'hour');
    const diffDays = now.diff(lastActive, 'day');
    
    if (diffMinutes < 1) {
      return 'Now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} min ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return lastActive.format('MMM D');
    }
  }

  /**
   * Check if user is currently online (active within last 5 minutes)
   */
  isUserOnline(lastActiveAt: string | null): boolean {
    if (!lastActiveAt) return false;
    
    const now = dayjs();
    const lastActive = dayjs(lastActiveAt);
    const diffMinutes = now.diff(lastActive, 'minute');
    
    return diffMinutes < 5;
  }

  /**
   * Initialize streak tracking for a new user
   */
  async initializeUserStreak(userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          current_streak: 0,
          longest_streak: 0,
          last_active_at: new Date().toISOString(),
          streak_updated_at: dayjs().format('YYYY-MM-DD')
        })
        .eq('id', userId);
      
      if (error) {
        console.error('Error initializing user streak:', error);
      }
    } catch (error) {
      console.error('Error initializing user streak:', error);
    }
  }
}

export const streakService = new StreakService();