import * as Notifications from 'expo-notifications';
import dayjs from 'dayjs';
import {
  Coordinates,
  CalculationMethod,
  Madhab as AdhanMadhab,
  HighLatitudeRule as AdhanHighLat,
  PrayerTimes,
  CalculationParameters
} from 'adhan';
import { Platform } from 'react-native';

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

/**
 * Schedules exactly one notification: the next upcoming prayer today.
 * Returns the scheduled prayer key, or null if none left today.
 */
export async function scheduleNextPrayerNotification(
  coords: Coords,
  prefs: PrayerPrefs,
  options?: { graceMinutes?: number; playSound?: boolean }
): Promise<PrayerKey | null> {
  const grace = options?.graceMinutes ?? 0;
  const playSound = options?.playSound !== false;
  const times = computeTodayPrayerDates(coords, prefs);

  const now = dayjs();
  const order: PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  let nextKey: PrayerKey | null = null;
  let nextTime: Date | null = null;

  for (const key of order) {
    const t = dayjs(times[key]).add(grace, 'minute');
    if (t.isAfter(now)) { nextKey = key; nextTime = t.toDate(); break; }
  }

  await cancelAllPrayerNotifications();

  if (nextKey && nextTime) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Time to Pray',
        body: `It’s time for ${capitalize(nextKey)}.`,
        sound: playSound ? (Platform.OS === 'ios' ? 'adhan.wav' : 'adhan.wav') as any : undefined,
        data: { type: 'prayer', prayer: nextKey }
      },
      trigger: { date: nextTime, channelId: 'adhan' } as any
    });
    return nextKey;
  }

  return null;
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }