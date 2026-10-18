import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {AskContext, AskOutcome, CommandBlock} from './types.js';

/**
 * Project awareness from the project's own files: package.json scripts and
 * lockfiles (npm, pnpm, yarn, bun), Cargo.toml, go.mod, pyproject.toml,
 * Makefile. Commands are built from those facts only; a script that doesn't
 * exist is never invented. Finite scripts (tests, builds) run as a visible
 * shell submission after the final Yes; long-lived ones (dev servers,
 * watchers) start as NMSh-managed background tasks so the shell stays free.
 */

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface ProjectFacts {
  root: string;
  kind: 'node' | 'rust' | 'go' | 'python' | 'make';
  manager?: PackageManager;
  /** How the manager was established (lockfile, packageManager field, or the npm default for a bare package.json). */
  managerSource?: string;
  scripts: Record<string, string>;
  name?: string;
  makeTargets?: string[];
}

export interface TaskSummary {id: string; label: string; status: string; urls: string[]; startedAt: number; lines: number; command: string}

export function readProjectFacts(root: string): ProjectFacts | undefined {
  const read = (file: string) => { try { return readFileSync(join(root, file), 'utf8'); } catch { return undefined; } };
  const pkg = read('package.json');
  if (pkg !== undefined) {
    let json: {scripts?: Record<string, unknown>; packageManager?: unknown; name?: unknown} = {};
    try { json = JSON.parse(pkg) as typeof json; } catch { /* malformed: no scripts */ }
    const scripts = Object.fromEntries(Object.entries(json.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^[\w:.@/-]{1,80}$/u.test(entry[0])));
    const declared = typeof json.packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@/u.exec(json.packageManager)?.[1] as PackageManager | undefined : undefined;
    const lock: Array<[string, PackageManager]> = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['package-lock.json', 'npm']];
    const locked = lock.find(([file]) => existsSync(join(root, file)));
    const manager = declared ?? locked?.[1] ?? 'npm';
    return {root, kind: 'node', manager, managerSource: declared ? 'packageManager in package.json' : locked ? locked[0] : 'package.json (no lockfile)', scripts,
      ...(typeof json.name === 'string' ? {name: json.name} : {})};
  }
  if (existsSync(join(root, 'Cargo.toml'))) return {root, kind: 'rust', scripts: {}};
  if (existsSync(join(root, 'go.mod'))) return {root, kind: 'go', scripts: {}};
  if (existsSync(join(root, 'pyproject.toml'))) return {root, kind: 'python', scripts: {}};
  const make = read('Makefile');
  if (make !== undefined) {
    const targets = [...make.matchAll(/^([A-Za-z][\w.-]*):(?!=)/gmu)].map(match => match[1]!).filter((name, index, all) => all.indexOf(name) === index).slice(0, 30);
    return {root, kind: 'make', scripts: {}, makeTargets: targets};
  }
  return undefined;
}

/** argv for one script with the project's own manager. */
export function scriptArgv(project: ProjectFacts, script: string): string[] {
  const manager = project.manager ?? 'npm';
  if (manager === 'npm') return script === 'test' || script === 'start' ? ['npm', script] : ['npm', 'run', script];
  return [manager, 'run', script];
}

/** True when argv is exactly a script this project defines, run by its manager (re-checked before running). */
export function projectRunAllowed(argv: readonly string[], project: ProjectFacts | undefined): boolean {
  if (!project) return false;
  if (project.kind === 'node') return Object.keys(project.scripts).some(script => scriptArgv(project, script).join('\u0000') === argv.join('\u0000'));
  const fixed: Record<ProjectFacts['kind'], string[][]> = {node: [], rust: [['cargo', 'run'], ['cargo', 'test'], ['cargo', 'build']], go: [['go', 'run', '.'], ['go', 'test', './...'], ['go', 'build', './...']],
    python: [], make: (project.makeTargets ?? []).map(target => ['make', target])};
  return fixed[project.kind].some(item => item.join('\u0000') === argv.join('\u0000'));
}

/** Long-lived scripts: started as managed background tasks, never in the shell's foreground. */
export function isLongRunning(script: string, body = ''): boolean {
  return /^(?:dev|start|serve|server|watch|preview|storybook)(?::|$)/u.test(script) || /\b(?:vite(?! build)|next dev|nuxt dev|webpack serve|nodemon|--watch|astro dev|remix dev|tsc -w|serve\b)/u.test(body);
}

type Role = 'dev' | 'test' | 'build' | 'lint' | 'start';
const ROLE_SCRIPTS: Record<Role, string[]> = {dev: ['dev', 'start', 'serve', 'develop', 'preview'], start: ['start', 'dev', 'serve'], test: ['test', 'tests', 'test:unit', 'check'],
  build: ['build', 'compile'], lint: ['lint', 'typecheck', 'check']};

function scriptFor(project: ProjectFacts, role: Role): string | undefined {
  return ROLE_SCRIPTS[role].find(name => project.scripts[name] !== undefined);
}

function fixedFor(project: ProjectFacts, role: Role): string[] | undefined {
  if (project.kind === 'rust') return role === 'test' ? ['cargo', 'test'] : role === 'build' ? ['cargo', 'build'] : role === 'dev' || role === 'start' ? ['cargo', 'run'] : undefined;
  if (project.kind === 'go') return role === 'test' ? ['go', 'test', './...'] : role === 'build' ? ['go', 'build', './...'] : role === 'dev' || role === 'start' ? ['go', 'run', '.'] : undefined;
  if (project.kind === 'make') { const target = (project.makeTargets ?? []).find(name => ROLE_SCRIPTS[role].includes(name)); return target ? ['make', target] : undefined; }
  return undefined;
}

const ROLE_WORDS: Array<[Role, RegExp]> = [
  ['test', /\b(?:tests?|specs?|test suite)\b/u],
  ['build', /\b(?:build|compile)\b/u],
  ['lint', /\b(?:lint|linter|typecheck|type check)\b/u],
  ['dev', /\b(?:dev server|development server|dev mode|the server|local server|server|dev)\b/u],
  ['start', /\b(?:the app|the project|this project|it|the site|the website|app|project)\b/u],
];

function block(argv: string[], note: string, run: CommandBlock['run'], facts: Array<[string, string]>): CommandBlock {
  return {argv, provenance: 'context', risk: 'mutate', note, facts, ...(run ? {run} : {})};
}

export function resolveProject(text: string, context: AskContext): AskOutcome | undefined {
  const tasks = context.tasks ?? [];
  const live = tasks.filter(task => task.status === 'running' || task.status === 'starting' || task.status === 'waiting');
  const aboutTask = /\b(?:dev server|server|it|its|that|the task|background task|the app|the site)\b/u.test(text);

  // Managed tasks: URL, output, open, stop. Only tasks NMSh started are ever mentioned or stopped.
  if (tasks.length && aboutTask) {
    const task = live.at(-1) ?? tasks.at(-1)!;
    if (/\b(?:url|address|port|link|where)\b/u.test(text) && /\b(?:what|which|where|show)\b/u.test(text)) {
      return task.urls.length ? {kind: 'answer', capability: 'project.task', text: `${task.label} printed:\n${task.urls.map(url => `  ${url}`).join('\n')}`,
        next: task.urls.slice(0, 2).map(url => ({key: `open:${url}`, label: `Open ${url}`, outcome: openUrlProposal(url)}))}
        : {kind: 'answer', capability: 'project.task', text: `${task.label} hasn't printed a URL yet${task.status === 'running' ? '' : ` (it is ${task.status})`}.`};
    }
    if (/^(?:please )?(?:open|visit|browse|launch)\b/u.test(text) && !/\b(?:file|folder|config)\b/u.test(text)) {
      const url = task.urls[0];
      return url ? openUrlProposal(url) : {kind: 'answer', capability: 'project.task', text: `${task.label} hasn't printed a URL to open yet.`};
    }
    if (/\b(?:output|logs?|show it|what did it (?:say|print))\b/u.test(text)) {
      return {kind: 'proposal', capability: 'project.task', safety: 'navigate', confidence: 0.9, direct: true, text: `Output of ${task.label}`, action: {kind: 'taskOutput', id: task.id}};
    }
    if (/\b(?:stop|kill|end|shut down|quit|terminate)\b/u.test(text)) {
      if (!live.length) return {kind: 'answer', capability: 'project.task', text: `${task.label} isn't running (${task.status}).`};
      if (live.length > 1 && !/\b(?:dev server|server)\b/u.test(text)) {
        return {kind: 'choose', reason: 'missing', capability: 'project.task', question: 'Stop which task?', options: live.map(item => ({key: `stop:${item.id}`, label: item.label, outcome: stopProposal(item)}))};
      }
      return stopProposal(live.at(-1)!);
    }
  }
  if (!tasks.length && /\b(?:dev server|server)\b/u.test(text) && /\b(?:url|address|port|open|visit|output|logs?)\b/u.test(text)) {
    return {kind: 'answer', capability: 'project.task', text: 'NMSh isn\'t running a dev server for you right now. "run the dev server" starts one in the background, and its URL shows here once it prints one.'};
  }
  if (!tasks.length && /^(?:show|see|view)(?: me)? (?:its|the) (?:output|logs?)$/u.test(text) && context.recent?.[0]) {
    return {kind: 'answer', capability: 'project.task', text: `The output of ${context.recent[0].command} is in the transcript above (Esc closes Ask; Ctrl+O expands folded output).`};
  }
  if (/\b(?:stop|kill)\b.*\b(?:dev server|server)\b/u.test(text) && !tasks.length) {
    return {kind: 'answer', capability: 'project.task', text: 'NMSh isn\'t running a dev server for you. Ask only stops tasks it started; a server you started in the shell stops with Ctrl+C there.'};
  }
  if (/\b(?:background tasks?|managed tasks?|what am i running|what(?:'s| is) running)\b/u.test(text) && tasks.length) {
    return {kind: 'answer', capability: 'project.task', text: `Tasks NMSh started:\n${tasks.map(task => `  ${task.label} · ${task.status}${task.urls[0] ? ` · ${task.urls[0]}` : ''}`).join('\n')}`};
  }

  const project = context.project;
  const projectWords = /\b(?:scripts?|run|start|launch|test|tests|build|lint|dev|server|app|project)\b/u.test(text);
  if (!projectWords) return undefined;
  if (/\bscripts?\b/u.test(text) && /\b(?:what|which|list|show|have|available)\b/u.test(text)) {
    if (!project) return {kind: 'answer', capability: 'project.run', text: 'This folder has no package.json or other project file NMSh recognizes.'};
    if (project.kind !== 'node') return {kind: 'answer', capability: 'project.run', text: project.kind === 'make' ? `Make targets: ${(project.makeTargets ?? []).join(', ') || 'none found'}.` : `This is a ${project.kind} project; it has no package.json scripts.`};
    const names = Object.keys(project.scripts);
    if (!names.length) return {kind: 'answer', capability: 'project.run', text: 'package.json defines no scripts.'};
    return {kind: 'choose', reason: 'missing', capability: 'project.run', question: `Scripts in package.json · ${project.manager} (${project.managerSource})`,
      options: names.slice(0, 40).map(name => ({key: `script:${name}`, label: name, detail: project.scripts[name]!.slice(0, 60), outcome: scriptOutcome(project, name, false)}))};
  }
  const runVerb = /^(?:please |can you |could you |go ahead and |let's |lets )*(?:run|start|launch|boot|spin up|fire up|serve|execute|kick off)\b/u.test(text);
  const howVerb = /^(?:please )?(?:how (?:do|can|would|should) i|how to|what(?:'s| is) the command to)\s+(?:run|start|launch|test|build|serve|lint)\b/u.test(text);
  if (!runVerb && !howVerb) return undefined;
  const role = ROLE_WORDS.find(([, words]) => words.test(text))?.[0] ?? (/\b(?:run|start)\b/u.test(text) ? 'start' : undefined);
  if (!role) return undefined;
  if (!project) return {kind: 'answer', capability: 'project.run', text: 'This folder has no package.json, Cargo.toml, go.mod or Makefile, so NMSh doesn\'t know how this project runs.'};
  // "run only the ask tests": the test script plus a filter argument; whether it filters depends on the script, so it is shown, not run.
  const only = /\bonly (?:the )?([\w.-]+) tests?\b|\b([\w.-]+) tests? only\b/u.exec(text);
  if (role === 'test' && only && project.kind === 'node') {
    const script = scriptFor(project, 'test');
    const filter = only[1] ?? only[2]!;
    if (!script) return {kind: 'answer', capability: 'project.run', text: 'package.json has no test script.'};
    const argv = [...scriptArgv(project, script), '--', filter];
    return {kind: 'answer', capability: 'project.run', text: `Arguments after -- go to the ${script} script (${project.scripts[script]}). Whether "${filter}" filters tests depends on that script, so check before relying on it.`,
      block: {argv, provenance: 'context', risk: 'mutate', note: `Passes "${filter}" to the ${script} script.`, facts: [['manager', `${project.manager}`], ['script', project.scripts[script]!]]},
      referents: {command: argv.slice(0, 2)}};
  }
  if (project.kind === 'node') {
    const script = scriptFor(project, role);
    if (!script) {
      const names = Object.keys(project.scripts);
      return {kind: 'choose', reason: 'missing', capability: 'project.run', question: `package.json has no ${role} script. Its scripts:`,
        options: names.slice(0, 20).map(name => ({key: `script:${name}`, label: name, detail: project.scripts[name]!.slice(0, 60), outcome: scriptOutcome(project, name, howVerb)}))};
    }
    return scriptOutcome(project, script, howVerb, /\b(?:keep (?:it )?running|in the background|background)\b/u.test(text));
  }
  const argv = fixedFor(project, role);
  if (!argv) return {kind: 'answer', capability: 'project.run', text: `NMSh doesn't know a ${role} command for this ${project.kind} project.`};
  return commandOutcome(project, argv, argv.join(' '), howVerb, role === 'dev' || role === 'start');
}

function scriptOutcome(project: ProjectFacts, script: string, explainOnly: boolean, background = false): AskOutcome {
  const body = project.scripts[script] ?? '';
  return commandOutcome(project, scriptArgv(project, script), script, explainOnly, background || isLongRunning(script, body), body);
}

function commandOutcome(project: ProjectFacts, argv: string[], label: string, explainOnly: boolean, longRunning: boolean, body?: string): AskOutcome {
  const facts: Array<[string, string]> = [...(project.manager ? [['manager', `${project.manager} · ${project.managerSource}`] as [string, string]] : []), ...(body ? [['script', body] as [string, string]] : [])];
  const run = longRunning ? {kind: 'startTask' as const, argv, cwd: project.root, label: taskLabel(label, body)} : {kind: 'project' as const, argv};
  const note = longRunning ? 'Keeps running; Ask starts it in the background so the shell stays free.' : 'Runs in the shell; its output goes to the transcript.';
  if (explainOnly) {
    return {kind: 'answer', capability: 'project.run', text: longRunning ? `This starts ${taskLabel(label, body)}:` : `This runs ${label}:`, block: block(argv, note, run, facts), referents: {command: argv.slice(0, 2)}};
  }
  return {kind: 'proposal', capability: 'project.run', safety: 'mutate', confidence: 0.9, command: argv.join(' '),
    text: longRunning ? `Start ${taskLabel(label, body)} in the background? It keeps running; Ask shows its URL and output, and can stop it.` : `Run ${label}? It runs in the shell.`,
    action: run, referents: {command: argv.slice(0, 2)}};
}

export function taskLabel(script: string, body = ''): string {
  return /^(?:dev|serve|start|preview)/u.test(script) || /\b(?:vite|next|nuxt|webpack serve|astro|remix)\b/u.test(body) ? 'Dev server' : `${script} (background)`;
}

function stopProposal(task: TaskSummary): AskOutcome {
  return {kind: 'proposal', capability: 'project.task', safety: 'mutate', confidence: 0.95, command: task.command,
    text: `Stop ${task.label}? NMSh started it; only that task (and the processes it started) stops.`, action: {kind: 'stopTask', id: task.id}};
}

export function openUrlProposal(url: string): AskOutcome {
  return {kind: 'proposal', capability: 'project.task', safety: 'navigate', confidence: 0.95, text: `Open ${url} in your browser?`, action: {kind: 'openUrl', url}};
}

/** URLs Ask may hand to the system opener: http(s) only, no spaces or quotes. */
export function openableUrl(url: string): boolean {
  return /^https?:\/\/[\w.[\]:-]+(?::\d{1,5})?(?:\/[\w./%?=&#~+-]*)?$/u.test(url);
}
