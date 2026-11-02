// lib/core/stats.mjs — _stats.json：命中/打开次数、最后被碰时间。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJson, isoNow, parseTime } from './util.mjs';

export function statsPath(root) {
  return join(root, '_stats.json');
}

export function defaultStats() {
  return { version: 1, entries: {} };
}

function normalizeEntry(raw) {
  const hits = Math.max(0, Math.floor(Number(raw?.hits) || 0));
  const views = Math.max(0, Math.floor(Number(raw?.views) || 0));
  const touched = typeof raw?.last_touched_at === 'string' && !Number.isNaN(parseTime(raw.last_touched_at))
    ? raw.last_touched_at
    : '';
  return { hits, views, last_touched_at: touched };
}

export function normalizeStats(raw) {
  const out = defaultStats();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries)) {
    for (const [id, value] of Object.entries(raw.entries)) {
      if (!/^[0-9a-f]{8}$/.test(id)) continue;
      out.entries[id] = normalizeEntry(value);
    }
  }
  return out;
}

export function readStats(root) {
  try {
    const text = readFileSync(statsPath(root), 'utf8');
    if (text.trim() === '') return defaultStats();
    return normalizeStats(JSON.parse(text));
  } catch {
    return defaultStats();
  }
}

export function writeStats(root, stats) {
  const normalized = normalizeStats(stats);
  atomicWriteJson(statsPath(root), normalized);
  return normalized;
}

export function getStat(stats, id, entry = null) {
  const s = stats?.entries?.[id];
  if (s) return s;
  const fallback = entry?.created_at || entry?.updated_at || '';
  return { hits: 0, views: 0, last_touched_at: fallback };
}

export function usesOf(stat) {
  return (Number(stat?.hits) || 0) + (Number(stat?.views) || 0);
}

/** 命中 / 打开计数 +1，并刷新最后被碰时间。 */
export function bump(root, id, kind = 'hit', { now = isoNow() } = {}) {
  if (!/^[0-9a-f]{8}$/.test(String(id))) throw new Error('非法 id：' + id);
  if (kind !== 'hit' && kind !== 'view') throw new Error('非法计数类型：' + kind);
  const stats = readStats(root);
  const current = stats.entries[id] ?? { hits: 0, views: 0, last_touched_at: '' };
  const next = {
    hits: current.hits + (kind === 'hit' ? 1 : 0),
    views: current.views + (kind === 'view' ? 1 : 0),
    last_touched_at: now
  };
  const prevMs = parseTime(current.last_touched_at);
  if (Number.isFinite(prevMs) && prevMs > parseTime(now)) next.last_touched_at = current.last_touched_at;
  stats.entries[id] = next;
  writeStats(root, stats);
  return next;
}

/** 只刷新最后被碰时间（编辑时用），不增加计数。 */
export function touch(root, id, { now = isoNow() } = {}) {
  if (!/^[0-9a-f]{8}$/.test(String(id))) throw new Error('非法 id：' + id);
  const stats = readStats(root);
  const current = stats.entries[id] ?? { hits: 0, views: 0, last_touched_at: '' };
  const prevMs = parseTime(current.last_touched_at);
  const nextMs = parseTime(now);
  stats.entries[id] = {
    ...current,
    last_touched_at: Number.isFinite(prevMs) && prevMs > nextMs ? current.last_touched_at : now
  };
  writeStats(root, stats);
  return stats.entries[id];
}

export function lastTouchedMs(entry, stat) {
  const candidates = [stat?.last_touched_at, entry?.updated_at, entry?.created_at]
    .map((x) => parseTime(x))
    .filter((x) => Number.isFinite(x));
  return candidates.length ? Math.max(...candidates) : NaN;
}

export function zoneOf(entry, stat, coldDays = 14, now = Date.now()) {
  const ms = lastTouchedMs(entry, stat);
  if (!Number.isFinite(ms)) return 'hot';
  return now - ms > coldDays * 86400000 ? 'cold' : 'hot';
}
