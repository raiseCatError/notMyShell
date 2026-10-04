/**
 * A deterministic topic summary for a recorded Ask conversation's fold row
 * ("Ask · 23 turns · files, Git & command help"), from the person's own
 * requests only. No model is used to title anything; with no clear topic
 * the row stays generic.
 */
const TOPICS: Array<[string, RegExp]> = [
  ['files', /\b(?:files?|folders?|directory|open|readme|package\.json|tsconfig|typescript files|ls)\b/u],
  ['Git', /\b(?:git|branch|commit|push|pull|diff|staged|untracked|upstream|remote|merge|rebase)\b/u],
  ['command help', /\b(?:what (?:is|does)|how (?:do|to)|syntax|options|flags|examples?|explain|mean)\b/u],
  ['project', /\b(?:scripts?|tests?|dev server|build|run the|start the|project)\b/u],
  ['config', /\b(?:config|settings?|zshrc|\.json|set \w+ to)\b/u],
  ['packages', /\b(?:brew|homebrew|install|upgrade|uninstall|packages?)\b/u],
  ['system', /\b(?:ping|disk|memory|port|processes|ip)\b/u],
  ['sessions', /\b(?:sessions?|transcripts?|resume)\b/u],
  ['NMSh settings', /\b(?:prompt|theme|chroma|cursor|suggestions|ghost text|providers?|folding|dividers?)\b/u],
  ['local model', /\b(?:local model|qwen|llm|local understanding)\b/u],
];

export function askTopics(requests: readonly string[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const request of requests) {
    const text = request.toLowerCase();
    for (const [topic, pattern] of TOPICS) if (pattern.test(text)) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([topic]) => topic);
}

export function joinTopics(topics: readonly string[]): string {
  return topics.length <= 1 ? topics.join('') : `${topics.slice(0, -1).join(', ')} & ${topics.at(-1)}`;
}

/** The fold row text: topical when the requests say what it was about, generic otherwise. */
export function askFoldLabel(turns: ReadonlyArray<{role: 'you' | 'ask'; text: string}>, request?: string): string {
  const count = turns.length;
  const requests = [...(request ? [request] : []), ...turns.filter(turn => turn.role === 'you').map(turn => turn.text)];
  const topics = askTopics(requests);
  const counted = `${count} turn${count === 1 ? '' : 's'}`;
  return topics.length ? `Ask · ${counted} · ${joinTopics(topics)} · Ctrl+O` : `Ask conversation · ${counted} · Ctrl+O`;
}
