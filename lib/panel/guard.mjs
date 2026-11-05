// lib/panel/guard.mjs — 面板 HTTP 入口的通用护栏。
//
// 为什么需要：面板接口能 write/archive/revoke/rollback，而它挂在 DSH 的同源 webServer
// 上、也能被 lib/panel/server.mjs 起成本机独立服务。任何浏览器页面都可以向
// http://127.0.0.1:<port>/workmem/panel/write 发一个「简单请求」（表单或 text/plain，
// 不触发预检），从而在用户不知情时改写记忆库。加一层 Origin 校验即可挡掉跨站提交，
// 同时不影响：同源页面、DSH 桌面（dsh-app:// / file://）、curl/CLI（无 Origin 头）。
//
// 故意不做 Host 白名单：ds-harness-remote / dsh-pocket 这类方案会让面板从局域网地址
// 访问，硬卡 Host 会把正常用法一起挡掉。Origin 校验已经覆盖「攻击者页面在自己浏览器里
// 向 127.0.0.1 发请求」这条主要路径。

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', '0.0.0.0']);
const SAFE_PROTOCOLS = new Set(['dsh-app:', 'file:', 'app:', 'chrome-extension:']);

/** 从 Host 头里取出主机名（去掉端口、去方括号归一）。 */
export function hostnameOf(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const noPort = raw.replace(/:\d+$/, '');
  return noPort;
}

function isLoopback(name) {
  return LOOPBACK.has(String(name ?? '').toLowerCase());
}

/**
 * 校验一次面板请求的来源。
 * 返回 { ok: true } 或 { ok: false, reason }。
 * 规则：没有 Origin（curl / CLI / 同源导航）→ 放行；Origin 是本地协议或本地主机 → 放行；
 * Origin 与请求的 Host 同源 → 放行；其余 → 拒绝。
 */
export function checkOrigin(headers = {}) {
  const origin = String(headers.origin ?? headers.Origin ?? '').trim();
  if (!origin) return { ok: true };
  if (origin === 'null') return { ok: true };

  let url = null;
  try {
    url = new URL(origin);
  } catch {
    return { ok: false, reason: 'bad-origin' };
  }
  if (SAFE_PROTOCOLS.has(url.protocol)) return { ok: true };
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'bad-origin' };

  const originHost = hostnameOf(url.host);
  if (isLoopback(originHost)) return { ok: true };

  const requestHost = hostnameOf(headers.host ?? headers.Host ?? '');
  if (requestHost && originHost === requestHost) return { ok: true };

  return { ok: false, reason: 'cross-origin' };
}

/** 读取请求体，超过 limit 字节直接失败（默认 1 MiB）。 */
export function readBodyLimited(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const stop = (fn, value) => {
      if (done) return;
      done = true;
      fn(value);
    };
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        stop(reject, Object.assign(new Error('body-too-large'), { code: 'BODY_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => stop(resolve, Buffer.concat(chunks).toString('utf8')));
    req.on('error', (e) => stop(reject, e));
  });
}

/** 面板入口统一前置检查：来源 + 方法。返回 null 表示放行。 */
export function preflight(headers, method = 'GET') {
  const origin = checkOrigin(headers);
  if (!origin.ok) return { status: 403, body: { ok: false, data: null, error: origin.reason, message: '面板拒绝了跨来源请求' } };
  return null;
}
