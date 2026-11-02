// lib/core/audit.mjs — _audit/edits.jsonl：追加式修改审计。
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isoNow, truncate } from './util.mjs';

export function auditPath(root) {
  return join(root, '_audit', 'edits.jsonl');
}

export function appendAudit(root, record) {
  const path = auditPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const row = {
    ts: record.ts || isoNow(),
    actor: record.actor || '系统',
    action: record.action || 'update',
    item_id: record.item_id ?? null,
    category: record.category ?? null,
    field: record.field ?? null,
    before: record.before == null ? null : truncate(record.before),
    after: record.after == null ? null : truncate(record.after),
    note: record.note ?? ''
  };
  appendFileSync(path, JSON.stringify(row) + '\n', 'utf8');
  return row;
}

export function readAudit(root, { itemId = null, limit = 100 } = {}) {
  let text = '';
  try {
    text = readFileSync(auditPath(root), 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (itemId && row.item_id !== itemId) continue;
      rows.push(row);
    } catch {
      // 坏行跳过；面板仍能看其他记录
    }
  }
  return limit > 0 ? rows.slice(-limit) : rows;
}

export function auditFields(root, { actor, action, entry, fields, note = '' }) {
  if (!entry) return [];
  const out = [];
  for (const [field, pair] of Object.entries(fields || {})) {
    out.push(appendAudit(root, {
      actor,
      action,
      item_id: entry.id,
      category: entry.category,
      field,
      before: pair?.before ?? null,
      after: pair?.after ?? null,
      note
    }));
  }
  return out;
}
