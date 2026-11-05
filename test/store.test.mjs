import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempCopy, tempEmpty } from './helpers.mjs';
import { initStore, loadCategory, loadStore, nextId, saveCategory, storeStats } from '../lib/core/store.mjs';

test('initStore creates four empty category files and no memories', () => {
  const { dir, cleanup } = tempEmpty();
  try {
    initStore(dir);
    for (const file of ['work/rules.md', 'work/facts.md', 'work/pitfalls.md', 'work/progress.md']) {
      const path = join(dir, file);
      assert.ok(existsSync(path), file);
      const text = readFileSync(path, 'utf8');
      assert.equal(text.trim().split(/\r?\n/).length, 1, file);
    }
    const store = loadStore(dir);
    assert.equal(store.entries.length, 0);
    assert.equal(store.invalid.length, 0);
    assert.ok(existsSync(join(dir, '_stats.json')));
    assert.ok(existsSync(join(dir, '_weights.json')));
    assert.ok(existsSync(join(dir, '_settings.json')));
  } finally {
    cleanup();
  }
});

test('loads the fixture store and keeps categories separate', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const store = loadStore(dir);
    assert.equal(store.entries.length, 4);
    assert.equal(store.valid.length, 4);
    assert.equal(store.invalid.length, 0);
    assert.equal(store.categories.rules.entries.length, 1);
    assert.equal(store.categories.pitfalls.entries.length, 1);
    assert.equal(storeStats(dir).counts.rules, 1);
  } finally {
    cleanup();
  }
});

test('refuses to overwrite a file changed externally', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const loaded = loadCategory(dir, 'rules');
    const file = join(dir, 'work/rules.md');
    const before = readFileSync(file, 'utf8');
    writeFileSync(file, before + '\n<!-- external -->\n', 'utf8');
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);
    const result = saveCategory(dir, 'rules', loaded.entries, { expectedMtimeMs: loaded.mtimeMs });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'external-change');
    assert.match(readFileSync(file, 'utf8'), /external/);
  } finally {
    cleanup();
  }
});

test('refuses to rewrite a category containing an invalid entry', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const loaded = loadCategory(dir, 'facts');
    loaded.entries[0] = { ...loaded.entries[0], content: '' };
    loaded.entries[0].issues = [{ code: 'empty-content', message: 'x' }];
    const result = saveCategory(dir, 'facts', loaded.entries, { expectedMtimeMs: loaded.mtimeMs });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid-entry');
  } finally {
    cleanup();
  }
});

test('nextId does not collide with existing ids', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const store = loadStore(dir);
    const id = nextId(dir);
    assert.match(id, /^[0-9a-f]{8}$/);
    assert.ok(!store.entries.some((e) => e.id === id));
  } finally {
    cleanup();
  }
});
