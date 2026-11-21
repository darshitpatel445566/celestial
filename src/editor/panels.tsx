import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { SoundOption } from '../../modules/celestial-alarm';
import { addDays } from '../lib/dates';
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
import { MATHS_EXAMPLES, tilesConfig, TYPING_EXAMPLES } from '../lib/missions';
import { fromDays, untilDay } from '../lib/schedule';
import { tick } from '../lib/haptics';
import type {
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
import { Icon, MISSION_ICONS } from '../ui/Icon';
import { T } from '../ui/Text';
import { color, font } from '../ui/theme';
import { Calendar, NumberWheel } from './pickers';

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
  'custom',
];

const ONE_TO = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

export function RepeatPanel({ item, onChange }: { item: Item; onChange: (patch: Partial<Item>) => void }) {
  const c = item.custom;
  const setCustom = (patch: Partial<Item['custom']>) => onChange({ custom: { ...c, ...patch } });
  const unit: Record<Freq, [string, string]> = {
    daily: ['day', 'days'],
    weekly: ['week', 'weeks'],
    monthly: ['month', 'months'],
    yearly: ['year', 'years'],
  };
  return (
    <View style={s.gap12}>
      <ChipWrap>
        {PRESETS.map((p) => (
          <Chip
            key={p}
            label={REPEAT_LABELS[p]}
            selected={item.repeat === p}
            onPress={() =>
              onChange({
                repeat: p,
                // "On date" end only makes sense for one-time items
                until: p !== 'once' && item.until.kind === 'date' ? { kind: 'event' } : item.until,
              })
            }
          />
        ))}
      </ChipWrap>
      {item.repeat === 'custom' ? (
        <View style={s.custom}>
          <T v="footMedium" c={color.ink2}>
            Frequency
          </T>
          <ChipWrap>
            {(['daily', 'weekly', 'monthly', 'yearly'] as Freq[]).map((f) => (
              <Chip
                key={f}
                small
                label={f[0].toUpperCase() + f.slice(1)}
                selected={c.freq === f}
                onPress={() => setCustom({ freq: f })}
              />
            ))}
          </ChipWrap>
          <T v="footMedium" c={color.ink2}>
            Every
          </T>
          <NumberWheel
            values={ONE_TO(30)}
            value={c.every}
            onChange={(v) => setCustom({ every: v })}
            format={(v) => String(v)}
          />
          <T v="foot" c={color.ink2} style={s.center}>
            {c.every === 1 ? unit[c.freq][0] : unit[c.freq][1]}
          </T>
          {c.freq === 'weekly' ? (
            <>
              <T v="footMedium" c={color.ink2}>
                On
              </T>
              <View style={s.letters}>
                {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
                  const on = c.weekdays.includes(wd);
                  return (
                    <Pressable
                      key={wd}
                      onPress={() => {
                        tick();
                        setCustom({ weekdays: on ? c.weekdays.filter((x) => x !== wd) : [...c.weekdays, wd] });
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[s.letter, on && s.letterOn]}>
                      <T v={on ? 'subMedium' : 'sub'}>{WEEKDAY_LETTERS[wd]}</T>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
          {c.freq === 'monthly' ? (
            <>
              <T v="footMedium" c={color.ink2}>
                Each
              </T>
              <View style={s.dates}>
                {ONE_TO(31).map((d) => {
                  const on = c.monthDays.includes(d);
                  return (
                    <Pressable
                      key={d}
                      onPress={() => {
                        tick();
                        setCustom({ monthDays: on ? c.monthDays.filter((x) => x !== d) : [...c.monthDays, d] });
                      }}
                      style={s.dateCell}>
                      <View style={[s.dateDot, on && s.letterOn]}>
                        <T v="foot">{d}</T>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
          {c.freq === 'yearly' ? (
            <>
              <T v="footMedium" c={color.ink2}>
                In
              </T>
              <ChipWrap>
                {MONTHS_SHORT.map((mName, mi) => {
                  const on = c.months.includes(mi);
                  return (
                    <Chip
                      key={mName}
                      small
                      label={mName}
                      selected={on}
                      onPress={() => setCustom({ months: on ? c.months.filter((x) => x !== mi) : [...c.months, mi] })}
                    />
                  );
                })}
              </ChipWrap>
            </>
          ) : null}
          <T v="sub" c={color.ink} style={s.summary}>
            {customSummary(c, item.date, item.kind === 'alarm' ? 'Rings' : 'Reminds')}
          </T>
        </View>
      ) : null}
    </View>
  );
}

export function EndRepeatPanel({ item, onChange }: { item: Item; onChange: (patch: Partial<Item>) => void }) {
  return (
    <View style={s.gap12}>
      <ChipWrap>
        <Chip label="Never" selected={!item.endRepeat} onPress={() => onChange({ endRepeat: null })} />
        <Chip
          label="On date"
          selected={!!item.endRepeat}
          onPress={() => onChange({ endRepeat: item.endRepeat ?? addDays(item.date, 30) })}
        />
      </ChipWrap>
      {item.endRepeat ? (
        <Calendar value={item.endRepeat} min={item.date} onChange={(d) => onChange({ endRepeat: d })} />
      ) : null}
    </View>
  );
}

type Quick<T> = { label: string; value: T };

const FROM_QUICK: Quick<WindowFrom>[] = [
  { label: 'None', value: { kind: 'none' } },
  { label: '1 day', value: { kind: 'before', n: 1, unit: 'day' } },
  { label: '2 days', value: { kind: 'before', n: 2, unit: 'day' } },
  { label: '1 week', value: { kind: 'before', n: 1, unit: 'week' } },
  { label: '1 month', value: { kind: 'before', n: 1, unit: 'month' } },
];

const UNTIL_QUICK: Quick<WindowUntil>[] = [
  { label: 'The event day', value: { kind: 'event' } },
  { label: '1 day after', value: { kind: 'after', n: 1, unit: 'day' } },
  { label: '2 days after', value: { kind: 'after', n: 2, unit: 'day' } },
  { label: '1 week after', value: { kind: 'after', n: 1, unit: 'week' } },
];

const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

function CustomAmount({ n, unit, onChange }: { n: number; unit: Unit; onChange: (n: number, unit: Unit) => void }) {
  return (
    <View style={s.gap8}>
      <NumberWheel values={ONE_TO(60)} value={n} onChange={(v) => onChange(v, unit)} />
      <ChipWrap style={s.centerRow}>
        {(['day', 'week', 'month'] as Unit[]).map((u) => (
          <Chip key={u} small label={`${u}s`} selected={unit === u} onPress={() => onChange(n, u)} />
        ))}
      </ChipWrap>
    </View>
  );
}

/** "Remind every day": once a day at the alarm's time, from N before until M after the event. */
export function WindowPanel({ item, onChange }: { item: Item; onChange: (patch: Partial<Item>) => void }) {
  const [open, setOpen] = useState<'from' | 'until' | null>(null);
  const toggle = (k: 'from' | 'until') => setOpen((o) => (o === k ? null : k));
  const fromCustom = item.from.kind === 'before' && !FROM_QUICK.some((q) => same(q.value, item.from));
  const untilCustom = item.until.kind === 'after' && !UNTIL_QUICK.some((q) => same(q.value, item.until));
  const occ = item.date;
  const start = addDays(occ, -fromDays(item, occ));
  const end = untilDay(item, occ);
  return (
    <View>
      <Row nested label="From" value={fromLabel(item.from)} open={open === 'from'} onPress={() => toggle('from')}>
        <View style={s.gap12}>
          <ChipWrap>
            {FROM_QUICK.map((q) => (
              <Chip
                key={q.label}
                label={q.label}
                selected={same(q.value, item.from)}
                onPress={() => onChange({ from: q.value })}
              />
            ))}
            <Chip
              label="Custom"
              selected={fromCustom}
              onPress={() => onChange({ from: { kind: 'before', n: 10, unit: 'day' } })}
            />
          </ChipWrap>
          {item.from.kind === 'before' && fromCustom ? (
            <CustomAmount
              n={item.from.n}
              unit={item.from.unit}
              onChange={(n, unit) => onChange({ from: { kind: 'before', n, unit } })}
            />
          ) : null}
        </View>
      </Row>
      <Row
        nested
        label="Until"
        value={untilLabel(item.until)}
        open={open === 'until'}
        onPress={() => toggle('until')}
        last>
        <View style={s.gap12}>
          <ChipWrap>
            {UNTIL_QUICK.map((q) => (
              <Chip
                key={q.label}
                label={q.label}
                selected={same(q.value, item.until)}
                onPress={() => onChange({ until: q.value })}
              />
            ))}
            <Chip
              label="Custom"
              selected={untilCustom}
              onPress={() => onChange({ until: { kind: 'after', n: 10, unit: 'day' } })}
            />
            {item.repeat === 'once' ? (
              <Chip
                label="On date"
                selected={item.until.kind === 'date'}
                onPress={() => onChange({ until: { kind: 'date', date: addDays(item.date, 7) } })}
              />
            ) : null}
          </ChipWrap>
          {item.until.kind === 'after' && untilCustom ? (
            <CustomAmount
              n={item.until.n}
              unit={item.until.unit}
              onChange={(n, unit) => onChange({ until: { kind: 'after', n, unit } })}
            />
          ) : null}
          {item.until.kind === 'date' ? (
            <Calendar
              value={item.until.date}
              min={item.date}
              onChange={(d) => onChange({ until: { kind: 'date', date: d } })}
            />
          ) : null}
        </View>
      </Row>
      <DayStrip start={start} event={occ} end={end} />
    </View>
  );
}

/** ● ● ● ◆ ● ● — one dot per reminder day, the diamond on the event day. */
function DayStrip({ start, event, end }: { start: string; event: string; end: string }) {
  const days: string[] = [];
  for (let d = start; d <= end && days.length < 400; d = addDays(d, 1)) days.push(d);
  if (days.length <= 1) return null;
  const compact = days.length > 21;
  const shown = compact ? [days[0], event, days[days.length - 1]] : days;
  return (
    <View style={s.strip}>
      <View style={s.stripDots}>
        {shown.map((d, i) => (
          <View key={d} style={s.stripCell}>
            {compact && i > 0 ? (
              <T v="cap" c={color.ink3} style={s.ellipsis}>
                ···
              </T>
            ) : null}
            {d === event ? <View style={s.stripDiamond} /> : <View style={s.stripDot} />}
          </View>
        ))}
      </View>
      <View style={s.stripLabels}>
        <T v="cap" c={color.ink2}>
          {fmtDate(days[0])}
        </T>
        <T v="cap" c={color.ink}>
          {fmtDate(event)}
        </T>
        <T v="cap" c={color.ink2}>
          {fmtDate(days[days.length - 1])}
        </T>
      </View>
    </View>
  );
}

export function missionLabel(m: Mission): string {
  if (m.type === 'none') return 'None';
  const name = m.type[0].toUpperCase() + m.type.slice(1);
  return `${name}, ${LEVEL_NAMES[m.level - 1]}, ${m.rounds} ${m.rounds === 1 ? 'round' : 'rounds'}`;
}

function MissionExample({ m }: { m: Mission }) {
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
                <View key={c} style={[s.miniTile, litSet.has(r * size + c) && s.miniTileOn]} />
              ))}
            </View>
          ))}
        </View>
        <T v="foot" c="rgba(255,255,255,0.7)">
          {size}×{size} grid · remember {lit} tiles · 3 seconds to look
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
}: {
  mission: Mission;
  onChange: (m: Mission) => void;
  onTry: () => void;
}) {
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
                  style={[s.levelDot, l <= mission.level && s.levelDotOn]}
                />
              ))}
            </View>
            <T v="sub">{LEVEL_NAMES[mission.level - 1]}</T>
          </View>
          <MissionExample m={mission} />
          <T v="footMedium" c={color.ink2}>
            Rounds
          </T>
          <ChipWrap>
            {[1, 2, 3, 4, 5].map((r) => (
              <Chip
                key={r}
                small
                label={String(r)}
                selected={mission.rounds === r}
                onPress={() => set({ rounds: r })}
              />
            ))}
          </ChipWrap>
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

export function snoozeLabel(sn: Snooze): string {
  return sn.times === 0 ? 'Off' : `${sn.minutes} min, ${sn.times} ${sn.times === 1 ? 'time' : 'times'}`;
}

export function SnoozePanel({ snooze, onChange }: { snooze: Snooze; onChange: (s: Snooze) => void }) {
  return (
    <View style={s.gap12}>
      <T v="footMedium" c={color.ink2}>
        Length
      </T>
      <ChipWrap>
        {[5, 10, 15, 20, 30].map((m) => (
          <Chip
            key={m}
            small
            label={`${m} min`}
            selected={snooze.times > 0 && snooze.minutes === m}
            onPress={() => onChange({ minutes: m, times: snooze.times || 3 })}
          />
        ))}
      </ChipWrap>
      <T v="footMedium" c={color.ink2}>
        Times
      </T>
      <ChipWrap>
        {[1, 2, 3, 4, 5].map((n) => (
          <Chip
            key={n}
            small
            label={String(n)}
            selected={snooze.times === n}
            onPress={() => onChange({ ...snooze, times: n })}
          />
        ))}
        <Chip small label="Off" selected={snooze.times === 0} onPress={() => onChange({ ...snooze, times: 0 })} />
      </ChipWrap>
      <T v="foot" c={color.ink2}>
        If nobody answers, the alarm rings for 10 minutes, then snoozes by itself. After the last snooze only the
        mission stops it.
      </T>
    </View>
  );
}

function SoundList({ value, onPick, sounds }: { value: string; onPick: (id: string) => void; sounds: SoundOption[] }) {
  const [more, setMore] = useState(false);
  const bundled = sounds.filter((x) => x.group === 'celestial');
  const phone = sounds.filter((x) => x.group === 'phone');
  const pickedPhone = phone.find((x) => x.id === value);
  return (
    <View style={s.gap8}>
      <ChipWrap>
        {bundled.map((x) => (
          <Chip
            key={x.id}
            label={x.title}
            icon="music-note-outline"
            selected={value === x.id}
            onPress={() => {
              onPick(x.id);
              previewSound(x.id);
            }}
          />
        ))}
      </ChipWrap>
      {phone.length ? (
        <Pressable onPress={() => setMore((m) => !m)} style={s.moreRow} accessibilityRole="button">
          <T v="sub" c={color.ink2}>
            Phone sounds{pickedPhone ? ` · ${pickedPhone.title}` : ''}
          </T>
          <Icon name={more ? 'chevron-down' : 'chevron-right'} size={20} c={color.ink3} />
        </Pressable>
      ) : null}
      {more
        ? phone.map((x) => (
            <Pressable
              key={x.id}
              onPress={() => {
                tick();
                onPick(x.id);
                previewSound(x.id);
              }}
              style={s.soundRow}>
              <T v="sub">{x.title}</T>
              {value === x.id ? <Icon name="check" size={20} c={color.ink} /> : null}
            </Pressable>
          ))
        : null}
    </View>
  );
}

export function SoundPanel({ sound, onChange }: { sound: SoundPrefs; onChange: (s: SoundPrefs) => void }) {
  const [sounds, setSounds] = useState<SoundOption[]>(BUNDLED_SOUNDS);
  useEffect(() => {
    let alive = true;
    loadSounds().then((list) => alive && setSounds(list));
    return () => {
      alive = false;
      stopPreview();
    };
  }, []);
  return (
    <View style={s.gap12}>
      <T v="footMedium" c={color.ink2}>
        Alarm sound
      </T>
      <SoundList value={sound.main} sounds={sounds} onPick={(id) => onChange({ ...sound, main: id })} />
      <T v="footMedium" c={color.ink2}>
        Pre-alarm sound
      </T>
      <SoundList value={sound.pre} sounds={sounds} onPick={(id) => onChange({ ...sound, pre: id })} />
      <Divider inset={0} />
      <View style={s.switchRow}>
        <T v="body">Rising volume</T>
        <Switch value={sound.rising} onChange={(v) => onChange({ ...sound, rising: v })} label="Rising volume" />
      </View>
      <View style={s.switchRow}>
        <T v="body">Vibrate</T>
        <Switch value={sound.vibrate} onChange={(v) => onChange({ ...sound, vibrate: v })} label="Vibrate" />
      </View>
    </View>
  );
}

export function soundLabel(sound: SoundPrefs, title: (id: string) => string): string {
  return `${title(sound.main)}, ${title(sound.pre)}`;
}

const s = StyleSheet.create({
  gap12: { gap: 12 },
  gap8: { gap: 8 },
  center: { textAlign: 'center', marginTop: -6 },
  centerRow: { justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  custom: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: color.fill },
  letters: { flexDirection: 'row', justifyContent: 'space-between' },
  letter: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.white,
  },
  letterOn: { backgroundColor: color.yellow },
  dates: { flexDirection: 'row', flexWrap: 'wrap' },
  dateCell: { width: `${100 / 7}%`, height: 38, alignItems: 'center', justifyContent: 'center' },
  dateDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  summary: { marginTop: 4 },
  strip: { paddingTop: 12, paddingBottom: 4, gap: 6 },
  stripDots: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stripCell: { flexDirection: 'row', alignItems: 'center' },
  ellipsis: { marginRight: 10 },
  stripDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.navy },
  stripDiamond: {
    width: 11,
    height: 11,
    backgroundColor: color.yellow,
    borderWidth: 1.5,
    borderColor: color.navy,
    transform: [{ rotate: '45deg' }],
  },
  stripLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  example: { alignItems: 'center', gap: 10, padding: 18, borderRadius: 18, backgroundColor: color.navy },
  miniGrid: { width: 120, height: 120, gap: 3 },
  miniRow: { flex: 1, flexDirection: 'row', gap: 3 },
  miniTile: { flex: 1, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)' },
  miniTileOn: { backgroundColor: color.yellow },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  levelDots: { flexDirection: 'row', gap: 8 },
  levelDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.fillStrong },
  levelDotOn: { backgroundColor: color.yellow },
  sentences: {
    minHeight: 80,
    borderRadius: 12,
    backgroundColor: color.fill,
    paddingHorizontal: 12,
    textAlignVertical: 'top',
    fontFamily: font.regular,
  },
  moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
});
