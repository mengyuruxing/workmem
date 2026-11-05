// lib/core/snapshot.mjs — 整目录快照与回滚；只复制数据，不含 _snapshots。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { atomicWriteJson, isoNow } from './util.mjs';
import { loadStore } from './store.mjs';
import { appendEvent } from './events.mjs';
import { appendAudit } from './audit.mjs';

const TARGETS = ['work', '_stats.json', '_weights.json', '_settings.json', '_consolidation.json', '_audit', '_logs'];

export function snapshotDir(root) {
  return join(root, '_snapshots');
}

export function validateSnapshotName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name) && !name.includes('..');
}

function parts(date) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

export function defaultSnapshotName(now = new Date()) {
  return parts(now);
}

function sizeOf(path) {
  try {
    const st = statSync(path);
    if (st.isFile()) return st.size;
    let total = 0;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      // 符号链接/junction 不跟进去：数据目录里一旦出现环，递归会直接把进程打死。
      if (entry.isSymbolicLink()) continue;
      total += sizeOf(join(path, entry.name));
    }
    return total;
  } catch {
    return 0;
  }
}

function counts(root) {
  try {
    const store = loadStore(root);
    return {
      total: store.entries.length,
      valid: store.valid.length,
      invalid: store.invalid.length,
      categories: Object.fromEntries(Object.entries(store.categories).map(([k, v]) => [k, v.entries.length]))
    };
  } catch {
    return null;
  }
}

export function createSnapshot(root, { name = defaultSnapshotName(), note = '', now = isoNow() } = {}) {
  if (!validateSnapshotName(name)) {
    return { ok: false, error: 'bad-name', message: '快照名只能是字母、数字、点、横线、下划线' };
  }
  const dir = snapshotDir(root);
  mkdirSync(dir, { recursive: true });
  const target = resolve(dir, name);
  if (!target.startsWith(resolve(dir) + sep)) {
    return { ok: false, error: 'bad-name', message: '快照路径越界' };
  }
  if (existsSync(target)) return { ok: false, error: 'exists', message: '快照已存在：' + name };

  try {
    mkdirSync(target, { recursive: true });
    for (const rel of TARGETS) {
      const src = join(root, rel);
      if (!existsSync(src)) continue;
      cpSync(src, join(target, rel), { recursive: true });
    }
    const manifest = { name, createdAt: now, note, counts: counts(root) };
    atomicWriteJson(join(target, 'snapshot.json'), manifest);
    try {
      appendEvent(root, { type: 'snapshot', ok: true, name, note, counts: manifest.counts, ts: now });
    } catch {}
    return { ok: true, name, path: target, manifest };
  } catch (e) {
    try { rmSync(target, { recursive: true, force: true }); } catch {}
    return { ok: false, error: 'snapshot-failed', message: String(e?.message || e) };
  }
}

export function listSnapshots(root) {
  const dir = snapshotDir(root);
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    let manifest = null;
    try { manifest = JSON.parse(readFileSync(join(path, 'snapshot.json'), 'utf8')); } catch {}
    rows.push({
      name: entry.name,
      createdAt: manifest?.createdAt ?? null,
      note: manifest?.note ?? '',
      counts: manifest?.counts ?? null,
      size: sizeOf(path)
    });
  }
  return rows.sort((a, b) => String(b.createdAt ?? b.name).localeCompare(String(a.createdAt ?? a.name)));
}

/** 回滚：先拍当前状态安全快照，再用目标快照覆盖。 */
export function rollback(root, name, { actor = '主人', now = isoNow() } = {}) {
  if (!validateSnapshotName(name)) {
    return { ok: false, error: 'bad-name', message: '快照名非法' };
  }
  const source = resolve(snapshotDir(root), name);
  if (!source.startsWith(resolve(snapshotDir(root)) + sep)) {
    return { ok: false, error: 'bad-name', message: '快照路径越界' };
  }
  if (!existsSync(source)) return { ok: false, error: 'not-found', message: '没有这个快照：' + name };

  const safetyName = 'pre-rollback-' + defaultSnapshotName(new Date(now));
  const safety = createSnapshot(root, { name: safetyName, note: '回滚 ' + name + ' 前的安全快照', now });
  if (!safety.ok) return { ok: false, error: 'safety-failed', message: '安全快照失败，未回滚：' + safety.message };

  try {
    for (const rel of TARGETS) {
      const src = join(source, rel);
      if (!existsSync(src)) continue;
      const dst = join(root, rel);
      rmSync(dst, { recursive: true, force: true });
      cpSync(src, dst, { recursive: true });
    }
    const record = { type: 'rollback', ok: true, name, safety: safetyName, ts: now };
    try { appendEvent(root, record); } catch {}
    try {
      appendAudit(root, {
        ts: now, actor, action: 'rollback', item_id: null, category: null,
        field: 'snapshot', before: null, after: name, note: '安全快照：' + safetyName
      });
    } catch {}
    return { ok: true, name, safety: safetyName, event: record };
  } catch (e) {
    return { ok: false, error: 'rollback-failed', message: String(e?.message || e), safety: safetyName };
  }
}
