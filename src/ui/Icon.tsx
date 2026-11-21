import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { partOfDay, type PartOfDay } from '../lib/format';
import { color } from './theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type Props = { name: IconName; size?: number; c?: string; style?: StyleProp<TextStyle> };

export function Icon({ name, size = 20, c = color.ink, style }: Props) {
  return <MaterialCommunityIcons name={name} size={size} color={c} style={style} />;
}

const PART_ICON: Record<PartOfDay, IconName> = {
  morning: 'weather-sunset-up',
  afternoon: 'white-balance-sunny',
  evening: 'weather-sunset-down',
  night: 'weather-night',
};

export const PART_COLOR: Record<PartOfDay, string> = {
  morning: '#EFA21B',
  afternoon: '#E8A800',
  evening: '#E0743A',
  night: '#4A4790',
};

export const PART_NAME: Record<PartOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

/** Sunrise, sun, sunset or moon for the time of day: makes AM/PM mix-ups obvious. */
export function PartIcon({ minutes, size = 22, c }: { minutes: number; size?: number; c?: string }) {
  const p = partOfDay(minutes);
  return <Icon name={PART_ICON[p]} size={size} c={c ?? PART_COLOR[p]} />;
}

export const ENERGY_ICONS: IconName[] = ['battery-outline', 'battery-low', 'battery-medium', 'battery-high'];

export const MISSION_ICONS: Record<'maths' | 'tiles' | 'typing', IconName> = {
  maths: 'calculator-variant-outline',
  tiles: 'view-grid-outline',
  typing: 'keyboard-outline',
};
