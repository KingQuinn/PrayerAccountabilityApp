import { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, View, Text, StyleSheet, Button, ActivityIndicator, TextInput } from 'react-native';
import * as Location from 'expo-location';
import dayjs from 'dayjs';
import { Coordinates, CalculationMethod, Madhab as AdhanMadhab, HighLatitudeRule as AdhanHighLat, PrayerTimes, CalculationParameters } from 'adhan';
import { supabase } from '../../lib/supabase';

type Coords = { latitude: number; longitude: number };

type CalcMethodKey =
  | 'MuslimWorldLeague' | 'Egyptian' | 'Karachi' | 'NorthAmerica' | 'Kuwait' | 'Qatar' | 'Singapore'
  | 'UmmAlQura' | 'Dubai' | 'MoonsightingCommittee' | 'Turkey' | 'Tehran';
type MadhabKey = 'Shafi' | 'Hanafi';
type HighLatKey = 'MiddleOfTheNight' | 'SeventhOfTheNight' | 'TwilightAngle';
type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

const PRAYERS: PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export default function Prayers() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [loading, setLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const [calcMethod, setCalcMethod] = useState<CalcMethodKey>('MuslimWorldLeague');
  const [madhab, setMadhab] = useState<MadhabKey>('Shafi');
  const [highLat, setHighLat] = useState<HighLatKey>('MiddleOfTheNight');

  const [todayTimes, setTodayTimes] = useState<Record<PrayerKey, Date> | null>(null);
  const [tomorrowTimes, setTomorrowTimes] = useState<Record<PrayerKey, Date> | null>(null);

  const [countdown, setCountdown] = useState<string>('');
  const [nextLabel, setNextLabel] = useState<string>('');

  // Load prefs and coords from profile
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
        setCoords({ latitude: prof.lat, longitude: prof.lon });
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

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Prayers</Text>

        <View style={styles.card}>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>
            Next: {nextLabel ? `${nextLabel} in ${countdown || '—'}` : '—'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Location</Text>

          {locError && <Text style={{ color: '#b00', marginBottom: 8 }}>{locError}</Text>}

          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              placeholder="Latitude"
              style={[styles.input, { flex: 1 }]}
              keyboardType="decimal-pad"
              value={coords?.latitude?.toString() || ''}
              onChangeText={(t) => setCoords((prev) => ({ longitude: prev?.longitude ?? 0, latitude: Number(t) || 0 }))}
            />
            <TextInput
              placeholder="Longitude"
              style={[styles.input, { flex: 1 }]}
              keyboardType="decimal-pad"
              value={coords?.longitude?.toString() || ''}
              onChangeText={(t) => setCoords((prev) => ({ latitude: prev?.latitude ?? 0, longitude: Number(t) || 0 }))}
            />
          </View>
          <View style={{ height: 8 }} />
          <Button title="Use current location" onPress={loadLocation} />

          <View style={{ height: 8 }} />
          <Button title="Recompute" onPress={() => coords && computeAll(coords)} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Today ({dayjs().format('YYYY-MM-DD')})</Text>
          {loading && <ActivityIndicator size="small" />}
          {todayTimes ? (
            <>
              <Row label="Fajr" value={formatTime(todayTimes.fajr)} />
              <Row label="Dhuhr" value={formatTime(todayTimes.dhuhr)} />
              <Row label="Asr" value={formatTime(todayTimes.asr)} />
              <Row label="Maghrib" value={formatTime(todayTimes.maghrib)} />
              <Row label="Isha" value={formatTime(todayTimes.isha)} />
            </>
          ) : (
            <Text>Enter/load a location to see times.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Tomorrow ({dayjs().add(1, 'day').format('YYYY-MM-DD')})</Text>
          {tomorrowTimes ? (
            <>
              <Row label="Fajr" value={formatTime(tomorrowTimes.fajr)} />
              <Row label="Dhuhr" value={formatTime(tomorrowTimes.dhuhr)} />
              <Row label="Asr" value={formatTime(tomorrowTimes.asr)} />
              <Row label="Maghrib" value={formatTime(tomorrowTimes.maghrib)} />
              <Row label="Isha" value={formatTime(tomorrowTimes.isha)} />
            </>
          ) : (
            <Text>Enter/load a location to see times.</Text>
          )}
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
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, gap: 12, paddingBottom: 160 },
  title: { fontSize: 22, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  card: { backgroundColor: '#f7f7f7', borderRadius: 10, padding: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { fontSize: 16 },
  rowValue: { fontSize: 16, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, backgroundColor: '#fff' }
});