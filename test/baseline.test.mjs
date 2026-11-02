import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy } from './helpers.mjs';
import { createEntry } from '../lib/core/mutations.mjs';
import { loadSearchContext, pickBaseline } from '../lib/core/index.mjs';
import { renderInjection } from '../lib/core/inject.mjs';

test('baseline prefers pinned rules and bypasses relevance', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const pinned = createEntry(dir, {
      category: 'rules', title: '钉住规矩', content: '钉住的规矩每轮都要在。',
      source: 'summary', importance: 2, pinned: true
    });
    assert.ok(pinned.ok);
    const ctx = loadSearchContext(dir, { now: Date.parse('2026-11-03T00:00:00+08:00') });
    const rows = pickBaseline(ctx, { mode: 'work', currentProject: '' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entry.id, pinned.entry.id);
    assert.equal(rows[0].baseline, true);

    const text = renderInjection(rows, { mode: 'work' });
    assert.match(text, /〔保底规矩〕/);
    assert.match(text, /保底·/);
    assert.match(text, /钉住的规矩每轮都要在/);
  } finally {
    cleanup();
  }
});

test('baseline respects mode, project, and deduplicates retrieval', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const global = createEntry(dir, {
      category: 'rules', title: '全局规矩', content: '全局规矩正文。',
      source: 'summary', importance: 4
    });
    const other = createEntry(dir, {
      category: 'rules', title: '别的项目', content: '别的项目规矩。',
      source: 'summary', importance: 4, project: 'other'
    });
    assert.ok(global.ok && other.ok);
    const ctx = loadSearchContext(dir, { now: Date.parse('2026-11-03T00:00:00+08:00') });
    const work = pickBaseline(ctx, { mode: 'work', currentProject: 'current' });
    assert.ok(work.some((row) => row.entry.id === global.entry.id));
    assert.ok(!work.some((row) => row.entry.id === other.entry.id));
    assert.deepEqual(pickBaseline(ctx, { mode: 'companion', currentProject: 'current' }), []);

    const text = renderInjection([...work, ...work], { mode: 'work' });
    assert.equal((text.match(/全局规矩正文/g) || []).length, 1);
  } finally {
    cleanup();
  }
});
