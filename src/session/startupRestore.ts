import type {LiveSessionStartup} from '../prompt/configuration.js';
import {openWindows, shellQuote, type Spawner, type TerminalHost} from '../host/terminalHost.js';
import {planLaunch, type StartupPolicy} from './liveSessions.js';
import type {SessionInfo} from './SessionProtocol.js';
import type {SinglePromptChoice} from './StartupPicker.js';

export interface StartupRestoreDeps {
  policy: StartupPolicy;
  /** Persist a new startup setting chosen from the one-session prompt. */
  saveStartup: (startup: LiveSessionStartup) => void;
  askOne: (session: SessionInfo) => Promise<SinglePromptChoice>;
  /** Ids to resume in list order; [] for none. */
  pick: (sessions: SessionInfo[]) => Promise<string[]>;
  host: TerminalHost;
  /** The command line that starts this NMSh, before `--attach <id>`. */
  selfCommand: readonly string[];
  spawner?: Spawner;
}

export interface StartupRestore {
  /** Session this window attaches, if any. */
  target?: string;
  /** Shown in this window: what could not be opened elsewhere, and how to attach it. */
  notice?: string;
}

/**
 * Decide which detached live sessions this launch restores. This window takes
 * the first; each other one gets a new host window where the host supports it.
 * Anything that cannot be opened stays detached and is named in the notice, so
 * nothing selected is silently dropped, and nothing is ever ended here.
 */
export async function restoreAtStartup(live: readonly SessionInfo[], deps: StartupRestoreDeps): Promise<StartupRestore> {
  const plan = planLaunch(live, deps.policy);
  let ids: string[] = [];
  if (plan.kind === 'attach') ids = plan.sessions.map(session => session.id);
  else if (plan.kind === 'pick') ids = await deps.pick(plan.sessions);
  else if (plan.kind === 'ask') {
    const choice = await deps.askOne(plan.session);
    if (choice === 'always') deps.saveStartup('always');
    if (choice === 'never') deps.saveStartup('never');
    if (choice === 'resume' || choice === 'always') ids = [plan.session.id];
  }
  const [target, ...others] = ids;
  if (others.length === 0) return target ? {target} : {};
  const failed = await openWindows(deps.host, others.map(id => [...deps.selfCommand, '--attach', id]), deps.spawner);
  if (failed.length === 0) return {target};
  const commands = failed.map(argv => `nmsh --attach ${shellQuote(argv[argv.length - 1]!)}`);
  const reason = deps.host.newWindow ? `could not be opened in new ${deps.host.name} windows` : `need their own windows, which NMSh cannot open in ${deps.host.name}`;
  return {target, notice: `${failed.length} more selected live session${failed.length === 1 ? '' : 's'} ${reason}; `
    + `they keep running. Open a terminal window for each and run: ${commands.join(' · ')} (or use /resume).`};
}
