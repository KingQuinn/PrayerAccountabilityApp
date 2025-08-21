import { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, View, Text, Button, StyleSheet, TextInput, Alert, ActivityIndicator, Pressable } from 'react-native';
import { supabase } from '../../lib/supabase';

type SessionT = { user: { id: string; email?: string | null } | null } | null;

type CalcMethodKey =
  | 'MuslimWorldLeague'
  | 'Egyptian'
  | 'Karachi'
  | 'NorthAmerica'
  | 'Kuwait'
  | 'Qatar'
  | 'Singapore'
  | 'UmmAlQura'
  | 'Dubai'
  | 'MoonsightingCommittee'
  | 'Turkey'
  | 'Tehran';

type MadhabKey = 'Shafi' | 'Hanafi';
type HighLatKey = 'MiddleOfTheNight' | 'SeventhOfTheNight' | 'TwilightAngle';

const CALC_METHODS: CalcMethodKey[] = [
  'MuslimWorldLeague','MoonsightingCommittee','NorthAmerica','Egyptian','Karachi','UmmAlQura','Turkey','Dubai','Kuwait','Qatar','Singapore','Tehran'
];

export default function Profile() {
  const [session, setSession] = useState<SessionT>(null);
  const [loading, setLoading] = useState(true);

  const [calcMethod, setCalcMethod] = useState<CalcMethodKey>('MuslimWorldLeague');
  const [madhab, setMadhab] = useState<MadhabKey>('Shafi');
  const [highLat, setHighLat] = useState<HighLatKey>('MiddleOfTheNight');
  const [graceMinutes, setGraceMinutes] = useState<string>('30');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!session?.user?.id) { setLoading(false); return; }
      const { data, error } = await supabase
        .from('profiles')
        .select('calc_method, madhab, high_lat_rule, grace_minutes, tz')
        .eq('id', session.user.id)
        .single();

      if (!error && data) {
        if (data.calc_method) setCalcMethod(data.calc_method as CalcMethodKey);
        if (data.madhab) setMadhab(data.madhab as MadhabKey);
        if (data.high_lat_rule) setHighLat(data.high_lat_rule as HighLatKey);
        if (data.grace_minutes != null) setGraceMinutes(String(data.grace_minutes));
      } else {
        // Ensure row exists with timezone
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        await supabase.from('profiles').upsert({ id: session?.user?.id, tz }, { onConflict: 'id' });
      }
      setLoading(false);
    };
    load();
  }, [session?.user?.id]);

  const cycle = <T,>(arr: T[], current: T): T => {
    const idx = arr.indexOf(current);
    return arr[(idx + 1) % arr.length];
  };

  const save = async () => {
    if (!session?.user?.id) return;
    const g = parseInt(graceMinutes, 10);
    if (Number.isNaN(g) || g < 0 || g > 180) {
      return Alert.alert('Invalid grace minutes', 'Enter a number between 0 and 180.');
    }
    const { error } = await supabase
      .from('profiles')
      .update({
        calc_method: calcMethod,
        madhab,
        high_lat_rule: highLat,
        grace_minutes: g
      })
      .eq('id', session.user.id);
    if (error) Alert.alert('Save failed', error.message);
    else Alert.alert('Saved', 'Preferences updated.');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile</Text>

        {loading ? (
          <ActivityIndicator size="small" />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>Email</Text>
              <Text style={{ fontWeight: '600', marginBottom: 8 }}>{session?.user?.email}</Text>

              <Text style={styles.label}>Calculation Method</Text>
              <RowSelector
                value={calcMethod}
                onNext={() => setCalcMethod(cycle(CALC_METHODS, calcMethod))}
                display={prettyCalc(calcMethod)}
              />

              <Text style={styles.label}>Madhab</Text>
              <RowSelector
                value={madhab}
                onNext={() => setMadhab(madhab === 'Shafi' ? 'Hanafi' : 'Shafi')}
                display={madhab}
              />

              <Text style={styles.label}>High-latitude rule</Text>
              <RowSelector
                value={highLat}
                onNext={() =>
                  setHighLat(
                    highLat === 'MiddleOfTheNight'
                      ? 'SeventhOfTheNight'
                      : highLat === 'SeventhOfTheNight'
                      ? 'TwilightAngle'
                      : 'MiddleOfTheNight'
                  )
                }
                display={prettyHighLat(highLat)}
              />

              <Text style={styles.label}>Grace minutes</Text>
              <TextInput
                value={graceMinutes}
                onChangeText={setGraceMinutes}
                keyboardType="number-pad"
                style={styles.input}
                placeholder="e.g. 30"
              />

              <View style={{ height: 8 }} />
              <Button title="Save preferences" onPress={save} />
            </View>
          </>
        )}

        <View style={{ height: 12 }} />
        <Button title="Sign Out" color="#b00" onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

function RowSelector({
  display,
  onNext
}: {
  value: string;
  display: string;
  onNext: () => void;
}) {
  return (
    <View style={styles.rowBetween}>
      <Text style={{ fontSize: 16, fontWeight: '600' }}>{display}</Text>
      <Pressable onPress={onNext} style={styles.buttonSmall}>
        <Text style={{ color: '#0077ff', fontWeight: '600' }}>Change</Text>
      </Pressable>
    </View>
  );
}

function prettyCalc(key: CalcMethodKey) {
  switch (key) {
    case 'MuslimWorldLeague': return 'Muslim World League (MWL)';
    case 'MoonsightingCommittee': return 'Moonsighting Committee';
    case 'NorthAmerica': return 'North America (ISNA)';
    case 'Egyptian': return 'Egyptian General Authority';
    case 'Karachi': return 'Karachi';
    case 'UmmAlQura': return 'Umm al-Qura (Makkah)';
    case 'Turkey': return 'Turkey';
    case 'Dubai': return 'Dubai (UAE)';
    case 'Kuwait': return 'Kuwait';
    case 'Qatar': return 'Qatar';
    case 'Singapore': return 'Singapore';
    case 'Tehran': return 'Tehran (Iran)';
    default: return key;
  }
}
function prettyHighLat(v: HighLatKey) {
  switch (v) {
    case 'MiddleOfTheNight': return 'Middle of the Night';
    case 'SeventhOfTheNight': return 'Seventh of the Night';
    case 'TwilightAngle': return 'Twilight Angle';
    default: return v;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '600' },
  card: { backgroundColor: '#f7f7f7', borderRadius: 10, padding: 12, gap: 10 },
  label: { fontSize: 14, opacity: 0.7 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, backgroundColor: '#fff' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  buttonSmall: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#eef5ff' }
});