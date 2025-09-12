import { useAudioPlayer } from 'expo-audio';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

class AudioNotificationService {
  private audioPlayer: any = null;
  private isInitialized = false;

  async initialize() {
    if (this.isInitialized) return;
    
    try {
      // Initialize audio player with the adhan sound
      const { useAudioPlayer } = await import('expo-audio');
      const audioSource = require('../assets/sounds/adhan1.wav');
      
      // We'll create the player when needed to avoid hook issues
      this.isInitialized = true;
      console.log('AudioNotificationService initialized');
    } catch (error) {
      console.error('Failed to initialize AudioNotificationService:', error);
    }
  }

  async playAdhanSound() {
    try {
      const { createAudioPlayer } = await import('expo-audio');
      const audioSource = require('../assets/sounds/adhan1.wav');
      
      // Create a new player instance for each playback
      const player = createAudioPlayer(audioSource);
      
      await player.play();
      console.log('Adhan sound played successfully');
      
      // Clean up after playback
      setTimeout(() => {
        try {
          player.release();
        } catch (e) {
          console.log('Player already released');
        }
      }, 30000); // Release after 30 seconds
      
    } catch (error) {
      console.error('Failed to play adhan sound:', error);
      // Fallback: try to play system notification sound
      console.log('Falling back to system notification sound');
    }
  }

  isAppInForeground(): boolean {
    return AppState.currentState === 'active';
  }

  async handleNotificationReceived(notification: Notifications.Notification) {
    // Check if this is a prayer notification
    const notificationData = notification.request.content.data;
    
    if (notificationData?.type === 'prayer' || notificationData?.type === 'test') {
      console.log('Prayer notification received:', notificationData);
      
      // If app is in foreground, play audio directly
      if (this.isAppInForeground()) {
        console.log('App in foreground, playing audio directly');
        await this.playAdhanSound();
      } else {
        console.log('App in background, relying on system notification sound');
      }
    }
  }

  async scheduleHybridNotification({
    title,
    body,
    triggerDate,
    data = {},
  }: {
    title: string;
    body: string;
    triggerDate: Date;
    data?: any;
  }) {
    try {
      // Schedule notification with adhan sound for background, custom audio for foreground
      const notificationContent: any = {
        title,
        body,
        data: { ...data, useCustomAudio: true, type: 'prayer' },
      };

      // Configure sound based on platform
      if (Platform.OS === 'ios') {
        notificationContent.sound = 'adhan1.wav';
      } else {
        // For Android, sound is handled by the channel configuration
        notificationContent.sound = 'adhan1.wav';
      }

      await Notifications.scheduleNotificationAsync({
        content: notificationContent,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
          ...(Platform.OS === 'android' && { channelId: 'adhan' }),
        },
      });
      
      console.log('Hybrid notification scheduled for:', triggerDate);
    } catch (error) {
      console.error('Failed to schedule hybrid notification:', error);
    }
  }


}

// Export singleton instance
export const audioNotificationService = new AudioNotificationService();

// Export hook for React components that need audio player
export function useAdhanAudioPlayer() {
  const audioSource = require('../assets/sounds/adhan1.wav');
  return useAudioPlayer(audioSource);
}