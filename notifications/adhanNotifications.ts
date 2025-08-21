import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import dayjs from 'dayjs';
import {
  Coordinates,
  CalculationMethod,
  Madhab as AdhanMadhab,
  HighLatitudeRule as AdhanHighLat,
  PrayerTimes,
  CalculationParameters
} from 'adhan';

export type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export type PrayerPrefs = {
  calcMethod:
    | 'MuslimWorldLeague' | 'Egyptian' | 'Karachi' | 'NorthAmerica' | 'Kuwait' | 'Qatar'
    | 'Singapore' | 'UmmAlQura' | 'Dubai' | 'MoonsightingCommittee' | 'Turkey' | 'Tehran';
  madhab: 'Shafi' | 'Hanafi';
  highLat: 'MiddleOfTheNight' | 'SeventhOfTheNight' | 'TwilightAngle';
};

export type Coords = { latitude: number; longitude: number };

function buildParams(prefs: PrayerPrefs): CalculationParameters {
  let params: CalculationParameters;
  switch (prefs.calcMethod) {
    case 'Egyptian': params = CalculationMethod.Egyptian(); break;
    case 'Karachi': params = CalculationMethod.Karachi(); break;
    case 'NorthAmerica': params = CalculationMethod.NorthAmerica(); break;
    case 'Kuwait': params = CalculationMethod.Kuwait(); break;
    case 'Qatar': params = CalculationMethod.Qatar(); break;
    case 'Singapore': params = CalculationMethod.Singapore(); break;
    case 'UmmAlQura': params = CalculationMethod.UmmAlQura(); break;
    case 'Dubai': params = CalculationMethod.Dubai(); break;
    case 'MoonsightingCommittee': params = CalculationMethod.MoonsightingCommittee(); break;
    case 'Turkey': params = CalculationMethod.Turkey(); break;
    case 'Tehran': params = CalculationMethod.Tehran(); break;
    default: params = CalculationMethod.MuslimWorldLeague();
  }
  params.madhab = prefs.madhab === 'Hanafi' ? AdhanMadhab.Hanafi : AdhanMadhab.Shafi;
  params.highLatitudeRule =
    prefs.highLat === 'SeventhOfTheNight' ? AdhanHighLat.SeventhOfTheNight :
    prefs.highLat === 'TwilightAngle' ? AdhanHighLat.TwilightAngle :
    AdhanHighLat.MiddleOfTheNight;
  return params;
}

export function computeTodayPrayerDates(coords: Coords, prefs: PrayerPrefs) {
  const params = buildParams(prefs);
  const pt = new PrayerTimes(new Coordinates(coords.latitude, coords.longitude), new Date(), params);
  return {
    fajr: pt.fajr,
    dhuhr: pt.dhuhr,
    asr: pt.asr,
    maghrib: pt.maghrib,
    isha: pt.isha
  } as Record<PrayerKey, Date>;
}

export async function cancelAllPrayerNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function scheduleTodayPrayerNotifications(
  coords: Coords,
  prefs: PrayerPrefs,
  options?: { graceMinutes?: number; playSound?: boolean }
) {
  const grace = options?.graceMinutes ?? 0;
  const playSound = options?.playSound !== false;

  const times = computeTodayPrayerDates(coords, prefs);
  const entries: { key: PrayerKey; date: Date }[] = [
    { key: 'fajr', date: times.fajr },
    { key: 'dhuhr', date: times.dhuhr },
    { key: 'asr', date: times.asr },
    { key: 'maghrib', date: times.maghrib },
    { key: 'isha', date: times.isha }
  ];

  // Prevent duplicates if we reschedule often
  await cancelAllPrayerNotifications();

  for (const { key, date } of entries) {
    const fireAt = dayjs(date).add(grace, 'minute');
    if (fireAt.isBefore(dayjs())) continue;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Time to Pray',
        body: `It’s time for ${capitalize(key)}.`,
        // iOS requires bundled sounds by filename; Android channel uses same name
        sound: playSound ? (Platform.OS === 'ios' ? 'adhan.wav' : 'adhan.wav') as any : undefined,
        data: { type: 'prayer', prayer: key }
      },
      trigger: {
        date: fireAt.toDate(),
        channelId: 'adhan'
      } as any
    });
  }
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }