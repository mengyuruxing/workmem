// lib/core/weights.mjs — _weights.json：5×3 分类权重矩阵。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJson } from './util.mjs';
import { CATEGORIES, MODES } from './entry.mjs';

export const LEVEL_VALUES = {
  ignore: 0,
  low: 0.5,
  normal: 1.0,
  high: 1.5,
  max: 2.0
};

export const LEVEL_KEYS = Object.keys(LEVEL_VALUES);

export const DEFAULT_WEIGHTS = {
  version: 1,
  levels: { ...LEVEL_VALUES },
  importanceFactors: { '1': 0.8, '2': 1.0, '3': 1.25, '4': 1.5 },
  coldFactor: 0.7,
  matrix: {
    rules: { work: 'max', mixed: 'high', companion: 'normal' },
    facts: { work: 'high', mixed: 'normal', companion: 'low' },
    pitfalls: { work: 'high', mixed: 'normal', companion: 'low' },
    progress: { work: 'normal', mixed: 'normal', companion: 'low' },
    persona: { work: 'low', mixed: 'normal', companion: 'max' }
  }
};

export function weightsPath(root) {
  return join(root, '_weights.json');
}

function clone(value) {
  return structuredClone(value);
}

export function normalizeWeights(raw) {
  const warnings = [];
  const out = clone(DEFAULT_WEIGHTS);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { weights: out, warnings: ['_weights.json 缺失或不是对象，使用默认矩阵'] };
  }

  if (raw.levels && typeof raw.levels === 'object') {
    for (const key of LEVEL_KEYS) {
      const v = Number(raw.levels[key]);
      if (Number.isFinite(v) && v >= 0 && v <= 5) out.levels[key] = v;
      else warnings.push('档位 ' + key + ' 非法，使用默认值');
    }
  }

  if (raw.importanceFactors && typeof raw.importanceFactors === 'object') {
    for (const star of ['1', '2', '3', '4']) {
      const v = Number(raw.importanceFactors[star]);
      if (Number.isFinite(v) && v > 0 && v <= 5) out.importanceFactors[star] = v;
      else warnings.push('重要度系数 ★' + star + ' 非法，使用默认值');
    }
  }

  if (Number.isFinite(Number(raw.coldFactor)) && Number(raw.coldFactor) > 0 && Number(raw.coldFactor) <= 1) {
    out.coldFactor = Number(raw.coldFactor);
  }

  if (raw.matrix && typeof raw.matrix === 'object') {
    for (const category of CATEGORIES) {
      for (const mode of MODES) {
        const level = raw.matrix?.[category]?.[mode];
        if (LEVEL_KEYS.includes(level)) out.matrix[category][mode] = level;
        else warnings.push('矩阵 ' + category + '.' + mode + ' 非法，使用默认值');
      }
    }
  } else {
    warnings.push('matrix 缺失，使用默认矩阵');
  }

  return { weights: out, warnings };
}

export function readWeights(root) {
  try {
    const text = readFileSync(weightsPath(root), 'utf8');
    if (text.trim() === '') return { weights: clone(DEFAULT_WEIGHTS), warnings: [] };
    return normalizeWeights(JSON.parse(text));
  } catch {
    return { weights: clone(DEFAULT_WEIGHTS), warnings: ['_weights.json 读取失败，使用默认矩阵'] };
  }
}

export function writeWeights(root, weights) {
  const { weights: normalized, warnings } = normalizeWeights(weights);
  atomicWriteJson(weightsPath(root), normalized);
  return { weights: normalized, warnings };
}

export function factor(weights, category, mode) {
  const level = weights?.matrix?.[category]?.[mode];
  return LEVEL_VALUES[level] ?? 1.0;
}

export function importanceFactor(weights, importance) {
  const key = String(Math.min(4, Math.max(1, Number(importance) || 1)));
  return Number(weights?.importanceFactors?.[key]) || 1.0;
}

export function levelOf(weights, category, mode) {
  return weights?.matrix?.[category]?.[mode] ?? 'normal';
}

export function setCell(weights, category, mode, level) {
  if (!CATEGORIES.includes(category)) throw new Error('未知分类：' + category);
  if (!MODES.includes(mode)) throw new Error('未知模式：' + mode);
  if (!LEVEL_KEYS.includes(level)) throw new Error('未知档位：' + level);
  const next = clone(weights);
  next.matrix[category][mode] = level;
  return next;
}

export function resetColumn(weights, mode) {
  if (!MODES.includes(mode)) throw new Error('未知模式：' + mode);
  const next = clone(weights);
  for (const category of CATEGORIES) next.matrix[category][mode] = DEFAULT_WEIGHTS.matrix[category][mode];
  return next;
}

export function resetAll() {
  return clone(DEFAULT_WEIGHTS);
}

export function orderOf(weights, mode) {
  return [...CATEGORIES]
    .map((category) => ({ category, value: factor(weights, category, mode) }))
    .sort((a, b) => b.value - a.value || CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
}
