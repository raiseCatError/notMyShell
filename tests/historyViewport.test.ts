import test from 'node:test';
import assert from 'node:assert/strict';
import {HistoryViewport} from '../src/output/viewport.js';

test('starts following, detaches on PageUp, and clamps at the top', () => {
  const viewport = new HistoryViewport();
  assert.equal(viewport.mode, 'follow');
  assert.equal(viewport.resolve(100, 20), 80);
  viewport.page(100, 20, -1);
  assert.equal(viewport.mode, 'detached');
  assert.equal(viewport.start, 62);
  for (let index = 0; index < 10; index += 1) viewport.page(100, 20, -1);
  assert.equal(viewport.start, 0);
});

test('new output and animation resolves do not move a detached viewport', () => {
  const viewport = new HistoryViewport();
  viewport.resolve(100, 20);
  viewport.page(100, 20, -1);
  const detachedStart = viewport.start;
  assert.equal(viewport.resolve(130, 20), detachedStart);
  assert.equal(viewport.resolve(130, 20), detachedStart);
  assert.equal(viewport.mode, 'detached');
});

test('PageDown reaching the bottom resumes follow, as do Ctrl-End and Ctrl-G', () => {
  const viewport = new HistoryViewport();
  viewport.resolve(100, 20);
  viewport.page(100, 20, -1);
  while (viewport.detached) viewport.page(100, 20, 1);
  assert.equal(viewport.resolve(110, 20), 90);
  viewport.page(110, 20, -1);
  viewport.latest();
  assert.equal(viewport.mode, 'follow');
  assert.equal(viewport.resolve(120, 20), 100);
});

test('resize preserves a sensible detached absolute history location', () => {
  const viewport = new HistoryViewport();
  viewport.resolve(100, 20);
  viewport.page(100, 20, -1);
  const start = viewport.start;
  assert.equal(viewport.resolve(100, 12), start);
  assert.equal(viewport.resolve(100, 30), start);
});

