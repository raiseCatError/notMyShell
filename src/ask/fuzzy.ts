/**
 * Conservative typo recovery for Ask: only against vocabulary NMSh already
 * knows (command names and subcommands from the local catalog, NMSh concepts,
 * slash commands, providers, shells, Ask's own verbs, and files in context).
 * It never rewrites free text and never touches a word that is itself a
 * known word or an existing file. A correction is used only when one
 * candidate is clearly closer than every other.
 */

/** Optimal-string-alignment distance (adjacent transpositions count once), stopping early past `limit`. */
export function editDistance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = Array.from({length: a.length + 1}, (_, i) => Array.from({length: b.length + 1}, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i += 1) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = value;
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
  }
  return rows[a.length]![b.length]!;
}

/** How many edits a word of this length may need: short words almost none ("gt" is never "git"). */
export function allowedEdits(length: number): number {
  return length <= 3 ? 1 : length <= 5 ? 1 : length <= 9 ? 2 : 3;
}

/**
 * The single clear correction for a word, or undefined. Three-letter words
 * accept only a transposition ("gti" → "git"); longer words a small number of
 * edits; the winner must beat the runner-up by at least one edit.
 */
export function correctWord(word: string, vocabulary: Iterable<string>): string | undefined {
  if (word.length < 3) return undefined;
  const limit = allowedEdits(word.length);
  let best: string | undefined;
  let bestDistance = Infinity;
  let second = Infinity;
  for (const candidate of vocabulary) {
    if (candidate === word) return undefined;
    if (Math.abs(candidate.length - word.length) > limit || candidate[0] !== word[0] && !(word.length > 3 && candidate[1] === word[0] && candidate[0] === word[1])) continue;
    const distance = editDistance(word, candidate, limit);
    if (distance > limit) continue;
    if (word.length === 3 && !(distance === 1 && candidate.length === 3 && [...candidate].sort().join('') === [...word].sort().join(''))) continue;
    if (distance < bestDistance) { second = bestDistance; bestDistance = distance; best = candidate; }
    else if (distance <= second && candidate !== best) second = distance;
  }
  return best && second > bestDistance ? best : undefined;
}

export interface Correction {from: string; to: string}

/** Ask's own words: verbs and nouns its capabilities understand (so "opne" is "open"). */
export const ASK_WORDS = ['open', 'show', 'list', 'find', 'where', 'what', 'which', 'switch', 'change', 'install', 'uninstall', 'upgrade', 'search', 'resume',
  'files', 'file', 'folder', 'directory', 'status', 'branch', 'commit', 'push', 'pull', 'diff', 'staged', 'untracked', 'upstream', 'remote', 'sessions', 'session',
  'transcript', 'settings', 'theme', 'prompt', 'providers', 'provider', 'config', 'configuration', 'project', 'scripts', 'tests', 'server', 'running', 'processes',
  'memory', 'disk', 'usage', 'port', 'local', 'understanding', 'model', 'cursor', 'chroma', 'suggestions', 'completion', 'folding', 'homebrew', 'brew', 'packages',
  'outdated', 'syntax', 'examples', 'explain', 'stop', 'start', 'watch', 'doctor', 'appearance', 'dividers', 'history', 'everything', 'repository', 'repo'];

export interface TypoVocabulary {
  /** Words that are never corrected (known words, file names in context). */
  known: ReadonlySet<string>;
  /** Candidate corrections for natural-language words (Ask words, concept words, slash commands, providers, shells). */
  words: readonly string[];
  /** Known command names (catalog and specs) for the request's command word. */
  commands: () => readonly string[];
  /** Subcommands of a known command ("git" → status, push…). */
  subcommands: (command: string) => readonly string[];
}

/**
 * Correct the words of a normalized request that are clearly typos of known
 * vocabulary. Paths, flags, quoted text, numbers and any word that exists as
 * a file in context are left alone. Returns undefined when nothing changed.
 */
export function correctRequest(text: string, vocabulary: TypoVocabulary): {text: string; corrections: Correction[]} | undefined {
  if (/["'`]/u.test(text)) return undefined;
  const words = text.split(' ');
  const corrections: Correction[] = [];
  const commandNames = new Set<string>();
  words.forEach((word, index) => {
    // "/provders": slash commands only against slash commands.
    if (/^\/[a-z][a-z-]{2,30}$/u.test(word) && !vocabulary.known.has(word)) {
      const slash = correctWord(word.slice(1), vocabulary.words.filter(item => item.startsWith('/')).map(item => item.slice(1)));
      if (slash) { corrections.push({from: word, to: `/${slash}`}); words[index] = `/${slash}`; }
      return;
    }
    if (!/^[a-z][a-z-]{2,30}$/u.test(word) || vocabulary.known.has(word)) return;
    const previous = index > 0 ? words[index - 1]! : undefined;
    // A subcommand of the command before it ("git statsu"), then a command name, then Ask's own words.
    const subcommands = previous && (vocabulary.known.has(previous) || commandNames.has(previous)) ? vocabulary.subcommands(previous) : [];
    let fixed = subcommands.length ? correctWord(word, subcommands) : undefined;
    if (!fixed) fixed = correctWord(word, vocabulary.words.filter(item => !item.startsWith('/')));
    if (!fixed && (index === 0 || /^(?:run|use|what is|explain)$/u.test(previous ?? ''))) {
      fixed = correctWord(word, vocabulary.commands());
      if (fixed) commandNames.add(fixed);
    }
    if (fixed) { corrections.push({from: word, to: fixed}); words[index] = fixed; }
  });
  return corrections.length ? {text: words.join(' '), corrections} : undefined;
}
