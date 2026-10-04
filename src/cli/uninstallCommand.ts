import {execFileSync} from 'node:child_process';
import {installRoot} from '../update/update.js';
import type {CliIo} from './configCommand.js';
import {applyUninstall, formatUninstallPlan, GOODBYE, liveServiceSockets, planUninstall} from './uninstall.js';

export const UNINSTALL_USAGE = `Usage: nmsh uninstall [--dry-run] [--delete-data] [--yes]

Removes the nmsh launcher links that point into this installation after a
preview. Your settings, transcripts and stats are kept unless --delete-data.
Shell config files are never changed.
`;

function npmGlobalPrefix(env: NodeJS.ProcessEnv): string | undefined {
  try { return execFileSync('npm', ['prefix', '-g'], {env, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore']}).trim() || undefined; }
  catch { return undefined; }
}

export async function runUninstallCommand(args: string[], io: CliIo & {root?: string; npmPrefix?: string | null}): Promise<number> {
  if (args.some(arg => !['--dry-run', '--delete-data', '--yes'].includes(arg))) { io.err(UNINSTALL_USAGE); return 2; }
  const env = io.env ?? process.env;
  const deleteData = args.includes('--delete-data');
  const plan = planUninstall({root: io.root ?? installRoot(), env,
    npmPrefix: io.npmPrefix === null ? undefined : io.npmPrefix ?? npmGlobalPrefix(env)});
  io.out(formatUninstallPlan(plan, deleteData));
  if (args.includes('--dry-run')) return 0;
  const sockets = liveServiceSockets(plan.runtimeDir);
  if (sockets.length) {
    io.err('\nA live-session service is running. End your NMSh sessions first (see nmsh --sessions); nothing was changed.\n');
    return 1;
  }
  if (plan.links.length === 0 && !(deleteData && plan.data.length)) { io.err('\nNothing to remove automatically.\n'); return 0; }
  let agreed = args.includes('--yes');
  if (!agreed) {
    if (!io.confirm) { io.err('\nNot applied. Re-run with --yes to apply this preview non-interactively.\n'); return 2; }
    agreed = await io.confirm('\nUninstall NMSh as previewed?');
    if (agreed && deleteData) agreed = await io.confirm('Also permanently delete your NMSh data listed above?');
  }
  if (!agreed) { io.err('Not uninstalled; nothing changed.\n'); return 1; }
  const result = applyUninstall(plan, {deleteData, env});
  for (const path of result.removed) io.out(`removed ${path}\n`);
  for (const failure of result.failed) io.err(`could not remove ${failure.path}: ${failure.error}\n`);
  if (result.failed.length) return 1;
  io.out(`\n${GOODBYE}\n`);
  return 0;
}
