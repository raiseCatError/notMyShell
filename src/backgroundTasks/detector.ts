/**
 * Which submitted commands may keep running (#382). Conservative and
 * explainable: a command is recognized only when its words alone say it
 * streams or serves (`adb logcat`, `tail -f`, `npm run dev`), never from the
 * program name alone (`adb devices`, `tail`, `npm test` return). Anything
 * whose meaning depends on live shell state or would change if run elsewhere
 * is not recognized: substitutions, redirections, heredocs, lists, subshells,
 * background jobs, `sudo`/`ssh`, and full-screen or interactive programs.
 *
 * Classification reads only the command text. Nothing is executed, expanded
 * or looked up, so it costs microseconds and can run on submission.
 */

export type TaskKind = 'logging' | 'following' | 'monitoring' | 'server' | 'watcher' | 'gui';

export interface Classification {
  /** Stable family for remembered decisions: specific enough that `adb logcat` never covers all of `adb`. */
  family: string;
  kind: TaskKind;
  /** `streams`: runs until interrupted. `likely`: usually keeps running, depending on the project. */
  likelihood: 'streams' | 'likely';
  /** One sentence for the suggestion. */
  reason: string;
}

export type Unrecognized = {family?: undefined; why: string};

export const MAX_CLASSIFIED_LENGTH = 2048;

/**
 * Shell words of a simple pipeline: quotes and backslashes are honored; anything that needs a real shell parser or
 * live state to understand makes the command unclassifiable (it then runs as typed, in the foreground, unless the
 * person chooses otherwise).
 */
export function simpleStages(command: string): string[][] | {why: string} {
  if (command.length > MAX_CLASSIFIED_LENGTH) return {why: 'too long to classify'};
  const stages: string[][] = [[]];
  let word = '', inWord = false, quote: '"' | "'" | undefined;
  const end = () => { if (inWord) stages.at(-1)!.push(word); word = ''; inWord = false; };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote === "'") { if (char === "'") quote = undefined; else word += char; continue; }
    if (quote === '"') {
      if (char === '"') { quote = undefined; continue; }
      if (char === '$' || char === '`') return {why: 'uses expansion inside quotes'};
      if (char === '\\' && index + 1 < command.length) { word += command[++index]!; continue; }
      word += char; continue;
    }
    if (char === "'" || char === '"') { quote = char; inWord = true; continue; }
    if (char === '\\') { if (index + 1 >= command.length) return {why: 'ends with a backslash'}; word += command[++index]!; inWord = true; continue; }
    if (char === ' ' || char === '\t') { end(); continue; }
    if (char === '|') {
      if (command[index + 1] === '|' || command[index + 1] === '&') return {why: 'uses a command list'};
      end();
      if (!stages.at(-1)!.length) return {why: 'has an empty pipeline stage'};
      stages.push([]);
      continue;
    }
    if (char === '\n' || char === '\r') return {why: 'spans several lines'};
    if ('$`;&<>(){}'.includes(char)) return {why: char === '$' || char === '`' ? 'uses expansion or substitution' : char === ';' || char === '&' ? 'uses a command list or a background job'
      : char === '<' || char === '>' ? 'uses redirection' : 'uses a subshell or group'};
    if (char === '#' && !inWord) break;
    word += char; inWord = true;
  }
  if (quote) return {why: 'has an unclosed quote'};
  end();
  if (stages.some(stage => !stage.length)) return {why: 'has an empty pipeline stage'};
  return stages;
}

/** Programs that need the terminal itself or the person's live input: never moved away from the foreground. */
const FOREGROUND_ONLY = new Set(['sudo', 'doas', 'su', 'ssh', 'mosh', 'sftp', 'ftp', 'telnet', 'top', 'htop', 'btop', 'atop', 'glances', 'less', 'more', 'most', 'man',
  'vi', 'vim', 'nvim', 'nano', 'emacs', 'hx', 'micro', 'tmux', 'screen', 'zellij', 'fzf', 'sk', 'lazygit', 'tig', 'k9s', 'watch', 'exec', 'nohup', 'source', '.', 'cd', 'export']);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const has = (args: readonly string[], ...flags: string[]) => args.some(arg => flags.includes(arg) || flags.some(flag => flag.startsWith('--') && arg.startsWith(`${flag}=`)));
/** A short flag cluster containing a letter (`-fn100` has f): only for clusters, not long options. */
const clusterHas = (args: readonly string[], letter: string) => args.some(arg => /^-[A-Za-z]+\d*$/u.test(arg) && arg.slice(1).replace(/\d+$/u, '').includes(letter));

const result = (family: string, kind: TaskKind, likelihood: Classification['likelihood'], reason: string): Classification => ({family, kind, likelihood, reason});

/** adb's global options before the subcommand (`adb -s SERIAL logcat`); `-d` there means "USB device", not "dump". */
function adbSubcommand(args: readonly string[]): {name?: string; rest: string[]} {
  let index = 0;
  while (index < args.length && args[index]!.startsWith('-')) index += ['-s', '-t', '-H', '-P', '-L'].includes(args[index]!) ? 2 : 1;
  return {name: args[index], rest: args.slice(index + 1)};
}

const SCRIPT_SERVERS = new Set(['dev', 'start', 'serve', 'watch', 'preview', 'storybook']);

function classifyStage(words: readonly string[]): Classification | undefined {
  const [program, ...args] = words;
  if (!program) return undefined;
  const name = program.split('/').at(-1)!;
  switch (name) {
    case 'adb': {
      const sub = adbSubcommand(args);
      if (sub.name !== 'logcat') return undefined;
      // Dump, clear, statistics, buffer-size queries and counted reads return on their own.
      if (has(sub.rest, '-d', '-c', '--clear', '-g', '--buffer-size', '-S', '--statistics', '-m', '--max-count', '-t', '-h', '--help') || clusterHas(sub.rest, 'd')) return undefined;
      return result('adb logcat', 'logging', 'streams', 'adb logcat keeps streaming device logs until it is interrupted.');
    }
    case 'tail': return has(args, '-f', '-F', '--follow') || clusterHas(args, 'f') || clusterHas(args, 'F')
      ? result('tail -f', 'following', 'streams', 'tail -f keeps following the file until it is interrupted.') : undefined;
    case 'journalctl': return has(args, '-f', '--follow') || clusterHas(args, 'f')
      ? result('journalctl -f', 'following', 'streams', 'journalctl -f keeps following the journal until it is interrupted.') : undefined;
    case 'docker': case 'podman': case 'kubectl': case 'docker-compose': {
      const logs = args.indexOf('logs');
      const following = logs !== -1 && (has(args.slice(logs + 1), '-f', '--follow') || clusterHas(args.slice(logs + 1), 'f'));
      if (following) return result(`${name}${args[0] === 'compose' ? ' compose' : ''} logs -f`, 'following', 'streams', `${name} logs -f keeps following the logs until it is interrupted.`);
      if (name === 'kubectl' && args[0] === 'get' && has(args, '-w', '--watch')) return result('kubectl get --watch', 'monitoring', 'streams', 'kubectl get --watch keeps reporting changes until it is interrupted.');
      return undefined;
    }
    case 'ping': case 'ping6':
      return has(args, '-c', '-n', '--count') || clusterHas(args, 'c') ? undefined
        : result(name, 'monitoring', 'streams', `${name} without a count keeps running until it is interrupted.`);
    case 'scrcpy': return has(args, '--help', '-h', '--version', '-v', '--list-devices', '--list-displays', '--list-encoders', '--list-cameras') ? undefined
      : result('scrcpy', 'gui', 'streams', 'scrcpy keeps running while its window is open.');
    case 'npm': case 'pnpm': case 'yarn': case 'bun': {
      const script = args[0] === 'run' || args[0] === 'run-script' ? args[1] : args[0];
      return script && SCRIPT_SERVERS.has(script)
        ? result(`${name} run ${script}`, 'server', 'likely', `${name} run ${script} usually starts a server or watcher that keeps running, depending on this project.`) : undefined;
    }
    case 'vite': return !args[0] || ['dev', 'serve', 'preview'].includes(args[0]) ? result('vite', 'server', 'likely', 'vite serves the project until it is interrupted.') : undefined;
    case 'next': case 'nuxt': case 'astro': return ['dev', 'start', 'preview'].includes(args[0] ?? '') ? result(`${name} ${args[0]}`, 'server', 'likely', `${name} ${args[0]} keeps serving until it is interrupted.`) : undefined;
    case 'nodemon': return result('nodemon', 'watcher', 'likely', 'nodemon keeps restarting the program on changes until it is interrupted.');
    case 'tsc': return has(args, '-w', '--watch') ? result('tsc --watch', 'watcher', 'streams', 'tsc --watch keeps compiling on changes until it is interrupted.') : undefined;
    case 'webpack': return args[0] === 'serve' || has(args, '--watch', '-w') ? result(args[0] === 'serve' ? 'webpack serve' : 'webpack --watch', args[0] === 'serve' ? 'server' : 'watcher', 'streams', 'webpack keeps running until it is interrupted.') : undefined;
    case 'cargo': return args[0] === 'watch' ? result('cargo watch', 'watcher', 'streams', 'cargo watch keeps rebuilding on changes until it is interrupted.') : undefined;
    case 'python': case 'python3': return args[0] === '-m' && args[1] === 'http.server' ? result(`${name} -m http.server`, 'server', 'streams', 'http.server keeps serving until it is interrupted.') : undefined;
    case 'php': return has(args, '-S') ? result('php -S', 'server', 'streams', 'php -S keeps serving until it is interrupted.') : undefined;
    case 'rails': return ['server', 's'].includes(args[0] ?? '') ? result('rails server', 'server', 'streams', 'rails server keeps serving until it is interrupted.') : undefined;
    case 'flask': return args[0] === 'run' ? result('flask run', 'server', 'streams', 'flask run keeps serving until it is interrupted.') : undefined;
    case 'hugo': return args[0] === 'server' || args[0] === 'serve' ? result('hugo server', 'server', 'streams', 'hugo server keeps serving until it is interrupted.') : undefined;
    case 'jekyll': return args[0] === 'serve' || args[0] === 's' ? result('jekyll serve', 'server', 'streams', 'jekyll serve keeps serving until it is interrupted.') : undefined;
    case 'ng': return args[0] === 'serve' ? result('ng serve', 'server', 'streams', 'ng serve keeps serving until it is interrupted.') : undefined;
    default: return undefined;
  }
}

/**
 * The classification of a submitted command, or why it is not recognized. Only the first stage of a pipeline decides
 * (`adb logcat | grep Foo` streams because adb logcat does); every stage must be a plain program, and none may be a
 * foreground-only program.
 */
export function classifyCommand(command: string): Classification | Unrecognized {
  const trimmed = command.trim();
  if (!trimmed) return {why: 'empty'};
  if (trimmed.startsWith('/')) {
    // A slash command is NMSh's; an absolute path to a program is fine.
    if (!/^\/[^\s]*\//u.test(trimmed)) return {why: 'an NMSh command'};
  }
  const stages = simpleStages(trimmed);
  if (!Array.isArray(stages)) return {why: stages.why};
  // Leading `NAME=value` words set the program's environment (the shell applies them under `-c` too); the program follows.
  const commands = stages.map(stage => { const start = stage.findIndex(word => !ENV_ASSIGNMENT.test(word)); return start === -1 ? [] : stage.slice(start); });
  if (commands.some(stage => !stage.length)) return {why: 'only sets variables'};
  for (const stage of commands) if (FOREGROUND_ONLY.has(stage[0]!.split('/').at(-1)!)) return {why: `${stage[0]} needs the terminal or the shell itself`};
  return classifyStage(commands[0]!) ?? {why: 'not a command NMSh knows to keep running'};
}

export function isClassified(value: Classification | Unrecognized): value is Classification {
  return value.family !== undefined;
}
