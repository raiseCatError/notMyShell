import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StreamBacklog, readSpool, type BacklogEvent} from '../src/session/StreamBacklog.js';
import {AlternateScreenTracker} from '../src/session/SessionService.js';

const output = (seq: number, data: string): BacklogEvent => ({kind: 'output', seq, at: seq, data});

function scratch(): string { return mkdtempSync(join(tmpdir(), 'nmsh-backlog-')); }

test('unacknowledged events stay in memory until acked', () => {
  const dir = scratch();
  const backlog = new StreamBacklog(join(dir, 'spool', 's.jsonl'), {memoryBytes: 1000, spoolBytes: 10_000});
  backlog.append(output(1, 'a'));
  backlog.append({kind: 'exec', seq: 2, at: 2, command: 'ls'});
  backlog.append({kind: 'prompt', seq: 3, at: 3, exitCode: 0, cwd: '/'});
  assert.deepEqual(backlog.events().map(event => event.seq), [1, 2, 3]);
  backlog.ack(2, 'journal-1');
  assert.deepEqual(backlog.events().map(event => event.seq), [3]);
  assert.equal(backlog.journalId, 'journal-1');
  assert.equal(backlog.spooling, false);
  backlog.ack(1, 'stale');
  assert.equal(backlog.ackedSeq, 2, 'acks never move backwards');
  rmSync(dir, {recursive: true, force: true});
});

test('memory is bounded: events spill to a spool and an ack that covers it removes it', () => {
  const dir = scratch();
  const path = join(dir, 'spool', 's.jsonl');
  const backlog = new StreamBacklog(path, {memoryBytes: 100, spoolBytes: 100_000});
  for (let seq = 1; seq <= 50; seq += 1) backlog.append(output(seq, `line ${seq}\n`.padEnd(20, '.')));
  assert.ok(backlog.spooling);
  assert.ok(existsSync(path));
  assert.deepEqual(backlog.events().map(event => event.seq), Array.from({length: 50}, (_, i) => i + 1));
  backlog.ack(25, 'j');
  assert.deepEqual(backlog.events().map(event => event.seq)[0], 26);
  backlog.ack(50, 'j');
  assert.equal(existsSync(path), false);
  assert.deepEqual(backlog.events(), []);
  rmSync(dir, {recursive: true, force: true});
});

test('past the spool limit output is dropped with a count; command boundaries are kept', () => {
  const dir = scratch();
  const backlog = new StreamBacklog(join(dir, 's.jsonl'), {memoryBytes: 10, spoolBytes: 200});
  backlog.append({kind: 'exec', seq: 1, at: 1, command: 'yes'});
  for (let seq = 2; seq <= 101; seq += 1) backlog.append(output(seq, 'y\n'.repeat(10)));
  backlog.append({kind: 'prompt', seq: 102, at: 102, exitCode: 141, cwd: '/w'});
  const events = backlog.events();
  assert.equal(events[0]?.kind, 'exec');
  assert.equal(events.at(-1)?.kind, 'prompt');
  const kept = events.filter(event => event.kind === 'output').reduce((total, event) => total + (event.kind === 'output' ? event.data.length : 0), 0);
  assert.ok(kept <= 200);
  assert.equal(backlog.truncatedBytes, 2000 - kept);
  rmSync(dir, {recursive: true, force: true});
});

test('prompt metadata (a large alias/function list) never consumes the output budget', () => {
  const dir = scratch();
  const backlog = new StreamBacklog(join(dir, 's.jsonl'), {memoryBytes: 10, spoolBytes: 200});
  // Ubuntu's global compinit puts hundreds of autoload names in each prompt's knowledge.
  const knowledge = 'function _x\n'.repeat(1000);
  backlog.append({kind: 'prompt', seq: 1, at: 1, exitCode: 0, cwd: '/w', knowledge});
  backlog.append({kind: 'exec', seq: 2, at: 2, command: 'seq 1 50'});
  backlog.append(output(3, 'o'.repeat(200)));
  backlog.append({kind: 'prompt', seq: 4, at: 4, exitCode: 0, cwd: '/w', knowledge});
  assert.equal(backlog.truncatedBytes, 0, 'output within the limit is complete');
  assert.deepEqual(backlog.events().map(event => event.kind), ['prompt', 'exec', 'output', 'prompt']);
  backlog.append(output(5, 'z'.repeat(20)));
  assert.equal(backlog.truncatedBytes, 20, 'the output cap still holds');
  rmSync(dir, {recursive: true, force: true});
});

test('a spool torn by a crash mid-write reads back as its complete records', () => {
  const dir = scratch();
  const path = join(dir, 's.jsonl');
  const backlog = new StreamBacklog(path, {memoryBytes: 1, spoolBytes: 10_000});
  backlog.append({kind: 'exec', seq: 1, at: 1, command: 'make'});
  backlog.append(output(2, 'built\n'));
  backlog.ack(1, 'journal-9');
  appendFileSync(path, '{"kind":"output","seq":3,"at":3,"da');
  const contents = readSpool(path);
  assert.deepEqual(contents.events, [output(2, 'built\n')]);
  assert.equal(contents.ackedSeq, 1);
  assert.equal(contents.journalId, 'journal-9');
  appendFileSync(path, '\n{"kind":"output","seq":"bad"}\nnot json\n');
  assert.deepEqual(readSpool(path).events, [output(2, 'built\n')]);
  backlog.append({kind: 'prompt', seq: 4, at: 4, exitCode: 0, cwd: '/'});
  backlog.finish(0, 5);
  assert.deepEqual(readSpool(path).exit, {exitCode: 0, at: 5});
  assert.deepEqual(readSpool(join(dir, 'missing.jsonl')), {events: [], ackedSeq: 0, truncatedBytes: 0});
  rmSync(dir, {recursive: true, force: true});
});

test('alternate-screen content is not retained as transcript text', () => {
  const tracker = new AlternateScreenTracker();
  assert.equal(tracker.push('before\r\n\u001b[?1049h\u001b[2Jfullscreen'), 'before\r\n');
  assert.equal(tracker.active, true);
  assert.equal(tracker.push('more fullscreen'), '');
  assert.equal(tracker.push('bye\u001b[?1049lafter\r\n'), 'after\r\n');
  assert.equal(tracker.active, false);
  // A switch split across reads is still observed.
  assert.equal(tracker.push('x\u001b[?10'), 'x\u001b[?10');
  assert.equal(tracker.push('49hhidden'), '');
  assert.equal(tracker.active, true);
});
