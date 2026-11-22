import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Permissions, RingState } from '../../modules/celestial-alarm';
import { TasksView } from '../home/TasksView';
import { minutesOf, ymd } from '../lib/dates';
import { cancelSnooze, getMissed, getPermissions, getRingState, hasEngine } from '../lib/engine';
import { amPm, fmtClock, fmtDate, fmtDay, fmtLeft, fmtTime, repeatLabel } from '../lib/format';
import { bump, success } from '../lib/haptics';
import {
  currentOccurrence,
  listEntries,
  nextRing,
  preOffsets,
  taskCount,
  titleOf,
  type Group,
  type ListEntry,
} from '../lib/schedule';
import { useStore, useUi } from '../lib/store';
import { taskEntries } from '../lib/tasks';
import type { Kind } from '../lib/types';
import { Button, Chip, Switch } from '../ui/controls';
import { Icon, MISSION_ICONS, PartIcon } from '../ui/Icon';
import { PopupMenu, useAnchor } from '../ui/popups';
import { Segmented } from '../ui/Segmented';
import { T } from '../ui/Text';
import { accentFor, color, SIDE } from '../ui/theme';

const GROUP_TITLES: Record<Group, string> = {
  notdone: 'Not done',
  today: 'Today',
  tomorrow: 'Tomorrow',
  later: 'Later',
  off: 'Off',
};

type Filter = 'all' | 'alarm' | 'reminder' | `tag:${string}`;
type Page = 'alarms' | 'tasks';

export default function Home() {
  const insets = useSafeAreaInsets();
  const items = useStore((s) => s.items);
  const tags = useStore((s) => s.tags);
  const setEnabled = useStore((s) => s.setEnabled);
  const setDone = useStore((s) => s.setDone);
  const showToast = useUi((s) => s.showToast);
  const updateReady = useUi((s) => s.updateReady);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState<Page>('alarms');
  const addMenu = useAnchor<'add'>();
  const [now, setNow] = useState(() => Date.now());
  const [ring, setRing] = useState<RingState | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [missed, setMissed] = useState<Record<string, number>>({});

  const refresh = useCallback(() => {
    setNow(Date.now());
    setRing(getRingState());
    setPerms(getPermissions());
    const m: Record<string, number> = {};
    for (const x of getMissed()) {
      if (Date.now() - x.at < 24 * 3600e3) m[x.alarmId] = Math.max(m[x.alarmId] ?? 0, x.at);
    }
    setMissed(m);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const id = setInterval(refresh, 30000);
      return () => clearInterval(id);
    }, [refresh]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const filtered = useMemo(
    () =>
      items.filter((i) => {
        if (filter === 'all') return true;
        if (filter === 'alarm' || filter === 'reminder') return i.kind === filter;
        return i.tagId === filter.slice(4);
      }),
    [items, filter],
  );
  const entries = useMemo(() => listEntries(filtered, new Date(now)), [filtered, now]);
  const tasks = useMemo(() => (page === 'tasks' ? taskEntries(filtered, new Date(now)) : []), [filtered, now, page]);
  const groups = useMemo(() => {
    const out: { group: Group; list: ListEntry[] }[] = [];
    for (const e of entries) {
      const last = out[out.length - 1];
      if (last && last.group === e.group) last.list.push(e);
      else out.push({ group: e.group, list: [e] });
    }
    return out;
  }, [entries]);

  const missing = perms ? [!perms.notifications, !perms.fullScreen, !perms.exactAlarms].filter(Boolean).length : 0;

  const markDone = (e: ListEntry) => {
    if (!e.overdue) return;
    const occ = e.overdue;
    setDone(e.item.id, occ, true);
    success();
    showToast(`Marked done · ${titleOf(e.item)}`, () => setDone(e.item.id, occ, false));
  };

  /** Switching on shows when it will ring, so a one-time alarm moving to tomorrow is never a surprise. */
  const toggle = (id: string, on: boolean) => {
    setEnabled(id, on);
    if (!on) {
      cancelSnooze(id);
      return;
    }
    const item = useStore.getState().items.find((i) => i.id === id);
    if (!item) return;
    const word = item.kind === 'alarm' ? 'Alarm' : 'Reminder';
    const next = nextRing(item);
    showToast(next ? `${word} on · ${fmtDay(ymd(next.at))} · ${fmtTime(minutesOf(next.at))}` : `${word} on`);
  };

  const create = (kind: Kind) => router.push({ pathname: '/edit', params: { kind } });

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={s.brand}>
          <Image source={require('../../assets/images/mark.png')} style={s.mark} contentFit="contain" />
          <T v="title">Celestial</T>
        </View>
        <Pressable
          onPress={() => router.push('/setup')}
          hitSlop={10}
          accessibilityLabel="Settings and test"
          style={s.iconBtn}>
          <Icon name="cog-outline" size={24} c={color.ink2} />
        </Pressable>
      </View>

      <View style={s.switchWrap}>
        <Segmented
          options={[
            { key: 'alarms', label: 'Alarms' },
            { key: 'tasks', label: 'Tasks' },
          ]}
          value={page}
          onChange={setPage}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.filtersScroll}
        contentContainerStyle={s.filters}>
        <Chip small label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip small label="Alarms" icon="alarm" selected={filter === 'alarm'} onPress={() => setFilter('alarm')} />
        <Chip
          small
          label="Reminders"
          icon="bell-outline"
          selected={filter === 'reminder'}
          onPress={() => setFilter('reminder')}
        />
        {tags.map((t) => (
          <Chip
            key={t.id}
            small
            label={t.name}
            dot={t.color}
            selected={filter === `tag:${t.id}`}
            onPress={() => setFilter(filter === `tag:${t.id}` ? 'all' : `tag:${t.id}`)}
          />
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}>
        {hasEngine && missing > 0 ? (
          <Pressable style={s.notice} onPress={() => router.push('/setup')} accessibilityRole="button">
            <Icon name="alarm-check" size={22} c={color.ink} />
            <View style={s.noticeText}>
              <T v="subMedium">
                {missing === 1 ? '1 setting is' : `${missing} settings are`} needed so alarms can ring
              </T>
              <T v="foot" c={color.ink2}>
                Tap to fix it in a few seconds
              </T>
            </View>
            <Icon name="chevron-right" size={22} c={color.ink2} />
          </Pressable>
        ) : null}

        {updateReady ? (
          <View style={s.notice}>
            <Icon name="star-four-points-outline" size={22} c={color.ink} />
            <View style={s.noticeText}>
              <T v="subMedium">A new version is ready</T>
              <T v="foot" c={color.ink2}>
                Restart to use it
              </T>
            </View>
            <Button
              label="Restart"
              kind="secondary"
              style={s.restart}
              onPress={() => Updates.reloadAsync().catch(() => {})}
            />
          </View>
        ) : null}

        {page === 'tasks' ? <TasksView entries={tasks} /> : null}

        {page === 'alarms' && items.length === 0 ? (
          <View style={s.empty}>
            <Image source={require('../../assets/images/mark.png')} style={s.emptyMark} contentFit="contain" />
            <T v="headline">No alarms yet</T>
            <T v="sub" c={color.ink2} style={s.emptyText}>
              Set one with pre-alarms, or a reminder with daily nudges before it’s due.
            </T>
            <Button label="New alarm" icon="plus" onPress={() => create('alarm')} style={s.emptyBtn} />
          </View>
        ) : null}

        {(page === 'alarms' ? groups : []).map(({ group, list }) => (
          <View key={group}>
            <T v="footMedium" c={group === 'notdone' ? color.red : color.ink2} style={s.groupTitle}>
              {GROUP_TITLES[group]}
            </T>
            {list.map((e) => (
              <AlarmRow
                key={e.item.id}
                entry={e}
                now={now}
                tagColor={tags.find((t) => t.id === e.item.tagId)?.color}
                snoozedUntil={
                  ring?.snoozed && ring.trigger?.alarmId === e.item.id
                    ? ring.snoozedUntil
                    : ring?.ringing && ring.trigger?.alarmId === e.item.id
                      ? -1
                      : 0
                }
                missedAt={missed[e.item.id]}
                onToggle={(on) => toggle(e.item.id, on)}
                onDone={() => markDone(e)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      <Pressable
        ref={addMenu.ref('add')}
        onPress={() => {
          bump();
          addMenu.show('add');
        }}
        accessibilityLabel="New alarm or reminder"
        accessibilityRole="button"
        style={({ pressed }) => [s.fab, { bottom: insets.bottom + 20 }, pressed && s.fabPressed]}>
        <Icon name="plus" size={30} c={color.ink} />
      </Pressable>
      <PopupMenu
        anchor={addMenu.rectFor('add')}
        plain
        width={210}
        options={[
          { key: 'alarm', label: 'Alarm', icon: 'alarm' },
          { key: 'reminder', label: 'Reminder', icon: 'bell-outline', iconColor: color.blue },
        ]}
        onSelect={(k) => create(k as Kind)}
        onClose={addMenu.close}
      />
    </View>
  );
}

function AlarmRow({
  entry,
  now,
  tagColor,
  snoozedUntil,
  missedAt,
  onToggle,
  onDone,
}: {
  entry: ListEntry;
  now: number;
  tagColor?: string;
  /** >0 snoozed until; -1 ringing now; 0 neither */
  snoozedUntil: number;
  missedAt?: number;
  onToggle: (on: boolean) => void;
  onDone: () => void;
}) {
  const { item, group, next, overdue } = entry;
  const off = group === 'off';
  const reminder = item.kind === 'reminder';
  const accent = accentFor(item.kind);
  const pre = preOffsets(item).length;
  const tasks = taskCount(item, currentOccurrence(item));
  const ink = off ? color.ink3 : color.ink;
  const sub = off ? color.ink3 : color.ink2;
  const nextDay = next ? ymd(next.at) : null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/edit', params: { id: item.id } })}
      style={({ pressed }) => [s.row, reminder && s.rowReminder, pressed && s.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${titleOf(item)}, ${fmtTime(item.time)}`}>
      <View style={[s.tagBar, { backgroundColor: tagColor ?? 'transparent' }]} />
      <View style={s.rowMain}>
        <View style={s.line1}>
          <PartIcon minutes={item.time} size={20} c={off ? color.ink3 : undefined} />
          <T v="big" c={ink} tabular style={s.time}>
            {fmtClock(item.time)}
          </T>
          <T v="subMedium" c={ink} style={s.ampm}>
            {amPm(item.time)}
          </T>
          <View style={s.flex} />
          {snoozedUntil === -1 ? (
            <View style={s.left}>
              <Icon name="bell-ring-outline" size={16} c={color.red} />
              <T v="foot" c={color.red}>
                Ringing
              </T>
            </View>
          ) : snoozedUntil > 0 ? (
            <View style={s.left}>
              <Icon name="sleep" size={16} c={color.ink2} />
              <T v="foot" c={color.ink2}>
                {fmtTime(new Date(snoozedUntil).getHours() * 60 + new Date(snoozedUntil).getMinutes())}
              </T>
            </View>
          ) : next && !off ? (
            <View style={s.left}>
              <Icon name="timer-sand" size={15} c={color.ink2} />
              <T v="foot" c={color.ink2} tabular>
                {fmtLeft(next.at.getTime() - now)}
              </T>
            </View>
          ) : null}
          <Switch
            value={item.enabled && !off}
            onChange={onToggle}
            label={`${titleOf(item)} on`}
            accent={accent.main}
          />
        </View>
        <View style={s.line2}>
          {reminder ? <Icon name="bell-outline" size={16} c={off ? sub : color.blue} /> : null}
          <T v="callout" c={ink} numberOfLines={1} style={s.flexShrink}>
            {titleOf(item)}
          </T>
        </View>
        <View style={s.meta}>
          {pre > 0 ? (
            <View style={s.metaItem}>
              {Array.from({ length: Math.min(pre, 6) }, (_, i) => (
                <View key={i} style={[s.preDot, off && s.preDotOff]} />
              ))}
            </View>
          ) : null}
          {item.repeat !== 'once' ? (
            <View style={s.metaItem}>
              <Icon name="repeat" size={14} c={sub} />
              <T v="cap" c={sub} numberOfLines={1}>
                {repeatLabel(item)}
              </T>
            </View>
          ) : null}
          {group === 'later' && nextDay ? (
            <View style={s.metaItem}>
              <Icon name="calendar-blank-outline" size={14} c={sub} />
              <T v="cap" c={sub}>
                {fmtDate(nextDay)}
              </T>
            </View>
          ) : null}
          {item.mission.type !== 'none' && (item.kind === 'alarm' || item.ringLikeAlarm) ? (
            <View style={s.metaItem}>
              <Icon name={MISSION_ICONS[item.mission.type]} size={14} c={sub} />
              <T v="cap" c={sub}>
                ×{item.mission.rounds}
              </T>
            </View>
          ) : null}
          {tasks.total > 0 ? (
            <View style={s.metaItem}>
              <Icon name="checkbox-marked-outline" size={14} c={sub} />
              <T v="cap" c={sub} tabular>
                {tasks.done}/{tasks.total}
              </T>
            </View>
          ) : null}
          {missedAt ? (
            <View style={s.metaItem}>
              <Icon name="alert-circle-outline" size={14} c={color.red} />
              <T v="cap" c={color.red}>
                Missed {fmtTime(new Date(missedAt).getHours() * 60 + new Date(missedAt).getMinutes())}
              </T>
            </View>
          ) : null}
          {overdue ? (
            <View style={s.metaItem}>
              <T v="cap" c={color.red}>
                Due {fmtDate(overdue)}
              </T>
            </View>
          ) : null}
        </View>
        {overdue ? (
          <Pressable
            onPress={onDone}
            style={({ pressed }) => [s.donePill, { backgroundColor: accent.main }, pressed && s.pressed]}
            accessibilityRole="button">
            <Icon name="check" size={16} c={accent.on} />
            <T v="footMedium" c={accent.on}>
              Mark done
            </T>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
  header: {
    height: 60,
    paddingHorizontal: SIDE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mark: { width: 34, height: 34 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  switchWrap: { paddingHorizontal: SIDE, paddingBottom: 10 },
  fab: {
    position: 'absolute',
    right: SIDE,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#1D1B3A',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  fabPressed: { transform: [{ scale: 0.94 }] },
  filtersScroll: { flexGrow: 0 },
  filters: { paddingHorizontal: SIDE, gap: 8, paddingBottom: 10 },
  notice: {
    marginHorizontal: SIDE,
    marginTop: 6,
    marginBottom: 4,
    padding: 14,
    borderRadius: 16,
    backgroundColor: color.yellowSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  noticeText: { flex: 1, gap: 2 },
  restart: { height: 38, paddingHorizontal: 14 },
  empty: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 72, gap: 8 },
  emptyMark: { width: 72, height: 72, opacity: 0.9, marginBottom: 8 },
  emptyText: { textAlign: 'center' },
  emptyBtn: { marginTop: 16, alignSelf: 'stretch' },
  groupTitle: { paddingHorizontal: SIDE, paddingTop: 18, paddingBottom: 6 },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  rowReminder: { backgroundColor: color.blueRow },
  rowPressed: { backgroundColor: color.fill },
  tagBar: { width: 4, marginVertical: 10, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  rowMain: { flex: 1, paddingLeft: SIDE - 4, paddingRight: SIDE, paddingVertical: 12, gap: 2 },
  line1: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { marginLeft: 2 },
  ampm: { marginTop: 8 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 10 },
  line2: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  preDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.navy },
  preDotOff: { backgroundColor: color.ink3 },
  donePill: {
    alignSelf: 'flex-start',
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
  },
});
