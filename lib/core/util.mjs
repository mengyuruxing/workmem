// lib/core/util.mjs — 纯工具：时间、原子写、JSON、文本归一。
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DAY_MS = 86400000;

const pad = (n) => String(n).padStart(2, '0');

/** 本地时区 ISO 8601，例如 2026-11-02T15:00:00+08:00。 */
export function isoNow(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
    sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
}

export function isoFromMs(ms) {
  const n = Number(ms);
  return Number.isFinite(n) ? isoNow(new Date(n)) : '';
}

export function parseTime(value) {
  if (value == null || value === '') return NaN;
  const n = Date.parse(String(value));
  return Number.isNaN(n) ? NaN : n;
}

export function nowMs() {
  return Date.now();
}

export function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function truncate(value, max = 2000) {
  const s = String(value ?? '');
  return s.length <= max ? s : s.slice(0, max) + '…';
}

export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\r\n?/g, '\n');
}

/** 正文存储用：只统一换行，不做 NFKC，保住原话字形。 */
export function normalizeBody(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

export function normalizeTitle(value, max = 40) {
  const s = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max);
}

export function splitKeywords(value) {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  if (value == null || String(value).trim() === '') return [];
  return String(value).split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean);
}

export function normalizeProject(value) {
  const s = String(value ?? '').trim();
  if (s === '' || s === '全局' || s.toLowerCase() === 'global') return '';
  return s;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback) {
  try {
    const text = readFileSync(file, 'utf8');
    if (text.trim() === '') return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** 同步原子写：临时文件 → fsync → rename。 */
export function atomicWriteFile(file, text) {
  ensureDir(dirname(file));
  const tmp = file + '.tmp-' + process.pid + '-' + randomBytes(4).toString('hex');
  let fd = null;
  try {
    fd = openSync(tmp, 'w');
    writeFileSync(fd, String(text), 'utf8');
    try { fsyncSync(fd); } catch {}
  } catch (e) {
    if (fd !== null) { try { closeSync(fd); fd = null; } catch {} }
    try { unlinkSync(tmp); } catch {}
    throw e;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch {} }
  }
  try {
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
}

export function atomicWriteJson(file, value) {
  atomicWriteFile(file, JSON.stringify(value, null, 2) + '\n');
}

export function deepMerge(base, patch) {
  if (patch == null) return structuredClone(base);
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return structuredClone(patch);
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return structuredClone(patch);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = structuredClone(v);
    }
  }
  return out;
}

/** 中文 bigram 相似度，用于同分类去重合并。 */
export function similarity(a, b) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
  const grams = (s) => {
    const t = norm(s);
    const set = new Set();
    for (let i = 0; i + 1 < t.length; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

const SENSITIVE_RE = /(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9]{16,})/i;

export function looksSensitive(text) {
  return SENSITIVE_RE.test(String(text ?? ''));
}
