import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy } from './helpers.mjs';
import { loadStore } from '../lib/core/store.mjs';
import { createEntry } from '../lib/core/mutations.mjs';
import { readSettings } from '../lib/core/settings.mjs';
import {
  applyConsolidation,
  buildConsolidationPacket,
  buildConsolidationPrompt,
  consolidationStatus,
  parseModelJson,
  readConsolidation,
  recordConsolidation,
  regexHints,
  validateConsolidation
} from '../lib/core/consolidate.mjs';

function fakeSession(events, { id = 'session-test', cwd = 'E:/aiwork/apps/workmem' } = {}) {
  return { id, header: { id, cwd }, snapshotEvents: () => events };
}

function eventsForTurns() {
  return [
    { type: 'turn/start', data: { turn: 1 }, seq: 0 },
    { type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '以后改库前先备份。' }] }, seq: 1 },
    { type: 'assistant/message', data: { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: '好的。' }] } }, seq: 2 },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, seq: 3 },
    { type: 'turn/start', data: { turn: 2 }, seq: 4 },
    { type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '8899 端口是 usage 面板，记一下。' }] }, seq: 5 },
    { type: 'assistant/message', data: { turn: 2, message: { role: 'assistant', content: [{ type: 'text', text: '记住了。' }] } }, seq: 6 },
    { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } }, seq: 7 }
  ];
}

test('builds a packet from the current turn delta only', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const packet = buildConsolidationPacket(fakeSession(eventsForTurns()), {
      root: dir,
      fromTurn: 1,
      toTurn: 2,
      scopeProjects: [''],
      sessionTitle: '测试对话'
    });
    assert.equal(packet.title, '测试对话');
    assert.equal(packet.turns.length, 1);
    assert.equal(packet.turns[0].turn, 2);
    assert.match(packet.turns[0].user[0], /8899/);
    assert.ok(packet.userTexts.some((text) => /8899/.test(text)));
    assert.ok(packet.existingEntries.length > 0);
    assert.ok(packet.hints.some((hint) => hint.kind === 'explicit'));
  } finally {
    cleanup();
  }
});

test('regex hints are hints only and keep exact text', () => {
  const hints = regexHints('以后别再写小作文。这个报错是 ENOENT。');
  assert.ok(hints.some((hint) => hint.kind === 'rule' && hint.text.includes('别再写小作文')));
  assert.ok(hints.some((hint) => hint.kind === 'pitfall' && hint.text.includes('ENOENT')));
});

test('model prompt contains the schema and scope', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const { settings } = readSettings(dir);
    const packet = buildConsolidationPacket(fakeSession(eventsForTurns()), {
      root: dir, fromTurn: 0, toTurn: 2, scopeProjects: ['']
    });
    const prompt = buildConsolidationPrompt(packet, settings);
    assert.match(prompt.system, /actions/);
    assert.match(prompt.system, /quote/);
    assert.match(prompt.user, /允许项目/);
    assert.match(prompt.user, /8899/);
  } finally {
    cleanup();
  }
});

test('validates quote exactness, scope, and dangerous output', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const { settings } = readSettings(dir);
    const packet = buildConsolidationPacket(fakeSession(eventsForTurns()), {
      root: dir, fromTurn: 0, toTurn: 2, scopeProjects: ['']
    });
    const good = validateConsolidation([
      { op: 'create', category: 'facts', title: 'usage 端口', content: '8899 端口是 usage 面板', source: 'summary', importance: 3, project: '' },
      { op: 'skip', reason: '其余是过程' }
    ], packet, settings);
    assert.equal(good.ok, true);
    assert.equal(good.actions.length, 2);

    const badQuote = validateConsolidation([
      { op: 'create', category: 'rules', title: '假原话', content: '这不是原文', source: 'quote', importance: 4, project: '' }
    ], packet, settings);
    assert.equal(badQuote.ok, false);
    assert.ok(badQuote.errors.some((e) => /原文子串/.test(e)));

    const badScope = validateConsolidation([
      { op: 'create', category: 'facts', title: '别的项目', content: 'x', source: 'summary', importance: 2, project: 'other' }
    ], packet, settings);
    assert.equal(badScope.ok, false);
    assert.ok(badScope.errors.some((e) => /项目不在/.test(e)));

    const badSecret = validateConsolidation([
      { op: 'create', category: 'facts', title: 'key', content: 'api_key = sk-1234567890abcdef', source: 'summary', importance: 2, project: '' }
    ], packet, settings);
    assert.equal(badSecret.ok, false);
  } finally {
    cleanup();
  }
});

test('applies create/update/merge/skip and locks quote body', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const { settings } = readSettings(dir);
    const packet = buildConsolidationPacket(fakeSession(eventsForTurns()), {
      root: dir, fromTurn: 0, toTurn: 2, scopeProjects: ['']
    });
    const first = createEntry(dir, { category: 'facts', title: '端口一', content: '端口 1111 用于测试', source: 'summary', importance: 2 });
    const second = createEntry(dir, { category: 'facts', title: '端口二', content: '端口 2222 用于备用', source: 'summary', importance: 2 });
    assert.ok(first.ok && second.ok);
    const quote = loadStore(dir).entries.find((entry) => entry.source === 'quote');
    const validation = validateConsolidation([
      { op: 'create', category: 'facts', title: '新事实', content: '整理写入的新事实', source: 'summary', importance: 3, project: '' },
      { op: 'update', id: quote.id, patch: { content: '改原话' }, reason: '不该允许' },
      { op: 'merge', ids: [first.entry.id, second.entry.id], title: '端口合并', content: '端口 1111/2222', source: 'summary', importance: 3, project: '' },
      { op: 'skip', reason: '过程' }
    ], packet, settings);
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.some((e) => /原话正文不能改/.test(e)));
    const accepted = validation.actions.filter((action) => action.op !== 'update');
    const applied = applyConsolidation(dir, accepted, { actor: '测试' });
    assert.equal(applied.errors.length, 0);
    assert.ok(applied.wrote >= 2);
    assert.equal(applied.merged, 1);
    const after = loadStore(dir);
    assert.ok(after.entries.some((entry) => entry.title === '新事实'));
    assert.ok(after.entries.some((entry) => entry.id === first.entry.id && entry.status === 'active'));
    assert.ok(after.entries.some((entry) => entry.id === second.entry.id && entry.status === 'archived'));
  } finally {
    cleanup();
  }
});

test('consolidation cursor survives reads and reaches due', () => {
  const { dir, cleanup } = tempCopy();
  try {
    recordConsolidation(dir, 'session-test', { turn: 25, ok: true, result: { wrote: 1 } });
    const state = readConsolidation(dir);
    assert.equal(state.sessions['session-test'].lastTurn, 25);
    assert.equal(consolidationStatus(dir, { sid: 'session-test', everyTurns: 25, turn: 30 }).dueIn, 20);
    recordConsolidation(dir, 'session-test', { turn: 50, ok: false, result: { ok: false, error: 'x' } });
    const status = consolidationStatus(dir, { sid: 'session-test', everyTurns: 25, turn: 50 });
    assert.equal(status.lastTurn, 50);
    assert.equal(status.lastOkTurn, 25);
  } finally {
    cleanup();
  }
});

test('parses fenced and plain JSON', () => {
  assert.deepEqual(parseModelJson('```json\n{"actions":[]}\n```'), { actions: [] });
  assert.deepEqual(parseModelJson('前言 {"actions":[]} 后记'), { actions: [] });
  assert.equal(parseModelJson('not json'), null);
});
