// lib/core/index.mjs — 加载记忆库，构建可检索索引。
import { loadStore } from './store.mjs';
import { readStats } from './stats.mjs';
import { readWeights } from './weights.mjs';
import { readSettings } from './settings.mjs';
import { buildIndex, manualSearch, search } from './search.mjs';
import { entryValid } from './entry.mjs';
import { factor } from './weights.mjs';
import { normalizeProject, parseTime } from './util.mjs';

export function loadSearchContext(root, { now = Date.now() } = {}) {
  const store = loadStore(root);
  const stats = readStats(root);
  const { weights, warnings: weightWarnings } = readWeights(root);
  const { settings, warnings: settingWarnings } = readSettings(root);
  const index = buildIndex(store.entries, { now });
  return {
    store,
    stats,
    weights,
    settings,
    index,
    warnings: [...store.warnings, ...weightWarnings, ...settingWarnings]
  };
}

export function searchStore(root, query, opts = {}) {
  const ctx = loadSearchContext(root, { now: opts.now || Date.now() });
  const result = search(ctx.index, query, {
    ...opts,
    weights: ctx.weights,
    stats: ctx.stats,
    coldDays: opts.coldDays ?? ctx.settings.coldDays,
    minCoverage: opts.minCoverage ?? ctx.settings.retrieval.minCoverage,
    minCovHard: opts.minCovHard ?? ctx.settings.retrieval.minCovHard,
    relBar: opts.relBar ?? ctx.settings.retrieval.relBar,
    minScore: opts.minScore ?? ctx.settings.retrieval.minScore,
    topK: opts.topK ?? ctx.settings.retrieval.topK,
    budgetChars: opts.budgetChars ?? ctx.settings.retrieval.budgetChars
  });
  return { ...result, context: ctx };
}

export function manualSearchStore(root, query, opts = {}) {
  const ctx = loadSearchContext(root, { now: opts.now || Date.now() });
  const result = manualSearch(ctx.index, query, {
    ...opts,
    weights: ctx.weights,
    stats: ctx.stats,
    coldDays: opts.coldDays ?? ctx.settings.coldDays,
    topK: opts.topK ?? ctx.settings.retrieval.manualTopK
  });
  return { ...result, context: ctx };
}


function projectMatches(entry, currentProject) {
  const q = normalizeProject(currentProject);
  if (!q) return true;
  const p = normalizeProject(entry.project);
  if (!p) return true; // 全局条目对所有项目都可用
  return p.split(',').map((x) => x.trim().toLowerCase()).includes(q.toLowerCase());
}

/** 保底规矩：每轮固定给的分类条目，绕过相关度门槛。 */
export function pickBaseline(ctx, { mode = 'work', currentProject = '' } = {}) {
  const b = ctx?.settings?.retrieval?.baseline;
  if (!b || b.enabled === false) return [];
  if (!Array.isArray(b.modes) || !b.modes.includes(mode)) return [];
  if (factor(ctx.weights, b.category, mode) <= 0) return [];
  const rows = (ctx.store?.entries ?? []).filter((entry) =>
    entry.category === b.category &&
    entry.status === 'active' &&
    entryValid(entry) &&
    projectMatches(entry, currentProject)
  );
  rows.sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
    if ((left.importance || 0) !== (right.importance || 0)) return (right.importance || 0) - (left.importance || 0);
    const lt = parseTime(left.updated_at) || 0;
    const rt = parseTime(right.updated_at) || 0;
    if (lt !== rt) return rt - lt;
    return String(left.id).localeCompare(String(right.id));
  });
  return rows.slice(0, Math.max(0, Number(b.maxItems) || 1)).map((entry) => ({
    entry,
    baseline: true,
    zone: 'hot',
    reason: 'baseline',
    base: 0,
    coverage: 0,
    final: 0,
    factors: { baseline: 1 }
  }));
}
