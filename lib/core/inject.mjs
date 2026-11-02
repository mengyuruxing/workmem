// lib/core/inject.mjs — 注入块渲染：id、分类、来源、冷/热、引用规则。
import { CATEGORY_META, SOURCE_LABELS } from './entry.mjs';
import { truncate } from './util.mjs';
import { modeHint } from './mode.mjs';

export const CITATION_RULE = '说“我记得/你之前说过”时必须带条目 id 或标题；指不出就不许说，直接说没想起来。';

function lineOf(pick, cap) {
  const e = pick.entry;
  const category = CATEGORY_META[e.category]?.title ?? e.category;
  const source = e.source === 'quote' && e.quote_edited
    ? '原话已改'
    : (SOURCE_LABELS[e.source] ?? e.source);
  const zone = pick.zone === 'cold' ? '冷' : '热';
  const tag = pick.baseline ? '保底·' : '';
  return '- [id:' + e.id + '][' + category + '][' + source + '][' + tag + zone + '] ' +
    (e.title || '(无标题)') + '：' + truncate(e.content, cap).replace(/\n+/g, ' ');
}

export function renderInjection(picks, {
  mode = 'work',
  maxChars = 1000,
  baselineMaxChars = 300,
  hint = ''
} = {}) {
  if (!Array.isArray(picks) || picks.length === 0) return '';
  const seen = new Set();
  const unique = picks.filter((pick) => {
    const id = pick?.entry?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (unique.length === 0) return '';

  const baseline = unique.filter((pick) => pick.baseline);
  const retrieved = unique.filter((pick) => !pick.baseline);
  const lines = [
    '【长期记忆】以下是关于主人的既有记录；与当前任务无关就忽略，不要复述。',
    CITATION_RULE,
    '',
    modeHint(mode)
  ];
  if (hint) lines.push(hint);
  let used = lines.join('\n').length;

  if (baseline.length > 0) {
    lines.push('〔保底规矩〕');
    for (const pick of baseline) {
      const line = lineOf(pick, baselineMaxChars);
      const cost = line.length + 1;
      // 保底规矩优先，宁可挤掉后面的检索条，也不丢保底。
      if (used + cost > maxChars && baseline.length > 1) break;
      lines.push(line);
      used += cost;
    }
  }

  for (const pick of retrieved) {
    const line = lineOf(pick, 200);
    const cost = line.length + 1;
    if (used + cost > maxChars) break;
    lines.push(line);
    used += cost;
  }
  return lines.join('\n');
}

export function injectionIds(picks) {
  return (picks || []).map((p) => p?.entry?.id).filter(Boolean);
}

export function renderMissNote(reason) {
  return reason ? '（本轮未注入相关记忆：' + reason + '）' : '';
}
