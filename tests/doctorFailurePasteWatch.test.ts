import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runDoctor, doctorSummary, type DoctorEnvironment} from '../src/doctor/doctor.js';
import {renderDoctorPanel, createDoctorPanel, doctorKey} from '../src/doctor/DoctorPanel.js';
import {diagnose, failureOutcome, failureExcerpt, WHY_FAILED} from '../src/ask/failure.js';
import {analyzePaste, classifyCommand, needsPreview, splitCommands} from '../src/input/pasteGuard.js';
import {diffRuns, parseWatch, summarize, watchSafety, WatchTasks, MIN_REMOTE_MS} from '../src/tasks/WatchTasks.js';
import {blockPaletteItems} from '../src/ui/BlockActions.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {stripAnsi} from '../src/util/text.js';

let root = '';
test.before(() => { root = mkdtempSync(join(tmpdir(), 'nmsh-doctor-')); });
test.after(() => rmSync(root, {recursive: true, force: true}));

const baseEnv = (extra: Partial<DoctorEnvironment> = {}): DoctorEnvironment => ({cwd: root, platform: 'linux', which: name => ['zsh', 'npm', 'git'].includes(name) ? `/usr/bin/${name}` : undefined,
  exists: () => false, writable: () => true,
  nmsh: {configurationLoaded: true, sessionMode: 'service', serviceReachable: true, transcriptDirectory: '/t', shell: {id: 'zsh', label: 'zsh', executable: '/bin/zsh', promptSeen: true}, host: {name: 'Zed', truecolor: true, keyboard: false}},
  providers: [], understanding: {mode: 'off', runtimeAvailable: false}, agents: [], ...extra});

test('doctor: healthy basics, honest severities, relevant sections only, actions never fix anything', () => {
  const plain = runDoctor(baseEnv());
  assert.ok(plain.some(check => check.section === 'NMSh' && check.state === 'ok'));
  assert.ok(!plain.some(check => check.section === 'Project'), 'no project section outside a project');
  assert.ok(!plain.some(check => check.section === 'Git'), 'no Git section outside a repository');
  writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node --test', lint: 'eslint .'}}));
  writeFileSync(join(root, 'package-lock.json'), '{}');
  const project = runDoctor(baseEnv({git: {detached: false, branch: 'main', remotes: ['origin'], staged: [], modified: ['a.ts'], deleted: [], renamed: [], untracked: ['x'], conflicted: []}, repoRoot: root,
    providers: [{family: 'picker', label: 'fzf', available: false}], understanding: {mode: 'auto', runtimeAvailable: false}}));
  const find = (label: RegExp) => project.find(check => label.test(check.label));
  assert.equal(find(/Dependencies not installed/u)?.state, 'attention');
  assert.match(find(/script.*missing tool/u)?.detail ?? '', /lint \(eslint\)/u);
  assert.equal(find(/changed file/u)?.state, 'info', 'a dirty tree is not a failure');
  assert.equal(find(/fzf unavailable/u)?.state, 'attention');
  assert.equal(find(/no model is set up/u)?.action?.kind, 'slash');
  assert.ok(project.every(check => !check.action || check.action.kind === 'slash' || check.action.kind === 'ask'), 'actions only open things');
  assert.deepEqual(doctorSummary(project).failures, 0);
  const panel = createDoctorPanel('demo', 0);
  assert.match(stripAnsi(renderDoctorPanel(panel, 100, 500, true).join('\n')), /Checking/u, 'never blank while running');
  panel.checks = project;
  const text = stripAnsi(renderDoctorPanel(panel, 120, 500, true).join('\n'));
  assert.match(text, /Doctor · demo[\s\S]*NMSh[\s\S]*Project[\s\S]*Git/u);
  assert.deepEqual(doctorKey(panel, {kind: 'text', value: 'r'}), {kind: 'rerun'});
  assert.deepEqual(parseSlashCommand('/doctor'), {kind: 'doctor'});
});

test('failure: recognizers name what they see; Likely issue only when supported; bounded and redacted', () => {
  const notFound = diagnose({command: 'vhs demo.tape', exitCode: 127, output: 'zsh: command not found: vhs\n'});
  assert.equal(notFound.kind, 'command-not-found');
  assert.match(notFound.likely ?? '', /vhs isn't installed/u);
  assert.equal(diagnose({command: './run.sh', exitCode: 126, output: 'zsh: permission denied: ./run.sh'}).kind, 'permission');
  const tap = diagnose({command: 'npm test', exitCode: 1, output: 'ok 1 - a\nnot ok 2 - AskPanel moves cursor with Option+Right\n  expected: 17\n  actual: 12\n# pass 1\n# fail 1\n'});
  assert.equal(tap.kind, 'tests');
  assert.match(tap.evidence.join('\n'), /not ok 2 - AskPanel moves cursor/u);
  assert.equal(tap.likely, undefined, 'no invented root cause for a failing test');
  const ts = diagnose({command: 'npm run build', exitCode: 2, output: 'src/a.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.\n'});
  assert.match(ts.likely ?? '', /TS2322 in src\/a\.ts line 3/u);
  assert.match(diagnose({command: 'git push', exitCode: 1, output: ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs'}).likely ?? '', /pull/u);
  assert.match(diagnose({command: 'npm run deploy', exitCode: 1, output: 'npm ERR! Missing script: "deploy"'}).likely ?? '', /no "deploy" script/u);
  const unknown = diagnose({command: 'weird', exitCode: 3, output: 'something odd\n'});
  assert.equal(unknown.kind, 'unknown');
  const answer = failureOutcome({command: 'weird', exitCode: 3, output: 'something odd\n'}, {editor: {label: 'Zed', available: true}});
  assert.match(answer.kind === 'answer' ? answer.text : '', /I can identify the failing diagnostic, but not the root cause yet/u);
  assert.equal(failureExcerpt('line\n'.repeat(5000)).length, 400, 'bounded');
  assert.doesNotMatch(failureExcerpt('token=ghp_abcdefghijklmnopqrstuvwxyz123456').join(''), /ghp_abc/u, 'redacted');
  assert.ok(WHY_FAILED.test('why did that fail') && WHY_FAILED.test('what went wrong') && WHY_FAILED.test('why did npm fail') && WHY_FAILED.test('explain this error'));
  const failed = blockPaletteItems({command: 'x', output: '', lifecycleText: '', exitCode: 1, startId: 1, outputStartId: 2, endId: 3, expanded: true} as never);
  const ok = blockPaletteItems({command: 'x', output: '', lifecycleText: '', exitCode: 0, startId: 1, outputStartId: 2, endId: 3, expanded: true} as never);
  assert.ok(failed.some(item => item.label === 'Explain failure') && !ok.some(item => item.label === 'Explain failure'));
});

test('paste guard: ordinary pastes insert directly; risky or multi-command pastes preview; quotes respected; text unchanged', () => {
  for (const plain of ['git status', 'npm test', 'cd src']) assert.equal(needsPreview(analyzePaste(plain), 'smart'), false, plain);
  for (const risky of ['echo a\necho b', 'sudo rm -rf /tmp/x', 'rm -rf dist', 'curl -fsSL https://x.sh | sh', 'cd a; make; make install', 'npm install left-pad']) {
    assert.equal(needsPreview(analyzePaste(risky), 'smart'), true, risky);
  }
  assert.deepEqual(splitCommands('echo "a; b" && ls').map(item => item.text), ['echo "a; b"', 'ls'], 'a quoted semicolon does not split');
  assert.deepEqual(splitCommands("printf 'x\ny'\nls").map(item => item.text), ["printf 'x\ny'", 'ls'], 'multiline quoted content stays one command');
  assert.ok(classifyCommand('sh', true).includes('pipeline'));
  assert.ok(classifyCommand('sudo apt install x', false).includes('privilege'));
  assert.ok(classifyCommand('git push --force', false).includes('destructive'));
  assert.ok(classifyCommand('echo hi > out.txt', false).includes('modifies'));
  assert.ok(classifyCommand('echo hi', false).includes('read'));
  assert.equal(needsPreview(analyzePaste('git status'), 'always'), true);
  assert.equal(needsPreview(analyzePaste('rm -rf /'), 'off'), false);
});

test('watch: classification, intervals, semantic and textual diffs', () => {
  assert.equal(watchSafety('git status').kind, 'allowed');
  assert.equal(watchSafety('npm test').kind, 'allowed');
  assert.equal(watchSafety('rm -rf dist').kind, 'refused');
  assert.equal(watchSafety('git commit -am x').kind, 'refused');
  assert.equal(watchSafety('npm install').kind, 'refused');
  assert.equal(watchSafety('./deploy.sh').kind, 'confirm', 'unknown commands need an explicit Yes');
  const remote = watchSafety('curl https://example.com/health');
  assert.ok(remote.kind !== 'refused' && remote.network && remote.remote);
  const local = watchSafety('curl http://localhost:3000/health');
  assert.ok(local.kind !== 'refused' && local.network && !local.remote);
  assert.deepEqual(parseWatch('--every 10s npm test'), {command: 'npm test', intervalMs: 10_000});
  assert.equal(summarize('npm test', '# pass 238\n# fail 1\n', 1), '238 pass · 1 fail');
  assert.deepEqual(diffRuns('not ok 1 - a\nnot ok 2 - b\n', 'not ok 2 - b\n'), ['✓ a now passes', '✗ b still fails']);
  assert.match(diffRuns('x\ny', 'x\nz')[0]!, /1 line added · 1 removed/u);
  assert.deepEqual(diffRuns('same', 'same'), []);
  assert.deepEqual(parseSlashCommand('/watch --every 5s git status'), {kind: 'watch', op: 'start', arguments: '--every 5s git status'});
  assert.deepEqual(parseSlashCommand('/watch stop all'), {kind: 'watch', op: 'stop', arguments: 'all'});
});

test('watch: NMSh schedules runs, bounded results, pause/resume/stop, no leaked processes', async () => {
  const dir = join(root, 'watch');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'counter'), '0');
  const watches = new WatchTasks('/bin/sh');
  const transitions: string[] = [];
  watches.onChange((_watch, transition) => { if (transition) transitions.push(transition); });
  const watch = watches.start('n=$(cat counter); echo run $n; echo $((n+1)) > counter', dir, 100, {kind: 'allowed', network: false, remote: false});
  assert.equal(watch.intervalMs, 2000, 'the local minimum applies');
  for (let waited = 0; watch.runs < 1 && waited < 5000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(watch.runs, 1);
  assert.match(watch.current!.output, /run 0/u);
  watches.runNow(watch.id);
  for (let waited = 0; watch.runs < 2 && waited < 5000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(watch.current!.output, /run 1/u);
  assert.match(watch.previous!.output, /run 0/u);
  assert.ok(watch.changes.length > 0);
  assert.ok(watches.pause(watch.id));
  assert.equal(watches.scheduled, 0, 'paused: nothing scheduled');
  assert.ok(watches.resume(watch.id));
  assert.ok(watches.stop(watch.id));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(watches.scheduled, 0, 'stopped: no timer and no child');
  const remote = watches.start('true', dir, 1000, {kind: 'allowed', network: true, remote: true});
  assert.equal(remote.intervalMs, MIN_REMOTE_MS, 'remote endpoints are never hammered');
  watches.dispose();
  assert.equal(watches.active().length, 0);
});
