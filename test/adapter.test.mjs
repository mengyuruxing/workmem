import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempCopy } from './helpers.mjs';
import { apply } from '../lib/index.mjs';

function fakeCtx() {
  const tools = [];
  const routes = [];
  const handlers = {};
  const ctx = {
    logger: { info() {}, warn() {} },
    tools: { register(tool) { tools.push(tool); return () => {}; } },
    on(event, fn) { handlers[event] = fn; },
    inject(_names, cb) {
      cb({
        effect(fn) { fn(); },
        webServer: { register(spec) { routes.push(spec); return () => {}; } }
      });
    },
    get(name) { return name === 'session' ? { id: 'adapter-session' } : undefined; }
  };
  return { ctx, tools, routes, handlers };
}

test('adapter registers tools and panel route, and injects a hit', async () => {
  const { dir, cleanup } = tempCopy();
  const old = process.env.WORKMEM_HOME;
  process.env.WORKMEM_HOME = dir;
  try {
    const { ctx, tools, routes, handlers } = fakeCtx();
    apply(ctx);
    assert.equal(tools.length, 8);
    assert.ok(tools.some((t) => t.name === 'workmem_write'));
    assert.ok(routes.some((r) => r.path === '/workmem/panel' && r.kind === 'prefix'));
    assert.equal(typeof handlers['agent/pre-step'], 'function');

    const decision = {
      kind: 'enter',
      messages: [{
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: '改记忆库之前要做什么' }]
      }]
    };
    const out = await handlers['agent/pre-step']({
      agent: { session: { header: { id: 'adapter-session', cwd: 'E:/aiwork/apps/workmem' } } },
      signal: null
    }, async () => decision);
    assert.ok(Array.isArray(out.messages));
    const injected = out.messages.find((m) => m.source?.kind === 'plugin:workmem' && m.source?.form === 'snapshot');
    assert.ok(injected, 'expected a workmem snapshot');
    assert.match(injected.content[0].text, /长期记忆/);
    assert.match(injected.content[0].text, /我需要|记忆库|备份/);
  } finally {
    if (old === undefined) delete process.env.WORKMEM_HOME;
    else process.env.WORKMEM_HOME = old;
    cleanup();
  }
});
