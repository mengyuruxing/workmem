import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy, tempEmpty } from './helpers.mjs';
import { readWeights, setCell, factor, importanceFactor, resetAll, normalizeWeights } from '../lib/core/weights.mjs';
import { readSettings, normalizeSettings } from '../lib/core/settings.mjs';
import { readStats, bump, touch, zoneOf, usesOf } from '../lib/core/stats.mjs';
import { appendAudit, readAudit } from '../lib/core/audit.mjs';
import { appendEvent, readEvents, lastWriteFailure } from '../lib/core/events.mjs';
import { loadStore } from '../lib/core/store.mjs';

test('weights default matrix and cell changes', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const { weights, warnings } = readWeights(dir);
    assert.deepEqual(warnings, []);
    assert.equal(factor(weights, 'rules', 'work'), 2.0);
    assert.equal(factor(weights, 'persona', 'work'), 0.5);
    assert.equal(importanceFactor(weights, 4), 1.5);
    const next = setCell(weights, 'persona', 'work', 'normal');
    assert.equal(factor(next, 'persona', 'work'), 1.0);
    assert.deepEqual(resetAll(), weights);
  } finally {
    cleanup();
  }
});

test('invalid weight cells fall back to defaults with warnings', () => {
  const { weights, warnings } = normalizeWeights({
    matrix: { rules: { work: 'bogus' } },
    levels: { normal: 'x' }
  });
  assert.ok(warnings.length > 0);
  assert.equal(weights.matrix.rules.work, 'max');
  assert.equal(weights.levels.normal, 1.0);
});

test('settings merge, clamp and fallback', () => {
  const { settings, warnings } = normalizeSettings({
    coldDays: 0,
    mode: { default: 'nonsense', fallback: 'auto' },
    retrieval: { minCoverage: 0, topK: 999 },
    deepDive: { enabled: 1 }
  });
  assert.equal(settings.coldDays, 1);
  assert.equal(settings.mode.default, 'auto');
  assert.equal(settings.mode.fallback, 'mixed');
  assert.equal(settings.retrieval.minCoverage, 0);
  assert.equal(settings.retrieval.topK, 20);
  assert.equal(settings.deepDive.enabled, true);
  assert.ok(warnings.length >= 2);
});

test('stats bump/use and cold zone', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const store = loadStore(dir);
    const entry = store.categories.rules.entries[0];
    const hit = bump(dir, entry.id, 'hit', { now: '2026-11-02T16:00:00+08:00' });
    assert.equal(hit.hits, 4);
    const view = bump(dir, entry.id, 'view', { now: '2026-11-02T16:01:00+08:00' });
    assert.equal(view.views, 2);
    assert.equal(usesOf(view), 6);
    const touched = touch(dir, entry.id, { now: '2026-11-02T16:02:00+08:00' });
    assert.equal(touched.last_touched_at, '2026-11-02T16:02:00+08:00');
    assert.equal(zoneOf(entry, touched, 14, Date.parse('2026-11-03T00:00:00+08:00')), 'hot');
    assert.equal(zoneOf(entry, touched, 14, Date.parse('2026-12-01T00:00:00+08:00')), 'cold');
  } finally {
    cleanup();
  }
});

test('audit append and read by item', () => {
  const { dir, cleanup } = tempEmpty();
  try {
    appendAudit(dir, { actor: '主人', action: 'create', item_id: 'aaaaaaaa', category: 'facts', field: 'content', before: null, after: 'x' });
    appendAudit(dir, { actor: '小喵', action: 'update', item_id: 'bbbbbbbb', category: 'rules', field: 'title', before: 'a', after: 'b' });
    const all = readAudit(dir);
    assert.equal(all.length, 2);
    assert.equal(readAudit(dir, { itemId: 'aaaaaaaa' }).length, 1);
  } finally {
    cleanup();
  }
});

test('events append, filter and detect write failure', () => {
  const { dir, cleanup } = tempEmpty();
  try {
    appendEvent(dir, { type: 'turn', picked: [] });
    appendEvent(dir, { type: 'write', ok: true, id: 'aaaaaaaa' });
    appendEvent(dir, { type: 'write', ok: false, id: 'bbbbbbbb', error: 'disk' });
    assert.equal(readEvents(dir, { type: 'turn' }).length, 1);
    assert.equal(readEvents(dir, { type: 'write' }).length, 2);
    assert.ok(lastWriteFailure(dir, 24));
  } finally {
    cleanup();
  }
});
