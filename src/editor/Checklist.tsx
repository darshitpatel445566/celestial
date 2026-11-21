import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputInstance, type TextInputKeyPressEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { uid } from '../lib/defaults';
import { tick } from '../lib/haptics';
import type { Line } from '../lib/types';
import { Checkbox } from '../ui/controls';
import { color, font } from '../ui/theme';

const newLine = (over: Partial<Line> = {}): Line => ({
  id: uid('l'),
  text: '',
  type: 'text',
  level: 0,
  done: false,
  ...over,
});

/**
 * Description with checklists: "- " starts a task, "-- " (or a swipe right) makes a subtask.
 * Enter continues the list; Enter on an empty task ends it; Backspace on an empty line steps back.
 */
export function Checklist({
  lines,
  onChange,
  placeholder = 'Description',
}: {
  lines: Line[];
  onChange: (lines: Line[]) => void;
  placeholder?: string;
}) {
  const rows = lines.length ? lines : [newLine()];
  const refs = useRef(new Map<string, TextInputInstance | null>());
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusId) return;
    const input = refs.current.get(focusId);
    if (input) {
      input.focus();
      setFocusId(null);
    }
  }, [focusId, lines]);

  const replace = (next: Line[]) => onChange(next.length ? next : [newLine()]);

  const changeText = (index: number, text: string) => {
    const line = rows[index];
    const next = rows.slice();
    if (text.includes('\n')) {
      const at = text.indexOf('\n');
      const before = text.slice(0, at);
      const after = text.slice(at + 1).replace(/\n/g, ' ');
      if (line.type === 'task' && before.trim() === '' && after === '') {
        // Enter on an empty task leaves the list.
        next[index] = { ...line, type: line.level === 1 ? 'task' : 'text', level: 0, text: '' };
        replace(next);
        return;
      }
      next[index] = { ...line, text: before };
      const added = newLine({ type: line.type, level: line.level, text: after });
      next.splice(index + 1, 0, added);
      replace(next);
      setFocusId(added.id);
      return;
    }
    const sub = /^(--|—|–)\s/.exec(text);
    if (sub) {
      next[index] = { ...line, type: 'task', level: 1, text: text.slice(sub[0].length) };
      tick();
    } else if (/^-\s/.test(text) && (line.type === 'text' || line.level === 0)) {
      next[index] = { ...line, type: 'task', level: line.type === 'task' ? 1 : 0, text: text.slice(2) };
      tick();
    } else {
      next[index] = { ...line, text };
    }
    replace(next);
  };

  const keyPress = (index: number, e: TextInputKeyPressEvent) => {
    if (e.nativeEvent.key !== 'Backspace') return;
    const line = rows[index];
    if (line.text !== '') return;
    const next = rows.slice();
    if (line.type === 'task' && line.level === 1) {
      next[index] = { ...line, level: 0 };
    } else if (line.type === 'task') {
      next[index] = { ...line, type: 'text' };
    } else if (index > 0) {
      next.splice(index, 1);
      setFocusId(rows[index - 1].id);
    } else {
      return;
    }
    replace(next);
  };

  const setLevel = (index: number, level: 0 | 1) => {
    const line = rows[index];
    if (line.type !== 'task' || line.level === level) return;
    const next = rows.slice();
    next[index] = { ...line, level };
    tick();
    replace(next);
  };

  const toggle = (index: number) => {
    const next = rows.slice();
    next[index] = { ...rows[index], done: !rows[index].done };
    tick();
    replace(next);
  };

  return (
    <View>
      {rows.map((line, i) => (
        <LineRow
          key={line.id}
          line={line}
          placeholder={i === 0 && rows.length === 1 ? placeholder : undefined}
          inputRef={(r) => {
            refs.current.set(line.id, r);
          }}
          onText={(t) => changeText(i, t)}
          onKey={(e) => keyPress(i, e)}
          onToggle={() => toggle(i)}
          onIndent={() => setLevel(i, 1)}
          onOutdent={() => setLevel(i, 0)}
        />
      ))}
    </View>
  );
}

function LineRow({
  line,
  placeholder,
  inputRef,
  onText,
  onKey,
  onToggle,
  onIndent,
  onOutdent,
}: {
  line: Line;
  placeholder?: string;
  inputRef: (r: TextInputInstance | null) => void;
  onText: (t: string) => void;
  onKey: (e: TextInputKeyPressEvent) => void;
  onToggle: () => void;
  onIndent: () => void;
  onOutdent: () => void;
}) {
  const handlers = useRef({ onIndent, onOutdent });
  useEffect(() => {
    handlers.current = { onIndent, onOutdent };
  });
  const config = useMemo(
    () => ({
      runOnJS: true,
      activeOffsetX: [-24, 24] as [number, number],
      failOffsetY: [-10, 10] as [number, number],
      onDeactivate: (e: { translationX: number }) => {
        if (e.translationX > 40) handlers.current.onIndent();
        else if (e.translationX < -40) handlers.current.onOutdent();
      },
    }),
    [],
  );
  const swipe = usePanGesture(config);
  const isTask = line.type === 'task';
  return (
    <GestureDetector gesture={swipe}>
      <View style={[s.row, isTask && line.level === 1 && s.sub]}>
        {isTask ? (
          <View style={s.box}>
            <Checkbox checked={line.done} onPress={onToggle} size={20} round />
          </View>
        ) : null}
        <TextInput
          ref={inputRef}
          value={line.text}
          onChangeText={onText}
          onKeyPress={onKey}
          placeholder={placeholder}
          placeholderTextColor={color.ink3}
          multiline
          scrollEnabled={false}
          style={[s.input, isTask && line.done && s.doneText]}
          accessibilityLabel={isTask ? 'Task' : 'Description'}
        />
      </View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  sub: { paddingLeft: 28 },
  box: { paddingTop: 9, paddingRight: 10 },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 22,
    color: color.ink,
    paddingVertical: 8,
    paddingHorizontal: 0,
    textAlignVertical: 'top',
  },
  doneText: { color: color.ink3, textDecorationLine: 'line-through' },
});
