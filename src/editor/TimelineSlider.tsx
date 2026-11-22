import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  useTapGesture,
  type PanGestureActiveEvent,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { pad } from '../lib/dates';
import { MONTHS_SHORT, partOfDay, WEEKDAYS_SHORT } from '../lib/format';
import { bump, detent } from '../lib/haptics';
import { T } from '../ui/Text';
import { bands, color, font, SIDE } from '../ui/theme';

/** Pixels per minute: one hour = 96 px. */
const PX = 1.6;
const STEP = 5;
const MAX_LEAD = 12 * 60;
const MAX_PIN = 24 * 60;

const LABEL_Y = 0;
const BAND_Y = 20;
const TRACK_Y = 54;
const DOT_LABEL_Y = 76;
const HEIGHT = 96;

type Domain = { start: number; minutes: number };

/** The track runs from 6 h before now to 3 days ahead; far dates get their own 36-hour window. */
function computeDomain(alarm: Date, now: Date): Domain {
  const near = new Date(now);
  near.setMinutes(0, 0, 0);
  near.setHours(near.getHours() - 6);
  const nearMinutes = (6 + 72) * 60;
  const t = alarm.getTime();
  if (t >= near.getTime() + 60 * 60000 && t <= near.getTime() + (nearMinutes - 60) * 60000) {
    return { start: near.getTime(), minutes: nearMinutes };
  }
  const far = new Date(alarm.getFullYear(), alarm.getMonth(), alarm.getDate(), -6, 0, 0, 0);
  return { start: far.getTime(), minutes: 36 * 60 };
}

function inDomain(d: Domain, alarm: Date) {
  const m = (alarm.getTime() - d.start) / 60000;
  return m >= 60 && m <= d.minutes - 60;
}

function clockOf(origin: number, m: number) {
  const d = new Date(origin + m * 60000);
  return { h: d.getHours(), min: d.getMinutes(), date: d };
}

function hourLabel(h: number) {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

/** Hour labels, part-of-day bands, the past and "now". Re-renders only when the window or minute changes. */
const TrackStatic = memo(function TrackStatic({
  origin,
  total,
  nowM,
}: {
  origin: number;
  total: number;
  nowM: number;
}) {
  const hours = Math.floor(total / 60);
  const items: React.ReactNode[] = [];
  let bandStart = 0;
  let bandPart = partOfDay(clockOf(origin, 0).h * 60);
  for (let i = 0; i <= hours; i++) {
    const m = i * 60;
    const { h, date } = clockOf(origin, m);
    const x = m * PX;
    const midnight = h === 0;
    items.push(
      <View key={`t${i}`} style={[styles.tick, { left: x, height: midnight ? 12 : 6 }]} />,
      <T
        key={`l${i}`}
        v={midnight ? 'micro' : 'cap'}
        c={midnight ? color.ink : color.ink3}
        style={[styles.hourLabel, { left: x - 30 }, midnight && styles.dayLabel]}>
        {midnight
          ? `${WEEKDAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`
          : hourLabel(h)}
      </T>,
    );
    const part = partOfDay(h * 60);
    if (part !== bandPart || i === hours) {
      items.push(
        <View
          key={`b${i}`}
          style={[styles.band, { left: bandStart * PX, width: (m - bandStart) * PX, backgroundColor: bands[bandPart] }]}
        />,
      );
      bandStart = m;
      bandPart = part;
    }
  }
  const nowX = Math.max(0, nowM) * PX;
  return (
    <>
      {items}
      <View style={[styles.axis, { width: total * PX }]} />
      {nowM > 0 ? <View style={[styles.past, { width: nowX }]} /> : null}
      {nowM > 0 && nowM < total ? <View style={[styles.nowLine, { left: nowX - 1 }]} /> : null}
    </>
  );
});

type Props = {
  alarm: Date;
  lead: number;
  gap: number;
  pins: number[];
  /** Earliest allowed alarm time */
  min: Date;
  onAlarm: (d: Date) => void;
  onLead: (lead: number) => void;
  onPins: (pins: number[]) => void;
  showHint: boolean;
  onUsed: (which: 'alarm' | 'pre') => void;
  /** Yellow for alarms, blue for reminders */
  accent?: string;
};

export function TimelineSlider({
  alarm,
  lead,
  gap,
  pins,
  min,
  onAlarm,
  onLead,
  onPins,
  showHint,
  onUsed,
  accent = color.yellow,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const [domain, setDomain] = useState<Domain>(() => computeDomain(alarm, new Date()));
  const alarmMs = alarm.getTime();
  if (!inDomain(domain, alarm)) {
    // The alarm moved outside the track (e.g. a far date from the calendar): build a new track.
    setDomain(computeDomain(alarm, new Date(now)));
  }

  const origin = domain.start;
  const total = domain.minutes;
  const width = total * PX;
  const alarmM = Math.round((alarmMs - origin) / 60000);
  const minM = Math.ceil((min.getTime() - origin) / 60000);
  const nowM = (now - origin) / 60000;

  const scroll = useSharedValue(0);
  const viewW = useSharedValue(0);
  const svWidth = useSharedValue(width);
  const svAlarm = useSharedValue(alarmM);
  const svLead = useSharedValue(lead);
  const svGap = useSharedValue(gap);
  const svMin = useSharedValue(minM);
  const svTotal = useSharedValue(total);
  const drag = useSharedValue(0); // 1 = alarm, 2 = pre-alarm start
  const startMin = useSharedValue(0);
  const startLead = useSharedValue(0);
  const startScroll = useSharedValue(0);
  const startViewX = useSharedValue(0);
  const lastTx = useSharedValue(0);
  const fingerX = useSharedValue(0);

  useEffect(() => {
    if (drag.get() === 0) svAlarm.set(alarmM);
  }, [alarmM, drag, svAlarm]);
  useEffect(() => {
    if (drag.get() === 0) svLead.set(lead);
  }, [lead, drag, svLead]);
  useEffect(() => {
    svGap.set(gap);
    svMin.set(minM);
    svTotal.set(total);
    svWidth.set(width);
  }, [gap, minM, total, width, svGap, svMin, svTotal, svWidth]);

  // Stable JS callbacks for worklets.
  const latest = useRef({ origin, onAlarm, onLead, onUsed });
  useLayoutEffect(() => {
    latest.current = { origin, onAlarm, onLead, onUsed };
  });
  const emitAlarm = useCallback((m: number) => {
    detent();
    latest.current.onAlarm(new Date(latest.current.origin + m * 60000));
  }, []);
  const emitLead = useCallback((l: number) => {
    detent();
    latest.current.onLead(l);
  }, []);
  const emitUsed = useCallback((which: 'alarm' | 'pre') => {
    latest.current.onUsed(which);
  }, []);

  const centerOn = useCallback(
    (m: number, animated: boolean) => {
      const w = viewW.get();
      if (!w) return;
      const target = Math.min(Math.max(0, m * PX - w * 0.62), Math.max(0, width - w));
      if (animated) scroll.set(withTiming(target, { duration: 260 }));
      else scroll.set(target);
    },
    [scroll, viewW, width],
  );

  // Keep the diamond in view when the time changes elsewhere (time wheel, calendar).
  const firstLayout = useRef(true);
  useEffect(() => {
    if (drag.get() !== 0) return;
    const w = viewW.get();
    if (!w) return;
    const x = alarmM * PX - scroll.get();
    if (x < w * 0.15 || x > w * 0.9) centerOn(alarmM, true);
  }, [alarmM, centerOn, drag, scroll, viewW]);
  useEffect(() => {
    centerOn(alarmM, false);
    // Only when the window itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    viewW.set(w);
    if (firstLayout.current) {
      firstLayout.current = false;
      const target = Math.min(Math.max(0, alarmM * PX - w * 0.62), Math.max(0, width - w));
      scroll.set(target);
    }
  };

  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -scroll.get() }] }));

  // Drag the diamond: moves the alarm in 5-minute steps; scrolls when held near an edge.
  const alarmPanConfig = useMemo(
    () => ({
      activeOffsetX: [-2, 2] as [number, number],
      failOffsetY: [-14, 14] as [number, number],
      onActivate: () => {
        'worklet';
        cancelAnimation(scroll);
        drag.set(1);
        startMin.set(svAlarm.get());
        startScroll.set(scroll.get());
        startViewX.set(svAlarm.get() * PX - scroll.get());
        lastTx.set(0);
        fingerX.set(svAlarm.get() * PX - scroll.get());
      },
      onUpdate: (e: PanGestureActiveEvent) => {
        'worklet';
        lastTx.set(e.translationX);
        fingerX.set(startViewX.get() + e.translationX);
        const raw = startMin.get() + (e.translationX + (scroll.get() - startScroll.get())) / PX;
        const snapped = Math.min(Math.max(Math.round(raw / STEP) * STEP, svMin.get()), svTotal.get() - 30);
        if (snapped !== svAlarm.get()) {
          svAlarm.set(snapped);
          scheduleOnRN(emitAlarm, snapped);
        }
      },
      onFinalize: () => {
        'worklet';
        if (drag.get() === 1) scheduleOnRN(emitUsed, 'alarm');
        drag.set(0);
      },
    }),
    [drag, emitAlarm, emitUsed, fingerX, lastTx, scroll, startMin, startScroll, startViewX, svAlarm, svMin, svTotal],
  );
  const alarmPan = usePanGesture(alarmPanConfig);

  // Pull the arrow: pre-alarms counted back from the alarm in gap steps.
  const leadPanConfig = useMemo(
    () => ({
      activeOffsetX: [-2, 2] as [number, number],
      failOffsetY: [-14, 14] as [number, number],
      onActivate: () => {
        'worklet';
        cancelAnimation(scroll);
        drag.set(2);
        startLead.set(svLead.get());
      },
      onUpdate: (e: PanGestureActiveEvent) => {
        'worklet';
        const g = Math.max(1, svGap.get());
        const raw = startLead.get() - e.translationX / PX;
        const maxLead = Math.min(MAX_LEAD, svAlarm.get());
        const snapped = Math.min(Math.max(Math.round(raw / g) * g, 0), Math.floor(maxLead / g) * g);
        if (snapped !== svLead.get()) {
          svLead.set(snapped);
          scheduleOnRN(emitLead, snapped);
        }
      },
      onFinalize: () => {
        'worklet';
        if (drag.get() === 2) scheduleOnRN(emitUsed, 'pre');
        drag.set(0);
      },
    }),
    [drag, emitLead, emitUsed, scroll, startLead, svAlarm, svGap, svLead],
  );
  const leadPan = usePanGesture(leadPanConfig);

  useFrameCallback(() => {
    'worklet';
    if (drag.get() !== 1) return;
    const w = viewW.get();
    const fx = fingerX.get();
    const edge = 48;
    let v = 0;
    if (fx > w - edge) v = Math.min(1, (fx - (w - edge)) / edge) * 7;
    else if (fx < edge) v = -Math.min(1, (edge - fx) / edge) * 7;
    if (v === 0) return;
    const max = Math.max(0, svWidth.get() - w);
    const next = Math.min(Math.max(scroll.get() + v, 0), max);
    if (next === scroll.get()) return;
    scroll.set(next);
    const raw = startMin.get() + (lastTx.get() + (next - startScroll.get())) / PX;
    const snapped = Math.min(Math.max(Math.round(raw / STEP) * STEP, svMin.get()), svTotal.get() - 30);
    if (snapped !== svAlarm.get()) {
      svAlarm.set(snapped);
      scheduleOnRN(emitAlarm, snapped);
    }
  });

  // Scroll the track by dragging anywhere else.
  const trackPanConfig = useMemo(
    () => ({
      activeOffsetX: [-8, 8] as [number, number],
      failOffsetY: [-12, 12] as [number, number],
      onActivate: () => {
        'worklet';
        cancelAnimation(scroll);
        startScroll.set(scroll.get());
      },
      onUpdate: (e: PanGestureActiveEvent) => {
        'worklet';
        const max = Math.max(0, svWidth.get() - viewW.get());
        scroll.set(Math.min(Math.max(startScroll.get() - e.translationX, 0), max));
      },
      onDeactivate: (e: PanGestureActiveEvent) => {
        'worklet';
        const max = Math.max(0, svWidth.get() - viewW.get());
        scroll.set(withDecay({ velocity: -e.velocityX, clamp: [0, max] }));
      },
    }),
    [scroll, startScroll, svWidth, viewW],
  );
  const trackPan = usePanGesture(trackPanConfig);

  // Tap left of the arrow: pin one extra pre-alarm there (tap it again to remove).
  const handleTap = (x: number) => {
    const contentX = x + scroll.get();
    const m = Math.round(contentX / PX / STEP) * STEP;
    const offset = alarmM - m;
    if (offset <= lead + 4 || offset > MAX_PIN || m < 0) return;
    const hit = pins.find((p) => Math.abs(p - offset) * PX < 14);
    bump();
    if (hit !== undefined) onPins(pins.filter((p) => p !== hit));
    else onPins([...pins, offset].sort((a, b) => b - a));
  };
  const tapRef = useRef(handleTap);
  useLayoutEffect(() => {
    tapRef.current = handleTap;
  });
  const trackTapConfig = useMemo(
    () => ({
      runOnJS: true,
      onActivate: (e: { x: number }) => tapRef.current(e.x),
    }),
    [],
  );
  const trackTap = useTapGesture(trackTapConfig);
  const trackGesture = useCompetingGestures(trackPan, trackTap);

  // ---- dynamic layer ----
  const xA = alarmM * PX;
  const xL = (alarmM - lead) * PX;
  const count = gap > 0 ? Math.floor(lead / gap) : 0;
  const dotMinutes: number[] = [];
  for (let k = 1; k < count; k++) dotMinutes.push(alarmM - k * gap);

  const labels = useMemo(() => {
    type L = { m: number; strong: boolean };
    const marks: L[] = [{ m: alarmM, strong: true }];
    if (lead > 0) marks.push({ m: alarmM - lead, strong: true });
    for (const m of dotMinutes) marks.push({ m, strong: false });
    for (const p of pins) marks.push({ m: alarmM - p, strong: true });
    marks.sort((a, b) => a.m - b.m);
    const out: { x: number; text: string; main: boolean }[] = [];
    let prevHour = -1;
    for (const mk of marks) {
      const { h, min } = clockOf(origin, mk.m);
      const full = `${h % 12 === 0 ? 12 : h % 12}:${pad(min)}`;
      const text = prevHour === h && mk.m !== alarmM ? `:${pad(min)}` : full;
      const x = mk.m * PX;
      const isMain = mk.m === alarmM;
      const last = out[out.length - 1];
      if (last && x - last.x < (text.length > 3 ? 34 : 26)) {
        if (isMain) out.pop();
        else continue;
      }
      out.push({ x, text, main: isMain });
      prevHour = h;
    }
    return out;
    // dotMinutes derives from alarmM, lead and gap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmM, lead, gap, pins, origin]);

  // The arrow never hides under the diamond: with no (or few) pre-alarms it waits just left of it.
  const ARROW_W = 13;
  const arrowLeft = Math.min(xL - 6, xA - 30);
  const leadHit = { left: arrowLeft - 12, width: ARROW_W + 22 };
  const alarmLeft = Math.max(xA - 20, leadHit.left + leadHit.width);
  const alarmHit = { left: alarmLeft, width: xA + 22 - alarmLeft };
  const nowX = nowM * PX;
  const showNow = nowM > 0 && nowM < total && Math.abs(nowX - xA) > 34 && Math.abs(nowX - xL) > 30;

  return (
    <View>
      <GestureDetector gesture={trackGesture}>
        <View style={styles.viewport} onLayout={onLayout}>
          <Animated.View style={[styles.content, { width }, contentStyle]}>
            <TrackStatic origin={origin} total={total} nowM={nowM} />

            {lead > 0 ? (
              <View style={[styles.preSegment, { left: xL, width: xA - xL, backgroundColor: accent }]} />
            ) : null}
            {dotMinutes.map((m) => (
              <View key={`d${m}`} style={[styles.dot, { left: m * PX - 4 }]} />
            ))}
            {pins.map((p) => (
              <View key={`p${p}`} style={[styles.pin, { left: (alarmM - p) * PX - 5 }]} />
            ))}
            {showNow ? (
              <T v="micro" c={color.red} style={[styles.nowLabel, { left: nowX - 20 }]}>
                now
              </T>
            ) : null}
            {labels.map((l) => (
              <T
                key={`lab${l.x}`}
                v="micro"
                c={l.main ? color.ink : color.ink2}
                tabular
                style={[styles.dotLabel, { left: l.x - 24 }, l.main && styles.dotLabelMain]}>
                {l.text}
              </T>
            ))}

            <GestureDetector gesture={leadPan}>
              <View
                style={[styles.hit, leadHit]}
                accessibilityLabel="Pre-alarm start. Drag left to add pre-alarms"
                accessibilityRole="adjustable">
                <View style={[styles.arrow, { marginLeft: arrowLeft - leadHit.left }]} />
              </View>
            </GestureDetector>

            <GestureDetector gesture={alarmPan}>
              <View
                style={[styles.hit, alarmHit]}
                accessibilityLabel="Alarm time. Drag to change"
                accessibilityRole="adjustable">
                <View style={[styles.diamond, { marginLeft: xA - alarmHit.left - 9, backgroundColor: accent }]} />
              </View>
            </GestureDetector>
          </Animated.View>
        </View>
      </GestureDetector>
      {showHint ? (
        <View style={styles.hintBox}>
          <View style={styles.hintLine}>
            <T v="foot" c={color.ink2}>
              Drag{' '}
            </T>
            <View style={[styles.miniDiamond, { backgroundColor: accent }]} />
            <T v="foot" c={color.ink2}>
              {' '}
              to move the time.
            </T>
          </View>
          <View style={styles.hintLine}>
            <T v="foot" c={color.ink2}>
              Pull{' '}
            </T>
            <View style={styles.miniArrow} />
            <T v="foot" c={color.ink2}>
              {' '}
              left for pre-alarms. Tap further left to pin one.
            </T>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { height: HEIGHT, overflow: 'hidden' },
  content: { position: 'absolute', left: 0, top: 0, height: HEIGHT },
  tick: { position: 'absolute', top: BAND_Y + 5, width: StyleSheet.hairlineWidth, backgroundColor: color.ink3 },
  hourLabel: { position: 'absolute', top: LABEL_Y, width: 60, textAlign: 'center' },
  dayLabel: { fontFamily: font.semibold },
  band: { position: 'absolute', top: BAND_Y, height: 5, borderRadius: 2 },
  axis: { position: 'absolute', left: 0, top: TRACK_Y - 1, height: 2, backgroundColor: color.line },
  past: {
    position: 'absolute',
    left: 0,
    top: BAND_Y,
    height: HEIGHT - BAND_Y,
    backgroundColor: 'rgba(244,244,247,0.75)',
  },
  nowLine: { position: 'absolute', top: BAND_Y, width: 2, height: TRACK_Y - BAND_Y + 8, backgroundColor: color.red },
  nowLabel: { position: 'absolute', top: TRACK_Y + 10, width: 40, textAlign: 'center' },
  preSegment: { position: 'absolute', top: TRACK_Y - 2, height: 4, borderRadius: 2, backgroundColor: color.yellow },
  dot: {
    position: 'absolute',
    top: TRACK_Y - 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.navy,
  },
  pin: {
    position: 'absolute',
    top: TRACK_Y - 5,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: color.navy,
    backgroundColor: color.white,
  },
  dotLabel: { position: 'absolute', top: DOT_LABEL_Y, width: 48, textAlign: 'center' },
  dotLabelMain: { fontFamily: font.semibold },
  hit: { position: 'absolute', top: TRACK_Y - 26, height: 52, justifyContent: 'center' },
  diamond: {
    width: 18,
    height: 18,
    borderRadius: 3,
    backgroundColor: color.yellow,
    borderWidth: 2,
    borderColor: color.navy,
    transform: [{ rotate: '45deg' }],
  },
  arrow: {
    width: 0,
    height: 0,
    borderTopWidth: 9,
    borderBottomWidth: 9,
    borderRightWidth: 13,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: color.navy,
  },
  hintBox: { paddingHorizontal: SIDE, paddingTop: 2, paddingBottom: 6, gap: 2 },
  hintLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  miniDiamond: {
    width: 9,
    height: 9,
    backgroundColor: color.yellow,
    borderWidth: 1.5,
    borderColor: color.navy,
    transform: [{ rotate: '45deg' }],
    marginHorizontal: 2,
  },
  miniArrow: {
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderRightWidth: 8,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: color.navy,
    marginHorizontal: 2,
  },
});
