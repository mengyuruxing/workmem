// lib/core/store.mjs — 5 个分类文件的读取、原子写入、mtime 冲突检测。
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATEGORIES,
  CATEGORY_META,
  entryValid,
  newId,
  parseCategoryFile,
  serializeCategoryFile
} from './entry.mjs';
import { atomicWriteFile, ensureDir } from './util.mjs';
import { defaultStats, statsPath, writeStats } from './stats.mjs';
import { DEFAULT_WEIGHTS, weightsPath, writeWeights } from './weights.mjs';
import { DEFAULT_SETTINGS, settingsPath, writeSettings } from './settings.mjs';

export function categoryPath(root, category) {
  const meta = CATEGORY_META[category];
  if (!meta) throw new Error('未知分类：' + category);
  return join(root, meta.file);
}

export function categoryOfPath(file) {
  const normalized = String(file).replace(/\\/g, '/');
  for (const category of CATEGORIES) {
    if (normalized.endsWith(CATEGORY_META[category].file)) return category;
  }
  return null;
}

/** 建立空数据目录：只写文件头，不预置任何记忆。 */
export function initStore(root) {
  ensureDir(root);
  ensureDir(join(root, 'work'));
  ensureDir(join(root, 'persona'));
  ensureDir(join(root, '_audit'));
  ensureDir(join(root, '_logs'));
  ensureDir(join(root, '_snapshots'));

  for (const category of CATEGORIES) {
    const file = categoryPath(root, category);
    if (!existsSync(file)) atomicWriteFile(file, '# ' + CATEGORY_META[category].title + '\n');
  }
  if (!existsSync(statsPath(root))) writeStats(root, defaultStats());
  if (!existsSync(weightsPath(root))) writeWeights(root, DEFAULT_WEIGHTS);
  if (!existsSync(settingsPath(root))) writeSettings(root, DEFAULT_SETTINGS);
  return { ok: true, root };
}

export function loadCategory(root, category) {
  const file = categoryPath(root, category);
  try {
    const text = readFileSync(file, 'utf8');
    const stat = statSync(file);
    const parsed = parseCategoryFile(text, category);
    return {
      category,
      path: file,
      exists: true,
      text,
      mtimeMs: stat.mtimeMs,
      entries: parsed.entries,
      warnings: parsed.warnings
    };
  } catch (e) {
    return {
      category,
      path: file,
      exists: existsSync(file),
      text: '',
      mtimeMs: null,
      entries: [],
      warnings: [{ code: existsSync(file) ? 'read-error' : 'missing-file', message: String(e?.message || e) }]
    };
  }
}

/** 读全部 5 个分类；跨文件重复 id 标记为损坏。 */
export function loadStore(root) {
  const categories = {};
  const entries = [];
  const warnings = [];
  const seen = new Map();

  for (const category of CATEGORIES) {
    const loaded = loadCategory(root, category);
    categories[category] = loaded;
    for (const w of loaded.warnings) warnings.push({ ...w, category });
    for (const entry of loaded.entries) {
      const prev = seen.get(entry.id);
      if (prev) {
        entry.issues.push({ code: 'duplicate-id-global', message: 'id 与其他分类重复：' + prev.category });
        warnings.push({ code: 'duplicate-id-global', message: 'id 重复：' + entry.id, id: entry.id, category, line: entry.line });
      } else {
        seen.set(entry.id, entry);
      }
      entries.push(entry);
    }
  }

  return {
    root,
    categories,
    entries,
    warnings,
    valid: entries.filter(entryValid),
    invalid: entries.filter((e) => !entryValid(e)),
    mtimes: Object.fromEntries(CATEGORIES.map((c) => [c, categories[c].mtimeMs]))
  };
}

export function saveCategory(root, category, entries, { expectedMtimeMs = null, allowInvalid = false } = {}) {
  const file = categoryPath(root, category);
  let currentMtime = null;
  try { currentMtime = statSync(file).mtimeMs; } catch {}
  if (expectedMtimeMs != null && currentMtime != null && Math.abs(currentMtime - expectedMtimeMs) > 1) {
    return { ok: false, error: 'external-change', message: '文件已被外部修改，请刷新后重试', mtimeMs: currentMtime };
  }
  const ids = new Set();
  for (const entry of entries) {
    if (entry.category !== category) return { ok: false, error: 'category-mismatch', message: '条目分类与文件不一致：' + entry.id };
    if (!/^[0-9a-f]{8}$/.test(String(entry.id))) return { ok: false, error: 'bad-id', message: '非法 id：' + entry.id };
    if (ids.has(entry.id)) return { ok: false, error: 'duplicate-id', message: 'id 重复：' + entry.id };
    ids.add(entry.id);
    if (!allowInvalid && !entryValid(entry)) {
      return { ok: false, error: 'invalid-entry', message: '分类里有损坏条目，拒绝整文件重写：' + entry.id };
    }
  }
  try {
    atomicWriteFile(file, serializeCategoryFile(entries, category));
    const nextMtime = statSync(file).mtimeMs;
    return { ok: true, mtimeMs: nextMtime, count: entries.length };
  } catch (e) {
    return { ok: false, error: 'write-failed', message: String(e?.message || e), mtimeMs: currentMtime };
  }
}

export function findEntry(root, id) {
  const store = loadStore(root);
  const entry = store.entries.find((e) => e.id === id);
  if (!entry) return null;
  const loaded = store.categories[entry.category];
  return { entry, category: entry.category, path: loaded.path, mtimeMs: loaded.mtimeMs, store };
}

export function nextId(root) {
  const store = loadStore(root);
  const used = new Set(store.entries.map((e) => e.id));
  for (let i = 0; i < 100; i += 1) {
    const id = newId();
    if (!used.has(id)) return id;
  }
  throw new Error('无法生成不重复 id');
}

export function storeStats(root) {
  const store = loadStore(root);
  const counts = {};
  for (const category of CATEGORIES) counts[category] = store.categories[category].entries.length;
  return {
    total: store.entries.length,
    valid: store.valid.length,
    invalid: store.invalid.length,
    counts,
    warnings: store.warnings
  };
}

// 确保目录存在；initStore 是显式入口，插件启动时才调用。
export function ensureStoreRoot(root) {
  mkdirSync(root, { recursive: true });
  return root;
}
