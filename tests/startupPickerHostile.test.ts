import test from 'node:test';
import assert from 'node:assert/strict';
import {createMultiPicker, renderKillConfirm, renderMultiPicker, renderSinglePrompt} from '../src/session/StartupPicker.js';
import {liveSessionRows} from '../src/sessions/LiveSessionView.js';
import type {SessionInfo} from '../src/session/SessionProtocol.js';

// Physical QA: the session service reported this cwd without its BEL, and the picker wrote it raw. The unterminated
// OSC swallowed every following line, leaving only the heading and "/tmp/evil" on screen.
const session = {id: 's1', pid: 1, cwd: '/tmp/evil\u001b]0;PWNED', createdAt: 0, attached: 0, running: 'vim \u001b[2J\u009b31mx',
  title: 'title\u001b]2;owned\u0007'} as unknown as SessionInfo;
const controls = ['R  Resume', 'N  Not now', 'X  Kill session', 'A  Always resume', 'D  Don\'t resume at startup', 'Enter resume'];

test('the one-session startup screen never writes session text raw, and every control stays visible', () => {
  for (const columns of [100, 60, 40]) {
    const rows = renderSinglePrompt(session, columns, 60_000);
    const text = rows.join('\n');
    assert.ok(!/[\u001b\u0007\u0080-\u009f]/u.test(text), `${columns}: no escape, BEL or C1 bytes`);
    assert.ok(!text.includes('PWNED'), `${columns}: no sequence debris`);
    assert.ok(rows.some(row => row.includes('/tmp/evil')), `${columns}: the path is shown`);
    for (const control of controls) assert.ok(text.includes(control.slice(0, Math.min(control.length, columns - 4))), `${columns}: ${control} visible`);
  }
});

test('the several-session picker, kill confirmation and live-session list scrub the same way', () => {
  const texts = [renderMultiPicker(createMultiPicker([session, {...session, id: 's2'}]), 80, 60_000), renderKillConfirm(session, 80, 60_000)].map(rows => rows.join('\n'));
  for (const text of texts) assert.ok(!/[\u001b\u0007\u0080-\u009f]/u.test(text) && !text.includes('PWNED'));
  const live = JSON.stringify(liveSessionRows([session], undefined, 60_000).map(row => row.summary));
  assert.ok(!live.includes('\\u001b') && !live.includes('PWNED'));
});
