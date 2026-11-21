// Missions that must be solved to stop an alarm. Levels 1–5.

const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

export type MathsProblem = { text: string; answer: number };

/** 4+7 · 38+46 · 23+47+18 · 23×7 · 23×7+46 */
export function mathsProblem(level: number): MathsProblem {
  switch (Math.min(5, Math.max(1, level))) {
    case 1: {
      const a = rand(2, 9);
      const b = rand(2, 9);
      return { text: `${a} + ${b}`, answer: a + b };
    }
    case 2: {
      const a = rand(12, 89);
      const b = rand(12, 89);
      return { text: `${a} + ${b}`, answer: a + b };
    }
    case 3: {
      const a = rand(11, 49);
      const b = rand(11, 49);
      const c = rand(11, 49);
      return { text: `${a} + ${b} + ${c}`, answer: a + b + c };
    }
    case 4: {
      const a = rand(12, 39);
      const b = rand(3, 9);
      return { text: `${a} × ${b}`, answer: a * b };
    }
    default: {
      const a = rand(12, 29);
      const b = rand(3, 9);
      const c = rand(11, 59);
      return { text: `${a} × ${b} + ${c}`, answer: a * b + c };
    }
  }
}

export const MATHS_EXAMPLES = ['4 + 7', '38 + 46', '23 + 47 + 18', '23 × 7', '23 × 7 + 46'];

/** The grid grows from 3×3 and more tiles light up per level. */
export function tilesConfig(level: number): { size: number; lit: number } {
  const l = Math.min(5, Math.max(1, level));
  return [
    { size: 3, lit: 3 },
    { size: 4, lit: 5 },
    { size: 5, lit: 7 },
    { size: 6, lit: 9 },
    { size: 7, lit: 12 },
  ][l - 1];
}

export function pickTiles(size: number, lit: number): number[] {
  const all = Array.from({ length: size * size }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, lit).sort((a, b) => a - b);
}

export const TILES_LOOK_MS = 3000;

/** One short sentence per round; longer each level. */
export const SENTENCES: string[][] = [
  ['Good morning', 'Wake up now', 'Rise and shine', 'Time to get up', 'Hello new day'],
  [
    'I am awake and ready',
    'Today is a good day',
    'Open the window wide',
    'Drink a glass of water',
    'Stand up and stretch',
  ],
  [
    'Small steps every day add up',
    'I get up because my day matters',
    'Fresh air and water before my phone',
    'The first hour sets the whole day',
  ],
  [
    'I choose to start this day with energy and a clear head',
    'Every morning I keep my promise to myself and get up',
    'A calm start in the morning makes the whole day easier',
  ],
  [
    'Discipline is choosing what I want most over what I want right now, so I am getting up',
    'The bed will still be here tonight but this morning will not come back again',
    'I am awake, I am grateful, and I am ready to do the important work first',
  ],
];

export const TYPING_EXAMPLES = [
  'Good morning',
  'I am awake and ready',
  'Small steps every day add up',
  'A calm start…',
  'Discipline is choosing…',
];

export function pickSentence(level: number, own: string[], avoid?: string): string {
  const mine = own.map((x) => x.trim()).filter(Boolean);
  const pool = mine.length ? mine : SENTENCES[Math.min(5, Math.max(1, level)) - 1];
  const options = pool.length > 1 ? pool.filter((x) => x !== avoid) : pool;
  return options[Math.floor(Math.random() * options.length)];
}

/** Capitals and punctuation are ignored; spaces must match. */
export function normalizeTyping(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}\-–—_…‘’“”/\\@#*&]/g, '')
    .trim();
}
