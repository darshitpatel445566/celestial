import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { SoundOption } from '../../modules/celestial-alarm';
import { addDays, weekday } from '../lib/dates';
import { LEVEL_NAMES } from '../lib/defaults';
import { BUNDLED_SOUNDS, loadSounds, previewSound, stopPreview } from '../lib/engine';
import {
  customSummary,
  fmtDate,
  fromLabel,
  MONTHS_SHORT,
  REPEAT_LABELS,
  untilLabel,
  WEEKDAY_LETTERS,
} from '../lib/format';
import { tick } from '../lib/haptics';
import { MATHS_EXAMPLES, tilesConfig, TILES_LOOK_MS, TYPING_EXAMPLES } from '../lib/missions';
import type {
  CustomRepeat,
  Freq,
  Item,
  Mission,
  MissionType,
  RepeatPreset,
  Snooze,
  SoundPrefs,
  Unit,
  WindowFrom,
  WindowUntil,
} from '../lib/types';
import { Button, Chip, ChipWrap, Divider, Row, Switch, styles as ui } from '../ui/controls';
import { MISSION_ICONS } from '../ui/Icon';
import { PopupMenu, Popover, useAnchor, type MenuOption } from '../ui/popups';
import { T } from '../ui/Text';
import { ALARM_ACCENT, color, font, type Accent } from '../ui/theme';
import { Wheel, WheelGroup, WheelLabel } from '../ui/Wheel';
import { Calendar } from './pickers';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

type PatchFn = (patch: Partial<Item>) => void;

// ---------- Repeat ----------

const PRESETS: RepeatPreset[] = [
  'once',
  'daily',
  'weekdays',
  'weekends',
  'weekly',
  'fortnightly',
  'monthly',
  '3months',
  '6months',
  'yearly',
];

const FREQ_UNIT: Record<Freq, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};

/** Repeat: a popup list from Once to Yearly, then Custom (its own small card). */
export function RepeatRow({ item, onChange, accent = ALARM_ACCENT }: { item: Item; onChange: PatchFn; accent?: Accent }) {
  const a = useAnchor<'menu' | 'custom'>();
  const options: MenuOption<RepeatPreset>[] = [
    ...PRESETS.map((p) => ({ key: p, label: REPEAT_LABELS[p] })),
    { key: 'custom', label: 'Custom', dividerBefore: true },
  ];
  const pick = (p: RepeatPreset) => {
    onChange({
      repeat: p,
      // "On date" end only makes sense for one-time items
      until: p !== 'once' && item.until.kind === 'date' ? { kind: 'event' } : item.until,
    });
    if (p === 'custom') setTimeout(() => a.show('custom', 'menu'), 140);
  };
  return (
    <>
      <Row
        label="Repeat"
        value={repeatValue(item)}
        popup
        rowRef={a.ref('menu')}
        onPress={() => {
          tick();
          a.show('menu');
        }}
      />
      <PopupMenu
        anchor={a.rectFor('menu')}
        options={options}
        selected={item.repeat}
        onSelect={pick}
        onClose={a.close}
        width={230}
      />
      <Popover
        anchor={a.rectFor('custom')}
        onClose={a.close}
        title="Custom"
        onDone={a.close}
        estimate={360}>
        <CustomRepeatCard item={item} onChange={onChange} accent={accent} onDone={a.close} />
      </Popover>
    </>
  );
}

function repeatValue(item: Item): string {
  if (item.repeat !== 'custom') return REPEAT_LABELS[item.repeat];
  return customSummary(item.custom, item.date, '').trim().replace(/^every/, 'Every');
}

function CustomRepeatCard({
  item,
  onChange,
  accent,
  onDone,
}: {
  item: Item;
  onChange: PatchFn;
  accent: Accent;
  onDone: () => void;
}) {
  const c = item.custom;
  const set = (patch: Partial<CustomRepeat>) => onChange({ custom: { ...c, ...patch } });
  const freqMenu = useAnchor<'freq'>();
  const freqs: MenuOption<Freq>[] = [
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'yearly', label: 'Yearly' },
  ];
  // With nothing picked the series follows the start date, so show that as chosen.
  const weekdays = c.weekdays.length ? c.weekdays : [weekday(item.date)];
  const monthDays = c.monthDays.length ? c.monthDays : [Number(item.date.slice(8))];
  const months = c.months.length ? c.months : [Number(item.date.slice(5, 7)) - 1];
  const flip = (list: number[], v: number) => {
    const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
    return next.length ? next : list; // keep at least one
  };
  const every = Math.max(1, c.every || 1);
  return (
    <View style={s.gap10}>
      <Row
        nested
        label="Frequency"
        value={freqs.find((f) => f.key === c.freq)?.label}
        popup
        rowRef={freqMenu.ref('freq')}
        onPress={() => {
          tick();
          freqMenu.show('freq');
        }}
      />
      <PopupMenu
        anchor={freqMenu.rectFor('freq')}
        options={freqs}
        selected={c.freq}
        onSelect={(f) => set({ freq: f })}
        onClose={freqMenu.close}
        width={200}
      />
      <View style={s.everyRow}>
        <T v="body" style={s.everyLabel}>
          Every
        </T>
        <WheelGroup rows={3} rowHeight={38} style={s.flex}>
          <Wheel
            values={range(1, 30)}
            value={every}
            onChange={(v) => set({ every: v })}
            onConfirm={onDone}
            rows={3}
            rowHeight={38}
            fontSize={19}
            width={64}
            align="right"
            label="Every"
          />
          <WheelLabel text={every === 1 ? FREQ_UNIT[c.freq][0] : FREQ_UNIT[c.freq][1]} rows={3} rowHeight={38} width={92} />
        </WheelGroup>
      </View>
      {c.freq === 'weekly' ? (
        <View style={s.letters}>
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
            const on = weekdays.includes(wd);
            return (
              <Pressable
                key={wd}
                onPress={() => {
                  tick();
                  set({ weekdays: flip(weekdays, wd) });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[s.letter, on && { backgroundColor: accent.main }]}>
                <T v={on ? 'subMedium' : 'sub'} c={on ? accent.on : color.ink}>
                  {WEEKDAY_LETTERS[wd]}
                </T>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {c.freq === 'monthly' ? (
        <View style={s.dates}>
          {range(1, 31).map((d) => {
            const on = monthDays.includes(d);
            return (
              <Pressable
                key={d}
                onPress={() => {
                  tick();
                  set({ monthDays: flip(monthDays, d) });
                }}
                accessibilityState={{ selected: on }}
                style={s.dateCell}>
                <View style={[s.dateDot, on && { backgroundColor: accent.main }]}>
                  <T v="foot" c={on ? accent.on : color.ink}>
                    {d}
                  </T>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {c.freq === 'yearly' ? (
        <ChipWrap>
          {MONTHS_SHORT.map((mName, mi) => (
            <Chip
              key={mName}
              small
              accent={accent}
              label={mName}
              selected={months.includes(mi)}
              onPress={() => set({ months: flip(months, mi) })}
            />
          ))}
        </ChipWrap>
      ) : null}
      <T v="foot" c={color.ink2}>
        {customSummary(c, item.date, item.kind === 'alarm' ? 'Rings' : 'Reminds')}
      </T>
    </View>
  );
}

// ---------- End repeat ----------

export function EndRepeatRow({
  item,
  onChange,
  accent = ALARM_ACCENT,
}: {
  item: Item;
  onChange: PatchFn;
  accent?: Accent;
}) {
  const a = useAnchor<'menu' | 'date'>();
  return (
    <>
      <Row
        label="End repeat"
        value={item.endRepeat ? fmtDate(item.endRepeat) : 'Never'}
        popup
        rowRef={a.ref('menu')}
        onPress={() => {
          tick();
          a.show('menu');
        }}
      />
      <PopupMenu
        anchor={a.rectFor('menu')}
        options={[
          { key: 'never', label: 'Never' },
          { key: 'date', label: 'On date' },
        ]}
        selected={item.endRepeat ? 'date' : 'never'}
        onSelect={(k) => {
          if (k === 'never') onChange({ endRepeat: null });
          else {
            if (!item.endRepeat) onChange({ endRepeat: addDays(item.date, 30) });
            setTimeout(() => a.show('date', 'menu'), 140);
          }
        }}
        onClose={a.close}
        width={200}
      />
      <Popover anchor={a.rectFor('date')} onClose={a.close} estimate={360}>
        <Calendar
          value={item.endRepeat ?? addDays(item.date, 30)}
          min={item.date}
          accent={accent}
          onChange={(d) => {
            onChange({ endRepeat: d });
            setTimeout(a.close, 160);
          }}
        />
      </Popover>
    </>
  );
}

// ---------- Remind every day ----------

type FromKey = 'none' | 'b1d' | 'b2d' | 'b1w' | 'b1m' | 'custom';
type UntilKey = 'event' | 'a1d' | 'a2d' | 'a1w' | 'custom' | 'date';

const FROM_QUICK: { key: FromKey; value: WindowFrom }[] = [
  { key: 'none', value: { kind: 'none' } },
  { key: 'b1d', value: { kind: 'before', n: 1, unit: 'day' } },
  { key: 'b2d', value: { kind: 'before', n: 2, unit: 'day' } },
  { key: 'b1w', value: { kind: 'before', n: 1, unit: 'week' } },
  { key: 'b1m', value: { kind: 'before', n: 1, unit: 'month' } },
];

const UNTIL_QUICK: { key: UntilKey; value: WindowUntil }[] = [
  { key: 'event', value: { kind: 'event' } },
  { key: 'a1d', value: { kind: 'after', n: 1, unit: 'day' } },
  { key: 'a2d', value: { kind: 'after', n: 2, unit: 'day' } },
  { key: 'a1w', value: { kind: 'after', n: 1, unit: 'week' } },
];

const same = (x: object, y: object) => JSON.stringify(x) === JSON.stringify(y);

function fromKey(f: WindowFrom): FromKey {
  return FROM_QUICK.find((q) => same(q.value, f))?.key ?? 'custom';
}

function untilKey(u: WindowUntil): UntilKey {
  if (u.kind === 'date') return 'date';
  return UNTIL_QUICK.find((q) => same(q.value, u))?.key ?? 'custom';
}

const UNITS: Unit[] = ['day', 'week', 'month'];

/** Two wheels side by side: how many, and days / weeks / months. */
function AmountWheels({
  n,
  unit,
  onChange,
  onDone,
  after,
}: {
  n: number;
  unit: Unit;
  onChange: (n: number, unit: Unit) => void;
  onDone: () => void;
  after: string;
}) {
  return (
    <View style={s.gap10}>
      <WheelGroup>
        <Wheel
          values={range(1, 60)}
          value={n}
          onChange={(v) => onChange(v, unit)}
          onConfirm={onDone}
          width={72}
          align="right"
          label="How many"
        />
        <Wheel
          values={UNITS}
          value={unit}
          onChange={(u) => onChange(n, u)}
          onConfirm={onDone}
          format={(u) => (n === 1 ? u : `${u}s`)}
          width={120}
          align="left"
          label="Unit"
        />
      </WheelGroup>
      <T v="foot" c={color.ink2} style={s.centerText}>
        {after}
      </T>
    </View>
  );
}

/** "Remind every day": once a day at the same time, from some days before until some days after. */
export function WindowPanel({ item, onChange, accent = ALARM_ACCENT }: { item: Item; onChange: PatchFn; accent?: Accent }) {
  const a = useAnchor<'from' | 'until' | 'fromCustom' | 'untilCustom' | 'untilDate'>();
  const fromOptions: MenuOption<FromKey>[] = [
    ...FROM_QUICK.map((q) => ({ key: q.key, label: fromLabel(q.value) })),
    { key: 'custom', label: 'Custom', dividerBefore: true },
  ];
  const untilOptions: MenuOption<UntilKey>[] = [
    ...UNTIL_QUICK.map((q) => ({ key: q.key, label: untilLabel(q.value) })),
    { key: 'custom', label: 'Custom', dividerBefore: true },
    ...(item.repeat === 'once' ? [{ key: 'date' as UntilKey, label: 'On date' }] : []),
  ];
  const dayWord = item.kind === 'alarm' ? 'the alarm day' : 'the day it’s due';
  const from = item.from.kind === 'before' ? item.from : { kind: 'before' as const, n: 3, unit: 'day' as Unit };
  const until = item.until.kind === 'after' ? item.until : { kind: 'after' as const, n: 3, unit: 'day' as Unit };
  return (
    <View>
      <Row
        nested
        label="From"
        value={fromLabel(item.from)}
        popup
        rowRef={a.ref('from')}
        onPress={() => {
          tick();
          a.show('from');
        }}
      />
      <Row
        nested
        last
        label="Until"
        value={untilLabel(item.until)}
        popup
        rowRef={a.ref('until')}
        onPress={() => {
          tick();
          a.show('until');
        }}
      />
      <PopupMenu
        anchor={a.rectFor('from')}
        options={fromOptions}
        selected={fromKey(item.from)}
        onSelect={(k) => {
          if (k === 'custom') {
            if (fromKey(item.from) !== 'custom') onChange({ from: { kind: 'before', n: 3, unit: 'day' } });
            setTimeout(() => a.show('fromCustom', 'from'), 140);
          } else onChange({ from: FROM_QUICK.find((q) => q.key === k)!.value });
        }}
        onClose={a.close}
        width={220}
      />
      <PopupMenu
        anchor={a.rectFor('until')}
        options={untilOptions}
        selected={untilKey(item.until)}
        onSelect={(k) => {
          if (k === 'custom') {
            if (untilKey(item.until) !== 'custom') onChange({ until: { kind: 'after', n: 3, unit: 'day' } });
            setTimeout(() => a.show('untilCustom', 'until'), 140);
          } else if (k === 'date') {
            if (item.until.kind !== 'date') onChange({ until: { kind: 'date', date: addDays(item.date, 7) } });
            setTimeout(() => a.show('untilDate', 'until'), 140);
          } else onChange({ until: UNTIL_QUICK.find((q) => q.key === k)!.value });
        }}
        onClose={a.close}
        width={220}
      />
      <Popover anchor={a.rectFor('fromCustom')} onClose={a.close} title="From" onDone={a.close} estimate={290}>
        <AmountWheels
          n={from.n}
          unit={from.unit}
          after={`before ${dayWord}`}
          onChange={(n, unit) => onChange({ from: { kind: 'before', n, unit } })}
          onDone={a.close}
        />
      </Popover>
      <Popover anchor={a.rectFor('untilCustom')} onClose={a.close} title="Until" onDone={a.close} estimate={290}>
        <AmountWheels
          n={until.n}
          unit={until.unit}
          after={`after ${dayWord}`}
          onChange={(n, unit) => onChange({ until: { kind: 'after', n, unit } })}
          onDone={a.close}
        />
      </Popover>
      <Popover anchor={a.rectFor('untilDate')} onClose={a.close} estimate={360}>
        <Calendar
          value={item.until.kind === 'date' ? item.until.date : addDays(item.date, 7)}
          min={item.date}
          accent={accent}
          onChange={(d) => {
            onChange({ until: { kind: 'date', date: d } });
            setTimeout(a.close, 160);
          }}
        />
      </Popover>
    </View>
  );
}

// ---------- Mission ----------

export function missionLabel(m: Mission): string {
  if (m.type === 'none') return 'None';
  const name = m.type[0].toUpperCase() + m.type.slice(1);
  return `${name}, ${LEVEL_NAMES[m.level - 1]}, ${m.rounds} ${m.rounds === 1 ? 'round' : 'rounds'}`;
}

function MissionExample({ m, accent }: { m: Mission; accent: Accent }) {
  if (m.type === 'maths')
    return (
      <View style={s.example}>
        <T v="title" c={color.white} tabular>
          {MATHS_EXAMPLES[m.level - 1]} = ?
        </T>
      </View>
    );
  if (m.type === 'tiles') {
    const { size, lit } = tilesConfig(m.level);
    const litSet = new Set(Array.from({ length: lit }, (_, i) => (i * 7 + 3) % (size * size)));
    return (
      <View style={s.example}>
        <View style={s.miniGrid}>
          {Array.from({ length: size }, (_, r) => (
            <View key={r} style={s.miniRow}>
              {Array.from({ length: size }, (_, c) => (
                <View
                  key={c}
                  style={[s.miniTile, litSet.has(r * size + c) && { backgroundColor: accent.main }]}
                />
              ))}
            </View>
          ))}
        </View>
        <T v="foot" c="rgba(255,255,255,0.7)">
          {size}×{size} grid · remember {lit} tiles · {(TILES_LOOK_MS / 1000).toString()} seconds to look
        </T>
      </View>
    );
  }
  if (m.type === 'typing')
    return (
      <View style={s.example}>
        <T v="headline" c={color.white} style={s.centerText}>
          {m.sentences.find((x) => x.trim()) ?? TYPING_EXAMPLES[m.level - 1]}
        </T>
      </View>
    );
  return null;
}

export function MissionPanel({
  mission,
  onChange,
  onTry,
  accent = ALARM_ACCENT,
}: {
  mission: Mission;
  onChange: (m: Mission) => void;
  onTry: () => void;
  accent?: Accent;
}) {
  const [roundsOpen, setRoundsOpen] = useState(false);
  const set = (patch: Partial<Mission>) => onChange({ ...mission, ...patch });
  const types: { t: MissionType; label: string }[] = [
    { t: 'none', label: 'None' },
    { t: 'maths', label: 'Maths' },
    { t: 'tiles', label: 'Tiles' },
    { t: 'typing', label: 'Typing' },
  ];
  return (
    <View style={s.gap12}>
      <T v="foot" c={color.ink2}>
        Solving the mission is the only way to stop the alarm. Snooze never needs it.
      </T>
      <ChipWrap>
        {types.map(({ t, label }) => (
          <Chip
            key={t}
            label={label}
            accent={accent}
            icon={t === 'none' ? undefined : MISSION_ICONS[t]}
            selected={mission.type === t}
            onPress={() => set({ type: t })}
          />
        ))}
      </ChipWrap>
      {mission.type !== 'none' ? (
        <>
          <View style={s.levelRow}>
            <T v="footMedium" c={color.ink2}>
              Level
            </T>
            <View style={s.levelDots}>
              {[1, 2, 3, 4, 5].map((l) => (
                <Pressable
                  key={l}
                  onPress={() => {
                    tick();
                    set({ level: l });
                  }}
                  hitSlop={6}
                  accessibilityLabel={`Level ${l}, ${LEVEL_NAMES[l - 1]}`}
                  style={[s.levelDot, l <= mission.level && { backgroundColor: accent.main }]}
                />
              ))}
            </View>
            <T v="sub">{LEVEL_NAMES[mission.level - 1]}</T>
          </View>
          <MissionExample m={mission} accent={accent} />
          <View>
            <Row
              nested
              last={!roundsOpen}
              label="Rounds"
              value={String(mission.rounds)}
              open={roundsOpen}
              onPress={() => {
                tick();
                setRoundsOpen((o) => !o);
              }}>
              <WheelGroup>
                <Wheel
                  values={range(1, 30)}
                  value={Math.min(30, Math.max(1, mission.rounds))}
                  onChange={(v) => set({ rounds: v })}
                  onConfirm={() => setRoundsOpen(false)}
                  width={72}
                  align="right"
                  label="Rounds"
                />
                <WheelLabel text={mission.rounds === 1 ? 'round' : 'rounds'} width={100} />
              </WheelGroup>
            </Row>
          </View>
          {mission.type === 'typing' ? (
            <>
              <T v="footMedium" c={color.ink2}>
                Your own sentences (one per line, optional)
              </T>
              <TextInput
                value={mission.sentences.join('\n')}
                onChangeText={(t) => set({ sentences: t.split('\n') })}
                placeholder="I get up because my day matters"
                placeholderTextColor={color.ink3}
                multiline
                style={[ui.input, s.sentences]}
              />
            </>
          ) : null}
          <Button label="Try it" kind="secondary" icon="play" onPress={onTry} />
        </>
      ) : null}
    </View>
  );
}

// ---------- Snooze ----------

const SNOOZE_MINUTES = [...range(1, 30), 45, 60];
const SNOOZE_TIMES = range(0, 10);

export function snoozeLabel(sn: Snooze): string {
  return sn.times === 0 ? 'Off' : `${sn.minutes} min, ${sn.times} ${sn.times === 1 ? 'time' : 'times'}`;
}

/** One wheel pair: how long, and how many times. Tap the centre to close. */
export function SnoozePanel({
  snooze,
  onChange,
  onClose,
}: {
  snooze: Snooze;
  onChange: (s: Snooze) => void;
  onClose: () => void;
}) {
  const minutes = SNOOZE_MINUTES.includes(snooze.minutes) ? snooze.minutes : 10;
  return (
    <View style={s.gap10}>
      <WheelGroup>
        <Wheel
          values={SNOOZE_MINUTES}
          value={minutes}
          onChange={(v) => onChange({ ...snooze, minutes: v })}
          onConfirm={onClose}
          width={64}
          align="right"
          label="Snooze length"
        />
        <WheelLabel text="min" width={70} />
        <Wheel
          values={SNOOZE_TIMES}
          value={Math.min(10, snooze.times)}
          onChange={(v) => onChange({ ...snooze, times: v })}
          onConfirm={onClose}
          format={(v) => (v === 0 ? 'Off' : String(v))}
          width={64}
          align="right"
          label="Snooze times"
        />
        <WheelLabel text={snooze.times === 0 ? '' : snooze.times === 1 ? 'time' : 'times'} width={70} />
      </WheelGroup>
      <T v="foot" c={color.ink2}>
        If nobody answers, the alarm rings for 10 minutes, then snoozes by itself. After the last snooze only the
        mission stops it.
      </T>
    </View>
  );
}

// ---------- Sound ----------

function soundOptions(sounds: SoundOption[]): MenuOption<string>[] {
  const groups: { group: SoundOption['group']; title: string }[] = [
    { group: 'loud', title: 'Loud' },
    { group: 'gentle', title: 'Gentle' },
    { group: 'phone', title: 'Phone sounds' },
  ];
  const out: MenuOption<string>[] = [];
  for (const g of groups) {
    sounds
      .filter((x) => x.group === g.group)
      .forEach((x, i) => out.push({ key: x.id, label: x.title, section: i === 0 ? g.title : undefined }));
  }
  return out;
}

export function SoundPanel({
  sound,
  onChange,
  title,
  accent = ALARM_ACCENT,
}: {
  sound: SoundPrefs;
  onChange: (s: SoundPrefs) => void;
  title: (id: string) => string;
  accent?: Accent;
}) {
  const [sounds, setSounds] = useState<SoundOption[]>(BUNDLED_SOUNDS);
  const a = useAnchor<'main' | 'pre'>();
  useEffect(() => {
    let alive = true;
    loadSounds().then((list) => alive && setSounds(list));
    return () => {
      alive = false;
      stopPreview();
    };
  }, []);
  const options = soundOptions(sounds);
  const close = () => {
    stopPreview();
    a.close();
  };
  return (
    <View>
      <Row
        nested
        label="Alarm sound"
        value={title(sound.main)}
        popup
        rowRef={a.ref('main')}
        onPress={() => {
          tick();
          a.show('main');
        }}
      />
      <Row
        nested
        label="Pre-alarm sound"
        value={title(sound.pre)}
        popup
        rowRef={a.ref('pre')}
        onPress={() => {
          tick();
          a.show('pre');
        }}
      />
      <View style={s.switchRow}>
        <T v="body">Rising volume</T>
        <Switch
          value={sound.rising}
          onChange={(v) => onChange({ ...sound, rising: v })}
          label="Rising volume"
          accent={accent.main}
        />
      </View>
      <Divider inset={0} />
      <View style={s.switchRow}>
        <T v="body">Vibrate</T>
        <Switch
          value={sound.vibrate}
          onChange={(v) => onChange({ ...sound, vibrate: v })}
          label="Vibrate"
          accent={accent.main}
        />
      </View>
      <PopupMenu
        anchor={a.rectFor('main')}
        options={options}
        selected={sound.main}
        keepOpen
        width={260}
        onSelect={(id) => {
          onChange({ ...sound, main: id });
          previewSound(id);
        }}
        onClose={close}
      />
      <PopupMenu
        anchor={a.rectFor('pre')}
        options={options}
        selected={sound.pre}
        keepOpen
        width={260}
        onSelect={(id) => {
          onChange({ ...sound, pre: id });
          previewSound(id);
        }}
        onClose={close}
      />
    </View>
  );
}

export function soundLabel(sound: SoundPrefs, title: (id: string) => string): string {
  return `${title(sound.main)}, ${title(sound.pre)}`;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  gap12: { gap: 12 },
  gap10: { gap: 10 },
  centerText: { textAlign: 'center' },
  everyRow: { flexDirection: 'row', alignItems: 'center' },
  everyLabel: { width: 64 },
  letters: { flexDirection: 'row', justifyContent: 'space-between' },
  letter: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.fill,
  },
  dates: { flexDirection: 'row', flexWrap: 'wrap' },
  dateCell: { width: `${100 / 7}%`, height: 38, alignItems: 'center', justifyContent: 'center' },
  dateDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  example: { alignItems: 'center', gap: 10, padding: 18, borderRadius: 18, backgroundColor: color.navy },
  miniGrid: { width: 120, height: 120, gap: 3 },
  miniRow: { flex: 1, flexDirection: 'row', gap: 3 },
  miniTile: { flex: 1, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)' },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  levelDots: { flexDirection: 'row', gap: 8 },
  levelDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.fillStrong },
  sentences: {
    minHeight: 80,
    borderRadius: 12,
    backgroundColor: color.fill,
    paddingHorizontal: 12,
    textAlignVertical: 'top',
    fontFamily: font.regular,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
});
