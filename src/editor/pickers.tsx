import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { daysInMonth, pad, today as todayYmd } from '../lib/dates';
import { TAG_COLORS } from '../lib/defaults';
import { MONTHS_LONG } from '../lib/format';
import { tick } from '../lib/haptics';
import { useStore } from '../lib/store';
import type { Energy, Tag } from '../lib/types';
import { Button, Chip, ChipWrap, Sheet, styles as ui } from '../ui/controls';
import { ENERGY_ICONS, Icon } from '../ui/Icon';
import { T } from '../ui/Text';
import { color, font } from '../ui/theme';

/** Inline month calendar. Monday first, past days greyed out. */
export function Calendar({ value, onChange, min }: { value: string; onChange: (day: string) => void; min?: string }) {
  const [month, setMonth] = useState(() => value.slice(0, 7));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    // A new date was picked from outside: show its month.
    setShown(value);
    setMonth(value.slice(0, 7));
  }
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = daysInMonth(y, m - 1);
  const today = todayYmd();
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  return (
    <View style={s.cal}>
      <View style={s.calHead}>
        <Pressable onPress={() => shift(-1)} hitSlop={12} accessibilityLabel="Previous month">
          <Icon name="chevron-left" size={26} c={color.ink2} />
        </Pressable>
        <T v="headline">
          {MONTHS_LONG[m - 1]} {y}
        </T>
        <Pressable onPress={() => shift(1)} hitSlop={12} accessibilityLabel="Next month">
          <Icon name="chevron-right" size={26} c={color.ink2} />
        </Pressable>
      </View>
      <View style={s.calRow}>
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <T key={d} v="cap" c={color.ink3} style={s.calCellText}>
            {d}
          </T>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={s.calRow}>
          {cells.slice(r * 7, r * 7 + 7).map((day, i) => {
            if (!day) return <View key={i} style={s.calCell} />;
            const past = !!min && day < min;
            const selected = day === value;
            return (
              <Pressable
                key={day}
                disabled={past}
                onPress={() => {
                  tick();
                  onChange(day);
                }}
                accessibilityLabel={day}
                style={s.calCell}>
                <View style={[s.calDay, selected && s.calDayOn, day === today && !selected && s.calToday]}>
                  <T v={selected ? 'subMedium' : 'sub'} c={past ? color.ink3 : color.ink}>
                    {Number(day.slice(8))}
                  </T>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const ITEM = 48;

/** Horizontal number wheel: scroll or tap; the centred number is chosen. */
export function NumberWheel({
  values,
  value,
  onChange,
  format,
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const list = useRef<FlatList<number>>(null);
  const index = Math.max(0, values.indexOf(value));
  const [live, setLive] = useState(index);
  const [seen, setSeen] = useState(index);
  if (seen !== index) {
    setSeen(index);
    setLive(index);
  }
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  useEffect(() => {
    if (width) list.current?.scrollToOffset({ offset: index * ITEM, animated: false });
    // only after the first measurement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(values.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / ITEM)));
    if (values[i] !== value) onChange(values[i]);
  };
  const step = (d: number) => {
    const i = Math.min(values.length - 1, Math.max(0, index + d));
    tick();
    onChange(values[i]);
    list.current?.scrollToOffset({ offset: i * ITEM, animated: true });
  };
  const padSide = Math.max(0, (width - ITEM) / 2);
  return (
    <View style={s.wheel}>
      <Pressable onPress={() => step(-1)} hitSlop={8} accessibilityLabel="Less" style={s.wheelArrow}>
        <Icon name="chevron-left" size={24} c={color.ink3} />
      </Pressable>
      <View style={s.wheelWindow} onLayout={onLayout}>
        {width ? <View pointerEvents="none" style={[s.wheelPill, { left: padSide }]} /> : null}
        {width ? (
          <FlatList
            ref={list}
            horizontal
            data={values}
            keyExtractor={(v) => String(v)}
            showsHorizontalScrollIndicator={false}
            snapToInterval={ITEM}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: padSide }}
            getItemLayout={(_, i) => ({ length: ITEM, offset: ITEM * i, index: i })}
            onScroll={(e) => {
              const i = Math.round(e.nativeEvent.contentOffset.x / ITEM);
              if (i !== live) {
                setLive(i);
                tick();
              }
            }}
            scrollEventThrottle={32}
            onMomentumScrollEnd={settle}
            onScrollEndDrag={(e) => {
              if (!e.nativeEvent.velocity || Math.abs(e.nativeEvent.velocity.x) < 0.05) settle(e);
            }}
            renderItem={({ item, index: i }) => (
              <Pressable
                style={s.wheelItem}
                onPress={() => {
                  tick();
                  onChange(item);
                  list.current?.scrollToOffset({ offset: i * ITEM, animated: true });
                }}>
                <T v={i === live ? 'headline' : 'callout'} c={i === live ? color.ink : color.ink3} tabular>
                  {format ? format(item) : item}
                </T>
              </Pressable>
            )}
          />
        ) : null}
      </View>
      <Pressable onPress={() => step(1)} hitSlop={8} accessibilityLabel="More" style={s.wheelArrow}>
        <Icon name="chevron-right" size={24} c={color.ink3} />
      </Pressable>
    </View>
  );
}

/** Four battery icons, no words. Tap again to clear. */
export function EnergyPicker({ value, onChange }: { value: Energy; onChange: (e: Energy) => void }) {
  const labels = ['Empty', 'Low', 'Medium', 'High'];
  return (
    <View style={s.energy}>
      {ENERGY_ICONS.map((name, i) => {
        const on = value === i;
        return (
          <Pressable
            key={name}
            onPress={() => {
              tick();
              onChange(on ? null : (i as Energy));
            }}
            accessibilityRole="button"
            accessibilityLabel={`Energy ${labels[i]}`}
            accessibilityState={{ selected: on }}
            style={[s.energyBtn, on && s.energyOn]}>
            <Icon name={name} size={26} c={color.ink} style={s.batteryIcon} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tag chips, always visible. One per item; long-press to edit; + Add makes a new one. */
export function TagPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const tags = useStore((st) => st.tags);
  const addTag = useStore((st) => st.addTag);
  const updateTag = useStore((st) => st.updateTag);
  const removeTag = useStore((st) => st.removeTag);
  const [editing, setEditing] = useState<Tag | 'new' | null>(null);
  const [name, setName] = useState('');
  const [tagColor, setTagColor] = useState(TAG_COLORS[0]);

  const openNew = () => {
    setName('');
    setTagColor(TAG_COLORS[tags.length % TAG_COLORS.length]);
    setEditing('new');
  };
  const openEdit = (t: Tag) => {
    setName(t.name);
    setTagColor(t.color);
    setEditing(t);
  };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    if (editing === 'new') {
      const t = addTag(n, tagColor);
      onChange(t.id);
    } else if (editing) {
      updateTag(editing.id, { name: n, color: tagColor });
    }
    setEditing(null);
  };

  return (
    <>
      <ChipWrap>
        {tags.map((t) => (
          <Chip
            key={t.id}
            label={t.name}
            dot={t.color}
            selected={value === t.id}
            onPress={() => onChange(value === t.id ? null : t.id)}
            onLongPress={() => openEdit(t)}
          />
        ))}
        <Chip label="Add" icon="plus" onPress={openNew} />
      </ChipWrap>
      <Sheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New tag' : 'Edit tag'}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={color.ink3}
          autoFocus
          maxLength={24}
          style={[ui.input, s.tagInput]}
          onSubmitEditing={save}
          returnKeyType="done"
        />
        <View style={s.swatches}>
          {TAG_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setTagColor(c)}
              accessibilityLabel={`Colour ${c}`}
              accessibilityState={{ selected: c === tagColor }}
              style={[s.swatch, { backgroundColor: c }, c === tagColor && s.swatchOn]}
            />
          ))}
        </View>
        <Button label={editing === 'new' ? 'Add tag' : 'Save'} onPress={save} disabled={!name.trim()} />
        {editing && editing !== 'new' ? (
          <Button
            label="Delete tag"
            kind="danger"
            onPress={() => {
              removeTag(editing.id);
              if (value === editing.id) onChange(null);
              setEditing(null);
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  cal: { paddingTop: 4 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  calRow: { flexDirection: 'row' },
  calCell: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center' },
  calCellText: { flex: 1, textAlign: 'center', paddingVertical: 4 },
  calDay: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  calDayOn: { backgroundColor: color.yellow },
  calToday: { borderWidth: 1.5, borderColor: color.yellow },
  wheel: { flexDirection: 'row', alignItems: 'center', height: 52 },
  wheelArrow: { width: 32, alignItems: 'center' },
  wheelWindow: { flex: 1, height: 44, justifyContent: 'center' },
  wheelPill: {
    position: 'absolute',
    top: 2,
    width: ITEM,
    height: 40,
    borderRadius: 12,
    backgroundColor: color.yellowSoft,
    borderWidth: 1.5,
    borderColor: color.yellow,
  },
  wheelItem: { width: ITEM, height: 44, alignItems: 'center', justifyContent: 'center' },
  energy: { flexDirection: 'row', gap: 10 },
  energyBtn: {
    width: 52,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.fill,
  },
  energyOn: { backgroundColor: color.yellow },
  batteryIcon: { transform: [{ rotate: '90deg' }] },
  tagInput: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
    marginBottom: 16,
    fontFamily: font.regular,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  swatchOn: { borderWidth: 3, borderColor: color.ink },
});
