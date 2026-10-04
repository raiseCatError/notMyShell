import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveRequest} from '../src/ask/resolver.js';
import {listProjectFiles} from '../src/ask/files.js';
import {ordinalIn} from '../src/ask/fileAssist.js';
import {explainMode, recipeRunAllowed, validHost} from '../src/ask/recipes.js';
import {isLongRunning, projectRunAllowed, readProjectFacts, scriptArgv} from '../src/ask/project.js';
import {gitRunAllowed, renderCommand} from '../src/ask/gitAssist.js';
import {ManagedTasks, extractUrls} from '../src/tasks/ManagedTasks.js';
import {createAskState, receiveOutcome, submitText} from '../src/ask/AskPanel.js';
import type {GitFacts} from '../src/ask/git.js';
import type {AskContext, AskOutcome, AskReferents} from '../src/ask/types.js';
import {BundledCatalog} from '../src/shell/BundledCatalog.js';
import {CommandReference} from '../src/shell/CommandReference.js';
import {DeclarativeSpecSource} from '../src/shell/CompletionSources.js';
import {LocalUnderstanding} from '../src/understanding/LocalUnderstanding.js';

let root = '';
const specs = mkdtempSync(join(tmpdir(), 'nmsh-specs-'));
const installed = new Set(['ping', 'df', 'du', 'lsof', 'pgrep', 'ps', 'rg', 'unzip', 'tar', 'git', 'npm', 'rm', 'chmod']);
const commands = {reference: new CommandReference(new BundledCatalog(), new DeclarativeSpecSource(specs)),
  identity: (name: string) => installed.has(name) ? {kind: 'executable' as const, path: `/usr/bin/${name}`} : undefined};
const git: GitFacts = {detached: false, branch: 'main', upstream: 'origin/main', remotes: ['origin'], staged: ['a.ts'], modified: ['b.ts'], deleted: [], renamed: [], untracked: ['notes.md'], conflicted: []};
function context(extra: Partial<AskContext> = {}): AskContext {
  return {cwd: root, home: '/home/u', repoRoot: root, branch: 'main', worktrees: [], shell: 'zsh', defaultShell: 'zsh', shells: [], sessions: [], transcripts: [],
    recentFiles: [], recentCommands: [], editor: {label: 'Zed', available: true}, providers: [], sessionMode: 'service', now: 0, files: listProjectFiles(root),
    platform: 'darwin', picker: 'native', git, project: readProjectFacts(root), tasks: [], ...extra};
}
const ask = (text: string, extra: Partial<AskContext> = {}) => resolveRequest(text, context(extra), {}, commands);
const shape = (outcome: AskOutcome) => outcome.kind === 'proposal' ? `proposal:${outcome.action.kind}` : `${outcome.kind}:${'capability' in outcome ? outcome.capability ?? '' : ''}`;

test.before(() => {
  root = mkdtempSync(join(tmpdir(), 'nmsh-caps-'));
  for (const dir of ['src', 'tests', 'docs', 'node_modules/x']) mkdirSync(join(root, dir), {recursive: true});
  writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'demo', scripts: {dev: 'vite', test: 'node --test', build: 'tsc -p .', lint: 'eslint .'}}));
  writeFileSync(join(root, 'pnpm-lock.yaml'), '');
  for (const file of ['tsconfig.json', 'README.md', 'src/index.ts', 'src/config.ts', 'src/ask.ts', 'tests/ask.test.ts', '.env']) writeFileSync(join(root, file), file === 'src/config.ts' ? 'const foo = 1;\nexport {foo};\n' : '');
});
test.after(() => { rmSync(root, {recursive: true, force: true}); rmSync(specs, {recursive: true, force: true}); });

test('files: list, browse, find and open are distinct capabilities over real entries', () => {
  for (const phrase of ['show me the files here', 'what files are in this folder', 'list everything in this repo', 'can you help me list the files in my repo', 'list files', 'ls files', 'list all files in repo', 'can you show the files']) {
    const outcome = ask(phrase);
    assert.equal(shape(outcome), 'choose:file.browse', phrase);
    assert.ok(outcome.kind === 'choose' && outcome.options.some(option => option.label === 'src/') && outcome.options.some(option => option.label === 'package.json'), phrase);
    assert.ok(outcome.kind === 'choose' && !outcome.options.some(option => option.label === '.env'), 'hidden files only when asked');
  }
  const hidden = ask('list hidden files');
  assert.ok(hidden.kind === 'choose' && hidden.options.some(option => option.label === '.env'));
  assert.equal(shape(ask('open package.json')), 'proposal:openFile');
  assert.equal(shape(ask('open')), 'choose:file.browse', 'bare open browses with Native');
  assert.equal(shape(ask('open a file')), 'choose:file.browse');
  assert.equal(shape(ask('open', {picker: 'fzf'})), 'proposal:pickFile', 'a configured picker is reused');
  assert.equal(shape(ask('open src')), 'choose:file.browse');
  assert.equal(shape(ask('find tsconfig')), 'choose:file.find');
  const readme = ask('where is the readme');
  assert.match(readme.kind === 'answer' ? readme.text : '', /README\.md/u);
  const typescript = ask('show me all typescript files');
  assert.ok(typescript.kind === 'choose' && typescript.options.length === 4 && typescript.options.every(option => option.label.endsWith('.ts')));
  const config = ask('find files named config');
  assert.ok(config.kind === 'choose' && config.options.some(option => option.label === 'src/config.ts'));
});

test('file referents: ordinals, "what is it" and searching inside it, revalidated against the disk', () => {
  assert.deepEqual([ordinalIn('open the second one'), ordinalIn('open number 3'), ordinalIn('the last one'), ordinalIn('open it')], [2, 3, 'last', undefined]);
  const state = createAskState();
  submitText(state, 'show files in this repo');
  receiveOutcome(state, ask('show files in this repo'));
  const paths = state.referents?.files?.paths ?? [];
  assert.ok(paths.length > 3);
  const referents = state.referents as AskReferents;
  const second = ask('open the second one', {referents});
  const target = paths[1]!;
  assert.ok(second.kind === 'choose' || (second.kind === 'proposal' && second.action.kind === 'openFile' && second.action.path === target));
  const config = join(root, 'src/config.ts');
  const what = ask('what is it', {referents: {file: config}});
  assert.match(what.kind === 'answer' ? what.text : '', /TypeScript source · 29 bytes · 2 lines/u);
  const where = ask('show me where foo is in it', {referents: {file: config}});
  assert.match(where.kind === 'answer' ? where.text : '', /"foo" in src\/config\.ts · 2 lines/u);
  const gone = ask('open the first one', {referents: {files: {paths: [join(root, 'deleted.txt')], kind: 'listed'}}});
  assert.match(gone.kind === 'answer' ? gone.text : '', /no longer exists/u);
});

test('recipes: platform-aware commands from validated arguments; "how do i" explains, asking runs reads at once and network after Yes', () => {
  const unzip = ask('how do i unzip a zip');
  assert.equal(unzip.kind === 'answer' && unzip.block ? renderCommand(unzip.block, 'zsh') : '', 'unzip <archive.zip>');
  const tar = ask('how do i make a tar.gz');
  assert.equal(tar.kind === 'answer' && tar.block?.argv.join(' '), 'tar -czf <name.tar.gz> <folder>');
  assert.match(ask('what does chmod 755 mean').kind === 'answer' ? (ask('what does chmod 755 mean') as {text: string}).text : '', /rwxr-xr-x[\s\S]*group  r-x/u);
  assert.equal(explainMode('644')?.split('\n')[0], 'chmod 644 sets rw-r--r--:');
  const ping = ask('can you ping google');
  assert.equal(shape(ping), 'proposal:recipe');
  assert.ok(ping.kind === 'proposal' && !ping.direct, 'network waits for the final Yes');
  assert.deepEqual(ping.kind === 'proposal' && ping.action, {kind: 'recipe', argv: ['ping', '-c', '4', 'google.com'], risk: 'network'});
  assert.equal(shape(ask('how do i ping something')), 'answer:help.command', 'how-to explains, never runs');
  const disk = ask('show my disk usage');
  assert.ok(disk.kind === 'proposal' && disk.direct && disk.action.kind === 'recipe' && disk.action.argv.join(' ') === 'df -h', 'local read runs at once');
  const port = ask('what is using port 3000');
  assert.deepEqual(port.kind === 'proposal' && port.action.kind === 'recipe' && port.action.argv, ['lsof', '-nP', '-iTCP:3000', '-sTCP:LISTEN']);
  const linuxPort = ask('what is using port 3000', {platform: 'linux'});
  assert.equal(linuxPort.kind === 'proposal' && linuxPort.action.kind === 'recipe' && linuxPort.action.argv[0], 'lsof', 'lsof is installed in this fixture');
  const node = ask('show running node processes');
  assert.deepEqual(node.kind === 'proposal' && node.action.kind === 'recipe' && node.action.argv, ['pgrep', '-lf', 'node']);
  const nodeLinux = ask('show running node processes', {platform: 'linux'});
  assert.deepEqual(nodeLinux.kind === 'proposal' && nodeLinux.action.kind === 'recipe' && nodeLinux.action.argv, ['pgrep', '-af', 'node']);
  assert.match((ask('what\'s my local ip') as {text: string}).text, /IPv4|no non-loopback/u);
  assert.match((ask('how much memory am i using') as {text: string}).text, /^Memory: [\d.]+ GB used of/u);
  assert.match((ask('show current directory') as {text: string}).text, /^You're in /u);
  const grep = ask('grep for foo');
  assert.deepEqual(grep.kind === 'proposal' && grep.action.kind === 'recipe' && grep.action.argv, ['rg', '-n', 'foo']);
  // Validation: hosts and run shapes.
  assert.equal(validHost('google.com; rm -rf ~'), undefined);
  assert.equal(validHost('github'), 'github.com');
  assert.equal(recipeRunAllowed(['ping', '-c', '4', 'example.com']), 'network');
  assert.equal(recipeRunAllowed(['ping', 'example.com']), undefined, 'unbounded ping is not allowed');
  assert.equal(recipeRunAllowed(['rg', '-n', '$(whoami)']), undefined);
  assert.equal(recipeRunAllowed(['df', '-h', '/']), undefined);
});

test('command knowledge explains dangerous commands freely; aliases and combined flags', () => {
  const rm = ask('what does rm -rf do');
  assert.equal(rm.kind, 'answer');
  assert.ok(rm.kind === 'answer' && !rm.block?.run, 'explaining never offers Run');
  const ripgrep = ask('how do i use ripgrep');
  assert.match(ripgrep.kind === 'answer' ? ripgrep.text : '', /^rg/u);
  const thisCommand = ask('what does this command do', {referents: {block: {argv: ['git', 'rebase', 'main'], provenance: 'reference', risk: 'destructive'}}});
  assert.match(thisCommand.kind === 'answer' ? thisCommand.text : '', /^git rebase/u);
});

test('git: plain push is not force push; syntax questions are answered; branch creation and last commit', () => {
  for (const phrase of ['how to push', 'how do i push', 'what\'s the syntax to push']) {
    const outcome = ask(phrase);
    assert.equal(outcome.kind, 'answer', phrase);
    assert.match(outcome.kind === 'answer' ? outcome.text : '', /git push \[<remote> \[<branch>\]\]/u);
    assert.equal(outcome.kind === 'answer' && outcome.block?.risk, 'mutate', 'a normal push is mutating, not destructive');
  }
  const push = ask('push this branch');
  assert.ok(push.kind === 'answer' && push.block?.run, 'push offers Run behind the final Yes');
  const force = ask('force push this');
  assert.ok(force.kind === 'answer' && force.block?.risk === 'destructive' && !force.block.run);
  assert.equal(gitRunAllowed(['git', 'push', '--force']), undefined);
  assert.equal(gitRunAllowed(['git', 'push']), 'mutate');
  const branch = ask('make a new branch called test');
  assert.deepEqual(branch.kind === 'answer' && branch.block?.argv, ['git', 'switch', '-c', 'test']);
  assert.equal(gitRunAllowed(['git', 'switch', '-c', 'test']), 'mutate');
  assert.equal(gitRunAllowed(['git', 'switch', '--discard-changes', 'x']), undefined);
  assert.equal(gitRunAllowed(['git', 'switch', '-c', '-bad']), undefined);
  const last = ask('what did my last commit do');
  assert.deepEqual(last.kind === 'answer' && last.block?.argv, ['git', 'show', '--stat', 'HEAD']);
  assert.equal(last.kind === 'answer' && last.block?.run?.kind, 'git');
  const staged = ask('show staged files');
  assert.match(staged.kind === 'answer' ? staged.text : '', /1 staged file:\n.*a\.ts/u);
  assert.equal(shape(ask('show me the diff')), 'proposal:read');
  assert.equal(shape(ask('show me the stuff i changed')), 'proposal:read');
  assert.equal(shape(ask('how do i pull')), 'answer:git.status');
});

test('projects: scripts with the project\'s own manager; dev servers become managed tasks; nothing invented', () => {
  const project = readProjectFacts(root)!;
  assert.equal(project.manager, 'pnpm');
  assert.deepEqual(scriptArgv(project, 'dev'), ['pnpm', 'run', 'dev']);
  assert.ok(projectRunAllowed(['pnpm', 'run', 'test'], project));
  assert.ok(!projectRunAllowed(['npm', 'run', 'test'], project), 'the project uses pnpm');
  assert.ok(!projectRunAllowed(['pnpm', 'run', 'deploy'], project), 'no such script');
  assert.ok(isLongRunning('dev', 'vite') && !isLongRunning('test', 'node --test'));
  const dev = ask('run the dev server');
  assert.deepEqual(dev.kind === 'proposal' && dev.action, {kind: 'startTask', argv: ['pnpm', 'run', 'dev'], cwd: root, label: 'Dev server'});
  assert.equal(dev.kind === 'proposal' && dev.safety, 'mutate', 'starting needs the final Yes');
  assert.deepEqual((ask('run the tests') as {action: unknown}).action, {kind: 'project', argv: ['pnpm', 'run', 'test']});
  assert.equal(shape(ask('how do i run this project')), 'answer:project.run');
  const scripts = ask('what scripts does this project have');
  assert.deepEqual(scripts.kind === 'choose' && scripts.options.map(option => option.label), ['dev', 'test', 'build', 'lint']);
  const tasks = [{id: 't1', label: 'Dev server', status: 'running', urls: ['http://localhost:5173'], startedAt: 0, lines: 4, command: 'pnpm run dev'}];
  assert.match((ask('what url is the dev server on', {tasks}) as {text: string}).text, /http:\/\/localhost:5173/u);
  assert.deepEqual((ask('open the dev server', {tasks}) as {action: unknown}).action, {kind: 'openUrl', url: 'http://localhost:5173'});
  assert.deepEqual((ask('show its output', {tasks}) as {action: unknown}).action, {kind: 'taskOutput', id: 't1'});
  assert.deepEqual((ask('stop the dev server', {tasks}) as {action: unknown}).action, {kind: 'stopTask', id: 't1'});
  assert.match((ask('stop the dev server') as {text: string}).text, /only stops tasks it started/u);
});

test('managed tasks: owned process group, bounded output, URLs from output, stop', async () => {
  assert.deepEqual(extractUrls('  ➜  Local:   \u001b[36mhttp://localhost:5173/\u001b[39m'), ['http://localhost:5173']);
  assert.deepEqual(extractUrls('listening on http://0.0.0.0:3000.'), ['http://localhost:3000']);
  const tasks = new ManagedTasks();
  const script = 'console.log("ready"); console.log("Local: http://localhost:4321/"); setInterval(() => {}, 1000);';
  const task = tasks.start('Dev server', [process.execPath, '-e', script], root);
  assert.ok(!('error' in task));
  if ('error' in task) return;
  for (let waited = 0; !task.urls.length && waited < 5000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(task.urls, ['http://localhost:4321']);
  assert.equal(task.status, 'running');
  assert.ok(tasks.stop(task.id));
  for (let waited = 0; task.status !== 'completed' && waited < 6000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(task.status, 'completed', 'a stopped task ends as asked');
  assert.equal(tasks.live().length, 0);
  tasks.dispose();
});

test('safety requests fail closed and stay explainable', () => {
  for (const phrase of ['rm -rf this repo', 'sudo delete this', 'wipe node_modules', 'kill every node process', 'delete all untracked files']) {
    const outcome = ask(phrase);
    assert.ok(outcome.kind === 'unsafe' || (outcome.kind === 'answer' && (!outcome.block?.run || outcome.block.risk === 'destructive')), phrase);
    assert.notEqual(outcome.kind, 'proposal', phrase);
  }
  assert.ok(ask('force push main').kind === 'answer');
});

test('local model questions answer from /llm facts; actions open /llm; model intents resolve through deterministic phrases', async () => {
  const {modelInventory, resolveModelIntent} = await import('../src/ask/resolver.js');
  const llm = {mode: 'auto' as const, model: {label: 'Qwen3 0.6B Q8_0', runtime: 'llama.cpp', owned: true}, state: 'Ready', lastRoute: 'deterministic' as const, lastInference: 'Ask intent · non-thinking', requests: 3};
  const status = ask('what model are you using', {llm});
  assert.match(status.kind === 'answer' ? status.text : '', /Qwen3 0\.6B Q8_0 \(llama\.cpp, NMSh managed\) · Ready[\s\S]*resolved deterministically/u);
  for (const phrase of ['remove the model you downloaded', 'stop the local model', 'find better local models on my machine', 'show local model status']) {
    const outcome = ask(phrase, {llm});
    assert.ok(outcome.kind === 'answer' || (outcome.kind === 'proposal' && outcome.action.kind === 'slash'), phrase);
  }
  const ids = modelInventory().map(item => item.id);
  assert.ok(ids.includes('files.list') && ids.includes('network.ping') && ids.includes('git.status'));
  const ping = resolveModelIntent({capability: 'network.ping', confidence: 0.9, arguments: {target: 'github'}}, context(), {}, commands);
  assert.deepEqual(ping?.kind === 'proposal' && ping.action, {kind: 'recipe', argv: ['ping', '-c', '4', 'github.com'], risk: 'network'});
  assert.equal(resolveModelIntent({capability: 'network.ping', confidence: 0.9, arguments: {target: 'x; rm -rf ~'}}, context(), {}, commands), undefined, 'model arguments are validated');
  assert.equal(resolveModelIntent({capability: 'files.list', confidence: 0.3, arguments: {}}, context(), {}, commands), undefined, 'low confidence is ignored');
  const files = resolveModelIntent({capability: 'files.list', confidence: 0.9, arguments: {}}, context(), {}, commands);
  assert.equal(files?.kind === 'choose' && files.capability, 'file.browse');
});

test('typo tolerance: known vocabulary only, clear winners only, paths never silently changed', async () => {
  const {correctWord, editDistance, correctRequest} = await import('../src/ask/fuzzy.js');
  assert.equal(editDistance('statsu', 'status'), 1, 'transposition counts once');
  assert.equal(correctWord('statsu', ['status', 'stash', 'show']), 'status');
  assert.equal(correctWord('brach', ['branch', 'brash']), undefined, 'two equally close candidates: no guess');
  assert.equal(correctWord('provders', ['providers', 'prompt']), 'providers', 'missing letter');
  assert.equal(correctWord('chromma', ['chroma']), 'chroma', 'duplicated letter');
  assert.equal(correctWord('stzus', ['status']), undefined, 'too far for a short word');
  assert.equal(correctWord('gti', ['git', 'gtk']), 'git', 'three letters: transposition only');
  assert.equal(correctWord('gt', ['git']), undefined, 'two letters are never corrected');
  assert.equal(correctWord('mainn', ['main', 'mainn']), undefined, 'an existing exact word is kept');
  const vocabulary = {known: new Set(['git', 'status', 'mainn.ts', 'mainn']), words: ['open', 'show', 'status'], commands: () => ['git', 'npm'], subcommands: (command: string) => command === 'git' ? ['status', 'stash', 'push'] : []};
  assert.deepEqual(correctRequest('git statsu', vocabulary), {text: 'git status', corrections: [{from: 'statsu', to: 'status'}]});
  assert.equal(correctRequest('open mainn', vocabulary), undefined, 'a real file name is never corrected');
  assert.equal(correctRequest('open "statsu"', vocabulary), undefined, 'quoted text is left alone');
  // Through Ask, with Local Understanding off.
  const status = ask('show untrackd files');
  assert.match(status.kind === 'answer' ? status.text : '', /^Interpreted as: show untracked files/u);
  const typoFile = ask('open packge.json');
  assert.ok(typoFile.kind === 'choose' && /Did you mean package\.json\?/u.test(typoFile.question) && typoFile.options[0]!.outcome?.kind === 'proposal', 'a near file is offered, not substituted');
  assert.equal(shape(ask('opne package.json')), 'proposal:openFile');
  const slash = ask('/provders');
  assert.ok(slash.kind === 'proposal' && slash.action.kind === 'slash');
  const git = ask('git statsu');
  assert.match(git.kind === 'proposal' ? git.text : '', /Interpreted as: git status$/u, 'a corrected command is shown before it runs');
  assert.equal(ask('gt status').kind, 'unclear', 'ambiguous fuzzy matches ask instead of guessing');
});

test('acceptance phrases: files, projects, git, safety, watch, doctor and settings resolve to their typed capabilities', () => {
  const expected: Array<[string, string]> = [
    ['open', 'choose:file.browse'],
    ['find files named config', 'choose:file.find'],
    ['open the readme', 'proposal:openFile'],
    ['run the tests', 'proposal:project'],
    ['start the dev server', 'proposal:startTask'],
    ['how do i push this branch', 'answer:git.status'],
    ['git push', 'answer:git.status'],
    ['git pull', 'answer:git.status'],
    ['git push --force', 'unsafe:'],
    ['delete everything', 'unsafe:'],
    ['show untracked files', 'answer:git.status'],
    ['what does git clean -n do', 'answer:help.command'],
    ['what is using port 3000', 'proposal:recipe'],
    ['watch git status', 'proposal:watch'],
    ['keep running the tests every 5 seconds', 'proposal:watch'],
    ['show watch output', 'proposal:watchControl'],
    ['stop watching', 'proposal:watchControl'],
    ['check my setup', 'proposal:slash'],
    ['change my cursor', 'proposal:slash'],
    ['open settings', 'proposal:slash'],
    ['help', 'answer:help.capabilities'],
    ['guide', 'choose:help.guide'],
  ];
  for (const [phrase, want] of expected) assert.equal(shape(ask(phrase)), want, phrase);
  const push = ask('git push');
  assert.ok(push.kind === 'answer' && /never rewrites history unless you add --force/u.test(push.text), 'a plain push is not a force push');
});

test('acceptance: /ask help lists every category and the guide has the new sections', () => {
  const help = ask('help');
  assert.equal(help.kind, 'answer');
  for (const category of ['Files', 'Commands', 'Git', 'Projects', 'Config', 'Packages', 'Sessions', 'NMSh settings', 'Local understanding']) assert.match((help as {text: string}).text, new RegExp(`\\n  ${category} `, 'u'), category);
  const guide = ask('guide');
  assert.equal(guide.kind, 'choose');
  const labels = (guide as {options: Array<{label: string}>}).options.map(option => option.label);
  for (const title of ['Cursor & effects', 'Local intelligence', 'Project & dev tasks', 'Doctor & watch']) assert.ok(labels.includes(title), title);
});

test('acceptance: local understanding Off never consults the model, Auto only when unsure, Always first', () => {
  const model = {label: 'Qwen3 0.6B Q8_0', runtime: 'llama.cpp', path: '/m/qwen3.gguf', owned: true} as const;
  const off = new LocalUnderstanding(() => ({mode: 'off', ask: true, folding: true, model}));
  const auto = new LocalUnderstanding(() => ({mode: 'auto', ask: true, folding: true, model}));
  const always = new LocalUnderstanding(() => ({mode: 'always', ask: true, folding: true, model}));
  assert.deepEqual([off.eligible('ask'), off.prefersModel], [false, false]);
  assert.deepEqual([auto.eligible('ask'), auto.prefersModel], [true, false]);
  assert.deepEqual([always.eligible('ask'), always.prefersModel], [true, true]);
  // Ask itself never needs the model: the deterministic resolver answers with understanding Off.
  assert.equal(shape(ask('run the tests')), 'proposal:project');
});
