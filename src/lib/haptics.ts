import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const ok = Platform.OS !== 'web';

/** Light click, e.g. choosing a chip. */
export function tick() {
  if (ok) Haptics.selectionAsync().catch(() => {});
}

/** Detent while dragging the slider (every 5 minutes). */
export function detent() {
  if (!ok) return;
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick).catch(() => {});
  } else {
    Haptics.selectionAsync().catch(() => {});
  }
}

export function bump() {
  if (ok) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function success() {
  if (ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function wrong() {
  if (ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
