import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { success, tick, wrong } from '../lib/haptics';
import { mathsProblem, normalizeTyping, pickSentence, pickTiles, tilesConfig, TILES_LOOK_MS } from '../lib/missions';
import type { Mission } from '../lib/types';
import { Icon } from '../ui/Icon';
import { T } from '../ui/Text';
import { color, font } from '../ui/theme';

const DIM = 'rgba(255,255,255,0.62)';
const FAINT = 'rgba(255,255,255,0.12)';

type Common = { level: number; onSolved: () => void; onInteract: () => void };

function useShake() {
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const shake = () => {
    x.set(
      withSequence(
        withTiming(-10, { duration: 50 }),
        withRepeat(withTiming(10, { duration: 80 }), 3, true),
        withTiming(0, { duration: 50 }),
      ),
    );
  };
  return { style, shake };
}

export function MathsMission({ level, onSolved, onInteract }: Common) {
  const problem = useMemo(() => mathsProblem(level), [level]);
  const [entry, setEntry] = useState('');
  const { style, shake } = useShake();
  const press = (k: string) => {
    onInteract();
    tick();
    if (k === 'del') setEntry((e) => e.slice(0, -1));
    else if (k === 'ok') {
      if (Number(entry) === problem.answer && entry !== '') {
        success();
        onSolved();
      } else {
        wrong();
        shake();
        setEntry('');
      }
    } else if (entry.length < 6) setEntry((e) => e + k);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  return (
    <View style={s.fill}>
      <View style={s.center}>
        <T v="big" c={color.white} tabular style={s.problem}>
          {problem.text} =
        </T>
        <Animated.View style={[s.answer, style]}>
          <T v="display" c={entry ? color.white : DIM} tabular>
            {entry || '?'}
          </T>
        </Animated.View>
      </View>
      <View style={s.keypad}>
        {keys.map((k) => (
          <Pressable
            key={k}
            onPress={() => press(k)}
            accessibilityLabel={k === 'del' ? 'Delete' : k === 'ok' ? 'Check' : k}
            style={({ pressed }) => [s.key, k === 'ok' && s.keyOk, pressed && s.keyPressed]}>
            {k === 'del' ? (
              <Icon name="backspace-outline" size={26} c={color.white} />
            ) : k === 'ok' ? (
              <Icon name="check" size={30} c={color.ink} />
            ) : (
              <T v="title" c={color.white}>
                {k}
              </T>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function TilesMission({ level, onSolved, onInteract }: Common) {
  const { size, lit } = tilesConfig(level);
  const target = useMemo(() => pickTiles(size, lit), [size, lit]);
  const [phase, setPhase] = useState<'look' | 'play'>('look');
  const [found, setFound] = useState<number[]>([]);
  const [miss, setMiss] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [hint, setHint] = useState(false);
  const progress = useSharedValue(1);

  useEffect(() => {
    progress.set(withTiming(0, { duration: TILES_LOOK_MS }));
    const id = setTimeout(() => setPhase('play'), TILES_LOOK_MS);
    return () => clearTimeout(id);
  }, [progress]);

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), 1100);
    return () => clearTimeout(id);
  }, [hint]);

  const bar = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));

  const tap = (i: number) => {
    if (phase !== 'play') return;
    onInteract();
    if (found.includes(i)) return;
    if (target.includes(i)) {
      tick();
      const next = [...found, i];
      setFound(next);
      if (next.length === target.length) {
        success();
        setTimeout(onSolved, 250);
      }
    } else {
      wrong();
      setMiss(i);
      setTimeout(() => setMiss(null), 350);
      const m = mistakes + 1;
      setMistakes(m);
      if (m % 2 === 0) setHint(true);
    }
  };

  const gap = 8;
  return (
    <View style={s.fill}>
      <View style={s.tilesHead}>
        <T v="headline" c={color.white}>
          {phase === 'look' ? 'Remember the lit tiles' : `Tap the tiles you saw · ${found.length} of ${lit}`}
        </T>
        <View style={s.barTrack}>{phase === 'look' ? <Animated.View style={[s.bar, bar]} /> : null}</View>
        {hint ? (
          <T v="foot" c={DIM}>
            Here they are again
          </T>
        ) : null}
      </View>
      <View style={s.gridWrap}>
        <View style={[s.grid, { gap }]}>
          {Array.from({ length: size }, (_, r) => (
            <View key={r} style={[s.gridRow, { gap }]}>
              {Array.from({ length: size }, (_, c) => {
                const i = r * size + c;
                const show = phase === 'look' || hint ? target.includes(i) : found.includes(i);
                return (
                  <Pressable
                    key={i}
                    onPress={() => tap(i)}
                    accessibilityLabel={`Tile ${i + 1}`}
                    style={[s.tile, show && s.tileOn, miss === i && s.tileMiss]}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

export function TypingMission({ level, onSolved, onInteract, own }: Common & { own: string[] }) {
  const sentence = useMemo(() => pickSentence(level, own), [level, own]);
  const [text, setText] = useState('');
  const target = normalizeTyping(sentence);
  const typed = normalizeTyping(text);
  const ok = target.startsWith(typed);
  const input = useRef<TextInputInstance>(null);
  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 300);
    return () => clearTimeout(id);
  }, []);
  const change = (t: string) => {
    onInteract();
    setText(t);
    if (normalizeTyping(t) === target) {
      success();
      onSolved();
    }
  };
  return (
    <View style={s.fill}>
      <T v="foot" c={DIM} style={s.typeLabel}>
        Type this. Capitals and punctuation don’t matter; spaces do.
      </T>
      <View style={s.sentenceCard}>
        <T v="title" c={color.white} style={s.sentence}>
          {sentence}
        </T>
      </View>
      <TextInput
        ref={input}
        value={text}
        onChangeText={change}
        autoCorrect={false}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        contextMenuHidden
        keyboardType="visible-password"
        importantForAutofill="no"
        placeholder="Start typing…"
        placeholderTextColor={DIM}
        style={[s.typeInput, !ok && s.typeWrong]}
        multiline
        accessibilityLabel="Type the sentence"
      />
    </View>
  );
}

/** Runs the chosen mission for the configured number of rounds. */
export function MissionRunner({
  mission,
  onDone,
  onInteract,
}: {
  mission: Mission;
  onDone: () => void;
  onInteract: () => void;
}) {
  const rounds = Math.max(1, mission.rounds);
  const [round, setRound] = useState(1);
  const solved = () => {
    if (round >= rounds) onDone();
    else setRound((r) => r + 1);
  };
  const common = { level: mission.level, onSolved: solved, onInteract };
  return (
    <View style={s.fill}>
      <View style={s.rounds}>
        {Array.from({ length: rounds }, (_, i) => (
          <View key={i} style={[s.roundDot, i < round - 1 && s.roundDone, i === round - 1 && s.roundNow]} />
        ))}
        <T v="footMedium" c={DIM} style={s.roundText}>
          Round {round} of {rounds}
        </T>
      </View>
      {mission.type === 'maths' ? <MathsMission key={round} {...common} /> : null}
      {mission.type === 'tiles' ? <TilesMission key={round} {...common} /> : null}
      {mission.type === 'typing' ? <TypingMission key={round} {...common} own={mission.sentences} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  problem: { marginBottom: 8 },
  answer: { minHeight: 76, justifyContent: 'center' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, paddingBottom: 8 },
  key: {
    width: '31%',
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FAINT,
  },
  keyOk: { backgroundColor: color.yellow },
  keyPressed: { opacity: 0.6 },
  tilesHead: { alignItems: 'center', gap: 10, paddingTop: 8, minHeight: 84 },
  barTrack: { width: 160, height: 4, borderRadius: 2, backgroundColor: FAINT, overflow: 'hidden' },
  bar: { height: 4, backgroundColor: color.yellow },
  gridWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grid: { width: '100%', aspectRatio: 1, maxWidth: 380 },
  gridRow: { flex: 1, flexDirection: 'row' },
  tile: { flex: 1, borderRadius: 10, backgroundColor: FAINT },
  tileOn: { backgroundColor: color.yellow },
  tileMiss: { backgroundColor: color.red },
  typeLabel: { textAlign: 'center', marginTop: 8, marginBottom: 16 },
  sentenceCard: { padding: 20, borderRadius: 20, backgroundColor: FAINT, marginBottom: 20 },
  sentence: { textAlign: 'center' },
  typeInput: {
    fontFamily: font.regular,
    fontSize: 20,
    lineHeight: 28,
    color: color.white,
    borderBottomWidth: 2,
    borderBottomColor: color.yellow,
    paddingVertical: 10,
    minHeight: 56,
  },
  typeWrong: { borderBottomColor: color.red, color: '#FFB4B6' },
  rounds: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  roundDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: FAINT },
  roundDone: { backgroundColor: color.yellow },
  roundNow: { backgroundColor: color.white },
  roundText: { marginLeft: 8 },
});
