import { Pressable, StyleSheet, View } from 'react-native';

import { tick } from '../lib/haptics';
import { T } from './Text';
import { color } from './theme';

/** Two or three choices in one pill, like the iPhone segmented control. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              if (!on) {
                tick();
                onChange(o.key);
              }
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && styles.on]}>
            <T v={on ? 'subMedium' : 'sub'} c={on ? color.ink : color.ink2}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', backgroundColor: color.fill, borderRadius: 12, padding: 3 },
  segment: { flex: 1, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  on: {
    backgroundColor: color.white,
    elevation: 2,
    shadowColor: '#1D1B3A',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
});
