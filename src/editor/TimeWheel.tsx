import { StyleSheet, View } from 'react-native';

import { pad } from '../lib/dates';
import { normMinutes } from '../lib/format';
import { PartIcon } from '../ui/Icon';
import { Wheel, WheelGroup } from '../ui/Wheel';

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const HALVES = ['AM', 'PM'] as const;
const ROWS = 5;
const ROW_H = 44;
const FONT = 26;

/**
 * Hour | minute | AM/PM, always open, like the iPhone. Turning the hour past 12 flips AM/PM.
 * The sun or moon beside AM/PM makes a 7 AM / 7 PM mix-up obvious.
 */
export function TimeWheel({
  minutes,
  onChange,
  band,
}: {
  minutes: number;
  /** Gets an updater, so two wheels settling at once can't undo each other */
  onChange: (update: (prev: number) => number) => void;
  band: string;
}) {
  const m = normMinutes(minutes);
  const h24 = Math.floor(m / 60);
  const pm = h24 >= 12;
  return (
    <WheelGroup rows={ROWS} rowHeight={ROW_H} band={band} style={s.group}>
      <Wheel
        values={HOURS}
        value={h24 % 12 === 0 ? 12 : h24 % 12}
        loop
        onChange={(_, steps) => onChange((prev) => normMinutes(prev + steps * 60))}
        rows={ROWS}
        rowHeight={ROW_H}
        fontSize={FONT}
        width={72}
        align="right"
        label="Hour"
      />
      <Wheel
        values={MINUTES}
        value={m % 60}
        loop
        format={pad}
        onChange={(v) => onChange((prev) => Math.floor(normMinutes(prev) / 60) * 60 + v)}
        rows={ROWS}
        rowHeight={ROW_H}
        fontSize={FONT}
        width={72}
        label="Minute"
      />
      <Wheel
        values={HALVES}
        value={pm ? 'PM' : 'AM'}
        onChange={(v) =>
          onChange((prev) => {
            const wasPm = normMinutes(prev) >= 720;
            return (v === 'PM') === wasPm ? prev : normMinutes(prev + (wasPm ? -720 : 720));
          })
        }
        rows={ROWS}
        rowHeight={ROW_H}
        fontSize={21}
        width={60}
        align="left"
        label="AM or PM"
      />
      <View style={s.icon} pointerEvents="none">
        <PartIcon minutes={m} size={24} />
      </View>
    </WheelGroup>
  );
}

const s = StyleSheet.create({
  group: { marginHorizontal: 20 },
  icon: { width: 40, justifyContent: 'center', alignItems: 'flex-start' },
});
