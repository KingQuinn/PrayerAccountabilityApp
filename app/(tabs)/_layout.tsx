import { useEffect, useMemo, useState } from 'react';
import { View, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import dayjs from 'dayjs';
import { supabase } from '../../lib/supabase';

type BuddyLink = {
  id: string;
  user_a: string;
  user_b: string;
  created_by: string;
  status: 'pending' | 'accepted' | 'blocked';
  receiver_seen_at: string | null;
};

export default function TabsLayout() {
  const [userId, setUserId] = useState<string | null>(null);
  const [showBuddyBadge, setShowBuddyBadge] = useState(false);
  const [today, setToday] = useState(dayjs().format('YYYY-MM-DD'));

  // Auth session tracking
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setUserId(s?.user?.id ?? null)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // Midnight rollover: tick every 15s to update "today"
  useEffect(() => {
    const tick = () => {
      const d = dayjs().format('YYYY-MM-DD');
      if (d !== today) setToday(d);
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [today]);

  const refreshBadge = async () => {
    if (!userId) {
      setShowBuddyBadge(false);
      return;
    }

    // Unseen incoming invites
    const { data: links, error: linksErr } = await supabase
      .from('buddy_links')
      .select('id, created_by, receiver_seen_at, status, user_a, user_b')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .eq('status', 'pending')
      .is('receiver_seen_at', null);

    if (linksErr) {
      // Optional: console.warn('buddy_links query error', linksErr.message);
    }

    const unseenIncoming = (links || []).some((bl: BuddyLink) => bl.created_by !== userId);

    // Unseen nudges to me today
    const { data: nudges, error: nudgesErr } = await supabase
      .from('nudges')
      .select('id')
      .eq('to_user', userId)
      .eq('day', today)
      .is('seen_at', null);

    if (nudgesErr) {
      // Optional: console.warn('nudges query error', nudgesErr.message);
    }

    const unseenNudges = (nudges || []).length > 0;

    setShowBuddyBadge(unseenIncoming || unseenNudges);
  };

  // Initial + polling + realtime channels
  useEffect(() => {
    if (!userId) return;
    refreshBadge();
    const interval = setInterval(refreshBadge, 15000);

    const ch1 = supabase
      .channel(`buddy_links_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buddy_links', filter: `user_a=eq.${userId}` },
        refreshBadge
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buddy_links', filter: `user_b=eq.${userId}` },
        refreshBadge
      )
      .subscribe();

    const ch2 = supabase
      .channel(`nudges_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'nudges', filter: `to_user=eq.${userId}` },
        refreshBadge
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, [userId, today]);

  const withBadge =
    (focusedIcon: keyof typeof Ionicons.glyphMap, icon: keyof typeof Ionicons.glyphMap) =>
    ({ color, size, focused }: { color: string; size: number; focused: boolean }) =>
      (
        <View
          style={{
            width: size + 6,
            height: size + 6,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={focused ? focusedIcon : icon} size={size} color={color} />
          {showBuddyBadge && (
            <View
              style={{
                position: 'absolute',
                top: -1,
                right: -1,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: '#ff3b30',
                borderWidth: 1,
                borderColor: '#fff',
              }}
            />
          )}
        </View>
      );

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerTitleAlign: 'center',
        tabBarShowLabel: false,
        tabBarActiveTintColor: '#0077ff',
        tabBarStyle: {
          height: Platform.OS === 'android' ? 64 : 84,
          paddingBottom: Platform.OS === 'android' ? 8 : 20,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="prayers"
        options={{
          title: 'Prayers',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'time' : 'time-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="buddy"
        options={{
          title: 'Prayer Buddy',
          tabBarIcon: withBadge('people', 'people-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}