import {existsSync, realpathSync} from 'node:fs';
import {resolveCommand} from '../../providers/providers.js';
import {artifactPath, loadLedger, writeArtifact} from '../../themeBridge/artifacts.js';
import {DEFAULT_TMUX_MODEL, loadTmuxModel, quotablePath, renderTmuxConfig, validateTmuxConfig, type TmuxModel} from './tmux.js';

/**
 * Writing the one NMSh-managed tmux file (staged, validated, atomic,
 * ownership-checked through the Theme Bridge ledger). It carries the Tool
 * Configuration settings and sources the Theme Bridge colors.
 */

/** The absolute NMSh launcher for new tmux panes: the `nmsh` on PATH, resolved; never a guess. */
export function nmshExecutable(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const found = resolveCommand('nmsh', env.PATH ?? '');
  if (!found) return undefined;
  try { const real = realpathSync(found); return quotablePath(real) ? real : quotablePath(found) ? found : undefined; } catch { return quotablePath(found) ? found : undefined; }
}

export const modelIsEmpty = (model: TmuxModel) => JSON.stringify(model) === JSON.stringify(DEFAULT_TMUX_MODEL());

/** Needed when NMSh configures tmux, Theme Bridge styles it, or the file already exists as NMSh's. */
export function tmuxManagedNeeded(model: TmuxModel, bridgeActive: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return !modelIsEmpty(model) || bridgeActive || Boolean(loadLedger(env).entries.tmuxConfig);
}

export function writeTmuxManaged(model: TmuxModel = loadTmuxModel(), env: NodeJS.ProcessEnv = process.env): {ok: true; path: string; changed: boolean} | {ok: false; error: string} {
  const nmsh = model.frontend === 'nmsh' ? nmshExecutable(env) : undefined;
  if (model.frontend === 'nmsh' && !nmsh) return {ok: false, error: 'The nmsh launcher was not found on PATH (or its path cannot be quoted safely), so new panes cannot start NMSh.'};
  const path = artifactPath('tmuxConfig', env);
  const content = renderTmuxConfig(model, {self: path, theme: artifactPath('tmux', env), ...(nmsh ? {nmsh} : {})});
  return writeArtifact('tmuxConfig', content, validateTmuxConfig, {mode: 'follow', themeRef: '', format: 'tmux-managed', formatVersion: 1}, env);
}

export const tmuxManagedExists = (env: NodeJS.ProcessEnv = process.env) => existsSync(artifactPath('tmuxConfig', env));
