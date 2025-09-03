import { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  SafeAreaView, 
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useSession } from '../_layout';
import { streakService } from '../../services/streakService';

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
    try {
      console.log('Creating/updating profile for user:', userId);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: userId, tz, email: emailVal }, { onConflict: 'id' });
      
      if (error) {
        console.error('Profile upsert error:', error);
        throw new Error(`Profile creation failed: ${error.message}`);
      }
      
      console.log('Profile upserted successfully');
      
      // Initialize streak tracking for new or existing users without last_active_at
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('last_active_at')
        .eq('id', userId)
        .single();
      
      if (profileError) {
        console.error('Error fetching profile for streak init:', profileError);
        // Don't throw here, profile was created successfully
        return;
      }
      
      if (!profile?.last_active_at) {
        console.log('Initializing streak tracking for new user');
        await streakService.initializeUserStreak(userId);
        console.log('Streak tracking initialized');
      }
    } catch (error) {
      console.error('Profile upsert process failed:', error);
      throw error;
    }
  };

  const signUp = async () => {
    try {
      console.log('Starting signup process for:', email);
      const { data, error } = await supabase.auth.signUp({ email, password });
      
      if (error) {
        console.error('Signup error:', error);
        return Alert.alert('Sign up failed', `${error.message}\n\nError code: ${error.status || 'Unknown'}`);
      }
      
      if (data.user) {
        console.log('User created successfully:', data.user.id);
        try {
          await upsertProfile(data.user.id, data.user.email ?? email);
          console.log('Profile created successfully');
          Alert.alert('Account created!', 'Your account has been created successfully. You can now sign in.');
        } catch (profileError) {
          console.error('Profile creation error:', profileError);
          Alert.alert('Profile creation failed', 'Account was created but profile setup failed. Please try signing in.');
        }
      } else {
        console.warn('No user data returned from signup');
        Alert.alert('Signup incomplete', 'Account creation did not complete properly. Please try again.');
      }
    } catch (unexpectedError) {
      console.error('Unexpected signup error:', unexpectedError);
      Alert.alert('Signup failed', 'An unexpected error occurred. Please try again.');
    }
  };

  const signIn = async () => {
    try {
      console.log('Starting signin process for:', email);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      
      if (error) {
        console.error('Signin error:', error);
        return Alert.alert('Sign in failed', `${error.message}\n\nError code: ${error.status || 'Unknown'}`);
      }
      
      if (data.user) {
        console.log('User signed in successfully:', data.user.id);
        try {
          await upsertProfile(data.user.id, data.user.email ?? email);
          console.log('Profile updated successfully');
        } catch (profileError) {
          console.error('Profile update error:', profileError);
          // Don't block signin for profile update errors
        }
      }
    } catch (unexpectedError) {
      console.error('Unexpected signin error:', unexpectedError);
      Alert.alert('Sign in failed', 'An unexpected error occurred. Please try again.');
    }
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
      <KeyboardAvoidingView 
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <LinearGradient
          colors={['#ddd6fe', '#c7d2fe']}
          style={styles.gradient}
        >
          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
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
          </ScrollView>
        </LinearGradient>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
    paddingHorizontal: 20,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: '100%',
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