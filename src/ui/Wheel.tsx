import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { detent } from '../lib/haptics';
import { T } from './Text';
import { color, font } from './theme';

/** Endless wheels repeat their values this many times and jump back to the middle when near an end. */
const LOOP_CYCLES = 41;

type RowProps = {
  index: number;
  y: SharedValue<number>;
  label: string;
  rowHeight: number;
  fontSize: number;
  align: 'left' | 'center' | 'right';
  onPress: (index: number) => void;
};

/** One row: fades, shrinks and tilts away from the centre line, like the side of a drum. */
const WheelRow = memo(function WheelRow({ index, y, label, rowHeight, fontSize, align, onPress }: RowProps) {
  const style = useAnimatedStyle(() => {
    const d = (index * rowHeight - y.get()) / rowHeight;
    const ad = Math.min(Math.abs(d), 3);
    const tilt = -Math.max(-70, Math.min(70, d * 21));
    return {
      opacity: Math.max(0.12, 1 - ad * 0.33),
      transform: [{ perspective: 500 }, { rotateX: `${tilt}deg` }, { scale: 1 - ad * 0.06 }],
    };
  });
  return (
    <Animated.View style={[{ height: rowHeight }, style]}>
      <Pressable
        onPress={() => onPress(index)}
        style={[
          styles.rowPress,
          { alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' },
        ]}>
        <T v="body" tabular style={{ fontSize, lineHeight: rowHeight, fontFamily: font.regular }}>
          {label}
        </T>
      </Pressable>
    </Animated.View>
  );
});

export type WheelProps<V> = {
  values: readonly V[];
  value: V;
  /** `steps` is how many rows the wheel moved (negative = up), e.g. to flip AM/PM when the hour passes 12. */
  onChange: (v: V, steps: number) => void;
  format?: (v: V) => string;
  /** Endless, like the iPhone hour and minute wheels */
  loop?: boolean;
  width?: number;
  align?: 'left' | 'center' | 'right';
  /** Tapping the value on the centre line (e.g. to close the wheel) */
  onConfirm?: () => void;
  rows?: number;
  rowHeight?: number;
  fontSize?: number;
  label?: string;
};

/**
 * iPhone-style wheel. Whatever stops on the centre line is the value; a click is felt for every row
 * that passes it. Tapping another row turns it to the centre; tapping the centre row calls onConfirm.
 */
export function Wheel<V>({
  values,
  value,
  onChange,
  format,
  loop,
  width,
  align = 'center',
  onConfirm,
  rows = 5,
  rowHeight = 40,
  fontSize = 21,
  label,
}: WheelProps<V>) {
  const n = values.length;
  const cycles = loop ? LOOP_CYCLES : 1;
  const mid = Math.floor(cycles / 2);
  const total = n * cycles;
  const data = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);
  const valueIndex = Math.max(0, values.indexOf(value));
  const initialIndex = mid * n + valueIndex;
  const pad = (rowHeight * (rows - 1)) / 2;

  const list = useRef<FlatList<number>>(null);
  const y = useSharedValue(initialIndex * rowHeight);
  const lastRow = useSharedValue(initialIndex);
  // 1 while the wheel turns by itself (value changed elsewhere): no clicks then.
  const quiet = useSharedValue(0);
  const centered = useRef(initialIndex);
  const latest = useRef({ value, onChange, onConfirm, values });
  useEffect(() => {
    latest.current = { value, onChange, onConfirm, values };
  });

  const click = useCallback(() => detent(), []);

  const settle = useCallback(
    (offset: number) => {
      const { values: vals, value: cur, onChange: change } = latest.current;
      const count = vals.length;
      const idx = Math.min(total - 1, Math.max(0, Math.round(offset / rowHeight)));
      const steps = idx - centered.current;
      centered.current = idx;
      const v = vals[idx % count];
      // A full turn lands on the same value but still counts (12 hours later on the hour wheel).
      if (v !== cur || steps !== 0) change(v, steps);
      if (loop && (idx < count * 4 || idx > total - count * 4)) {
        const back = mid * count + (idx % count);
        centered.current = back;
        quiet.set(1);
        list.current?.scrollToOffset({ offset: back * rowHeight, animated: false });
      }
    },
    [loop, mid, quiet, rowHeight, total],
  );

  const onScroll = useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        y.set(e.contentOffset.y);
        const row = Math.round(e.contentOffset.y / rowHeight);
        if (row !== lastRow.get()) {
          lastRow.set(row);
          if (!quiet.get()) scheduleOnRN(click);
        }
      },
      onBeginDrag: () => {
        quiet.set(0);
      },
      onEndDrag: (e) => {
        const v = e.velocity ? Math.abs(e.velocity.y) : 0;
        if (v < 0.05) scheduleOnRN(settle, e.contentOffset.y);
      },
      onMomentumEnd: (e) => {
        scheduleOnRN(settle, e.contentOffset.y);
      },
    },
    [rowHeight, settle, click],
  );

  // Follow the value when it changes elsewhere (shortest way round on endless wheels).
  useEffect(() => {
    const cur = centered.current;
    if (values[cur % n] === value) return;
    const want = Math.max(0, values.indexOf(value));
    let delta = want - (cur % n);
    if (loop) {
      if (delta > n / 2) delta -= n;
      if (delta < -n / 2) delta += n;
    }
    const target = Math.min(total - 1, Math.max(0, cur + delta));
    centered.current = target;
    quiet.set(1);
    list.current?.scrollToOffset({ offset: target * rowHeight, animated: true });
  }, [value, values, n, loop, rowHeight, total, quiet]);

  const pressRow = useCallback(
    (i: number) => {
      const { values: vals, onChange: change, onConfirm: confirm } = latest.current;
      if (i === centered.current) {
        confirm?.();
        return;
      }
      const steps = i - centered.current;
      centered.current = i;
      quiet.set(0);
      list.current?.scrollToOffset({ offset: i * rowHeight, animated: true });
      change(vals[i % vals.length], steps);
    },
    [quiet, rowHeight],
  );

  return (
    <View style={[{ height: rows * rowHeight }, width ? { width } : styles.flex]} accessibilityLabel={label}>
      <Animated.FlatList
        ref={list}
        data={data}
        keyExtractor={(i) => String(i)}
        renderItem={({ item: i }) => (
          <WheelRow
            index={i}
            y={y}
            label={format ? format(values[i % n]) : String(values[i % n])}
            rowHeight={rowHeight}
            fontSize={fontSize}
            align={align}
            onPress={pressRow}
          />
        )}
        getItemLayout={(_, i) => ({ length: rowHeight, offset: rowHeight * i, index: i })}
        initialScrollIndex={initialIndex}
        snapToInterval={rowHeight}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        overScrollMode="never"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingVertical: pad }}
        initialNumToRender={rows + 8}
        maxToRenderPerBatch={30}
        windowSize={9}
      />
    </View>
  );
}

/** A fixed word on the centre line beside a wheel, e.g. "min" or "rounds". */
export function WheelLabel({
  text,
  width,
  rows = 5,
  rowHeight = 40,
  align = 'left',
}: {
  text: string;
  width?: number;
  rows?: number;
  rowHeight?: number;
  align?: 'left' | 'center';
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        { height: rows * rowHeight, paddingTop: (rowHeight * (rows - 1)) / 2 },
        width ? { width } : null,
        align === 'center' ? styles.center : null,
      ]}>
      <T v="callout" c={color.ink2} style={{ lineHeight: rowHeight }} numberOfLines={1}>
        {text}
      </T>
    </View>
  );
}

/** Lays wheels side by side over one shared band that marks the centre line. */
export function WheelGroup({
  children,
  rows = 5,
  rowHeight = 40,
  style,
  band = color.fill,
}: {
  children: ReactNode;
  rows?: number;
  rowHeight?: number;
  style?: StyleProp<ViewStyle>;
  band?: string;
}) {
  return (
    <View style={[styles.group, { height: rows * rowHeight }, style]}>
      <View
        pointerEvents="none"
        style={[styles.band, { top: (rowHeight * (rows - 1)) / 2, height: rowHeight, backgroundColor: band }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center' },
  rowPress: { flex: 1, justifyContent: 'center', paddingHorizontal: 6 },
  group: { flexDirection: 'row', alignItems: 'stretch', justifyContent: 'center' },
  band: { position: 'absolute', left: 0, right: 0, borderRadius: 12 },
});
