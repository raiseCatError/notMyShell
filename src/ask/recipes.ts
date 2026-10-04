import {networkInterfaces, freemem, totalmem} from 'node:os';
import type {CommandEnvironment} from './commands.js';
import type {AskContext, AskOption, AskOutcome, CommandBlock} from './types.js';

/**
 * Typed terminal recipes: common command-line tasks as concepts
 * (archive.extract, network.ping, process.port…) whose commands NMSh builds
 * from validated arguments and the platform it runs on. Request text never
 * becomes command text: a host, port, pattern or path is accepted only after
 * strict validation, otherwise it is a visible <placeholder>. An optional
 * model may only choose a recipe id and those bounded arguments.
 *
 * Asking "how do I…" explains (Copy/Insert, Run offered behind the final
 * Yes); asking for the thing itself runs local read-only recipes at once,
 * network ones after the final Yes. Recipes never mutate or destroy.
 */

export type RecipeRisk = 'read' | 'network';
export type Platform = 'darwin' | 'linux' | 'other';

export interface RecipeArgs {host?: string; port?: number; pattern?: string; name?: string; archive?: 'zip' | 'tar.gz' | 'tar'; mode?: string; path?: string}

interface Recipe {
  id: string;
  title: string;
  /** Request shapes for this concept, matched against normalized text. */
  match(text: string): RecipeArgs | undefined;
  /** An answer computed in-process from local facts (no command at all), when that is the honest answer. */
  fact?(args: RecipeArgs, context: AskContext): string | undefined;
  build(args: RecipeArgs, platform: Platform, has: (name: string) => boolean): {argv: string[]; placeholders?: number[]; note: string; risk: RecipeRisk; also?: string} | undefined;
}

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^(?:\d{1,3}\.){3}\d{1,3}$|^localhost$/u;
/** Short names people use for well-known hosts; anything else needs the full host name. */
const KNOWN_HOSTS: Record<string, string> = {google: 'google.com', github: 'github.com', cloudflare: 'cloudflare.com', apple: 'apple.com', microsoft: 'microsoft.com',
  amazon: 'amazon.com', wikipedia: 'wikipedia.org', npm: 'registry.npmjs.org', 'the internet': '1.1.1.1', internet: '1.1.1.1'};
const SAFE_WORD = /^[\w.@%+=:,-]{1,80}$/u;

export function validHost(value: string): string | undefined {
  const host = value.toLowerCase().replace(/^https?:\/\//u, '').replace(/\/.*$/u, '');
  return HOST.test(host) ? host : KNOWN_HOSTS[host];
}

/** Unix permission digits → rwx text, computed (no lookup). */
export function explainMode(mode: string): string | undefined {
  if (!/^[0-7]{3,4}$/u.test(mode)) return undefined;
  const digits = mode.slice(-3).split('').map(Number);
  const rwx = (digit: number) => `${digit & 4 ? 'r' : '-'}${digit & 2 ? 'w' : '-'}${digit & 1 ? 'x' : '-'}`;
  const words = (digit: number) => [digit & 4 ? 'read' : '', digit & 2 ? 'write' : '', digit & 1 ? 'execute' : ''].filter(Boolean).join(', ') || 'nothing';
  const special = mode.length === 4 && mode[0] !== '0' ? ` The leading ${mode[0]} sets ${[Number(mode[0]) & 4 ? 'setuid' : '', Number(mode[0]) & 2 ? 'setgid' : '', Number(mode[0]) & 1 ? 'sticky' : ''].filter(Boolean).join(' and ')}.` : '';
  return `chmod ${mode} sets ${digits.map(rwx).join('')}:\n  owner  ${rwx(digits[0]!)}  ${words(digits[0]!)}\n  group  ${rwx(digits[1]!)}  ${words(digits[1]!)}\n  others ${rwx(digits[2]!)}  ${words(digits[2]!)}\nEach digit adds read 4, write 2, execute 1.${special}`;
}

const RECIPES: Recipe[] = [
  {id: 'archive.extract', title: 'Extract an archive',
    match: text => /\b(?:unzip|extract|decompress|uncompress|unpack|open)\b/u.test(text) && /\b(?:zip|tar|tgz|tar\.gz|archive|tarball|gz)\b/u.test(text) && !/\b(?:make|create)\b/u.test(text)
      ? {archive: /\bzip\b/u.test(text) && !/\btar\b/u.test(text) ? 'zip' : /\bgz|tgz\b/u.test(text) ? 'tar.gz' : /\btar\b/u.test(text) ? 'tar' : 'zip', ...pathArg(text)} : undefined,
    build: (args) => args.archive === 'zip'
      ? {argv: ['unzip', args.path ?? '<archive.zip>'], placeholders: args.path ? [] : [1], note: 'Extracts into the current folder (-d <folder> picks another).', risk: 'read'}
      : {argv: ['tar', args.archive === 'tar' ? '-xf' : '-xzf', args.path ?? `<archive.${args.archive}>`], placeholders: args.path ? [] : [2], note: 'x extract, z gzip, f the archive file. Add -C <folder> to extract elsewhere.', risk: 'read'}},
  {id: 'archive.create', title: 'Create an archive',
    match: text => /\b(?:make|create|build|compress|zip up|archive)\b/u.test(text) && /\b(?:zip|tar|tgz|tar\.gz|archive|tarball)\b/u.test(text)
      ? {archive: /\btar\.gz|tgz|tarball|gz\b/u.test(text) ? 'tar.gz' : /\btar\b/u.test(text) ? 'tar' : 'zip'} : undefined,
    build: (args) => args.archive === 'zip'
      ? {argv: ['zip', '-r', '<name.zip>', '<folder>'], placeholders: [2, 3], note: '-r includes everything inside the folder.', risk: 'read'}
      : {argv: ['tar', args.archive === 'tar' ? '-cf' : '-czf', `<name.${args.archive}>`, '<folder>'], placeholders: [2, 3], note: 'c create, z gzip, f the output file.', risk: 'read'}},
  {id: 'permissions.explain', title: 'Explain a permission mode',
    match: text => { const mode = /\bchmod\s+([0-7]{3,4})\b/u.exec(text)?.[1] ?? (/\b(?:permissions?|mode)\b/u.test(text) ? /\b([0-7]{3,4})\b/u.exec(text)?.[1] : undefined); return mode ? {mode} : undefined; },
    fact: args => explainMode(args.mode!),
    build: () => undefined},
  {id: 'filesystem.find', title: 'Find files by name',
    match: text => /^(?:how (?:do|can) i|how to)\s+(?:find|locate|search for)\s+(?:a |the )?files?\b/u.test(text) ? {...nameArg(text)} : undefined,
    build: (args, _platform, has) => has('fd') && args.name
      ? {argv: ['fd', args.name], note: 'fd searches by name from here, skipping ignored files.', risk: 'read'}
      : {argv: ['find', '.', '-name', args.name ? `*${args.name}*` : '<pattern>'], placeholders: args.name ? [] : [3], note: 'Searches from this folder down; -iname ignores case.', risk: 'read',
        also: 'Ask can also find files itself: "find files named config".'}},
  {id: 'search.text', title: 'Search file contents',
    match: text => { const match = /^(?:please )?(?:grep|search|rg|ripgrep|look|find)\s+(?:for|the text|text|code for|the code for)\s+["']?([^"'\s]+)["']?(?:\s+in (?:here|this (?:repo|project|folder)|the (?:repo|project|code)))?$/u.exec(text)
      ?? /^(?:how (?:do|can) i|how to)\s+(?:grep|search (?:for )?text|search (?:inside|in) files)\b/u.exec(text); return match ? {...(match[1] && SAFE_WORD.test(match[1]) ? {pattern: match[1]} : {})} : undefined; },
    build: (args, _platform, has) => has('rg')
      ? {argv: ['rg', '-n', args.pattern ?? '<pattern>'], placeholders: args.pattern ? [] : [2], note: 'Searches files under this folder (respecting .gitignore) and shows line numbers.', risk: 'read'}
      : {argv: ['grep', '-rn', args.pattern ?? '<pattern>', '.'], placeholders: args.pattern ? [] : [2], note: 'Searches files under this folder and shows line numbers.', risk: 'read'}},
  {id: 'network.ping', title: 'Check a host is reachable',
    match: text => { const match = /\bping\s+([\w.:/-]+|the internet)\b/u.exec(text); return match || /\bping\b/u.test(text) ? {...(match && validHost(match[1]!) ? {host: validHost(match[1]!)} : {})} : undefined; },
    build: (args) => ({argv: ['ping', '-c', '4', args.host ?? '<host>'], placeholders: args.host ? [] : [3], note: 'Sends 4 packets and reports round-trip times (-c stops it; plain ping runs until Ctrl+C).', risk: 'network'})},
  {id: 'system.diskUsage', title: 'Disk usage',
    match: text => /\b(?:disk|storage|drive)\b.*\b(?:usage|space|full|free|left|used)\b|\b(?:free|used) (?:disk )?space\b|\bhow (?:much|full) (?:disk|space|storage)\b|\bdf\b/u.test(text)
      ? {...(/\b(?:this|the|current) (?:folder|directory|repo|project)\b|\bfolder size\b/u.test(text) ? {path: '.'} : {})} : undefined,
    build: (args) => args.path ? {argv: ['du', '-sh', '.'], note: 'Total size of this folder.', risk: 'read'} : {argv: ['df', '-h'], note: 'Size, used and available space on each mounted volume.', risk: 'read'}},
  {id: 'process.port', title: 'What is using a port',
    match: text => { const port = /\bports?\s+(\d{1,5})\b|\b:(\d{1,5})\b|\b(\d{2,5})\s+port\b/u.exec(text); const value = Number(port?.[1] ?? port?.[2] ?? port?.[3]);
      return port && /\b(?:using|on|listening|running|uses|who|what|which|taken|busy|occupied)\b/u.test(text) && value > 0 && value < 65536 ? {port: value} : undefined; },
    build: (args, platform, has) => has('lsof') || platform === 'darwin'
      ? {argv: ['lsof', '-nP', `-iTCP:${args.port}`, '-sTCP:LISTEN'], note: `The process listening on TCP port ${args.port} (PID, command, user).`, risk: 'read'}
      : has('ss') ? {argv: ['ss', '-ltnp', `sport = :${args.port}`], note: `Sockets listening on port ${args.port}; the process shows when it is yours.`, risk: 'read'} : undefined},
  {id: 'process.list', title: 'Running processes',
    match: text => { const named = /\b(?:running|active)\s+([\w.-]+)\s+process(?:es)?\b|\b([\w.-]+)\s+process(?:es)?\b.*\brunning\b|\bprocess(?:es)? (?:named|called|for)\s+([\w.-]+)/u.exec(text);
      if (named) { const name = named[1] ?? named[2] ?? named[3]; return name && !/^(?:the|all|my|every|any)$/u.test(name) ? {name} : {}; }
      return /\b(?:what(?:'s| is)? running|running processes|list processes|show processes|what am i running|top processes)\b/u.test(text) ? {} : undefined; },
    build: (args, platform) => args.name
      ? {argv: platform === 'darwin' ? ['pgrep', '-lf', args.name] : ['pgrep', '-af', args.name], note: `Processes whose command line contains "${args.name}", with their PIDs.`, risk: 'read'}
      : {argv: platform === 'darwin' ? ['ps', '-Ao', 'pid,%cpu,%mem,etime,comm', '-r'] : ['ps', '-eo', 'pid,%cpu,%mem,etime,comm', '--sort=-%cpu'], note: 'Every process, busiest first.', risk: 'read'}},
  {id: 'network.localAddress', title: 'Local IP address',
    match: text => /\b(?:my |local |internal |lan |private )?ip(?: address)?\b|\bip addr/u.test(text) && !/\bpublic|external\b/u.test(text) ? {} : undefined,
    fact: () => {
      const addresses = Object.entries(networkInterfaces()).flatMap(([name, list]) => (list ?? []).filter(item => item.family === 'IPv4' && !item.internal).map(item => `${item.address}  ${name}`));
      return addresses.length ? `Local IPv4 address${addresses.length === 1 ? '' : 'es'}:\n${addresses.map(line => `  ${line}`).join('\n')}` : 'This machine has no non-loopback IPv4 address right now.';
    },
    build: (_args, platform) => platform === 'darwin' ? {argv: ['ipconfig', 'getifaddr', 'en0'], note: 'en0 is usually Wi-Fi on a Mac; ifconfig lists every interface.', risk: 'read'}
      : {argv: ['hostname', '-I'], note: 'Every address assigned to this host.', risk: 'read'}},
  {id: 'system.memory', title: 'Memory use',
    match: text => /\b(?:memory|ram)\b/u.test(text) && /\b(?:how much|using|used|free|usage|left|available|show|check)\b/u.test(text) ? {} : undefined,
    fact: (_args, context) => {
      const total = totalmem();
      const free = freemem();
      const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
      return `Memory: ${gb(total - free)} used of ${gb(total)} (${gb(free)} free).${context.platform === 'darwin' ? '\nmacOS counts cache as used; Activity Monitor\'s Memory Pressure is the better signal.' : ''}`;
    },
    build: (_args, platform) => platform === 'darwin' ? {argv: ['top', '-l', '1', '-s', '0', '-n', '0'], note: 'One snapshot of system memory and CPU.', risk: 'read'}
      : {argv: ['free', '-h'], note: 'Used, free and cached memory.', risk: 'read'}},
  {id: 'filesystem.cwd', title: 'Current directory',
    match: text => /\b(?:current|working|which|what) (?:directory|folder|dir)\b|\bwhere am i\b|\bpwd\b/u.test(text) && !/\bfiles?\b/u.test(text) ? {} : undefined,
    fact: (_args, context) => `You're in ${context.cwd}${context.repoRoot && context.repoRoot !== context.cwd ? ` (inside ${context.repoRoot})` : ''}.`,
    build: () => ({argv: ['pwd'], note: 'Prints the working directory.', risk: 'read'})},
];

function pathArg(text: string): RecipeArgs {
  const path = /\b([\w./~-]+\.(?:zip|tar\.gz|tgz|tar))\b/u.exec(text)?.[1];
  return path && SAFE_WORD.test(path.replace(/[/~]/gu, '')) ? {path} : {};
}
function nameArg(text: string): RecipeArgs {
  const name = /\b(?:named|called)\s+["']?([\w.*-]+)["']?/u.exec(text)?.[1];
  return name ? {name} : {};
}

const HOW = /^(?:please )?(?:how (?:do|can|would|should) i|how to|what(?:'s| is) the (?:command|syntax)|which command|what command|show me (?:how|the command)|tell me how|explain how)\b/u;
const DO_IT = /^(?:please |can you |could you |would you |go ahead and |just )*(?:ping|show|list|check|run|tell me|what(?:'s| is| are)?|how much|how full|which|who|find|grep|search|where)\b/u;

export interface RecipeMatch {recipe: Recipe; args: RecipeArgs}

export function matchRecipe(text: string): RecipeMatch | undefined {
  for (const recipe of RECIPES) {
    const args = recipe.match(text);
    if (args) return {recipe, args};
  }
  return undefined;
}

/** Recipe argv Ask may run: only shapes this module builds, re-checked by the app right before running. */
export function recipeRunAllowed(argv: readonly string[]): RecipeRisk | undefined {
  const [command, ...rest] = argv;
  if (argv.some(part => /^<.*>$/u.test(part) || /[\n\u0000]/u.test(part))) return undefined;
  if (command === 'ping') return rest.length === 3 && rest[0] === '-c' && rest[1] === '4' && validHost(rest[2]!) === rest[2] ? 'network' : undefined;
  const read: Record<string, (args: string[]) => boolean> = {
    df: args => args.join(' ') === '-h', du: args => args.join(' ') === '-sh .', pwd: args => !args.length,
    lsof: args => args.length === 3 && args[0] === '-nP' && /^-iTCP:\d{1,5}$/u.test(args[1]!) && args[2] === '-sTCP:LISTEN',
    ss: args => args.length === 2 && args[0] === '-ltnp' && /^sport = :\d{1,5}$/u.test(args[1]!),
    pgrep: args => args.length === 2 && /^-(?:lf|af)$/u.test(args[0]!) && SAFE_WORD.test(args[1]!),
    ps: args => /^(?:-Ao|-eo)$/u.test(args[0] ?? '') && args[1] === 'pid,%cpu,%mem,etime,comm',
    rg: args => args.length === 2 && args[0] === '-n' && SAFE_WORD.test(args[1]!),
    grep: args => args.length === 3 && args[0] === '-rn' && SAFE_WORD.test(args[1]!) && args[2] === '.',
    fd: args => args.length === 1 && SAFE_WORD.test(args[0]!),
    find: args => args.length === 3 && args[0] === '.' && args[1] === '-name' && /^\*?[\w.-]+\*?$/u.test(args[2]!),
    'ipconfig': args => args.join(' ') === 'getifaddr en0', hostname: args => args.join(' ') === '-I', free: args => args.join(' ') === '-h',
    top: args => args.join(' ') === '-l 1 -s 0 -n 0',
  };
  return command && read[command]?.(rest) ? 'read' : undefined;
}

/**
 * Resolve a terminal task. "how do I…" explains with the command (Run behind
 * the final Yes); asking for the result runs a local read-only recipe at once
 * and a network one after the Yes. Undefined leaves the request to the rest
 * of the resolver.
 */
export function resolveRecipe(text: string, context: AskContext, commands?: CommandEnvironment): AskOutcome | undefined {
  const found = matchRecipe(text);
  if (!found) return undefined;
  const {recipe, args} = found;
  const platform: Platform = context.platform === 'darwin' ? 'darwin' : context.platform === 'linux' ? 'linux' : 'other';
  const has = (name: string) => Boolean(commands?.identity(name));
  const how = HOW.test(text);
  const fact = recipe.fact?.(args, context);
  const built = recipe.build(args, platform, has);
  if (!built) return fact ? {kind: 'answer', capability: 'help.command', text: fact} : undefined;
  // The executable must exist here; otherwise the command is shown as knowledge, never run.
  const installed = has(built.argv[0]!);
  const runnable = installed && !built.placeholders?.length && recipeRunAllowed(built.argv) === built.risk;
  const block: CommandBlock = {argv: built.argv, ...(built.placeholders?.length ? {placeholders: built.placeholders} : {}), provenance: 'reference', risk: 'read',
    note: `${built.note}${installed ? '' : ` (${built.argv[0]} isn't installed here)`}`, ...(runnable ? {run: {kind: 'recipe', argv: built.argv, risk: built.risk}} : {})};
  if (fact && (!how || !built)) {
    return {kind: 'answer', capability: 'help.command', text: fact, block, referents: {command: built.argv.slice(0, 1), block}};
  }
  // Asking for the thing itself: local reads run now; network reads wait for the final Yes.
  if (!how && runnable && DO_IT.test(text)) {
    return {kind: 'proposal', capability: 'help.command', safety: 'read', confidence: 0.9, direct: built.risk === 'read',
      text: built.risk === 'network' ? `${recipe.title}: this contacts ${args.host ?? 'the network'}. Run it?` : `${recipe.title}:`,
      command: built.argv.join(' '), action: {kind: 'recipe', argv: built.argv, risk: built.risk}, referents: {command: built.argv.slice(0, 1), block}};
  }
  const next: AskOption[] = built.also ? [{key: `recipe:${recipe.id}:also`, label: built.also.replace(/^Ask can also /u, '').replace(/^find/u, 'Find'), refine: 'find files named '}] : [];
  return {kind: 'answer', capability: 'help.command', text: `${recipe.title}:${built.risk === 'network' ? ' (contacts the network)' : ''}`, block, next, referents: {command: built.argv.slice(0, 1), block}};
}

/** Recipe ids and titles, for the guide and an optional model's inventory (ids only, never commands). */
export const RECIPE_INVENTORY = RECIPES.map(recipe => ({id: recipe.id, title: recipe.title}));
