import {readProjectFacts, type ProjectFacts} from '../ask/project.js';
import type {GitFacts} from '../ask/git.js';

/**
 * /doctor: "is this environment healthy, and if not, what exactly looks
 * wrong?" Every check is local, bounded and read-only; nothing is sent to a
 * model or the network, and nothing is fixed silently. Checks are small
 * functions over an injectable environment, grouped by section; only
 * sections relevant to the current context appear. A dirty tree is not a
 * failure; severity is honest.
 */
export type DoctorState = 'ok' | 'attention' | 'failure' | 'info';
export type DoctorAction = {label: string; kind: 'slash'; command: string} | {label: string; kind: 'ask'; request: string};

export interface DoctorCheck {
  section: string;
  label: string;
  state: DoctorState;
  detail?: string;
  action?: DoctorAction;
}

export interface DoctorEnvironment {
  cwd: string;
  platform: NodeJS.Platform;
  /** Absolute executable for a name on PATH, if any. */
  which(name: string): string | undefined;
  /** Whether a path exists / is a writable directory (bounded fs checks). */
  exists(path: string): boolean;
  writable(path: string): boolean;
  /** NMSh facts the app already holds. */
  nmsh: {configurationLoaded: boolean; configurationError?: string; sessionMode: 'service' | 'in-process'; serviceReachable?: boolean; transcriptDirectory: string;
    shell: {id: string; label: string; executable?: string; promptSeen: boolean}; host: {name: string; truecolor: boolean; keyboard: boolean}};
  git?: GitFacts;
  repoRoot?: string;
  project?: ProjectFacts;
  /** Configured providers that point at an external tool (picker fzf, history atuin…). */
  providers: Array<{family: string; label: string; executable?: string; available: boolean}>;
  understanding: {mode: string; model?: {label: string; runtime: string; path?: string; owned: boolean}; runtimeAvailable: boolean; state?: string};
  agents: Array<{label: string; installed: boolean}>;
  virtualEnv?: string;
  /** The Context Engine's own counters since NMSh started (nothing is collected to read them). */
  contextEngine?: {started: number; completed: number; cancelled: number; timedOut: number; failed: number; cacheHits: number; coalesced: number};
}

const join = (directory: string, name: string) => `${directory.replace(/\/$/u, '')}/${name}`;

/** Prompt data health: how often collection ran, was served from cache, timed out or failed. A few timeouts are normal on a cold disk. */
export function contextEngineCheck(stats: NonNullable<DoctorEnvironment['contextEngine']>): DoctorCheck {
  const section = 'NMSh';
  const total = stats.completed + stats.timedOut + stats.failed;
  const detail = `${stats.started} collections started · ${stats.cacheHits} served from cache · ${stats.coalesced} merged · ${stats.cancelled} cancelled · ${stats.timedOut} timed out · ${stats.failed} failed. /modules shows each module's own timing`;
  const bad = total >= 20 && (stats.timedOut + stats.failed) / total > 0.2;
  return bad ? {section, label: 'Prompt data often times out or fails', state: 'attention', detail, action: {label: 'Review modules', kind: 'slash', command: '/modules'}}
    : {section, label: 'Prompt data collection healthy', state: stats.started ? 'ok' : 'info', detail};
}

function nmshChecks(env: DoctorEnvironment): DoctorCheck[] {
  const section = 'NMSh';
  const checks: DoctorCheck[] = [env.nmsh.configurationLoaded
    ? {section, label: 'Configuration loads', state: 'ok'}
    : {section, label: 'Configuration has problems', state: 'failure', ...(env.nmsh.configurationError ? {detail: env.nmsh.configurationError} : {}), action: {label: 'Open settings', kind: 'slash', command: '/settings'}}];
  if (env.nmsh.sessionMode === 'service') {
    checks.push(env.nmsh.serviceReachable === false ? {section, label: 'Session service not answering', state: 'attention', detail: 'This session keeps working; /sessions may be empty until it answers.'}
      : {section, label: 'Session service healthy', state: 'ok'});
  } else checks.push({section, label: 'Running in-process (no session service)', state: 'info'});
  checks.push(env.writable(env.nmsh.transcriptDirectory) ? {section, label: 'Transcript store writable', state: 'ok'}
    : {section, label: 'Transcript store is not writable', state: 'failure', detail: env.nmsh.transcriptDirectory});
  if (env.contextEngine) checks.push(contextEngineCheck(env.contextEngine));
  return checks;
}

function shellChecks(env: DoctorEnvironment): DoctorCheck[] {
  const section = 'Shell';
  const {shell} = env.nmsh;
  return [shell.executable ? {section, label: `${shell.label} detected`, state: 'ok', detail: shell.executable} : {section, label: `${shell.label} not found on PATH`, state: 'failure'},
    shell.promptSeen ? {section, label: 'Prompt handshake healthy', state: 'ok'} : {section, label: 'No prompt handshake yet', state: 'attention', detail: 'The shell has not reported a prompt; a startup file may be waiting.'}];
}

/** Script words that are not tools: shell builtins and keywords that may start a script body. */
const NOT_TOOLS = new Set(['cd', 'echo', 'exit', 'true', 'false', 'test', 'export', 'env', 'set', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'sh', 'bash', 'exec', 'run-p', 'run-s']);

function projectChecks(env: DoctorEnvironment, project: ProjectFacts): DoctorCheck[] {
  const section = 'Project';
  const checks: DoctorCheck[] = [];
  if (project.kind === 'node') {
    checks.push({section, label: 'package.json found', state: 'ok', detail: `${project.manager} · ${project.managerSource}`});
    const manager = project.manager ?? 'npm';
    checks.push(env.which(manager) ? {section, label: `${manager} available`, state: 'ok'} : {section, label: `${manager} is not installed`, state: 'failure', detail: `The project uses ${manager} (${project.managerSource}).`});
    const modules = join(project.root, 'node_modules');
    checks.push(env.exists(modules) ? {section, label: 'Dependencies present', state: 'ok'}
      : {section, label: 'Dependencies not installed', state: 'attention', detail: 'node_modules is missing.', action: {label: 'How do I install them?', kind: 'ask', request: `how do i run ${manager} install`}});
    // Scripts whose first word is a tool neither on PATH nor in node_modules/.bin.
    const missing = Object.entries(project.scripts).flatMap(([name, body]) => {
      const tool = /^\s*([\w.@/-]+)/u.exec(body.replace(/^(?:\w+=\S+\s+)+/u, ''))?.[1];
      if (!tool || NOT_TOOLS.has(tool) || tool.includes('/')) return [];
      return env.which(tool) || env.exists(join(join(modules, '.bin'), tool)) ? [] : [`${name} (${tool})`];
    });
    if (missing.length) checks.push({section, label: `${missing.length} script${missing.length === 1 ? '' : 's'} reference${missing.length === 1 ? 's' : ''} a missing tool`, state: 'attention', detail: missing.slice(0, 4).join(', ')});
    if (project.scripts.test) checks.push({section, label: 'Test script', state: 'info', detail: project.scripts.test, action: {label: 'Run tests', kind: 'ask', request: 'run the tests'}});
  } else if (project.kind === 'python') {
    checks.push({section, label: 'pyproject.toml found', state: 'ok'});
    const python = env.which('python3') ?? env.which('python');
    checks.push(python ? {section, label: 'Python available', state: 'ok', detail: python} : {section, label: 'Python is not installed', state: 'failure'});
    checks.push(env.virtualEnv ? {section, label: 'Virtual environment active', state: 'ok', detail: env.virtualEnv}
      : env.exists(join(project.root, '.venv')) ? {section, label: '.venv exists but is not active', state: 'attention', detail: 'source .venv/bin/activate'} : {section, label: 'No virtual environment active', state: 'info'});
  } else if (project.kind === 'rust') {
    checks.push({section, label: 'Cargo.toml found', state: 'ok'});
    checks.push(env.which('cargo') ? {section, label: 'cargo available', state: 'ok'} : {section, label: 'cargo is not installed', state: 'failure'});
  } else if (project.kind === 'go') {
    checks.push({section, label: 'go.mod found', state: 'ok'});
    checks.push(env.which('go') ? {section, label: 'go available', state: 'ok'} : {section, label: 'go is not installed', state: 'failure'});
  } else if (project.kind === 'make') {
    checks.push({section, label: 'Makefile found', state: 'ok', detail: `${project.makeTargets?.length ?? 0} targets`});
    checks.push(env.which('make') ? {section, label: 'make available', state: 'ok'} : {section, label: 'make is not installed', state: 'failure'});
  }
  return checks;
}

function gitChecks(git: GitFacts): DoctorCheck[] {
  const section = 'Git';
  const checks: DoctorCheck[] = [{section, label: git.detached ? 'Repository detected · detached HEAD' : `Repository detected · ${git.branch}`, state: git.detached ? 'info' : 'ok'}];
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  if (git.conflicted.length) checks.push({section, label: plural(git.conflicted.length, 'conflicted file'), state: 'attention', action: {label: 'Show them', kind: 'ask', request: 'show conflicts'}});
  const changed = git.modified.length + git.deleted.length + git.staged.length;
  if (changed) checks.push({section, label: `${plural(changed, 'changed file')}${git.staged.length ? ` (${git.staged.length} staged)` : ''}`, state: 'info', action: {label: 'Show the diff', kind: 'ask', request: 'show me the diff'}});
  if (git.untracked.length) checks.push({section, label: plural(git.untracked.length, 'untracked file'), state: 'info', action: {label: 'Show them', kind: 'ask', request: 'show untracked files'}});
  if (!git.detached) {
    checks.push(git.upstream ? {section, label: `Upstream ${git.upstream}${git.ahead ? ` · ${git.ahead} ahead` : ''}${git.behind ? ` · ${git.behind} behind` : ''}`, state: git.behind ? 'attention' : 'ok'}
      : git.remotes.length ? {section, label: 'No upstream for this branch', state: 'info', action: {label: 'How do I push it?', kind: 'ask', request: 'how do i push this branch'}}
      : {section, label: 'No remotes configured', state: 'info'});
  }
  return checks;
}

function toolChecks(env: DoctorEnvironment): DoctorCheck[] {
  const section = 'Tools';
  const checks: DoctorCheck[] = [];
  if (env.platform === 'darwin') checks.push(env.which('brew') ? {section, label: 'Homebrew', state: 'ok'} : {section, label: 'Homebrew not installed', state: 'info'});
  for (const provider of env.providers) {
    checks.push(provider.available ? {section, label: `${provider.label} (${provider.family})`, state: 'ok'}
      : {section, label: `${provider.label} unavailable (${provider.family} uses NMSh Native meanwhile)`, state: 'attention', action: {label: 'Open /providers', kind: 'slash', command: '/providers'}});
  }
  return checks;
}

function understandingChecks(env: DoctorEnvironment): DoctorCheck[] {
  const section = 'Local intelligence';
  const u = env.understanding;
  if (u.mode === 'off') return [{section, label: 'Off (Ask and Smart Folding use built-in understanding)', state: 'info'}];
  if (!u.model) return [{section, label: 'On, but no model is set up', state: 'attention', action: {label: 'Open /llm', kind: 'slash', command: '/llm'}}];
  const checks: DoctorCheck[] = [];
  checks.push(u.model.path && !env.exists(u.model.path) ? {section, label: `${u.model.label} file is missing`, state: 'failure', detail: u.model.path, action: {label: 'Open /llm', kind: 'slash', command: '/llm'}}
    : {section, label: u.model.label, state: 'ok', detail: u.model.owned ? 'NMSh managed' : 'found on this machine'});
  checks.push(u.runtimeAvailable ? {section, label: u.model.runtime, state: 'ok'} : {section, label: `${u.model.runtime} runtime not found`, state: 'failure', action: {label: 'Open /llm', kind: 'slash', command: '/llm'}});
  checks.push({section, label: `Model service ${u.state ?? 'idle (starts on first use)'}`, state: u.state === 'Error' ? 'attention' : 'info'});
  return checks;
}

function agentChecks(env: DoctorEnvironment): DoctorCheck[] {
  const installed = env.agents.filter(agent => agent.installed);
  return installed.length ? [{section: 'Agents', label: installed.map(agent => agent.label).join(', '), state: 'ok', action: {label: 'Open /ai', kind: 'slash', command: '/ai'}}] : [];
}

function hostChecks(env: DoctorEnvironment): DoctorCheck[] {
  const section = 'Host terminal';
  const host = env.nmsh.host;
  return [{section, label: host.name, state: 'info'},
    host.truecolor ? {section, label: 'Truecolor', state: 'ok'} : {section, label: 'No truecolor (colors are approximated)', state: 'info'},
    host.keyboard ? {section, label: 'Enhanced keyboard', state: 'ok'} : {section, label: 'Basic keyboard (Shift+Enter may need setup; /keyboard)', state: 'info', action: {label: 'Open /keyboard', kind: 'slash', command: '/keyboard'}}];
}

/** Run every relevant check (synchronous facts gathered by the caller; this is pure and bounded). */
export function runDoctor(env: DoctorEnvironment): DoctorCheck[] {
  const project = env.project ?? readProjectFacts(env.repoRoot ?? env.cwd);
  return [...nmshChecks(env), ...shellChecks(env), ...(project ? projectChecks(env, project) : []), ...(env.git ? gitChecks(env.git) : []),
    ...toolChecks(env), ...understandingChecks(env), ...agentChecks(env), ...hostChecks(env)];
}

export function doctorSummary(checks: readonly DoctorCheck[]): {failures: number; attention: number} {
  return {failures: checks.filter(check => check.state === 'failure').length, attention: checks.filter(check => check.state === 'attention').length};
}
