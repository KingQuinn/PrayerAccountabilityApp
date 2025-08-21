import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export function AppNotificationsBootstrap() {
  useEffect(() => {
    const run = async () => {
      // Request permissions
      const settings = await Notifications.getPermissionsAsync();
      if (!settings.granted) {
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowSound: true, allowBadge: false }
        });
      }

      // Android channel with custom sound
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('adhan', {
          name: 'Adhan',
          importance: Notifications.AndroidImportance.MAX,
          sound: 'adhan.wav',
          vibrationPattern: [0, 300, 250, 300],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
        });
      }

      // Foreground behavior (show + play sound)
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldSetBadge: false
        })
      });
    };

    run().catch(() => {});
  }, []);

  return null;
}