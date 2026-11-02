// lib/core/health.mjs — 健康灯与最近 30 轮小字。
import { readSettings } from './settings.mjs';
import { readEvents, lastWriteFailure } from './events.mjs';
import { loadStore } from './store.mjs';
import { parseTime } from './util.mjs';

function turnHits(turn) {
  return Array.isArray(turn?.picked) ? turn.picked.length : 0;
}

export function computeHealth(root, { now = Date.now() } = {}) {
  const { settings } = readSettings(root);
  const h = settings.health;
  const allTurns = readEvents(root, { type: 'turn', limit: 0 });
  const turns = allTurns.slice(-h.windowTurns);
  const hits = turns.filter((t) => turnHits(t) > 0).length;
  const total = turns.length;
  const rate = total ? hits / total : 0;

  let consecutiveMiss = 0;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turnHits(turns[i]) > 0) break;
    consecutiveMiss += 1;
  }

  let lastHitIndex = -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turnHits(turns[i]) > 0) { lastHitIndex = i; break; }
  }
  const lastHitTurnsAgo = lastHitIndex < 0 ? null : turns.length - 1 - lastHitIndex;

  const failure = lastWriteFailure(root, h.redWriteHours, now);
  let store = null;
  try { store = loadStore(root); } catch {}
  const invalid = store ? store.invalid.length : 0;
  const readError = Boolean(store?.warnings?.some((w) => w.code === 'read-error'));
  const entryCount = store ? store.entries.length : 0;

  const allWrites = readEvents(root, { type: 'write', limit: 0 })
    .filter((w) => w.ok === true && Number.isFinite(parseTime(w.ts)));
  const writes = allWrites.filter((w) => now - parseTime(w.ts) <= h.redWriteHours * 3600000);
  const writeCount = writes.length;
  const lastWriteAt = allWrites.reduce((max, w) => Math.max(max, parseTime(w.ts)), -Infinity);
  const hasWrite = Number.isFinite(lastWriteAt);
  const turnsSinceWrite = hasWrite
    ? allTurns.filter((t) => Number.isFinite(parseTime(t.ts)) && parseTime(t.ts) > lastWriteAt).length
    : allTurns.length;
  const hoursSinceWrite = hasWrite ? Math.max(0, (now - lastWriteAt) / 3600000) : null;

  // 2026-11-02 修：原来只要 redWriteHours（24h）内有过一次失败就判红，
  // 哪怕之后成功写入几百条也不转绿——实测 21:03 一次被敏感词误拦，22:27 成功写入后灯仍是红的。
  // 改成"失败之后又成功写过，就算已恢复"，失败记录本身留着备查（failure.active=false）。
  let failureActive = Boolean(failure);
  if (failure && hasWrite && parseTime(failure.ts) < lastWriteAt) failureActive = false;

  let status = 'green';
  let reason = '正常';
  if (failureActive || invalid > 0 || readError || !store) {
    status = 'red';
    reason = failureActive ? '最近有写入失败' : (invalid > 0 ? '有损坏条目' : (readError ? '记忆文件读不了' : '记忆库读不了'));
  } else if (entryCount === 0) {
    status = 'yellow';
    reason = '空库，还没有记忆';
  } else if (total === 0) {
    status = 'yellow';
    reason = '还没有真实轮次';
  } else if (consecutiveMiss >= h.yellowConsecutiveMiss) {
    status = 'yellow';
    reason = '连续 ' + consecutiveMiss + ' 轮没有命中';
  } else if (total >= 10 && rate < h.yellowRate) {
    status = 'yellow';
    reason = '最近 ' + total + ' 轮命中率 ' + Math.round(rate * 100) + '%';
  } else if (entryCount > 0 && (turnsSinceWrite >= h.yellowNoWriteTurns ||
    (hoursSinceWrite != null && hoursSinceWrite >= h.yellowNoWriteHours))) {
    status = 'yellow';
    reason = hoursSinceWrite != null && hoursSinceWrite >= h.yellowNoWriteHours && turnsSinceWrite < h.yellowNoWriteTurns
      ? '记忆库 ' + Math.round(hoursSinceWrite) + ' 小时没有写入'
      : '最近 ' + turnsSinceWrite + ' 轮没有写入';
  }

  const pct = total ? Math.round(rate * 100) : 0;
  const line = '近' + h.windowTurns + '轮命中 ' + hits + ' 次（' + pct + '%）' +
    (total < h.windowTurns ? '，现有 ' + total + ' 轮' : '') +
    ' · 写入 ' + writeCount + ' 条 · 最近写入 ' +
    (hasWrite ? (turnsSinceWrite <= 999 ? turnsSinceWrite + ' 轮前' : Math.round(hoursSinceWrite) + ' 小时前') : '无') +
    ' · 最近命中 ' +
    (lastHitTurnsAgo == null ? '无' : lastHitTurnsAgo + ' 轮前');

  return {
    status,
    reason,
    color: status === 'red' ? '#d64545' : status === 'yellow' ? '#d9a441' : '#3fa66a',
    hits,
    total,
    rate,
    consecutiveMiss,
    lastHitTurnsAgo,
    writeCount,
    lastWriteAt: hasWrite ? new Date(lastWriteAt).toISOString() : null,
    turnsSinceWrite,
    hoursSinceWrite,
    noWrite: entryCount > 0 && total > 0 && (turnsSinceWrite >= h.yellowNoWriteTurns ||
      (hoursSinceWrite != null && hoursSinceWrite >= h.yellowNoWriteHours)),
    entryCount,
    invalid,
    failure: failure ? { ts: failure.ts, error: failure.error ?? null, id: failure.id ?? null, active: failureActive } : null,
    line,
    window: h.windowTurns
  };
}
