import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempCopy, tempEmpty } from './helpers.mjs';
import { initStore } from '../lib/core/store.mjs';
import { appendEvent } from '../lib/core/events.mjs';
import { computeHealth } from '../lib/core/health.mjs';

test('empty store is yellow, not green', () => {
  const { dir, cleanup } = tempEmpty();
  try {
    initStore(dir);
    const health = computeHealth(dir);
    assert.equal(health.status, 'yellow');
    assert.match(health.reason, /空库/);
    assert.match(health.line, /近30轮/);
    assert.equal(health.entryCount, 0);
  } finally {
    cleanup();
  }
});

test('store with no turns is yellow', () => {
  const { dir, cleanup } = tempCopy();
  try {
    rmSync(join(dir, '_logs', 'events.jsonl'), { force: true });
    const health = computeHealth(dir);
    assert.equal(health.status, 'yellow');
    assert.match(health.reason, /没有真实轮次/);
  } finally {
    cleanup();
  }
});

test('hits make it green and the line counts recent turns', () => {
  const { dir, cleanup } = tempCopy();
  try {
    rmSync(join(dir, '_logs', 'events.jsonl'), { force: true });
    appendEvent(dir, { type: 'turn', picked: [{ id: 'a1b2c3d4' }] });
    appendEvent(dir, { type: 'turn', picked: [{ id: 'b2c3d4e5' }] });
    appendEvent(dir, { type: 'turn', picked: [] });
    appendEvent(dir, { type: 'write', ok: true, id: 'a1b2c3d4' });
    const health = computeHealth(dir);
    assert.equal(health.status, 'green');
    assert.equal(health.hits, 2);
    assert.equal(health.total, 3);
    assert.match(health.line, /近30轮命中 2 次（67%）/);
    assert.match(health.line, /现有 3 轮/);
    assert.match(health.line, /写入 1 条/);
    assert.equal(health.lastHitTurnsAgo, 1);
  } finally {
    cleanup();
  }
});

test('ten consecutive misses turn yellow', () => {
  const { dir, cleanup } = tempCopy();
  try {
    for (let i = 0; i < 10; i += 1) appendEvent(dir, { type: 'turn', picked: [] });
    const health = computeHealth(dir);
    assert.equal(health.status, 'yellow');
    assert.match(health.reason, /连续 10 轮/);
  } finally {
    cleanup();
  }
});

test('write failure turns red', () => {
  const { dir, cleanup } = tempCopy();
  try {
    appendEvent(dir, { type: 'turn', picked: [{ id: 'a1b2c3d4' }] });
    appendEvent(dir, { type: 'write', ok: false, id: 'a1b2c3d4', error: 'disk full' });
    const health = computeHealth(dir);
    assert.equal(health.status, 'red');
    assert.match(health.reason, /写入失败/);
  } finally {
    cleanup();
  }
});

test('low rate in 30 turns is yellow even with a recent hit', () => {
  const { dir, cleanup } = tempCopy();
  try {
    rmSync(join(dir, '_logs', 'events.jsonl'), { force: true });
    for (let i = 0; i < 20; i += 1) appendEvent(dir, { type: 'turn', picked: [] });
    appendEvent(dir, { type: 'turn', picked: [{ id: 'a1b2c3d4' }] });
    for (let i = 0; i < 9; i += 1) appendEvent(dir, { type: 'turn', picked: [] });
    const health = computeHealth(dir);
    assert.equal(health.status, 'yellow');
    assert.equal(health.consecutiveMiss, 9);
    assert.match(health.reason, /命中率/);
  } finally {
    cleanup();
  }
});

test('a populated store with no writes for the whole window turns yellow', () => {
  const { dir, cleanup } = tempCopy();
  try {
    rmSync(join(dir, '_logs', 'events.jsonl'), { force: true });
    for (let i = 0; i < 30; i += 1) {
      appendEvent(dir, { type: 'turn', picked: i % 2 === 0 ? [{ id: 'a1b2c3d4' }] : [] });
    }
    const health = computeHealth(dir);
    assert.equal(health.status, 'yellow');
    assert.match(health.reason, /没有写入/);
    assert.equal(health.noWrite, true);
    assert.match(health.line, /最近写入/);
  } finally {
    cleanup();
  }
});
