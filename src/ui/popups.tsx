import { useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type HostInstance,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tick } from '../lib/haptics';
import { Icon, type IconName } from './Icon';
import { T } from './Text';
import { color } from './theme';

export type Rect = { x: number; y: number; w: number; h: number };

/** Tallest a list popup gets before it scrolls (the screen limits it further). */
const MENU_MAX = 600;

/** Measures where a row sits on screen so a popup can open right next to it. */
export function useAnchor<K extends string = string>() {
  const [open, setOpen] = useState<{ key: K; rect: Rect } | null>(null);
  const refs = useRef(new Map<string, HostInstance | null>());
  /** ref={anchor.ref('repeat')} on the row */
  const ref = (key: K) => (node: HostInstance | null) => {
    refs.current.set(key, node);
  };
  /** Opens popup `key` next to the row registered as `from` (default: the same key). */
  const show = (key: K, from?: K) => {
    const node = refs.current.get(from ?? key);
    if (!node) return;
    node.measureInWindow((x, y, w, h) => setOpen({ key, rect: { x, y, w, h } }));
  };
  const rectFor = (key: K) => (open?.key === key ? open.rect : null);
  return { ref, show, rectFor, openKey: open?.key ?? null, close: () => setOpen(null) };
}

/** Below the anchor, else above it, else centred; always inside the screen. Right edges line up. */
function usePlacement(anchor: Rect | null, width: number, height: number) {
  const { width: sw, height: sh } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const topLimit = insets.top + 12;
  const bottomLimit = sh - insets.bottom - 12;
  const maxHeight = bottomLimit - topLimit;
  if (!anchor) return { left: 0, top: 0, maxHeight };
  const left = Math.min(Math.max(12, anchor.x + anchor.w - width - 8), sw - width - 12);
  const below = anchor.y + anchor.h + 4;
  const above = anchor.y - 4 - height;
  if (below + height <= bottomLimit) return { left, top: below, maxHeight };
  if (above >= topLimit) return { left, top: above, maxHeight };
  const centred = (sh - Math.min(height, maxHeight)) / 2;
  return { left, top: Math.max(topLimit, Math.min(centred, bottomLimit - height)), maxHeight };
}

/** Starts from an estimate, then uses the real height once the card has been laid out. */
function useMeasured(estimate: number) {
  const [h, setH] = useState(estimate);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    if (Math.abs(next - h) > 1) setH(next);
  };
  return { h, onLayout };
}

export type MenuOption<K extends string> = {
  key: K;
  label: string;
  icon?: IconName;
  iconColor?: string;
  /** Small heading above this option, e.g. "Loud" */
  section?: string;
  /** Thick gap above this option, to group the list like iPhone menus */
  dividerBefore?: boolean;
};

/**
 * Small list next to its row, like iPhone menus; the chosen option has a ✓.
 * `keepOpen` keeps it open after a tap, e.g. to listen to several sounds.
 */
export function PopupMenu<K extends string>({
  anchor,
  options,
  selected,
  onSelect,
  onClose,
  width = 250,
  accent = color.ink,
  keepOpen,
  plain,
}: {
  anchor: Rect | null;
  options: MenuOption<K>[];
  selected?: K | null;
  onSelect: (key: K) => void;
  onClose: () => void;
  width?: number;
  accent?: string;
  keepOpen?: boolean;
  /** Actions rather than choices: no ✓ column */
  plain?: boolean;
}) {
  const est =
    options.length * 44 +
    options.filter((o) => o.dividerBefore || o.section).length * 8 +
    options.filter((o) => o.section).length * 30 +
    12;
  const m = useMeasured(Math.min(est, MENU_MAX));
  const place = usePlacement(anchor, width, m.h);
  return (
    <Modal visible={!!anchor} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      {anchor ? (
        <Animated.View
          entering={FadeIn.duration(120)}
          exiting={FadeOut.duration(100)}
          onLayout={m.onLayout}
          style={[
            styles.card,
            { left: place.left, top: place.top, width, maxHeight: Math.min(place.maxHeight, MENU_MAX) },
          ]}>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {options.map((o, i) => (
              <View key={o.key}>
                {(o.dividerBefore || o.section) && i > 0 ? <View style={styles.divider} /> : null}
                {o.section ? (
                  <T v="footMedium" c={color.ink2} style={styles.section}>
                    {o.section}
                  </T>
                ) : null}
                <Pressable
                  onPress={() => {
                    tick();
                    onSelect(o.key);
                    if (!keepOpen) onClose();
                  }}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: selected === o.key }}>
                  {plain ? (
                    <View style={styles.plainGap} />
                  ) : (
                    <View style={styles.check}>
                      {selected === o.key ? <Icon name="check" size={20} c={accent} /> : null}
                    </View>
                  )}
                  <T v="body" style={styles.label} numberOfLines={1}>
                    {o.label}
                  </T>
                  {o.icon ? <Icon name={o.icon} size={21} c={o.iconColor ?? color.ink} /> : null}
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

/** Any content in a small card next to its row (calendar, custom repeat, two wheels). */
export function Popover({
  anchor,
  onClose,
  width = 330,
  estimate = 380,
  title,
  onDone,
  doneLabel = 'Done',
  accent = color.ink,
  children,
}: {
  anchor: Rect | null;
  onClose: () => void;
  width?: number;
  estimate?: number;
  title?: string;
  /** Shows a Done button in the top right */
  onDone?: () => void;
  doneLabel?: string;
  accent?: string;
  children: ReactNode;
}) {
  const m = useMeasured(estimate);
  const place = usePlacement(anchor, width, m.h);
  return (
    <Modal visible={!!anchor} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      {anchor ? (
        <Animated.View
          entering={FadeIn.duration(120)}
          exiting={FadeOut.duration(100)}
          onLayout={m.onLayout}
          style={[styles.card, styles.popover, { left: place.left, top: place.top, width }]}>
          {title || onDone ? (
            <View style={styles.popHead}>
              <T v="headline">{title ?? ''}</T>
              {onDone ? (
                <Pressable onPress={onDone} hitSlop={12} accessibilityRole="button">
                  <T v="headline" c={accent}>
                    {doneLabel}
                  </T>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {children}
        </Animated.View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    borderRadius: 16,
    backgroundColor: color.bg,
    paddingVertical: 6,
    elevation: 14,
    shadowColor: '#1D1B3A',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  popover: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 },
  popHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  section: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 2 },
  option: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingRight: 16 },
  pressed: { backgroundColor: color.fill },
  check: { width: 40, alignItems: 'center' },
  plainGap: { width: 18 },
  label: { flex: 1, marginRight: 10 },
  divider: { height: 8, backgroundColor: color.fill },
});
