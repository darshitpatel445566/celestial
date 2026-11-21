import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NativeTrigger, RingState } from '../../modules/celestial-alarm';
import { atTime, diffDays, minutesOf, today as todayYmd } from '../lib/dates';
import {
  addRingEndListener,
  getRingState,
  releaseLockScreen,
  setMissionMode,
  snooze,
  stopRinging,
} from '../lib/engine';
import { amPm, fmtClock, fmtDate, fmtLeft, fmtTime } from '../lib/format';
import { success, tick } from '../lib/haptics';
import { currentOccurrence, taskCount, titleOf, tracksDone } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { Item } from '../lib/types';
import { MissionRunner } from '../missions/Missions';
import { Checkbox } from '../ui/controls';
import { Icon, MISSION_ICONS, PartIcon } from '../ui/Icon';
import { T } from '../ui/Text';
import { color, SIDE } from '../ui/theme';

type Stage = 'ring' | 'mission' | 'after' | 'snoozed';

/** Web preview only: pretend the first saved item is ringing, to check the design without a phone. */
function webDemoState(demo?: string): RingState | null {
  if (Platform.OS !== 'web' || !demo) return null;
  const item = useStore.getState().items[0];
  if (!item) return null;
  const pre = demo === 'pre';
  return {
    ringing: true,
    snoozed: false,
    snoozeCount: 0,
    snoozedUntil: 0,
    startedAt: Date.now(),
    missionMode: false,
    serviceAlive: true,
    trigger: {
      id: 'demo',
      alarmId: item.id,
      kind: pre ? 'pre' : demo === 'window' ? 'window' : 'main',
      style: pre ? 'pre' : 'ring',
      wall: '',
      at: Date.now(),
      title: item.name,
      body: '',
      sound: item.sound.main,
      rising: true,
      vibrate: true,
      ringMinutes: 10,
      snoozeMinutes: item.snooze.minutes,
      snoozeLimit: item.snooze.times,
      occurrence: demo === 'window' ? '2026-11-15' : item.date,
      last: demo === 'window',
    },
  };
}

const DIM = 'rgba(255,255,255,0.66)';
const IDLE_MS = 10000;

/** Opens over the lock screen while an alarm rings. Also shows an item from a reminder notification. */
export default function RingScreen() {
  const params = useLocalSearchParams<{ view?: string; demo?: string }>();
  const insets = useSafeAreaInsets();
  const items = useStore((s) => s.items);
  const setLines = useStore((s) => s.setLines);
  const setDone = useStore((s) => s.setDone);
  const upsert = useStore((s) => s.upsert);

  const [state, setState] = useState<RingState | null>(() => getRingState() ?? webDemoState(params.demo));
  const [stage, setStage] = useState<Stage>(() => (params.view && !getRingState()?.ringing ? 'after' : 'ring'));
  const [now, setNow] = useState(() => Date.now());
  const [loud, setLoud] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const lastTouch = useRef(0);

  const trigger: NativeTrigger | null = state?.trigger ?? null;
  const itemId = trigger?.alarmId ?? params.view;
  const item: Item | undefined = items.find((i) => i.id === itemId);
  const ringing = !!state?.ringing;
  const isPre = trigger?.style === 'pre';

  const leave = useCallback(() => {
    releaseLockScreen(true);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  // Nothing ringing and nothing to show: go home.
  useEffect(() => {
    if (!ringing && !params.view && stage === 'ring') {
      releaseLockScreen(false);
      router.replace('/');
    }
  }, [ringing, params.view, stage]);

  // Clock + refresh while open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setState(getRingState());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  // Auto-snooze (10 minutes unanswered) while the screen is open.
  useEffect(
    () =>
      addRingEndListener((reason) => {
        if (reason === 'autoSnooze' || reason === 'snooze') {
          const st = getRingState();
          setState(st);
          setSnoozedUntil(st?.snoozedUntil ?? 0);
          setStage('snoozed');
        } else if (reason === 'timeout') {
          // A pre-alarm finished on its own after a minute.
          leave();
        }
      }),
    [leave],
  );

  // Repeating items start every occurrence with fresh task ticks.
  useEffect(() => {
    if (!item || !trigger || item.repeat === 'once') return;
    if (trigger.kind === 'pre' || item.tasksFor === trigger.occurrence) return;
    upsert({ ...item, tasksFor: trigger.occurrence, lines: item.lines.map((l) => ({ ...l, done: false })) });
    // once per ringing occurrence
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger?.id]);

  // The back button must not silence an alarm.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => stage === 'ring' || stage === 'mission');
    return () => sub.remove();
  }, [stage]);

  // During a mission the alarm is quiet; 10 idle seconds bring the full ring back.
  useEffect(() => {
    if (stage !== 'mission') return;
    setMissionMode(true);
    lastTouch.current = Date.now();
    const id = setInterval(() => {
      if (Date.now() - lastTouch.current > IDLE_MS) {
        setLoud((was) => {
          if (!was) setMissionMode(false);
          return true;
        });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [stage]);

  const interact = () => {
    lastTouch.current = Date.now();
    if (loud) {
      setLoud(false);
      setMissionMode(true);
    }
  };

  const onSnooze = () => {
    tick();
    if (snooze()) {
      const st = getRingState();
      setState(st);
      setSnoozedUntil(st?.snoozedUntil ?? Date.now() + (trigger?.snoozeMinutes ?? 10) * 60000);
      setStage('snoozed');
    }
  };

  const onStop = () => {
    tick();
    if (isPre) {
      stopRinging();
      leave();
      return;
    }
    if (item && item.mission.type !== 'none') {
      setLoud(false);
      setStage('mission');
    } else finishRinging();
  };

  const finishRinging = () => {
    stopRinging();
    success();
    setState(getRingState());
    setStage('after');
  };

  useEffect(() => {
    if (stage !== 'snoozed') return;
    const id = setTimeout(leave, 2200);
    return () => clearTimeout(id);
  }, [stage, leave]);

  const snoozesLeft = trigger ? Math.max(0, trigger.snoozeLimit - (state?.snoozeCount ?? 0)) : 0;
  const nowMin = minutesOf(new Date(now));
  const title = item ? titleOf(item) : (trigger?.title ?? 'Alarm');

  return (
    <View style={[s.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <StatusBar style="light" />
      {stage === 'ring' ? (
        <View style={s.flex}>
          <View style={s.top}>
            <T v="footMedium" c={DIM}>
              {isPre ? 'Pre-alarm' : item?.kind === 'reminder' ? 'Reminder' : 'Alarm'}
              {state && state.snoozeCount > 0 && !isPre ? ` · snoozed ${state.snoozeCount}×` : ''}
            </T>
          </View>
          <View style={s.center}>
            <PartIcon minutes={nowMin} size={34} c={color.yellow} />
            <View style={s.clockRow}>
              <T v="display" c={color.white} tabular style={s.clock}>
                {fmtClock(nowMin)}
              </T>
              <T v="headline" c={color.white} style={s.clockAmPm}>
                {amPm(nowMin)}
              </T>
            </View>
            <T v="title" c={color.white} style={s.title} numberOfLines={3}>
              {title}
            </T>
            <InfoLine trigger={trigger} item={item} now={now} />
            {item && taskCount(item).total > 0 ? (
              <View style={s.taskChip}>
                <Icon name="checkbox-marked-outline" size={16} c={color.white} />
                <T v="foot" c={color.white}>
                  {taskCount(item).total} {taskCount(item).total === 1 ? 'task' : 'tasks'} after you stop
                </T>
              </View>
            ) : null}
          </View>
          <View style={s.actions}>
            {!isPre && snoozesLeft > 0 ? (
              <Pressable
                onPress={onSnooze}
                style={({ pressed }) => [s.big, s.snooze, pressed && s.pressed]}
                accessibilityRole="button">
                <Icon name="alarm-snooze" size={22} c={color.white} />
                <T v="headline" c={color.white}>
                  Snooze {trigger?.snoozeMinutes ?? 10} min
                </T>
                <T v="foot" c={DIM}>
                  {snoozesLeft} left
                </T>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onStop}
              style={({ pressed }) => [s.big, s.stop, pressed && s.pressed]}
              accessibilityRole="button">
              {!isPre && item && item.mission.type !== 'none' ? (
                <Icon name={MISSION_ICONS[item.mission.type]} size={22} c={color.ink} />
              ) : null}
              <T v="headline" c={color.ink}>
                {isPre ? 'Dismiss' : 'Stop'}
              </T>
            </Pressable>
          </View>
        </View>
      ) : null}

      {stage === 'mission' && item ? (
        <View style={s.flex}>
          <View style={s.missionHead}>
            <T v="headline" c={color.white}>
              {loud ? 'Still there? Keep going' : 'Solve to stop'}
            </T>
            {snoozesLeft > 0 ? (
              <Pressable onPress={onSnooze} hitSlop={10} accessibilityRole="button">
                <T v="subMedium" c={color.yellow}>
                  Snooze
                </T>
              </Pressable>
            ) : null}
          </View>
          <MissionRunner mission={item.mission} onInteract={interact} onDone={finishRinging} />
        </View>
      ) : null}

      {stage === 'snoozed' ? (
        <View style={[s.flex, s.center]}>
          <Icon name="sleep" size={40} c={color.yellow} />
          <T v="title" c={color.white} style={s.title}>
            Snoozed
          </T>
          <T v="callout" c={DIM}>
            Rings again at {fmtTime(minutesOf(new Date(snoozedUntil || now)))}
          </T>
        </View>
      ) : null}

      {stage === 'after' ? (
        <AfterView
          item={item}
          fromRing={!params.view || !!trigger}
          onToggleTask={(id) => {
            if (!item) return;
            tick();
            setLines(
              item.id,
              item.lines.map((l) => (l.id === id ? { ...l, done: !l.done } : l)),
            );
          }}
          onDone={(occ) => {
            if (item) setDone(item.id, occ, true);
            success();
            leave();
          }}
          onClose={leave}
        />
      ) : null}
    </View>
  );
}

function InfoLine({ trigger, item, now }: { trigger: NativeTrigger | null; item?: Item; now: number }) {
  if (!trigger || !item) return null;
  const today = todayYmd(new Date(now));
  if (trigger.kind === 'pre') {
    const main = atTime(trigger.occurrence, item.time).getTime();
    return (
      <T v="callout" c={DIM} style={s.info}>
        {item.kind === 'alarm' ? 'Alarm' : 'Due'} at {fmtTime(item.time)} · in {fmtLeft(main - now)}
      </T>
    );
  }
  if (trigger.kind === 'window') {
    const past = trigger.occurrence < today;
    const days = diffDays(today, trigger.occurrence);
    return (
      <View style={s.infoCol}>
        <T v="callout" c={past ? '#FF8A8D' : DIM} style={s.info}>
          {past
            ? `Was due ${fmtDate(trigger.occurrence)}`
            : `Due ${fmtDate(trigger.occurrence)} · in ${days} ${days === 1 ? 'day' : 'days'}`}
        </T>
        {trigger.last ? (
          <T v="footMedium" c={color.yellow}>
            Last reminder
          </T>
        ) : null}
      </View>
    );
  }
  return (
    <T v="callout" c={DIM} style={s.info}>
      {fmtTime(item.time)}
    </T>
  );
}

function AfterView({
  item,
  fromRing,
  onToggleTask,
  onDone,
  onClose,
}: {
  item?: Item;
  fromRing: boolean;
  onToggleTask: (id: string) => void;
  onDone: (occurrence: string) => void;
  onClose: () => void;
}) {
  const occ = item ? currentOccurrence(item) : null;
  const canDone = !!item && tracksDone(item) && !!occ;
  const tasks = item ? item.lines.filter((l) => l.type === 'task' && l.text.trim()) : [];
  const notes = item ? item.lines.filter((l) => l.type === 'text' && l.text.trim()) : [];
  return (
    <View style={s.flex}>
      <View style={s.afterHead}>
        <Icon
          name={fromRing ? 'white-balance-sunny' : item?.kind === 'reminder' ? 'bell-outline' : 'alarm'}
          size={30}
          c={color.yellow}
        />
        <T v="title" c={color.white} style={s.title}>
          {item ? titleOf(item) : 'Done'}
        </T>
        {occ && item ? (
          <T v="callout" c={occ < todayYmd() ? '#FF8A8D' : DIM}>
            {occ < todayYmd() ? 'Was due' : 'Due'} {fmtDate(occ)} · {fmtTime(item.time)}
          </T>
        ) : null}
      </View>
      <ScrollView style={s.flex} contentContainerStyle={s.afterList}>
        {notes.map((l) => (
          <T key={l.id} v="callout" c={DIM}>
            {l.text}
          </T>
        ))}
        {tasks.map((l) => (
          <Pressable
            key={l.id}
            onPress={() => onToggleTask(l.id)}
            style={[s.task, l.level === 1 && s.subtask]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: l.done }}>
            <Checkbox checked={l.done} onPress={() => onToggleTask(l.id)} round />
            <T v="body" c={l.done ? DIM : color.white} style={[s.flex, l.done && s.strike]}>
              {l.text}
            </T>
          </Pressable>
        ))}
      </ScrollView>
      <View style={s.actions}>
        {canDone && occ ? (
          <Pressable
            onPress={() => onDone(occ)}
            style={({ pressed }) => [s.big, s.stop, pressed && s.pressed]}
            accessibilityRole="button">
            <Icon name="check" size={22} c={color.ink} />
            <T v="headline" c={color.ink}>
              Mark done
            </T>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [s.big, canDone ? s.snooze : s.stop, pressed && s.pressed]}
          accessibilityRole="button">
          <T v="headline" c={canDone ? color.white : color.ink}>
            Close
          </T>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.navy, paddingHorizontal: SIDE },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  top: { alignItems: 'center', minHeight: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  clockRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  clock: { fontSize: 88, lineHeight: 96 },
  clockAmPm: { marginBottom: 16 },
  title: { textAlign: 'center', marginTop: 8 },
  info: { textAlign: 'center' },
  infoCol: { alignItems: 'center', gap: 4 },
  taskChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  actions: { gap: 12 },
  big: { height: 64, borderRadius: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  snooze: { backgroundColor: 'rgba(255,255,255,0.14)' },
  stop: { backgroundColor: color.yellow },
  missionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4 },
  afterHead: { alignItems: 'center', gap: 4, paddingTop: 24, paddingBottom: 16 },
  afterList: { gap: 10, paddingBottom: 16 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  subtask: { paddingLeft: 30 },
  strike: { textDecorationLine: 'line-through' },
});
