import { useState, useEffect } from 'react';
import { SafeAreaView, ScrollView, View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useSession } from '../_layout';

export default function Login() {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    // RootLayout handles redirect based on session
  }, [session]);

  const upsertProfile = async (userId: string, emailVal: string | null) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId, tz, email: emailVal }, { onConflict: 'id' });
    if (error) console.warn('Profile upsert error', error.message);
  };

  const signUp = async () => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return Alert.alert('Sign up failed', error.message);
    if (data.user) {
      await upsertProfile(data.user.id, data.user.email ?? email);
      Alert.alert('Check your email', 'Verify your email to finish sign up (if enabled).');
    }
  };

  const signIn = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return Alert.alert('Sign in failed', error.message);
    if (data.user) await upsertProfile(data.user.id, data.user.email ?? email);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>PrayerPal</Text>
        <TextInput
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          placeholder="Password"
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />
        <View style={styles.row}>
          <Button title="Sign In" onPress={signIn} />
          <View style={{ width: 12 }} />
          <Button title="Sign Up" onPress={signUp} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8 },
  input: { width: '100%', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 12 },
  row: { flexDirection: 'row' }
});