import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy } from './helpers.mjs';
import { createConsolidationRuntime } from '../lib/dsh/consolidation.mjs';
import { loadStore } from '../lib/core/store.mjs';
import { readEvents } from '../lib/core/events.mjs';
import { readConsolidation } from '../lib/core/consolidate.mjs';

function fakeSession(events) {
  return {
    id: 'session-consolidate',
    header: { id: 'session-consolidate', cwd: 'E:/aiwork/apps/workmem' },
    snapshotEvents: () => events
  };
}

function events() {
  return [
    { type: 'request/context', data: { provider: 'test-provider', model: 'test-model' }, seq: 0 },
    { type: 'turn/start', data: { turn: 1 }, seq: 1 },
    { type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '以后整理只写有用的。' }] }, seq: 2 },
    { type: 'assistant/message', data: { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: '好。' }] } }, seq: 3 },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, seq: 4 }
  ];
}

function fakeRuntime(dir, responses) {
  const st = { agent: { session: fakeSession(events()) }, cwd: 'E:/aiwork/apps/workmem', title: '整理测试', turn: 1, projects: new Set(), consolidating: null };
  let calls = 0;
  const llm = {
    async *stream() {
      const text = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      yield { type: 'text-delta', text };
    }
  };
  const ctx = { get: (name) => name === 'llm' ? llm : undefined };
  const runtime = createConsolidationRuntime({
    ctx,
    root: dir,
    stateFor: () => st,
    currentSid: () => 'session-consolidate',
    projectOf: () => 'workmem',
    line: () => {}
  });
  return { runtime, st, calls: () => calls };
}

test('runtime calls the current model, validates JSON, and writes memory', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const model = JSON.stringify({
      actions: [
        { op: 'create', category: 'rules', title: '整理规矩', content: '整理只写有长期价值的内容。', source: 'summary', importance: 3, project: '' },
        { op: 'skip', reason: '过程不写' }
      ]
    });
    const { runtime, calls } = fakeRuntime(dir, [model]);
    const result = await runtime.run('session-consolidate', { trigger: 'manual', turn: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.wrote, 1);
    assert.equal(result.skipped, 1);
    assert.equal(calls(), 1);
    assert.ok(loadStore(dir).entries.some((entry) => entry.title === '整理规矩'));
    assert.equal(readConsolidation(dir).sessions['session-consolidate'].lastOkTurn, 1);
    assert.ok(readEvents(dir, { type: 'consolidate', limit: 0 }).some((row) => row.ok === true));
  } finally {
    cleanup();
  }
});

test('runtime retries once on invalid JSON and then succeeds', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const model = JSON.stringify({
      actions: [{ op: 'create', category: 'facts', title: '重试事实', content: '第二次输出才合法。', source: 'summary', importance: 2, project: '' }]
    });
    const { runtime, calls } = fakeRuntime(dir, ['not json', model]);
    const result = await runtime.run('session-consolidate', { trigger: 'manual', turn: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.wrote, 1);
    assert.equal(calls(), 2);
  } finally {
    cleanup();
  }
});

test('runtime records failure without falling back to regex writes', async () => {
  const { dir, cleanup } = tempCopy();
  try {
    const { runtime, calls } = fakeRuntime(dir, ['not json', 'still not json']);
    const before = loadStore(dir).entries.length;
    const result = await runtime.run('session-consolidate', { trigger: 'auto', turn: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid-model-output');
    assert.equal(calls(), 2);
    assert.equal(loadStore(dir).entries.length, before);
    assert.equal(readConsolidation(dir).sessions['session-consolidate'].lastOkTurn, 0);
    assert.ok(readEvents(dir, { type: 'consolidate', limit: 0 }).length >= 1);
  } finally {
    cleanup();
  }
});
