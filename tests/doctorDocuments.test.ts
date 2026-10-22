import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {documentDoctorChecks, type DocumentRenderingFacts} from '../src/doctor/documents.js';
import {probeMermaid, TESTED_MERMAID} from '../src/diagrams/library.js';
import {findBrowserExecutable, type LocatorHost} from '../src/browser/engine/chrome.js';

/** /doctor's Documents section: what renders documents and diagrams, found without launching or loading anything. */

function scratch(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'nmsh-doctor-docs-')));
}

function fakePackage(root: string, version = '12.2.0', body = 'globalThis.mermaid = {};'): string {
  const dir = path.join(root, 'mermaid');
  fs.mkdirSync(path.join(dir, 'dist'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'mermaid', version}));
  fs.writeFileSync(path.join(dir, 'dist', 'mermaid.min.js'), body);
  return dir;
}

const base: DocumentRenderingFacts = {
  diagrams: 'manual', browser: 'auto', images: true, running: false,
  chromium: {state: 'found', executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'},
  mermaid: {ok: true, path: '/opt/homebrew/lib/node_modules/mermaid/dist/mermaid.min.js', version: '12.2.0'},
};
const byLabel = (facts: DocumentRenderingFacts) => documentDoctorChecks(facts);

test('probeMermaid finds the same install as the locator but never reads the bundle', async () => {
  const root = scratch();
  try {
    const dir = fakePackage(root, '11.4.0');
    const probe = await probeMermaid({env: {NMSH_MERMAID: dir}, home: root, execPath: '/nonexistent/bin/node'});
    assert.deepEqual(probe, {ok: true, path: path.join(dir, 'dist', 'mermaid.min.js'), version: '11.4.0'});
    assert.ok(!('source' in probe));
    // Unreadable content does not matter to a probe (nothing is read), but the safety checks still apply.
    fs.chmodSync(path.join(dir, 'dist', 'mermaid.min.js'), 0o666);
    const writable = await probeMermaid({env: {NMSH_MERMAID: dir}, home: root, execPath: '/nonexistent/bin/node'});
    assert.equal(writable.ok, false);
    assert.match(!writable.ok ? writable.reason : '', /anyone/u);
    const missing = await probeMermaid({env: {}, home: root, execPath: '/nonexistent/bin/node', candidates: [path.join(root, 'nope')]});
    assert.equal(missing.ok, false);
    assert.match(!missing.ok ? missing.reason : '', /not installed/u);
    const relative = await probeMermaid({env: {NMSH_MERMAID: 'mermaid'}, home: root, execPath: '/nonexistent/bin/node'});
    assert.match(!relative.ok ? relative.reason : '', /absolute/u);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('findBrowserExecutable looks at the filesystem only: --version is never run', async () => {
  let versions = 0;
  const host = (executables: string[], env: NodeJS.ProcessEnv = {}): LocatorHost => ({
    platform: 'darwin', env,
    isExecutable: async file => executables.includes(file),
    version: async () => { versions += 1; return 'Google Chrome 156.0.1.2'; },
  });
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.deepEqual(await findBrowserExecutable(host([chrome])), {ok: true, executable: chrome});
  assert.deepEqual(await findBrowserExecutable(host(['/Applications/Chromium.app/Contents/MacOS/Chromium'])), {ok: true, executable: '/Applications/Chromium.app/Contents/MacOS/Chromium'});
  const none = await findBrowserExecutable(host([]));
  assert.equal(none.ok, false);
  const wrong = await findBrowserExecutable(host([chrome], {NMSH_BROWSER: '/nope/chrome'}));
  assert.match(!wrong.ok ? wrong.reason : '', /NMSH_BROWSER/u);
  assert.equal(versions, 0);
});

test('everything present: browser found, Mermaid found, diagrams can be drawn; detection is not called a test', () => {
  const checks = byLabel(base);
  assert.ok(checks.every(check => check.section === 'Documents'));
  const browser = checks.find(check => /Chrom|browser/iu.test(check.label))!;
  assert.match(browser.label, /found/iu);
  assert.match(browser.detail ?? '', /version is checked when a browser surface first opens/u);
  const mermaid = checks.find(check => /^Mermaid \d/u.test(check.label))!;
  assert.equal(mermaid.state, 'ok');
  assert.match(mermaid.detail ?? '', /mermaid\.min\.js/u);
  const drawing = checks.find(check => /diagrams/iu.test(check.label) && check !== mermaid)!;
  assert.equal(drawing.state, 'ok');
  assert.match(drawing.label, /On request/u);
  assert.match(drawing.detail ?? '', /nothing was drawn/iu);
  for (const check of checks) assert.doesNotMatch(`${check.label} ${check.detail ?? ''}`, /\b(verified|validated|works)\b/iu);
});

test('a version checked this session is shown; a running browser is said to be running', () => {
  const checks = byLabel({...base, running: true, chromium: {state: 'checked', availability: {ok: true, executable: '/usr/bin/chromium', version: 'Chromium 156.0.7000.1'}}});
  const browser = checks[0]!;
  assert.match(browser.label, /Chromium 156/u);
  assert.match(browser.detail ?? '', /\/usr\/bin\/chromium/u);
  assert.match(browser.detail ?? '', /running now/u);
});

test('each reason a diagram would not be drawn is named, in the order the service applies them', () => {
  const reason = (facts: Partial<DocumentRenderingFacts>) => byLabel({...base, ...facts}).at(-1)!;
  assert.match(reason({diagrams: 'off'}).label, /off/iu);
  assert.equal(reason({diagrams: 'off'}).state, 'info');
  assert.match(reason({images: false}).detail ?? '', /Images are off/u);
  assert.match(reason({browser: 'off'}).detail ?? '', /Real browser/u);
  assert.match(reason({chromium: {state: 'missing', reason: 'No Chrome, Chromium or Edge was found.'}}).detail ?? '', /No Chrome/u);
  assert.match(reason({chromium: {state: 'checked', availability: {ok: false, reason: 'chrome is version 90; NMSh needs 110'}}}).detail ?? '', /version 90/u);
  assert.match(reason({mermaid: {ok: false, reason: 'Mermaid is not installed. Install it with `npm install -g mermaid`'}}).detail ?? '', /npm install -g mermaid/u);
  assert.equal(reason({mermaid: {ok: false, reason: 'x'}}).state, 'info');
  assert.match(reason({diagrams: 'auto'}).label, /Automatic/u);
});

test('compatibility: other Mermaid majors and unknown versions are flagged; a broken NMSH_MERMAID needs attention', () => {
  assert.equal(TESTED_MERMAID, '12.2.0');
  const other = byLabel({...base, mermaid: {ok: true, path: '/x/dist/mermaid.min.js', version: '11.4.0'}}).find(check => /^Mermaid 11/u.test(check.label))!;
  assert.equal(other.state, 'attention');
  assert.match(other.detail ?? '', /tested with 12\.2\.0/u);
  const minor = byLabel({...base, mermaid: {ok: true, path: '/x/dist/mermaid.min.js', version: '12.4.1'}}).find(check => /^Mermaid 12/u.test(check.label))!;
  assert.equal(minor.state, 'ok');
  const unknown = byLabel({...base, mermaid: {ok: true, path: '/x/mermaid.min.js', version: 'unknown'}}).find(check => /^Mermaid/u.test(check.label))!;
  assert.equal(unknown.state, 'attention');
  const configured = byLabel({...base, mermaid: {ok: false, reason: 'NMSH_MERMAID: /x is not the mermaid package.'}}).find(check => /Mermaid/u.test(check.label))!;
  assert.equal(configured.state, 'attention');
});

test('control characters in paths and reasons never reach the doctor rows', () => {
  const checks = byLabel({...base, chromium: {state: 'found', executable: '/opt/\u001b[31mchrome'}, mermaid: {ok: false, reason: 'NMSH_MERMAID: /x\u0007‮ is wrong'}});
  for (const check of checks) assert.doesNotMatch(`${check.label}${check.detail ?? ''}`, /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u);
});
