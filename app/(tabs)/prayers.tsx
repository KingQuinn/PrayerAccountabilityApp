import { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, View, Text, StyleSheet, Button, ActivityIndicator, TextInput, TouchableOpacity, FlatList } from 'react-native';
import * as Location from 'expo-location';
import dayjs from 'dayjs';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Coordinates, CalculationMethod, Madhab as AdhanMadhab, HighLatitudeRule as AdhanHighLat, PrayerTimes, CalculationParameters } from 'adhan';
import { supabase } from '../../lib/supabase';

type Coords = { latitude: number; longitude: number };

type CalcMethodKey =
  | 'MuslimWorldLeague' | 'Egyptian' | 'Karachi' | 'NorthAmerica' | 'Kuwait' | 'Qatar' | 'Singapore'
  | 'UmmAlQura' | 'Dubai' | 'MoonsightingCommittee' | 'Turkey' | 'Tehran';
type MadhabKey = 'Shafi' | 'Hanafi';
type HighLatKey = 'MiddleOfTheNight' | 'SeventhOfTheNight' | 'TwilightAngle';
type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

interface PrayerTime {
  name: string;
  time: string;
  next: boolean;
}

const PRAYERS: PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export default function Prayers() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationName, setLocationName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const [calcMethod, setCalcMethod] = useState<CalcMethodKey>('MuslimWorldLeague');
  const [madhab, setMadhab] = useState<MadhabKey>('Shafi');
  const [highLat, setHighLat] = useState<HighLatKey>('MiddleOfTheNight');

  const [todayTimes, setTodayTimes] = useState<Record<PrayerKey, Date> | null>(null);
  const [tomorrowTimes, setTomorrowTimes] = useState<Record<PrayerKey, Date> | null>(null);

  const [countdown, setCountdown] = useState<string>('');
  const [nextLabel, setNextLabel] = useState<string>('');
  


  // Load prefs, coords, and prayer checklist from profile
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) return;
const { data: prof } = await supabase
        .from('profiles')
        .select('calc_method, madhab, high_lat_rule, lat, lon')
        .eq('id', userId)
        .single();
      if (prof?.calc_method) setCalcMethod(prof.calc_method as CalcMethodKey);
      if (prof?.madhab) setMadhab(prof.madhab as MadhabKey);
      if (prof?.high_lat_rule) setHighLat(prof.high_lat_rule as HighLatKey);
      if (typeof prof?.lat === 'number' && typeof prof?.lon === 'number') {
        const savedCoords = { latitude: prof.lat, longitude: prof.lon };
        setCoords(savedCoords);
        // Get location name for saved coordinates
        const name = await reverseGeocode(savedCoords.latitude, savedCoords.longitude);
        setLocationName(name);
      } else {
        // Automatically load location if not saved in profile
        loadLocation();
      }
    };
    load();
  }, []);

  // Recompute when coords or prefs change
  useEffect(() => {
    if (!coords) return;
    computeAll(coords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, calcMethod, madhab, highLat]);

  // Update countdown every second
  useEffect(() => {
    const id = setInterval(updateCountdown, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayTimes, tomorrowTimes]);

  const reverseGeocode = async (latitude: number, longitude: number) => {
    try {
      const result = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (result.length > 0) {
        const location = result[0];
        const city = location.city || location.subregion || location.region;
        const country = location.country;
        return city && country ? `${city}, ${country}` : 'Unknown Location';
      }
    } catch (error) {
      console.log('Reverse geocoding failed:', error);
    }
    return 'Unknown Location';
  };

  const loadLocation = async () => {
    setLoading(true);
    setLocError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocError('Location permission denied. You can enter latitude and longitude manually below.');
        setLoading(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setCoords(c);
      
      // Get location name
      const name = await reverseGeocode(c.latitude, c.longitude);
      setLocationName(name);
      
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (userId) {
        await supabase.from('profiles').update({ lat: c.latitude, lon: c.longitude }).eq('id', userId);
      }
    } catch (e: any) {
      setLocError(e?.message || 'Failed to get location.');
    } finally {
      setLoading(false);
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

  const computeAll = (c: Coords) => {
    try {
      const coordinates = new Coordinates(c.latitude, c.longitude);
      const params = buildParams();

      const d1 = new Date();
      const pt1 = new PrayerTimes(coordinates, d1, params);
      const todayMap: Record<PrayerKey, Date> = {
        fajr: pt1.fajr, dhuhr: pt1.dhuhr, asr: pt1.asr, maghrib: pt1.maghrib, isha: pt1.isha
      };

      const d2 = new Date();
      d2.setDate(d2.getDate() + 1);
      const pt2 = new PrayerTimes(coordinates, d2, params);
      const tomorrowMap: Record<PrayerKey, Date> = {
        fajr: pt2.fajr, dhuhr: pt2.dhuhr, asr: pt2.asr, maghrib: pt2.maghrib, isha: pt2.isha
      };

      setTodayTimes(todayMap);
      setTomorrowTimes(tomorrowMap);
      updateCountdown(todayMap, tomorrowMap);
    } catch (e) {
      // ignore for now; locError is handled elsewhere
    }
  };

  function findNextPrayer(now: Date, t1?: Record<PrayerKey, Date> | null, t2?: Record<PrayerKey, Date> | null): { label: string; time: Date } | null {
    if (!t1 || !t2) return null;
    for (const p of PRAYERS) {
      const t = t1[p];
      if (t > now) return { label: p, time: t };
    }
    // All done today -> Fajr tomorrow
    return { label: 'fajr', time: t2.fajr };
  }

  function updateCountdown(t1 = todayTimes || undefined as any, t2 = tomorrowTimes || undefined as any) {
    if (!t1 || !t2) { setCountdown(''); setNextLabel(''); return; }
    const now = new Date();
    const next = findNextPrayer(now, t1, t2);
    if (!next) { setCountdown(''); setNextLabel(''); return; }
    setNextLabel(capitalize(next.label as string));
    const diffMs = next.time.getTime() - now.getTime();
    if (diffMs <= 0) { setCountdown('Now'); return; }
    const totalSec = Math.floor(diffMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    setCountdown(`${pad(h)}:${pad(m)}:${pad(s)}`);
  }



  // Helper functions for modern UI
  const getPrayerTimes = (): PrayerTime[] => {
    if (!todayTimes) {
      return [
        { name: 'Fajr', time: '—', next: false },
        { name: 'Dhuhr', time: '—', next: false },
        { name: 'Asr', time: '—', next: false },
        { name: 'Maghrib', time: '—', next: false },
        { name: 'Isha', time: '—', next: false },
      ];
    }

    const now = new Date();
    const nextPrayer = findNextPrayer(now, todayTimes, tomorrowTimes);
    const nextPrayerName = nextPrayer?.label.toLowerCase();

    return [
      { name: 'Fajr', time: formatTime(todayTimes.fajr), next: nextPrayerName === 'fajr' },
      { name: 'Dhuhr', time: formatTime(todayTimes.dhuhr), next: nextPrayerName === 'dhuhr' },
      { name: 'Asr', time: formatTime(todayTimes.asr), next: nextPrayerName === 'asr' },
      { name: 'Maghrib', time: formatTime(todayTimes.maghrib), next: nextPrayerName === 'maghrib' },
      { name: 'Isha', time: formatTime(todayTimes.isha), next: nextPrayerName === 'isha' },
    ];
  };

  const renderPrayerItem = ({ item }: { item: PrayerTime }) => (
    <View style={[styles.prayerItem, item.next && styles.nextPrayerItem]}>
      <View style={styles.prayerLeft}>
        <View>
          <Text style={[styles.prayerName, item.next && styles.nextPrayerText]}>
            {item.name}
          </Text>
          {item.next && (
            <Text style={styles.nextPrayerLabel}>Next prayer</Text>
          )}
        </View>
      </View>
      <View style={styles.prayerRight}>
        <Text style={[styles.prayerTime, item.next && styles.nextPrayerText]}>
          {item.time}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Prayer Times</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Location & Date */}
        <View style={styles.card}>
          <View style={styles.locationRow}>
            <View style={styles.locationLeft}>
              <Ionicons name="location-outline" size={20} color="#4F46E5" />
              <Text style={styles.locationText}>
                {locationName || (coords ? `${coords.latitude.toFixed(2)}, ${coords.longitude.toFixed(2)}` : 'No location set')}
              </Text>
            </View>
            <TouchableOpacity onPress={loadLocation}>
              <Text style={styles.changeButton}>Change</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={20} color="#6B7280" />
            <Text style={styles.dateText}>{dayjs().format('dddd, MMMM D, YYYY')}</Text>
          </View>
          
          {locError && <Text style={styles.errorText}>{locError}</Text>}
        </View>

        {/* Next Prayer Countdown */}
        <LinearGradient
          colors={['#4F46E5', '#7C3AED']}
          style={styles.countdownCard}
        >
          <Text style={styles.countdownTitle}>Next Prayer</Text>
          <Text style={styles.countdownPrayer}>{nextLabel || 'Loading...'}</Text>
          <Text style={styles.countdownSubtitle}>
            {countdown && nextLabel ? `in ${countdown}` : 'Calculating...'}
          </Text>
          <Text style={styles.countdownTimer}>{countdown || '—'}</Text>
        </LinearGradient>

        {/* Prayer Times List */}
        <View style={styles.prayerListCard}>
          <FlatList
            data={getPrayerTimes()}
            renderItem={renderPrayerItem}
            keyExtractor={(item) => item.name}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.actionButton}>
            <Ionicons name="alarm-outline" size={24} color="#4F46E5" />
            <Text style={styles.actionButtonText}>Set Reminder</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton}>
            <Ionicons name="calendar-outline" size={24} color="#4F46E5" />
            <Text style={styles.actionButtonText}>View Calendar</Text>
          </TouchableOpacity>
        </View>
        

      </ScrollView>
    </SafeAreaView>
  );
}



function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function formatTime(d: Date) {
  const h = d.getHours();
  const m = d.getMinutes();
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${hour12}:${mm} ${ampm}`;
}
function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    backgroundColor: 'white',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
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
  locationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  locationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
    marginLeft: 8,
  },
  changeButton: {
    color: '#4F46E5',
    fontSize: 14,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateText: {
    fontSize: 14,
    color: '#111827',
    marginLeft: 8,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    marginTop: 12,
  },
  countdownCard: {
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  countdownTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  countdownPrayer: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  countdownSubtitle: {
    color: '#C7D2FE',
    fontSize: 14,
    marginBottom: 16,
  },
  countdownTimer: {
    color: 'white',
    fontSize: 32,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  prayerListCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  prayerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  nextPrayerItem: {
    backgroundColor: '#EEF2FF',
  },
  prayerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkButton: {
    marginRight: 16,
  },
  prayerName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  nextPrayerText: {
    color: '#4F46E5',
  },
  nextPrayerLabel: {
    fontSize: 12,
    color: '#4F46E5',
    marginTop: 2,
  },
  prayerRight: {
    alignItems: 'flex-end',
  },
  prayerTime: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  completedLabel: {
    fontSize: 12,
    color: '#10B981',
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: '#F3F4F6',
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
  },

});