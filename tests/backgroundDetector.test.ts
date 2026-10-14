import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classifyCommand, isClassified, simpleStages} from '../src/backgroundTasks/detector.js';
import {decide, DEFAULT_PREFERENCES, loadPreferences, normalizePreferences, preferencesPath, rememberFamily, savePreferences, type BackgroundPreferences} from '../src/backgroundTasks/preferences.js';
import {clean, TaskOutput} from '../src/backgroundTasks/output.js';

const family = (command: string) => { const result = classifyCommand(command); return isClassified(result) ? result.family : undefined; };

test('streaming invocations are recognized by what their words say, not by the program name', () => {
  const cases: Array<[string, string | undefined]> = [
    ['adb logcat', 'adb logcat'], ['adb -s emulator-5554 logcat -v time', 'adb logcat'], ['adb -d logcat', 'adb logcat'],
    ['adb logcat -d', undefined], ['adb logcat -c', undefined], ['adb logcat -t 100', undefined], ['adb devices', undefined], ['adb shell', undefined],
    ['tail -f app.log', 'tail -f'], ['tail -fn 100 app.log', 'tail -f'], ['tail -F app.log', 'tail -f'], ['tail --follow=name app.log', 'tail -f'], ['tail -n 100 app.log', undefined], ['tail app.log', undefined],
    ['journalctl -f -u nginx', 'journalctl -f'], ['journalctl -u nginx', undefined],
    ['docker logs -f web', 'docker logs -f'], ['docker compose logs -f', 'docker compose logs -f'], ['docker logs web', undefined], ['kubectl logs -f pod/x', 'kubectl logs -f'],
    ['kubectl get pods -w', 'kubectl get --watch'], ['ping example.com', 'ping'], ['ping -c 3 example.com', undefined],
    ['scrcpy', 'scrcpy'], ['scrcpy --max-size 1024', 'scrcpy'], ['scrcpy --version', undefined],
    ['npm run dev', 'npm run dev'], ['pnpm dev', 'pnpm run dev'], ['yarn start', 'yarn run start'], ['bun run watch', 'bun run watch'], ['npm test', undefined], ['npm run build', undefined], ['npm install', undefined],
    ['vite', 'vite'], ['vite build', undefined], ['tsc --watch', 'tsc --watch'], ['tsc', undefined], ['python3 -m http.server 8000', 'python3 -m http.server'], ['python3 script.py', undefined],
    ['/usr/bin/tail -f /var/log/system.log', 'tail -f'], ['ANDROID_SERIAL=abc adb logcat', 'adb logcat'], ['adb logcat | grep ActivityManager', 'adb logcat'],
  ];
  for (const [command, expected] of cases) assert.equal(family(command), expected, command);
  const logcat = classifyCommand('adb logcat');
  assert.deepEqual(logcat, {family: 'adb logcat', kind: 'logging', likelihood: 'streams', reason: 'adb logcat keeps streaming device logs until it is interrupted.'});
  assert.equal((classifyCommand('npm run dev') as {likelihood: string}).likelihood, 'likely', 'a project script is only "likely"');
});

test('anything that needs a shell parser, live state, the terminal or elevated access is never recognized', () => {
  const refused: Array<[string, RegExp]> = [
    ['tail -f $(ls *.log | head -1)', /expansion or substitution/u], ['tail -f "$LOG"', /expansion inside quotes/u], ['tail -f a.log > copy.log', /redirection/u],
    ['tail -f a.log; echo done', /command list/u], ['tail -f a.log &', /background job/u], ['tail -f a.log && x', /command list/u], ['tail -f a.log || x', /command list/u],
    ['(tail -f a.log)', /subshell/u], ['cat <<EOF', /redirection/u], ['tail -f a.log\nrm x', /several lines/u], ['tail -f "a.log', /unclosed quote/u],
    ['sudo tail -f /var/log/x', /needs the terminal/u], ['ssh host tail -f x', /needs the terminal/u], ['watch -n1 date', /needs the terminal/u],
    ['adb logcat | less', /needs the terminal/u], ['top', /needs the terminal/u], ['FOO=1', /only sets variables/u], ['/background run x', /NMSh command/u], ['', /empty/u],
    ['x'.repeat(5000), /too long/u],
  ];
  for (const [command, why] of refused) {
    const result = classifyCommand(command);
    assert.ok(!isClassified(result), command);
    assert.match((result as {why: string}).why, why, command);
  }
  assert.deepEqual(simpleStages(`tail -f 'my log.txt' "other file" a\\ b # comment`), [['tail', '-f', 'my log.txt', 'other file', 'a b']]);
  const started = performance.now();
  for (let i = 0; i < 2000; i++) classifyCommand(`adb -s device${i} logcat -v threadtime | grep -i 'ActivityManager' | cut -c1-200`);
  assert.ok(performance.now() - started < 500, 'classification is cheap enough for every submission');
});

test('decisions: only an explicit Always backgrounds; Never and forced foreground run normally; families are specific', () => {
  const logcat = classifyCommand('adb logcat');
  const classification = isClassified(logcat) ? logcat : undefined;
  assert.equal(decide(classification, DEFAULT_PREFERENCES()).action, 'foreground', 'by default nothing is suggested: Enter runs it here, as before');
  let preferences: BackgroundPreferences = {...DEFAULT_PREFERENCES(), suggestions: 'ask'};
  assert.equal(decide(classification, preferences).action, 'suggest');
  assert.equal(decide(undefined, preferences).action, 'foreground');
  preferences = rememberFamily(preferences, 'adb logcat', 'always');
  assert.equal(decide(classification, preferences).action, 'background');
  assert.equal(decide(classification, preferences, 'foreground').action, 'foreground', 'one invocation can still run in the foreground');
  const devices = classifyCommand('adb devices');
  assert.equal(decide(isClassified(devices) ? devices : undefined, preferences).action, 'foreground', 'Always for adb logcat is not Always for adb');
  preferences = rememberFamily(preferences, 'adb logcat', 'never');
  assert.equal(decide(classification, preferences).action, 'foreground');
  preferences = rememberFamily(rememberFamily(preferences, 'adb logcat', undefined), 'adb logcat', undefined);
  assert.deepEqual(preferences.families, {});
  assert.equal(decide(classification, {...preferences, suggestions: 'off'}).action, 'foreground', 'suggestions off asks nothing');
  assert.equal(decide(classification, {...rememberFamily(preferences, 'adb logcat', 'always'), suggestions: 'off'}).action, 'background', 'an explicit rule still applies');
});

test('preferences are normalized, bounded and saved privately; commands and output are never stored', async () => {
  const normalized = normalizePreferences({suggestions: 'sometimes', families: {'adb logcat': 'always', 'rm -rf': 'maybe', '\u001b[31m': 'never', ...Object.fromEntries(Array.from({length: 400}, (_, i) => [`f${i}`, 'never']))},
    retention: {lines: 10, bytes: 1e12, finishedKept: -5}, notify: 'loud', bar: 'expanded', upArrow: 'off', extra: true});
  assert.equal(normalized.suggestions, 'off', 'an unknown value is the default: off');
  assert.equal(normalizePreferences({suggestions: 'ask'}).suggestions, 'ask');
  assert.equal(normalized.families['adb logcat'], 'always');
  assert.equal(normalized.families['rm -rf'], undefined);
  assert.ok(Object.keys(normalized.families).length <= 256);
  assert.deepEqual(normalized.retention, {lines: 100, bytes: 32 * 1024 * 1024, finishedKept: 0});
  assert.equal(normalized.notify, 'failure');
  assert.deepEqual([normalized.bar, normalized.upArrow], ['expanded', 'off']);
  assert.ok(!('extra' in normalized));
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-bgprefs-'));
  try {
    const env = {XDG_CONFIG_HOME: directory};
    assert.deepEqual(loadPreferences(env), DEFAULT_PREFERENCES(), 'missing file: defaults');
    savePreferences(rememberFamily(DEFAULT_PREFERENCES(), 'tail -f', 'always'), env);
    assert.equal(loadPreferences(env).families['tail -f'], 'always');
    assert.equal((await stat(preferencesPath(env))).mode & 0o777, 0o600);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('task output: line endings, progress lines, splitting and bounds', () => {
  const output = new TaskOutput({lines: 3, bytes: 1024, lineLength: 8});
  output.append('one\r\r\ntwo\r\npar');
  assert.deepEqual(output.lines().map(line => line.text), ['one', 'two']);
  assert.equal(output.partial(), 'par');
  output.append('tial\r10%\r50%');
  assert.equal(output.partial(), '50%', 'an unfinished progress line shows its latest state');
  output.append('\n');
  assert.deepEqual(output.lines().map(line => [line.seq, line.text]), [[1, 'one'], [2, 'two'], [3, '50%']]);
  output.append('0123456789ABCDEFG\n');
  assert.deepEqual(output.lines().map(line => line.text), ['01234567', '89ABCDEF', 'G'], 'long lines split at the line length; the oldest go');
  assert.equal(output.dropped, 3);
  assert.deepEqual(output.since(5).map(line => line.text), ['G']);
  output.append('no newline at all');
  output.finish();
  assert.deepEqual(output.lines().map(line => line.text), ['no newli', 'ne at al', 'l'], 'finish flushes the unfinished line');
  assert.equal(clean('\u001b]0;title\u0007\u001b[1mbold\u001b[0m\t‮end', 100), 'bold    end');
});

test('task output: a hostile run of carriage returns is handled in linear time', () => {
  // `/\r+$/` retried from every \r of the run: 64 Ki of them took seconds and froze NMSh while a task printed them.
  const output = new TaskOutput({lines: 100, bytes: 1024 * 1024});
  const hostile = `${'\r'.repeat(64 * 1024)}x\n`;
  const started = performance.now();
  output.append(hostile);
  output.append(hostile);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 250, `took ${elapsed.toFixed(0)} ms`);
  assert.deepEqual(output.lines().map(line => line.text), ['x', 'x'], 'the progress overwrite still keeps the last state');
  assert.equal(clean(`done${'\r'.repeat(5000)}`, 100), 'done', 'trailing carriage returns end the line');
});
