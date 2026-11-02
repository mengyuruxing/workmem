// lib/core/mutations.mjs — 新建、编辑、归档/作废、去重合并。
import {
  CATEGORY_META,
  entryValid,
  makeEntry,
  normalizeImportance,
  normalizeSource,
  normalizeStatus
} from './entry.mjs';
import { findEntry, loadCategory, nextId, saveCategory } from './store.mjs';
import { appendAudit } from './audit.mjs';
import { appendEvent } from './events.mjs';
import { touch } from './stats.mjs';
import { isoNow, looksSensitive, normalizeBody, normalizeTitle, normalizeProject, similarity, splitKeywords } from './util.mjs';

const EDITABLE = new Set(['title', 'content', 'source', 'status', 'importance', 'project', 'session', 'keywords', 'quote_edited', 'pinned']);

function writeEvent(root, record) {
  try { appendEvent(root, { type: 'write', ...record }); } catch {}
}

function validateCreate(input) {
  const errors = [];
  if (!CATEGORY_META[input.category]) errors.push('未知分类：' + input.category);
  if (!String(input.title ?? '').trim()) errors.push('标题不能为空');
  if (!String(input.content ?? '').trim()) errors.push('正文不能为空');
  const source = normalizeSource(input.source ?? 'summary');
  if (!source) errors.push('来源必须是 原话/总结/判断/工具');
  const importance = normalizeImportance(input.importance ?? 1);
  if (!importance) errors.push('重要度必须是 1–4');
  if (looksSensitive(input.title) || looksSensitive(input.content)) errors.push('疑似密码/密钥/token，拒绝写入');
  return { errors, source, importance };
}

function diffFields(before, after) {
  const fields = {};
  for (const key of EDITABLE) {
    if (key === 'quote_edited' && after.source !== 'quote') continue;
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) fields[key] = { before: before[key] ?? null, after: after[key] ?? null };
  }
  return fields;
}

function saveWithAudit(root, { category, entries, loaded, actor, action, entry, fields, note, now }) {
  const saved = saveCategory(root, category, entries, { expectedMtimeMs: loaded.mtimeMs });
  if (!saved.ok) {
    writeEvent(root, { ok: false, id: entry?.id ?? null, category, actor, error: saved.error + ': ' + saved.message });
    return { ok: false, error: saved.error, message: saved.message };
  }
  const warnings = [];
  if (fields && Object.keys(fields).length) {
    for (const [field, pair] of Object.entries(fields)) {
      try {
        appendAudit(root, {
          ts: now,
          actor,
          action,
          item_id: entry.id,
          category,
          field,
          before: pair.before,
          after: pair.after,
          note
        });
      } catch (e) {
        warnings.push('审计写入失败：' + String(e?.message || e));
      }
    }
  }
  try { touch(root, entry.id, { now }); } catch (e) { warnings.push('统计刷新失败：' + String(e?.message || e)); }
  writeEvent(root, { ok: true, id: entry.id, category, actor, error: null });
  return { ok: true, entry, mtimeMs: saved.mtimeMs, warnings };
}

/** 新建一条；同分类相似度 ≥0.8 时合并到旧条目。 */
export function createEntry(root, input = {}, { actor = '小喵', now = isoNow(), note = '' } = {}) {
  const { errors, source, importance } = validateCreate(input);
  if (errors.length) {
    writeEvent(root, { ok: false, id: null, category: input.category ?? null, actor, error: errors.join('；') });
    return { ok: false, error: 'invalid-input', message: errors.join('；') };
  }

  const category = input.category;
  const loaded = loadCategory(root, category);
  if (!loaded.exists) {
    writeEvent(root, { ok: false, id: null, category, actor, error: 'category-missing' });
    return { ok: false, error: 'category-missing', message: '分类文件不存在：' + category };
  }
  if (loaded.entries.some((e) => !entryValid(e))) {
    writeEvent(root, { ok: false, id: null, category, actor, error: 'category-damaged' });
    return { ok: false, error: 'category-damaged', message: '该分类有损坏条目，先修复再写入' };
  }

  const content = normalizeBody(input.content).trim();
  const title = normalizeTitle(input.title);
  // 只和同来源的 active 条目合并：原话与总结/判断混在一起会毁掉原话锚点；归档条目不吸收新写入。
  // 原话只允许和正文完全相同的原话合并；近似原话不能合并，否则会改掉证据。
  // 合并还必须同项目，避免整理时把 A 项目的内容并进 B 项目。
  const projectKey = normalizeProject(input.project);
  const duplicate = loaded.entries.find((e) => e.status === 'active' && e.source === source &&
    normalizeProject(e.project) === projectKey &&
    (source === 'quote' ? e.content === content : similarity(e.content, content) >= 0.8));
  if (duplicate) {
    const before = { ...duplicate };
    duplicate.content = content;
    duplicate.title = title || duplicate.title;
    duplicate.keywords = splitKeywords(input.keywords).length ? splitKeywords(input.keywords) : duplicate.keywords;
    duplicate.project = normalizeProject(input.project) || duplicate.project;
    duplicate.importance = Math.max(duplicate.importance, importance);
    duplicate.source = source;
    if (input.pinned !== undefined) duplicate.pinned = Boolean(input.pinned);
    duplicate.updated_at = now;
    const fields = diffFields(before, duplicate);
    const saved = saveWithAudit(root, {
      category, entries: loaded.entries, loaded, actor, action: 'update',
      entry: duplicate, fields, note: note || '相似度合并', now
    });
    return saved.ok ? { ...saved, entry: duplicate, merged: true } : saved;
  }

  const entry = makeEntry({
    id: nextId(root),
    category,
    title,
    content,
    source,
    status: 'active',
    importance,
    project: input.project,
    session: input.session,
    keywords: input.keywords,
    pinned: input.pinned,
    now
  });
  const saved = saveWithAudit(root, {
    category, entries: [...loaded.entries, entry], loaded, actor, action: 'create',
    entry, fields: { content: { before: null, after: entry.content } }, note, now
  });
  return saved.ok ? { ...saved, entry, merged: false } : saved;
}

/** 编辑一条；内容改了且来源是原话，自动标“原话已改”。 */
export function updateEntry(root, id, patch = {}, { actor = '小喵', now = isoNow(), note = '' } = {}) {
  const found = findEntry(root, id);
  if (!found) {
    writeEvent(root, { ok: false, id, category: null, actor, error: 'not-found' });
    return { ok: false, error: 'not-found', message: '没有这条记忆：' + id };
  }
  const { entry, category } = found;
  if (!entryValid(entry)) {
    return { ok: false, error: 'invalid-entry', message: '这条记忆本身有格式问题，先在面板修复' };
  }
  const loaded = loadCategory(root, category);
  const index = loaded.entries.findIndex((e) => e.id === id);
  if (index < 0) return { ok: false, error: 'not-found', message: '没有这条记忆：' + id };

  // 原话是证据：正文和来源锁死。要更正只能作废旧条、新建一条。
  if (entry.source === 'quote') {
    if (patch.content !== undefined && normalizeBody(patch.content).trim() !== entry.content) {
      return { ok: false, error: 'quote-locked', message: '原话正文只读；要更正请作废旧条、新建一条' };
    }
    if (patch.source !== undefined && normalizeSource(patch.source) !== 'quote') {
      return { ok: false, error: 'quote-locked', message: '原话来源只读；要更正请作废旧条、新建一条' };
    }
    if (patch.quote_edited !== undefined && Boolean(patch.quote_edited) !== Boolean(entry.quote_edited)) {
      return { ok: false, error: 'quote-locked', message: '原话已改标记只读' };
    }
  } else if (patch.source !== undefined && normalizeSource(patch.source) === 'quote') {
    return { ok: false, error: 'quote-source-locked', message: '“原话”只能新建，不能把别的来源改成原话' };
  }

  const before = { ...entry };
  const target = { ...entry };

  if (patch.title !== undefined) target.title = normalizeTitle(patch.title);
  if (patch.content !== undefined) target.content = normalizeBody(patch.content).trim();
  if (patch.source !== undefined) {
    const source = normalizeSource(patch.source);
    if (!source) return { ok: false, error: 'bad-source', message: '来源不认识：' + patch.source };
    target.source = source;
  }
  if (patch.importance !== undefined) {
    const importance = normalizeImportance(patch.importance);
    if (!importance) return { ok: false, error: 'bad-importance', message: '重要度必须是 1–4' };
    target.importance = importance;
  }
  if (patch.project !== undefined) target.project = normalizeProject(patch.project);
  if (patch.session !== undefined) {
    target.session = String(patch.session == null ? '' : patch.session).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  }
  if (patch.keywords !== undefined) target.keywords = splitKeywords(patch.keywords);
  if (patch.status !== undefined) {
    const status = normalizeStatus(patch.status);
    if (!status) return { ok: false, error: 'bad-status', message: '状态不认识：' + patch.status };
    target.status = status;
  }
  if (patch.quote_edited !== undefined) target.quote_edited = Boolean(patch.quote_edited);
  if (patch.pinned !== undefined) target.pinned = Boolean(patch.pinned);

  if (!target.title) return { ok: false, error: 'empty-title', message: '标题不能为空' };
  if (!target.content) return { ok: false, error: 'empty-content', message: '正文不能为空' };
  if (looksSensitive(target.title) || looksSensitive(target.content)) {
    return { ok: false, error: 'sensitive', message: '疑似密码/密钥/token，拒绝写入' };
  }
  if (target.source !== 'quote') target.quote_edited = false;
  target.updated_at = now;

  const fields = diffFields(before, target);
  if (Object.keys(fields).length === 0) {
    return { ok: true, entry: target, changed: 0, mtimeMs: loaded.mtimeMs, warnings: [] };
  }
  loaded.entries[index] = target;
  const saved = saveWithAudit(root, {
    category, entries: loaded.entries, loaded, actor, action: 'update', entry: target, fields, note, now
  });
  return saved.ok ? { ...saved, changed: Object.keys(fields).length } : saved;
}

export function setStatus(root, id, status, { actor = '小喵', now = isoNow(), note = '' } = {}) {
  const normalized = normalizeStatus(status);
  if (!normalized) return { ok: false, error: 'bad-status', message: '状态不认识：' + status };
  return updateEntry(root, id, { status: normalized }, { actor, now, note: note || '状态改为 ' + status });
}


/** 合并多条为一条：保留第一条 id，其余归档并记审计。只允许同分类、同来源、同项目、非原话。 */
export function mergeEntries(root, ids, patch = {}, { actor = '小喵', now = isoNow(), note = '' } = {}) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (list.length < 2) return { ok: false, error: 'bad-merge', message: '合并至少需要两条' };
  const found = [];
  for (const id of list) {
    const hit = findEntry(root, id);
    if (!hit) return { ok: false, error: 'not-found', message: '没有这条记忆：' + id };
    if (!entryValid(hit.entry)) return { ok: false, error: 'invalid-entry', message: '待合并条目有格式问题：' + id };
    if (hit.entry.status !== 'active') return { ok: false, error: 'bad-merge', message: '只能合并正常状态的条目：' + id };
    if (hit.entry.source === 'quote') return { ok: false, error: 'quote-locked', message: '原话不能合并：' + id };
    found.push(hit);
  }
  const first = found[0];
  for (const hit of found.slice(1)) {
    if (hit.category !== first.category) return { ok: false, error: 'bad-merge', message: '不能跨分类合并' };
    if (hit.entry.source !== first.entry.source) return { ok: false, error: 'bad-merge', message: '不能跨来源合并' };
    if ((hit.entry.project || '') !== (first.entry.project || '')) return { ok: false, error: 'bad-merge', message: '不能跨项目合并' };
  }
  if (patch.source !== undefined && normalizeSource(patch.source) === 'quote') {
    return { ok: false, error: 'quote-locked', message: '不能把合并结果改成原话' };
  }
  const merged = updateEntry(root, first.entry.id, {
    ...patch,
    source: patch.source ?? first.entry.source
  }, { actor, now, note: note || '整理合并' });
  if (!merged.ok) return merged;
  const archived = [];
  for (const hit of found.slice(1)) {
    const res = setStatus(root, hit.entry.id, 'archived', {
      actor,
      now,
      note: '合并到 ' + first.entry.id
    });
    if (!res.ok) return { ...res, merged: merged.entry, archived };
    archived.push(hit.entry.id);
  }
  return { ok: true, entry: merged.entry, changed: merged.changed ?? 0, archived, mergedInto: first.entry.id, warnings: merged.warnings ?? [] };
}
