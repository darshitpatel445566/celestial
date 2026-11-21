import { StyleSheet, Text, type TextProps } from 'react-native';

import { color, font } from './theme';

const variants = StyleSheet.create({
  display: { fontFamily: font.light, fontSize: 64, lineHeight: 72, letterSpacing: -1.5 },
  big: { fontFamily: font.light, fontSize: 36, lineHeight: 42, letterSpacing: -0.6 },
  title: { fontFamily: font.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  headline: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: font.regular, fontSize: 17, lineHeight: 22 },
  callout: { fontFamily: font.regular, fontSize: 16, lineHeight: 21 },
  sub: { fontFamily: font.regular, fontSize: 15, lineHeight: 20 },
  subMedium: { fontFamily: font.medium, fontSize: 15, lineHeight: 20 },
  foot: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  footMedium: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  cap: { fontFamily: font.regular, fontSize: 12, lineHeight: 16 },
  micro: { fontFamily: font.medium, fontSize: 10, lineHeight: 13 },
});

export type Variant = keyof typeof variants;

type Props = TextProps & { v?: Variant; c?: string; tabular?: boolean };

export function T({ v = 'body', c = color.ink, tabular, style, ...rest }: Props) {
  return (
    <Text
      maxFontSizeMultiplier={1.15}
      {...rest}
      style={[variants[v], { color: c }, tabular ? styles.tabular : null, style]}
    />
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
});
