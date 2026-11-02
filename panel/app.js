const API = '/workmem/panel';

const MODES = [
  { key: 'work', label: '干活' },
  { key: 'mixed', label: '混合' },
  { key: 'companion', label: '陪人' }
];
const MODE_LABEL = Object.fromEntries(MODES.map((m) => [m.key, m.label]));

const CATEGORIES = [
  { key: 'rules', label: '规矩' },
  { key: 'facts', label: '事实' },
  { key: 'pitfalls', label: '坑' },
  { key: 'progress', label: '进度' },
  { key: 'persona', label: '人设' }
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

const SOURCES = [
  { key: 'quote', label: '原话' },
  { key: 'summary', label: '总结' },
  { key: 'judgment', label: '判断' },
  { key: 'tool', label: '工具' }
];

const LEVELS = [
  { key: 'ignore', label: '忽略' },
  { key: 'low', label: '低' },
  { key: 'normal', label: '正常' },
  { key: 'high', label: '高' },
  { key: 'max', label: '最高' }
];

const DEFAULTS = {
  rules: { work: 'max', mixed: 'high', companion: 'normal' },
  facts: { work: 'high', mixed: 'normal', companion: 'low' },
  pitfalls: { work: 'high', mixed: 'normal', companion: 'low' },
  progress: { work: 'normal', mixed: 'normal', companion: 'low' },
  persona: { work: 'low', mixed: 'normal', companion: 'max' }
};

const TYPE_LABEL = {
  create: '记',
  edit: '改',
  archive: '归档',
  revoke: '作废',
  restore: '恢复',
  recall: '想起',
  miss: '没想起',
  snapshot: '快照',
  rollback: '回滚',
  'write-error': '写失败',
  weights: '权重',
  mode: '模式',
  manual: '搜',
  cold: '冷区',
  consolidate: '整理'
};

const MATCH_LABEL = {
  title: '标题',
  kw: '关键词',
  'title+kw': '标题+关键词',
  run: '整串',
  body: '正文'
};

const state = {
  mode: 'mixed',
  locked: false,
  stats: null,
  weights: null,
  consolidation: null,
  list: [],
  timeline: [],
  snapshots: [],
  filters: { category: 'all', status: 'active', cold: 'all', project: '', session: '', source: '' },
  q: '',
  searchDiag: null,
  detail: null,
  detailError: '',
  diagnostics: null,
  loading: true,
  error: '',
  timelineOpen: false
};

const els = {};
let searchTimer = null;
let errorTimer = null;

function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function fold(title, { open = false, note = '' } = {}, ...children) {
  const box = h('details', { class: 'wm-fold', open: open ? true : null });
  box.append(h('summary', null, h('span', null, title), note ? h('span', { class: 'wm-fold-note' }, note) : null));
  for (const child of children.flat(Infinity)) if (child != null) box.append(child);
  return box;
}

function makeSelect(value, options, onchange, className = '') {
  const select = h('select', { class: className, onchange });
  for (const opt of options) select.append(h('option', { value: opt.key, text: opt.label }));
  select.value = value;
  return select;
}

async function api(path, { method = 'GET', body = null } = {}) {
  const options = { method, headers: {} };
  if (body != null) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(API + path, options);
  let json;
  try { json = await res.json(); } catch { throw new Error('接口返回不是 JSON'); }
  if (!json.ok) throw new Error(json.message || json.error || '请求失败');
  return json.data;
}

function fmtTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function stars(n) {
  return '★'.repeat(Math.min(4, Math.max(1, Number(n) || 1)));
}

function setError(message) {
  state.error = message || '';
  if (!els.error) return;
  els.error.textContent = state.error;
  els.error.hidden = !state.error;
  if (errorTimer) clearTimeout(errorTimer);
  if (state.error) errorTimer = setTimeout(() => { state.error = ''; if (els.error) els.error.hidden = true; }, 8000);
}

async function guard(fn) {
  try { await fn(); } catch (e) {
    const message = e?.message || String(e);
    if (state.detail) {
      state.detailError = message;
      renderDetail();
    } else {
      setError(message);
    }
  }
}

function renderShell() {
  const app = document.getElementById('app');
  app.replaceChildren();

  els.header = h('header', { class: 'wm-header' });
  els.error = h('div', { class: 'wm-error', hidden: true });
  els.consolidation = h('section', { class: 'wm-block' });
  els.weights = h('section', { class: 'wm-block' });
  els.settingsLayer = h('div', { class: 'wm-modal-bg', hidden: true });
  els.settingsLayer.addEventListener('click', (e) => { if (e.target === els.settingsLayer) closeSettings(); });
  els.settingsLayer.append(h('div', { class: 'wm-modal wm-settings' },
    h('div', { class: 'wm-modal-head' },
      h('b', null, '设置'),
      h('span', { class: 'wm-sec-note' }, '整理节奏与分类权重'),
      h('span', { class: 'wm-grow' }),
      h('button', { onclick: closeSettings }, '关闭')
    ),
    h('div', { class: 'wm-modal-body' }, els.consolidation, els.weights)
  ));

  els.searchInput = h('input', {
    type: 'search',
    placeholder: '搜标题、正文、关键词（手动查询不受门槛限制）',
    value: state.q,
    oninput: (e) => {
      state.q = e.target.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => guard(() => refreshList()), 260);
    },
    onkeydown: (e) => { if (e.key === 'Enter') guard(() => refreshList()); }
  });
  els.searchMeta = h('span', { class: 'wm-search-meta' }, '');
  els.searchbar = h('div', { class: 'wm-searchbar' },
    els.searchInput,
    h('button', { onclick: () => guard(() => refreshList()) }, '搜索'),
    els.searchMeta
  );
  els.list = h('div', { class: 'wm-list' }, h('div', { class: 'wm-empty' }, '正在读取…'));

  els.side = h('aside', { class: 'wm-side' });
  els.content = h('section', { class: 'wm-content' }, els.searchbar, els.list);
  els.main = h('div', { class: 'wm-main' }, els.side, els.content);

  els.timeline = h('section', { class: 'wm-timeline' });
  els.modalLayer = h('div', { class: 'wm-modal-bg', hidden: true });
  els.modalLayer.addEventListener('click', (e) => {
    if (e.target === els.modalLayer) closeDetail();
  });
  els.diagLayer = h('div', { class: 'wm-modal-bg', hidden: true });
  els.diagLayer.addEventListener('click', (e) => {
    if (e.target === els.diagLayer) closeDiagnostics();
  });

  app.append(els.header, els.error, els.main, els.timeline, els.modalLayer, els.diagLayer, els.settingsLayer);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.detail) closeDetail();
    else if (state.diagnostics) closeDiagnostics();
    else closeSettings();
  });
}

function renderHeader() {
  if (!els.header) return;
  const health = state.stats?.health;
  const dot = h('span', { class: 'wm-dot' });
  const healthColor = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)' }[health?.color];
  dot.style.background = healthColor || health?.color || 'var(--faint)';
  const modeButtons = MODES.map((m) => h('button', {
    class: state.mode === m.key ? 'on' : '',
    onclick: () => guard(() => setMode(m.key))
  }, m.label));
  const showReason = health?.reason && health?.color !== 'green';

  els.header.replaceChildren(
    h('div', { class: 'wm-header-left' },
      h('div', { class: 'wm-brand' }, h('b', null, '工作记忆'), h('span', { class: 'wm-sub' }, '本地 · 零成本')),
      h('div', { class: 'wm-seg' }, modeButtons),
      h('button', {
        class: 'wm-pill' + (state.locked ? ' locked' : ''),
        title: state.locked ? '当前手动锁定，点一下交还自动' : '当前自动判断，点一下锁定当前模式',
        onclick: () => guard(toggleAuto)
      }, state.locked ? '手动' : '自动')
    ),
    h('div', { class: 'wm-header-right' },
      h('div', { class: 'wm-health', title: health?.line || '' },
        dot,
        h('span', { class: 'wm-health-line' }, health?.line || '健康数据读取中…'),
        showReason ? h('span', { class: 'wm-health-reason' }, health.reason) : null
      ),
      h('button', { class: 'wm-ghost', onclick: () => guard(openDiagnostics) }, '自检'),
      h('button', { class: 'wm-ghost', onclick: openSettings }, '设置'),
      h('button', { class: 'wm-primary', onclick: openNew }, '新建')
    )
  );
}

function openSettings() {
  if (!els.settingsLayer) return;
  els.settingsLayer.hidden = false;
  renderConsolidation();
  renderWeights();
}

function closeSettings() {
  if (!els.settingsLayer) return;
  els.settingsLayer.hidden = true;
}

async function saveConsolidation(patch) {
  const info = await api('/consolidation', { method: 'POST', body: patch });
  state.consolidation = info;
  renderConsolidation();
}

async function runConsolidate() {
  const result = await api('/consolidate', { method: 'POST', body: {} });
  state.consolidation = await api('/consolidation').catch(() => state.consolidation);
  setError(result?.message || (result?.ok
    ? '整理完成：写入 ' + (result.wrote || 0) + ' 条，合并 ' + (result.merged || 0) + ' 条，跳过 ' + (result.skipped || 0) + ' 条'
    : '整理失败：' + (result?.error || '未知原因')));
  renderConsolidation();
  await loadAll();
}

function renderConsolidation() {
  if (!els.consolidation) return;
  const c = state.consolidation;
  if (!c) {
    els.consolidation.replaceChildren(h('div', { class: 'wm-consol-card' }, '整理接口读取中…'));
    return;
  }
  if (c.unavailable) {
    els.consolidation.replaceChildren(h('div', { class: 'wm-consol-card' }, '整理接口未加载（需要装有 DSH 的 workmem 插件）'));
    return;
  }
  const enabled = c.enabled !== false;
  const toggle = h('button', {
    class: 'wm-auto' + (enabled ? '' : ' locked'),
    onclick: () => guard(() => saveConsolidation({ enabled: !enabled }))
  }, enabled ? '自动整理：开' : '自动整理：关');
  const every = h('input', {
    type: 'number', min: '1', max: '200', value: String(c.everyTurns || 25),
    class: 'wm-consol-num',
    onchange: (e) => guard(() => saveConsolidation({ everyTurns: Number(e.target.value) || 25 }))
  });
  const due = c.running
    ? '正在整理…'
    : (enabled ? '距下次整理还差 ' + (c.dueIn ?? 0) + ' 轮' : '自动整理已关闭');
  const last = c.lastResult
    ? (c.lastResult.ok === false
      ? '上次失败：' + (c.lastResult.message || c.lastResult.error || '未知')
      : '上次：' + (c.lastAt ? fmtTime(c.lastAt) : '—') + ' · 写入 ' + (c.lastResult.wrote || 0) + ' · 合并 ' + (c.lastResult.merged || 0) + ' · 跳过 ' + (c.lastResult.skipped || 0))
    : '还没有整理记录';
  els.consolidation.replaceChildren(
    h('div', { class: 'wm-consol-card' },
      h('div', { class: 'wm-consol-main' },
        h('b', null, '整理当前对话'),
        h('span', { class: 'wm-consol-title', title: c.title || '' }, c.title || '（未命名对话）'),
        h('span', { class: 'wm-consol-due' }, due),
        h('span', { class: 'wm-grow' }),
        toggle,
        h('label', { class: 'wm-consol-every' }, '每 ', every, ' 轮'),
        h('button', { class: 'wm-primary', disabled: c.running ? true : null, onclick: () => guard(runConsolidate) }, c.running ? '整理中…' : '立即整理')
      ),
      h('div', { class: 'wm-consol-last' }, last)
    )
  );
}

function renderWeights() {
  if (!els.weights) return;
  const w = state.weights;
  if (!w) {
    els.weights.replaceChildren(h('div', { class: 'wm-loading' }, '权重读取中…'));
    return;
  }
  const rows = w.rows.map((row) => {
    const count = state.stats?.categories?.[row.category]?.total ?? 0;
    const cells = w.modes.map((m) => {
      const cell = row.cells[m.key];
      const select = makeSelect(cell.level, LEVELS, (e) => {
        const level = e.target.value;
        guard(() => changeWeight(row.category, m.key, level));
      });
      return h('td', { class: state.mode === m.key ? 'on' : '' }, select);
    });
    return h('tr', null,
      h('td', null, h('div', { class: 'wm-cat' }, h('b', null, row.label), h('span', null, count + ' 条'))),
      ...cells
    );
  });

  const head = h('div', { class: 'wm-sec-head' },
    h('span', { class: 'wm-sec-title' }, '权重矩阵'),
    h('span', { class: 'wm-sec-note' },
      '当前列：' + (MODE_LABEL[state.mode] || state.mode) +
      ' · ' + (w.order || []).map((x) => x.label).join(' > ') +
      ' · 只影响已过相关门槛的条目'),
    h('span', { class: 'wm-grow' }),
    h('button', { onclick: () => guard(resetColumn) }, '恢复本列默认')
  );

  els.weights.replaceChildren(head, h('table', { class: 'wm-matrix' },
    h('thead', null, h('tr', null,
      h('th', null, '文件'),
      ...w.modes.map((m) => h('th', { class: state.mode === m.key ? 'on' : '' }, m.label))
    )),
    h('tbody', null, rows)
  ));
}

function renderSide() {
  if (!els.side) return;
  const counts = state.stats?.categories || {};
  const catButtons = [{ key: 'all', label: '全部' }, ...CATEGORIES].map((c) => h('button', {
    class: state.filters.category === c.key ? 'on' : '',
    onclick: () => guard(() => setFilter({ category: c.key }))
  }, c.label, h('span', null, String(c.key === 'all' ? (state.stats?.total ?? 0) : (counts[c.key]?.total ?? 0)))));

  const filterBox = h('div', { class: 'wm-box' },
    h('h3', null, '筛选'),
    h('div', { class: 'wm-field' },
      h('label', null, '冷暖'),
      makeSelect(state.filters.cold, [{ key: 'all', label: '全部' }, { key: 'hot', label: '只看热区' }, { key: 'cold', label: '只看冷区' }],
        (e) => guard(() => setFilter({ cold: e.target.value })))
    ),
    h('div', { class: 'wm-field' },
      h('label', null, '状态'),
      makeSelect(state.filters.status, [{ key: 'active', label: '正常' }, { key: 'all', label: '全部状态' }, { key: 'archived', label: '已归档' }, { key: 'revoked', label: '已作废' }],
        (e) => guard(() => setFilter({ status: e.target.value })))
    ),
    h('div', { class: 'wm-field' },
      h('label', null, '来源'),
      makeSelect(state.filters.source, [{ key: '', label: '全部' }, ...SOURCES],
        (e) => guard(() => setFilter({ source: e.target.value })))
    ),
    h('div', { class: 'wm-field' },
      h('label', null, '项目'),
      h('input', {
        value: state.filters.project,
        placeholder: '留空看全部',
        onchange: (e) => guard(() => setFilter({ project: e.target.value }))
      })
    ),
    h('div', { class: 'wm-field' },
      h('label', null, '会话'),
      h('input', {
        value: state.filters.session,
        placeholder: '留空看全部对话',
        onchange: (e) => guard(() => setFilter({ session: e.target.value }))
      })
    )
  );

  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const sessionRows = sessions.length
    ? sessions.slice(0, 8).map((g) => {
      const key = g.session === '（未标会话）' ? '__none__' : g.session;
      const on = state.filters.session === key;
      const projNames = Object.keys(g.projects || {});
      return h('div', {
        class: 'wm-snap-row' + (on ? ' on' : ''),
        title: (g.session || '') + ' · ' + g.count + ' 条' + (projNames.length ? ' · 涉及项目：' + projNames.join('、') : ''),
        style: 'cursor:pointer',
        onclick: () => guard(() => setFilter({ session: on ? '' : key }))
      },
        h('span', { class: 'wm-snap-name', style: 'max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
          (on ? '✓ ' : '') + String(g.session || '').slice(0, 40)),
        h('span', { class: 'wm-tl-time' }, String(g.count))
      );
    })
    : [h('div', { class: 'wm-snap-name' }, '还没有标过对话')];

  const sessionBox = fold('按对话', { open: Boolean(state.filters.session), note: sessions.length ? sessions.length + ' 个' : '空' },
    h('div', { class: 'wm-hint' }, '一次对话一条出处；同一对话可以改别的项目的记忆'),
    ...sessionRows,
    state.filters.session ? h('div', { class: 'wm-actions' }, h('button', { onclick: () => guard(() => setFilter({ session: '' })) }, '看全部对话')) : null
  );

  const snapBox = fold('快照', { note: state.snapshots.length ? state.snapshots.length + ' 个' : '无' },
    h('div', { class: 'wm-actions' }, h('button', { onclick: () => guard(createSnapshot) }, '拍快照')),
    ...(state.snapshots.length
      ? state.snapshots.slice(0, 6).map((s) => h('div', { class: 'wm-snap-row' },
        h('span', { class: 'wm-snap-name', title: s.name }, (s.createdAt ? fmtTime(s.createdAt) + ' · ' : '') + s.name),
        h('button', { onclick: () => guard(() => rollbackSnapshot(s.name)) }, '回滚')
      ))
      : [h('div', { class: 'wm-snap-name' }, '还没有快照')])
  );

  els.side.replaceChildren(
    h('div', { class: 'wm-box' }, h('h3', null, '分类'), h('div', { class: 'wm-filter-list' }, catButtons)),
    filterBox,
    sessionBox,
    snapBox
  );
}

function filteredItems() {
  const items = Array.isArray(state.list) ? state.list : [];
  const f = state.filters;
  return items.filter((item) => {
    if (f.category !== 'all' && item.category !== f.category) return false;
    if (f.status !== 'all' && item.status !== f.status) return false;
    if (f.source && item.source !== f.source) return false;
    if (f.cold === 'cold' && item.zone !== 'cold') return false;
    if (f.cold === 'hot' && item.zone !== 'hot') return false;
    if (f.project && !String(item.project || '').toLowerCase().includes(f.project.toLowerCase())) return false;
    if (f.session === '__none__') {
      if (String(item.session || '').trim()) return false;
    } else if (f.session && !String(item.session || '').toLowerCase().includes(f.session.toLowerCase())) return false;
    return true;
  });
}

function renderList() {
  if (!els.list) return;
  if (state.loading) {
    els.list.replaceChildren(h('div', { class: 'wm-empty' }, '正在读取…'));
    return;
  }
  const items = filteredItems();
  if (els.searchMeta) {
    els.searchMeta.textContent = state.q
      ? '手动搜索 · ' + items.length + ' 条 · 门槛关闭'
      : '共 ' + items.length + ' 条';
  }
  if (items.length === 0) {
    els.list.replaceChildren(h('div', { class: 'wm-empty' },
      state.q ? '没有搜到；试试更短的关键词，或把状态切到“全部状态”。' : '这个筛选下没有条目。')
    );
    return;
  }
  const cards = items.map((item) => {
    const head = h('div', { class: 'wm-card-head' },
      h('span', { class: 'wm-badge cat' }, item.categoryLabel || CATEGORY_LABEL[item.category] || item.category),
      h('span', { class: 'wm-card-title' }, item.title || '(无标题)'),
      h('span', { class: 'wm-badge ' + (item.zone === 'cold' ? 'cold' : 'hot') }, item.zone === 'cold' ? '冷' : '热'),
      item.status !== 'active' ? h('span', { class: 'wm-badge warn' }, item.statusLabel || item.status) : null,
      item.quote_edited ? h('span', { class: 'wm-badge warn' }, '原话已改') : null,
      item.issues && item.issues.length ? h('span', { class: 'wm-badge bad' }, '损坏') : null
    );
    const meta = h('div', { class: 'wm-card-meta' },
      h('span', null, item.sourceLabel || item.source),
      h('span', null, stars(item.importance)),
      h('span', null, '用过 ' + (item.uses || 0) + ' 次'),
      h('span', null, fmtTime(item.created_at)),
      item.reason ? h('span', null, '命中 ' + (MATCH_LABEL[item.reason] || item.reason)) : null,
      item.score != null ? h('span', null, '分 ' + item.score) : null,
      item.project ? h('span', null, item.project) : null,
      item.session ? h('span', null, '对话 ' + item.session) : null
    );
    return h('div', {
      class: 'wm-card',
      onclick: () => guard(() => openDetail(item.id))
    }, head, h('div', { class: 'wm-card-text' }, item.preview || item.content || ''), meta);
  });
  els.list.replaceChildren(...cards);
}

function renderTimeline() {
  if (!els.timeline) return;
  const rows = (state.timeline || []).map((row) => {
    const label = TYPE_LABEL[row.type] || row.type;
    const clickable = row.item_id && row.type !== 'snapshot' && row.type !== 'rollback';
    return h('div', {
      class: 'wm-tl-row' + (clickable ? ' click' : ''),
      onclick: clickable ? () => guard(() => openDetail(row.item_id)) : null
    },
      h('span', { class: 'wm-tl-time' }, fmtTime(row.ts)),
      h('span', { class: 'wm-tl-type ' + row.type }, label),
      h('span', { class: 'wm-tl-text', title: (row.title || '') + ' ' + (row.detail || '') },
        (row.title || '') + (row.detail ? ' · ' + row.detail : ''))
    );
  });
  const open = Boolean(state.timelineOpen);
  els.timeline.replaceChildren(
    h('button', {
      class: 'wm-tl-head',
      onclick: () => { state.timelineOpen = !open; renderTimeline(); }
    },
      h('span', { class: 'wm-tl-caret' }, open ? '▾' : '▸'),
      h('span', { class: 'wm-sec-title' }, '时间轴'),
      h('span', { class: 'wm-sec-note' }, (state.timeline || []).length + ' 条 · 记了什么、想起了什么、改了什么'),
      h('span', { class: 'wm-grow' }),
      h('span', { class: 'wm-sec-note' }, open ? '收起' : '展开')
    ),
    open ? h('div', { class: 'wm-timeline-list' }, rows.length ? rows : h('div', { class: 'wm-empty' }, '还没有事件')) : null
  );
}

function renderDetail() {
  if (!els.modalLayer) return;
  const d = state.detail;
  if (!d) {
    els.modalLayer.hidden = true;
    els.modalLayer.replaceChildren();
    return;
  }
  els.modalLayer.hidden = false;
  const e = d.entry || {};
  const isNew = Boolean(d.new);
  const isQuote = !isNew && e.source === 'quote';

  const titleInput = h('input', { value: e.title || '' });
  const contentInput = h('textarea', { value: e.content || '' });
  contentInput.value = e.content || '';
  if (isQuote) {
    contentInput.readOnly = true;
    contentInput.className = 'wm-readonly';
  }
  const sourceSelect = makeSelect(e.source || 'summary', SOURCES, () => {});
  if (isQuote) sourceSelect.disabled = true;
  if (!isNew && e.source !== 'quote') {
    const quoteOption = [...sourceSelect.options].find((opt) => opt.value === 'quote');
    if (quoteOption) quoteOption.disabled = true;
  }
  const importanceSelect = makeSelect(String(e.importance || 1), [1, 2, 3, 4].map((n) => ({ key: String(n), label: String(n) + ' 星' })), () => {});
  const projectInput = h('input', { value: e.project || '', placeholder: '留空＝全局' });
  const sessionInput = h('input', { value: e.session || '', placeholder: '哪个对话里记的，可留空' });
  const keywordsInput = h('input', { value: (e.keywords || []).join(', '), placeholder: '逗号分隔，可留空' });
  const categorySelect = makeSelect(e.category || 'facts', CATEGORIES, () => {});
  const pinnedInput = h('input', { type: 'checkbox' });
  pinnedInput.checked = Boolean(e.pinned);

  const save = () => guard(async () => {
    const payload = {
      title: titleInput.value,
      content: contentInput.value,
      source: sourceSelect.value,
      importance: Number(importanceSelect.value),
      project: projectInput.value,
      session: sessionInput.value,
      keywords: keywordsInput.value,
      pinned: Boolean(pinnedInput.checked),
      note: isNew ? '面板新建' : '面板编辑'
    };
    if (isNew) payload.category = categorySelect.value;
    else payload.id = e.id;
    await api('/write', { method: 'POST', body: payload });
    state.detail = null;
    renderDetail();
    await loadAll();
  });

  const action = (path) => guard(async () => {
    await api(path, { method: 'POST', body: { id: e.id, note: '面板操作' } });
    state.detail = null;
    renderDetail();
    await loadAll();
  });

  const form = h('div', { class: 'wm-form-grid' },
    h('label', null, '分类',
      isNew ? categorySelect : h('div', { class: 'wm-factor' }, e.categoryLabel || CATEGORY_LABEL[e.category] || e.category)),
    h('label', null, '标题', titleInput),
    h('label', null, '来源', sourceSelect),
    h('label', null, '重要度', importanceSelect),
    h('label', null, '项目', projectInput),
    h('label', null, '会话', sessionInput),
    h('label', null, '关键词', keywordsInput),
    h('label', { class: 'wm-inline' }, '钉住（保底注入优先）', pinnedInput),
    h('label', { class: 'full' }, '正文', contentInput),
    isQuote ? h('div', { class: 'wm-hint full' }, '原话正文只读。要更正请作废这条，再新建一条原话。') : null
  );

  const issues = (e.issues || []).length
    ? h('div', { class: 'wm-issues' }, '格式问题：' + e.issues.map((x) => x.message || x.code).join('；'))
    : null;
  const formError = state.detailError ? h('div', { class: 'wm-issues' }, state.detailError) : null;

  const factor = d.factors
    ? h('div', { class: 'wm-factor' },
      '当前模式 ' + (d.mode?.label || '') + ' · 分类权重 ' + d.factors.categoryWeight +
      ' × 重要度 ' + d.factors.importance + ' × 冷热 ' + d.factors.cold +
      ' · ' + (d.factors.zone === 'cold' ? '冷区' : '热区'))
    : null;

  const audit = (d.audit || []).length
    ? h('div', { class: 'wm-audit' },
      h('h4', null, '修改记录'),
      ...d.audit.slice().reverse().map((a) => h('div', { class: 'wm-audit-row' },
        fmtTime(a.ts) + ' · ' + (a.actor || '—') + ' · ' + (a.action || '') +
        (a.field ? ' · ' + a.field : '') +
        (a.field ? '：' + String(a.before ?? '—') + ' → ' + String(a.after ?? '—') : '')
      ))
    )
    : null;

  const actions = h('div', { class: 'wm-actions' },
    h('button', { class: 'wm-primary', onclick: save }, isNew ? '写入' : '保存'),
    !isNew ? h('button', { onclick: () => guard(copyId) }, '复制 id') : null,
    !isNew && e.status !== 'archived' ? h('button', { onclick: () => action('/archive') }, '归档') : null,
    !isNew && e.status !== 'active' ? h('button', { onclick: () => action('/restore') }, '恢复') : null,
    !isNew && e.status !== 'revoked' ? h('button', { onclick: () => action('/revoke') }, '作废') : null
  );

  const modal = h('div', { class: 'wm-modal' },
    h('div', { class: 'wm-modal-head' },
      h('b', null, isNew ? '新建记忆' : '记忆详情'),
      isNew ? null : h('span', { class: 'wm-badge cat' }, e.categoryLabel || e.category),
      isNew ? null : h('span', { class: 'wm-badge ' + (e.zone === 'cold' ? 'cold' : 'hot') }, e.zone === 'cold' ? '冷' : '热'),
      e.quote_edited ? h('span', { class: 'wm-badge warn' }, '原话已改') : null,
      h('span', { class: 'wm-grow' }),
      h('button', { onclick: closeDetail }, '关闭')
    ),
    h('div', { class: 'wm-modal-body' },
      form, issues, formError, factor, actions, audit
    )
  );
  els.modalLayer.replaceChildren(modal);
}

function renderAll() {
  renderHeader();
  renderConsolidation();
  renderWeights();
  renderSide();
  renderList();
  renderTimeline();
  renderDetail();
  renderDiagnostics();
}

async function refreshList(render = true) {
  const query = String(els.searchInput?.value ?? state.q ?? '').trim();
  state.q = query;
  const params = new URLSearchParams({ mode: state.mode, limit: '200' });
  if (query) {
    const data = await api('/search?q=' + encodeURIComponent(query) + '&mode=' + encodeURIComponent(state.mode) + '&limit=200&status=' + encodeURIComponent(state.filters.status));
    state.list = data.items || [];
    state.searchDiag = data.diagnostics || null;
  } else {
    params.set('category', state.filters.category);
    params.set('status', state.filters.status);
    params.set('cold', state.filters.cold);
    params.set('source', state.filters.source);
    params.set('project', state.filters.project);
    const data = await api('/list?' + params.toString());
    state.list = data.items || [];
    state.searchDiag = null;
  }
  if (render) renderList();
}

async function loadAll() {
  state.loading = true;
  renderList();
  try {
    const [stats, weights, timeline, snapshots, consolidation, sessions] = await Promise.all([
      api('/stats?mode=' + encodeURIComponent(state.mode)),
      api('/weights?mode=' + encodeURIComponent(state.mode)),
      api('/timeline?limit=60'),
      api('/snapshots'),
      api('/consolidation').catch(() => ({ unavailable: true })),
      api('/sessions?limit=200').catch(() => ({ items: [] }))
    ]);
    state.stats = stats;
    state.weights = weights;
    state.timeline = timeline.items || [];
    state.snapshots = snapshots.items || [];
    state.consolidation = consolidation;
    state.sessions = sessions.items || [];
    await refreshList(false);
  } finally {
    state.loading = false;
    renderAll();
  }
}

async function setMode(mode) {
  await api('/mode', { method: 'POST', body: { mode } });
  state.mode = mode;
  state.locked = true;
  await loadAll();
}

async function toggleAuto() {
  if (state.locked) await api('/mode', { method: 'POST', body: { mode: 'auto' } });
  else await api('/mode', { method: 'POST', body: { mode: state.mode } });
  state.locked = !state.locked;
  await loadAll();
}

async function changeWeight(category, mode, level) {
  await api('/weights', { method: 'POST', body: { category, mode, level } });
  const [weights, stats] = await Promise.all([
    api('/weights?mode=' + encodeURIComponent(state.mode)),
    api('/stats?mode=' + encodeURIComponent(state.mode))
  ]);
  state.weights = weights;
  state.stats = stats;
  await refreshList(false);
  renderWeights();
  renderHeader();
  renderList();
}

async function resetColumn() {
  for (const row of state.weights?.rows || []) {
    const level = DEFAULTS[row.category]?.[state.mode];
    if (!level) continue;
    await api('/weights', { method: 'POST', body: { category: row.category, mode: state.mode, level } });
  }
  state.weights = await api('/weights?mode=' + encodeURIComponent(state.mode));
  state.stats = await api('/stats?mode=' + encodeURIComponent(state.mode));
  await refreshList(false);
  renderAll();
}

async function setFilter(patch) {
  Object.assign(state.filters, patch);
  await refreshList(false);
  renderSide();
  renderList();
}

function renderDiagnostics() {
  if (!els.diagLayer) return;
  const d = state.diagnostics;
  if (!d) {
    els.diagLayer.hidden = true;
    els.diagLayer.replaceChildren();
    return;
  }
  els.diagLayer.hidden = false;
  const health = d.health || {};
  const dot = h('span', { class: 'wm-dot' });
  dot.style.background = health.color || '#6d7782';
  const rows = (d.turns || []).map((t) => {
    let result;
    if (t.hit) {
      result = t.hits.map((x) => '[' + x.id + '][' + (x.categoryLabel || x.category || '') + '] ' + (x.title || '') + ' · ' + (x.reason || '') + (x.final == null ? '' : ' · ' + x.final)).join('；');
    } else {
      result = t.missReason || '未命中';
      if (t.nearMiss && t.nearMiss.length) {
        result += ' · 差一点：' + t.nearMiss.map((x) => (x.title || x.id) + ' ' + x.base).join('；');
      }
    }
    return h('tr', null,
      h('td', null, fmtTime(t.ts)),
      h('td', null, MODE_LABEL[t.mode] || t.mode || '—'),
      h('td', { class: 'wm-diag-q', title: t.query }, t.query || '—'),
      h('td', null, t.hit ? h('span', { class: 'wm-badge hot' }, '命中 ' + t.hits.length) : h('span', { class: 'wm-badge warn' }, '空手')),
      h('td', { class: 'wm-diag-result' }, result),
      h('td', null, String(t.ms ?? 0) + 'ms')
    );
  });
  const modal = h('div', { class: 'wm-modal wm-diag' },
    h('div', { class: 'wm-modal-head' },
      h('b', null, '自检'),
      dot,
      h('span', { class: 'wm-health-line' }, health.line || ''),
      health.reason ? h('span', { class: 'wm-badge warn' }, health.reason) : null,
      h('span', { class: 'wm-grow' }),
      h('button', { onclick: closeDiagnostics }, '关闭')
    ),
    h('div', { class: 'wm-modal-body' },
      h('div', { class: 'wm-factor' },
        '连续空手 ' + (health.consecutiveMiss ?? 0) + ' 轮 · 最近命中 ' +
        (health.lastHitTurnsAgo == null ? '无' : health.lastHitTurnsAgo + ' 轮前') +
        ' · 窗口 ' + (health.window ?? 30) + ' 轮'),
      rows.length
        ? h('div', { class: 'wm-diag-wrap' }, h('table', { class: 'wm-diag-table' },
          h('thead', null, h('tr', null,
            h('th', null, '时间'), h('th', null, '模式'), h('th', null, '问句'),
            h('th', null, '结果'), h('th', null, '命中/原因'), h('th', null, '耗时')
          )),
          h('tbody', null, rows)
        ))
        : h('div', { class: 'wm-empty' }, '还没有真实轮次')
    )
  );
  els.diagLayer.replaceChildren(modal);
}

async function openDiagnostics() {
  const data = await api('/diagnostics?limit=30');
  state.diagnostics = data;
  state.detail = null;
  renderDetail();
  renderDiagnostics();
}

function closeDiagnostics() {
  state.diagnostics = null;
  renderDiagnostics();
}

async function openDetail(id) {
  state.diagnostics = null;
  state.detailError = '';
  renderDiagnostics();
  const data = await api('/detail?id=' + encodeURIComponent(id) + '&mode=' + encodeURIComponent(state.mode));
  state.detail = data;
  renderDetail();
}

function openNew() {
  state.diagnostics = null;
  state.detailError = '';
  renderDiagnostics();
  state.detail = {
    new: true,
    entry: { category: 'facts', title: '', content: '', source: 'summary', importance: 2, project: '', session: '', keywords: [], status: 'active' },
    audit: []
  };
  renderDetail();
}

function closeDetail() {
  state.detail = null;
  state.detailError = '';
  renderDetail();
}

async function copyId() {
  const id = state.detail?.entry?.id;
  if (!id) return;
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(id);
  else setError('剪贴板不可用，id：' + id);
}

async function createSnapshot() {
  await api('/snapshot', { method: 'POST', body: { note: '面板快照' } });
  const [snapshots, timeline] = await Promise.all([api('/snapshots'), api('/timeline?limit=60')]);
  state.snapshots = snapshots.items || [];
  state.timeline = timeline.items || [];
  renderSide();
  renderTimeline();
}

async function rollbackSnapshot(name) {
  if (!confirm('回滚到快照 ' + name + '？回滚前会自动再拍一张安全快照。')) return;
  await api('/rollback', { method: 'POST', body: { name, note: '面板回滚' } });
  await loadAll();
}

async function boot() {
  renderShell();
  try {
    const mode = await api('/mode');
    state.locked = Boolean(mode.locked);
    if (state.locked && MODE_LABEL[mode.default]) state.mode = mode.default;
  } catch (e) {
    setError(e?.message || String(e));
  }
  try { await loadAll(); } catch (e) { setError(e?.message || String(e)); }
}

boot();
