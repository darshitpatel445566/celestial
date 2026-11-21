import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Permissions } from '../../modules/celestial-alarm';
import { wallClock } from '../lib/dates';
import { getPermissions, hasEngine, openSettings, requestNotifications, testRing } from '../lib/engine';
import { success } from '../lib/haptics';
import { useUi } from '../lib/store';
import { Button, Divider } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { T } from '../ui/Text';
import { color, SIDE } from '../ui/theme';

type Check = {
  key: keyof Pick<Permissions, 'notifications' | 'fullScreen' | 'exactAlarms' | 'battery'>;
  title: string;
  why: string;
  optional?: boolean;
};

const CHECKS: Check[] = [
  { key: 'notifications', title: 'Notifications', why: 'Shows reminders and the ringing alarm.' },
  { key: 'fullScreen', title: 'Full-screen alarms', why: 'Opens the ringing screen over the lock screen.' },
  { key: 'exactAlarms', title: 'Exact alarms', why: 'Rings at the exact minute, even in battery saver.' },
  {
    key: 'battery',
    title: 'No battery limits',
    why: 'Optional. Helps on phones that close apps aggressively.',
    optional: true,
  },
];

/** Permissions alarms need, a test ring, and app version / updates. */
export default function Setup() {
  const insets = useSafeAreaInsets();
  const [perms, setPerms] = useState<Permissions | null>(() => getPermissions());
  const [tested, setTested] = useState('');
  const [updateText, setUpdateText] = useState('');
  const setUpdateReady = useUi((s) => s.setUpdateReady);

  const refresh = useCallback(() => setPerms(getPermissions()), []);
  useFocusEffect(refresh);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const fix = async (key: Check['key']) => {
    if (key === 'notifications') {
      const ok = await requestNotifications();
      if (!ok) openSettings('notifications');
    } else {
      openSettings(key);
    }
    setTimeout(refresh, 600);
  };

  const test = (style: 'ring' | 'pre') => {
    const at = Date.now() + 5000;
    const ok = testRing(
      {
        alarmId: 'test',
        kind: style === 'pre' ? 'pre' : 'main',
        style,
        title: style === 'pre' ? 'Test pre-alarm' : 'Test alarm',
        body: 'Celestial test',
        wall: wallClock(new Date(at)),
        sound: style === 'pre' ? 'raw:chime' : 'raw:beacon',
        rising: false,
        vibrate: true,
        ringMinutes: 1,
        snoozeMinutes: 1,
        snoozeLimit: 1,
        occurrence: '',
      },
      5,
    );
    if (ok) {
      success();
      setTested(`Rings in 5 seconds. Lock the phone to see it on the lock screen.`);
    } else setTested('The alarm engine is not available in this build.');
  };

  const checkUpdate = async () => {
    if (!Updates.isEnabled) {
      setUpdateText('Updates are off in this build.');
      return;
    }
    setUpdateText('Checking…');
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) {
        setUpdateText('You have the latest version.');
        return;
      }
      setUpdateText('Downloading…');
      await Updates.fetchUpdateAsync();
      setUpdateReady(true);
      setUpdateText('Ready. Restart to use it.');
    } catch {
      setUpdateText('Could not check right now.');
    }
  };

  const version = Constants.expoConfig?.version ?? '1.0.0';
  const updateId = Updates.updateId ? Updates.updateId.slice(0, 8) : 'built in';

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <T v="title">Ringing</T>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
          <Icon name="close" size={26} c={color.ink2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {!hasEngine ? (
          <T v="sub" c={color.ink2} style={s.pad}>
            This preview has no alarm engine. Install the Android app to test ringing.
          </T>
        ) : null}
        {CHECKS.map((c, i) => {
          const ok = perms ? !!perms[c.key] : false;
          return (
            <View key={c.key}>
              <View style={s.check}>
                <Icon
                  name={ok ? 'check-circle' : 'alert-circle-outline'}
                  size={24}
                  c={ok ? '#27A567' : c.optional ? color.ink3 : color.red}
                />
                <View style={s.checkText}>
                  <T v="body">{c.title}</T>
                  <T v="foot" c={color.ink2}>
                    {c.why}
                  </T>
                </View>
                {ok ? (
                  <T v="foot" c={color.ink2}>
                    On
                  </T>
                ) : (
                  <Button
                    label="Allow"
                    kind="primary"
                    style={s.allow}
                    onPress={() => fix(c.key)}
                    disabled={!hasEngine}
                  />
                )}
              </View>
              {i < CHECKS.length - 1 ? <Divider /> : null}
            </View>
          );
        })}

        <T v="footMedium" c={color.ink2} style={s.section}>
          Test
        </T>
        <View style={s.tests}>
          <Button label="Test alarm" icon="alarm" onPress={() => test('ring')} style={s.flex} />
          <Button
            label="Pre-alarm"
            icon="bell-ring-outline"
            kind="secondary"
            onPress={() => test('pre')}
            style={s.flex}
          />
        </View>
        {tested ? (
          <T v="foot" c={color.ink2} style={s.pad}>
            {tested}
          </T>
        ) : null}

        <T v="footMedium" c={color.ink2} style={s.section}>
          App
        </T>
        <View style={s.pad}>
          <T v="sub">
            Celestial {version} · update {updateId}
          </T>
          {perms ? (
            <T v="foot" c={color.ink2}>
              {perms.manufacturer} {perms.model} · Android SDK {perms.sdk}
            </T>
          ) : null}
        </View>
        <View style={s.pad}>
          <Button label="Check for update" kind="secondary" icon="refresh" onPress={checkUpdate} />
          {updateText ? (
            <T v="foot" c={color.ink2} style={s.updateText}>
              {updateText}
            </T>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  header: {
    height: 60,
    paddingHorizontal: SIDE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pad: { paddingHorizontal: SIDE, paddingTop: 8 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: SIDE, paddingVertical: 14 },
  checkText: { flex: 1, gap: 2 },
  allow: { height: 38, paddingHorizontal: 16 },
  section: { paddingHorizontal: SIDE, paddingTop: 28, paddingBottom: 8 },
  tests: { flexDirection: 'row', gap: 12, paddingHorizontal: SIDE },
  updateText: { marginTop: 8, textAlign: 'center' },
});
