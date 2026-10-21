import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ArcadeStore, ARCADE_FILE, ARCADE_VERSION, MAX_GAMES} from '../src/arcade/scores.js';

const tmp = (): string => mkdtempSync(join(process.env.NMSH_TEST_TMPDIR ?? process.env.TMPDIR ?? '.', 'arcade-v2-'));
const saved = (dir: string): {version: number; games: Record<string, unknown>; hub?: Record<string, unknown>} => JSON.parse(readFileSync(join(dir, ARCADE_FILE), 'utf8'));

test('records v2: a v1 file keeps every score, Vespyr Doku becomes Queens, and the original is backed up once', () => {
  const dir = tmp();
  try {
    const v1 = JSON.stringify({version: 1, games: {run: {best: 120, runs: 3}, 'vespyr-doku': {bestTimes: {easy: 61000}, completed: 4}}});
    writeFileSync(join(dir, ARCADE_FILE), v1);
    const store = new ArcadeStore({directory: dir});
    assert.deepEqual(store.record('queens').get(), {bestTimes: {easy: 61000}, completed: 4}, 'Vespyr Doku progress is Vespyr Queens progress');
    assert.deepEqual(store.record('run').get(), {best: 120, runs: 3});
    assert.deepEqual(store.record('vespyr-doku').get(), store.record('queens').get(), 'the old id still reads the same record');
    // Reading changes nothing on disk.
    store.flush();
    assert.equal(readFileSync(join(dir, ARCADE_FILE), 'utf8'), v1, 'nothing is written until something changes');
    assert.equal(store.record('run').update(record => { record.runs = 4; }), true);
    assert.equal(store.flush(), true);
    const after = saved(dir);
    assert.equal(after.version, ARCADE_VERSION);
    assert.equal(ARCADE_VERSION, 2);
    assert.deepEqual(Object.keys(after.games).sort(), ['queens', 'run']);
    assert.equal(readFileSync(join(dir, `${ARCADE_FILE}.v1-backup`), 'utf8'), v1, 'the v1 file is kept verbatim');
    // A later write never replaces the backup.
    writeFileSync(join(dir, `${ARCADE_FILE}.v1-backup`), 'kept');
    store.record('run').update(record => { record.runs = 5; });
    store.flush();
    assert.equal(readFileSync(join(dir, `${ARCADE_FILE}.v1-backup`), 'utf8'), 'kept');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('records v2: when both ids exist the Queens record wins and the Doku record is not lost', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, ARCADE_FILE), JSON.stringify({version: 1, games: {queens: {completed: 9}, 'vespyr-doku': {completed: 2}}}));
    const store = new ArcadeStore({directory: dir});
    assert.deepEqual(store.record('queens').get(), {completed: 9});
    store.record('queens').update(record => { record.completed = 10; });
    store.flush();
    assert.deepEqual(saved(dir).games['vespyr-doku'], {completed: 2}, 'kept under its own id rather than dropped');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('records v2: more than sixteen games survive a round trip, up to the new limit', () => {
  const dir = tmp();
  try {
    assert.ok(MAX_GAMES >= 64);
    const store = new ArcadeStore({directory: dir});
    for (let index = 0; index < 40; index += 1) assert.equal(store.record(`game-${index}`).set({best: index}), true);
    store.flush();
    const again = new ArcadeStore({directory: dir});
    assert.deepEqual(again.record('game-39').get(), {best: 39});
    assert.equal(Object.keys(saved(dir).games).length, 40);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('records v2: hub state is validated, bounded and persisted next to the games', () => {
  const dir = tmp();
  try {
    const store = new ArcadeStore({directory: dir});
    assert.deepEqual(store.hub(), {favorites: [], recent: [], settings: {}});
    store.setHub({selected: 'sudoku', favorites: ['run', 'run', 'Bad Id', 'queens'], recent: Array.from({length: 20}, (_, i) => `g${i}`), settings: {driftkeys: {mode: 'programmer'}}});
    const hub = store.hub();
    assert.equal(hub.selected, 'sudoku');
    assert.deepEqual(hub.favorites, ['run', 'queens'], 'duplicates and invalid ids are dropped');
    assert.equal(hub.recent.length, 8, 'recent is bounded');
    store.flush();
    assert.deepEqual(new ArcadeStore({directory: dir}).hub(), hub);
    store.setHub({...hub, settings: {bad: {['__proto__']: 1} as never}});
    assert.deepEqual(store.hub().settings, hub.settings, 'invalid settings are refused');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('records v2: damaged hub data does not cost the scores; a newer file stays read-only', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, ARCADE_FILE), JSON.stringify({version: 2, games: {run: {best: 7}}, hub: {selected: 42, favorites: 'x'}}));
    const store = new ArcadeStore({directory: dir});
    assert.deepEqual(store.record('run').get(), {best: 7});
    assert.deepEqual(store.hub(), {favorites: [], recent: [], settings: {}});
    assert.equal(existsSync(join(dir, `${ARCADE_FILE}.v1-backup`)), false, 'a v2 file is not backed up as v1');
    writeFileSync(join(dir, ARCADE_FILE), JSON.stringify({version: 3, games: {run: {best: 5}}}));
    const future = new ArcadeStore({directory: dir});
    future.load();
    assert.equal(future.writable, false);
    future.setHub({selected: 'run', favorites: [], recent: [], settings: {}});
    future.flush();
    assert.equal(saved(dir).version, 3);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
