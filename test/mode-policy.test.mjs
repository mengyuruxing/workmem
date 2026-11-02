import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../lib/core/settings.mjs';
import { classifyTurn, resolveMode, setAuto, setManual, modeOrder } from '../lib/core/mode.mjs';
import { canAutoWrite, classifyTurnKind, explicitRemember, isPitfall, policyHint } from '../lib/core/policy.mjs';
import { DEFAULT_WEIGHTS } from '../lib/core/weights.mjs';

test('classifies work, companion and ambiguous turns', () => {
  assert.equal(classifyTurn('帮我把插件装好，路径是 E:\\aiwork').mode, 'work');
  assert.equal(classifyTurn('陪我聊聊，今天好累').mode, 'companion');
  assert.equal(classifyTurn('今天天气').mode, 'mixed');
  assert.ok(classifyTurn('帮我把插件装好').confidence > 0.3);
});

test('first auto turn uses suggestion, later switches need two', () => {
  const first = resolveMode({ settings: DEFAULT_SETTINGS, session: {}, text: '帮我把插件装好' });
  assert.equal(first.mode, 'work');
  assert.equal(first.source, 'auto');
  const second = resolveMode({ settings: DEFAULT_SETTINGS, session: first.session, text: '陪我聊聊，今天好累' });
  assert.equal(second.mode, 'work');
  assert.equal(second.session.pendingMode, 'companion');
  const third = resolveMode({ settings: DEFAULT_SETTINGS, session: second.session, text: '陪我聊聊，今天好累' });
  assert.equal(third.mode, 'companion');
});

test('manual lock beats auto and AI', () => {
  const locked = setManual(DEFAULT_SETTINGS, 'work');
  const result = resolveMode({ settings: locked, session: {}, text: '陪我聊聊', aiOverride: 'companion' });
  assert.equal(result.mode, 'work');
  assert.equal(result.source, 'manual');
  const auto = setAuto(locked);
  assert.equal(auto.mode.locked, false);
  assert.equal(auto.mode.default, 'auto');
});

test('AI override wins when not manually locked', () => {
  const result = resolveMode({ settings: DEFAULT_SETTINGS, session: {}, text: '帮我把插件装好', aiOverride: 'companion' });
  assert.equal(result.mode, 'companion');
  assert.equal(result.source, 'ai');
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

test('mode order reflects the weight matrix', () => {
  const order = modeOrder(DEFAULT_WEIGHTS, 'work');
  assert.equal(order[0].category, 'rules');
  assert.equal(order[order.length - 1].category, 'persona');
});
