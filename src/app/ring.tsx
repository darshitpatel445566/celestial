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
  updateShownTasks,
} from '../lib/engine';
import { amPm, fmtClock, fmtDate, fmtLeft, fmtTime } from '../lib/format';
import { success, tick } from '../lib/haptics';
import { currentOccurrence, tasksOf, titleOf, tracksDone } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { Item, Line } from '../lib/types';
import { MissionRunner } from '../missions/Missions';
import { Checkbox } from '../ui/controls';
import { Icon, MISSION_ICONS, PartIcon } from '../ui/Icon';
import { SlideToConfirm } from '../ui/SlideToConfirm';
import { T } from '../ui/Text';
import { color, SIDE, type Accent } from '../ui/theme';

type Stage = 'ring' | 'tasks' | 'mission' | 'after' | 'snoozed';

/** Web preview only: pretend a saved item is ringing ("main", "pre:<id>"…), to check the design without a phone. */
function webDemoState(param?: string): RingState | null {
  if (Platform.OS !== 'web' || !param) return null;
  const [demo, id] = param.split(':');
  const items = useStore.getState().items;
  const item = (id && items.find((i) => i.id === id)) || items[0];
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
      itemKind: item.kind,
    },
  };
}

const DIM = 'rgba(255,255,255,0.66)';
/** Quiet while solving a mission; the full ring returns after this long without a touch. */
const MISSION_IDLE_MS = 10_000;
/** Quiet while reading the tasks; the full ring returns after a minute without a touch. */
const TASKS_IDLE_MS = 60_000;

type Look = { bg: string; accent: Accent };

const ALARM_LOOK: Look = { bg: color.navy, accent: { main: color.yellow, soft: color.yellowSoft, on: color.ink } };
const REMINDER_LOOK: Look = {
  bg: color.blueNight,
  accent: { main: color.white, soft: 'rgba(255,255,255,0.2)', on: color.blueNight },
};

/** Opens over the lock screen while an alarm rings. Also shows an item from a reminder notification. */
export default function RingScreen() {
  const params = useLocalSearchParams<{ view?: string; demo?: string }>();
  const insets = useSafeAreaInsets();
  const items = useStore((s) => s.items);
  const toggleTask = useStore((s) => s.toggleTask);
  const setDone = useStore((s) => s.setDone);

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
  const look = (item?.kind ?? trigger?.itemKind) === 'reminder' ? REMINDER_LOOK : ALARM_LOOK;
  const occurrence = trigger?.occurrence ?? (item ? currentOccurrence(item) : null);
  const tasks = item ? tasksOf(item, occurrence) : [];
  const hasMission = !isPre && !!item && item.mission.type !== 'none';

  const leave = useCallback(() => {
    releaseLockScreen(true);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  // Nothing ringing and nothing to show: go home.
  useEffect(() => {
    if (!ringing && !params.view && (stage === 'ring' || stage === 'tasks')) {
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

  // The back button must not silence an alarm.
  useEffect(() => {
    const sub = BackHandler.addEventListener(
      'hardwareBackPress',
      () => stage === 'ring' || stage === 'tasks' || stage === 'mission',
    );
    return () => sub.remove();
  }, [stage]);

  // Mission or task list: the alarm goes quiet; without a touch for a while it rings fully again.
  useEffect(() => {
    if (stage !== 'mission' && stage !== 'tasks') return;
    const idle = stage === 'mission' ? MISSION_IDLE_MS : TASKS_IDLE_MS;
    setMissionMode(true);
    lastTouch.current = Date.now();
    const id = setInterval(() => {
      if (Date.now() - lastTouch.current > idle) {
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

  const finishRinging = () => {
    stopRinging();
    success();
    setState(getRingState());
    setStage('after');
  };

  const onSlide = () => {
    if (isPre) {
      stopRinging();
      leave();
      return;
    }
    if (hasMission) {
      setLoud(false);
      setStage('mission');
    } else finishRinging();
  };

  const onToggleTask = (lineId: string) => {
    if (!item) return;
    tick();
    toggleTask(item.id, lineId, occurrence);
    const updated = useStore.getState().items.find((i) => i.id === item.id);
    if (updated) updateShownTasks(updated);
  };

  useEffect(() => {
    if (stage !== 'snoozed') return;
    const id = setTimeout(leave, 2200);
    return () => clearTimeout(id);
  }, [stage, leave]);

  const snoozesLeft = trigger ? Math.max(0, trigger.snoozeLimit - (state?.snoozeCount ?? 0)) : 0;
  const nowMin = minutesOf(new Date(now));
  const title = item ? titleOf(item) : (trigger?.title ?? 'Alarm');
  const canSnooze = !isPre && snoozesLeft > 0;

  const actions = (
    <View style={s.actions}>
      {canSnooze ? (
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
      <SlideToConfirm
        label={isPre ? 'Slide to dismiss' : 'Slide to stop'}
        onConfirm={onSlide}
        knob={look.accent.main}
        iconColor={look.accent.on}
        knobIcon={hasMission && item ? MISSION_ICONS[item.mission.type as 'maths' | 'tiles' | 'typing'] : 'chevron-double-right'}
      />
    </View>
  );

  return (
    <View
      style={[s.root, { backgroundColor: look.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
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
            <PartIcon minutes={nowMin} size={34} c={look.accent.main} />
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
            <InfoLine trigger={trigger} item={item} now={now} accent={look.accent.main} />
            {tasks.length > 0 ? (
              <Pressable
                onPress={() => {
                  tick();
                  setStage('tasks');
                }}
                style={({ pressed }) => [s.viewTasks, pressed && s.pressed]}
                accessibilityRole="button"
                accessibilityHint="Quiets the alarm while you read">
                <Icon name="format-list-checks" size={18} c={color.white} />
                <T v="subMedium" c={color.white}>
                  View {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                </T>
              </Pressable>
            ) : null}
          </View>
          {actions}
        </View>
      ) : null}

      {stage === 'tasks' ? (
        <View style={s.flex} onTouchStart={interact}>
          <View style={s.tasksHead}>
            <T v="title" c={color.white} numberOfLines={2}>
              {title}
            </T>
            <T v="callout" c={DIM}>
              {fmtTime(nowMin)}
              {loud ? ' · ringing' : ' · quiet while you read'}
            </T>
          </View>
          <ScrollView style={s.flex} contentContainerStyle={s.afterList}>
            <TaskList tasks={tasks} item={item} accent={look.accent} onToggle={onToggleTask} />
          </ScrollView>
          {actions}
        </View>
      ) : null}

      {stage === 'mission' && item ? (
        <View style={s.flex} onTouchStart={interact}>
          <View style={s.missionHead}>
            <T v="headline" c={color.white}>
              {loud ? 'Still there? Keep going' : 'Solve to stop'}
            </T>
            {snoozesLeft > 0 ? (
              <Pressable onPress={onSnooze} hitSlop={10} accessibilityRole="button">
                <T v="subMedium" c={look.accent.main}>
                  Snooze
                </T>
              </Pressable>
            ) : null}
          </View>
          <MissionRunner
            mission={item.mission}
            accent={look.accent.main}
            onInteract={interact}
            onDone={finishRinging}
          />
        </View>
      ) : null}

      {stage === 'snoozed' ? (
        <View style={[s.flex, s.center]}>
          <Icon name="sleep" size={40} c={look.accent.main} />
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
          tasks={tasks}
          accent={look.accent}
          fromRing={!params.view || !!trigger}
          onToggleTask={onToggleTask}
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

function InfoLine({
  trigger,
  item,
  now,
  accent,
}: {
  trigger: NativeTrigger | null;
  item?: Item;
  now: number;
  accent: string;
}) {
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
        <T v="callout" c={past ? '#FF9EA1' : DIM} style={s.info}>
          {past
            ? `Was due ${fmtDate(trigger.occurrence)}`
            : `Due ${fmtDate(trigger.occurrence)} · in ${days} ${days === 1 ? 'day' : 'days'}`}
        </T>
        {trigger.last ? (
          <T v="footMedium" c={accent}>
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

function TaskList({
  tasks,
  item,
  accent,
  onToggle,
}: {
  tasks: Line[];
  item?: Item;
  accent: Accent;
  onToggle: (id: string) => void;
}) {
  const notes = item ? item.lines.filter((l) => l.type === 'text' && l.text.trim()) : [];
  return (
    <>
      {notes.map((l) => (
        <T key={l.id} v="callout" c={DIM}>
          {l.text}
        </T>
      ))}
      {tasks.map((l) => (
        <Pressable
          key={l.id}
          onPress={() => onToggle(l.id)}
          style={[s.task, l.level === 1 && s.subtask]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: l.done }}>
          <Checkbox checked={l.done} onPress={() => onToggle(l.id)} round accent={accent} />
          <T v="body" c={l.done ? DIM : color.white} style={[s.flex, l.done && s.strike]}>
            {l.text}
          </T>
        </Pressable>
      ))}
    </>
  );
}

function AfterView({
  item,
  tasks,
  accent,
  fromRing,
  onToggleTask,
  onDone,
  onClose,
}: {
  item?: Item;
  tasks: Line[];
  accent: Accent;
  fromRing: boolean;
  onToggleTask: (id: string) => void;
  onDone: (occurrence: string) => void;
  onClose: () => void;
}) {
  const occ = item ? currentOccurrence(item) : null;
  const canDone = !!item && tracksDone(item) && !!occ;
  return (
    <View style={s.flex}>
      <View style={s.afterHead}>
        <Icon
          name={fromRing ? 'white-balance-sunny' : item?.kind === 'reminder' ? 'bell-outline' : 'alarm'}
          size={30}
          c={accent.main}
        />
        <T v="title" c={color.white} style={s.title}>
          {item ? titleOf(item) : 'Done'}
        </T>
        {occ && item ? (
          <T v="callout" c={occ < todayYmd() ? '#FF9EA1' : DIM}>
            {occ < todayYmd() ? 'Was due' : 'Due'} {fmtDate(occ)} · {fmtTime(item.time)}
          </T>
        ) : null}
      </View>
      <ScrollView style={s.flex} contentContainerStyle={s.afterList}>
        <TaskList tasks={tasks} item={item} accent={accent} onToggle={onToggleTask} />
      </ScrollView>
      <View style={s.actions}>
        {canDone && occ ? (
          <Pressable
            onPress={() => onDone(occ)}
            style={({ pressed }) => [s.big, { backgroundColor: accent.main }, pressed && s.pressed]}
            accessibilityRole="button">
            <Icon name="check" size={22} c={accent.on} />
            <T v="headline" c={accent.on}>
              Mark done
            </T>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [s.big, canDone ? s.snooze : { backgroundColor: accent.main }, pressed && s.pressed]}
          accessibilityRole="button">
          <T v="headline" c={canDone ? color.white : accent.on}>
            Close
          </T>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: SIDE },
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
  viewTasks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  actions: { gap: 12 },
  big: { height: 64, borderRadius: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  snooze: { backgroundColor: 'rgba(255,255,255,0.14)' },
  missionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4 },
  tasksHead: { gap: 4, paddingTop: 12, paddingBottom: 12 },
  afterHead: { alignItems: 'center', gap: 4, paddingTop: 24, paddingBottom: 16 },
  afterList: { gap: 10, paddingBottom: 16 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  subtask: { paddingLeft: 30 },
  strike: { textDecorationLine: 'line-through' },
});
