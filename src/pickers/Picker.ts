import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveCommand, type ProviderDescriptor} from '../providers/providers.js';
import {withFzfTheme} from '../themeBridge/targets.js';

export type PickerProviderId = 'native' | 'fzf' | 'television';
export interface PickerCandidate { id: string; label: string; description?: string; value: string }
export type PickerResult = {kind: 'selected'; candidate: PickerCandidate} | {kind: 'cancelled'} | {kind: 'fallback'; reason: string};
/** The host owns terminal release/restoration; a picker owns only selection. */
export type PickerHandoff = (run: (signal: AbortSignal) => Promise<PickerResult>) => Promise<PickerResult>;
export const PICKER_PROVIDERS: readonly ProviderDescriptor<PickerProviderId>[] = [
  {id: 'native', family: 'picker', label: 'NMSh Native', kind: 'native', description: 'search in the composer; select without executing'},
  {id: 'fzf', family: 'picker', label: 'fzf', kind: 'external', executable: 'fzf', versionArgs: ['--version'], description: 'optional terminal fuzzy picker',
    recipe: {brew: 'fzf'}, source: 'https://github.com/junegunn/fzf'},
  {id: 'television', family: 'picker', label: 'Television', kind: 'external', executable: 'tv', versionArgs: ['--version'], description: 'optional terminal fuzzy picker',
    recipe: {brew: 'television'}, source: 'https://github.com/alexpasmantier/television'},
];
const plain = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ');

/** IDs on the wire are ordinal tokens, never commands or arbitrary tool output. */
export function pickerInput(candidates: readonly PickerCandidate[]): string {
  return candidates.map((candidate, index) => `${index}\t${plain(candidate.label)}${candidate.description ? ` · ${plain(candidate.description)}` : ''}\n`).join('');
}
export function pickerSelection(output: string, candidates: readonly PickerCandidate[]): PickerResult {
  const lines = output.trimEnd().split('\n');
  if (lines.length !== 1) return {kind: 'fallback', reason: 'Picker returned an invalid selection'};
  const line = lines[0]!;
  const match = /^(0|[1-9]\d*)\t/u.exec(line);
  const candidate = match ? candidates[Number(match[1])] : undefined;
  if (!candidate || pickerInput([candidate]).replace(/^0/u, match![1]!).trimEnd() !== line)
    return {kind: 'fallback', reason: 'Picker returned an unknown selection'};
  return {kind: 'selected', candidate};
}

/** NMSh-owned fzf arguments; `layout` follows the composer side. */
export function fzfPickerArgs(layout: 'default' | 'reverse'): string[] {
  return ['--no-multi', '--no-sort', '--delimiter=\t', '--with-nth=2..', `--layout=${layout}`, '--no-mouse', '--pointer=>', '--marker=*'];
}

/** Native surfaces delegate their existing editor UI through the same boundary. */
export async function openPicker(provider: PickerProviderId, candidates: readonly PickerCandidate[], native: () => void,
  handoff: PickerHandoff, env: NodeJS.ProcessEnv = process.env, themeArgs: readonly string[] = [], layout: 'default' | 'reverse' = 'default'): Promise<PickerResult | undefined> {
  if (provider === 'native') { native(); return; }
  const binary = resolveCommand(provider === 'fzf' ? 'fzf' : 'tv', env.PATH ?? '', []);
  if (!binary) { native(); return {kind: 'fallback', reason: `${provider} is not installed; using Native`}; }
  const result = await handoff(signal => runPicker(binary, provider, candidates, signal, env, 300_000, themeArgs, layout));
  if (result.kind === 'fallback') native();
  return result;
}

/** Interactive, bounded, host-TTY process; only call while the host has handed off ownership. */
export async function runPicker(binary: string, provider: Exclude<PickerProviderId, 'native'>,
  candidates: readonly PickerCandidate[], signal: AbortSignal, env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 300_000, themeArgs: readonly string[] = [], layout: 'default' | 'reverse' = 'default'): Promise<PickerResult> {
  if (signal.aborted) return {kind: 'cancelled'};
  const input = pickerInput(candidates);
  if (candidates.length > 100_000 || Buffer.byteLength(input) > 16 * 1024 * 1024)
    return {kind: 'fallback', reason: 'Picker input exceeds the bounded limit; using Native'};
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-picker-'));
  try {
    const environment = {...env};
    for (const key of Object.keys(environment)) if (/^(?:FZF_|TV_)/u.test(key)) delete environment[key];
    let args: string[];
    // The query follows NMSh's composer: bottom (fzf's own default) or top (reverse). Never the user's standalone fzf config.
    if (provider === 'fzf') args = fzfPickerArgs(layout);
    else {
      // No user cable, hooks, preview command or persisted history is loaded.
      await writeFile(join(directory, 'config.toml'), 'history_size = 0\n', {mode: 0o600});
      await mkdir(join(directory, 'cable'));
      environment.XDG_CONFIG_HOME = directory;
      environment.XDG_DATA_HOME = directory;
      environment.XDG_CACHE_HOME = directory;
      args = ['--config-file', join(directory, 'config.toml'), '--cable-dir', join(directory, 'cable'), '--no-preview', '--no-remote', '--keybindings', 'tab="select_next_entry";backtab="select_prev_entry"'];
    }
    if (provider === 'fzf' && env.NO_COLOR !== undefined) args.push('--color=bw');
    // Theme Bridge colors (fzf only, invocation-scoped) come first, so this surface's explicit options win.
    if (provider === 'fzf') args = withFzfTheme(args, themeArgs);
    if (signal.aborted) return {kind: 'cancelled'};
    return await new Promise<PickerResult>(resolve => {
      const child = spawn(binary, args, {env: environment, stdio: ['pipe', 'pipe', 'inherit']});
      const chunks: Buffer[] = [];
      let bytes = 0;
      let failure: string | undefined;
      let aborted = false;
      let settled = false;
      const abort = () => { aborted = true; child.kill('SIGKILL'); };
      const timer = setTimeout(() => { failure = 'Picker timed out; using Native'; child.kill('SIGKILL'); }, timeoutMs);
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
      const finish = (result: PickerResult) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(result);
      };
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) { failure = 'Picker output exceeds the bounded limit; using Native'; child.kill('SIGKILL'); }
        else chunks.push(chunk);
      });
      child.stdin.on('error', () => { /* Early cancel may close stdin before candidates finish writing. */ });
      child.on('error', error => finish({kind: 'fallback', reason: `Picker failed: ${error.message}; using Native`}));
      child.on('close', code => finish(aborted || code === 1 || code === 130 ? {kind: 'cancelled'} : failure
        ? {kind: 'fallback', reason: failure} : code === 0 ? pickerSelection(Buffer.concat(chunks).toString('utf8'), candidates)
          : {kind: 'fallback', reason: `Picker exited with ${code}; using Native`}));
      child.stdin.end(input);
    });
  } catch (error) { return {kind: 'fallback', reason: `Picker failed: ${String(error)}; using Native`}; }
  finally { await rm(directory, {recursive: true, force: true}); }
}
