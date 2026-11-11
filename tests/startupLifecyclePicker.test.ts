import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupSettingsKey, createMultiPicker, multiPickerKey, pickWithKill, renderCleanupSettings, renderMultiPicker, renderSinglePrompt,
  type CleanupSettingsState, type KillResult} from '../src/session/StartupPicker.js';
import {encodePolicy, policyFromSettings} from '../src/session/lifecycle.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import type {SessionInfo} from '../src/session/SessionProtocol.js';
import type {Key} from '../src/terminal/keys.js';

const DAY = 24 * 60 * 60_000;
const info = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({id, pid: 100, state: 'detached', cwd: `/w/${id}`, createdAt: 1_000, eligibility: 'kept', lifecycle: 'idle', cleanup: 'idle 5m', used: 1, ...extra});
const text = (value: string): Key => ({kind: 'text', value});
const key = (kind: string): Key => ({kind} as Key);

/** Four sessions as a lifecycle-aware service reports them. */
const fleet = () => [
  info('work', {lifecycle: 'executing', running: 'npm run build', runningSince: 0, cleanup: 'a command is running'}),
  info('wait', {lifecycle: 'waiting', running: 'read -r x', runningSince: 0, inputSince: 0, inputConfidence: 'likely', cleanup: 'waiting for input'}),
  info('old', {lifecycle: 'idle', idleSince: 1, eligibility: 'review', cleanup: 'idle 2d; cleanup suggested'}),
  info('new', {lifecycle: 'unused', used: undefined, eligibility: 'kept', cleanup: 'never used; cleanup in 4m', cleanupAt: 5 * 60_000}),
];

test('the header counts working, waiting and idle sessions, plus what is not listed; rows say cleanup status', () => {
  const state = createMultiPicker(fleet(), {attachedElsewhere: 1, endedWhileAway: 2});
  const screen = renderMultiPicker(state, 200, 2 * DAY).join('\n');
  assert.match(screen, /4 detached live sessions · 1 working · 1 waiting · 2 idle · 1 attached elsewhere · 2 ended while away/);
  assert.match(screen, /\/w\/old\s+zsh\s+idle [^·;]+ · cleanup suggested$/m, 'the idle age is said once, by the activity column');
  assert.match(screen, /\/w\/new .*never used; cleanup in 4m/);
  assert.doesNotMatch(screen.split('\n').find(line => line.includes('/w/work'))!, /cleanup/, 'work speaks for itself; no cleanup tag');
  assert.match(screen, /E end eligible \(1\) · I review idle · P protect · C cleanup settings/);
});

test('an older service reports no lifecycle facts: no counts, no tags and no lifecycle keys', () => {
  const plain = fleet().map(({eligibility: _e, lifecycle: _l, cleanup: _c, cleanupAt: _a, ...rest}) => rest as SessionInfo);
  const state = createMultiPicker(plain);
  const screen = renderMultiPicker(state, 200, 0).join('\n');
  assert.doesNotMatch(screen, /working|E end eligible|cleanup/);
  assert.equal(multiPickerKey(state, text('e')), undefined);
  assert.equal(state.confirming, undefined, 'E does nothing without service facts');
  assert.equal(multiPickerKey(state, text('c')), undefined);
});

test('End All Eligible lists exactly the eligible sessions, with reasons, and asks once', () => {
  const state = createMultiPicker(fleet());
  multiPickerKey(state, text('e'));
  assert.deepEqual(state.confirming, ['old']);
  const screen = renderMultiPicker(state, 200, 0).join('\n');
  assert.match(screen, /End 1 eligible session\?/);
  assert.match(screen, /\/w\/old · zsh · idle 2d; cleanup suggested/);
  assert.match(screen, /checked again just before it ends/);
  assert.doesNotMatch(screen, /\/w\/work|\/w\/wait|\/w\/new/, 'nothing else is listed or ended');
  assert.deepEqual(multiPickerKey(state, key('enter')), {kill: ['old'], mode: 'eligible'});
  const none = createMultiPicker(fleet().filter(session => session.id !== 'old'));
  multiPickerKey(none, text('E'));
  assert.equal(none.confirming, undefined);
  assert.match(none.message ?? '', /No session is eligible/);
});

test('Review Idle Sessions selects the long-idle ones; X then confirms exactly those', () => {
  const state = createMultiPicker([...fleet(), info('older', {idleSince: 0, eligibility: 'review', cleanup: 'idle 3d; cleanup suggested'})]);
  multiPickerKey(state, text('i'));
  assert.deepEqual([...state.selected].sort(), ['old', 'older']);
  assert.match(state.message ?? '', /Selected 2 sessions idle for over a day/);
  multiPickerKey(state, text('x'));
  assert.deepEqual(state.confirming, ['old', 'older']);
  assert.match(renderMultiPicker(state, 200, 0).join('\n'), /Kill 2 detached sessions\?/);
});

test('End All Eligible through the picker: kills go out in eligible mode; a session the service kept stays listed', async () => {
  const sessions = [...fleet(), info('stale', {idleSince: 0, eligibility: 'review', cleanup: 'idle 4d; cleanup suggested'})];
  const calls: string[] = [];
  const outcomes: KillResult[] = ['killed', 'kept'];
  const screens: string[] = [];
  let call = 0;
  const ids = await pickWithKill(sessions, {now: () => 0,
    run: async <T,>(render: (columns: number) => string[], onKey: (key: Key) => T | undefined): Promise<T> => {
      screens.push(render(220).join('\n'));
      const keys = call++ === 0 ? [text('e'), text('y')] : [text('n')];
      for (const k of keys) { const result = onKey(k); if (result !== undefined) return result; }
      throw new Error('no result');
    },
    kill: async (session, mode) => { calls.push(`${session.id}:${mode}`); return outcomes.shift()!; }});
  assert.deepEqual(ids, []);
  assert.deepEqual(calls, ['old:eligible', 'stale:eligible']);
  assert.match(screens.at(-1)!, /1 session checked again and kept \(work, protection or not eligible yet\); 1 session ended/);
  assert.match(screens.at(-1)!, /\/w\/stale/, 'the kept one is still listed');
});

test('P protects through the service and redraws from its answer; C saves settings and refreshes the rows', async () => {
  const protectedCalls: string[] = [];
  let call = 0;
  const screens: string[] = [];
  let configured = 0;
  const ids = await pickWithKill(fleet(), {now: () => 0,
    run: async <T,>(render: (columns: number) => string[], onKey: (key: Key) => T | undefined): Promise<T> => {
      screens.push(render(220).join('\n'));
      const keys = [[key('down'), key('down'), text('p')], [text('c')], [text('n')]][call++]!;
      for (const k of keys) { const result = onKey(k); if (result !== undefined) return result; }
      throw new Error('no result');
    },
    kill: async () => 'killed',
    protect: async (session, on) => { protectedCalls.push(`${session.id}:${on}`); return {...session, protected: 1, eligibility: 'kept', cleanup: 'protected'}; },
    configure: async () => { configured += 1; return 'Cleanup settings saved; the session service applies them now.'; },
    // After the settings change the service no longer lists 'work' as detached (it was attached elsewhere meanwhile).
    refresh: async () => fleet().map(session => session.id === 'work' ? {...session, state: 'attached' as const} : session)});
  assert.deepEqual(ids, []);
  assert.deepEqual(protectedCalls, ['old:true']);
  assert.match(screens[1]!, /\/w\/old .*protected/);
  assert.match(screens[1]!, /Protected: cleanup and End All Eligible never end it/);
  assert.equal(configured, 1);
  assert.match(screens[2]!, /Cleanup settings saved/);
  assert.doesNotMatch(screens[2]!, /\/w\/work/, 'refreshed: a session attached elsewhere drops out of the picker');
});

test('the cleanup settings screen: ←→ change bounded values, Enter saves, Esc changes nothing', () => {
  const state: CleanupSettingsState = {draft: {sessionCleanup: '10m', sessionIdleExpiry: 'off'}, cursor: 0};
  assert.match(renderCleanupSettings(state, 100).join('\n'), /› Clean up unused sessions\s+‹ 10 minutes ›[\s\S]*End idle sessions\s+‹ Off ›/);
  cleanupSettingsKey(state, key('right'));
  assert.equal(state.draft.sessionCleanup, '30m');
  cleanupSettingsKey(state, key('left')); cleanupSettingsKey(state, key('left'));
  assert.equal(state.draft.sessionCleanup, 'off', 'wraps within the bounded list');
  cleanupSettingsKey(state, key('down'));
  cleanupSettingsKey(state, key('right'));
  assert.equal(state.draft.sessionIdleExpiry, '1d');
  assert.deepEqual(cleanupSettingsKey(state, key('enter')), {sessionCleanup: 'off', sessionIdleExpiry: '1d'});
  assert.equal(cleanupSettingsKey({draft: state.draft, cursor: 0}, key('escape')), null);
});

test('settings: unused cleanup defaults to 10 minutes, idle expiry to off; unknown values fall back; the policy is bounded', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.sessionCleanup, '10m');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.sessionIdleExpiry, 'off');
  const old = normalizePromptConfiguration({liveSessionStartup: 'ask'});
  assert.equal(old.sessionCleanup, '10m');
  assert.equal(old.sessionIdleExpiry, 'off', 'an upgraded configuration never gains idle expiry');
  const bogus = normalizePromptConfiguration({sessionCleanup: '1s', sessionIdleExpiry: 'forever'});
  assert.equal(bogus.sessionCleanup, '10m');
  assert.equal(bogus.sessionIdleExpiry, 'off');
  assert.equal(encodePolicy(policyFromSettings({sessionCleanup: '1h', sessionIdleExpiry: '7d'})), 'unused=3600;idle=604800');
  assert.equal(encodePolicy(policyFromSettings({sessionCleanup: 'off', sessionIdleExpiry: 'off'})), 'unused=0;idle=0');
});

test('the one-session prompt says a session is protected or counting down to cleanup', () => {
  assert.match(renderSinglePrompt(info('a', {protected: 1}), 100, 0).join('\n'), /^ {2}protected$/m);
  assert.match(renderSinglePrompt(info('a', {lifecycle: 'unused', cleanup: 'never used; cleanup in 4m', cleanupAt: 1}), 100, 0).join('\n'), /never used; cleanup in 4m/);
  assert.doesNotMatch(renderSinglePrompt(info('a'), 100, 0).join('\n'), /idle 5m$/m, 'kept without a deadline says nothing extra');
});

test('End All Eligible: a session the service re-verified and kept is reported as kept, never as ended or failed', async () => {
  const {endDetachedSession} = await import('../src/session/liveSessions.js');
  const {SessionConnectError} = await import('../src/session/SocketSessionClient.js');
  const outcome = await endDetachedSession(info('a'), {list: async () => [info('a')], archive: async () => ({}),
    kill: async () => { throw new SessionConnectError('session service refused: a command is running', 'busy'); }});
  assert.equal(outcome, 'kept');
});
