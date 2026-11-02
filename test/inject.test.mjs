import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy } from './helpers.mjs';
import { renderInjection, injectionIds, renderMissNote, CITATION_RULE } from '../lib/core/inject.mjs';
import { searchStore } from '../lib/core/index.mjs';

test('renders an empty string when nothing was hit', () => {
  assert.equal(renderInjection([], { mode: 'work' }), '');
});

test('injection carries id, category, source, zone and citation rule', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const result = searchStore(dir, '改记忆库之前要做什么', {
      now: Date.parse('2026-11-03T00:00:00+08:00')
    });
    assert.ok(result.picks.length > 0);
    const text = renderInjection(result.picks, { mode: 'work' });
    assert.match(text, /\[id:a1b2c3d4\]/);
    assert.match(text, /\[规矩\]/);
    assert.match(text, /\[原话\]/);
    assert.match(text, /\[热\]/);
    assert.ok(text.includes(CITATION_RULE));
    assert.match(text, /本轮读法：干活/);
    assert.deepEqual(injectionIds(result.picks), result.picks.map((p) => p.entry.id));
  } finally {
    cleanup();
  }
});

test('injection respects maxChars and miss note', () => {
  const long = {
    entry: {
      id: 'aaaaaaaa', category: 'facts', title: '长条目', content: 'x'.repeat(500), source: '总结'
    },
    zone: 'cold'
  };
  const text = renderInjection([long], { mode: 'mixed', maxChars: 300 });
  assert.ok(text.length <= 400);
  assert.match(renderMissNote('weak-match'), /weak-match/);
});
