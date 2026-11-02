import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy } from './helpers.mjs';
import { buildIndex, charRuns, explainMiss, longestCommonRun, manualSearch, search, tokenize } from '../lib/core/search.mjs';
import { loadSearchContext, manualSearchStore, searchStore } from '../lib/core/index.mjs';
import { searchView } from '../lib/core/view.mjs';
import { loadStore } from '../lib/core/store.mjs';
import { writeStats } from '../lib/core/stats.mjs';
import { setStatus } from '../lib/core/mutations.mjs';
import { DEFAULT_WEIGHTS, setCell } from '../lib/core/weights.mjs';

test('tokenizes Chinese bigrams and English words, drops stopwords', () => {
  const t = tokenize('改记忆库之前要做什么 pnpm 安装');
  assert.ok(t.includes('记忆'));
  assert.ok(t.includes('忆库'));
  assert.ok(!t.includes('什么'));
  assert.ok(t.includes('pnpm'));
  assert.ok(t.includes('安装'));
});

test('char runs and longest common run', () => {
  assert.ok(charRuns('改记忆库之前').includes('改记忆库之前'));
  assert.equal(longestCommonRun(['改记忆库之前'], ['动任何记忆库之前']), 5);
});

test('builds an index over active valid fixture entries', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const store = loadStore(dir);
    const index = buildIndex(store.entries);
    assert.equal(index.size, 5);
    assert.ok(index.idf.size > 0);
  } finally {
    cleanup();
  }
});

test('retrieves the expected category for natural queries', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const cases = [
      ['改记忆库之前要做什么', 'rules'],
      ['DSH profile 在哪里', 'facts'],
      ['pnpm 安装 构建 失败', 'pitfalls'],
      ['workmem 下一步做什么', 'progress'],
      ['平时怎么称呼主人', 'persona']
    ];
    for (const [query, category] of cases) {
      const result = searchStore(dir, query, { now: Date.parse('2026-11-03T00:00:00+08:00') });
      assert.ok(result.picks.length > 0, query + ' should hit');
      assert.equal(result.picks[0].entry.category, category, query + ' -> ' + result.picks[0].entry.title);
    }
  } finally {
    cleanup();
  }
});

test('returns nothing for an unrelated query', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const result = searchStore(dir, '今天天气怎么样', { now: Date.parse('2026-11-03T00:00:00+08:00') });
    assert.equal(result.picks.length, 0);
    assert.ok(['no-token-overlap', 'weak-match'].includes(result.diagnostics.reason));
    assert.ok(explainMiss(result.diagnostics).length > 0);
  } finally {
    cleanup();
  }
});

test('manual search uses the same scorer but no gate', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const auto = searchStore(dir, '备份', { now: Date.parse('2026-11-03T00:00:00+08:00') });
    const manual = manualSearchStore(dir, '备份', { now: Date.parse('2026-11-03T00:00:00+08:00') });
    assert.ok(auto.picks.length > 0);
    assert.ok(manual.picks.length > 0);
    assert.equal(manual.picks[0].entry.id, auto.picks[0].entry.id);
    assert.equal(manual.diagnostics.threshold, 0);
  } finally {
    cleanup();
  }
});

test('category weight changes ranking between work and companion modes', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const work = searchStore(dir, '称呼', { mode: 'work', gate: false, now: Date.parse('2026-11-03T00:00:00+08:00') });
    const companion = searchStore(dir, '称呼', { mode: 'companion', gate: false, now: Date.parse('2026-11-03T00:00:00+08:00') });
    const w = work.picks.find((p) => p.entry.category === 'persona');
    const c = companion.picks.find((p) => p.entry.category === 'persona');
    assert.ok(w && c);
    assert.ok(c.final > w.final, `${c.final} should be > ${w.final}`);
    assert.equal(w.factors.categoryWeight, 0.5);
    assert.equal(c.factors.categoryWeight, 2);
  } finally {
    cleanup();
  }
});

test('cold entries still match but score lower', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const store = loadStore(dir);
    const rules = store.categories.rules.entries[0];
    const now = Date.parse('2026-12-01T00:00:00+08:00');
    const stats = {
      version: 1,
      entries: { [rules.id]: { hits: 3, views: 1, last_touched_at: '2026-11-02T15:00:00+08:00' } }
    };
    writeStats(dir, stats);
    const result = searchStore(dir, '改记忆库之前要做什么', { now });
    const pick = result.picks.find((p) => p.entry.id === rules.id);
    assert.ok(pick);
    assert.equal(pick.zone, 'cold');
    assert.equal(pick.factors.zone, 0.7);
  } finally {
    cleanup();
  }
});

test('search function is pure and usable without store helpers', () => {
  const docs = [
    { id: 'aaaaaaaa', category: 'facts', title: '端口 8891', content: '服务监听 8891', keywords: ['端口'], status: 'active', importance: 2, issues: [], project: '', created_at: '', updated_at: '' },
    { id: 'bbbbbbbb', category: 'facts', title: '端口 9988', content: '另一个服务监听 9988', keywords: ['端口'], status: 'active', importance: 2, issues: [], project: '', created_at: '', updated_at: '' }
  ];
  const index = buildIndex(docs);
  const all = manualSearch(index, '端口', { topK: 10 });
  assert.equal(all.picks.length, 2);
  const gated = search(index, '端口', { topK: 10 });
  assert.ok(gated.picks.length >= 1);
});

test('archived and revoked entries leave the auto search pool', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const rules = loadStore(dir).categories.rules.entries[0];
    assert.equal(searchStore(dir, '改记忆库之前要做什么').picks.some((p) => p.entry.id === rules.id), true);
    setStatus(dir, rules.id, 'archived', { actor: '主人' });
    assert.equal(searchStore(dir, '改记忆库之前要做什么').picks.some((p) => p.entry.id === rules.id), false);
    assert.equal(searchView(dir, '改记忆库之前要做什么', { status: 'archived' }).items.some((p) => p.id === rules.id), true);
    setStatus(dir, rules.id, 'revoked', { actor: '主人' });
    assert.equal(searchStore(dir, '改记忆库之前要做什么').picks.some((p) => p.entry.id === rules.id), false);
    assert.equal(searchView(dir, '改记忆库之前要做什么', { status: 'all' }).items.some((p) => p.id === rules.id), true);
  } finally {
    cleanup();
  }
});

test('category weight ignore removes that category from retrieval', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const ctx = loadSearchContext(dir);
    const weights = setCell(DEFAULT_WEIGHTS, 'rules', 'work', 'ignore');
    const result = search(ctx.index, '改记忆库之前要做什么', {
      weights, stats: ctx.stats, mode: 'work', topK: 3
    });
    assert.equal(result.picks.some((p) => p.entry.category === 'rules'), false);

    const manual = search(ctx.index, '改记忆库之前要做什么', {
      weights, stats: ctx.stats, mode: 'work', gate: false, topK: 10
    });
    assert.equal(manual.picks.some((p) => p.entry.category === 'rules'), true);
  } finally {
    cleanup();
  }
});
