// lib/core/events.mjs — _logs/events.jsonl：检索/写入/快照/健康事件。
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isoNow, parseTime } from './util.mjs';

export const EVENTS_MAX_BYTES = 10 * 1024 * 1024;

export function eventsPath(root) {
  return join(root, '_logs', 'events.jsonl');
}

export function appendEvent(root, event) {
  const path = eventsPath(root);
  mkdirSync(dirname(path), { recursive: true });
  try {
    if (existsSync(path) && statSync(path).size > EVENTS_MAX_BYTES) {
      renameSync(path, path.replace(/\.jsonl$/, '-' + Date.now() + '.jsonl'));
    }
  } catch {}
  const row = { ts: event.ts || isoNow(), ...event };
  appendFileSync(path, JSON.stringify(row) + '\n', 'utf8');
  return row;
}

export function readEvents(root, { limit = 100, type = null, since = null } = {}) {
  let text = '';
  try {
    text = readFileSync(eventsPath(root), 'utf8');
  } catch {
    return [];
  }
  const sinceMs = since ? parseTime(since) : NaN;
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (type && row.type !== type) continue;
      if (Number.isFinite(sinceMs) && parseTime(row.ts) < sinceMs) continue;
      rows.push(row);
    } catch {
      // 坏行跳过
    }
  }
  return limit > 0 ? rows.slice(-limit) : rows;
}

export function readTurns(root, limit = 30) {
  return readEvents(root, { limit: 0, type: 'turn' }).slice(-limit);
}

export function lastWriteFailure(root, hours = 24, now = Date.now()) {
  const min = now - hours * 3600000;
  const rows = readEvents(root, { limit: 0, type: 'write' });
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const ts = parseTime(row.ts);
    if (Number.isFinite(ts) && ts < min) break;
    if (row.ok === false) return row;
  }
  return null;
}
