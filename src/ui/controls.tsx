import { useEffect, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tick } from '../lib/haptics';
import { Icon, type IconName } from './Icon';
import { T } from './Text';
import { color, font, SIDE } from './theme';

export function Divider({ inset = SIDE }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/** A settings row that shows only the chosen value and opens inline below itself. */
export function Row({
  label,
  value,
  valueColor,
  open,
  onPress,
  children,
  last,
  icon,
  nested,
}: {
  label: string;
  value?: string;
  valueColor?: string;
  open?: boolean;
  onPress?: () => void;
  children?: ReactNode;
  last?: boolean;
  icon?: IconName;
  /** Row inside another row's panel: no side padding */
  nested?: boolean;
}) {
  return (
    <View>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.row, nested && styles.flat, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: !!open }}
        accessibilityLabel={`${label}, ${value ?? ''}`}>
        <View style={styles.rowLabel}>
          {icon ? <Icon name={icon} size={20} c={color.ink2} style={styles.rowIcon} /> : null}
          <T v="body">{label}</T>
        </View>
        <View style={styles.rowValue}>
          {value ? (
            <T v="body" c={valueColor ?? color.ink2} numberOfLines={1} style={styles.valueText}>
              {value}
            </T>
          ) : null}
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={22} c={color.ink3} />
        </View>
      </Pressable>
      {open ? <View style={[styles.panel, nested && styles.flat]}>{children}</View> : null}
      {last ? null : <Divider inset={nested ? 0 : SIDE} />}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  onLongPress,
  dot,
  icon,
  style,
  small,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  dot?: string;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        tick();
        onPress?.();
      }}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        small && styles.chipSmall,
        selected ? styles.chipOn : styles.chipOff,
        pressed && styles.pressed,
        style,
      ]}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      {icon ? <Icon name={icon} size={16} c={color.ink} style={styles.chipIcon} /> : null}
      <T v={selected ? 'subMedium' : 'sub'} c={color.ink}>
        {label}
      </T>
    </Pressable>
  );
}

export function ChipWrap({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.chipWrap, style]}>{children}</View>;
}

/** iOS-style switch in Celestial yellow. */
export function Switch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    x.set(withTiming(value ? 1 : 0, { duration: 180 }));
  }, [value, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() * 20 }] }));
  const track = useAnimatedStyle(() => ({ opacity: 0.25 + x.get() * 0.75 }));
  return (
    <Pressable
      onPress={() => {
        tick();
        onChange(!value);
      }}
      hitSlop={10}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={styles.switch}>
      <View style={[StyleSheet.absoluteFill, styles.switchOff]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.switchOn, track]} />
      <Animated.View style={[styles.knob, knob]} />
    </Pressable>
  );
}

export function Checkbox({
  checked,
  onPress,
  size = 22,
  round,
}: {
  checked: boolean;
  onPress?: () => void;
  size?: number;
  round?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={[
        styles.check,
        { width: size, height: size, borderRadius: round ? size / 2 : 6 },
        checked ? styles.checkOn : styles.checkOff,
      ]}>
      {checked ? <Icon name="check" size={size - 6} c={color.ink} /> : null}
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  style,
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'plain' | 'danger';
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const textColor = kind === 'danger' ? color.red : color.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        kind === 'primary' && styles.buttonPrimary,
        kind === 'secondary' && styles.buttonSecondary,
        (kind === 'plain' || kind === 'danger') && styles.buttonPlain,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}>
      {icon ? <Icon name={icon} size={18} c={textColor} style={styles.buttonIcon} /> : null}
      <T v="headline" c={textColor}>
        {label}
      </T>
    </Pressable>
  );
}

/** Bottom sheet for small forms (add tag, etc.). */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.sheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.grabber} />
          {title ? (
            <T v="headline" style={styles.sheetTitle}>
              {title}
            </T>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
  row: {
    minHeight: 52,
    paddingHorizontal: SIDE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  rowIcon: { marginRight: 10 },
  rowValue: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 2 },
  valueText: { flexShrink: 1, textAlign: 'right' },
  panel: { paddingHorizontal: SIDE, paddingBottom: 16 },
  flat: { paddingHorizontal: 0 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.35 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
  },
  chipSmall: { height: 32, paddingHorizontal: 12, borderRadius: 16 },
  chipOn: { backgroundColor: color.yellow },
  chipOff: { backgroundColor: color.fill },
  chipIcon: { marginRight: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  switch: { width: 51, height: 31, borderRadius: 16, overflow: 'hidden', justifyContent: 'center' },
  switchOff: { backgroundColor: color.fillStrong },
  switchOn: { backgroundColor: color.yellow },
  knob: {
    width: 27,
    height: 27,
    borderRadius: 14,
    marginLeft: 2,
    backgroundColor: color.white,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  check: { alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: color.yellow },
  checkOff: { borderWidth: 1.5, borderColor: color.ink3 },
  button: {
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  buttonPrimary: { backgroundColor: color.yellow },
  buttonSecondary: { backgroundColor: color.fill },
  buttonPlain: { backgroundColor: 'transparent' },
  buttonIcon: { marginRight: 8 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(29,27,58,0.32)' },
  sheet: {
    backgroundColor: color.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: SIDE,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: color.fillStrong,
    marginBottom: 12,
  },
  sheetTitle: { marginBottom: 12 },
  input: {
    fontFamily: font.regular,
    fontSize: 17,
    color: color.ink,
    paddingVertical: 10,
  },
});
