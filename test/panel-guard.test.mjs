// test/panel-guard.test.mjs — 面板入口护栏：来源校验与有界读取。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { checkOrigin, hostnameOf, preflight, readBodyLimited } from '../lib/panel/guard.mjs';

function fakeReq({ headers = {}, chunks = [] } = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  setImmediate(() => {
    for (const c of chunks) req.emit('data', Buffer.from(c));
    req.emit('end');
  });
  return req;
}

test('没有 Origin 头（curl / CLI / 同源导航）放行', () => {
  assert.equal(checkOrigin({}).ok, true);
  assert.equal(checkOrigin({ host: '127.0.0.1:59453' }).ok, true);
});

test('Origin: null（file:// / 沙箱 iframe）放行', () => {
  assert.equal(checkOrigin({ origin: 'null' }).ok, true);
});

test('桌面自带协议放行', () => {
  assert.equal(checkOrigin({ origin: 'dsh-app://app' }).ok, true);
  assert.equal(checkOrigin({ origin: 'file://' }).ok, true);
});

test('本机回环来源放行', () => {
  assert.equal(checkOrigin({ origin: 'http://127.0.0.1:59453', host: '127.0.0.1:59453' }).ok, true);
  assert.equal(checkOrigin({ origin: 'http://localhost:3000', host: 'localhost:3000' }).ok, true);
  assert.equal(checkOrigin({ origin: 'http://[::1]:8080', host: '[::1]:8080' }).ok, true);
});

test('远程访问时同源放行（不硬卡 Host，避免挡掉远程面板）', () => {
  assert.equal(checkOrigin({ origin: 'http://192.168.1.5:59453', host: '192.168.1.5:59453' }).ok, true);
  assert.equal(checkOrigin({ origin: 'https://dsh.example.com', host: 'dsh.example.com' }).ok, true);
});

test('跨来源请求被拒（CSRF 主路径）', () => {
  const r = checkOrigin({ origin: 'https://evil.example', host: '127.0.0.1:59453' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cross-origin');
});

test('畸形 Origin 被拒', () => {
  const r = checkOrigin({ origin: 'javascript:alert(1)' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-origin');
});

test('preflight 把拒绝翻成 403 响应体', () => {
  assert.equal(preflight({ host: '127.0.0.1:1' }), null);
  const blocked = preflight({ origin: 'https://evil.example', host: '127.0.0.1:1' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.ok, false);
  assert.equal(blocked.body.error, 'cross-origin');
});

test('hostnameOf 去掉端口并小写', () => {
  assert.equal(hostnameOf('127.0.0.1:59453'), '127.0.0.1');
  assert.equal(hostnameOf('LocalHost:80'), 'localhost');
  assert.equal(hostnameOf(''), '');
});

test('readBodyLimited 正常读取', async () => {
  const body = await readBodyLimited(fakeReq({ chunks: ['{"a":', '1}'] }), 1024);
  assert.equal(body, '{"a":1}');
});

test('readBodyLimited 超过上限抛 BODY_TOO_LARGE', async () => {
  await assert.rejects(
    () => readBodyLimited(fakeReq({ chunks: ['x'.repeat(64), 'y'.repeat(64)] }), 32),
    (e) => e.code === 'BODY_TOO_LARGE'
  );
});
