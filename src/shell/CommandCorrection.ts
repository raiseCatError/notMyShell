import {access, readdir, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {delimiter, isAbsolute, join} from 'node:path';
import {stripAnsi, truncateAnsi} from '../util/text.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {renderActionHelp, type UiAction} from '../ui/actions.js';
import {classifyShellFailure} from './ShellKnowledge.js';

export interface CommandCorrection {correction: true; name: string; insertion: string; original: string; description: string}
export const CORRECTION_ACTIONS: readonly UiAction[] = [
  {id: 'insert', label: 'edit', keyLabel: 'Tab', kinds: ['complete']},
  {id: 'dismiss', label: 'dismiss', keyLabel: 'Esc', kinds: ['escape']},
];
const dangerous = new Set(['rm', 'rmdir', 'mv', 'dd', 'sudo', 'su', 'doas', 'chmod', 'chown', 'chgrp', 'kill', 'killall',
  'pkill', 'shutdown', 'reboot', 'halt', 'mkfs', 'fdisk', 'diskutil', 'truncate', 'unlink', 'eval', 'exec']);
const commandName = /^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/u;

/** One insertion/deletion/transposition; substitution is permitted only for longer words. */
export function closeCommand(typed: string, known: string, countShortSubstitution = false): boolean {
  if (typed === known || Math.abs(typed.length - known.length) > 1) return false;
  if (typed.length === known.length) {
    const differences = [...typed].map((letter, index) => letter === known[index] ? -1 : index).filter(index => index !== -1);
    if (differences.length === 1) return countShortSubstitution || typed.length >= 5;
    return differences.length === 2 && differences[1] === differences[0]! + 1
      && typed[differences[0]!] === known[differences[1]!] && typed[differences[1]!] === known[differences[0]!];
  }
  const longer = typed.length > known.length ? typed : known;
  const shorter = typed.length > known.length ? known : typed;
  let index = 0;
  while (index < shorter.length && longer[index] === shorter[index]) index++;
  return longer.slice(index + 1) === shorter.slice(index);
}

export function correctionTarget(input: string, names: readonly string[]): string | undefined {
  if (!commandName.test(input) || names.includes(input)) return;
  const matches = [...new Set(names)].filter(name => commandName.test(name) && closeCommand(input, name, true));
  if (matches.length !== 1 || !closeCommand(input, matches[0]!) || dangerous.has(matches[0]!)) return;
  return matches[0];
}

export class CommandCorrectionService {
  private cache?: {path: string; at: number; files: Map<string, string[]>};
  private shellPath?: string;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** The PATH the live shell reports (rc files often extend NMSh's own); undefined falls back to NMSh's. */
  usePath(path: string | undefined): void { this.shellPath = path; }

  async suggest(command: string, exitCode: number, output: string, signal?: AbortSignal): Promise<CommandCorrection | undefined> {
    // No quotes, substitutions, redirections, pipelines, assignments, multiline or leading-space private input.
    const match = /^([a-zA-Z][a-zA-Z0-9_-]{2,31})(?:[ \t]+[a-zA-Z0-9_./:@%+=,-]+)*[ \t]*$/u.exec(command);
    if (exitCode !== 127 || !match || signal?.aborted) return;
    const typed = match[1]!;
    // The shell's own diagnostic for exactly this word: zsh, Bash ("bash: gti: command not found") or Fish ("fish: Unknown command: gti").
    const diagnostic = stripAnsi(output).split('\n').some(line => new RegExp(`^(?:zsh(?::[^:]+)*: |nmsh: )?command not found: ${typed}\\s*$`, 'u').test(line.trim()))
      || classifyShellFailure(command, exitCode, output) === 'command-not-found';
    if (!diagnostic) return;
    const files = await this.commandFiles(signal);
    if (signal?.aborted) return;
    const possible = [...files.keys()].filter(name => name === typed || closeCommand(typed, name, true));
    const executable: string[] = [];
    for (const name of possible) {
      if (signal?.aborted) return;
      for (const file of files.get(name)!) {
        try {
          await access(file, constants.X_OK);
          if (!(await stat(file)).isFile()) continue;
          executable.push(name); break;
        } catch { /* Missing, unreadable or non-executable entries are not candidates. */ }
      }
    }
    const target = correctionTarget(typed, executable);
    if (!target || signal?.aborted) return;
    const insertion = target + command.slice(typed.length);
    return {correction: true, original: command, insertion, name: insertion,
      description: 'Correction · Tab edits · press Enter separately'};
  }

  private async commandFiles(signal?: AbortSignal): Promise<Map<string, string[]>> {
    const path = this.shellPath ?? this.env.PATH ?? '';
    if (this.cache?.path === path && Date.now() - this.cache.at < 60_000) return this.cache.files;
    const files = new Map<string, string[]>();
    let count = 0;
    const directories = path.split(delimiter).filter(isAbsolute);
    if (directories.length > 64) return files;
    for (const directory of directories) {
      if (signal?.aborted) return files;
      try {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
          if (++count > 20_000) return new Map(); // An incomplete namespace cannot justify a unique correction.
          if (entry.isDirectory() || !commandName.test(entry.name)) continue;
          const locations = files.get(entry.name) ?? [];
          locations.push(join(directory, entry.name)); files.set(entry.name, locations);
        }
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return new Map();
      }
    }
    if (!signal?.aborted) this.cache = {path, at: Date.now(), files};
    return files;
  }
}

export function renderCorrection(correction: CommandCorrection, columns: number): string {
  return truncateAnsi(`${foreground(UI_COLORS.accent)}${GLYPHS.prompt} ${correction.name}\u001b[0m ${foreground(UI_COLORS.subtle)}Correction · ${stripAnsi(renderActionHelp(CORRECTION_ACTIONS))} · Enter separately\u001b[0m`, columns);
}
