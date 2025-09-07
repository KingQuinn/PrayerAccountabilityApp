import { useEffect, useMemo, useState, useCallback, memo } from 'react';
import { SafeAreaView, ScrollView, View, Text, StyleSheet, TextInput, Button, Alert, ActivityIndicator, Pressable, AppState, ViewStyle, FlatList, TouchableOpacity, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { supabase } from '../../lib/supabase';

import { pushNotificationService } from '../../notifications/pushService';
import { streakService } from '../../services/streakService';


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

type ProfileLite = { id: string; email: string | null; username: string | null };
type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
const PRAYERS: PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

type TabType = 'buddies' | 'requests';

interface BuddyData {
  id: string;
  name: string;
  email: string;
  avatar: string;
  streak: number;
  todayPrayers: string;
  status: 'online' | 'offline';
  lastActive: string;
  link: BuddyLink;
  todayMap: Record<string, boolean>;
}

interface AddBuddyModalProps {
  visible: boolean;
  inviteEmail: string;
  inviting: boolean;
  onClose: () => void;
  onEmailChange: (email: string) => void;
  onSendInvite: () => void;
}

// Memoized AddBuddyModal component to prevent re-renders
const AddBuddyModal = memo(({ visible, inviteEmail, inviting, onClose, onEmailChange, onSendInvite }: AddBuddyModalProps) => (
  <Modal
    visible={visible}
    animationType="slide"
    presentationStyle="pageSheet"
    onRequestClose={onClose}
  >
    <SafeAreaView style={styles.modalContainer}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.modalCancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Add Prayer Buddy</Text>
        <View style={{ width: 60 }} />
      </View>
      
      <View style={styles.modalContent}>
        <View style={styles.modalCard}>
          <Text style={styles.modalSectionTitle}>Invite by Email</Text>
          <Text style={styles.modalDescription}>
            Enter your friend's email address to send them a prayer buddy invitation.
          </Text>
          
          <TextInput
            style={styles.modalInput}
            placeholder="Enter email address"
            placeholderTextColor="#9CA3AF"
            value={inviteEmail}
            onChangeText={onEmailChange}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          
          <TouchableOpacity 
            style={[styles.modalSendButton, (!inviteEmail.trim() || inviting) && styles.modalSendButtonDisabled]}
            onPress={onSendInvite}
            disabled={!inviteEmail.trim() || inviting}
          >
            {inviting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.modalSendButtonText}>Send Invitation</Text>
            )}
          </TouchableOpacity>
        </View>
        
        <View style={styles.modalCard}>
          <Text style={styles.modalSectionTitle}>How it works</Text>
          <View style={styles.modalStepContainer}>
            <View style={styles.modalStep}>
              <View style={styles.modalStepNumber}>
                <Text style={styles.modalStepNumberText}>1</Text>
              </View>
              <Text style={styles.modalStepText}>Enter your friend's email address</Text>
            </View>
            <View style={styles.modalStep}>
              <View style={styles.modalStepNumber}>
                <Text style={styles.modalStepNumberText}>2</Text>
              </View>
              <Text style={styles.modalStepText}>They'll receive an invitation to be your prayer buddy</Text>
            </View>
            <View style={styles.modalStep}>
              <View style={styles.modalStepNumber}>
                <Text style={styles.modalStepNumberText}>3</Text>
              </View>
              <Text style={styles.modalStepText}>Once they accept, you can encourage each other in prayer</Text>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  </Modal>
));

export default function Buddy() {
  const [session, setSession] = useState<SessionT>(null);
  const me = session?.user?.id || null;
  const today = useMemo(() => dayjs().format('YYYY-MM-DD'), []);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const [links, setLinks] = useState<BuddyLink[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);

  // buddies' check-ins for today: userId -> prayer -> boolean
  const [feed, setFeed] = useState<Record<string, Partial<Record<PrayerKey, boolean>>>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Outgoing nudges today (kept for display/logic if needed; unlimited nudges still allowed)
  const [nudgedFromMe, setNudgedFromMe] = useState<Record<string, Partial<Record<PrayerKey, boolean>>>>({});

  // Temporary cooldown to prevent accidental rapid-fire nudges: userId -> expiresAt ms
  const [cooldown, setCooldown] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<TabType>('buddies');
  const [searchText, setSearchText] = useState('');
  const [streakData, setStreakData] = useState<Record<string, { currentStreak: number; longestStreak: number; lastActive: string | null }>>({});
  const [showAddBuddyModal, setShowAddBuddyModal] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  // Update user's last active timestamp
  const updateLastActive = async () => {
    if (!me) return;
    try {
      await streakService.updateLastActive(me);
    } catch (error) {
      console.error('Error updating last active:', error);
    }
  };

  // Boot + periodic refresh
  useEffect(() => {
    if (!me) return;
    const boot = async () => {
      await updateLastActive(); // Update last active on component mount
      await Promise.all([loadLinks(), loadFeed(), loadOutgoingNudges(), loadStreakData()]);
      setLoading(false);
    };
    boot();

    // Optimized polling - less frequent for streak data, more frequent for feed
    const feedPollId = setInterval(() => {
      loadFeed();
      loadOutgoingNudges();
    }, 8000);
    
    // Less frequent polling for streak data since it changes less often
    const streakPollId = setInterval(() => {
      loadStreakData();
    }, 30000); // 30 seconds instead of 8 seconds

    // Also refresh on app resume and update last active
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        updateLastActive();
        loadFeed();
        loadOutgoingNudges();
        loadStreakData();
      }
    });

    return () => {
      clearInterval(feedPollId);
      clearInterval(streakPollId);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadStreakData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prayer_completions' }, loadStreakData)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [me]);

  const loadLinks = async () => {
    if (!me) return;
    const { data, error } = await supabase
      .from('buddy_links')
      .select('*')
      .or(`user_a.eq.${me},user_b.eq.${me}`);
    
    if (error) {
      console.warn('Error loading buddy links:', error.message);
      return;
    }
    
    setLinks((data || []) as BuddyLink[]);

    const ids = new Set<string>();
    (data || []).forEach((bl: any) => {
      ids.add(bl.user_a);
      ids.add(bl.user_b);
    });
    if (ids.size) {
      const { data: profs, error: profilesError } = await supabase
        .from('profiles')
        .select('id,email,username')
        .in('id', Array.from(ids));
      
      if (profilesError) {
        console.warn('Error loading profiles:', profilesError.message);
        return;
      }
      
      const map: Record<string, ProfileLite> = {};
      (profs || []).forEach((p) => (map[p.id] = { id: p.id, email: p.email ?? null, username: p.username ?? null }));
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
    if (error) {
      console.warn('Error loading prayer feed:', error.message);
      return;
    }
    const map: Record<string, Partial<Record<PrayerKey, boolean>>> = {};
    (data || []).forEach((row: any) => {
      const u = row.user_id as string;
      const p = row.prayer as PrayerKey;
      if (!map[u]) map[u] = {};
      map[u][p] = !!row.completed;
    });
    setFeed(map);
  };

  const loadStreakData = async () => {
    if (!me) return;
    const ids = acceptedBuddies();
    if (!ids.length) return setStreakData({});
    
    try {
      const streakResults = await streakService.getMultipleUsersStreakData(ids);
      
      // Only update if we got valid data, preserve existing data on errors
      if (streakResults && Object.keys(streakResults).length > 0) {
        setStreakData(prevData => {
          const newData = { ...prevData };
          
          // Update only the users we got data for, preserve others
          Object.keys(streakResults).forEach(userId => {
            const userData = streakResults[userId];
            if (userData && (userData.currentStreak >= 0 || userData.longestStreak >= 0)) {
              newData[userId] = {
                currentStreak: userData.currentStreak || 0,
                longestStreak: userData.longestStreak || 0,
                lastActive: userData.lastActive
              };
            }
          });
          
          return newData;
        });
      }
    } catch (error) {
      console.error('Error loading streak data:', error);
      // Don't clear existing streak data on error - preserve what we have
    }
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
      const { data: profiles, error: pe } = await supabase.from('profiles').select('id,email').eq('email', email);
      
      if (pe) {
        console.error('Profile search error:', pe);
        return Alert.alert('Search failed', `Error searching for user: ${pe.message}`);
      }
      
      if (!profiles || profiles.length === 0) {
        return Alert.alert('User not found', `No user found with email: ${email}\n\nMake sure they have created an account first.`);
      }
      
      const prof = profiles[0];
      
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
    await Promise.all([loadLinks(), loadFeed(), loadOutgoingNudges(), loadStreakData()]);
    setRefreshing(false);
    // Cooldowns naturally expire; pressing refresh doesn't block nudging.
  };

  const pendingIncoming = links.filter((bl) => bl.status === 'pending' && bl.created_by !== me);
  const pendingOutgoing = links.filter((bl) => bl.status === 'pending' && bl.created_by === me);
  const accepted = links.filter((bl) => bl.status === 'accepted');

  // Transform accepted buddies into BuddyData format
  const buddiesData: BuddyData[] = accepted.map((bl) => {
    const other = me === bl.user_a ? bl.user_b : bl.user_a;
    const profile = profiles[other];
    const todayMap = feed[other] || {};
    const completedPrayers = Object.values(todayMap).filter(Boolean).length;
    // Better name extraction with multiple fallbacks - prioritize username
    let name = 'Loading...';
    if (profile?.username) {
      name = profile.username;
    } else if (profile?.email) {
      name = profile.email.split('@')[0];
    } else if (other) {
      // Use first 8 characters of user ID as fallback
      name = `User ${other.substring(0, 8)}`;
    }
    const userStreakData = streakData[other];
    
    return {
      id: other,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      email: profile?.email || other,
      avatar: name.charAt(0).toUpperCase(),
      streak: userStreakData?.currentStreak ?? 0, // Use nullish coalescing for better handling
      todayPrayers: `${completedPrayers}/5`,
      status: streakService.isUserOnline(userStreakData?.lastActive) ? 'online' : 'offline',
      lastActive: userStreakData?.lastActive ? streakService.formatLastActive(userStreakData.lastActive) : 'Never',
      link: bl,
      todayMap
    };
  });

  // Filter buddies based on search text
  const filteredBuddies = buddiesData.filter(buddy => 
    buddy.name.toLowerCase().includes(searchText.toLowerCase()) ||
    buddy.email.toLowerCase().includes(searchText.toLowerCase())
  );

  // Transform pending requests into request format
  const requestsData = pendingIncoming.map((bl) => {
    const other = me === bl.user_a ? bl.user_b : bl.user_a;
    const profile = profiles[other];
    // Better name extraction with multiple fallbacks - prioritize username
    let name = 'Loading...';
    if (profile?.username) {
      name = profile.username;
    } else if (profile?.email) {
      name = profile.email.split('@')[0];
    } else if (other) {
      // Use first 8 characters of user ID as fallback
      name = `User ${other.substring(0, 8)}`;
    }
    
    return {
      id: bl.id,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      email: profile?.email || other,
      avatar: name.charAt(0).toUpperCase(),
      link: bl
    };
  });

  // Render functions for the new design
  const renderBuddy = ({ item }: { item: BuddyData }) => {
    const next = nextDuePrayer(item.id);
    const active = canNudge(item.id);
    const isCooling = !!cooldown[item.id] && cooldown[item.id] > Date.now();

    return (
      <View style={styles.buddyCard}>
        <View style={styles.buddyHeader}>
          <View style={styles.buddyAvatarContainer}>
            <View style={styles.buddyAvatar}>
              <Text style={styles.buddyAvatarText}>{item.avatar}</Text>
            </View>
            <View style={[styles.statusIndicator, { backgroundColor: item.status === 'online' ? '#10B981' : '#6B7280' }]} />
          </View>
          
          <View style={styles.buddyInfo}>
            <Text style={styles.buddyName}>{item.name}</Text>
            <Text style={styles.lastActive}>Last active: {item.lastActive}</Text>
          </View>

          <TouchableOpacity 
            style={[styles.nudgeBtn, (!active || isCooling) && styles.nudgeBtnDisabled]}
            disabled={!active || isCooling}
            onPress={() => onNudgePress(item.id)}
          >
            <Ionicons 
              name="hand-right-outline" 
              size={20} 
              color={!active || isCooling ? '#9CA3AF' : '#4F46E5'} 
            />
          </TouchableOpacity>
        </View>

        <View style={styles.buddyStats}>
          <View style={styles.statCard}>
            <View style={styles.statHeader}>
              <Ionicons name="trophy-outline" size={16} color="#F59E0B" />
              <Text style={styles.statValue}>{item.streak}</Text>
            </View>
            <Text style={styles.statLabel}>Day Streak</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{item.todayPrayers}</Text>
            <Text style={styles.statLabel}>Today's Prayers</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderRequest = ({ item }: { item: any }) => (
    <View style={styles.requestCard}>
      <View style={styles.requestHeader}>
        <View style={styles.requestAvatar}>
          <Text style={styles.requestAvatarText}>{item.avatar}</Text>
        </View>
        
        <View style={styles.requestInfo}>
          <Text style={styles.requestName}>{item.name}</Text>
        </View>
      </View>

      <View style={styles.requestActions}>
        <TouchableOpacity style={styles.acceptButton} onPress={() => acceptInvite(item.link.id)}>
          <Text style={styles.acceptButtonText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.declineButton} onPress={() => declineOrRemove(item.link.id)}>
          <Text style={styles.declineButtonText}>Decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // Memoized handlers to prevent re-renders
  const handleModalClose = useCallback(() => {
    setShowAddBuddyModal(false);
  }, []);

  const handleEmailChange = useCallback((email: string) => {
    setInviteEmail(email);
  }, []);

  const handleSendInvite = useCallback(async () => {
    try {
      await sendInvite();
      if (!inviting) {
        setShowAddBuddyModal(false);
      }
    } catch (error) {
      console.error('Error sending invite:', error);
    }
  }, [sendInvite, inviting]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Prayer Buddies</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowAddBuddyModal(true)}>
          <Ionicons name="add" size={24} color="white" />
        </TouchableOpacity>
      </View>

      <AddBuddyModal 
          visible={showAddBuddyModal}
          inviteEmail={inviteEmail}
          inviting={inviting}
          onClose={handleModalClose}
          onEmailChange={handleEmailChange}
          onSendInvite={handleSendInvite}
        />

      <View style={styles.content}>
        {/* Search */}
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={20} color="#9CA3AF" style={styles.searchIcon} />
          <TextInput 
            style={styles.searchInput}
            placeholder="Search buddies..."
            placeholderTextColor="#9CA3AF"
            value={searchText}
            onChangeText={setSearchText}
          />
        </View>

        {/* Tabs */}
        <View style={styles.tabContainer}>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'buddies' && styles.activeTab]}
            onPress={() => setActiveTab('buddies')}
          >
            <Text style={[styles.tabText, activeTab === 'buddies' && styles.activeTabText]}>
              My Buddies ({filteredBuddies.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'requests' && styles.activeTab]}
            onPress={() => setActiveTab('requests')}
          >
            <Text style={[styles.tabText, activeTab === 'requests' && styles.activeTabText]}>
              Requests ({requestsData.length})
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#4F46E5" style={{ marginTop: 50 }} />
        ) : activeTab === 'buddies' ? (
          <FlatList 
            data={filteredBuddies}
            renderItem={renderBuddy}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContainer}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ) : (
          <FlatList 
            data={requestsData}
            renderItem={renderRequest}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContainer}
          />
        )}
      </View>
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
  container: { 
    flex: 1, 
    backgroundColor: '#f8fafc' 
  },
  screen: { 
    flex: 1, 
    backgroundColor: '#f8fafc' 
  },
  header: {
    backgroundColor: '#4F46E5',
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3
  },
  content: { 
    flex: 1,
    paddingHorizontal: 16
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginVertical: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2
  },
  searchIcon: {
    marginRight: 12
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1F2937'
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center'
  },
  activeTab: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280'
  },
  activeTabText: {
    color: '#4F46E5',
    fontWeight: '600'
  },
  listContainer: {
    paddingBottom: 20
  },
  buddyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2
  },
  buddyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16
  },
  buddyAvatarContainer: {
    position: 'relative',
    marginRight: 12
  },
  buddyAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#4F46E5',
    justifyContent: 'center',
    alignItems: 'center'
  },
  buddyAvatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff'
  },
  statusIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#ffffff'
  },
  buddyInfo: {
    flex: 1
  },
  buddyName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4
  },
  lastActive: {
    fontSize: 14,
    color: '#6B7280'
  },
  messageButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F3F4F6'
  },
  buddyStats: {
    flexDirection: 'row',
    gap: 12
  },
  statCard: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center'
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginLeft: 4
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center'
  },
  requestCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16
  },
  requestAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12
  },
  requestAvatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff'
  },
  requestInfo: {
    flex: 1
  },
  requestName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937'
  },
  requestActions: {
    flexDirection: 'row',
    gap: 12
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#10B981',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center'
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff'
  },
  declineButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center'
  },
  declineButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280'
  },
  title: { 
    fontSize: 24, 
    fontWeight: '700', 
    color: '#ffffff'
  },
  addButton: {
    backgroundColor: '#6366F1',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center'
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
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8fafc'
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff'
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937'
  },
  modalCancelText: {
    fontSize: 16,
    color: '#6366F1',
    fontWeight: '500'
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
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
  modalSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8
  },
  modalDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
    lineHeight: 20
  },
  modalInput: {
    borderWidth: 2,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#f8fafc',
    marginBottom: 16,
    fontSize: 16,
    color: '#1e293b'
  },
  modalSendButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#4F46E5',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3
  },
  modalSendButtonDisabled: {
    backgroundColor: '#e2e8f0',
    shadowOpacity: 0
  },
  modalSendButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff'
  },
  modalStepContainer: {
    gap: 16
  },
  modalStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12
  },
  modalStepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#4F46E5',
    justifyContent: 'center',
    alignItems: 'center'
  },
  modalStepNumberText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff'
  },
  modalStepText: {
    flex: 1,
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20
  }
});