// lib/core/settings.mjs — _settings.json：冷暖、健康阈值、检索门槛、深挖开关。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJson, clamp, deepMerge } from './util.mjs';

export const DEFAULT_SETTINGS = {
  version: 2,
  coldDays: 14,
  // 只有工作模式一种读法。这个块留着是为了让老 _settings.json 读进来不报错，
  // 里面的 default/locked/fallback 一律被 normalizeSettings 覆盖成固定值。
  mode: {
    default: 'work',
    locked: true,
    fallback: 'work'
  },
  retrieval: {
    topK: 3,
    budgetChars: 1000,
    minCoverage: 0.2,
    minCovHard: 0.4,
    relBar: 0.62,
    minScore: 9,
    manualTopK: 50,
    baseline: {
      enabled: true,
      maxItems: 1,
      maxChars: 300,
      category: 'rules',
      modes: ['work']
    }
  },
  health: {
    windowTurns: 30,
    yellowConsecutiveMiss: 10,
    yellowRate: 0.1,
    redWriteHours: 24,
    yellowNoWriteTurns: 30,
    yellowNoWriteHours: 24
  },
  consolidation: {
    enabled: true,
    everyTurns: 25,
    maxEntries: 5,
    maxChars: 1200,
    merge: true,
    regexHints: true,
    retry: 1,
    scope: {
      currentProject: true,
      mentionedProjects: true,
      modifiedProjects: true,
      global: false
    }
  },
  deepDive: {
    enabled: false
  }
};

export function settingsPath(root) {
  return join(root, '_settings.json');
}

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeSettings(raw) {
  const warnings = [];
  const base = structuredClone(DEFAULT_SETTINGS);
  const merged = raw && typeof raw === 'object' && !Array.isArray(raw) ? deepMerge(base, raw) : base;

  const coldDays = numOr(merged.coldDays, base.coldDays);
  merged.coldDays = clamp(Math.round(coldDays), 1, 365);
  if (merged.coldDays !== coldDays) warnings.push('coldDays 非法，已收口');

  // 模式固定为工作模式：老文件里的 auto/mixed/companion 一律静默收口，不写警告
  // （这不是用户配错了，是这套东西已经没有第二种读法）。
  merged.mode = { default: 'work', locked: true, fallback: 'work' };

  const r = merged.retrieval;
  r.topK = clamp(Math.round(numOr(r.topK, base.retrieval.topK)), 1, 20);
  r.budgetChars = clamp(Math.round(numOr(r.budgetChars, base.retrieval.budgetChars)), 100, 20000);
  r.manualTopK = clamp(Math.round(numOr(r.manualTopK, base.retrieval.manualTopK)), 1, 500);
  for (const key of ['minCoverage', 'minCovHard', 'relBar']) {
    r[key] = clamp(numOr(r[key], base.retrieval[key]), 0, 1);
  }
  r.minScore = Math.max(0, numOr(r.minScore, base.retrieval.minScore));

  const b = r.baseline;
  b.enabled = b.enabled !== false;
  b.maxItems = clamp(Math.round(numOr(b.maxItems, base.retrieval.baseline.maxItems)), 1, 5);
  b.maxChars = clamp(Math.round(numOr(b.maxChars, base.retrieval.baseline.maxChars)), 50, 2000);
  if (!['rules', 'facts', 'pitfalls', 'progress'].includes(b.category)) b.category = base.retrieval.baseline.category;
  b.modes = ['work'];

  const h = merged.health;
  h.windowTurns = clamp(Math.round(numOr(h.windowTurns, base.health.windowTurns)), 1, 365);
  h.yellowConsecutiveMiss = clamp(Math.round(numOr(h.yellowConsecutiveMiss, base.health.yellowConsecutiveMiss)), 1, 365);
  h.yellowRate = clamp(numOr(h.yellowRate, base.health.yellowRate), 0, 1);
  h.redWriteHours = clamp(Math.round(numOr(h.redWriteHours, base.health.redWriteHours)), 1, 720);
  h.yellowNoWriteTurns = clamp(Math.round(numOr(h.yellowNoWriteTurns, base.health.yellowNoWriteTurns)), 1, 365);
  h.yellowNoWriteHours = clamp(Math.round(numOr(h.yellowNoWriteHours, base.health.yellowNoWriteHours)), 1, 720);

  const c = merged.consolidation;
  c.enabled = c.enabled !== false;
  c.everyTurns = clamp(Math.round(numOr(c.everyTurns, base.consolidation.everyTurns)), 1, 200);
  c.maxEntries = clamp(Math.round(numOr(c.maxEntries, base.consolidation.maxEntries)), 1, 20);
  c.maxChars = clamp(Math.round(numOr(c.maxChars, base.consolidation.maxChars)), 200, 20000);
  c.merge = c.merge !== false;
  c.regexHints = c.regexHints !== false;
  c.retry = clamp(Math.round(numOr(c.retry, base.consolidation.retry)), 0, 3);
  c.scope = { ...structuredClone(base.consolidation.scope), ...(c.scope && typeof c.scope === 'object' ? c.scope : {}) };
  for (const key of ['currentProject', 'mentionedProjects', 'modifiedProjects', 'global']) c.scope[key] = Boolean(c.scope[key]);

  merged.deepDive.enabled = Boolean(merged.deepDive.enabled);
  return { settings: merged, warnings };
}

export function readSettings(root) {
  try {
    const text = readFileSync(settingsPath(root), 'utf8');
    if (text.trim() === '') return { settings: structuredClone(DEFAULT_SETTINGS), warnings: [] };
    return normalizeSettings(JSON.parse(text));
  } catch {
    return { settings: structuredClone(DEFAULT_SETTINGS), warnings: ['_settings.json 读取失败，使用默认配置'] };
  }
}

export function writeSettings(root, settings) {
  const { settings: normalized, warnings } = normalizeSettings(settings);
  atomicWriteJson(settingsPath(root), normalized);
  return { settings: normalized, warnings };
}
