import { useEffect, useState, createContext, useContext } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { supabase } from '../lib/supabase';
import NotificationsBootstrap from '@/notifications/bootstrap';

type SessionT = { user: { id: string; email?: string | null } | null } | null;

const SessionCtx = createContext<SessionT | undefined>(undefined);
export const useSession = () => useContext(SessionCtx);

export default function RootLayout() {
  const [session, setSession] = useState<SessionT>(undefined as any);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    const inAuth = segments[0] === '(auth)';
    if (!session?.user && !inAuth) {
      router.replace('/login');
    } else if (session?.user && inAuth) {
      router.replace('/');
    }
  }, [session, segments, router]);

  return (
    <SessionCtx.Provider value={session}>
      <NotificationsBootstrap />
      <Slot />
    </SessionCtx.Provider>
  );
}