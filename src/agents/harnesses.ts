/**
 * The terminal agent harnesses NMSh knows, as data. Identity (executables,
 * package-runner names), presentation (glyph, safe glyph, accent) and which
 * control adapter exists live here; activity statistics, process discovery,
 * /ai, /sessions and the activity shelf all read this one registry, so a new
 * harness is a descriptor (plus an adapter where a supported protocol exists)
 * rather than changes across NMSh. NMSh never talks to model APIs itself.
 */
export interface HarnessDescriptor {
  id: string;
  /** Product name as its vendor writes it. */
  name: string;
  /** Short form for compact status lines. */
  short: string;
  /** Executable names that identify it (process name or program word). */
  executables: readonly string[];
  /** Package specifiers recognized after a package runner (npx, bunx, pnpm dlx). */
  packages: readonly string[];
  /** Truecolor accent used only when color is allowed. */
  color: string;
  glyph: string;
  safeGlyph: string;
  /** The supported machine interface NMSh can drive, when one is implemented. */
  control?: 'claude-stream-json';
  /** Truthful note when there is no control adapter (shown instead of an input box). */
  controlNote?: string;
}

export const HARNESSES: readonly HarnessDescriptor[] = [
  {id: 'claude', name: 'Claude Code', short: 'Claude', executables: ['claude'], packages: ['@anthropic-ai/claude-code'], color: '#d97757', glyph: '✻', safeGlyph: '*',
    control: 'claude-stream-json'},
  {id: 'codex', name: 'Codex CLI', short: 'Codex', executables: ['codex'], packages: ['@openai/codex'], color: '#10a37f', glyph: '◇', safeGlyph: '<>',
    controlNote: 'NMSh does not drive Codex\'s app-server protocol yet; running Codex sessions are shown, not controlled.'},
  {id: 'pi', name: 'Pi', short: 'Pi', executables: ['pi'], packages: ['@mariozechner/pi-coding-agent'], color: '#8fb3ff', glyph: 'π', safeGlyph: 'pi',
    controlNote: 'NMSh does not drive Pi\'s RPC mode yet; running Pi sessions are shown, not controlled.'},
  {id: 'gemini', name: 'Gemini CLI', short: 'Gemini', executables: ['gemini'], packages: ['@google/gemini-cli'], color: '#7b9cff', glyph: '✧', safeGlyph: 'g',
    controlNote: 'NMSh has no supported control channel for Gemini CLI; its sessions are shown, not controlled.'},
  {id: 'aider', name: 'Aider', short: 'Aider', executables: ['aider'], packages: [], color: '#58c48f', glyph: '⌁', safeGlyph: 'a',
    controlNote: 'NMSh has no supported control channel for Aider; its sessions are shown, not controlled.'},
  {id: 'opencode', name: 'OpenCode', short: 'OpenCode', executables: ['opencode'], packages: ['opencode-ai'], color: '#c9a86a', glyph: '◎', safeGlyph: 'oc',
    controlNote: 'NMSh does not drive OpenCode\'s server API yet; its sessions are shown, not controlled.'},
  {id: 'qwen', name: 'Qwen Code', short: 'Qwen', executables: ['qwen'], packages: ['@qwen-code/qwen-code'], color: '#9b8cf0', glyph: '◈', safeGlyph: 'q',
    controlNote: 'NMSh has no supported control channel for Qwen Code; its sessions are shown, not controlled.'},
];

const BY_ID = new Map(HARNESSES.map(harness => [harness.id, harness]));
export const harness = (id: string): HarnessDescriptor | undefined => BY_ID.get(id);
export const isHarnessId = (id: unknown): id is string => typeof id === 'string' && BY_ID.has(id);
const BY_EXECUTABLE = new Map(HARNESSES.flatMap(item => item.executables.map(name => [name, item] as const)));
/** The harness an exact process/program name identifies; never a fuzzy match. */
export const harnessForExecutable = (name: string): HarnessDescriptor | undefined => BY_EXECUTABLE.get(name);
