import type {RgbColor} from '../ui/palette.js';

/**
 * Session signatures: a short familiar word and a subtle accent, so a
 * person can tell sessions apart without reading ids. The vocabulary is small
 * and plain (seasons, simple colors, fruits, vegetables). The name is the
 * primary cue; the color is secondary and never the only one. Internally a
 * session is still identified by its real id.
 */
export interface Signature {name: string; accent: RgbColor}

const rgb = (hex: string): RgbColor => ({red: parseInt(hex.slice(1, 3), 16), green: parseInt(hex.slice(3, 5), 16), blue: parseInt(hex.slice(5, 7), 16)});

/** Accents avoid the pure success green / failure red / warning amber so they never read as status. */
export const SIGNATURES: readonly Signature[] = [
  {name: 'Spring', accent: rgb('#9ad7a8')}, {name: 'Summer', accent: rgb('#f2c46d')}, {name: 'Autumn', accent: rgb('#d99a62')}, {name: 'Winter', accent: rgb('#9fb8d9')},
  {name: 'Blue', accent: rgb('#7aa2e8')}, {name: 'Green', accent: rgb('#7fc4a0')}, {name: 'Violet', accent: rgb('#b49ae8')}, {name: 'Teal', accent: rgb('#6cc5c0')},
  {name: 'Mango', accent: rgb('#f0b35a')}, {name: 'Peach', accent: rgb('#f2a88a')}, {name: 'Plum', accent: rgb('#b882c9')}, {name: 'Apple', accent: rgb('#e88f8f')},
  {name: 'Lemon', accent: rgb('#e6d873')}, {name: 'Cherry', accent: rgb('#d97a9a')}, {name: 'Kiwi', accent: rgb('#a8c96a')}, {name: 'Fig', accent: rgb('#a48bb5')},
  {name: 'Carrot', accent: rgb('#e89a5a')}, {name: 'Olive', accent: rgb('#a3a86a')}, {name: 'Pepper', accent: rgb('#d9866e')}, {name: 'Basil', accent: rgb('#86b98a')},
  {name: 'Radish', accent: rgb('#d98aa6')}, {name: 'Pea', accent: rgb('#9fcf8a')}, {name: 'Leek', accent: rgb('#b5cf9a')}, {name: 'Beet', accent: rgb('#b8718f')},
];

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

/**
 * A name for a new session: deterministic from its id, the first one not in
 * use by another live session. Only when every familiar name is taken does a
 * small suffix appear ("Mango 2"), never a random tag.
 */
export function assignSignature(id: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const start = hash(id) % SIGNATURES.length;
  for (let offset = 0; offset < SIGNATURES.length; offset += 1) {
    const name = SIGNATURES[(start + offset) % SIGNATURES.length]!.name;
    if (!used.has(name)) return name;
  }
  for (let suffix = 2; ; suffix += 1) {
    const name = `${SIGNATURES[start]!.name} ${suffix}`;
    if (!used.has(name)) return name;
  }
}

/** The accent for a signature name ("Mango 2" uses Mango's), undefined for names outside the vocabulary. */
export function signatureAccent(name: string | undefined): RgbColor | undefined {
  if (!name) return undefined;
  const base = name.replace(/ \d+$/u, '');
  return SIGNATURES.find(item => item.name === base)?.accent;
}

/** What to show for a session: the person's own name if they renamed it, else its signature. */
export function sessionDisplayName(session: {name?: string; signature?: string}, fallback: string): string {
  return session.name || session.signature || fallback;
}
