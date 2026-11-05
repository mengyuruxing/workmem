import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../lib/core/settings.mjs';
import { MODE, modeLabel, modeHint, modeOrder, categoryWeight, resolveMode } from '../lib/core/mode.mjs';
import { canAutoWrite, classifyTurnKind, explicitRemember, isPitfall, policyHint } from '../lib/core/policy.mjs';
import { DEFAULT_WEIGHTS } from '../lib/core/weights.mjs';

test('只有一种读法：无论传什么都是 work', () => {
  assert.equal(MODE, 'work');
  assert.equal(modeLabel(), '干活');
  assert.equal(modeHint(), '〔本轮读法：干活〕');
  assert.equal(resolveMode({ text: '陪我聊聊，今天好累' }).mode, 'work');
  assert.equal(resolveMode({ text: '帮我把插件装好' }).mode, 'work');
  assert.equal(resolveMode({ settings: { mode: { locked: true, default: 'companion' } }, aiOverride: 'companion' }).mode, 'work');
});

test('权重只剩 work 一列，顺序按矩阵值排', () => {
  const order = modeOrder(DEFAULT_WEIGHTS);
  assert.equal(order[0].category, 'rules');
  assert.equal(order[order.length - 1].category, 'progress');
  assert.equal(categoryWeight(DEFAULT_WEIGHTS, 'rules'), 2);
  // 旧的 companion 列已不存在，取值必须等于 work 列。
  assert.equal(categoryWeight(DEFAULT_WEIGHTS, 'progress'), 1);
});

test('turn kinds: task, tell, chat and explicit remember', () => {
  assert.equal(classifyTurnKind('帮我把插件装好').kind, 'task');
  assert.equal(classifyTurnKind('我决定以后都用 pnpm').kind, 'tell');
  assert.equal(classifyTurnKind('今天好累').kind, 'chat');
  assert.equal(explicitRemember('记一下这个端口'), true);
  assert.equal(explicitRemember('今天好累'), false);
});

test('task turns only allow pitfalls; explicit and manual bypass', () => {
  assert.equal(canAutoWrite({ turnKind: 'task', category: 'facts' }).ok, false);
  assert.equal(canAutoWrite({ turnKind: 'task', category: 'pitfalls' }).ok, true);
  assert.equal(canAutoWrite({ turnKind: 'task', category: 'facts', explicit: true }).ok, true);
  assert.equal(canAutoWrite({ turnKind: 'tell', category: 'facts' }).ok, true);
  assert.match(policyHint('task'), /只记踩到的坑/);
});

test('pitfall detector catches errors and workarounds', () => {
  assert.equal(isPitfall('pnpm 报错 EACCES，权限不足'), true);
  assert.equal(isPitfall('安装失败，只能加 allowBuilds 绕过'), true);
  assert.equal(isPitfall('今天进展顺利'), false);
});

test('设置里的模式块被强制收口成固定值', () => {
  assert.equal(DEFAULT_SETTINGS.mode.default, 'work');
  assert.equal(DEFAULT_SETTINGS.mode.fallback, 'work');
  assert.equal(DEFAULT_SETTINGS.mode.locked, true);
  assert.deepEqual(DEFAULT_SETTINGS.retrieval.baseline.modes, ['work']);
});
