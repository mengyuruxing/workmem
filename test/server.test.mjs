import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempCopy } from './helpers.mjs';
import { startPanelServer } from '../lib/panel/server.mjs';

const panelDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'panel');

test('panel server serves static UI and JSON API on localhost', async () => {
  const { dir, cleanup } = tempCopy();
  const started = await startPanelServer(dir, { port: 0, panelDir });
  const base = started.url.replace(/\/$/, '');
  try {
    const html = await fetch(started.url);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /机忆/);

    // 旧的自绘前端已删除，界面由 DSH 客户端插件渲染。
    const js = await fetch(base + '/app.js');
    assert.equal(js.status, 404);

    const stats = await fetch(base + '/stats').then((r) => r.json());
    assert.equal(stats.ok, true);
    assert.equal(stats.data.total, 4);

    const created = await fetch(base + '/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'facts', title: 'HTTP 测试', content: '通过本地 HTTP 写入。', source: '总结' })
    }).then((r) => r.json());
    assert.equal(created.ok, true);
    assert.ok(created.data.id);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
    cleanup();
  }
});
