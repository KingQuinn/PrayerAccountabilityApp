import { useEffect, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, View, Text, Button, StyleSheet, ActivityIndicator, Switch, Alert, AppState } from 'react-native';
import * as Location from 'expo-location';
import dayjs from 'dayjs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Coordinates, CalculationMethod, Madhab as AdhanMadhab, HighLatitudeRule as AdhanHighLat, PrayerTimes, CalculationParameters } from 'adhan';
import * as Notifications from 'expo-notifications';
import { scheduleNextPrayerNotification } from '../../notifications/adhanScheduler';
import { supabase } from '../../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

type SessionT = { user: { id: string; email?: string | null } | null } | null;

type Checklist = {
  fajr: boolean;
  dhuhr: boolean;
  asr: boolean;
  maghrib: boolean;
  isha: boolean;
};
const PRAYERS: (keyof Checklist)[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

type CalcMethodKey =
  | 'MuslimWorldLeague' | 'Egyptian' | 'Karachi' | 'NorthAmerica' | 'Kuwait' | 'Qatar' | 'Singapore'
  | 'UmmAlQura' | 'Dubai' | 'MoonsightingCommittee' | 'Turkey' | 'Tehran';
type MadhabKey = 'Shafi' | 'Hanafi';
type HighLatKey = 'MiddleOfTheNight' | 'SeventhOfTheNight' | 'TwilightAngle';

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
  'BarakAllahu feek! That was fantastic.'
];

export default function Home() {
  const [session, setSession] = useState<SessionT>(null);
  const uid = session?.user?.id || null;

  // Times
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [times, setTimes] = useState<Record<string, string> | null>(null);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  // Checklist + save banner
  const [checklist, setChecklist] = useState<Checklist>({ fajr: false, dhuhr: false, asr: false, maghrib: false, isha: false });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Prayer prefs
  const [calcMethod, setCalcMethod] = useState<CalcMethodKey>('MuslimWorldLeague');
  const [madhab, setMadhab] = useState<MadhabKey>('Shafi');
  const [highLat, setHighLat] = useState<HighLatKey>('MiddleOfTheNight');

  // Today + nudges strip
  const [today, setToday] = useState(dayjs().format('YYYY-MM-DD'));
  const [nudgedCount, setNudgedCount] = useState(0);

  // Timers/app state
  const dayTimer = useRef<any>(null);
  const gpsTimer = useRef<any>(null);
  const [bus, setBus] = useState<RealtimeChannel | null>(null);

  // Debounce/lock for scheduling to avoid loops
  const rescheduleLock = useRef(false);

  useEffect(() => {
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
      await loadProfilePrefs(uid);
      await getAndComputeWithCurrentLocation(); // will reschedule after compute
      await loadChecklistForDay(today, uid);
      await loadUnseenNudgesCount(today, uid);
    };
    setup();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // Refresh location + times; the function handles rescheduling
        getAndComputeWithCurrentLocation();
        if (uid) {
          loadChecklistForDay(today, uid);
          loadUnseenNudgesCount(today, uid);
        }
      }
    });

    // Periodic GPS refresh (kept)
    gpsTimer.current = setInterval(() => {
      getAndComputeWithCurrentLocation();
    }, 5 * 60 * 1000);

    return () => {
      sub.remove();
      clearInterval(gpsTimer.current);
    };
  }, [uid, today]);

  // Recompute if prefs change and coords present
  useEffect(() => {
    if (coords) {
      computeTimes(coords);
      rescheduleNextIfReady(0);
    }
  }, [calcMethod, madhab, highLat]);

  // Realtime: DB table changes for nudges (to me), plus app-bus broadcast
  useEffect(() => {
    if (!uid) return;

    // DB realtime for nudges to me
    const ch = supabase
      .channel(`nudges_home_${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nudges', filter: `to_user=eq.${uid}` }, () => {
        loadUnseenNudgesCount(dayjs().format('YYYY-MM-DD'), uid);
      })
      .subscribe();

    // App bus for immediate feedback when Buddy marks seen
    const busCh = supabase.channel(`app_bus_${uid}`).subscribe((_status) => {});
    // Listen to client-side broadcasts
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
    const { error } = await supabase.from('profiles').upsert({ id: userId, tz }, { onConflict: 'id' });
    if (error) console.warn('Profile upsert error', error.message);
  };

  const loadProfilePrefs = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('calc_method, madhab, high_lat_rule')
      .eq('id', userId)
      .single();
    if (data) {
      if (data.calc_method) setCalcMethod(data.calc_method as CalcMethodKey);
      if (data.madhab) setMadhab(data.madhab as MadhabKey);
      if (data.high_lat_rule) setHighLat(data.high_lat_rule as HighLatKey);
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

  const getAndComputeWithCurrentLocation = async () => {
    setLoadingTimes(true);
    setLocError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocError('Location permission denied. Please enable it in Settings to auto-compute prayer times.');
        setLoadingTimes(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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

  function buildParams(): CalculationParameters {
    let params: CalculationParameters;
    switch (calcMethod) {
      case 'MuslimWorldLeague': params = CalculationMethod.MuslimWorldLeague(); break;
      case 'Egyptian': params = CalculationMethod.Egyptian(); break;
      case 'Karachi': params = CalculationMethod.Karachi(); break;
      case 'NorthAmerica': params = CalculationMethod.NorthAmerica(); break;
      case 'Kuwait': params = CalculationMethod.Kuwait(); break;
      case 'Qatar': params = CalculationMethod.Qatar(); break;
      case 'Singapore': params = CalculationMethod.Singapore(); break;
      case 'UmmAlQura': params = CalculationMethod.UmmAlQura(); break;
      case 'Dubai': params = CalculationMethod.Dubai(); break;
      case 'MoonsightingCommittee': params = CalculationMethod.MoonsightingCommittee(); break;
      case 'Turkey': params = CalculationMethod.Turkey(); break;
      case 'Tehran': params = CalculationMethod.Tehran(); break;
      default: params = CalculationMethod.MuslimWorldLeague();
    }
    params.madhab = madhab === 'Hanafi' ? AdhanMadhab.Hanafi : AdhanMadhab.Shafi;
    switch (highLat) {
      case 'SeventhOfTheNight': params.highLatitudeRule = AdhanHighLat.SeventhOfTheNight; break;
      case 'TwilightAngle': params.highLatitudeRule = AdhanHighLat.TwilightAngle; break;
      default: params.highLatitudeRule = AdhanHighLat.MiddleOfTheNight;
    }
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
        isha: formatTime(pt.isha)
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
      const prefs = { calcMethod, madhab, highLat } as {
        calcMethod: CalcMethodKey; madhab: MadhabKey; highLat: HighLatKey;
      };
      await scheduleNextPrayerNotification(
        { latitude: coords.latitude, longitude: coords.longitude },
        prefs,
        { graceMinutes, playSound: true }
      );
    } finally {
      setTimeout(() => { rescheduleLock.current = false; }, 800);
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
      completed_at: completed ? new Date().toISOString() : null
    };
    const { error } = await supabase
      .from('prayer_checkins')
      .upsert(payload, { onConflict: 'user_id,day,prayer' });
    if (!error) {
      setSaveMsg('Mashallah');
      setTimeout(() => setSaveMsg(null), 1500);
      const willBeAllDone = PRAYERS.every((p) => (p === prayer ? completed : checklist[p]));
      if (willBeAllDone) {
        await maybeShowCongrats(today, uid);
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
    // Optional: after manually checking, you can still reschedule, but not required
    // rescheduleNextIfReady(0);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Welcome 👋</Text>
        <Text style={{ marginBottom: 16 }}>{session?.user?.email}</Text>

        {nudgedCount > 0 && (
          <View style={styles.nudgeStrip}>
            <Text style={{ color: '#9c2f2f', fontWeight: '600' }}>
              You were nudged {nudgedCount} time{nudgedCount > 1 ? 's' : ''} today
            </Text>
          </View>
        )}

        <Text style={styles.subtitle}>Today’s prayer times</Text>
        {loadingTimes && <ActivityIndicator size="small" />}
        {locError && <Text style={{ color: '#b00', marginTop: 8 }}>{locError}</Text>}

        <View style={styles.timesBox}>
          {times ? (
            <>
              <Row label="Fajr" value={times.fajr} />
              <Row label="Dhuhr" value={times.dhuhr} />
              <Row label="Asr" value={times.asr} />
              <Row label="Maghrib" value={times.maghrib} />
              <Row label="Isha" value={times.isha} />
            </>
          ) : (
            <View style={{ paddingVertical: 8 }}>
              <Text style={{ opacity: 0.7 }}>Waiting for current location…</Text>
              <View style={{ height: 8 }} />
              <Button title="Try again" onPress={getAndComputeWithCurrentLocation} />
            </View>
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          {PRAYERS.map((p) => (
            <CheckRow key={p} label={capitalize(p)} value={checklist[p]} onChange={onToggle(p)} />
          ))}
        </View>

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
function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
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
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, paddingBottom: 160 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 18, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  rowLabel: { fontSize: 16 },
  rowValue: { fontSize: 16, fontWeight: '600' },
  timesBox: { backgroundColor: '#f7f7f7', borderRadius: 10, padding: 12, marginTop: 8 },
  nudgeStrip: { backgroundColor: '#fde7e7', padding: 10, borderRadius: 8, marginBottom: 8, alignItems: 'center' }
});