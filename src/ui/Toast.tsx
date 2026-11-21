import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUi } from '../lib/store';
import { Icon } from './Icon';
import { T } from './Text';
import { color, SIDE } from './theme';

/** The short message after saving, e.g. "Alarm set · Tomorrow · 8 h 10 min · Undo". */
export function Toast() {
  const toast = useUi((s) => s.toast);
  const hide = useUi((s) => s.hideToast);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(hide, 5000);
    return () => clearTimeout(id);
  }, [toast, hide]);
  if (!toast) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 20 }]}>
      <Animated.View
        key={toast.id}
        entering={FadeInDown.duration(220)}
        exiting={FadeOutDown.duration(180)}
        style={styles.toast}>
        <Icon name="timer-sand" size={18} c={color.yellow} />
        <T v="sub" c={color.white} style={styles.text} numberOfLines={2}>
          {toast.text}
        </T>
        {toast.undo ? (
          <Pressable
            onPress={() => {
              toast.undo?.();
              hide();
            }}
            hitSlop={10}
            accessibilityRole="button">
            <T v="subMedium" c={color.yellow}>
              Undo
            </T>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: SIDE, right: SIDE, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: color.navy,
    maxWidth: 520,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { flexShrink: 1 },
});
