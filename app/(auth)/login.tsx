import { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  SafeAreaView, 
  Alert, 
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useSession } from '../_layout';

export default function Login() {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLogin, setIsLogin] = useState(true);

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

  const handleSubmit = () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (isLogin) {
      signIn();
    } else {
      signUp();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#ddd6fe', '#c7d2fe']}
        style={styles.gradient}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>PrayerPal</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  placeholderTextColor="#9CA3AF"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.inputContainer}>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { paddingRight: 50 }]}
                  placeholder="Enter your password"
                  placeholderTextColor="#9CA3AF"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity
                  style={styles.eyeIcon}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color="#9CA3AF"
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
              <Text style={styles.submitButtonText}>
                {isLogin ? 'Sign In' : 'Create Account'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
              <Text style={styles.switchText}>
                {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  content: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },

  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
  },
  form: {
    gap: 24,
  },
  inputContainer: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  inputWrapper: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingLeft: 44,
    paddingRight: 16,
    fontSize: 16,
    backgroundColor: 'white',
  },
  inputIcon: {
    position: 'absolute',
    left: 12,
    zIndex: 1,
  },
  eyeIcon: {
    position: 'absolute',
    right: 12,
    padding: 4,
  },
  submitButton: {
    backgroundColor: '#4F46E5',
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  switchText: {
    textAlign: 'center',
    color: '#4F46E5',
    fontSize: 14,
  },
});