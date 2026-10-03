import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASELINE_CAPABILITIES, resolveHostCapabilities, shouldProbeGraphics} from '../src/host/capabilities.js';
import {GRAPHICS_QUERY, HOST_QUERY, probeHost, resolveProbeReplies} from '../src/host/probe.js';
import {
  containsImageBytes, createImageOverlay, fitCells, iterm2Image, KITTY_CHUNK, kittyDelete, kittyPlace, kittyTransmit, pngSize, selectImageProtocol,
} from '../src/presentation/ImageSurface.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';

const logo = readFileSync(new URL('../assets/brand/nmsh-logo.png', import.meta.url));

test('protocol selection: evidence and known-host records only; multiplexers and opt-out get none', () => {
  const caps = (graphicsProtocol: typeof BASELINE_CAPABILITIES.graphicsProtocol) => ({...BASELINE_CAPABILITIES, graphicsProtocol});
  assert.equal(selectImageProtocol({capabilities: caps('kitty'), env: {}}), 'kitty');
  assert.equal(selectImageProtocol({capabilities: caps('iterm2'), env: {}}), 'iterm2');
  assert.equal(selectImageProtocol({capabilities: caps('none'), env: {}}), 'none');
  assert.equal(selectImageProtocol({capabilities: caps('kitty'), env: {TMUX: '/tmp/t'}}), 'none');
  assert.equal(selectImageProtocol({capabilities: caps('kitty'), env: {NMSH_IMAGES: '0'}}), 'none');
  // Ghostty is not assumed from its name: only the probe reply grants Kitty graphics.
  assert.equal(resolveHostCapabilities({TERM_PROGRAM: 'ghostty'}).graphicsProtocol, 'none');
  assert.equal(resolveHostCapabilities({TERM_PROGRAM: 'zed'}).graphicsProtocol, 'none', 'Zed: no inline graphics claimed');
  assert.equal(resolveHostCapabilities({TERM_PROGRAM: 'vscode'}).graphicsProtocol, 'none', 'VS Code: no inline graphics claimed');
  assert.equal(shouldProbeGraphics({TERM_PROGRAM: 'ghostty'}), true);
  assert.equal(shouldProbeGraphics({TERM_PROGRAM: 'Apple_Terminal'}), false, 'other hosts never receive the APC query');
  assert.equal(shouldProbeGraphics({TERM_PROGRAM: 'ghostty', TMUX: '1'}), false);
});

test('probe: Kitty graphics OK grants, error revokes, and replies never leak into input', async () => {
  const ok = resolveProbeReplies('\u001b_Gi=31;OK\u001b\\typed', BASELINE_CAPABILITIES);
  assert.equal(ok.capabilities.graphicsProtocol, 'kitty');
  assert.equal(ok.input, 'typed');
  const error = resolveProbeReplies('\u001b_Gi=31;ENOTSUPPORTED:no\u001b\\', {...BASELINE_CAPABILITIES, graphicsProtocol: 'kitty'});
  assert.equal(error.capabilities.graphicsProtocol, 'none');
  const pasted = resolveProbeReplies('\u001b[200~\u001b_Gi=31;OK\u001b\\\u001b[201~', BASELINE_CAPABILITIES);
  assert.equal(pasted.capabilities.graphicsProtocol, 'none', 'pasted bytes are never treated as replies');
  const writes: string[] = [];
  await probeHost(BASELINE_CAPABILITIES, {write: data => writes.push(data), listen: () => () => {}}, 1);
  assert.deepEqual(writes, [HOST_QUERY], 'no graphics query unless asked');
  await probeHost(BASELINE_CAPABILITIES, {write: data => writes.push(data), listen: () => () => {}}, 1, {graphics: true});
  assert.equal(writes[1], `${GRAPHICS_QUERY}${HOST_QUERY}`);
});

test('encoding: Kitty chunks within the protocol limit, quiet, and deletable; iTerm2 sized; PNG checked', () => {
  const size = pngSize(logo)!;
  assert.deepEqual(size, {width: 805, height: 393});
  const transmit = kittyTransmit(logo, 7);
  const chunks = transmit.split('\u001b\\').filter(Boolean);
  assert.ok(chunks.length > 1);
  assert.match(chunks[0]!, /^\u001b_Ga=t,f=100,t=d,i=7,q=2,m=1;/u);
  assert.match(chunks.at(-1)!, /^\u001b_Gm=0;/u);
  for (const chunk of chunks) assert.ok(chunk.slice(chunk.indexOf(';') + 1).length <= KITTY_CHUNK);
  const payload = chunks.map(chunk => chunk.slice(chunk.indexOf(';') + 1)).join('');
  assert.deepEqual(Buffer.from(payload, 'base64'), logo, 'round-trips exactly');
  assert.equal(kittyPlace(7, {columns: 20, rows: 5}), '\u001b_Ga=p,i=7,p=1,c=20,r=5,C=1,q=2\u001b\\');
  assert.equal(kittyDelete(7), '\u001b_Ga=d,d=I,i=7,q=2\u001b\\');
  assert.match(iterm2Image(logo, {columns: 20, rows: 5}), /^\u001b\]1337;File=name=[^;]+;size=291029;width=20;height=5;preserveAspectRatio=1;inline=1:/u);
  assert.equal(createImageOverlay('kitty', Buffer.from('not a png'), 'x', 0, 0, {columns: 1, rows: 1}), undefined);
  assert.deepEqual(fitCells(805, 393, 80, 6), {columns: 25, rows: 6});
  assert.deepEqual(fitCells(805, 393, 12, 6), {columns: 12, rows: 3}, 'narrow panels shrink the box');
});

class Sink { data = ''; write = (chunk: string) => { this.data += chunk; return true; }; }

function renderer(sink: Sink): TerminalRenderer {
  const instance = new TerminalRenderer(sink.write);
  instance.enter();
  return instance;
}

test('renderer: transmit once, re-place only when its rows repaint, delete on close, passthrough and exit', () => {
  const sink = new Sink();
  const view = renderer(sink);
  const frame = (rows: string[]) => ({rows, columns: 40, cursorRow: 1, cursorColumn: 1});
  const overlay = createImageOverlay('kitty', logo, 'about', 2, 2, {columns: 10, rows: 3})!;
  view.setImageOverlay(overlay);
  sink.data = '';
  view.render(frame(['a', 'b', '', '', '', 'f']));
  assert.equal(sink.data.split('a=t,').length - 1, 1, 'data uploaded once');
  assert.match(sink.data, /\u001b\[3;3H\u001b_Ga=p/u, 'placed at its box');
  sink.data = '';
  view.render(frame(['a', 'CHANGED', '', '', '', 'f']));
  assert.ok(!containsImageBytes(sink.data), 'rows outside the box do not re-place it');
  view.render(frame(['a', 'CHANGED', 'x', '', '', 'f']));
  assert.match(sink.data, /a=p/u);
  assert.ok(!sink.data.includes('a=t,'), 'never re-uploaded');
  sink.data = '';
  view.setImageOverlay(undefined);
  assert.match(sink.data, /a=d,d=I/u, 'closing deletes it');
  view.render(frame(['a', 'CHANGED', 'x', '', '', 'f']));
  assert.match(sink.data, /\u001b\[3;1H\u001b\[2K/u, 'its rows repaint after removal');

  view.setImageOverlay(createImageOverlay('kitty', logo, 'again', 2, 2, {columns: 10, rows: 3}));
  view.render(frame(['a']));
  sink.data = '';
  view.suspendForPassthrough();
  assert.match(sink.data, /a=d,d=I/u, 'a foreground program never inherits an NMSh image');
  view.resumeAfterPassthrough();
  view.setImageOverlay(createImageOverlay('kitty', logo, 'third', 2, 2, {columns: 10, rows: 3}));
  view.render(frame(['a']));
  sink.data = '';
  view.leave();
  assert.match(sink.data, /a=d,d=I/u, 'exit deletes it');
});

test('fallback: with no protocol nothing image-shaped is ever written', () => {
  const sink = new Sink();
  const view = renderer(sink);
  view.setImageOverlay(createImageOverlay('none', logo, 'x', 0, 0, {columns: 5, rows: 2}));
  view.render({rows: ['text logo'], columns: 40, cursorRow: 1, cursorColumn: 1});
  view.leave();
  assert.equal(containsImageBytes(sink.data), false);
  assert.deepEqual(parseSlashCommand('/about'), {kind: 'about'});
});
