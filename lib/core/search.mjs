// lib/core/search.mjs — 本地分词、索引、打分、门槛。不读文件。
import { clamp, normalizeText, normalizeProject } from './util.mjs';
import { factor as weightFactor, importanceFactor } from './weights.mjs';
import { getStat, zoneOf } from './stats.mjs';

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORD_RE = /[\p{L}\p{N}]/u;

const STOP_BIGRAMS = new Set(('这个 那个 这些 那些 这种 那种 这样 那样 这里 那里 这边 那边 什么 哪个 哪些 怎么 怎样 如何 多少 为什 干嘛 干啥 因为 所以 但是 可是 不过 然后 而且 并且 或者 还是 就是 也是 都是 只是 不是 没有 不能 不会 不用 不要 别的 已经 现在 可以 需要 应该 可能 一下 一个 一些 有点 有些 一点 一样 一次 一起 一直 一般 其实 实际 时候 东西 事情 问题 方法 内容 情况 方面 地方 部分 的话 关于 对于 根据 按照 为了 由于 通过 以及 之类 等等 自己 我们 你们 他们 她们 它们 大家 人家 别人 咱们 知道 觉得 认为 看到 说到 听到 告诉 想想 看看 试试 上面 下面 前面 后面 里面 外面 中间 旁边 左右 今天 明天 昨天 刚才 以后 以前 后来 好的 是的 对的 行了 好吧 行吧 对吧 是吧 了吗 了吧 嗯嗯 件事').split(/\s+/));
const NEVER_LEAD = new Set(Array.from('的了着过是在就都也还又再却并则而之其此该每各某谁哪很把被给从对向与及于由等吗呢吧啊呀哦嗯嘛得地会要能可说去来这那我你他她它们有没不'));
const STOP_CHARS = new Set(Array.from('的了是在我你他她它们这那有和就不都一也到说要去会没什么怎如为可需现已还但而或被把让给从对向与及之其此该每各某谁哪过又再却并则于由等吗呢吧啊呀哦嗯哈嘛得地很着自'));

function classOf(cp) {
  if (CJK_RE.test(cp)) return 'cjk';
  if (WORD_RE.test(cp)) return 'word';
  return 'skip';
}

/** 中文二字滑窗 + 英文/数字整词。 */
export function tokenize(text) {
  const cps = Array.from(normalizeText(text).toLowerCase());
  const out = [];
  let i = 0;
  while (i < cps.length) {
    const cls = classOf(cps[i]);
    if (cls === 'skip') { i += 1; continue; }
    let j = i + 1;
    while (j < cps.length && classOf(cps[j]) === cls) j += 1;
    const run = cps.slice(i, j);
    if (cls === 'cjk') {
      for (let k = 0; k + 1 < run.length; k += 1) {
        const bg = run[k] + run[k + 1];
        if (STOP_BIGRAMS.has(bg)) continue;
        if (NEVER_LEAD.has(bg[0])) continue;
        if (STOP_CHARS.has(bg[0]) && STOP_CHARS.has(bg[1])) continue;
        out.push(bg);
      }
      if (run.length === 1 && !STOP_CHARS.has(run[0])) out.push(run[0]);
    } else {
      out.push(run.join(''));
    }
    i = j;
  }
  return out;
}

/** 连续字面片段，用于整串命中加分。 */
export function charRuns(text) {
  const cps = Array.from(normalizeText(text).toLowerCase());
  const out = [];
  let i = 0;
  while (i < cps.length) {
    const cls = classOf(cps[i]);
    if (cls === 'skip') { i += 1; continue; }
    let j = i + 1;
    while (j < cps.length && classOf(cps[j]) === cls) j += 1;
    const run = cps.slice(i, j).join('');
    if (run.length >= 2 || cls === 'word') out.push(run);
    i = j;
  }
  return out;
}

export function longestCommonRun(aRuns, bRuns) {
  let best = 0;
  for (const a of aRuns) {
    for (const b of bRuns) {
      const n = Math.min(a.length, b.length);
      if (n <= best) continue;
      let prev = new Array(b.length + 1).fill(0);
      for (let i = 1; i <= a.length; i += 1) {
        const cur = new Array(b.length + 1).fill(0);
        for (let j = 1; j <= b.length; j += 1) {
          if (a[i - 1] === b[j - 1]) {
            cur[j] = prev[j - 1] + 1;
            if (cur[j] > best) best = cur[j];
          }
        }
        prev = cur;
      }
    }
  }
  return best;
}

export function buildIdf(docs) {
  const df = new Map();
  for (const doc of docs) {
    for (const token of doc.tokens) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const N = docs.length;
  const idf = new Map();
  for (const [token, count] of df) {
    idf.set(token, Math.max(0.1, Math.log((N + 1) / (count + 0.5)) + 0.1));
  }
  return idf;
}

export function makeDoc(entry) {
  const titleTokens = new Set(tokenize(entry.title));
  const kwTokens = new Set(tokenize((entry.keywords || []).join(' ')));
  const bodyTokens = new Set(tokenize(entry.content));
  const tokens = new Set([...titleTokens, ...kwTokens, ...bodyTokens]);
  const runs = charRuns([entry.title, (entry.keywords || []).join(' '), entry.content].join('\n'));
  return { entry, titleTokens, kwTokens, bodyTokens, tokens, runs };
}

export function buildIndex(entries, { now = Date.now(), statuses = ['active'] } = {}) {
  const allowed = new Set(statuses);
  const active = entries.filter((e) => e && allowed.has(e.status) && e.issues && e.issues.length === 0);
  const docs = active.map(makeDoc);
  return { docs, idf: buildIdf(docs), size: docs.length, now, builtAt: Date.now(), statuses: [...allowed] };
}

function idfOf(token, idf, fallback = 2) {
  return idf.get(token) ?? fallback;
}

function scoreDoc(doc, queryTokens, idf, queryRuns) {
  let hitMass = 0;
  let titleMass = 0;
  let kwMass = 0;
  let best = 0;
  const hitTokens = [];
  let bestToken = null;
  for (const token of queryTokens) {
    const value = idfOf(token, idf);
    if (!doc.tokens.has(token)) continue;
    hitMass += value;
    if (doc.titleTokens.has(token)) titleMass += value;
    if (doc.kwTokens.has(token)) kwMass += value;
    if (value > best) { best = value; bestToken = token; }
    hitTokens.push(token);
  }
  if (hitMass <= 0) return null;
  const run = longestCommonRun(queryRuns, doc.runs);
  const base = hitMass + titleMass * 0.8 + kwMass * 0.8 + (run >= 4 ? Math.min(3, (run - 3) * 0.6) : 0);
  const inTitle = bestToken ? doc.titleTokens.has(bestToken) : false;
  const inKw = bestToken ? doc.kwTokens.has(bestToken) : false;
  const reason = titleMass > 0 && kwMass > 0 ? 'title+kw'
    : titleMass > 0 ? 'title'
      : kwMass > 0 ? 'kw'
        : run >= 4 ? 'run' : 'body';
  return { base, hitMass, best, hitTokens, inTitle, inKw, run, reason };
}

function projectFactor(project, currentProject) {
  const p = normalizeProject(project);
  if (!p) return 1.0;
  const current = String(currentProject ?? '').trim();
  if (!current) return 1.0;
  const list = p.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return list.includes(current.toLowerCase()) ? 1.1 : 0.9;
}

function zoneFactors(doc, stats, coldDays, coldFactor, now) {
  const stat = getStat(stats, doc.entry.id, doc.entry);
  const zone = zoneOf(doc.entry, stat, coldDays, now);
  return { zone, value: zone === 'cold' ? coldFactor : 1.0 };
}

/**
 * 自动检索：先过相关门槛，再乘分类权重/重要度/冷热/项目。
 * 手动检索：gate=false，同一套分数，不设门槛。
 */
export function search(index, query, opts = {}) {
  const o = {
    gate: true,
    mode: 'work',
    topK: 3,
    budgetChars: 800,
    minCoverage: 0.2,
    minCovHard: 0.4,
    relBar: 0.62,
    minScore: 9,
    coldDays: 14,
    now: Date.now(),
    currentProject: '',
    weights: null,
    stats: null,
    recentIds: [],
    ...opts
  };
  const q = [...new Set(tokenize(query))];
  const qRuns = charRuns(query);
  const diag = {
    queryTokens: q.length,
    pool: index.docs.length,
    topBase: 0,
    topFinal: 0,
    threshold: 0,
    sizeFactor: 1,
    reason: null,
    nearMiss: [],
    picks: 0
  };
  if (q.length === 0) { diag.reason = 'empty-query'; return { picks: [], diagnostics: diag }; }
  if (index.docs.length === 0) { diag.reason = 'empty-pool'; return { picks: [], diagnostics: diag }; }

  const qMass = q.reduce((sum, t) => sum + idfOf(t, index.idf), 0);
  const scored = [];
  for (const doc of index.docs) {
    const s = scoreDoc(doc, q, index.idf, qRuns);
    if (!s) continue;
    s.coverage = qMass > 0 ? s.hitMass / qMass : 0;
    scored.push({ ...s, doc });
  }
  if (scored.length === 0) { diag.reason = 'no-token-overlap'; return { picks: [], diagnostics: diag }; }
  scored.sort((a, b) => b.base - a.base);
  diag.topBase = Number(scored[0].base.toFixed(3));
  const N = index.docs.length;
  const sizeFactor = clamp(Math.log10(N + 10) / 3, 0.25, 1);
  const minScoreEff = o.minScore * sizeFactor;
  const bar = Math.max(minScoreEff, scored[0].base * o.relBar);
  diag.sizeFactor = Number(sizeFactor.toFixed(2));
  diag.threshold = o.gate ? Number(bar.toFixed(3)) : 0;

  const passed = [];
  for (const s of scored) {
    if (!o.gate) { passed.push(s); continue; }
    const coverage = s.coverage;
    const titleOrKw = s.inTitle || s.inKw;
    // 小库 IDF 天然偏低，不能拿大库的绝对分去卡；但必须压住标题/关键词。
    const smallOk = N < 20 && coverage >= 0.5 && titleOrKw && s.best >= 0.8;
    const tinyOk = N < 5 && coverage >= 0.8 && titleOrKw;
    if (!smallOk && !tinyOk && s.base < bar) continue;
    if (coverage < o.minCoverage && s.run < 4) continue;
    if (!s.inTitle && !s.inKw && coverage < o.minCovHard) continue;
    passed.push(s);
  }
  if (passed.length === 0) {
    diag.reason = 'weak-match';
    diag.nearMiss = scored.slice(0, 3).map((s) => ({
      id: s.doc.entry.id,
      title: s.doc.entry.title,
      category: s.doc.entry.category,
      base: Number(s.base.toFixed(2)),
      best: Number(s.best.toFixed(2)),
      coverage: Number(s.coverage.toFixed(2)),
      run: s.run
    }));
    return { picks: [], diagnostics: diag };
  }

  const recent = new Set(o.recentIds || []);
  const weighted = [];
  for (const s of passed) {
    const rawCategoryWeight = weightFactor(o.weights, s.doc.entry.category, o.mode);
    // 手动搜索不受模式权重“忽略”影响；自动检索才按权重出局。
    const categoryWeight = o.gate ? rawCategoryWeight : Math.max(0.1, rawCategoryWeight);
    if (o.gate && categoryWeight <= 0) continue;
    const iw = importanceFactor(o.weights, s.doc.entry.importance);
    const z = zoneFactors(s.doc, o.stats, o.coldDays, o.weights?.coldFactor ?? 0.7, o.now);
    const pw = projectFactor(s.doc.entry.project, o.currentProject);
    const final = s.base * categoryWeight * iw * z.value * pw;
    weighted.push({
      entry: s.doc.entry,
      base: Number(s.base.toFixed(3)),
      coverage: Number(s.coverage.toFixed(3)),
      final: Number(final.toFixed(3)),
      reason: s.reason,
      zone: z.zone,
      run: s.run,
      factors: {
        categoryWeight: Number(categoryWeight.toFixed(2)),
        importance: Number(iw.toFixed(2)),
        zone: Number(z.value.toFixed(2)),
        project: Number(pw.toFixed(2))
      }
    });
  }
  if (weighted.length === 0) { diag.reason = 'weighted-out'; return { picks: [], diagnostics: diag }; }
  weighted.sort((a, b) => b.final - a.final || b.base - a.base);
  const filtered = weighted.filter((x) => !recent.has(x.entry.id));
  const limit = o.gate ? Math.max(1, Number(o.topK) || 3) : Math.max(1, Number(o.topK) || 50);
  const budget = o.gate ? Math.max(0, Number(o.budgetChars) || 0) : 0;
  const picks = [];
  let used = 0;
  for (const item of filtered) {
    const len = String(item.entry.content ?? '').length;
    if (picks.length > 0 && budget > 0 && used + len > budget) continue;
    picks.push(item);
    used += len;
    if (picks.length >= limit) break;
  }
  if (picks.length === 0) { diag.reason = 'dedupe-filtered'; return { picks: [], diagnostics: diag }; }
  diag.topFinal = Number(picks[0].final.toFixed(3));
  diag.reason = 'ok';
  diag.picks = picks.length;
  return { picks, diagnostics: diag };
}

export function manualSearch(index, query, opts = {}) {
  return search(index, query, { ...opts, gate: false, topK: opts.topK ?? 50 });
}

/** 面板/自检用的“为什么没命中”文案。 */
export function explainMiss(diag) {
  switch (diag?.reason) {
    case 'empty-query': return '查询里没有可检索的词';
    case 'empty-pool': return '记忆库是空的';
    case 'no-token-overlap': return '没有任何词重叠';
    case 'weak-match': return '有词重叠，但分数没过门槛';
    case 'weighted-out': return '当前模式下这些分类的权重是“忽略”';
    case 'dedupe-filtered': return '最近几轮已经注入过';
    default: return diag?.reason || '未命中';
  }
}
