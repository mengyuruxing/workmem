// lib/dsh/index.mjs — DSH 宿主适配：检索注入、工具注册、面板路由。
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { initStore } from '../core/store.mjs';
import { readSettings } from '../core/settings.mjs';
import { pickBaseline, searchStore } from '../core/index.mjs';
import { resolveMode } from '../core/mode.mjs';
import { classifyTurnKind, policyHint } from '../core/policy.mjs';
import { renderInjection } from '../core/inject.mjs';
import { appendEvent } from '../core/events.mjs';
import { bump } from '../core/stats.mjs';
import { maybeSweepCold } from '../core/lifecycle.mjs';
import { handlePanelRequest } from '../panel/api.mjs';
import { preflight, readBodyLimited } from '../panel/guard.mjs';
import { createTools } from './tools.mjs';
import { createConsolidationRuntime } from './consolidation.mjs';

export const name = 'workmem';
// 2026-11-02：原来是 []，导致 apply() 里读 ctx.tools 直接抛
// `cannot get property "tools" without inject`（plugin.log 实证），
// 8 个工具一个都注册不上。宿主对服务访问是"必须先在 inject 里声明"才给。
// 参考插件 dsh-purge 也是这么写的：export const inject = ["systemPrompt", "tools"]。
// 这里只声明 tools —— 提示词注入走的是事件钩子（pre-step），不需要 systemPrompt 服务，
// 声明了反而多一层依赖风险。
export const inject = ["tools"];

const PLUGIN_KIND = 'plugin:workmem';
const PKG_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PANEL_DIR = join(PKG_DIR, 'panel');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function dataRoot() {
  return process.env.WORKMEM_HOME || 'E:/aiwork/data/workmem';
}

function textOf(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) return message.content.map((x) => x?.text || '').join('\n');
  return '';
}

function projectOf(cwd) {
  try { return basename(String(cwd || '')); } catch { return ''; }
}

function isNoise(text) {
  return /^Current runtime context/i.test(text) ||
    /^This snapshot supersedes earlier runtime-context/i.test(text) ||
    /^<system-reminder>/i.test(text);
}

function snapshotMessage(text, ids) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: PLUGIN_KIND,
      form: 'snapshot',
      sections: [
        { name: '__meta__', text: JSON.stringify({ kind: 'hit', ids }) },
        { name: '长期记忆', text }
      ]
    }
  });
}

function readBody(req) {
  // 用 guard 里的有界读取：原来这里把整个请求体拼成字符串，一个超大 POST 就能把进程
  // 内存吃干净；面板只收 JSON，1 MiB 足够。
  return readBodyLimited(req).then(
    (raw) => {
      if (String(raw).trim() === '') return {};
      try { return JSON.parse(raw); } catch { return {}; }
    },
    () => ({})
  );
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function serveStatic(res, pathname) {
  let rel = pathname;
  if (rel.startsWith('/workmem/panel')) rel = rel.slice('/workmem/panel'.length);
  rel = rel.replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  const file = resolve(PANEL_DIR, rel);
  if (!file.startsWith(resolve(PANEL_DIR) + sep)) {
    res.statusCode = 403; res.end('forbidden'); return;
  }
  try {
    const body = readFileSync(file);
    res.statusCode = 200;
    res.setHeader('content-type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(body);
  } catch {
    res.statusCode = 404; res.end('not found');
  }
}

export function apply(ctx) {
  const root = dataRoot();
  // 2026-11-02 加：同时写一份文件日志。ctx.logger 的输出在桌面端落不到任何可见文件，
  // 排查"工具到底注册上没有"时全靠猜；写文件后每次启动都有据可查。
  const pluginLogFile = (() => {
    try {
      const dir = `${root}/_logs`;
      mkdirSync(dir, { recursive: true });
      return `${dir}/plugin.log`;
    } catch { return null; }
  })();
  const line = (msg) => {
    try { ctx.logger?.info?.('workmem: ' + msg); } catch {}
    try {
      if (pluginLogFile) {
        const st = Date.now();
        appendFileSync(pluginLogFile, `[${new Date(st).toISOString()}] ${msg}\n`, 'utf8');
      }
    } catch {}
  };

  try {
    initStore(root);
  } catch (e) {
    line('init failed: ' + String(e?.message || e));
  }

  const sessions = new Map();
  let lastSid = 'default';
  function stateFor(sid) {
    if (!sessions.has(sid)) sessions.set(sid, {
      modeSession: {}, aiOverride: null, recent: [], kind: 'chat', explicit: false, subagent: false,
      title: '', cwd: '', agent: null, turn: 0, projects: new Set(), consolidating: null, lastConsolidation: null
    });
    return sessions.get(sid);
  }
  function currentSid() {
    try { return ctx.get?.('session')?.id ?? lastSid; } catch { return lastSid; }
  }
  const consolidation = createConsolidationRuntime({ ctx, root, stateFor, currentSid, projectOf, line });

  // ---- 检索注入 ----
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('agent/pre-step', async ({ agent, signal, turn }, next) => {
        const decision = await next();
        try {
          if (!decision || decision.kind !== 'enter' || signal?.aborted) return decision;
          if (agent?.session?.header?.origin === 'subagent') {
            const subSid = agent?.session?.header?.id ?? 'default';
            stateFor(subSid).subagent = true;
            return decision;
          }
          const ws = agent?.session?.header?.cwd;
          if (typeof ws !== 'string' || ws === '') return decision;

          const messages = Array.isArray(decision.messages) ? decision.messages : [];
          const lastUser = [...messages].reverse().find((m) => {
            if (!m || m.role !== 'user' || m.source?.kind === PLUGIN_KIND) return false;
            const text = textOf(m).trim();
            return text !== '' && !isNoise(text);
          });
          if (!lastUser) return decision;
          const text = textOf(lastUser).slice(0, 500);

          const sid = agent?.session?.header?.id ?? 'default';
          lastSid = sid;
          const sidShort = String(sid).replace(/^session-/, '').slice(0, 8) || 'default';
          const st = stateFor(sid);
          st.agent = agent;
          st.cwd = ws;
          st.turn = Math.max(st.turn || 0, Math.floor(Number(turn) || 0));
          const { settings } = readSettings(root);
          const modeResult = resolveMode({
            settings,
            session: st.modeSession,
            aiOverride: st.aiOverride,
            text
          });
          st.modeSession = modeResult.session;
          st.aiOverride = null;
          const kindInfo = classifyTurnKind(text);
          st.kind = kindInfo.kind;
          st.explicit = kindInfo.explicit;
          st.text = text;

          try { maybeSweepCold(root, { now: Date.now() }); } catch {}

          const t0 = Date.now();
          const result = searchStore(root, text, {
            mode: modeResult.mode,
            currentProject: projectOf(ws),
            recentIds: st.recent,
            now: Date.now()
          });
          const picks = result.picks || [];
          const baseline = pickBaseline(result.context, {
            mode: modeResult.mode,
            currentProject: projectOf(ws)
          });
          const seenIds = new Set();
          const allPicks = [...baseline, ...picks].filter((pick) => {
            const id = pick?.entry?.id;
            if (!id || seenIds.has(id)) return false;
            seenIds.add(id);
            return true;
          });
          const ms = Date.now() - t0;

          let out = decision;
          if (allPicks.length > 0) {
            const ids = allPicks.map((p) => p.entry.id);
            const injection = renderInjection(allPicks, {
              mode: modeResult.mode,
              maxChars: settings.retrieval.budgetChars,
              baselineMaxChars: settings.retrieval.baseline.maxChars,
              hint: policyHint(kindInfo.kind)
            });
            const kept = messages.filter((m) => !(m?.source?.kind === PLUGIN_KIND && m?.source?.form === 'snapshot'));
            const at = kept.indexOf(lastUser);
            if (at >= 0 && injection) {
              const rewritten = [...kept];
              rewritten.splice(at, 0, snapshotMessage(injection, ids));
              out = { ...decision, messages: rewritten };
            }
            st.recent = [...picks.map((p) => p.entry.id), ...(st.recent || [])].slice(0, 6);
            for (const pick of picks) {
              try { bump(root, pick.entry.id, 'hit'); } catch {}
            }
          }

          try {
            appendEvent(root, {
              type: 'turn',
              sid: sidShort,
              mode: modeResult.mode,
              modeSource: modeResult.source,
              kind: kindInfo.kind,
              explicit: kindInfo.explicit,
              query: text.slice(0, 120),
              acted: allPicks.length ? 'injected' : 'none',
              baseline: baseline.map((p) => ({
                id: p.entry.id,
                category: p.entry.category,
                title: p.entry.title
              })),
              picked: picks.map((p) => ({
                id: p.entry.id,
                category: p.entry.category,
                title: p.entry.title,
                base: p.base,
                coverage: p.coverage,
                final: p.final,
                zone: p.zone,
                reason: p.reason,
                factors: p.factors
              })),
              missReason: allPicks.length ? null : (result.diagnostics?.reason ?? null),
              nearMiss: result.diagnostics?.nearMiss ?? [],
              threshold: result.diagnostics?.threshold ?? 0,
              pool: result.diagnostics?.pool ?? 0,
              ms
            });
          } catch {}

          if (allPicks.length) {
            line(modeResult.mode + ' inject ' + sidShort + ' ' + allPicks.map((p) => (p.baseline ? '保底:' : '') + p.entry.category + ':' + p.entry.title).join(' | '));
          }
          return out;
        } catch (e) {
          line('pre-step failed (fail-open): ' + String(e?.message || e));
          return decision;
        }
      });
    }
  } catch (e) {
    line('pre-step skipped: ' + String(e?.message || e));
  }

  // ---- 整理自动触发 ----
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('session/event', (session, event) => {
        try { consolidation.onSessionEvent(session, event); } catch (e) { line('consolidate hook failed: ' + String(e?.message || e)); }
      });
    }
  } catch (e) {
    line('consolidate hook skipped: ' + String(e?.message || e));
  }

  // ---- 工具 ----
  // 注意：本插件不像 purge 那样在 inject 里声明 tools 依赖（声明了万一服务名不符，
  // 整个插件连注入都会一起不加载，代价太大）。所以这里先试现成的 ctx.tools，
  // 拿不到就退到 ctx.inject(['tools'], ...) 延迟注册——只要服务后到也能挂上。
  try {
    const toolsReady = ctx.tools && typeof ctx.tools.register === 'function';
    let toolsTarget = toolsReady ? ctx : null;
    if (!toolsReady && typeof ctx.inject === 'function') {
      ctx.inject(['tools'], (scoped) => {
        try {
          if (scoped.tools && typeof scoped.tools.register === 'function') registerScoped(scoped);
          else line('tools skipped: injected ctx has no tools.register');
        } catch (e) { line('tools inject failed: ' + String(e?.message || e)); }
      });
    } else if (!toolsReady) {
      line('tools skipped: no ctx.tools.register');
    }
    function registerScoped(target) {
      const tools = createTools({
        root,
        getSession: () => {
          const sid = currentSid();
          const st = sessions.get(sid) || {};
          let subagent = Boolean(st.subagent);
          try { subagent = subagent || ctx.get?.('session')?.header?.origin === 'subagent'; } catch {}
          return { id: sid, kind: st.kind || 'chat', explicit: Boolean(st.explicit), subagent };
        },
        setAiMode: (mode) => {
          const st = stateFor(currentSid());
          st.aiOverride = mode;
        },
        onProjectTouched: (project) => {
          try { consolidation.noteProject(currentSid(), project); } catch {}
        }
      });
      let okCount = 0;
      for (const tool of tools) {
        try {
          // 宿主 tools.register() 强制要求 output { schema, render }，缺一个就抛
          // TypeError(`tool "x" must declare output { schema, render, presentationMeta? }`)。
          // tools.mjs 里那 8 个工具原来只有 parameters + execute，所以 8 个全被拒、
          // 一个都没进工具表——2026-11-02 在 dsh-tools/lib/index.js:2974 register() 里查到。
          // 这里统一补一个宽松的文本 output，不动工具本身的业务逻辑。
          const def = tool.output && typeof tool.output.render === 'function' ? tool : {
            ...tool,
            output: {
              schema: { type: 'object', additionalProperties: true, properties: {} },
              render: (_args, value) => [{
                type: 'text',
                text: typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
              }]
            }
          };
          const dispose = target.tools.register(def);
          if (typeof dispose === 'function' && typeof ctx.effect === 'function') ctx.effect(() => dispose, 'workmem: tool ' + tool.name);
          okCount += 1;
        } catch (e) {
          line('tool register failed ' + tool.name + ': ' + String(e?.message || e));
        }
      }
      line('tools registered: ' + okCount + '/' + tools.length);
    }
    if (toolsTarget) registerScoped(toolsTarget);
  } catch (e) {
    line('tools failed: ' + String(e?.message || e));
  }

  // ---- 面板 ----
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (scoped) => {
        scoped.effect(() => scoped.webServer.register({
          kind: 'prefix',
          path: '/workmem/panel',
          handler: async (req, res) => {
            try {
              const blocked = preflight(req.headers, req.method);
              if (blocked) { sendJson(res, blocked.status, blocked.body); return; }
              const url = new URL(req.url || '/', 'http://workmem.local');
              const pathname = url.pathname;
              const staticFile = pathname === '/' || pathname === '/workmem/panel' || pathname === '/workmem/panel/' || /\.[a-z0-9]+$/i.test(pathname);
              if (staticFile) { serveStatic(res, pathname); return; }
              const body = req.method === 'POST' ? await readBody(req) : null;
              const out = await handlePanelRequest(root, {
                method: req.method,
                url: req.url,
                body,
                consolidate: (input) => consolidation.run(currentSid(), { trigger: 'manual', turn: stateFor(currentSid()).turn }),
                consolidationInfo: () => consolidation.info()
              });
              sendJson(res, out.status, out.body);
            } catch (e) {
              sendJson(res, 500, { ok: false, data: null, error: 'exception', message: String(e?.message || e) });
            }
          }
        }), 'workmem: panel route');
      });
    } else {
      line('panel skipped: no ctx.inject');
    }
  } catch (e) {
    line('panel failed: ' + String(e?.message || e));
  }

  line('plugin ready root=' + root);
}
