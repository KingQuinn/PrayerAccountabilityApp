import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';

class PushNotificationService {
  private static instance: PushNotificationService;
  private isInitialized = false;

  static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  async initialize(userId?: string) {
    if (this.isInitialized) return;
    
    try {
      // Request permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        console.warn('Push notification permissions not granted');
        return;
      }

      // Get push token
      const token = await Notifications.getExpoPushTokenAsync();
      
      console.log('Push token obtained:', token.data);
      
      // Store token in database if userId is provided
      if (userId && token.data) {
        await this.storePushToken(userId, token.data);
      }
      
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize push notifications:', error);
    }
  }

  async storePushToken(userId: string, token: string) {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ push_token: token })
        .eq('id', userId);
      
      if (error) {
        console.error('Failed to store push token:', error);
      } else {
        console.log('Push token stored successfully');
      }
    } catch (error) {
      console.error('Error storing push token:', error);
    }
  }

  async sendNudgeNotification(toUserId: string, fromUserEmail: string, prayer: string) {
    try {
      // Get the recipient's push token
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', toUserId)
        .single();
      
      if (error || !profile?.push_token) {
        console.warn('No push token found for user:', toUserId);
        return false;
      }

      // Send push notification using Expo's push API
      const message = {
        to: profile.push_token,
        sound: 'default',
        title: '🔔 Prayer Nudge',
        body: `${fromUserEmail} nudged you to complete ${prayer} prayer`,
        data: {
          type: 'nudge',
          prayer: prayer,
          fromUser: fromUserEmail
        },
      };

      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      const result = await response.json();
      
      if (result.data?.[0]?.status === 'ok') {
        console.log('Nudge notification sent successfully');
        return true;
      } else {
        console.error('Failed to send nudge notification:', result);
        return false;
      }
    } catch (error) {
      console.error('Error sending nudge notification:', error);
      return false;
    }
  }

  async refreshPushToken(userId: string) {
    try {
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: 'YOUR-EAS-PROJECT-ID'
      });
      
      if (token.data) {
        await this.storePushToken(userId, token.data);
      }
    } catch (error) {
      console.error('Failed to refresh push token:', error);
    }
  }
}

export const pushNotificationService = PushNotificationService.getInstance();