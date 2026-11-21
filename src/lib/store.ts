import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_TAGS, uid } from './defaults';
import { rollForwardIfPast } from './schedule';
import { appStorage } from './storage';
import type { Item, Line, Tag } from './types';

type State = {
  items: Item[];
  tags: Tag[];
  /** First-use hint under the slider until both handles were dragged */
  sliderHint: { alarm: boolean; pre: boolean };
  upsert: (item: Item) => void;
  remove: (id: string) => void;
  setEnabled: (id: string, on: boolean) => void;
  setDone: (id: string, occurrence: string, done: boolean) => void;
  setLines: (id: string, lines: Line[]) => void;
  addTag: (name: string, color: string) => Tag;
  updateTag: (id: string, patch: Partial<Omit<Tag, 'id'>>) => void;
  removeTag: (id: string) => void;
  markSliderUsed: (which: 'alarm' | 'pre') => void;
};

export const useStore = create<State>()(
  persist(
    (set) => ({
      items: [],
      tags: DEFAULT_TAGS,
      sliderHint: { alarm: false, pre: false },
      upsert: (item) =>
        set((s) => {
          const next = { ...item, updatedAt: Date.now() };
          const exists = s.items.some((i) => i.id === item.id);
          return { items: exists ? s.items.map((i) => (i.id === item.id ? next : i)) : [...s.items, next] };
        }),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      setEnabled: (id, on) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? (on ? rollForwardIfPast({ ...i, enabled: true }) : { ...i, enabled: false }) : i,
          ),
        })),
      setDone: (id, occurrence, done) =>
        set((s) => ({
          items: s.items.map((i) => {
            if (i.id !== id) return i;
            const rest = i.done.filter((d) => d !== occurrence);
            return { ...i, done: done ? [...rest, occurrence].slice(-60) : rest };
          }),
        })),
      setLines: (id, lines) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, lines } : i)) })),
      addTag: (name, color) => {
        const tag = { id: uid('t'), name: name.trim(), color };
        set((s) => ({ tags: [...s.tags, tag] }));
        return tag;
      },
      updateTag: (id, patch) => set((s) => ({ tags: s.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      removeTag: (id) =>
        set((s) => ({
          tags: s.tags.filter((t) => t.id !== id),
          items: s.items.map((i) => (i.tagId === id ? { ...i, tagId: null } : i)),
        })),
      markSliderUsed: (which) => set((s) => ({ sliderHint: { ...s.sliderHint, [which]: true } })),
    }),
    {
      name: 'celestial-v1',
      version: 1,
      storage: createJSONStorage(() => appStorage),
      partialize: (s) => ({ items: s.items, tags: s.tags, sliderHint: s.sliderHint }),
    },
  ),
);

/** Short-lived UI state shared between screens (toast after saving, update banner). */
type Ui = {
  toast: { text: string; undo?: () => void; id: number } | null;
  updateReady: boolean;
  showToast: (text: string, undo?: () => void) => void;
  hideToast: () => void;
  setUpdateReady: (v: boolean) => void;
};

export const useUi = create<Ui>()((set) => ({
  toast: null,
  updateReady: false,
  showToast: (text, undo) => set({ toast: { text, undo, id: Date.now() } }),
  hideToast: () => set({ toast: null }),
  setUpdateReady: (v) => set({ updateReady: v }),
}));
