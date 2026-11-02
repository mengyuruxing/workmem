// lib/core/entry.mjs — Markdown 条目解析/序列化。纯函数，不碰文件。
import { randomBytes } from 'node:crypto';
import {
  isoNow,
  normalizeBody,
  normalizeTitle,
  normalizeProject,
  splitKeywords
} from './util.mjs';

export const CATEGORIES = ['rules', 'facts', 'pitfalls', 'progress', 'persona'];

// 会话字段：一次对话＝一条记忆的出处（写入时你在哪个对话框里说的）。
// 与「项目」分工：项目＝这件事属于哪个主题（dsh / relay / 记忆库…），可跨对话；
// 会话＝这条是哪个对话框里记下来的。同一对话里可以改别的项目的记忆，两边都记。
const normalizeSession = (value) =>
  String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 120);

export const CATEGORY_META = {
  rules: { key: 'rules', file: 'work/rules.md', title: '规矩' },
  facts: { key: 'facts', file: 'work/facts.md', title: '事实' },
  pitfalls: { key: 'pitfalls', file: 'work/pitfalls.md', title: '坑' },
  progress: { key: 'progress', file: 'work/progress.md', title: '进度' },
  persona: { key: 'persona', file: 'persona/persona.md', title: '人设' }
};

export const MODES = ['work', 'mixed', 'companion'];

export const SOURCE_LABELS = {
  quote: '原话',
  summary: '总结',
  judgment: '判断',
  tool: '工具'
};

const SOURCE_KEYS = {
  '原话': 'quote',
  '主人原话': 'quote',
  quote: 'quote',
  original: 'quote',
  '总结': 'summary',
  '提炼': 'summary',
  summary: 'summary',
  '判断': 'judgment',
  '推断': 'judgment',
  judgment: 'judgment',
  inference: 'judgment',
  '工具': 'tool',
  '工具输出': 'tool',
  tool: 'tool',
  'tool_output': 'tool',
  'tool-output': 'tool'
};

export const STATUS_LABELS = {
  active: '正常',
  archived: '已归档',
  revoked: '已作废'
};

const STATUS_KEYS = {
  '正常': 'active',
  active: 'active',
  '已归档': 'archived',
  archived: 'archived',
  '归档': 'archived',
  '已作废': 'revoked',
  revoked: 'revoked',
  '作废': 'revoked'
};

const ENTRY_RE = /^## \[([0-9a-f]{8})\] (.+?)\s*$/gm;
const META_RE = /^\s*[-*]\s*([^：:\n]{1,24}?)\s*[：:]\s*(.*)$/;

const KEY_ALIASES = {
  '来源': 'source',
  'source': 'source',
  '状态': 'status',
  'status': 'status',
  '重要度': 'importance',
  '重要': 'importance',
  'importance': 'importance',
  '项目': 'project',
  'project': 'project',
  '会话': 'session',
  '对话': 'session',
  'session': 'session',
  '关键词': 'keywords',
  'keyword': 'keywords',
  'keywords': 'keywords',
  '写入': 'created_at',
  '创建': 'created_at',
  'created': 'created_at',
  'created_at': 'created_at',
  '更新': 'updated_at',
  'updated': 'updated_at',
  'updated_at': 'updated_at',
  '原话已改': 'quote_edited',
  'quote_edited': 'quote_edited',
  '钉住': 'pinned',
  '置顶': 'pinned',
  'pinned': 'pinned'
};

export function newId() {
  return randomBytes(4).toString('hex');
}

export function normalizeSource(value) {
  if (value == null) return null;
  const key = String(value).trim();
  return SOURCE_KEYS[key] ?? SOURCE_KEYS[key.toLowerCase()] ?? null;
}

export function normalizeStatus(value) {
  if (value == null) return null;
  const key = String(value).trim();
  return STATUS_KEYS[key] ?? STATUS_KEYS[key.toLowerCase()] ?? null;
}

export function normalizeImportance(value) {
  if (value == null) return null;
  const s = String(value).trim();
  const stars = (s.match(/★/g) ?? []).length;
  if (stars >= 1 && stars <= 4) return stars;
  const n = Number(s);
  if (Number.isInteger(n) && n >= 1 && n <= 4) return n;
  return null;
}

function parseBool(value, fallback = false) {
  if (value == null) return fallback;
  const s = String(value).trim().toLowerCase();
  if (['是', 'true', '1', 'yes', 'y'].includes(s)) return true;
  if (['否', 'false', '0', 'no', 'n', ''].includes(s)) return false;
  return fallback;
}

function makeIssue(code, message) {
  return { code, message };
}

export function entryValid(entry) {
  return !entry || !Array.isArray(entry.issues) || entry.issues.length === 0;
}

function parseSection(section, { category, id, title, line }) {
  const text = normalizeBody(section);
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;

  const issues = [];
  const extra = [];
  const seen = new Set();
  let source = null;
  let status = null;
  let importance = null;
  let project = '';
  let session = '';
  let keywords = [];
  let createdAt = '';
  let updatedAt = '';
  let quoteEdited = false;
  let pinned = false;
  let sawMeta = false;

  while (i < lines.length) {
    const m = lines[i].match(META_RE);
    if (!m) break;
    sawMeta = true;
    const rawKey = m[1].trim();
    const rawValue = m[2].trim();
    const key = KEY_ALIASES[rawKey] ?? KEY_ALIASES[rawKey.toLowerCase()];
    if (!key) {
      extra.push({ key: rawKey, value: rawValue });
      i += 1;
      continue;
    }
    if (seen.has(key)) issues.push(makeIssue('duplicate-field', '字段重复：' + rawKey));
    seen.add(key);
    if (key === 'source') {
      const v = normalizeSource(rawValue);
      if (!v) issues.push(makeIssue('bad-source', '来源不认识：' + rawValue));
      else source = v;
    } else if (key === 'status') {
      const v = normalizeStatus(rawValue);
      if (!v) issues.push(makeIssue('bad-status', '状态不认识：' + rawValue));
      else status = v;
    } else if (key === 'importance') {
      const v = normalizeImportance(rawValue);
      if (!v) issues.push(makeIssue('bad-importance', '重要度必须是 ★1–4：' + rawValue));
      else importance = v;
    } else if (key === 'project') {
      project = normalizeProject(rawValue);
    } else if (key === 'session') {
      session = normalizeSession(rawValue);
    } else if (key === 'keywords') {
      keywords = splitKeywords(rawValue);
    } else if (key === 'created_at') {
      createdAt = rawValue;
    } else if (key === 'updated_at') {
      updatedAt = rawValue;
    } else if (key === 'quote_edited') {
      quoteEdited = parseBool(rawValue);
    } else if (key === 'pinned') {
      pinned = parseBool(rawValue);
    }
    i += 1;
  }

  while (i < lines.length && lines[i].trim() === '') i += 1;
  const content = lines.slice(i).join('\n').trim();

  if (!sawMeta) issues.push(makeIssue('missing-meta', '条目没有元数据块'));
  if (!source) {
    source = 'summary';
    issues.push(makeIssue('missing-source', '缺少来源，按“总结”处理'));
  }
  if (!status) {
    status = 'active';
    issues.push(makeIssue('missing-status', '缺少状态，按“正常”处理'));
  }
  if (!importance) {
    importance = 1;
    issues.push(makeIssue('missing-importance', '缺少重要度，按 ★1 处理'));
  }
  if (!createdAt) issues.push(makeIssue('missing-created', '缺少写入时间'));
  if (!updatedAt) {
    updatedAt = createdAt;
    issues.push(makeIssue('missing-updated', '缺少更新时间'));
  }
  if (!content) issues.push(makeIssue('empty-content', '正文为空'));
  if (source !== 'quote' && quoteEdited) {
    issues.push(makeIssue('quote-flag-on-non-quote', '非原话条目不应有“原话已改”'));
  }

  const entry = {
    id,
    category,
    title: normalizeTitle(title),
    content,
    source,
    status,
    importance,
    project,
    session,
    keywords,
    created_at: createdAt,
    updated_at: updatedAt,
    quote_edited: source === 'quote' ? quoteEdited : false,
    pinned,
    extra,
    line,
    issues
  };
  if (!entry.title) entry.issues.push(makeIssue('empty-title', '标题为空'));
  return entry;
}

/** 解析一个分类文件；返回条目和文件级警告。 */
export function parseCategoryFile(text, category) {
  if (!CATEGORY_META[category]) throw new Error('未知分类：' + category);
  const src = normalizeBody(text);
  const entries = [];
  const warnings = [];
  const seen = new Set();
  const matches = [...src.matchAll(ENTRY_RE)];

  for (let idx = 0; idx < matches.length; idx += 1) {
    const m = matches[idx];
    const start = m.index + m[0].length;
    const end = idx + 1 < matches.length ? matches[idx + 1].index : src.length;
    const line = src.slice(0, m.index).split('\n').length;
    const id = m[1];
    const title = m[2];
    const entry = parseSection(src.slice(start, end), { category, id, title, line });
    if (seen.has(id)) {
      entry.issues.push(makeIssue('duplicate-id', '文件内 id 重复：' + id));
      warnings.push({ code: 'duplicate-id', message: 'id 重复：' + id, id, line });
    }
    seen.add(id);
    for (const issue of entry.issues) {
      warnings.push({ ...issue, id, line });
    }
    entries.push(entry);
  }

  return { category, entries, warnings };
}

function entryToMarkdown(entry) {
  const lines = ['## [' + entry.id + '] ' + normalizeTitle(entry.title)];
  lines.push('- 来源：' + (SOURCE_LABELS[entry.source] ?? '总结'));
  lines.push('- 状态：' + (STATUS_LABELS[entry.status] ?? '正常'));
  lines.push('- 重要度：' + '★'.repeat(Math.min(4, Math.max(1, Number(entry.importance) || 1))));
  if (entry.project) lines.push('- 项目：' + entry.project);
  if (entry.session) lines.push('- 会话：' + entry.session);
  if (entry.keywords && entry.keywords.length) lines.push('- 关键词：' + entry.keywords.join(', '));
  if (entry.created_at) lines.push('- 写入：' + entry.created_at);
  if (entry.updated_at) lines.push('- 更新：' + entry.updated_at);
  if (entry.source === 'quote' && entry.quote_edited) lines.push('- 原话已改：是');
  if (entry.pinned) lines.push('- 钉住：是');
  for (const x of entry.extra ?? []) {
    if (!x || !x.key) continue;
    lines.push('- ' + x.key + '：' + String(x.value ?? ''));
  }
  lines.push('');
  lines.push(String(entry.content ?? '').trim());
  return lines.join('\n');
}

/** 序列化一个分类文件；顺序按传入顺序。 */
export function serializeCategoryFile(entries, category) {
  const meta = CATEGORY_META[category];
  if (!meta) throw new Error('未知分类：' + category);
  const parts = ['# ' + meta.title, ''];
  for (const entry of entries) {
    parts.push(entryToMarkdown(entry));
    parts.push('');
  }
  return parts.join('\n').replace(/\n+$/, '') + '\n';
}

/** 创建新条目（不落盘）。 */
export function makeEntry(input = {}) {
  const category = input.category;
  if (!CATEGORY_META[category]) throw new Error('未知分类：' + category);
  const now = input.now || isoNow();
  const source = normalizeSource(input.source) ?? 'summary';
  const status = normalizeStatus(input.status) ?? 'active';
  const importance = normalizeImportance(input.importance) ?? 1;
  return {
    id: input.id || newId(),
    category,
    title: normalizeTitle(input.title),
    content: normalizeBody(input.content).trim(),
    source,
    status,
    importance,
    project: normalizeProject(input.project),
    session: normalizeSession(input.session),
    keywords: splitKeywords(input.keywords),
    created_at: input.created_at || now,
    updated_at: input.updated_at || now,
    quote_edited: source === 'quote' ? Boolean(input.quote_edited) : false,
    pinned: Boolean(input.pinned),
    extra: Array.isArray(input.extra) ? input.extra.map((x) => ({ key: String(x.key), value: String(x.value ?? '') })) : [],
    line: 0,
    issues: []
  };
}
