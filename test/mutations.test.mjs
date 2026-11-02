import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy, tempEmpty } from './helpers.mjs';
import { initStore, loadStore } from '../lib/core/store.mjs';
import { createEntry, setStatus, updateEntry } from '../lib/core/mutations.mjs';
import { readAudit } from '../lib/core/audit.mjs';
import { readEvents } from '../lib/core/events.mjs';

test('creates a new entry, writes audit and event', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const before = loadStore(dir).entries.length;
    const result = createEntry(dir, {
      category: 'facts',
      title: '测试端口',
      content: '测试服务监听 9988 端口。',
      source: '工具',
      importance: 2,
      keywords: ['测试', '端口']
    }, { actor: '小喵' });
    assert.equal(result.ok, true);
    assert.equal(result.merged, false);
    assert.equal(loadStore(dir).entries.length, before + 1);
    assert.ok(readAudit(dir, { itemId: result.entry.id }).some((r) => r.action === 'create'));
    assert.ok(readEvents(dir, { type: 'write' }).some((r) => r.ok && r.id === result.entry.id));
  } finally {
    cleanup();
  }
});

test('merges near-duplicate content instead of adding a row', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const original = loadStore(dir).categories.facts.entries[0];
    const count = loadStore(dir).entries.length;
    const result = createEntry(dir, {
      category: 'facts',
      title: original.title,
      content: original.content,
      source: original.source,
      importance: original.importance
    });
    assert.equal(result.ok, true);
    assert.equal(result.merged, true);
    assert.equal(loadStore(dir).entries.length, count);
  } finally {
    cleanup();
  }
});

test('quote body is locked; metadata can still change', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const entry = loadStore(dir).categories.rules.entries[0];
    const blocked = updateEntry(dir, entry.id, { content: '动记忆库前先备份，并说明位置。' }, { actor: '主人' });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, 'quote-locked');
    const unchanged = loadStore(dir).entries.find((e) => e.id === entry.id);
    assert.equal(unchanged.content, entry.content);
    assert.equal(unchanged.quote_edited, false);

    const meta = updateEntry(dir, entry.id, { importance: 4, pinned: true }, { actor: '主人' });
    assert.equal(meta.ok, true);
    const updated = loadStore(dir).entries.find((e) => e.id === entry.id);
    assert.equal(updated.importance, 4);
    assert.equal(updated.pinned, true);
  } finally {
    cleanup();
  }
});

test('does not merge different provenance into a quote', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const quote = loadStore(dir).categories.rules.entries[0];
    const count = loadStore(dir).entries.length;
    const result = createEntry(dir, {
      category: 'rules',
      title: quote.title,
      content: quote.content,
      source: 'summary',
      importance: quote.importance
    });
    assert.equal(result.ok, true);
    assert.equal(result.merged, false);
    assert.equal(loadStore(dir).entries.length, count + 1);
  } finally {
    cleanup();
  }
});

test('does not merge into an archived entry', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const original = loadStore(dir).categories.facts.entries[0];
    setStatus(dir, original.id, 'archived', { actor: '主人' });
    const count = loadStore(dir).entries.length;
    const result = createEntry(dir, {
      category: 'facts',
      title: original.title,
      content: original.content,
      source: original.source,
      importance: original.importance
    });
    assert.equal(result.ok, true);
    assert.equal(result.merged, false);
    assert.equal(loadStore(dir).entries.length, count + 1);
    assert.equal(loadStore(dir).entries.find((e) => e.id === original.id).status, 'archived');
  } finally {
    cleanup();
  }
});

test('archive keeps the entry in the file', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const entry = loadStore(dir).categories.facts.entries[0];
    const result = setStatus(dir, entry.id, '已归档', { actor: '主人' });
    assert.equal(result.ok, true);
    const updated = loadStore(dir).entries.find((e) => e.id === entry.id);
    assert.equal(updated.status, 'archived');
  } finally {
    cleanup();
  }
});

test('rejects sensitive content and unknown categories', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const secret = createEntry(dir, {
      category: 'facts', title: '密钥', content: 'api_key: sk-1234567890abcdef', source: '工具'
    });
    assert.equal(secret.ok, false);
    assert.equal(secret.error, 'invalid-input');
    const unknown = createEntry(dir, { category: 'nope', title: 'x', content: 'y' });
    assert.equal(unknown.ok, false);
  } finally {
    cleanup();
  }
});

test('starts from an empty store with zero memories', () => {
  const { dir, cleanup } = tempEmpty();
  try {
    initStore(dir);
    assert.equal(loadStore(dir).entries.length, 0);
    const result = createEntry(dir, {
      category: 'progress', title: '空库第一条', content: '这是测试写入的第一条。', source: '总结'
    });
    assert.equal(result.ok, true);
    assert.equal(loadStore(dir).entries.length, 1);
  } finally {
    cleanup();
  }
});
