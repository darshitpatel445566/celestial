import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState, Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { addRingListener, getRingState, syncSchedule } from '../lib/engine';
import { useStore, useUi } from '../lib/store';
import { Toast } from '../ui/Toast';
import { color } from '../ui/theme';

// On Android the Inter fonts are built into the app; the web preview loads them here.
const webFonts: Record<string, number> =
  Platform.OS === 'web'
    ? {
        'Inter-Light': require('../../assets/fonts/Inter-Light.ttf'),
        'Inter-Regular': require('../../assets/fonts/Inter-Regular.ttf'),
        'Inter-Medium': require('../../assets/fonts/Inter-Medium.ttf'),
        'Inter-SemiBold': require('../../assets/fonts/Inter-SemiBold.ttf'),
      }
    : {};

// Deep links (ring screen, reminder taps) open on top of the list, so Back always works.
export const unstable_settings = { initialRouteName: 'index' };

function openRingIfRinging() {
  if (getRingState()?.ringing) router.navigate('/ring');
}

export default function RootLayout() {
  useFonts({ ...MaterialCommunityIcons.font, ...webFonts });
  const items = useStore((s) => s.items);

  // Every change to alarms re-arms the phone's exact alarms.
  useEffect(() => {
    const id = setTimeout(() => syncSchedule(items), 200);
    return () => clearTimeout(id);
  }, [items]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        syncSchedule(useStore.getState().items);
        openRingIfRinging();
      }
    });
    const offRing = addRingListener(() => router.navigate('/ring'));
    const first = setTimeout(openRingIfRinging, 50);
    return () => {
      sub.remove();
      offRing();
      clearTimeout(first);
    };
  }, []);

  // Quietly download a newer version; never while an alarm is ringing.
  useEffect(() => {
    if (Platform.OS === 'web' || __DEV__ || !Updates.isEnabled) return;
    const id = setTimeout(async () => {
      if (getRingState()?.ringing) return;
      try {
        const r = await Updates.checkForUpdateAsync();
        if (r.isAvailable) {
          await Updates.fetchUpdateAsync();
          useUi.getState().setUpdateReady(true);
        }
      } catch {
        // offline: try next launch
      }
    }, 3000);
    return () => clearTimeout(id);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="edit" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="setup" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen
          name="ring"
          options={{ gestureEnabled: false, animation: 'fade', contentStyle: { backgroundColor: color.navy } }}
        />
      </Stack>
      <Toast />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
});
