import type { PartOfDay } from '../lib/format';

/** Celestial palette: white page, logo yellow as the accent, logo navy as the ink. */
export const color = {
  bg: '#FFFFFF',
  ink: '#1D1B3A',
  ink2: '#6B6982',
  ink3: '#A6A4B5',
  line: '#ECEBF1',
  fill: '#F4F4F7',
  fillStrong: '#E9E8EF',
  yellow: '#FFC93D',
  yellowDeep: '#E8A800',
  yellowSoft: '#FFF5D9',
  navy: '#26245E',
  navySoft: '#3A3878',
  red: '#E5484D',
  redSoft: '#FDECEC',
  white: '#FFFFFF',
} as const;

export const bands: Record<PartOfDay, string> = {
  night: '#E3E5F3',
  morning: '#FFF1C7',
  afternoon: '#FFE08F',
  evening: '#FFD2B5',
};

export const font = {
  light: 'Inter-Light',
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

/** Page side padding */
export const SIDE = 20;
