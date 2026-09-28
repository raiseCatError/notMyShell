import {KeyDecoder} from '../terminal/keys.js';
import type {SessionInfo} from './SessionProtocol.js';
import {describeLiveSession} from '../sessions/ResumeBrowser.js';

export type PickerChoice = {kind: 'attach'; sessionId: string} | {kind: 'new'};

export interface PickerState {
  sessions: SessionInfo[];
  /** sessions.length selects "New session". */
  selectedIndex: number;
}

/** Plain lines for the launch-time restore picker. */
export function renderPicker(state: PickerState, columns: number, now: number): string[] {
  const clip = (text: string) => (text.length > columns - 1 ? `${text.slice(0, Math.max(0, columns - 2))}…` : text);
  const rows = ['NMSh · detached live sessions', ''];
  state.sessions.forEach((session, index) => {
    rows.push(clip(`${index === state.selectedIndex ? '›' : ' '} ● ${describeLiveSession(session, now)}`));
  });
  rows.push(clip(`${state.selectedIndex === state.sessions.length ? '›' : ' '} + New session`), '',
    '↑↓ move · Enter choose · Esc new session');
  return rows;
}

/** Apply one decoded key; returns a choice once the user has made one. */
export function pickerKey(state: PickerState, kind: string): PickerChoice | undefined {
  if (kind === 'up') state.selectedIndex = Math.max(0, state.selectedIndex - 1);
  else if (kind === 'down') state.selectedIndex = Math.min(state.sessions.length, state.selectedIndex + 1);
  else if (kind === 'escape' || kind === 'interrupt') return {kind: 'new'};
  else if (kind === 'enter') {
    const session = state.sessions[state.selectedIndex];
    return session ? {kind: 'attach', sessionId: session.id} : {kind: 'new'};
  }
  return undefined;
}

/** Interactive picker on the real terminal, shown before any session is attached. */
export function runStartupPicker(sessions: SessionInfo[]): Promise<PickerChoice> {
  const state: PickerState = {sessions, selectedIndex: 0};
  const decoder = new KeyDecoder();
  const draw = () => {
    const lines = renderPicker(state, process.stdout.columns || 80, Date.now());
    process.stdout.write(`\u001b[H\u001b[2J${lines.join('\r\n')}`);
  };
  return new Promise(resolve => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdout.write('\u001b[?1049h\u001b[?25l');
    const onData = (data: string) => {
      // A read of exactly ESC is the Esc key, not the start of a sequence.
      const kinds = data === '\u001b' ? ['escape'] : decoder.push(data).map(key => key.kind);
      for (const kind of kinds) {
        const choice = pickerKey(state, kind);
        if (choice) {
          process.stdin.off('data', onData);
          process.stdin.setRawMode(wasRaw);
          process.stdin.pause();
          process.stdout.write('\u001b[?25h\u001b[?1049l');
          resolve(choice);
          return;
        }
      }
      draw();
    };
    process.stdin.on('data', onData);
    process.stdin.resume();
    draw();
  });
}
