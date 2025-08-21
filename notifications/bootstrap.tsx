import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export default function NotificationsBootstrap() {
  useEffect(() => {
    const run = async () => {
      // Permissions
      const settings = await Notifications.getPermissionsAsync();
      if (!settings.granted) {
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowSound: true, allowBadge: false }
        });
      }

      // Android channel for custom sound
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('adhan', {
          name: 'Adhan',
          importance: Notifications.AndroidImportance.MAX,
          sound: 'adhan.wav',
          vibrationPattern: [0, 300, 250, 300],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
        });
      }

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false
        })
      });
    };

    run().catch(() => {});
  }, []);

  return null;
}