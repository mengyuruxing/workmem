// lib/core/lifecycle.mjs — 冷暖计算与每日冷区扫描（只记事件，不移动/删除）。
import { loadStore } from './store.mjs';
import { readStats } from './stats.mjs';
import { readSettings } from './settings.mjs';
import { entryValid } from './entry.mjs';
import { getStat, zoneOf } from './stats.mjs';
import { readEvents, appendEvent } from './events.mjs';
import { parseTime } from './util.mjs';

export function computeZones(root, { now = Date.now() } = {}) {
  const store = loadStore(root);
  const stats = readStats(root);
  const { settings } = readSettings(root);
  const cold = [];
  const hot = [];
  for (const entry of store.entries) {
    if (entry.status !== 'active' || !entryValid(entry)) continue;
    const stat = getStat(stats, entry.id, entry);
    (zoneOf(entry, stat, settings.coldDays, now) === 'cold' ? cold : hot).push(entry.id);
  }
  return { cold, hot, now, coldDays: settings.coldDays };
}

/** 每天最多一次；比较上一次 cold_sweep，记录新沉入/回热的 id。 */
export function sweepCold(root, { now = Date.now() } = {}) {
  const zones = computeZones(root, { now });
  const previous = readEvents(root, { type: 'cold_sweep', limit: 0 }).slice(-1)[0] || null;
  const prev = new Set(Array.isArray(previous?.ids) ? previous.ids : []);
  const current = new Set(zones.cold);
  const newlyCold = zones.cold.filter((id) => !prev.has(id));
  const revived = [...prev].filter((id) => !current.has(id));
  if (previous && newlyCold.length === 0 && revived.length === 0) {
    return { ok: true, changed: false, cold: zones.cold.length, hot: zones.hot.length, newlyCold, revived, coldDays: zones.coldDays };
  }
  try {
    appendEvent(root, {
      type: 'cold_sweep',
      cold: zones.cold.length,
      hot: zones.hot.length,
      ids: zones.cold,
      newlyCold,
      revived,
      coldDays: zones.coldDays
    });
  } catch {}
  return { ok: true, changed: true, cold: zones.cold.length, hot: zones.hot.length, newlyCold, revived, coldDays: zones.coldDays };
}

export function maybeSweepCold(root, { now = Date.now(), minHours = 24 } = {}) {
  const last = readEvents(root, { type: 'cold_sweep', limit: 0 }).slice(-1)[0] || null;
  if (last) {
    const ts = parseTime(last.ts);
    if (Number.isFinite(ts) && now - ts < minHours * 3600000) {
      return { ok: true, skipped: true, reason: 'too-soon' };
    }
  }
  return sweepCold(root, { now });
}
