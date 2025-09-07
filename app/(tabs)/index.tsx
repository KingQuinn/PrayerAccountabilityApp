import { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Alert,
  AppState,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Coordinates,
  CalculationMethod,
  Madhab as AdhanMadhab,
  HighLatitudeRule as AdhanHighLat,
  PrayerTimes,
  CalculationParameters,
} from 'adhan';
import * as Notifications from 'expo-notifications';
import { scheduleNextPrayerNotification, computeTodayPrayerDates, FIXED_MWL_PREFS } from '../../notifications/adhanScheduler';
import { supabase } from '../../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { streakService } from '../../services/streakService';

type SessionT = { user: { id: string; email?: string | null } | null } | null;

type Checklist = {
  fajr: boolean;
  dhuhr: boolean;
  asr: boolean;
  maghrib: boolean;
  isha: boolean;
};
const PRAYERS: (keyof Checklist)[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

interface PrayerProgress {
  name: string;
  completed: boolean;
  time: string;
}

interface BuddyUpdate {
  name: string;
  prayer: string;
  time: string;
}

interface BuddyUpdateData {
  user_id: string;
  prayer: string;
  updated_at: string;
  profile?: {
    email: string | null;
    username: string | null;
  };
}

const CONGRATS_LINES = [
  'Beautiful consistency! Keep it up.',
  'Every prayer strengthens the heart.',
  'Your discipline is inspiring. Mashallah!',
  'Great job staying on track today!',
  'May your efforts be accepted and multiplied.',
  'You showed up for every prayer. Wonderful!',
  'Steady steps lead to big blessings.',
  'Your commitment shines today!',
  'An excellent day of worship. Keep going!',
  'BarakAllahu feek! That was fantastic.',
];

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<SessionT>(null);
  const uid = session?.user?.id || null;

  // Times
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [times, setTimes] = useState<Record<string, string> | null>(null);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  // Checklist + save banner
  const [checklist, setChecklist] = useState<Checklist>({
    fajr: false,
    dhuhr: false,
    asr: false,
    maghrib: false,
    isha: false,
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Today + nudges strip
  const [today, setToday] = useState(dayjs().format('YYYY-MM-DD'));
  const [nudgedCount, setNudgedCount] = useState(0);

  // Timers/app state
  const dayTimer = useRef<any>(null);
  const gpsTimer = useRef<any>(null);
  const [bus, setBus] = useState<RealtimeChannel | null>(null);
  const [buddyUpdates, setBuddyUpdates] = useState<BuddyUpdateData[]>([]);

  // Debounce/lock for scheduling to avoid loops
  const rescheduleLock = useRef(false);

  useEffect(() => {
    // Auth session
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  // Detect day change (15s poll)
  useEffect(() => {
    const tick = () => {
      const d = dayjs().format('YYYY-MM-DD');
      if (d !== today) {
        setToday(d);
        setChecklist({ fajr: false, dhuhr: false, asr: false, maghrib: false, isha: false });
        if (uid) {
          loadChecklistForDay(d, uid);
          loadUnseenNudgesCount(d, uid);
        }
        if (coords) {
          computeTimes(coords);
          rescheduleNextIfReady(0);
        }
      }
    };
    tick();
    dayTimer.current = setInterval(tick, 15000);
    return () => clearInterval(dayTimer.current);
  }, [today, coords, uid]);

  // App start + resume + periodic GPS refresh
  useEffect(() => {
    const setup = async () => {
      if (!uid) return;
      await upsertProfile(uid);
      await getAndComputeWithCurrentLocation(); // will reschedule after compute
      await loadChecklistForDay(today, uid);
      await loadUnseenNudgesCount(today, uid);
      await loadBuddyUpdates(uid);
    };
    setup();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        getAndComputeWithCurrentLocation();
        if (uid) {
          loadChecklistForDay(today, uid);
          loadUnseenNudgesCount(today, uid);
          // Update last active timestamp when app becomes active
          streakService.updateLastActive(uid);
        }
      }
    });

    gpsTimer.current = setInterval(() => {
      getAndComputeWithCurrentLocation();
    }, 5 * 60 * 1000);

    return () => {
      sub.remove();
      clearInterval(gpsTimer.current);
    };
  }, [uid, today]);

  // Realtime: DB table changes for nudges (to me), plus app-bus broadcast
  useEffect(() => {
    if (!uid) return;

    // DB realtime for nudges to me
    const ch = supabase
      .channel(`nudges_home_${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'nudges', filter: `to_user=eq.${uid}` },
        () => {
          loadUnseenNudgesCount(dayjs().format('YYYY-MM-DD'), uid);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prayer_checkins' },
        () => {
          loadBuddyUpdates(uid);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buddy_links' },
        () => {
          loadBuddyUpdates(uid);
        }
      )
      .subscribe();

    // App bus for immediate feedback when Buddy marks seen
    const busCh = supabase.channel(`app_bus_${uid}`).subscribe((_status) => {});
    busCh.on('broadcast', { event: 'nudges_seen' }, (payload: any) => {
      const d = dayjs().format('YYYY-MM-DD');
      if (!payload?.day || payload.day === d) {
        loadUnseenNudgesCount(d, uid);
      } else {
        loadUnseenNudgesCount(d, uid);
      }
    });

    setBus(busCh);

    // Initial load
    loadUnseenNudgesCount(today, uid);

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(busCh);
    };
  }, [uid, today]);

  // Tick checklist when user taps a prayer notification
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(async (resp) => {
      const data = resp.notification.request.content.data as any;
      const key = data?.prayer as keyof Checklist | undefined;
      if (data?.type === 'prayer' && key && PRAYERS.includes(key)) {
        setChecklist((c) => ({ ...c, [key]: true }));
        await saveCheckin(key, true);
        // After a prayer is completed, schedule the next one
        rescheduleNextIfReady(0);
      }
    });
    return () => sub.remove();
  }, []);

  const upsertProfile = async (userId: string) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId, tz }, { onConflict: 'id' });
    if (error) console.warn('Profile upsert error', error.message);
    
    // Initialize streak tracking for new or existing users without last_active_at
    const { data: profile } = await supabase
      .from('profiles')
      .select('last_active_at')
      .eq('id', userId)
      .single();
    
    if (!profile?.last_active_at) {
      await streakService.initializeUserStreak(userId);
    }
  };

  // Count unseen nudges strictly for "today"
  const loadUnseenNudgesCount = async (dayStr: string, userId: string) => {
    const { data: rows, error } = await supabase
      .from('nudges')
      .select('id')
      .eq('to_user', userId)
      .eq('day', dayStr)
      .is('seen_at', null);
    if (!error) setNudgedCount((rows || []).length);
  };

  // Mark all today's incoming nudges as seen (clears Home banner)
  const markNudgesSeen = async () => {
    if (!uid) return;
    const { error } = await supabase
      .from('nudges')
      .update({ seen_at: new Date().toISOString() })
      .eq('to_user', uid)
      .eq('day', today)
      .is('seen_at', null);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setNudgedCount(0); // Clear the count immediately
      // Broadcast to other screens that nudges were seen
      if (bus) {
        bus.send({
          type: 'broadcast',
          event: 'nudges_seen',
          payload: { day: today }
        });
      }
    }
  };

  const loadBuddyUpdates = async (userId: string) => {
    // Get accepted buddy relationships
    const { data: links } = await supabase
      .from('buddy_links')
      .select('user_a,user_b')
      .eq('status', 'accepted')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`);
    
    if (!links || links.length === 0) {
      setBuddyUpdates([]);
      return;
    }
    
    // Get buddy IDs
    const buddyIds = links.map(link => 
      link.user_a === userId ? link.user_b : link.user_a
    );
    
    // Get recent prayer completions from buddies (last 24 hours)
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const today = dayjs().format('YYYY-MM-DD');
    
    const { data: updates } = await supabase
      .from('prayer_checkins')
      .select(`
        user_id,
        prayer,
        updated_at,
        profiles!inner(email,username)
      `)
      .in('user_id', buddyIds)
      .eq('completed', true)
      .in('day', [yesterday, today])
      .order('updated_at', { ascending: false })
      .limit(10);
    
    if (updates) {
      const formattedUpdates = updates.map((update: any) => ({
        user_id: update.user_id,
        prayer: update.prayer,
        updated_at: update.updated_at,
        profile: {
          email: update.profiles?.email || null,
          username: update.profiles?.username || null
        }
      }));
      setBuddyUpdates(formattedUpdates);
    }
  };

  const getAndComputeWithCurrentLocation = async () => {
    setLoadingTimes(true);
    setLocError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocError(
          'Location permission denied. Please enable it in Settings to auto-compute prayer times.'
        );
        setLoadingTimes(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setCoords(c);
      computeTimes(c);
      await rescheduleNextIfReady(0);
    } catch (e: any) {
      setLocError(e?.message || 'Failed to get location.');
    } finally {
      setLoadingTimes(false);
    }
  };

  // Fixed calculation method: MWL + Shafi + MiddleOfTheNight
  function buildParams(): CalculationParameters {
    const params = CalculationMethod.MuslimWorldLeague();
    params.madhab = AdhanMadhab.Shafi;
    params.highLatitudeRule = AdhanHighLat.MiddleOfTheNight;
    return params;
  }

  const computeTimes = (c: { latitude: number; longitude: number }) => {
    try {
      const date = new Date();
      const coordinates = new Coordinates(c.latitude, c.longitude);
      const params = buildParams();
      const pt = new PrayerTimes(coordinates, date, params);
      setTimes({
        fajr: formatTime(pt.fajr),
        dhuhr: formatTime(pt.dhuhr),
        asr: formatTime(pt.asr),
        maghrib: formatTime(pt.maghrib),
        isha: formatTime(pt.isha),
      });
    } catch (e: any) {
      setLocError(e?.message || 'Failed to compute prayer times.');
    }
  };

  // Schedule the next-only notification with a short lock to avoid loops
  async function rescheduleNextIfReady(graceMinutes = 0) {
    if (!coords || rescheduleLock.current) return;
    rescheduleLock.current = true;
    try {
      await scheduleNextPrayerNotification(
        { latitude: coords.latitude, longitude: coords.longitude },
        {
          calcMethod: 'MuslimWorldLeague',
          madhab: 'Shafi',
          highLat: 'MiddleOfTheNight'
        },
        { graceMinutes, playSound: true }
      );
    } finally {
      setTimeout(() => {
        rescheduleLock.current = false;
      }, 800);
    }
  }

  const loadChecklistForDay = async (dayStr: string, userId: string) => {
    const { data } = await supabase
      .from('prayer_checkins')
      .select('prayer, completed')
      .eq('user_id', userId)
      .eq('day', dayStr);
    const next: Checklist = { fajr: false, dhuhr: false, asr: false, maghrib: false, isha: false };
    (data || []).forEach((row) => {
      next[row.prayer as keyof Checklist] = !!row.completed;
    });
    setChecklist(next);
  };

  const saveCheckin = async (prayer: keyof Checklist, completed: boolean) => {
    if (!uid) return;
    setSaving(true);
    setSaveMsg(null);
    const payload = {
      user_id: uid,
      day: today,
      prayer,
      completed,
      completed_at: completed ? new Date().toISOString() : null,
    };
    const { error } = await supabase
      .from('prayer_checkins')
      .upsert(payload, { onConflict: 'user_id,day,prayer' });
    if (!error) {
      setSaveMsg('Mashallah');
      setTimeout(() => setSaveMsg(null), 1500);
      
      // Update last active timestamp when user completes a prayer
      await streakService.updateLastActive(uid);
      
      const willBeAllDone = PRAYERS.every((p) => (p === prayer ? completed : checklist[p]));
      if (willBeAllDone) {
        // Save to prayer_completions table for streak tracking
        await supabase
          .from('prayer_completions')
          .upsert({
            user_id: uid,
            day: today,
            completed_at: new Date().toISOString()
          }, { onConflict: 'user_id,day' });
        
        await maybeShowCongrats(today, uid);
        // Streak will be automatically updated by the database trigger
      }
    }
    setSaving(false);
  };

  // Show congratulations once per account per day
  const maybeShowCongrats = async (dayStr: string, userId: string) => {
    const keyLocal = `congrats_shown_${userId}_${dayStr}`;
    try {
      const { data } = await supabase
        .from('prayer_completions')
        .select('id')
        .eq('user_id', userId)
        .eq('day', dayStr)
        .limit(1);
      if (data && data.length > 0) return;

      const shown = await AsyncStorage.getItem(keyLocal);
      if (!shown) {
        const line = pickEncouragingLine(dayStr);
        Alert.alert('Congratulations!', line, [{ text: 'OK' }], { cancelable: true });
        await AsyncStorage.setItem(keyLocal, '1');
      }

      await supabase.from('prayer_completions').upsert(
        { user_id: userId, day: dayStr, completed_at: new Date().toISOString() },
        { onConflict: 'user_id,day' }
      );
    } catch {
      const shown = await AsyncStorage.getItem(keyLocal);
      if (!shown) {
        const line = pickEncouragingLine(dayStr);
        Alert.alert('Congratulations!', line, [{ text: 'OK' }], { cancelable: true });
        await AsyncStorage.setItem(keyLocal, '1');
      }
    }
  };

  const pickEncouragingLine = (dayStr: string) => {
    const idx = Math.abs(hashString(dayStr)) % CONGRATS_LINES.length;
    return CONGRATS_LINES[idx];
  };
  const hashString = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return h;
  };

  const onToggle = (key: keyof Checklist) => async (v: boolean) => {
    setChecklist((c) => ({ ...c, [key]: v }));
    await saveCheckin(key, v);
  };

  // Helper functions for new UI
  const getPrayerProgress = (): PrayerProgress[] => {
    if (!coords) {
      // Fallback to mock data when no location
      return [
        { name: 'Fajr', completed: checklist.fajr, time: '5:30 AM' },
        { name: 'Dhuhr', completed: checklist.dhuhr, time: '12:15 PM' },
        { name: 'Asr', completed: checklist.asr, time: '3:45 PM' },
        { name: 'Maghrib', completed: checklist.maghrib, time: '6:20 PM' },
        { name: 'Isha', completed: checklist.isha, time: '7:45 PM' },
      ];
    }

    // Use real prayer times from adhanScheduler
    const prayerTimes = computeTodayPrayerDates(
      { latitude: coords.latitude, longitude: coords.longitude },
      FIXED_MWL_PREFS
    );

    return [
      { name: 'Fajr', completed: checklist.fajr, time: formatTime(prayerTimes.fajr) },
      { name: 'Dhuhr', completed: checklist.dhuhr, time: formatTime(prayerTimes.dhuhr) },
      { name: 'Asr', completed: checklist.asr, time: formatTime(prayerTimes.asr) },
      { name: 'Maghrib', completed: checklist.maghrib, time: formatTime(prayerTimes.maghrib) },
      { name: 'Isha', completed: checklist.isha, time: formatTime(prayerTimes.isha) },
    ];
  };

  const getBuddyUpdates = (): BuddyUpdate[] => {
    const updates: BuddyUpdate[] = [];
    
    // Add nudge notification at the top if there are unseen nudges
    if (nudgedCount > 0) {
      updates.push({
        name: 'Nudge Alert',
        prayer: `You were nudged ${nudgedCount} time${nudgedCount > 1 ? 's' : ''} today`,
        time: 'Today'
      });
    }
    
    // Add regular buddy updates
    if (buddyUpdates && buddyUpdates.length > 0) {
      const regularUpdates = buddyUpdates.map(update => {
        // Prioritize username over email for display name
        let name = 'Unknown';
        if (update.profile?.username) {
          name = update.profile.username;
        } else if (update.profile?.email) {
          name = update.profile.email.split('@')[0];
        }
        
        return {
          name,
          prayer: update.prayer.charAt(0).toUpperCase() + update.prayer.slice(1),
          time: dayjs(update.updated_at).fromNow()
        };
      });
      updates.push(...regularUpdates);
    }
    
    return updates;
  };

  const renderPrayerItem = ({ item }: { item: PrayerProgress }) => (
    <TouchableOpacity 
      style={styles.prayerItem}
      onPress={() => {
        const prayerKey = item.name.toLowerCase() as keyof Checklist;
        onToggle(prayerKey)(!item.completed);
      }}
    >
      <View style={styles.prayerLeft}>
        <View style={[styles.checkCircle, item.completed && styles.checkCircleCompleted]}>
          {item.completed && (
            <Ionicons name="checkmark" size={16} color="white" />
          )}
        </View>
        <Text style={styles.prayerName}>{item.name}</Text>
      </View>
      <Text style={styles.prayerTime}>{item.time}</Text>
    </TouchableOpacity>
  );

  const renderBuddyUpdate = ({ item }: { item: BuddyUpdate }) => {
    const isNudgeAlert = item.name === 'Nudge Alert';
    
    if (isNudgeAlert) {
      return (
        <TouchableOpacity 
          style={[styles.buddyUpdateItem, styles.nudgeUpdateItem]}
          onPress={markNudgesSeen}
        >
          <View style={[styles.buddyAvatar, styles.nudgeAvatar]}>
            <Text style={styles.buddyAvatarText}>🔔</Text>
          </View>
          <View style={styles.buddyUpdateContent}>
            <Text style={styles.buddyUpdateText}>
              <Text style={styles.nudgeText}>{item.prayer}</Text>
            </Text>
            <Text style={styles.buddyUpdateTime}>Tap to dismiss</Text>
          </View>
          <TouchableOpacity 
            style={styles.dismissButton}
            onPress={markNudgesSeen}
          >
            <Ionicons name="close" size={16} color="#92400E" />
          </TouchableOpacity>
        </TouchableOpacity>
      );
    }
    
    return (
      <View style={styles.buddyUpdateItem}>
        <View style={styles.buddyAvatar}>
          <Text style={styles.buddyAvatarText}>{item.name[0]}</Text>
        </View>
        <View style={styles.buddyUpdateContent}>
          <Text style={styles.buddyUpdateText}>
            <Text style={styles.buddyName}>{item.name}</Text> completed {item.prayer}
          </Text>
          <Text style={styles.buddyUpdateTime}>{item.time}</Text>
        </View>
      </View>
    );
  };
  const completedCount = PRAYERS.filter(p => checklist[p]).length;
  const userEmail = session?.user?.email || 'User';
  const firstName = userEmail.split('@')[0] || 'A';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Assalamu Alaikum</Text>
          <Text style={styles.subGreeting}>Keep up the good work!</Text>
        </View>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>{firstName[0]?.toUpperCase() || 'A'}</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Today's Progress */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Today's Prayers</Text>
            <Text style={styles.progressText}>{completedCount}/5</Text>
          </View>
          
          <FlatList 
            data={getPrayerProgress()}
            renderItem={renderPrayerItem}
            keyExtractor={(item) => item.name}
            scrollEnabled={false}
          />
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => router.push('/prayers')}
          >
            <Ionicons name="time-outline" size={32} color="#4F46E5" />
            <Text style={styles.actionButtonText}>Prayer Times</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => router.push('/buddy')}
          >
            <Ionicons name="people-outline" size={32} color="#4F46E5" />
            <Text style={styles.actionButtonText}>My Buddies</Text>
          </TouchableOpacity>
        </View>
        


        {/* Recent Activity */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Buddy Updates</Text>
          {getBuddyUpdates().length > 0 ? (
            <FlatList 
              data={getBuddyUpdates()}
              renderItem={renderBuddyUpdate}
              keyExtractor={(item, index) => `${item.name}-${index}`}
              scrollEnabled={false}
            />
          ) : (
            <Text style={{ textAlign: 'center', color: '#6B7280', marginTop: 16 }}>
              No recent updates from your buddies
            </Text>
          )}
        </View>

        {/* Loading and Error States */}
        {loadingTimes && (
          <View style={styles.card}>
            <ActivityIndicator size="small" />
            <Text style={{ textAlign: 'center', marginTop: 8 }}>Loading prayer times...</Text>
          </View>
        )}
        
        {locError && (
          <View style={styles.card}>
            <Text style={{ color: '#b00', textAlign: 'center' }}>{locError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={getAndComputeWithCurrentLocation}>
              <Text style={styles.retryButtonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Save Status */}
        <View style={{ marginTop: 8, minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {saving && <ActivityIndicator size="small" />}
          {!!saveMsg && <Text style={{ color: '#0a0' }}>{saveMsg}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowBetween}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}
function CheckRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.rowBetween}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}
function formatTime(d: Date) {
  const h = d.getHours();
  const m = d.getMinutes();
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${hour12}:${mm} ${ampm}`;
}
function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  screen: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 12,
  },
  timesBox: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rowLabel: {
    fontSize: 16,
    color: '#111827',
  },
  rowValue: {
    fontSize: 16,
    fontWeight: '500',
    color: '#4F46E5',
  },
  header: {
    backgroundColor: 'white',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  greeting: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  subGreeting: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  profileAvatar: {
    width: 40,
    height: 40,
    backgroundColor: '#4F46E5',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileAvatarText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  progressText: {
    color: '#4F46E5',
    fontWeight: '600',
  },
  prayerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  prayerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkCircleCompleted: {
    backgroundColor: '#10B981',
  },
  prayerName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  prayerTime: {
    fontSize: 14,
    color: '#6B7280',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  actionButton: {
    flex: 1,
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    marginTop: 8,
    textAlign: 'center',
  },
  buddyUpdateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  buddyAvatar: {
    width: 32,
    height: 32,
    backgroundColor: '#10B981',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  buddyAvatarText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  buddyUpdateContent: {
    flex: 1,
  },
  buddyUpdateText: {
    fontSize: 14,
    color: '#111827',
  },
  buddyName: {
    fontWeight: '600',
  },
  buddyUpdateTime: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  retryButton: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  nudgeStrip: {
    backgroundColor: '#fde7e7',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  nudgeUpdateItem: {
    backgroundColor: '#FEF3C7',
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  nudgeAvatar: {
    backgroundColor: '#F59E0B',
  },
  nudgeText: {
    fontWeight: '600',
    color: '#92400E',
  },
  dismissButton: {
    padding: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(146, 64, 14, 0.1)',
  },
});