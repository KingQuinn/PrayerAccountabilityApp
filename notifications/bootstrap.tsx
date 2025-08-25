import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { audioNotificationService } from './audioService';

export default function NotificationsBootstrap() {
  useEffect(() => {
    const run = async () => {
      // Initialize audio service
      await audioNotificationService.initialize();

      // Permissions
      const settings = await Notifications.getPermissionsAsync();
      if (!settings.granted) {
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowSound: true, allowBadge: false }
        });
      }

      // Android channel for fallback sound
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('adhan', {
          name: 'Adhan',
          importance: Notifications.AndroidImportance.MAX,
          sound: 'default', // Use default as fallback
          vibrationPattern: [0, 300, 250, 300],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
        });
      }

      Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          // Handle custom audio playback
          await audioNotificationService.handleNotificationReceived(notification);
          
          return {
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: false, // We handle sound manually
            shouldSetBadge: false
          };
        }
      });

      // Listen for notification responses (when user taps notification)
      const responseSubscription = Notifications.addNotificationResponseReceivedListener(
        async (response) => {
          const data = response.notification.request.content.data;
          if (data?.useCustomAudio && audioNotificationService.isAppInForeground()) {
            await audioNotificationService.playAdhanSound();
          }
        }
      );

      return () => {
        responseSubscription.remove();
      };
    };

    const cleanup = run().catch(() => {});
    return () => {
      if (cleanup && typeof cleanup.then === 'function') {
        cleanup.then(cleanupFn => cleanupFn && cleanupFn());
      }
    };
  }, []);

  return null;
}