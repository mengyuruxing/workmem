import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy } from './helpers.mjs';
import { createTools } from '../lib/dsh/tools.mjs';
import { loadStore } from '../lib/core/store.mjs';

function toolsFor(dir, session = { kind: 'chat', explicit: false }, onMode = null) {
  return Object.fromEntries(createTools({
    root: dir,
    getSession: () => ({ id: 'test-session', ...session }),
    setAiMode: (mode) => onMode?.(mode)
  }).map((t) => [t.name, t]));
}

test('task turn write is limited to pitfalls', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const tools = toolsFor(dir, { kind: 'task', explicit: false });
    const denied = await tools.workmem_write.execute({
      category: 'facts', title: '跑腿事实', content: '这条应该被拦。', source: 'tool'
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, 'task_turn_only_pitfall');

    const allowed = await tools.workmem_write.execute({
      category: 'pitfalls', title: '跑腿踩坑', content: '安装时报 EACCES，权限不足，只能换目录。', source: 'tool'
    });
    assert.equal(allowed.ok, true);
    assert.match(allowed.id, /^[0-9a-f]{8}$/);
    assert.ok(loadStore(dir).entries.some((e) => e.id === allowed.id));
  } finally {
    cleanup();
  }
});

test('explicit remember bypasses the task gate', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const tools = toolsFor(dir, { kind: 'task', explicit: true });
    const result = await tools.workmem_write.execute({
      category: 'facts', title: '主人让记的事实', content: '这条是主人明说记一下的。', source: 'quote'
    });
    assert.equal(result.ok, true);
  } finally {
    cleanup();
  }
});

test('task turn cannot rewrite a non-pitfall entry', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const facts = loadStore(dir).categories.facts.entries[0];
    const tools = toolsFor(dir, { kind: 'task', explicit: false });
    const denied = await tools.workmem_update.execute({ id: facts.id, content: '跑腿过程中顺手改的事实。' });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, 'task_turn_only_pitfall');
  } finally {
    cleanup();
  }
});

test('subagent cannot write or update', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const tools = toolsFor(dir, { kind: 'tell', explicit: true, subagent: true });
    const write = await tools.workmem_write.execute({
      category: 'facts', title: '子会话写入', content: '这条不该进来。', source: 'summary'
    });
    assert.equal(write.ok, false);
    assert.equal(write.error, 'subagent');
    const facts = loadStore(dir).categories.facts.entries[0];
    const update = await tools.workmem_update.execute({ id: facts.id, title: '子会话改名' });
    assert.equal(update.ok, false);
    assert.equal(update.error, 'subagent');
  } finally {
    cleanup();
  }
});

test('read, search, update and archive round-trip', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const tools = toolsFor(dir, { kind: 'tell', explicit: true });
    const created = await tools.workmem_write.execute({
      category: 'facts', title: '工具链测试', content: '测试工具链专用端口 9777。', source: 'tool', importance: 3
    });
    assert.equal(created.ok, true);

    const read = await tools.workmem_read.execute({ id: created.id });
    assert.equal(read.ok, true);
    assert.match(read.content, /9777/);
    assert.equal(read.category, 'facts');

    const found = await tools.workmem_search.execute({ q: '9777', limit: 5 });
    assert.equal(found.ok, true);
    assert.ok(found.items.some((x) => x.id === created.id));

    const updated = await tools.workmem_update.execute({ id: created.id, title: '工具链测试（改）' });
    assert.equal(updated.ok, true);
    assert.equal(loadStore(dir).entries.find((e) => e.id === created.id).title, '工具链测试（改）');

    const archived = await tools.workmem_archive.execute({ id: created.id });
    assert.equal(archived.ok, true);
    assert.equal(loadStore(dir).entries.find((e) => e.id === created.id).status, 'archived');
  } finally {
    cleanup();
  }
});

test('snapshot tool works and mode tool is gone', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const tools = toolsFor(dir, { kind: 'chat', explicit: false });
    const snap = await tools.workmem_snapshot.execute({ name: 'tool-snap', note: 'test' });
    assert.equal(snap.ok, true);
    // 单一工作模式后已没有切模式的工具。
    assert.equal(tools.workmem_mode_set, undefined);
  } finally {
    cleanup();
  }
});

test('tool update cannot change quote body and can pin a rule', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const quote = loadStore(dir).categories.rules.entries[0];
    const tools = toolsFor(dir, { kind: 'tell', explicit: true });
    const blocked = await tools.workmem_update.execute({ id: quote.id, content: '改原话' });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, 'quote-locked');

    const pinned = await tools.workmem_write.execute({
      category: 'rules', title: '钉住测试', content: '这条每轮保底。', source: 'summary', pinned: true
    });
    assert.equal(pinned.ok, true);
    assert.equal(loadStore(dir).entries.find((entry) => entry.id === pinned.id).pinned, true);
  } finally {
    cleanup();
  }
});
