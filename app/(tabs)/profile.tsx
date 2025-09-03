import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  FlatList,
  Switch,
  TextInput,
  Alert,
  ActivityIndicator,
  Pressable,
  Button,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { streakService } from '../../services/streakService';

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

interface Stat {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

interface MenuItem {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hasToggle?: boolean;
  danger?: boolean;
  toggleValue?: boolean;
  onPress?: () => void;
}

const CALC_METHODS: CalcMethodKey[] = [
  'MuslimWorldLeague','MoonsightingCommittee','NorthAmerica','Egyptian','Karachi','UmmAlQura','Turkey','Dubai','Kuwait','Qatar','Singapore','Tehran'
];

export default function Profile() {
  const [session, setSession] = useState<SessionT>(null);
  const [loading, setLoading] = useState(true);
  const [streakData, setStreakData] = useState({ currentStreak: 0, longestStreak: 0, totalPrayers: 0 });
  const [prayerBuddiesCount, setPrayerBuddiesCount] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [calcMethod, setCalcMethod] = useState<CalcMethodKey>('MuslimWorldLeague');
  const [madhab, setMadhab] = useState<MadhabKey>('Shafi');
  const [highLat, setHighLat] = useState<HighLatKey>('MiddleOfTheNight');
  const [graceMinutes, setGraceMinutes] = useState<string>('30');
  const [username, setUsername] = useState<string>('');

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
        .select('calc_method, madhab, high_lat_rule, grace_minutes, tz, current_streak, longest_streak, username')
        .eq('id', session.user.id)
        .single();

      if (!error && data) {
        if (data.calc_method) setCalcMethod(data.calc_method as CalcMethodKey);
        if (data.madhab) setMadhab(data.madhab as MadhabKey);
        if (data.high_lat_rule) setHighLat(data.high_lat_rule as HighLatKey);
        if (data.grace_minutes != null) setGraceMinutes(String(data.grace_minutes));
        if (data.username) setUsername(data.username);
        
        // Load streak data
        setStreakData({
          currentStreak: data.current_streak || 0,
          longestStreak: data.longest_streak || 0,
          totalPrayers: 0 // Will be calculated from prayer_checkins
        });
      } else {
        // Ensure row exists with timezone
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        await supabase.from('profiles').upsert({ id: session?.user?.id, tz }, { onConflict: 'id' });
      }
      
      // Load total prayers count (individual prayers completed)
      if (session?.user?.id) {
        const { data: prayerData } = await supabase
          .from('prayer_checkins')
          .select('id')
          .eq('user_id', session.user.id)
          .eq('completed', true);
        
        setStreakData(prev => ({
          ...prev,
          totalPrayers: prayerData?.length || 0
        }));
        
        // Load prayer buddies count
        const { data: buddyData } = await supabase
          .from('buddy_links')
          .select('id')
          .or(`user_a.eq.${session.user.id},user_b.eq.${session.user.id}`)
          .eq('status', 'accepted');
        
        setPrayerBuddiesCount(buddyData?.length || 0);
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
    
    // Validate username if provided
    if (username && (username.length < 3 || username.length > 30 || !/^[a-zA-Z0-9_]+$/.test(username))) {
      return Alert.alert('Invalid username', 'Username must be 3-30 characters and contain only letters, numbers, and underscores.');
    }
    
    const { error } = await supabase
      .from('profiles')
      .update({
        calc_method: calcMethod,
        madhab,
        high_lat_rule: highLat,
        grace_minutes: g,
        username: username || null
      })
      .eq('id', session.user.id);
    if (error) Alert.alert('Save failed', error.message);
    else Alert.alert('Saved', 'Preferences updated.');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const stats: Stat[] = [
    { label: 'Prayer Streak', value: `${streakData.currentStreak} days`, icon: 'trophy-outline', color: '#F59E0B' },
    { label: 'Total Prayers', value: `${streakData.totalPrayers}`, icon: 'calendar-outline', color: '#4F46E5' },
    { label: 'Prayer Buddies', value: `${prayerBuddiesCount}`, icon: 'people-outline', color: '#10B981' },
  ];

  const menuItems: MenuItem[] = [
    { icon: 'notifications-outline', label: 'Notifications', hasToggle: true, toggleValue: notificationsEnabled },
    { icon: 'settings-outline', label: 'Prayer Settings', onPress: () => setShowSettings(!showSettings) },
    { icon: 'shield-outline', label: 'Privacy Settings' },
    { icon: 'people-outline', label: 'Invite Friends' },
    { icon: 'log-out-outline', label: 'Sign Out', danger: true, onPress: signOut },
  ];

  const renderStat = ({ item }: { item: Stat }) => (
    <View style={styles.statItem}>
      <Ionicons name={item.icon} size={24} color={item.color} />
      <Text style={styles.statValue}>{item.value}</Text>
      <Text style={styles.statLabel}>{item.label}</Text>
    </View>
  );

  const renderMenuItem = ({ item, index }: { item: MenuItem; index: number }) => (
    <TouchableOpacity
      style={[
        styles.menuItem,
        index === menuItems.length - 1 && styles.lastMenuItem,
      ]}
      onPress={item.onPress}
    >
      <View style={styles.menuLeft}>
        <Ionicons
          name={item.icon}
          size={20}
          color={item.danger ? '#EF4444' : '#6B7280'}
        />
        <Text style={[styles.menuText, item.danger && styles.dangerText]}>
          {item.label}
        </Text>
      </View>
      
      {item.hasToggle ? (
        <Switch
          value={item.toggleValue}
          onValueChange={setNotificationsEnabled}
          trackColor={{ false: '#D1D5DB', true: '#4F46E5' }}
          thumbColor="white"
        />
      ) : (
        <Ionicons name="chevron-forward-outline" size={20} color="#9CA3AF" />
      )}
    </TouchableOpacity>
  );

  const userEmail = session?.user?.email || 'User';
  const displayName = username || userEmail.split('@')[0] || 'A';
  const avatarLetter = displayName[0]?.toUpperCase() || 'A';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <LinearGradient
          colors={['#4F46E5', '#7C3AED']}
          style={styles.header}
        >
          <View style={styles.profileContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{avatarLetter}</Text>
            </View>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.email}>{userEmail}</Text>
            <TouchableOpacity style={styles.editButton} onPress={() => setShowSettings(!showSettings)}>
              <Text style={styles.editButtonText}>Prayer Settings</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator size="large" color="#4F46E5" style={{ marginTop: 50 }} />
          ) : (
            <>
              {/* Stats */}
              <View style={styles.statsCard}>
                <FlatList
                  data={stats}
                  renderItem={renderStat}
                  keyExtractor={(item) => item.label}
                  numColumns={3}
                  scrollEnabled={false}
                />
              </View>

              {/* Prayer Settings (Collapsible) */}
              {showSettings && (
                <View style={styles.settingsCard}>
                  <Text style={styles.settingsTitle}>Profile & Prayer Settings</Text>
                  
                  <Text style={styles.label}>Username (optional)</Text>
                  <TextInput
                    value={username}
                    onChangeText={setUsername}
                    style={styles.input}
                    placeholder="Enter a custom username"
                    maxLength={30}
                  />
                  <Text style={[styles.label, { fontSize: 12, opacity: 0.6, marginTop: 4 }]}>3-30 characters, letters, numbers, and underscores only</Text>
                  
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

                  <View style={{ height: 16 }} />
                  <TouchableOpacity style={styles.saveButton} onPress={save}>
                    <Text style={styles.saveButtonText}>Save Settings</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Menu Items */}
              <View style={styles.menuCard}>
                <FlatList
                  data={menuItems}
                  renderItem={renderMenuItem}
                  keyExtractor={(item) => item.label}
                  scrollEnabled={false}
                />
              </View>

              {/* App Version */}
              <Text style={styles.version}>Prayer Buddy v1.0.0</Text>
            </>
          )}
        </View>
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
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 20,
  },
  profileContainer: {
    alignItems: 'center',
  },
  avatar: {
    width: 96,
    height: 96,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    color: 'white',
    fontSize: 36,
    fontWeight: 'bold',
  },
  name: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  email: {
    color: '#C7D2FE',
    fontSize: 14,
    marginBottom: 16,
  },
  editButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  editButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    padding: 20,
    marginTop: -16,
  },
  statsCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
  settingsCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  settingsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 16,
  },
  menuCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  lastMenuItem: {
    borderBottomWidth: 0,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuText: {
    fontSize: 16,
    color: '#1F2937',
    marginLeft: 12,
  },
  dangerText: {
    color: '#EF4444',
  },
  version: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 20,
  },
  saveButton: {
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  // Keep existing styles for settings
  label: { fontSize: 14, opacity: 0.7, marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, backgroundColor: '#fff' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  buttonSmall: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#eef5ff' }
});