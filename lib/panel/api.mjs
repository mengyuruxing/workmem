// lib/panel/api.mjs — 面板 JSON 接口。纯函数：传入 method/url/body，返回 {status, body}。
import { readSettings, writeSettings } from '../core/settings.mjs';
import { readWeights, writeWeights, setCell } from '../core/weights.mjs';
import { modeLabel } from '../core/mode.mjs';
import { createEntry, setStatus, updateEntry } from '../core/mutations.mjs';
import { createSnapshot, rollback } from '../core/snapshot.mjs';
import { computeHealth } from '../core/health.mjs';
import { bump } from '../core/stats.mjs';
import { appendAudit } from '../core/audit.mjs';
import { appendEvent } from '../core/events.mjs';
import { detailView, diagnosticsView, listView, searchView, sessionsView, snapshotsView, statsView, timelineView, weightsView } from '../core/view.mjs';

const PREFIX = '/workmem/panel';

function ok(data) {
  return { status: 200, body: { ok: true, data, error: null } };
}

function fail(status, error, message) {
  return { status, body: { ok: false, data: null, error, message } };
}

// 只有工作模式，q.mode 一律忽略（不再能靠参数切读法）。
function currentMode() {
  return 'work';
}

function parseBody(body) {
  if (body == null) return {};
  if (typeof body === 'string') {
    if (body.trim() === '') return {};
    return JSON.parse(body);
  }
  return body;
}

export async function handlePanelRequest(root, { method = 'GET', url = '/', body = null, consolidate = null, consolidationInfo = null } = {}) {
  try {
    const u = new URL(url, 'http://workmem.local');
    let path = u.pathname;
    if (path.startsWith(PREFIX)) path = path.slice(PREFIX.length) || '/';
    const q = Object.fromEntries(u.searchParams.entries());
    const m = String(method).toUpperCase();

    if (m === 'GET') {
      if (path === '/stats') return ok(statsView(root, { mode: currentMode() }));
      if (path === '/sessions') return ok(sessionsView(root, { limit: Number(q.limit) || 200 }));
      if (path === '/list') {
        return ok(listView(root, {
          category: q.category || 'all',
          status: q.status || 'active',
          cold: q.cold || 'all',
          project: q.project || '',
          source: q.source || '',
          q: q.q || '',
          mode: currentMode(),
          limit: Number(q.limit) || 200
        }));
      }
      if (path === '/search') {
        const data = searchView(root, q.q || '', {
          mode: currentMode(),
          limit: Number(q.limit) || 50,
          status: q.status || 'active'
        });
        try {
          if (data.query) {
            appendEvent(root, {
              type: 'manual-search',
              query: data.query,
              mode: data.mode,
              count: data.total,
              ids: data.items.map((x) => x.id),
              items: data.items.map((x) => ({ id: x.id, category: x.category, score: x.score, reason: x.reason, coverage: x.coverage })),
              reason: data.diagnostics?.reason ?? null
            });
          }
        } catch {}
        return ok(data);
      }
      if (path === '/detail') {
        if (!q.id) return fail(400, 'missing-id', '缺少 id');
        try { bump(root, q.id, 'view'); } catch {}
        const data = detailView(root, q.id, { mode: currentMode() });
        return data ? ok(data) : fail(404, 'not-found', '没有这条记忆');
      }
      if (path === '/timeline') return ok(timelineView(root, { limit: Number(q.limit) || 50 }));
      if (path === '/diagnostics') return ok(diagnosticsView(root, { limit: Number(q.limit) || 30 }));
      if (path === '/weights') return ok(weightsView(root, { mode: currentMode() }));
      if (path === '/snapshots') return ok(snapshotsView(root));
      if (path === '/health') return ok(computeHealth(root));
      if (path === '/consolidation') {
        const info = typeof consolidationInfo === 'function' ? consolidationInfo() : null;
        if (!info) return fail(503, 'no-consolidate', '整理接口未加载');
        return ok(info);
      }
      if (path === '/mode') {
        return ok({
          locked: true,
          default: 'work',
          fallback: 'work',
          labels: { work: modeLabel('work') }
        });
      }
      return fail(404, 'not-found', '未知接口：' + path);
    }

    if (m === 'POST') {
      const input = parseBody(body);

      if (path === '/write') {
        const actor = input.actor || '主人';
        const result = input.id
          ? updateEntry(root, input.id, input, { actor, note: input.note || '面板编辑' })
          : createEntry(root, input, { actor, note: input.note || '面板新建' });
        return result.ok ? ok({ id: result.entry?.id, merged: Boolean(result.merged), changed: result.changed ?? null, warnings: result.warnings ?? [] }) : fail(400, result.error, result.message);
      }

      if (path === '/archive' || path === '/revoke' || path === '/restore') {
        if (!input.id) return fail(400, 'missing-id', '缺少 id');
        const status = path === '/archive' ? 'archived' : path === '/revoke' ? 'revoked' : 'active';
        const result = setStatus(root, input.id, status, { actor: input.actor || '主人', note: input.note || '' });
        return result.ok ? ok({ id: input.id, status }) : fail(400, result.error, result.message);
      }

      if (path === '/weights') {
        const { category, level } = input;
        const { weights } = readWeights(root);
        let next;
        try { next = setCell(weights, category, 'work', level); } catch (e) {
          return fail(400, 'bad-cell', String(e?.message || e));
        }
        const before = weights.matrix?.[category]?.work;
        writeWeights(root, next);
        try {
          appendAudit(root, {
            actor: input.actor || '主人', action: 'weights', item_id: null, category: null,
            field: 'weights.' + category, before, after: level, note: input.note || '面板调整权重'
          });
        } catch {}
        return ok(weightsView(root, { mode: 'work' }));
      }

      if (path === '/mode') {
        // 模式固定，接口保留只为让老前端不 404；任何请求都回固定值，不改设置。
        return ok({
          locked: true,
          default: 'work',
          fallback: 'work',
          labels: { work: modeLabel('work') }
        });
      }

      if (path === '/consolidation') {
        const { settings } = readSettings(root);
        const next = structuredClone(settings);
        if (input.enabled !== undefined) next.consolidation.enabled = Boolean(input.enabled);
        if (input.everyTurns !== undefined) next.consolidation.everyTurns = Number(input.everyTurns);
        writeSettings(root, next);
        try {
          appendAudit(root, {
            actor: input.actor || '主人', action: 'consolidation', item_id: null, category: null,
            field: 'consolidation', before: null, after: { enabled: next.consolidation.enabled, everyTurns: next.consolidation.everyTurns },
            note: '面板调整整理设置'
          });
        } catch {}
        const info = typeof consolidationInfo === 'function' ? consolidationInfo() : null;
        return ok(info || { enabled: next.consolidation.enabled, everyTurns: next.consolidation.everyTurns });
      }

      if (path === '/consolidate') {
        if (typeof consolidate !== 'function') return fail(503, 'no-consolidate', '整理接口未加载');
        const result = await consolidate(input || {});
        return result && result.ok === false && result.error === 'running'
          ? fail(409, 'running', result.message || '这个对话正在整理')
          : ok(result);
      }

      if (path === '/snapshot') {
        const result = createSnapshot(root, { name: input.name, note: input.note || '面板快照' });
        return result.ok ? ok(result) : fail(400, result.error, result.message);
      }

      if (path === '/rollback') {
        if (!input.name) return fail(400, 'missing-name', '缺少快照名');
        const result = rollback(root, input.name, { actor: input.actor || '主人' });
        return result.ok ? ok(result) : fail(400, result.error, result.message);
      }

      return fail(404, 'not-found', '未知接口：' + path);
    }

    return fail(405, 'method-not-allowed', '不支持的方法：' + method);
  } catch (e) {
    return fail(500, 'exception', String(e?.message || e));
  }
}
