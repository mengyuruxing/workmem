import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy, tempEmpty } from './helpers.mjs';
import { initStore, loadStore } from '../lib/core/store.mjs';
import { detailView, listView, searchView, statsView, timelineView, weightsView } from '../lib/core/view.mjs';
import { handlePanelRequest } from '../lib/panel/api.mjs';
import { readStats } from '../lib/core/stats.mjs';
import { readAudit } from '../lib/core/audit.mjs';
import { readEvents } from '../lib/core/events.mjs';

test('list view filters by category, status and cold state', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const all = listView(dir, { status: 'all' });
    assert.equal(all.items.length, 4);
    const facts = listView(dir, { category: 'facts' });
    assert.equal(facts.items.length, 1);
    assert.equal(facts.items[0].categoryLabel, '事实');
    assert.ok('weight' in facts.items[0]);
    assert.ok('zone' in facts.items[0]);
    assert.equal(listView(dir, { status: 'archived' }).items.length, 0);
  } finally {
    cleanup();
  }
});

test('search view returns scores and diagnostics without gate', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const result = searchView(dir, '备份');
    assert.ok(result.items.length > 0);
    assert.ok(result.items[0].score > 0);
    assert.ok(result.items[0].reason);
    assert.equal(result.diagnostics.threshold, 0);
    assert.equal(result.items[0].category, 'rules');
  } finally {
    cleanup();
  }
});

test('detail view increments views and includes audit/factors', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const id = loadStore(dir).categories.rules.entries[0].id;
    const before = readStats(dir).entries[id]?.views ?? 0;
    const res = await handlePanelRequest(dir, { method: 'GET', url: '/workmem/panel/detail?id=' + id });
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.entry.id, id);
    assert.ok(res.body.data.factors.categoryWeight > 0);
    assert.ok(res.body.data.audit.length >= 1);
    assert.equal(readStats(dir).entries[id].views, before + 1);
  } finally {
    cleanup();
  }
});

test('stats, weights and timeline views are populated', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const stats = statsView(dir, { mode: 'work' });
    assert.equal(stats.total, 4);
    assert.equal(stats.categories.rules.label, '规矩');
    assert.ok(stats.health.status);
    const weights = weightsView(dir, { mode: 'work' });
    assert.equal(weights.rows.length, 4);
    assert.equal(weights.rows[0].cells.work.level, 'max');
    assert.equal(weights.modeLabel, '干活');
    const timeline = timelineView(dir, { limit: 20 });
    assert.ok(timeline.items.length > 0);
  } finally {
    cleanup();
  }
});

test('api serves stats/list/search/detail/weights', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    for (const url of [
      '/workmem/panel/stats',
      '/workmem/panel/list?category=rules',
      '/workmem/panel/search?q=备份',
      '/workmem/panel/detail?id=a1b2c3d4',
      '/workmem/panel/weights',
      '/workmem/panel/timeline',
      '/workmem/panel/diagnostics'
    ]) {
      const res = await handlePanelRequest(dir, { method: 'GET', url });
      assert.equal(res.body.ok, true, url + ' -> ' + JSON.stringify(res.body));
    }
    const missing = await handlePanelRequest(dir, { method: 'GET', url: '/workmem/panel/nope' });
    assert.equal(missing.status, 404);

    const searched = await handlePanelRequest(dir, { method: 'GET', url: '/workmem/panel/search?q=备份' });
    assert.equal(searched.body.ok, true);
    assert.ok(readEvents(dir, { type: 'manual-search' }).length >= 1);

    const diag = await handlePanelRequest(dir, { method: 'GET', url: '/workmem/panel/diagnostics' });
    assert.equal(diag.body.ok, true);
    assert.ok(diag.body.data.turns.length >= 1);
    assert.ok(diag.body.data.turns[0].hits[0].final != null);
  } finally {
    cleanup();
  }
});

test('api writes, edits, archives and restores', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const created = await handlePanelRequest(dir, {
      method: 'POST', url: '/workmem/panel/write',
      body: { category: 'facts', title: 'API 新条目', content: '通过面板接口写入的测试条目。', source: '总结' }
    });
    assert.equal(created.body.ok, true);
    const id = created.body.data.id;
    assert.equal(loadStore(dir).entries.length, 5);

    const edited = await handlePanelRequest(dir, {
      method: 'POST', url: '/workmem/panel/write',
      body: { id, title: 'API 改过', content: '改过的正文。' }
    });
    assert.equal(edited.body.ok, true);
    assert.equal(loadStore(dir).entries.find((e) => e.id === id).title, 'API 改过');

    const archived = await handlePanelRequest(dir, { method: 'POST', url: '/workmem/panel/archive', body: { id } });
    assert.equal(archived.body.ok, true);
    assert.equal(loadStore(dir).entries.find((e) => e.id === id).status, 'archived');

    const restored = await handlePanelRequest(dir, { method: 'POST', url: '/workmem/panel/restore', body: { id } });
    assert.equal(restored.body.ok, true);
    assert.equal(loadStore(dir).entries.find((e) => e.id === id).status, 'active');
  } finally {
    cleanup();
  }
});

test('api adjusts weight and answers mode as fixed', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const w = await handlePanelRequest(dir, {
      method: 'POST', url: '/workmem/panel/weights',
      body: { category: 'facts', level: 'normal' }
    });
    assert.equal(w.body.ok, true);
    const cell = w.body.data.rows.find((r) => r.category === 'facts').cells.work;
    assert.equal(cell.level, 'normal');
    assert.ok(readAudit(dir, { itemId: null }).some((r) => r.field === 'weights.facts'));

    // 模式固定：POST 什么都回 work/locked，不改设置。
    const m = await handlePanelRequest(dir, { method: 'POST', url: '/workmem/panel/mode', body: { mode: 'auto' } });
    assert.equal(m.body.ok, true);
    assert.equal(m.body.data.locked, true);
    assert.equal(m.body.data.default, 'work');
    assert.deepEqual(Object.keys(m.body.data.labels), ['work']);
  } finally {
    cleanup();
  }
});

test('api snapshots and rolls back', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const snap = await handlePanelRequest(dir, { method: 'POST', url: '/workmem/panel/snapshot', body: { name: 'api-snap' } });
    assert.equal(snap.body.ok, true);
    const list = await handlePanelRequest(dir, { method: 'GET', url: '/workmem/panel/snapshots' });
    assert.ok(list.body.data.items.some((x) => x.name === 'api-snap'));
    const back = await handlePanelRequest(dir, { method: 'POST', url: '/workmem/panel/rollback', body: { name: 'api-snap' } });
    assert.equal(back.body.ok, true);
  } finally {
    cleanup();
  }
});

test('empty store panel works and has no memories', async () => {
  const { dir, cleanup } = tempEmpty();
  try {
    initStore(dir);
    const stats = await handlePanelRequest(dir, { method: 'GET', url: '/workmem/panel/stats' });
    assert.equal(stats.body.ok, true);
    assert.equal(stats.body.data.total, 0);
    assert.equal(stats.body.data.health.status, 'yellow');
    const list = await handlePanelRequest(dir, { method: 'GET', url: '/workmem/panel/list' });
    assert.equal(list.body.data.items.length, 0);
  } finally {
    cleanup();
  }
});

test('consolidation API exposes info, settings and manual trigger', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const info = () => ({ enabled: true, everyTurns: 25, title: '测试对话', dueIn: 3, running: false });
    const consolidate = async () => ({ ok: true, wrote: 2, merged: 1, skipped: 1 });
    const got = await handlePanelRequest(dir, { method: 'GET', url: '/workmem/panel/consolidation', consolidationInfo: info });
    assert.equal(got.body.ok, true);
    assert.equal(got.body.data.title, '测试对话');

    const saved = await handlePanelRequest(dir, {
      method: 'POST', url: '/workmem/panel/consolidation', body: { enabled: false, everyTurns: 40 },
      consolidationInfo: info
    });
    assert.equal(saved.body.ok, true);
    const { readSettings } = await import('../lib/core/settings.mjs');
    const { settings } = readSettings(dir);
    assert.equal(settings.consolidation.enabled, false);
    assert.equal(settings.consolidation.everyTurns, 40);

    const run = await handlePanelRequest(dir, {
      method: 'POST', url: '/workmem/panel/consolidate', body: {},
      consolidate
    });
    assert.equal(run.body.ok, true);
    assert.equal(run.body.data.wrote, 2);
  } finally {
    cleanup();
  }
});
