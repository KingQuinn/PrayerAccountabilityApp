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
          sound: 'adhan1.wav', // Use custom adhan sound
          vibrationPattern: [0, 300, 250, 300],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          enableLights: true,
          enableVibrate: true
        });
      }

      Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          // Handle custom audio playback for foreground
          await audioNotificationService.handleNotificationReceived(notification);
          
          const notificationData = notification.request.content.data;
          const isPrayerNotification = notificationData?.type === 'prayer' || notificationData?.type === 'test';
          
          return {
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            // Always play sound for prayer notifications
            shouldPlaySound: isPrayerNotification,
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