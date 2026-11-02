import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy } from './helpers.mjs';
import { computeZones, maybeSweepCold, sweepCold } from '../lib/core/lifecycle.mjs';
import { readStats, writeStats, bump } from '../lib/core/stats.mjs';
import { readEvents } from '../lib/core/events.mjs';
import { loadStore } from '../lib/core/store.mjs';

test('cold sweep records newly cold and revived ids without moving files', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const rules = loadStore(dir).categories.rules.entries[0];
    const stats = readStats(dir);
    stats.entries[rules.id] = { hits: 1, views: 0, last_touched_at: '2026-10-01T00:00:00+08:00' };
    writeStats(dir, stats);
    const now = Date.parse('2026-12-01T00:00:00+08:00');

    const zones = computeZones(dir, { now });
    assert.ok(zones.cold.includes(rules.id));

    const first = sweepCold(dir, { now });
    assert.equal(first.changed, true);
    assert.ok(first.newlyCold.includes(rules.id));
    assert.ok(readEvents(dir, { type: 'cold_sweep' }).length === 1);

    const second = sweepCold(dir, { now });
    assert.equal(second.changed, false);

    bump(dir, rules.id, 'hit', { now: '2026-12-01T01:00:00+08:00' });
    const third = sweepCold(dir, { now: Date.parse('2026-12-01T02:00:00+08:00') });
    assert.equal(third.changed, true);
    assert.ok(third.revived.includes(rules.id));
  } finally {
    cleanup();
  }
});

test('maybeSweepCold skips within 24 hours', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const now = Date.parse('2026-11-03T00:00:00+08:00');
    const first = maybeSweepCold(dir, { now });
    assert.equal(first.skipped, undefined);
    const second = maybeSweepCold(dir, { now: now + 3600000 });
    assert.equal(second.skipped, true);
  } finally {
    cleanup();
  }
});
