import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Checklist } from '../editor/Checklist';
import {
  EndRepeatPanel,
  MissionPanel,
  missionLabel,
  RepeatPanel,
  SnoozePanel,
  snoozeLabel,
  SoundPanel,
  soundLabel,
  WindowPanel,
} from '../editor/panels';
import { Calendar, EnergyPicker, NumberWheel, TagPicker } from '../editor/pickers';
import { TimelineSlider } from '../editor/TimelineSlider';
import { addDays, atTime, diffDays, minutesOf, today as todayYmd, ymd } from '../lib/dates';
import { newItem } from '../lib/defaults';
import { cancelSnooze, hasEngine, loadSounds, requestNotifications, soundTitle } from '../lib/engine';
import {
  amPm,
  fmtClock,
  fmtDay,
  fmtLeft,
  fmtMinutes,
  fmtRange,
  fromLabel,
  partOfDay,
  repeatLabel,
  untilLabel,
  windowIsOff,
} from '../lib/format';
import { bump, success, tick } from '../lib/haptics';
import { nextOccurrence } from '../lib/repeat';
import { fromDays, nextRing, ringsLikeAlarm, rollForwardIfPast, untilDay } from '../lib/schedule';
import { useStore, useUi } from '../lib/store';
import type { Item, Kind, Line } from '../lib/types';
import { MissionRunner } from '../missions/Missions';
import { Button, Checkbox, Divider, Row } from '../ui/controls';
import { Icon, PART_NAME, PartIcon } from '../ui/Icon';
import { T } from '../ui/Text';
import { color, font, SIDE } from '../ui/theme';

type OpenKey = 'date' | 'gap' | 'repeat' | 'end' | 'window' | 'mission' | 'snooze' | 'sound';

const GAPS = [...Array.from({ length: 60 }, (_, i) => i + 1), 75, 90, 120];

/** The day the alarm rings next: the start date for one-time items, the next occurrence for repeating ones. */
function displayDay(item: Item, now: Date): string {
  if (item.repeat === 'once') return item.date;
  const today = todayYmd(now);
  let d = nextOccurrence(item, today);
  if (d && atTime(d, item.time).getTime() <= now.getTime()) d = nextOccurrence(item, addDays(d, 1));
  return d ?? item.date;
}

function nextMinute(now = Date.now()) {
  return new Date(now + 60000 - (now % 60000));
}

function cleanLines(lines: Line[]): Line[] {
  const out = lines.map((l) => ({ ...l, text: l.text.replace(/\s+$/, '') }));
  while (out.length && out[out.length - 1].type === 'text' && out[out.length - 1].text === '') out.pop();
  return out.filter((l) => l.type === 'text' || l.text !== '');
}

function windowValue(item: Item): string {
  if (windowIsOff(item)) return 'Off';
  if (item.repeat === 'once') {
    return fmtRange(addDays(item.date, -fromDays(item, item.date)), untilDay(item, item.date));
  }
  const parts: string[] = [];
  if (item.from.kind !== 'none') parts.push(fromLabel(item.from));
  if (item.until.kind !== 'event') parts.push(untilLabel(item.until));
  return parts.join(' – ');
}

export default function EditScreen() {
  const params = useLocalSearchParams<{ id?: string; kind?: string }>();
  const insets = useSafeAreaInsets();
  const existing = useStore((s) => (params.id ? s.items.find((i) => i.id === params.id) : undefined));
  const upsert = useStore((s) => s.upsert);
  const remove = useStore((s) => s.remove);
  const sliderHint = useStore((s) => s.sliderHint);
  const markSliderUsed = useStore((s) => s.markSliderUsed);
  const showToast = useUi((s) => s.showToast);

  const [draft, setDraft] = useState<Item>(() =>
    existing ? rollForwardIfPast(existing) : newItem(params.kind === 'reminder' ? 'reminder' : 'alarm'),
  );
  const [open, setOpen] = useState<OpenKey | null>(null);
  const [kindMenu, setKindMenu] = useState(false);
  const [trying, setTrying] = useState(false);
  const [, setSoundsReady] = useState(0);
  const isNew = !existing;

  useEffect(() => {
    loadSounds().then(() => setSoundsReady((n) => n + 1));
  }, []);

  const patch = (p: Partial<Item>) => setDraft((d) => ({ ...d, ...p }));
  const toggle = (k: OpenKey) => {
    tick();
    setOpen((o) => (o === k ? null : k));
  };

  const now = new Date();
  const day = displayDay(draft, now);
  const alarmAt = atTime(day, draft.time);
  const minAt = nextMinute();
  const rings = ringsLikeAlarm(draft);

  /** Move the alarm to a new moment; repeating series shift by the same number of days. */
  const setMoment = (d: Date) => {
    const at = d.getTime() < minAt.getTime() ? minAt : d;
    const newDay = ymd(at);
    const delta = diffDays(day, newDay);
    patch({ date: addDays(draft.date, delta), time: minutesOf(at) });
  };

  const nudge = (min: number) => {
    bump();
    setMoment(new Date(alarmAt.getTime() + min * 60000));
  };

  const pickDate = (d: string) => {
    let time = draft.time;
    if (atTime(d, time).getTime() < minAt.getTime()) {
      const m = minutesOf(minAt);
      time = Math.ceil(m / 5) * 5;
    }
    const delta = diffDays(day, d);
    patch({ date: addDays(draft.date, delta), time });
  };

  const setGap = (g: number) => {
    const lead = draft.lead > 0 ? Math.max(g, Math.round(draft.lead / g) * g) : 0;
    patch({ gap: g, lead });
  };

  const setKind = (k: Kind) => {
    setKindMenu(false);
    if (k !== draft.kind) {
      tick();
      patch({ kind: k });
    }
  };

  const save = () => {
    let item: Item = { ...draft, name: draft.name.trim(), lines: cleanLines(draft.lines), enabled: true };
    if (item.repeat !== 'once' && item.until.kind === 'date') item = { ...item, until: { kind: 'event' } };
    item = rollForwardIfPast(item);
    const prev = existing;
    upsert(item);
    success();
    // First save is the natural moment to ask for notifications (needed for the ringing screen).
    if (hasEngine) requestNotifications().catch(() => {});
    const next = nextRing(item);
    const word = item.kind === 'alarm' ? 'Alarm' : 'Reminder';
    const when = next ? `${fmtDay(ymd(next.at))} · ${fmtLeft(next.at.getTime() - Date.now())}` : 'No upcoming rings';
    showToast(`${word} set · ${when}`, () => {
      if (prev) upsert(prev);
      else remove(item.id);
    });
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(`Delete this ${draft.kind}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          cancelSnooze(draft.id);
          remove(draft.id);
          router.back();
        },
      },
    ]);
  };

  const title = `${isNew ? 'New' : 'Edit'} ${draft.kind}`;
  const part = partOfDay(draft.time);
  const hint = !sliderHint.alarm || !sliderHint.pre;
  const dateValue = useMemo(() => {
    const rel = fmtDay(day);
    return rel === 'Today' || rel === 'Tomorrow' ? `${rel}, ${fmtDayLong(day)}` : rel;
  }, [day]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <T v="body" c={color.ink2}>
            Cancel
          </T>
        </Pressable>
        <Pressable
          onPress={() => setKindMenu(true)}
          style={s.titleBtn}
          accessibilityRole="button"
          accessibilityLabel={`${title}. Change type`}>
          <T v="headline">{title}</T>
          <Icon name="menu-down" size={22} c={color.ink} />
        </Pressable>
        <Pressable onPress={save} hitSlop={12} accessibilityRole="button" style={s.saveBtn}>
          <T v="headline">Save</T>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={s.flex}
          contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Time */}
          <View style={s.timeRow}>
            <Pressable onPress={() => nudge(-1)} hitSlop={12} style={s.nudge} accessibilityLabel="One minute earlier">
              <Icon name="chevron-left" size={30} c={color.ink3} />
            </Pressable>
            <View
              style={s.timeCenter}
              accessibilityLabel={`${fmtClock(draft.time)} ${amPm(draft.time)}, ${PART_NAME[part]}`}>
              <T v="display" c={color.ink} tabular>
                {fmtClock(draft.time)}
              </T>
              <View style={s.ampmCol}>
                <T v="headline" c={color.ink}>
                  {amPm(draft.time)}
                </T>
                <PartIcon minutes={draft.time} size={24} />
              </View>
            </View>
            <Pressable onPress={() => nudge(1)} hitSlop={12} style={s.nudge} accessibilityLabel="One minute later">
              <Icon name="chevron-right" size={30} c={color.ink3} />
            </Pressable>
          </View>

          <Row label="Date" value={dateValue} open={open === 'date'} onPress={() => toggle('date')}>
            <Calendar value={day} min={todayYmd()} onChange={pickDate} />
          </Row>

          <View style={s.slider}>
            <TimelineSlider
              alarm={alarmAt}
              lead={draft.lead}
              gap={draft.gap}
              pins={draft.pins}
              min={minAt}
              onAlarm={setMoment}
              onLead={(lead) => patch({ lead })}
              onPins={(pins) => patch({ pins })}
              showHint={hint}
              onUsed={markSliderUsed}
            />
          </View>

          {draft.lead > 0 ? (
            <Row label="Gap" value={fmtMinutes(draft.gap)} open={open === 'gap'} onPress={() => toggle('gap')}>
              <NumberWheel values={GAPS} value={draft.gap} onChange={setGap} />
              <T v="foot" c={color.ink2} style={s.centerText}>
                minutes between pre-alarms
              </T>
            </Row>
          ) : (
            <Divider />
          )}

          {/* What */}
          <View style={s.block}>
            <TextInput
              value={draft.name}
              onChangeText={(name) => patch({ name })}
              placeholder={draft.kind === 'alarm' ? 'Alarm name' : 'Reminder name'}
              placeholderTextColor={color.ink3}
              style={s.name}
              returnKeyType="next"
              maxLength={80}
            />
            <Checklist lines={draft.lines} onChange={(lines) => patch({ lines })} />
          </View>
          <Divider />
          <View style={s.inline}>
            <T v="body" style={s.inlineLabel}>
              Tag
            </T>
            <View style={s.flex}>
              <TagPicker value={draft.tagId} onChange={(tagId) => patch({ tagId })} />
            </View>
          </View>
          <Divider />
          <View style={s.inline}>
            <T v="body" style={s.inlineLabel}>
              Energy
            </T>
            <EnergyPicker value={draft.energy} onChange={(energy) => patch({ energy })} />
          </View>
          <View style={s.gapBlock} />

          {/* When it repeats */}
          <Row label="Repeat" value={repeatLabel(draft)} open={open === 'repeat'} onPress={() => toggle('repeat')}>
            <RepeatPanel item={draft} onChange={patch} />
          </Row>
          {draft.repeat !== 'once' ? (
            <Row
              label="End repeat"
              value={draft.endRepeat ? fmtDay(draft.endRepeat) : 'Never'}
              open={open === 'end'}
              onPress={() => toggle('end')}>
              <EndRepeatPanel item={draft} onChange={patch} />
            </Row>
          ) : null}
          <Row
            label="Remind every day"
            value={windowValue(draft)}
            open={open === 'window'}
            onPress={() => toggle('window')}
            last={draft.kind === 'alarm'}>
            <WindowPanel item={draft} onChange={patch} />
          </Row>
          {draft.kind === 'reminder' ? (
            <Pressable
              style={s.checkRow}
              onPress={() => {
                tick();
                patch({ ringLikeAlarm: !draft.ringLikeAlarm });
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.ringLikeAlarm }}>
              <Checkbox
                checked={draft.ringLikeAlarm}
                onPress={() => {
                  tick();
                  patch({ ringLikeAlarm: !draft.ringLikeAlarm });
                }}
              />
              <T v="body" style={s.checkLabel}>
                Ring like an alarm
              </T>
            </Pressable>
          ) : null}

          {/* How it rings */}
          {rings ? (
            <>
              <View style={s.gapBlock} />
              <Row
                label="Mission"
                value={missionLabel(draft.mission)}
                open={open === 'mission'}
                onPress={() => toggle('mission')}>
                <MissionPanel
                  mission={draft.mission}
                  onChange={(mission) => patch({ mission })}
                  onTry={() => setTrying(true)}
                />
              </Row>
              <Row
                label="Snooze"
                value={snoozeLabel(draft.snooze)}
                open={open === 'snooze'}
                onPress={() => toggle('snooze')}>
                <SnoozePanel snooze={draft.snooze} onChange={(snooze) => patch({ snooze })} />
              </Row>
              <Row
                label="Sound"
                value={soundLabel(draft.sound, soundTitle)}
                open={open === 'sound'}
                onPress={() => toggle('sound')}
                last>
                <SoundPanel sound={draft.sound} onChange={(sound) => patch({ sound })} />
              </Row>
            </>
          ) : null}

          {!isNew ? (
            <View style={s.deleteWrap}>
              <Button label={`Delete ${draft.kind}`} kind="danger" onPress={confirmDelete} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={kindMenu} transparent animationType="fade" onRequestClose={() => setKindMenu(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setKindMenu(false)}>
          <View style={[s.menu, { marginTop: insets.top + 52 }]}>
            {(['alarm', 'reminder'] as Kind[]).map((k) => (
              <Pressable key={k} style={s.menuItem} onPress={() => setKind(k)} accessibilityRole="button">
                <Icon name={k === 'alarm' ? 'alarm' : 'bell-outline'} size={22} c={color.ink} />
                <View style={s.flex}>
                  <T v="body">{k === 'alarm' ? 'Alarm' : 'Reminder'}</T>
                  <T v="foot" c={color.ink2}>
                    {k === 'alarm' ? 'Always rings, even on silent' : 'A notification, or tick to ring'}
                  </T>
                </View>
                {draft.kind === k ? <Icon name="check" size={22} c={color.ink} /> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={trying} animationType="slide" onRequestClose={() => setTrying(false)}>
        <View style={[s.tryRoot, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
          <View style={s.tryHead}>
            <T v="headline" c={color.white}>
              Practice
            </T>
            <Pressable onPress={() => setTrying(false)} hitSlop={12} accessibilityLabel="Close">
              <Icon name="close" size={26} c={color.white} />
            </Pressable>
          </View>
          {trying ? (
            <MissionRunner
              mission={draft.mission}
              onInteract={() => {}}
              onDone={() => {
                success();
                setTrying(false);
              }}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

function fmtDayLong(day: string) {
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]
  }`;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  header: {
    height: 52,
    paddingHorizontal: SIDE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  saveBtn: { paddingLeft: 8 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
  },
  nudge: { width: 48, height: 64, alignItems: 'center', justifyContent: 'center' },
  timeCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ampmCol: { alignItems: 'center', gap: 4, paddingTop: 6 },
  slider: { paddingTop: 10 },
  centerText: { textAlign: 'center', marginTop: 2 },
  block: { paddingHorizontal: SIDE, paddingTop: 10, paddingBottom: 6 },
  name: {
    fontFamily: font.semibold,
    fontSize: 20,
    lineHeight: 26,
    color: color.ink,
    paddingVertical: 8,
  },
  inline: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, paddingVertical: 12 },
  inlineLabel: { width: 72 },
  gapBlock: { height: 18, backgroundColor: color.fill, marginTop: 0 },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, minHeight: 52, gap: 12 },
  checkLabel: { flex: 1 },
  deleteWrap: { paddingTop: 28, alignItems: 'center' },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(29,27,58,0.18)', alignItems: 'center' },
  menu: {
    width: 290,
    borderRadius: 16,
    backgroundColor: color.bg,
    paddingVertical: 6,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  tryRoot: { flex: 1, backgroundColor: color.navy, paddingHorizontal: SIDE },
  tryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
});
