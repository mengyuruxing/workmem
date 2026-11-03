// lib/core/view.mjs — 面板/接口用的只读视图，不写文件。
import {
  CATEGORIES,
  CATEGORY_META,
  SOURCE_LABELS,
  STATUS_LABELS,
  entryValid
} from './entry.mjs';
import { findEntry, loadStore } from './store.mjs';
import { getStat, usesOf, zoneOf } from './stats.mjs';
import { factor, importanceFactor, orderOf } from './weights.mjs';
import { readSettings } from './settings.mjs';
import { loadSearchContext } from './index.mjs';
import { manualSearch, buildIndex } from './search.mjs';
import { readAudit } from './audit.mjs';
import { readEvents } from './events.mjs';
import { computeHealth } from './health.mjs';
import { modeLabel, modeOrder } from './mode.mjs';
import { listSnapshots } from './snapshot.mjs';
import { normalizeProject, parseTime } from './util.mjs';

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c, CATEGORY_META[c].title]));

function previewOf(content, max = 160) {
  const s = String(content ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function itemOf(entry, { stats, weights, settings, mode = 'work', now = Date.now(), score = null, factors = null, reason = null, coverage = null, run = null }) {
  const stat = getStat(stats, entry.id, entry);
  const zone = zoneOf(entry, stat, settings.coldDays, now);
  return {
    id: entry.id,
    category: entry.category,
    categoryLabel: CATEGORY_LABELS[entry.category] || entry.category,
    title: entry.title,
    content: entry.content,
    preview: previewOf(entry.content),
    source: entry.source,
    sourceLabel: SOURCE_LABELS[entry.source] || entry.source,
    status: entry.status,
    statusLabel: STATUS_LABELS[entry.status] || entry.status,
    importance: entry.importance,
    project: entry.project,
    session: entry.session ?? '',
    keywords: entry.keywords,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    quote_edited: entry.quote_edited,
    pinned: Boolean(entry.pinned),
    zone,
    hits: stat.hits,
    views: stat.views,
    uses: usesOf(stat),
    last_touched_at: stat.last_touched_at,
    weight: factor(weights, entry.category, mode),
    issues: entry.issues,
    score,
    factors,
    reason,
    coverage,
    run
  };
}

function matchesProject(entry, project) {
  const q = normalizeProject(project);
  if (!q) return true;
  const p = normalizeProject(entry.project);
  if (!p) return false;
  return p.split(',').map((x) => x.trim().toLowerCase()).includes(q.toLowerCase());
}

/** 列表 / 搜索。q 非空时用手动搜索（无门槛），否则按更新时间。 */
export function listView(root, {
  category = 'all',
  status = 'active',
  cold = 'all',
  project = '',
  source = '',
  q = '',
  mode = 'work',
  limit = 200,
  now = Date.now()
} = {}) {
  const ctx = loadSearchContext(root, { now });
  const { store, stats, weights, settings } = ctx;
  const wanted = String(q ?? '').trim();
  let rows;

  if (wanted) {
    const statuses = status === 'all' ? ['active', 'archived', 'revoked'] : [status];
    const index = statuses.length === 1 && statuses[0] === 'active'
      ? ctx.index
      : buildIndex(ctx.store.entries, { now, statuses });
    const result = manualSearch(index, wanted, {
      weights, stats, coldDays: settings.coldDays, mode, topK: Math.max(limit, 50), now
    });
    rows = result.picks.map((p) => itemOf(p.entry, {
      stats, weights, settings, mode, now, score: p.final, factors: p.factors, reason: p.reason, coverage: p.coverage, run: p.run
    }));
  } else {
    rows = store.entries.map((entry) => itemOf(entry, { stats, weights, settings, mode, now }));
  }

  rows = rows.filter((item) => {
    if (category !== 'all' && item.category !== category) return false;
    if (status !== 'all' && item.status !== status) return false;
    if (source && item.source !== source) return false;
    if (project && !matchesProject({ project: item.project }, project)) return false;
    if (cold === 'cold' && item.zone !== 'cold') return false;
    if (cold === 'hot' && item.zone !== 'hot') return false;
    return true;
  });

  if (!wanted) rows.sort((a, b) => (parseTime(b.updated_at) || 0) - (parseTime(a.updated_at) || 0));
  const total = rows.length;
  rows = rows.slice(0, Math.max(1, Number(limit) || 200));

  const counts = { all: store.entries.length, active: 0, archived: 0, revoked: 0, invalid: store.invalid.length, cold: 0, hot: 0, categories: {} };
  for (const categoryKey of CATEGORIES) counts.categories[categoryKey] = 0;
  for (const entry of store.entries) {
    counts.categories[entry.category] = (counts.categories[entry.category] || 0) + 1;
    counts[entry.status] = (counts[entry.status] || 0) + 1;
    if (entryValid(entry) && entry.status === 'active') {
      const stat = getStat(stats, entry.id, entry);
      if (zoneOf(entry, stat, settings.coldDays, now) === 'cold') counts.cold += 1;
      else counts.hot += 1;
    }
  }
  return { items: rows, total, returned: rows.length, counts, query: wanted, warnings: ctx.warnings };
}

export function searchView(root, q, { mode = 'work', limit = 50, now = Date.now(), status = 'active' } = {}) {
  const wanted = String(q ?? '').trim();
  if (!wanted) return { items: [], diagnostics: { reason: 'empty-query' }, query: '', mode, total: 0 };
  const ctx = loadSearchContext(root, { now });
  const statuses = status === 'all' ? ['active', 'archived', 'revoked'] : [status];
  const index = statuses.length === 1 && statuses[0] === 'active'
    ? ctx.index
    : buildIndex(ctx.store.entries, { now, statuses });
  const result = manualSearch(index, wanted, {
    weights: ctx.weights,
    stats: ctx.stats,
    coldDays: ctx.settings.coldDays,
    mode,
    topK: Math.max(1, Number(limit) || 50),
    now
  });
  const items = result.picks.map((p) => itemOf(p.entry, {
    stats: ctx.stats, weights: ctx.weights, settings: ctx.settings, mode, now, score: p.final, factors: p.factors, reason: p.reason, coverage: p.coverage, run: p.run
  }));
  return { items, diagnostics: result.diagnostics, query: wanted, mode, total: items.length, warnings: ctx.warnings, status };
}

export function detailView(root, id, { mode = 'work', now = Date.now() } = {}) {
  const found = findEntry(root, id);
  if (!found) return null;
  const ctx = loadSearchContext(root, { now });
  const { stats, weights, settings } = ctx;
  const item = itemOf(found.entry, { stats, weights, settings, mode, now });
  const stat = getStat(stats, found.entry.id, found.entry);
  return {
    entry: item,
    audit: readAudit(root, { itemId: found.entry.id, limit: 100 }),
    factors: {
      categoryWeight: factor(weights, found.entry.category, mode),
      importance: importanceFactor(weights, found.entry.importance),
      cold: zoneOf(found.entry, stat, settings.coldDays, now) === 'cold' ? weights.coldFactor : 1,
      zone: zoneOf(found.entry, stat, settings.coldDays, now)
    },
    mode: { key: mode, label: modeLabel(mode) },
    order: modeOrder(weights, mode)
  };
}

export function statsView(root, { mode = 'mixed', now = Date.now() } = {}) {
  const ctx = loadSearchContext(root, { now });
  const { store, stats, weights, settings } = ctx;
  const health = computeHealth(root, { now });
  const categories = {};
  for (const category of CATEGORIES) {
    const list = store.entries.filter((e) => e.category === category);
    categories[category] = {
      label: CATEGORY_META[category].title,
      file: CATEGORY_META[category].file,
      total: list.length,
      active: list.filter((e) => e.status === 'active').length,
      archived: list.filter((e) => e.status === 'archived').length,
      revoked: list.filter((e) => e.status === 'revoked').length,
      invalid: list.filter((e) => !entryValid(e)).length
    };
  }
  const active = store.entries.filter((e) => e.status === 'active' && entryValid(e));
  let cold = 0;
  for (const entry of active) {
    const stat = getStat(stats, entry.id, entry);
    if (zoneOf(entry, stat, settings.coldDays, now) === 'cold') cold += 1;
  }
  return {
    root,
    total: store.entries.length,
    active: active.length,
    archived: store.entries.filter((e) => e.status === 'archived').length,
    revoked: store.entries.filter((e) => e.status === 'revoked').length,
    invalid: store.invalid.length,
    cold,
    hot: Math.max(0, active.length - cold),
    categories,
    health,
    mode: {
      key: mode,
      label: modeLabel(mode),
      locked: Boolean(settings.mode.locked),
      default: settings.mode.default,
      fallback: settings.mode.fallback
    },
    coldDays: settings.coldDays,
    order: modeOrder(weights, mode),
    warnings: ctx.warnings
  };
}

export function timelineView(root, { limit = 50 } = {}) {
  const store = loadStore(root);
  const byId = new Map(store.entries.map((e) => [e.id, e]));
  const rows = [];

  for (const row of readAudit(root, { limit: 0 })) {
    const entry = row.item_id ? byId.get(row.item_id) : null;
    let type = row.action;
    if (row.action === 'update') type = 'edit';
    if (row.action === 'create') type = 'create';
    if (row.action === 'archive') type = 'archive';
    if (row.action === 'revoke') type = 'revoke';
    if (row.action === 'restore') type = 'restore';
    rows.push({
      ts: row.ts,
      type,
      actor: row.actor,
      item_id: row.item_id,
      title: entry?.title ?? row.note ?? '条目',
      category: row.category,
      categoryLabel: CATEGORY_LABELS[row.category] || row.category,
      detail: row.field ? row.field + '：' + String(row.after ?? '') : (row.note || ''),
      note: row.note || ''
    });
  }

  for (const row of readEvents(root, { limit: 0 })) {
    if (row.type === 'turn') {
      const picked = [...(Array.isArray(row.baseline) ? row.baseline : []), ...(Array.isArray(row.picked) ? row.picked : [])];
      rows.push({
        ts: row.ts,
        type: picked.length ? 'recall' : 'miss',
        actor: '小喵',
        item_id: picked[0]?.id ?? null,
        title: row.query || '（无查询）',
        category: null,
        categoryLabel: '',
        detail: picked.length
          ? picked.map((p) => p.id + ' ' + (p.category || '')).join(' · ')
          : (row.missReason || row.reason || '未命中'),
        note: row.mode || ''
      });
    } else if (row.type === 'manual-search') {
      rows.push({
        ts: row.ts,
        type: 'manual',
        actor: '主人',
        item_id: row.ids?.[0] ?? null,
        title: row.query || '（手动搜索）',
        category: null,
        categoryLabel: '',
        detail: (row.count ?? 0) + ' 条' + (row.ids?.length ? ' · ' + row.ids.join(' ') : ''),
        note: row.mode || ''
      });
    } else if (row.type === 'cold_sweep') {
      rows.push({
        ts: row.ts,
        type: 'cold',
        actor: '系统',
        item_id: null,
        title: '冷区 ' + (row.cold ?? 0) + ' 条',
        category: null,
        categoryLabel: '',
        detail: '新沉 ' + (row.newlyCold?.length ?? 0) + ' · 回热 ' + (row.revived?.length ?? 0),
        note: ''
      });
    } else if (row.type === 'snapshot' || row.type === 'rollback') {
      rows.push({
        ts: row.ts,
        type: row.type,
        actor: '小喵',
        item_id: null,
        title: row.name || '',
        category: null,
        categoryLabel: '',
        detail: row.safety ? '安全快照：' + row.safety : '',
        note: ''
      });
    } else if (row.type === 'consolidate') {
      rows.push({
        ts: row.ts,
        type: 'consolidate',
        actor: '小喵',
        item_id: row.ids?.[0] ?? null,
        title: (row.ok ? '整理完成' : '整理失败') + (row.trigger ? '（' + row.trigger + '）' : ''),
        category: null,
        categoryLabel: '',
        detail: '写入 ' + (row.wrote ?? 0) + ' · 合并 ' + (row.merged ?? 0) + ' · 跳过 ' + (row.skipped ?? 0) +
          (row.error ? ' · ' + row.error : ''),
        note: ''
      });
    } else if (row.type === 'write' && row.ok === false) {
      const entry = row.id ? byId.get(row.id) : null;
      rows.push({
        ts: row.ts,
        type: 'write-error',
        actor: row.actor || '小喵',
        item_id: row.id ?? null,
        title: entry?.title ?? '写入失败',
        category: row.category ?? null,
        categoryLabel: CATEGORY_LABELS[row.category] || '',
        detail: row.error || '',
        note: ''
      });
    }
  }

  rows.sort((a, b) => (parseTime(b.ts) || 0) - (parseTime(a.ts) || 0));
  return { items: rows.slice(0, Math.max(1, Number(limit) || 50)) };
}

export function weightsView(root, { mode = 'mixed' } = {}) {
  const ctx = loadSearchContext(root);
  const { weights, settings } = ctx;
  const levelLabel = { ignore: '忽略', low: '低', normal: '正常', high: '高', max: '最高' };
  const rows = CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_META[category].title,
    file: CATEGORY_META[category].file,
    cells: Object.fromEntries(['work', 'mixed', 'companion'].map((m) => {
      const level = weights.matrix[category][m];
      return [m, { level, value: weights.levels[level], label: levelLabel[level] }];
    }))
  }));
  return {
    rows,
    levels: Object.entries(levelLabel).map(([key, label]) => ({ key, label, value: weights.levels[key] })),
    modes: ['work', 'mixed', 'companion'].map((key) => ({ key, label: modeLabel(key) })),
    mode,
    modeLabel: modeLabel(mode),
    order: modeOrder(weights, mode),
    coldFactor: weights.coldFactor,
    importanceFactors: weights.importanceFactors,
    locked: Boolean(settings.mode.locked),
    default: settings.mode.default,
    fallback: settings.mode.fallback,
    warnings: ctx.warnings
  };
}

export function snapshotsView(root) {
  return { items: listSnapshots(root) };
}

export function diagnosticsView(root, { limit = 30, now = Date.now() } = {}) {
  const health = computeHealth(root, { now });
  const turns = readEvents(root, { type: 'turn', limit: 0 })
    .slice(-Math.max(1, Number(limit) || 30))
    .reverse()
    .map((row) => {
      const picked = [...(Array.isArray(row.baseline) ? row.baseline : []), ...(Array.isArray(row.picked) ? row.picked : [])];
      return {
        ts: row.ts,
        query: row.query || '',
        mode: row.mode || '',
        modeSource: row.modeSource || '',
        kind: row.kind || '',
        hit: picked.length > 0,
        hits: picked.map((p) => ({
          id: p.id,
          title: p.title,
          category: p.category,
          categoryLabel: CATEGORY_LABELS[p.category] || p.category,
          zone: p.zone,
          reason: p.reason,
          final: p.final ?? p.score ?? null,
          factors: p.factors
        })),
        missReason: row.missReason || null,
        nearMiss: Array.isArray(row.nearMiss) ? row.nearMiss : [],
        threshold: row.threshold ?? 0,
        pool: row.pool ?? 0,
        ms: row.ms ?? 0
      };
    });
  return { health, turns, count: turns.length };
}

/**
 * 按「对话」归组：一次对话＝一条记忆的出处。
 * 为什么两个维度都要留：「项目」是这件事属于哪个主题（dsh / relay / 记忆库…），可跨对话；
 * 「会话」是这条记忆在哪个对话框里记下来的。同一个对话里可以改别的项目的记忆，
 * 所以既要能看到「这个对话记了什么」，也要能看到「它碰到了哪些项目」。
 */
export function sessionsView(root, { limit = 200 } = {}) {
  const store = loadStore(root);
  const groups = new Map();
  for (const entry of store.entries) {
    if (entry.status !== 'active') continue;
    const key = String(entry.session || '').trim() || '（未标会话）';
    let g = groups.get(key);
    if (!g) {
      g = { session: key, count: 0, categories: {}, projects: {}, first: '', last: '', items: [] };
      groups.set(key, g);
    }
    g.count += 1;
    g.categories[entry.category] = (g.categories[entry.category] || 0) + 1;
    const p = String(entry.project || '').trim();
    if (p) g.projects[p] = (g.projects[p] || 0) + 1;
    const t = parseTime(entry.updated_at) || 0;
    if (!g.first || t < (parseTime(g.first) || 0)) g.first = entry.updated_at;
    if (!g.last || t > (parseTime(g.last) || 0)) g.last = entry.updated_at;
    g.items.push({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      project: entry.project || '',
      importance: entry.importance,
      source: entry.source,
      updated_at: entry.updated_at
    });
  }
  const rows = [...groups.values()].sort((a, b) => (parseTime(b.last) || 0) - (parseTime(a.last) || 0));
  for (const g of rows) {
    g.items.sort((a, b) => (parseTime(b.updated_at) || 0) - (parseTime(a.updated_at) || 0));
  }
  const trimmed = rows.slice(0, Math.max(1, Number(limit) || 200));
  return { items: trimmed, total: rows.length, returned: trimmed.length };
}

export function orderLabels(weights, mode) {
  return orderOf(weights, mode).map((x) => CATEGORY_LABELS[x.category] || x.category);
}
