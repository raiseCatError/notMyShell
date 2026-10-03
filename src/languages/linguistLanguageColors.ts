import {LINGUIST_LANGUAGE_COLORS} from './linguistLanguageColors.generated.js';
import {identity, type ColorRef} from '../chroma/chroma.js';

/** Neutral identity fallback for names without a Linguist color. */
export const UNKNOWN_LANGUAGE_IDENTITY_COLOR = '#8F8A98';

export function normalizeLanguageName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

const languageColors = new Map<string, string>();
for (const [name, entry] of Object.entries(LINGUIST_LANGUAGE_COLORS)) {
  languageColors.set(normalizeLanguageName(name), entry.color);
}
for (const [name, entry] of Object.entries(LINGUIST_LANGUAGE_COLORS)) {
  for (const alias of entry.aliases) {
    const normalized = normalizeLanguageName(alias);
    if (!languageColors.has(normalized)) languageColors.set(normalized, entry.color);
  }
}

/** Returns a Linguist identity color; this value carries no semantic status. */
export function languageIdentityColor(name: string): string {
  return languageColors.get(normalizeLanguageName(name)) ?? UNKNOWN_LANGUAGE_IDENTITY_COLOR;
}

/** Use Chroma's identity category at every presentation boundary. */
export function languageIdentity(name: string): ColorRef {
  const hex = languageIdentityColor(name).slice(1);
  return identity({red: parseInt(hex.slice(0, 2), 16), green: parseInt(hex.slice(2, 4), 16), blue: parseInt(hex.slice(4, 6), 16)});
}
