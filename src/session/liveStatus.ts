import type {SessionInfo} from './SessionProtocol.js';
import {formatAge} from './sessionList.js';

/**
 * Display names for well-known interactive CLIs, agents included. Labels only:
 * every program gets the same evidence and the same states, recognized or not.
 */
export const KNOWN_CLI_NAMES: Readonly<Record<string, string>> = {
  claude: 'Claude Code', codex: 'Codex', aider: 'Aider', gemini: 'Gemini CLI', opencode: 'OpenCode',
  goose: 'Goose', 'cursor-agent': 'Cursor Agent', amp: 'Amp', crush: 'Crush', qwen: 'Qwen Code',
};

/** Output newer than this reads as active; older as quiet. */
export const ACTIVE_OUTPUT_MS = 10_000;

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** The program word of a command line, skipping leading VAR=value assignments. */
export function commandWord(command: string): string | undefined {
  for (const word of command.trim().split(/\s+/u)) {
    if (!word || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(word)) continue;
    return baseName(word);
  }
  return undefined;
}

/** A known CLI's display name, from the command line or the foreground process. */
export function knownProgram(session: SessionInfo): string | undefined {
  const word = session.running ? commandWord(session.running) : undefined;
  return (word && KNOWN_CLI_NAMES[word]) || (session.process && KNOWN_CLI_NAMES[baseName(session.process)]) || undefined;
}

/**
 * Factual status from service evidence. Every clause is something the session
 * reported: what runs, whether it wrote recently, whether it asked for
 * attention, the title it set, or how the last command ended. Nothing is
 * inferred about what a program is waiting for; unknown stays unsaid.
 */
export function liveStatusParts(session: SessionInfo, now: number): string[] {
  if (!session.running) {
    const parts = [`idle${session.idleSince ? ` ${formatAge(now - session.idleSince)}` : ''}`];
    if (session.lastExit !== undefined) parts.push(session.lastExit === 0 ? 'last command succeeded' : `last command failed (exit ${session.lastExit})`);
    return parts;
  }
  const parts = [`running ${session.running.replace(/\s+/gu, ' ').slice(0, 60)} · ${formatAge(now - (session.runningSince ?? now))}`];
  const known = knownProgram(session);
  if (known) parts.push(known);
  else if (session.process && session.process !== commandWord(session.running)) parts.push(`process ${session.process}`);
  if (session.attentionSince !== undefined) parts.push(`needs attention ${formatAge(now - session.attentionSince)}`);
  else if (session.lastOutputAt !== undefined) {
    const quietFor = now - session.lastOutputAt;
    parts.push(quietFor < ACTIVE_OUTPUT_MS ? 'active' : `quiet ${formatAge(quietFor)}`);
  }
  if (session.fullscreen) parts.push('fullscreen');
  if (session.title) parts.push(`“${session.title.slice(0, 40)}”`);
  return parts;
}
