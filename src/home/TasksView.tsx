import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { updateShownTasks } from '../lib/engine';
import { fmtDay, fmtTime } from '../lib/format';
import { tick } from '../lib/haptics';
import { titleOf } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { TaskEntry, TaskGroup } from '../lib/tasks';
import { Checkbox } from '../ui/controls';
import { ENERGY_ICONS, Icon } from '../ui/Icon';
import { T } from '../ui/Text';
import { accentFor, color, SIDE } from '../ui/theme';

const TITLES: Record<TaskGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  later: 'Later',
  done: 'Done',
};

const move = LinearTransition.duration(220);

/** Every task from every alarm and reminder in one place; ticked ones sink to Done. */
export function TasksView({ entries }: { entries: TaskEntry[] }) {
  const toggleTask = useStore((s) => s.toggleTask);

  const toggle = (e: TaskEntry) => {
    tick();
    toggleTask(e.item.id, e.line.id, e.occurrence);
    const updated = useStore.getState().items.find((i) => i.id === e.item.id);
    if (updated) updateShownTasks(updated);
  };

  if (entries.length === 0) {
    return (
      <View style={s.empty}>
        <Icon name="checkbox-marked-circle-outline" size={44} c={color.ink3} />
        <T v="headline">No tasks yet</T>
        <T v="sub" c={color.ink2} style={s.emptyText}>
          Start a line with “- ” in an alarm or reminder’s description to make it a task. They all show up here.
        </T>
      </View>
    );
  }

  const rows: ReactNode[] = [];
  let prev: TaskEntry | null = null;
  for (const e of entries) {
    if (!prev || prev.group !== e.group) {
      rows.push(
        <Animated.View key={`h-${e.group}`} layout={move} entering={FadeIn} exiting={FadeOut}>
          <T v="footMedium" c={e.group === 'overdue' ? color.red : color.ink2} style={s.groupTitle}>
            {TITLES[e.group]}
          </T>
        </Animated.View>,
      );
    }
    // A subtask right under its own task doesn't repeat the item details.
    const showMeta = e.line.level === 0 || !prev || prev.item.id !== e.item.id || prev.group !== e.group;
    rows.push(
      <Animated.View key={e.key} layout={move} entering={FadeIn} exiting={FadeOut}>
        <TaskRow entry={e} showMeta={showMeta} onToggle={() => toggle(e)} />
      </Animated.View>,
    );
    prev = e;
  }
  return <View>{rows}</View>;
}

function TaskRow({ entry, showMeta, onToggle }: { entry: TaskEntry; showMeta: boolean; onToggle: () => void }) {
  const { item, line, day, group } = entry;
  const done = line.done;
  const accent = accentFor(item.kind);
  const sub = done ? color.ink3 : color.ink2;
  const when = day ? `${fmtDay(day)} · ${fmtTime(item.time)}` : 'Off';
  return (
    <View style={[s.row, line.level === 1 && s.subRow]}>
      <View style={s.box}>
        <Checkbox checked={done} onPress={onToggle} size={22} round accent={accent} />
      </View>
      <View style={s.main}>
        <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked: done }}>
          <T v="body" c={done ? color.ink3 : color.ink} style={done && s.strike}>
            {line.text}
          </T>
        </Pressable>
        {showMeta ? (
          <Pressable
            onPress={() => router.push({ pathname: '/edit', params: { id: item.id } })}
            hitSlop={6}
            accessibilityRole="link"
            accessibilityLabel={`Open ${titleOf(item)}`}
            style={s.meta}>
            {item.kind === 'reminder' ? <Icon name="bell-outline" size={13} c={done ? sub : color.blue} /> : null}
            <T v="foot" c={sub} numberOfLines={1} style={s.itemName}>
              {titleOf(item)}
            </T>
            <T v="foot" c={group === 'overdue' && !done ? color.red : sub} tabular>
              · {when}
            </T>
            {item.energy !== null ? (
              <Icon name={ENERGY_ICONS[item.energy]} size={15} c={sub} style={s.battery} />
            ) : null}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  groupTitle: { paddingHorizontal: SIDE, paddingTop: 18, paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: SIDE,
    paddingRight: SIDE,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  subRow: { paddingLeft: SIDE + 32 },
  box: { paddingTop: 1, paddingRight: 12 },
  main: { flex: 1, gap: 3 },
  strike: { textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemName: { flexShrink: 1 },
  battery: { transform: [{ rotate: '90deg' }], marginLeft: 2 },
  empty: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 72, gap: 8 },
  emptyText: { textAlign: 'center' },
});
