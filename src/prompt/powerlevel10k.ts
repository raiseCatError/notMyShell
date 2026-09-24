import {spawn} from 'node:child_process';
import {accessSync, constants} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import type {PromptContext} from '../shell/ShellContext.js';
import {parseStarshipPrompt, type StarshipPromptResult} from './starship.js';

export interface Powerlevel10kStatus {
  installed: boolean;
  themePath?: string;
  configPath: string;
  configExists: boolean;
}

/**
 * Rendered in an isolated helper zsh (`zsh -f`: no rc files, ZLE off, stdin
 * ignored, own session). It sources only the theme and the user's p10k
 * config, never writes either, and never touches NMSh's managed shell.
 *
 * NMSh-specific overrides, applied after the user config (which unsets
 * POWERLEVEL9K_* when sourced):
 * - gitstatus is disabled because its daemon needs job control; p10k then
 *   uses its vcs_info fallback for git state.
 * - `prompt_char` and `newline` are removed: NMSh owns the input prompt and
 *   composer layout. The right prompt is not rendered (no NMSh right-prompt
 *   area yet).
 * - PROMPT is lazily evaluated by p10k, so it is expanded the way zsh would
 *   under prompt_subst: parameter/arithmetic expansion, then prompt escapes.
 */
export const POWERLEVEL10K_RENDER_SCRIPT = String.raw`
source -- "$1" || exit 90
[[ -r "$2" ]] && source -- "$2"
typeset -g POWERLEVEL9K_DISABLE_GITSTATUS=true POWERLEVEL9K_INSTANT_PROMPT=off POWERLEVEL9K_DISABLE_HOT_RELOAD=true
typeset -g POWERLEVEL9K_PROMPT_ADD_NEWLINE=false POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true
typeset -ga POWERLEVEL9K_LEFT_PROMPT_ELEMENTS=(${"$"}{POWERLEVEL9K_LEFT_PROMPT_ELEMENTS:#(prompt_char|newline)})
typeset -ga POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS=()
builtin cd -q -- "$3" || exit 91
local hook
for hook in $precmd_functions; do () { return $1 } $4; $hook; done
setopt prompt_subst
print -rn -- "${"$"}{(%)${"$"}{(e)PROMPT}}"
`;

export function normalizePowerlevel10kConfigPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const configured = env.POWERLEVEL9K_CONFIG_FILE?.trim();
  return resolve(configured?.replace(/^~(?=\/|$)/u, home) || join(home, '.p10k.zsh'));
}

/** Common install locations: Homebrew, manual clone, Oh My Zsh, zinit, and distro packages. */
export function powerlevel10kThemeCandidates(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const theme = 'powerlevel10k.zsh-theme';
  const candidates = [
    env.HOMEBREW_PREFIX && join(env.HOMEBREW_PREFIX, 'share/powerlevel10k', theme),
    join('/opt/homebrew/share/powerlevel10k', theme),
    join('/usr/local/share/powerlevel10k', theme),
    join(home, 'powerlevel10k', theme),
    join(env.ZSH_CUSTOM || join(env.ZSH || join(home, '.oh-my-zsh'), 'custom'), 'themes/powerlevel10k', theme),
    join(home, '.local/share/zinit/plugins/romkatv---powerlevel10k', theme),
    join('/usr/share/zsh-theme-powerlevel10k', theme),
  ];
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

function readable(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function detectPowerlevel10k(env: NodeJS.ProcessEnv = process.env, home = homedir(),
  candidates = powerlevel10kThemeCandidates(env, home)): Powerlevel10kStatus {
  const configPath = normalizePowerlevel10kConfigPath(env, home);
  const themePath = candidates.find(readable);
  return {installed: Boolean(themePath), ...(themePath ? {themePath} : {}), configPath, configExists: readable(configPath)};
}

/** Run the isolated helper; it never inherits the host terminal as its controlling TTY. */
export function renderPowerlevel10kPrompt(context: PromptContext, status: Powerlevel10kStatus,
  env: NodeJS.ProcessEnv = process.env, timeoutMs = 3000): Promise<StarshipPromptResult> {
  if (!status.installed || !status.themePath) return Promise.reject(new Error('Powerlevel10k was not found.'));
  const cwd = isAbsolute(context.cwd) ? context.cwd : process.cwd();
  return new Promise((resolvePrompt, reject) => {
    const child = spawn('zsh', ['-f', '-i', '+o', 'zle', '-c', POWERLEVEL10K_RENDER_SCRIPT, 'nmsh-p10k',
      status.themePath!, status.configPath, cwd, String(context.exitStatus ?? 0)], {
      cwd,
      env: {...env, TERM: env.TERM || 'xterm-256color', COLUMNS: '200'},
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true,
    });
    let stdout = '';
    const timer = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      reject(new Error('Powerlevel10k prompt timed out.'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { if (stdout.length < 256 * 1024) stdout += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(code === 90 ? 'Powerlevel10k theme could not be loaded.' : `Powerlevel10k helper exited with ${code}.`));
      else resolvePrompt(parseStarshipPrompt(stdout));
    });
  });
}
