import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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
  EndRepeatRow,
  MissionPanel,
  missionLabel,
  RepeatRow,
  SnoozePanel,
  snoozeLabel,
  SoundPanel,
  soundLabel,
  WindowPanel,
} from '../editor/panels';
import { Calendar, EnergyPicker, TagPicker } from '../editor/pickers';
import { TimelineSlider } from '../editor/TimelineSlider';
import { TimeWheel } from '../editor/TimeWheel';
import { addDays, atTime, diffDays, minutesOf, today as todayYmd, ymd } from '../lib/dates';
import { newItem } from '../lib/defaults';
import {
  cancelSnooze,
  hasEngine,
  loadSounds,
  requestNotifications,
  soundTitle,
  updateShownTasks,
} from '../lib/engine';
import { fmtDate, fmtDay, fmtLeft, fmtMinutes, fmtRange, fromLabel, untilLabel, windowIsOff } from '../lib/format';
import { success, tick } from '../lib/haptics';
import { effectiveDay, fromDays, nextRing, ringsLikeAlarm, rollForwardIfPast, untilDay } from '../lib/schedule';
import { useStore, useUi } from '../lib/store';
import type { Item, Kind, Line } from '../lib/types';
import { MissionRunner } from '../missions/Missions';
import { Button, Checkbox, Divider, Row } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Popover, useAnchor } from '../ui/popups';
import { T } from '../ui/Text';
import { accentFor, color, font, SIDE } from '../ui/theme';
import { Wheel, WheelGroup, WheelLabel } from '../ui/Wheel';

type OpenKey = 'gap' | 'window' | 'mission' | 'snooze' | 'sound';

const GAPS = [...Array.from({ length: 60 }, (_, i) => i + 1), 75, 90, 120];

function nextMinute(now = Date.now()) {
  return new Date(now + 60000 - (now % 60000));
}

function cleanLines(lines: Line[]): Line[] {
  const out = lines.map((l) => ({ ...l, text: l.text.replace(/\s+$/, '') }));
  while (out.length && out[out.length - 1].type === 'text' && out[out.length - 1].text === '') out.pop();
  return out.filter((l) => l.type === 'text' || l.text !== '');
}

function windowValue(item: Item, day: string): string {
  if (windowIsOff(item)) return 'Off';
  if (item.repeat === 'once') return fmtRange(addDays(day, -fromDays(item, day)), untilDay(item, day));
  const parts: string[] = [];
  if (item.from.kind !== 'none') parts.push(fromLabel(item.from));
  if (item.until.kind !== 'event') parts.push(untilLabel(item.until));
  return parts.join(' – ');
}

/** "Today, Sun 22 Nov" · "Tomorrow, Mon 23 Nov" · "Wed 25 Nov" */
function dayValue(day: string): string {
  const rel = fmtDay(day);
  return rel === 'Today' || rel === 'Tomorrow' ? `${rel}, ${fmtDate(day)}` : rel;
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
  const dateAnchor = useAnchor<'date'>();
  const isNew = !existing;
  const accent = accentFor(draft.kind);

  useEffect(() => {
    loadSounds().then(() => setSoundsReady((n) => n + 1));
  }, []);

  const patch = (p: Partial<Item>) => setDraft((d) => ({ ...d, ...p }));
  const toggle = (k: OpenKey) => {
    tick();
    setOpen((o) => (o === k ? null : k));
  };

  const now = new Date();
  // Any time can be chosen: if it has already passed today, it rings tomorrow.
  const day = effectiveDay(draft, now);
  const alarmAt = atTime(day, draft.time);
  const minAt = nextMinute();
  const rings = ringsLikeAlarm(draft);
  const today = todayYmd(now);
  const firstDay = atTime(today, draft.time).getTime() > now.getTime() ? today : addDays(today, 1);

  /** The slider moves the alarm to a moment; repeating series shift by the same number of days. */
  const setMoment = (d: Date) => {
    const at = d.getTime() < minAt.getTime() ? minAt : d;
    if (draft.repeat === 'once') {
      patch({ date: ymd(at), time: minutesOf(at) });
      return;
    }
    const delta = diffDays(day, ymd(at));
    patch({ date: addDays(draft.date, delta), time: minutesOf(at) });
  };

  const pickDate = (d: string) => {
    const endRepeat = draft.endRepeat && draft.endRepeat < d ? null : draft.endRepeat;
    patch({ date: d, endRepeat });
    setTimeout(dateAnchor.close, 160);
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
    if (item.repeat === 'once') item = { ...item, date: effectiveDay(item) };
    item = rollForwardIfPast(item);
    const prev = existing;
    upsert(item);
    updateShownTasks(item);
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
  const hint = !sliderHint.alarm || !sliderHint.pre;

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
          {draft.kind === 'reminder' ? <Icon name="bell-outline" size={18} c={color.blue} style={s.titleIcon} /> : null}
          <T v="headline">{title}</T>
          <Icon name="menu-down" size={22} c={color.ink} />
        </Pressable>
        <Pressable onPress={save} hitSlop={12} accessibilityRole="button" style={s.saveBtn}>
          <T v="headline" c={draft.kind === 'reminder' ? color.blue : color.ink}>
            Save
          </T>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={s.flex}
          contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={s.timeWrap}>
            <TimeWheel
              minutes={draft.time}
              onChange={(update) => setDraft((d) => ({ ...d, time: update(d.time) }))}
              band={accent.soft}
            />
          </View>

          <Row
            label="Date"
            value={dayValue(day)}
            popup
            rowRef={dateAnchor.ref('date')}
            onPress={() => {
              tick();
              dateAnchor.show('date');
            }}
          />
          <Popover anchor={dateAnchor.rectFor('date')} onClose={dateAnchor.close} estimate={360}>
            <Calendar value={day} min={firstDay} onChange={pickDate} accent={accent} />
          </Popover>

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
              accent={accent.main}
            />
          </View>

          {draft.lead > 0 ? (
            <Row label="Gap" value={fmtMinutes(draft.gap)} open={open === 'gap'} onPress={() => toggle('gap')}>
              <WheelGroup>
                <Wheel
                  values={GAPS}
                  value={GAPS.includes(draft.gap) ? draft.gap : 15}
                  onChange={setGap}
                  onConfirm={() => setOpen(null)}
                  width={72}
                  align="right"
                  label="Gap"
                />
                <WheelLabel text="min apart" width={110} />
              </WheelGroup>
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
            <Checklist lines={draft.lines} onChange={(lines) => patch({ lines })} accent={accent} />
          </View>
          <Divider />
          <View style={s.tags}>
            <TagPicker value={draft.tagId} onChange={(tagId) => patch({ tagId })} accent={accent} />
          </View>
          <Divider />
          <View style={s.energy}>
            <EnergyPicker value={draft.energy} onChange={(energy) => patch({ energy })} accent={accent} />
          </View>
          <View style={s.gapBlock} />

          {/* When it repeats */}
          <RepeatRow item={draft} onChange={patch} accent={accent} />
          {draft.repeat !== 'once' ? <EndRepeatRow item={draft} onChange={patch} accent={accent} /> : null}
          <Row
            label="Remind every day"
            value={windowValue(draft, day)}
            open={open === 'window'}
            onPress={() => toggle('window')}
            last={draft.kind === 'alarm'}>
            <WindowPanel item={draft} onChange={patch} accent={accent} />
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
                accent={accent}
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
                  accent={accent}
                />
              </Row>
              <Row
                label="Snooze"
                value={snoozeLabel(draft.snooze)}
                open={open === 'snooze'}
                onPress={() => toggle('snooze')}>
                <SnoozePanel
                  snooze={draft.snooze}
                  onChange={(snooze) => patch({ snooze })}
                  onClose={() => setOpen(null)}
                />
              </Row>
              <Row
                label="Sound"
                value={soundLabel(draft.sound, soundTitle)}
                open={open === 'sound'}
                onPress={() => toggle('sound')}
                last>
                <SoundPanel
                  sound={draft.sound}
                  onChange={(sound) => patch({ sound })}
                  title={soundTitle}
                  accent={accent}
                />
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
                <Icon
                  name={k === 'alarm' ? 'alarm' : 'bell-outline'}
                  size={22}
                  c={k === 'alarm' ? color.ink : color.blue}
                />
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
        <View
          style={[
            s.tryRoot,
            { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 },
            draft.kind === 'reminder' && s.tryReminder,
          ]}>
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
              accent={draft.kind === 'reminder' ? color.white : color.yellow}
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
  titleIcon: { marginRight: 6 },
  saveBtn: { paddingLeft: 8 },
  timeWrap: { paddingTop: 4, paddingBottom: 10 },
  slider: { paddingTop: 10 },
  block: { paddingHorizontal: SIDE, paddingTop: 10, paddingBottom: 6 },
  name: {
    fontFamily: font.semibold,
    fontSize: 20,
    lineHeight: 26,
    color: color.ink,
    paddingVertical: 8,
  },
  tags: { paddingVertical: 12 },
  energy: { paddingHorizontal: SIDE, paddingVertical: 12 },
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
  tryReminder: { backgroundColor: color.blueNight },
  tryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
});
