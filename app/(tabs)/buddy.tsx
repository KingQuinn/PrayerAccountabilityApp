import { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, View, Text, StyleSheet, TextInput, Button, Alert, ActivityIndicator, Pressable, AppState, ViewStyle } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import dayjs from 'dayjs';
import { supabase } from '../../lib/supabase';
import { scheduleTestAudioNotification } from '../../notifications/adhanScheduler';
import { pushNotificationService } from '../../notifications/pushService';


type SessionT = { user: { id: string; email?: string | null } | null } | null;

type BuddyLink = {
  id: string;
  user_a: string;
  user_b: string;
  created_by: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  receiver_seen_at: string | null;
};

type ProfileLite = { id: string; email: string | null };
type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
const PRAYERS: PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export default function Buddy() {
  const [session, setSession] = useState<SessionT>(null);
  const me = session?.user?.id || null;
  const today = useMemo(() => dayjs().format('YYYY-MM-DD'), []);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const [links, setLinks] = useState<BuddyLink[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);

  // buddies’ check-ins for today: userId -> prayer -> boolean
  const [feed, setFeed] = useState<Record<string, Partial<Record<PrayerKey, boolean>>>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Outgoing nudges today (kept for display/logic if needed; unlimited nudges still allowed)
  const [nudgedFromMe, setNudgedFromMe] = useState<Record<string, Partial<Record<PrayerKey, boolean>>>>({});

  // Temporary cooldown to prevent accidental rapid-fire nudges: userId -> expiresAt ms
  const [cooldown, setCooldown] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  // Boot + periodic refresh
  useEffect(() => {
    if (!me) return;
    const boot = async () => {
      await Promise.all([loadLinks(), loadFeed(), loadOutgoingNudges()]);
      setLoading(false);
    };
    boot();

    // Shorter polling for frequent updates
    const pollId = setInterval(() => {
      loadFeed();
      loadOutgoingNudges();
    }, 8000);

    // Also refresh on app resume
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        loadFeed();
        loadOutgoingNudges();
      }
    });

    return () => {
      clearInterval(pollId);
      appSub.remove();
    };
  }, [me, today]);

  // Mark invites seen when Buddy gains focus (keep behavior).
  useFocusEffect(
    useMemo(() => {
      const run = async () => {
        if (!me) return;
        await supabase
          .from('buddy_links')
          .update({ receiver_seen_at: new Date().toISOString() })
          .eq('status', 'pending')
          .neq('created_by', me)
          .or(`user_a.eq.${me},user_b.eq.${me}`)
          .is('receiver_seen_at', null);
      };
      run();
      return () => {};
    }, [me, today])
  );

  // Realtime: live updates
  useEffect(() => {
    if (!me) return;
    const ch = supabase
      .channel(`buddy_live_${me}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prayer_checkins' }, loadFeed)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buddy_links', filter: `user_a=eq.${me}` }, loadLinks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buddy_links', filter: `user_b=eq.${me}` }, loadLinks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nudges', filter: `from_user=eq.${me}` }, loadOutgoingNudges)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [me]);

  const loadLinks = async () => {
    if (!me) return;
    const { data } = await supabase
      .from('buddy_links')
      .select('*')
      .or(`user_a.eq.${me},user_b.eq.${me}`);
    setLinks((data || []) as BuddyLink[]);

    const ids = new Set<string>();
    (data || []).forEach((bl: any) => {
      ids.add(bl.user_a);
      ids.add(bl.user_b);
    });
    if (ids.size) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id,email')
        .in('id', Array.from(ids));
      const map: Record<string, ProfileLite> = {};
      (profs || []).forEach((p) => (map[p.id] = { id: p.id, email: p.email ?? null }));
      setProfiles(map);
    }
  };

  const acceptedBuddies = () => {
    if (!me) return [] as string[];
    return links.filter((l) => l.status === 'accepted').map((l) => (l.user_a === me ? l.user_b : l.user_a));
  };

  const loadFeed = async () => {
    if (!me) return;
    const ids = acceptedBuddies();
    if (!ids.length) return setFeed({});
    const { data, error } = await supabase
      .from('prayer_checkins')
      .select('user_id,prayer,completed')
      .eq('day', today)
      .in('user_id', ids);
    if (error) return;
    const map: Record<string, Partial<Record<PrayerKey, boolean>>> = {};
    (data || []).forEach((row: any) => {
      const u = row.user_id as string;
      const p = row.prayer as PrayerKey;
      if (!map[u]) map[u] = {};
      map[u][p] = !!row.completed;
    });
    setFeed(map);
  };

  const loadOutgoingNudges = async () => {
    if (!me) return;
    const { data } = await supabase
      .from('nudges')
      .select('to_user,prayer')
      .eq('from_user', me)
      .eq('day', today);
    const map: Record<string, Partial<Record<PrayerKey, boolean>>> = {};
    (data || []).forEach((r: any) => {
      const u = r.to_user as string;
      const p = r.prayer as PrayerKey;
      if (!map[u]) map[u] = {};
      map[u][p] = true;
    });
    setNudgedFromMe(map);
  };

  const nextDuePrayer = (userId: string): PrayerKey | null => {
    const todayMap = feed[userId] || {};
    for (const p of PRAYERS) {
      if (todayMap[p] !== true) return p;
    }
    return null;
  };

  const canNudge = (userId: string) => {
    // Active if there exists at least one incomplete prayer
    const todayMap = feed[userId] || {};
    return PRAYERS.some((p) => todayMap[p] !== true);
  };

  // Unlimited nudges: no duplicate restriction (ensure DB unique index is dropped)
  const nudge = async (toUser: string) => {
    if (!me) return;
    const prayer = nextDuePrayer(toUser);
    if (!prayer) {
      Alert.alert('All set', 'Your buddy has completed all prayers today.');
      return;
    }
    const { error } = await supabase.from('nudges').insert({
      from_user: me,
      to_user: toUser,
      day: today,
      prayer
    });
    if (error) {
      Alert.alert('Nudge failed', error.message);
    } else {
      // Send push notification to buddy
      const fromUserEmail = session?.user?.email || 'Your buddy';
      await pushNotificationService.sendNudgeNotification(
        toUser,
        fromUserEmail,
        prayer
      );
      
      Alert.alert('Nudge sent!', `${profiles[toUser]?.email || 'Your buddy'} has been nudged about ${prayer} prayer.`);
      
      // Optional refresh
      await loadOutgoingNudges();
    }
  };

  // Wrapper that enforces a short cooldown per buddy to avoid accidental rapid-fire
  const testAudioNotification = async () => {
    try {
      await scheduleTestAudioNotification();
      Alert.alert('Test Scheduled', 'Audio notification will play in 10 seconds!');
    } catch (error) {
      console.error('Error scheduling test notification:', error);
      Alert.alert('Error', 'Failed to schedule test notification');
    }
  };

  const onNudgePress = async (userId: string) => {
    const now = Date.now();
    const until = cooldown[userId] || 0;
    if (until && until > now) return; // still cooling down
    // set 1.5s cooldown
    setCooldown((c) => ({ ...c, [userId]: now + 1500 }));
    try {
      await nudge(userId);
    } finally {
      setTimeout(() => {
        setCooldown((c) => {
          const n = { ...c };
          delete n[userId];
          return n;
        });
      }, 1500);
    }
  };

  // Mark all today's incoming nudges as seen (clears Home banner)
  const markNudgesSeen = async () => {
    if (!me) return;
    const { error } = await supabase
      .from('nudges')
      .update({ seen_at: new Date().toISOString() })
      .eq('to_user', me)
      .eq('day', today)
      .is('seen_at', null);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('All set', 'Nudges marked as seen.');
    }
  };



  const sendInvite = async () => {
    if (!me) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return Alert.alert('Enter an email');
    if (session?.user?.email?.toLowerCase() === email) return Alert.alert('You cannot invite yourself');
    setInviting(true);
    try {
      const { data: prof, error: pe } = await supabase.from('profiles').select('id,email').eq('email', email).single();
      if (pe || !prof) return Alert.alert('Not found', 'No user with that email.');
      const targetId = prof.id as string;
      const [ua, ub] = [me!, targetId].sort() as [string, string];
      const { error: ie } = await supabase.from('buddy_links').insert({
        user_a: ua,
        user_b: ub,
        created_by: me,
        status: 'pending',
        receiver_seen_at: null
      });
      if (ie) {
        if ((ie as any).code === '23505') Alert.alert('Invite exists', 'A link already exists between you and this user.');
        else Alert.alert('Invite failed', ie.message);
      } else {
        Alert.alert('Invite sent', `Invitation sent to ${email}.`);
        setInviteEmail('');
        await loadLinks();
      }
    } finally {
      setInviting(false);
    }
  };

  const acceptInvite = async (linkId: string) => {
    const { error } = await supabase.from('buddy_links').update({ status: 'accepted' }).eq('id', linkId);
    if (error) Alert.alert('Error', error.message);
    await Promise.all([loadLinks(), loadFeed(), loadOutgoingNudges()]);
  };

  const declineOrRemove = async (linkId: string) => {
    const { error } = await supabase.from('buddy_links').delete().eq('id', linkId);
    if (error) Alert.alert('Error', error.message);
    await Promise.all([loadLinks(), loadFeed(), loadOutgoingNudges()]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadLinks(), loadFeed(), loadOutgoingNudges()]);
    setRefreshing(false);
    // Cooldowns naturally expire; pressing refresh doesn’t block nudging.
  };

  const pendingIncoming = links.filter((bl) => bl.status === 'pending' && bl.created_by !== me);
  const pendingOutgoing = links.filter((bl) => bl.status === 'pending' && bl.created_by === me);
  const accepted = links.filter((bl) => bl.status === 'accepted');

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>🤝 Prayer Buddy</Text>
        <Text style={styles.subtitle}>Stay accountable with your prayer partners 🕌</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>

        {loading ? (
          <ActivityIndicator size="small" />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>📧 Invite a buddy</Text>
              <TextInput
                placeholder="Friend’s email"
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.input}
                value={inviteEmail}
                onChangeText={setInviteEmail}
              />
              <CustomButton 
                title={inviting ? 'Sending...' : '📧 Send invite'} 
                onPress={sendInvite} 
                disabled={inviting}
                variant="primary"
              />
              <View style={{ height: 12 }} />
              <CustomButton 
                title={refreshing ? 'Refreshing...' : '🔄 Refresh'} 
                onPress={onRefresh}
                variant="secondary"
              />
              <View style={{ height: 12 }} />
              <CustomButton 
                title="🔊 Test Audio" 
                onPress={testAudioNotification} 
                variant="primary"
              />
              <View style={{ height: 12 }} />
              <CustomButton 
                title="👁️ Mark nudges as seen" 
                onPress={markNudgesSeen}
                variant="secondary"
                size="small"
              />

            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>⏳ Pending invites</Text>
              {pendingIncoming.length === 0 && pendingOutgoing.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>📭 No pending invites</Text>
                    <Text style={styles.emptyStateSubtext}>Send an invite above to get started!</Text>
                  </View>
                ) : (
                <>
                  {pendingIncoming.map((bl) => {
                    const other = me === bl.user_a ? bl.user_b : bl.user_a;
                    const email = profiles[other]?.email || other;
                    return (
                      <View key={bl.id} style={styles.rowBetween}>
                        <Text>From {email}</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <CustomButton title="✅ Accept" onPress={() => acceptInvite(bl.id)} variant="success" size="small" />
                          <CustomButton title="❌ Decline" onPress={() => declineOrRemove(bl.id)} variant="danger" size="small" />
                        </View>
                      </View>
                    );
                  })}
                  {pendingOutgoing.map((bl) => {
                    const other = me === bl.user_a ? bl.user_b : bl.user_a;
                    const email = profiles[other]?.email || other;
                    return (
                      <View key={bl.id} style={styles.rowBetween}>
                        <Text>To {email} (waiting)</Text>
                        <CustomButton title="🚫 Cancel" onPress={() => declineOrRemove(bl.id)} variant="danger" size="small" />
                      </View>
                    );
                  })}
                </>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>👥 Your buddies (today)</Text>
              {accepted.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>👤 No prayer buddies yet</Text>
                    <Text style={styles.emptyStateSubtext}>Invite friends to start your accountability journey!</Text>
                  </View>
                ) : (
                accepted.map((bl) => {
                  const other = me === bl.user_a ? bl.user_b : bl.user_a;
                  const email = profiles[other]?.email || other;
                  const todayMap = feed[other] || {};
                  const next = nextDuePrayer(other);
                  const active = canNudge(other);
                  const isCooling = !!cooldown[other] && cooldown[other] > Date.now();

                  return (
                    <View key={bl.id} style={styles.buddyBlock}>
                      <View style={styles.rowBetween}>
                        <Text style={{ fontWeight: '600' }}>{email}</Text>
                        <CustomButton title="🗑️ Remove" onPress={() => declineOrRemove(bl.id)} variant="danger" size="small" />
                      </View>

                      <View style={styles.checklistBox}>
                        <ChecklistRow label="🌅 Fajr" done={todayMap.fajr === true} />
                        <ChecklistRow label="☀️ Dhuhr" done={todayMap.dhuhr === true} />
                        <ChecklistRow label="🌤️ Asr" done={todayMap.asr === true} />
                        <ChecklistRow label="🌅 Maghrib" done={todayMap.maghrib === true} />
                        <ChecklistRow label="🌙 Isha" done={todayMap.isha === true} />
                      </View>

                      <View style={[styles.rowBetween, { marginTop: 8 }]}>
                        <Text style={{ opacity: 0.7 }}>
                          {next ? `Next due: ${prettyPrayer(next)}` : 'All prayers completed today'}
                        </Text>
                        <Pressable
                          disabled={!active || isCooling}
                          onPress={() => onNudgePress(other)}
                          style={[styles.nudgeBtn, (!active || isCooling) && styles.nudgeBtnDisabled]}
                        >
                          <Text style={{ color: !active || isCooling ? '#64748b' : '#ffffff', fontWeight: '600' }}>
                            {!active ? 'No nudge needed' : isCooling ? 'Nudged' : 'Nudge'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Custom Button Component
function CustomButton({ title, onPress, variant = 'primary', disabled = false, size = 'medium' }: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
}) {
  const getButtonStyle = () => {
    const baseStyle = {
      borderRadius: 12,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: disabled ? 0 : 0.1,
      shadowRadius: 4,
      elevation: disabled ? 0 : 2,
    };

    const sizeStyles = {
      small: { paddingVertical: 8, paddingHorizontal: 12 },
      medium: { paddingVertical: 12, paddingHorizontal: 16 },
      large: { paddingVertical: 16, paddingHorizontal: 20 },
    };

    const variantStyles = {
      primary: { backgroundColor: disabled ? '#e2e8f0' : '#3b82f6' },
      secondary: { backgroundColor: disabled ? '#e2e8f0' : '#f1f5f9', borderWidth: 1, borderColor: disabled ? '#cbd5e1' : '#cbd5e1' },
      danger: { backgroundColor: disabled ? '#e2e8f0' : '#ef4444' },
      success: { backgroundColor: disabled ? '#e2e8f0' : '#10b981' },
    };

    return { ...baseStyle, ...sizeStyles[size], ...variantStyles[variant] };
  };

  const getTextStyle = () => {
    const baseStyle = {
      fontWeight: '600' as const,
      fontSize: size === 'small' ? 14 : size === 'large' ? 18 : 16,
    };

    const variantTextStyles = {
      primary: { color: disabled ? '#64748b' : '#ffffff' },
      secondary: { color: disabled ? '#64748b' : '#475569' },
      danger: { color: disabled ? '#64748b' : '#ffffff' },
      success: { color: disabled ? '#64748b' : '#ffffff' },
    };

    return { ...baseStyle, ...variantTextStyles[variant] };
  };

  return (
    <Pressable
      style={getButtonStyle()}
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
    >
      <Text style={getTextStyle()}>{title}</Text>
    </Pressable>
  );
}

function ChecklistRow({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={[styles.pill, done ? styles.pillDone : styles.pillTodo]}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: done ? '#16a34a' : '#64748b' }}>
        {done ? '✅' : '⭕'} {label}
      </Text>
    </View>
  );
}
function prettyPrayer(p: PrayerKey) {
  switch (p) {
    case 'fajr':
      return 'Fajr';
    case 'dhuhr':
      return 'Dhuhr';
    case 'asr':
      return 'Asr';
    case 'maghrib':
      return 'Maghrib';
    case 'isha':
      return 'Isha';
  }
}

const styles = StyleSheet.create({
  screen: { 
    flex: 1, 
    backgroundColor: '#f8fafc' 
  },
  header: {
    backgroundColor: '#ffffff',
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2
  },
  content: { 
    padding: 20, 
    gap: 16, 
    paddingBottom: 160 
  },
  title: { 
    fontSize: 28, 
    fontWeight: '700', 
    color: '#1e293b',
    textAlign: 'center',
    marginBottom: 4
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
    fontWeight: '400'
  },
  sectionTitle: { 
    fontSize: 18, 
    fontWeight: '600', 
    marginBottom: 12,
    color: '#334155'
  },
  card: { 
    backgroundColor: '#ffffff', 
    borderRadius: 16, 
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  input: { 
    borderWidth: 2, 
    borderColor: '#e2e8f0', 
    borderRadius: 12, 
    padding: 14, 
    backgroundColor: '#f8fafc', 
    marginBottom: 12,
    fontSize: 16,
    color: '#1e293b'
  },
  rowBetween: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingVertical: 8 
  },
  rowLabel: { 
    fontSize: 16,
    color: '#475569'
  },
  buddyBlock: { 
    marginBottom: 16,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 16
  },
  checklistBox: { 
    backgroundColor: '#ffffff', 
    borderRadius: 12, 
    paddingVertical: 16, 
    paddingHorizontal: 16, 
    borderWidth: 1, 
    borderColor: '#e2e8f0', 
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  pill: { 
    paddingVertical: 8, 
    paddingHorizontal: 14, 
    borderRadius: 24,
    minWidth: 90,
    alignItems: 'center'
  },
  pillDone: { 
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#16a34a'
  },
  pillTodo: { 
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1'
  },
  nudgeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#3b82f6',
    shadowColor: '#3b82f6',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3
  },
  nudgeBtnDisabled: {
    backgroundColor: '#e2e8f0',
    shadowOpacity: 0
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 4
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center'
  }
});