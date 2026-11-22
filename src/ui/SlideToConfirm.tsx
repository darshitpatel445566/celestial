import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture, type PanGestureActiveEvent } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { success } from '../lib/haptics';
import { Icon, type IconName } from './Icon';
import { T } from './Text';

const H = 64;
const KNOB = 54;
const PAD = 5;

/** "Slide to stop": drag the knob to the end. Lets go early and it springs back. */
export function SlideToConfirm({
  label,
  onConfirm,
  knob,
  knobIcon = 'chevron-double-right',
  iconColor,
  track = 'rgba(255,255,255,0.14)',
  text = 'rgba(255,255,255,0.85)',
}: {
  label: string;
  onConfirm: () => void;
  knob: string;
  knobIcon?: IconName;
  iconColor: string;
  track?: string;
  text?: string;
}) {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const max = useSharedValue(1);
  const done = useSharedValue(0);
  const latest = useRef(onConfirm);
  useEffect(() => {
    latest.current = onConfirm;
  });
  const confirm = useCallback(() => {
    success();
    latest.current();
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(w);
    max.set(Math.max(1, w - KNOB - PAD * 2));
  };

  const config = useMemo(
    () => ({
      activeOffsetX: [-4, 4] as [number, number],
      onUpdate: (e: PanGestureActiveEvent) => {
        'worklet';
        if (done.get()) return;
        x.set(Math.min(Math.max(0, e.translationX), max.get()));
      },
      onDeactivate: () => {
        'worklet';
        if (done.get()) return;
        if (x.get() > max.get() * 0.82) {
          done.set(1);
          x.set(withTiming(max.get(), { duration: 120 }));
          scheduleOnRN(confirm);
        } else {
          x.set(withSpring(0, { damping: 18, stiffness: 220 }));
        }
      },
    }),
    [confirm, done, max, x],
  );
  const pan = usePanGesture(config);

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - (x.get() / max.get()) * 1.6) }));

  return (
    <View style={[styles.track, { backgroundColor: track }]} onLayout={onLayout} accessibilityRole="adjustable" accessibilityLabel={label}>
      <Animated.View style={[styles.labelWrap, labelStyle]} pointerEvents="none">
        <T v="headline" c={text}>
          {label}
        </T>
      </Animated.View>
      {width ? (
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.knob, { backgroundColor: knob }, knobStyle]}>
            <Icon name={knobIcon} size={28} c={iconColor} />
          </Animated.View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: H, borderRadius: H / 2, justifyContent: 'center' },
  labelWrap: { position: 'absolute', left: KNOB + PAD * 2, right: PAD * 2, alignItems: 'center' },
  knob: {
    position: 'absolute',
    left: PAD,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
