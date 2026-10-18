import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSemantics, osc133, osc7, semanticSupport} from '../src/host/semanticMarks.js';
import {AnsiOutputParser, authoredTargetAllowed} from '../src/output/AnsiOutputParser.js';
import {wrapStyledLine} from '../src/output/viewport.js';
import {authoredLink, closeAuthoredLinks} from '../src/output/Hyperlinks.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {stripAnsi, displayWidth, truncateAnsi} from '../src/util/text.js';

const A = osc133('A'), B = osc133('B'), C = osc133('C');

function semantics(support = {marks: true, cwd: true}) {
  const written: string[] = [];
  let owned = true;
  const host = new HostSemantics(support, data => { written.push(data); }, () => owned, 'host.local');
  return {host, written, setOwned: (value: boolean) => { owned = value; }, all: () => written.join('')};
}

test('OSC 7: file URI with exact percent-encoding; unsafe or relative paths are never sent', () => {
  assert.equal(osc7('/Users/me/My Projects/naïve#1?x%', 'host.local'), '\u001B]7;file://host.local/Users/me/My%20Projects/na%C3%AFve%231%3Fx%25\u001B\\');
  assert.equal(osc7('/tmp', 'bad host!'), '\u001B]7;file:///tmp\u001B\\', 'an unusable hostname is omitted, not sent raw');
  assert.equal(osc7('relative/path'), undefined);
  assert.equal(osc7('/tmp/\u001B]0;evil\u0007'), undefined, 'control characters are never embedded');
});

test('OSC 133 projection: prompt → command → output → completion, in order, from the authoritative lifecycle', () => {
  const {host, all} = semantics();
  host.prompt('/work', 0);
  assert.equal(all(), `${osc7('/work', 'host.local')}${A}${B}`);
  host.exec();
  host.prompt('/work', 0);
  host.exec();
  host.prompt('/work/sub', 2);
  assert.equal(all(), `${osc7('/work', 'host.local')}${A}${B}${C}${osc133('D', 0)}${A}${B}${C}${osc133('D', 2)}${osc7('/work/sub', 'host.local')}${A}${B}`,
    'D carries the real exit status; OSC 7 only when the directory changes');
});

test('OSC 133: interrupts, multiline commands, rejected input and shell switches never unbalance zones', () => {
  const {host, all, written} = semantics({marks: true, cwd: false});
  host.prompt('/w', 0);
  // A multiline command is one exec marker: one C.
  host.exec(); host.exec();
  host.prompt('/w', 130);
  assert.equal(all(), `${A}${B}${C}${osc133('D', 130)}${A}${B}`, 'one C for one command; Ctrl+C reports its real status');
  written.length = 0;
  // Rejected input: no exec marker arrives, so no C and no D.
  host.prompt('/w', 0);
  assert.equal(all(), `${A}${B}`);
  written.length = 0;
  // The shell ends mid-command (or /shell switches): the zone closes without inventing a status.
  host.exec();
  host.end();
  assert.equal(all(), `${C}${osc133('D')}`);
  written.length = 0;
  host.end();
  host.exec();
  assert.equal(all(), '', 'nothing after the shell ended until its replacement reports a prompt');
});

test('fullscreen passthrough: markers are held while a program owns the screen, then written once', () => {
  const {host, written, setOwned} = semantics({marks: true, cwd: true});
  host.prompt('/w', 0);
  host.exec();
  written.length = 0;
  setOwned(false);
  host.prompt('/w', 0);
  assert.deepEqual(written, [], 'never written into an alternate-screen program');
  setOwned(true);
  host.flush();
  assert.deepEqual(written, [`${osc133('D', 0)}${A}${B}`]);
});

test('unsupported hosts and opt-outs get nothing; capable hosts and multiplexers get markers', () => {
  const quiet = semantics({marks: false, cwd: false});
  quiet.host.prompt('/w', 0); quiet.host.exec(); quiet.host.prompt('/w', 1);
  assert.equal(quiet.all(), '');
  assert.deepEqual(semanticSupport({TERM: 'xterm-256color'}), {marks: false, cwd: false}, 'an unknown host gets nothing');
  assert.deepEqual(semanticSupport({TERM_PROGRAM: 'ghostty'}), {marks: true, cwd: true});
  assert.deepEqual(semanticSupport({TERM_PROGRAM: 'WezTerm'}), {marks: true, cwd: true});
  assert.deepEqual(semanticSupport({TERM_PROGRAM: 'Apple_Terminal'}), {marks: false, cwd: true});
  assert.deepEqual(semanticSupport({TMUX: '/tmp/tmux-1/default,1,0', TERM: 'tmux-256color'}), {marks: true, cwd: true}, 'tmux consumes them for pane state');
  assert.deepEqual(semanticSupport({TERM_PROGRAM: 'ghostty', NMSH_SEMANTIC: '0'}), {marks: false, cwd: false});
  assert.deepEqual(semanticSupport({TERM: 'dumb', NMSH_SEMANTIC: '1'}), {marks: false, cwd: false});
});

test('OSC 8: NMSh-authored links survive the transcript as authored cells; raw PTY links stay a separate trust path', () => {
  const parser = new AnsiOutputParser();
  parser.addAuthoredLine('see \u001B]8;;https://github.com/raiseCatError/notMyShell/issues/304\u001B\\#304\u001B]8;;\u001B\\ now');
  parser.addAuthoredLine('bad \u001B]8;;javascript:alert(1)\u001B\\click\u001B]8;;\u001B\\');
  parser.write('raw \u001B]8;;https://example.com/x\u001B\\link\u001B]8;;\u001B\\\n');
  const [authored, rejected, raw] = parser.lines;
  const linked = authored!.filter(cell => cell?.hyperlink);
  assert.equal(linked.map(cell => cell!.text).join(''), '#304');
  assert.ok(linked.every(cell => cell!.authored === true));
  assert.ok(rejected!.every(cell => !cell?.hyperlink), 'unsafe authored targets are dropped');
  const rawLinked = raw!.filter(cell => cell?.hyperlink);
  assert.ok(rawLinked.length > 0 && rawLinked.every(cell => cell!.authored === undefined), 'program links are never marked authored');
  const [row] = wrapStyledLine(authored!, 80, true);
  assert.match(row!.ansi, /\u001B\]8;;https:\/\/github\.com\/raiseCatError\/notMyShell\/issues\/304\u001B\\#304\u001B\]8;;\u001B\\/u);
  assert.equal(row!.plain, 'see #304 now', 'plain/copy text has no escape bytes');
  assert.doesNotMatch(wrapStyledLine(authored!, 80, false)[0]!.ansi, /\u001B\]8/u, 'hosts without OSC 8 get plain text');
  for (const target of ['https://localhost:5173/', 'http://127.0.0.1:3000', 'file:///tmp/x.json']) assert.ok(authoredTargetAllowed(target), target);
  for (const target of ['javascript:x', 'https://user:pw@example.com/', 'file://host/etc/passwd', 'data:text/html,x', 'https://exa mple.com']) assert.equal(authoredTargetAllowed(target), false, target);
});

test('OSC 8 in live rows: authored task URLs only on capable hosts, and truncation never leaves a link open', () => {
  const link = authoredLink('http://localhost:5173', 'http://localhost:5173', true);
  assert.match(link, /^\u001B\]8;;http:\/\/localhost:5173\/\u001B\\http:\/\/localhost:5173\u001B\]8;;\u001B\\$/u);
  assert.equal(authoredLink('x', 'javascript:alert(1)', true), 'x');
  assert.equal(authoredLink('http://localhost:5173', 'http://localhost:5173', false), 'http://localhost:5173');
  const row = closeAuthoredLinks(truncateAnsi(`dev server · ${link} · 12s`, 20));
  assert.ok(row.endsWith('\u001B]8;;\u001B\\'), 'a cut link is closed');
  assert.ok(displayWidth(row) <= 20);
  assert.equal(stripAnsi(link), 'http://localhost:5173');
});

test('frontend interactions: authored links only when requested; /copy-style plain text stays escape-free', () => {
  const output = new OutputBuffer();
  output.addFrontendInteraction('/help', 'docs \u001B]8;;https://github.com/raiseCatError/notMyShell\u001B\\repo\u001B]8;;\u001B\\', '', true);
  output.addFrontendInteraction('/x', 'docs \u001B]8;;https://example.com\u001B\\plain\u001B]8;;\u001B\\');
  const rows = output.wrapped(80).map(row => row.plain);
  assert.ok(rows.some(row => row.includes('docs repo')));
  assert.ok(rows.every(row => !row.includes('\u001B')));
});
