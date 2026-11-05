/* client.js — 机忆（workmem）DSH 原生面板。
 *
 * 2026-11-05 改造：原来是 shell.overlay 右下角浮窗 + iframe 加载 /workmem/panel/。
 * 宿主 skill 明确规定不要用 iframe 嵌 Host 页面（拿不到主题 token、locale、明暗切换），
 * 所以整块 UI 用 React 重写，注册到 sidebar.panellist（侧栏图标）+ main（中央面板）。
 * 数据仍走同源 JSON 接口 /workmem/panel/*。
 *
 * 2026-11-05 晚 第二轮 UI 优化：
 *  - header 拆成「标题行 + 状态条」两段，不再挤成一行折成三行；
 *  - 列表补 loading 态与骨架，修掉首屏闪现「没有条目」；
 *  - 卡片压成「标题 / 摘要 / 元信息」三行紧凑结构，并高亮搜索词；
 *  - 分类徽章用 color-mix 出淡底，不再只有 2px 侧条；
 *  - 窄屏用 container query 让详情面板整屏覆盖，不挤列表；
 *  - 全部交互补 :focus-visible；去掉暗色下看不见的硬编码阴影。
 */
window.__ModuleLoader__.load({
  id: 'workmem',
  factory: (require) => {
    const reactModule = require('react');
    const React = reactModule && typeof reactModule.createElement === 'function'
      ? reactModule
      : (reactModule && reactModule.default);
    if (!React) return { apply() {}, inject: [] };

    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    const PANEL_ID = 'workmem';
    const PANEL_ORDER = 30;
    const API = '/workmem/panel';
    const CSS_ID = 'workmem-panel-style';

    const CATEGORIES = [
      { key: 'rules', label: '规矩', desc: '必须一直守的' },
      { key: 'facts', label: '事实', desc: '环境与结论' },
      { key: 'pitfalls', label: '坑', desc: '踩过一次别再踩' },
      { key: 'progress', label: '进度', desc: '做到哪了' }
    ];
    const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
    const SOURCES = [
      { key: 'quote', label: '原话' },
      { key: 'summary', label: '总结' },
      { key: 'judgment', label: '判断' },
      { key: 'tool', label: '工具' }
    ];
    const SOURCE_LABEL = Object.fromEntries(SOURCES.map((s) => [s.key, s.label]));
    const LEVELS = [
      { key: 'ignore', label: '忽略', value: 0 },
      { key: 'low', label: '低', value: 0.5 },
      { key: 'normal', label: '正常', value: 1 },
      { key: 'high', label: '高', value: 1.5 },
      { key: 'max', label: '最高', value: 2 }
    ];
    const TYPE_LABEL = {
      create: '记', edit: '改', archive: '归档', revoke: '作废', restore: '恢复',
      recall: '想起', miss: '没想起', snapshot: '快照', rollback: '回滚',
      'write-error': '写失败', weights: '权重', manual: '搜', cold: '冷区',
      consolidate: '整理', consolidation: '整理设置'
    };
    const EMPTY_FILTERS = { category: 'all', status: 'active', cold: 'all', session: '' };

    /* ---------- 接口 ---------- */

    async function api(path, { method = 'GET', body = null } = {}) {
      const init = { method, credentials: 'same-origin', headers: {} };
      if (body != null) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await fetch(API + path, init);
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      if (!json) throw new Error('接口返回不是 JSON（HTTP ' + res.status + '）');
      if (!json.ok) throw new Error(json.message || json.error || '请求失败');
      return json.data;
    }

    function fmtTime(value) {
      if (!value) return '—';
      const t = new Date(value);
      if (Number.isNaN(t.getTime())) return String(value);
      const pad = (n) => String(n).padStart(2, '0');
      return pad(t.getMonth() + 1) + '-' + pad(t.getDate()) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
    }

    function stars(n) {
      const k = Math.max(0, Math.min(4, Number(n) || 0));
      return '★'.repeat(k) || '·';
    }

    /* 把命中的关键词包成 <mark>，其余原样切片。没有命中就原样返回字符串。 */
    function highlight(text, query) {
      const s = String(text == null ? '' : text);
      const q = String(query || '').trim();
      if (!q) return s;
      const lower = s.toLowerCase();
      const target = q.toLowerCase();
      let at = lower.indexOf(target);
      if (at < 0) return s;
      const out = [];
      let from = 0;
      let n = 0;
      while (at >= 0 && n < 20) {
        if (at > from) out.push(s.slice(from, at));
        out.push(h('mark', { key: 'mk' + n, className: 'jy-mark' }, s.slice(at, at + target.length)));
        from = at + target.length;
        n += 1;
        at = lower.indexOf(target, from);
      }
      if (from < s.length) out.push(s.slice(from));
      return out;
    }

    /* ---------- 图标（侧栏只传 size / active） ---------- */

    function JiyiIcon(props) {
      const size = Number(props && props.size) || 16;
      const active = Boolean(props && props.active);
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        style: { display: 'block' }
      },
        h('rect', {
          x: 2.4, y: 2.1, width: 11.2, height: 11.8, rx: 2.6,
          stroke: 'currentColor',
          strokeWidth: active ? 1.6 : 1.3,
          fill: active ? 'currentColor' : 'none',
          fillOpacity: active ? 0.12 : 0
        }),
        h('path', {
          d: 'M5.6 6h4.8M5.6 8.4h4.8M5.6 10.8h2.8',
          stroke: 'currentColor',
          strokeWidth: active ? 1.6 : 1.3,
          strokeLinecap: 'round'
        })
      );
    }

    /* ---------- 小组件 ---------- */

    function Pill(props) {
      return h('span', { className: 'jy-pill' + (props.tone ? ' ' + props.tone : '') }, props.children);
    }

    function Field(props) {
      return h('label', { className: 'jy-field' + (props.wide ? ' wide' : '') },
        h('span', { className: 'jy-field-label' }, props.label),
        props.children
      );
    }

    function SegTabs(props) {
      return h('div', { className: 'jy-seg', role: 'tablist' },
        props.items.map((it) => h('button', {
          key: it.key,
          type: 'button',
          role: 'tab',
          'aria-selected': props.value === it.key,
          className: 'jy-seg-btn' + (props.value === it.key ? ' on' : ''),
          onClick: () => props.onChange(it.key)
        }, it.label))
      );
    }

    function PaneHead(props) {
      return h('div', { className: 'jy-pane-head' },
        h('h2', null, props.title),
        props.desc ? h('p', { className: 'jy-pane-desc' }, props.desc) : null,
        h('span', { className: 'jy-grow' }),
        props.children || null
      );
    }

    function Empty(props) {
      return h('div', { className: 'jy-empty' },
        h('div', { className: 'jy-empty-icon', 'aria-hidden': 'true' }, props.icon || '◍'),
        h('div', { className: 'jy-empty-title' }, props.title),
        props.hint ? h('div', { className: 'jy-empty-hint' }, props.hint) : null
      );
    }

    function Skeleton(props) {
      const rows = [];
      for (let i = 0; i < (props.rows || 5); i += 1) rows.push(h('div', { key: i, className: 'jy-skel-row' }));
      return h('div', { className: 'jy-skel', 'aria-hidden': 'true' }, rows);
    }

    /* ---------- 详情 / 编辑 ---------- */

    function ItemEditor(props) {
      const { detail, onClose, onSaved } = props;
      const isNew = Boolean(detail && detail.new);
      const entry = (detail && detail.entry) || {};
      const [form, setForm] = useState(() => ({
        category: entry.category || 'facts',
        title: entry.title || '',
        content: entry.content || '',
        source: entry.source || 'summary',
        importance: String(entry.importance || 2),
        project: entry.project || '',
        session: entry.session || '',
        keywords: (entry.keywords || []).join(', '),
        pinned: Boolean(entry.pinned)
      }));
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const isQuote = !isNew && entry.source === 'quote';

      const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

      const save = async () => {
        setBusy(true);
        setError('');
        try {
          const payload = {
            title: form.title,
            content: form.content,
            source: form.source,
            importance: Number(form.importance) || 2,
            project: form.project,
            session: form.session,
            keywords: form.keywords,
            pinned: form.pinned,
            note: isNew ? '面板新建' : '面板编辑'
          };
          if (isNew) payload.category = form.category;
          else payload.id = entry.id;
          await api('/write', { method: 'POST', body: payload });
          onSaved();
        } catch (e) {
          setError(String((e && e.message) || e));
        } finally {
          setBusy(false);
        }
      };

      const act = async (path) => {
        setBusy(true);
        setError('');
        try {
          await api(path, { method: 'POST', body: { id: entry.id, note: '面板操作' } });
          onSaved();
        } catch (e) {
          setError(String((e && e.message) || e));
        } finally {
          setBusy(false);
        }
      };

      const copyId = async () => {
        try {
          await navigator.clipboard.writeText(entry.id);
          setError('已复制 id：' + entry.id);
        } catch {
          setError('剪贴板不可用，id：' + entry.id);
        }
      };

      return h('aside', { className: 'jy-inspector', 'aria-label': isNew ? '新建记忆' : '记忆详情' },
        h('div', { className: 'jy-inspector-head' },
          h('strong', null, isNew ? '新建记忆' : '记忆详情'),
          isNew ? null : h(Pill, null, entry.categoryLabel || CAT_LABEL[entry.category] || entry.category),
          !isNew ? h(Pill, { tone: entry.zone === 'cold' ? 'cold' : 'hot' }, entry.zone === 'cold' ? '冷' : '热') : null,
          entry.quote_edited ? h(Pill, { tone: 'warn' }, '原话已改') : null,
          h('span', { className: 'jy-grow' }),
          h('button', { type: 'button', className: 'jy-icon-btn', onClick: onClose, title: '关闭（Esc）', 'aria-label': '关闭' }, '✕')
        ),
        h('div', { className: 'jy-inspector-body' },
          h('div', { className: 'jy-form' },
            isNew
              ? h(Field, { label: '分类' },
                h('select', { value: form.category, onChange: (e) => set({ category: e.target.value }) },
                  CATEGORIES.map((c) => h('option', { key: c.key, value: c.key }, c.label + ' · ' + c.desc))))
              : h(Field, { label: '分类' }, h('div', { className: 'jy-readonly' }, entry.categoryLabel || CAT_LABEL[entry.category] || entry.category)),
            h(Field, { label: '标题' },
              h('input', { value: form.title, onChange: (e) => set({ title: e.target.value }), placeholder: '6–20 字，一眼看出讲什么' })),
            h(Field, { label: '来源' },
              h('select', { value: form.source, disabled: isQuote, onChange: (e) => set({ source: e.target.value }) },
                SOURCES.map((s) => h('option', { key: s.key, value: s.key, disabled: !isNew && s.key === 'quote' }, s.label)))),
            h(Field, { label: '重要度' },
              h('select', { value: form.importance, onChange: (e) => set({ importance: e.target.value }) },
                [1, 2, 3, 4].map((n) => h('option', { key: n, value: String(n) }, n + ' 星')))),
            h(Field, { label: '项目' },
              h('input', { value: form.project, onChange: (e) => set({ project: e.target.value }), placeholder: '留空＝全局' })),
            h(Field, { label: '会话' },
              h('input', { value: form.session, onChange: (e) => set({ session: e.target.value }), placeholder: '哪个对话里记的' })),
            h(Field, { label: '关键词', wide: true },
              h('input', { value: form.keywords, onChange: (e) => set({ keywords: e.target.value }), placeholder: '逗号分隔' })),
            h('label', { className: 'jy-check' },
              h('input', { type: 'checkbox', checked: form.pinned, onChange: (e) => set({ pinned: e.target.checked }) }),
              h('span', null, '钉住（保底注入优先）')),
            h(Field, { label: '正文', wide: true },
              h('textarea', {
                rows: Math.min(20, Math.max(6, String(form.content || '').split(/\r?\n/).length + 2)),
                value: form.content,
                readOnly: isQuote,
                onChange: (e) => set({ content: e.target.value })
              }))
          ),
          isQuote ? h('div', { className: 'jy-note' }, '原话正文只读。要更正请作废这条，再新建一条原话。') : null,
          (entry.issues || []).length
            ? h('div', { className: 'jy-note bad' }, '格式问题：' + entry.issues.map((x) => x.message || x.code).join('；'))
            : null,
          detail && detail.factors
            ? h('div', { className: 'jy-note' },
              '分类权重 ' + detail.factors.categoryWeight +
              ' × 重要度 ' + detail.factors.importance +
              ' × 冷热 ' + detail.factors.cold +
              (detail.factors.zone === 'cold' ? '（冷区）' : '（热区）'))
            : null,
          error ? h('div', { className: 'jy-note bad' }, error) : null
        ),
        h('div', { className: 'jy-inspector-foot' },
          h('button', { type: 'button', className: 'jy-btn primary', disabled: busy, onClick: save }, isNew ? '写入' : '保存'),
          h('span', { className: 'jy-grow' }),
          !isNew ? h('button', { type: 'button', className: 'jy-btn', onClick: copyId }, '复制 id') : null,
          !isNew && entry.status !== 'archived' ? h('button', { type: 'button', className: 'jy-btn', disabled: busy, onClick: () => act('/archive') }, '归档') : null,
          !isNew && entry.status !== 'active' ? h('button', { type: 'button', className: 'jy-btn', disabled: busy, onClick: () => act('/restore') }, '恢复') : null,
          !isNew && entry.status !== 'revoked' ? h('button', { type: 'button', className: 'jy-btn danger', disabled: busy, onClick: () => act('/revoke') }, '作废') : null
        ),
        (detail && detail.audit || []).length
          ? h('details', { className: 'jy-fold' },
            h('summary', null, '修改记录（' + detail.audit.length + '）'),
            h('div', { className: 'jy-fold-body' },
              detail.audit.slice().reverse().map((a, i) => h('div', { key: i, className: 'jy-audit-row' },
                fmtTime(a.ts) + ' · ' + (a.actor || '—') + ' · ' + (a.action || '') +
                (a.field ? ' · ' + a.field + '：' + String(a.before == null ? '—' : a.before) + ' → ' + String(a.after == null ? '—' : a.after) : '')))))
          : null
      );
    }

    /* ---------- 主面板 ---------- */

    function JiyiPanel() {
      const [tab, setTab] = useState('items');
      const [q, setQ] = useState('');
      const [filters, setFilters] = useState(EMPTY_FILTERS);
      const [items, setItems] = useState([]);
      const [listLoading, setListLoading] = useState(true);
      const [listTotal, setListTotal] = useState(null);
      const [stats, setStats] = useState(null);
      const [weights, setWeights] = useState(null);
      const [diag, setDiag] = useState(null);
      const [diagLoading, setDiagLoading] = useState(false);
      const [timeline, setTimeline] = useState([]);
      const [snapshots, setSnapshots] = useState([]);
      const [sessions, setSessions] = useState([]);
      const [consolidation, setConsolidation] = useState(null);
      const [detail, setDetail] = useState(null);
      const [notice, setNotice] = useState('');
      const [busy, setBusy] = useState(false);
      const [tick, setTick] = useState(0);
      const searchRef = useRef(null);

      const refresh = useCallback(() => setTick((n) => n + 1), []);

      const fail = useCallback((e) => {
        setNotice(String((e && e.message) || e));
      }, []);

      // 概览数据
      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const [s, w, t, sn, se, co] = await Promise.all([
              api('/stats'),
              api('/weights'),
              api('/timeline?limit=60'),
              api('/snapshots'),
              api('/sessions?limit=200').catch(() => ({ items: [] })),
              api('/consolidation').catch(() => null)
            ]);
            if (!alive) return;
            setStats(s);
            setWeights(w);
            setTimeline(t.items || []);
            setSnapshots(sn.items || []);
            setSessions(se.items || []);
            setConsolidation(co);
          } catch (e) {
            if (alive) fail(e);
          }
        })();
        return () => { alive = false; };
      }, [tick, fail]);

      // 列表：搜索框边打边查，260ms 防抖，避免每敲一个字都打一次接口。
      // loading 在真正发请求时置 true，防抖窗口内保留旧列表，不闪。
      useEffect(() => {
        let alive = true;
        const query = q.trim();
        const run = async () => {
          setListLoading(true);
          try {
            let data;
            if (query) {
              data = await api('/search?q=' + encodeURIComponent(query) + '&limit=200&status=' + encodeURIComponent(filters.status));
            } else {
              const params = new URLSearchParams({
                category: filters.category,
                status: filters.status,
                cold: filters.cold,
                limit: '200'
              });
              data = await api('/list?' + params.toString());
            }
            if (!alive) return;
            let rows = data.items || [];
            if (filters.session) rows = rows.filter((x) => (x.session || '') === filters.session);
            if (filters.category !== 'all') rows = rows.filter((x) => x.category === filters.category);
            if (filters.cold !== 'all') rows = rows.filter((x) => x.zone === filters.cold);
            setItems(rows);
            setListTotal(data.total == null ? rows.length : data.total);
          } catch (e) {
            if (alive) fail(e);
          } finally {
            if (alive) setListLoading(false);
          }
        };
        const timer = setTimeout(run, query ? 260 : 0);
        return () => { alive = false; clearTimeout(timer); };
      }, [q, filters, tick, fail]);

      // 自检页
      useEffect(() => {
        if (tab !== 'diag') return undefined;
        let alive = true;
        setDiagLoading(true);
        api('/diagnostics?limit=30')
          .then((d) => { if (alive) setDiag(d); })
          .catch((e) => { if (alive) fail(e); })
          .finally(() => { if (alive) setDiagLoading(false); });
        return () => { alive = false; };
      }, [tab, tick, fail]);

      // 快捷键：/ 聚焦搜索，Esc 关详情
      useEffect(() => {
        const onKey = (e) => {
          if (e.key === 'Escape' && detail) setDetail(null);
          if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) {
            e.preventDefault();
            if (searchRef.current) searchRef.current.focus();
          }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [detail]);

      useEffect(() => {
        if (!notice) return undefined;
        const t = setTimeout(() => setNotice(''), 6000);
        return () => clearTimeout(t);
      }, [notice]);

      const openItem = async (id) => {
        try {
          setDetail(await api('/detail?id=' + encodeURIComponent(id)));
        } catch (e) { fail(e); }
      };

      const openNew = () => {
        setDetail({
          new: true,
          entry: {
            category: 'facts', title: '', content: '', source: 'summary', importance: 2,
            project: '', session: filters.session || '', keywords: [], status: 'active'
          },
          audit: []
        });
      };

      const changeWeight = async (category, level) => {
        setBusy(true);
        try { setWeights(await api('/weights', { method: 'POST', body: { category, level } })); }
        catch (e) { fail(e); }
        finally { setBusy(false); }
      };

      const saveConsolidation = async (patch) => {
        try {
          const info = await api('/consolidation', { method: 'POST', body: patch });
          setConsolidation(info);
        } catch (e) { fail(e); }
      };

      const runConsolidate = async () => {
        setBusy(true);
        try {
          const r = await api('/consolidate', { method: 'POST', body: {} });
          setNotice('整理完成：写入 ' + (r && r.wrote || 0) + ' · 合并 ' + (r && r.merged || 0) + ' · 跳过 ' + (r && r.skipped || 0));
          refresh();
        } catch (e) { fail(e); }
        finally { setBusy(false); }
      };

      const snapshot = async () => {
        setBusy(true);
        try {
          await api('/snapshot', { method: 'POST', body: { note: '面板快照' } });
          setNotice('已拍快照');
          refresh();
        } catch (e) { fail(e); }
        finally { setBusy(false); }
      };

      const rollback = async (name) => {
        if (!window.confirm('回滚到快照 ' + name + '？回滚前会自动再拍一张安全快照。')) return;
        setBusy(true);
        try {
          await api('/rollback', { method: 'POST', body: { name, note: '面板回滚' } });
          setNotice('已回滚到 ' + name);
          refresh();
        } catch (e) { fail(e); }
        finally { setBusy(false); }
      };

      const health = (stats && stats.health) || {};
      const tone = health.status === 'red' ? 'red' : health.status === 'yellow' ? 'warn' : 'ok';
      const filtersDirty = filters.category !== 'all' || filters.status !== 'active' || filters.cold !== 'all' || filters.session !== '' || q.trim() !== '';
      const rowCount = items.length;

      /* ----- 顶部：标题行 + 状态条 ----- */

      const header = h('header', { className: 'jy-head' },
        h('div', { className: 'jy-head-row' },
          h('span', { className: 'jy-logo', 'aria-hidden': 'true' }, h(JiyiIcon, { size: 18 })),
          h('div', { className: 'jy-title' },
            h('h1', null, '机忆'),
            h('span', { className: 'jy-sub' }, '本地 · 零成本 · 工作模式')
          ),
          h('span', { className: 'jy-grow' }),
          h(SegTabs, {
            value: tab,
            onChange: setTab,
            items: [
              { key: 'items', label: '条目' },
              { key: 'tune', label: '权重' },
              { key: 'diag', label: '自检' },
              { key: 'organize', label: '整理' }
            ]
          }),
          h('button', { type: 'button', className: 'jy-btn', onClick: refresh, disabled: busy }, '刷新'),
          h('button', { type: 'button', className: 'jy-btn primary', onClick: openNew }, '新建')
        ),
        h('div', { className: 'jy-statusbar' },
          h('span', { className: 'jy-status-main' },
            h('span', { className: 'jy-dot ' + tone, 'aria-hidden': 'true' }),
            h('span', { className: 'jy-status-line', title: health.reason || health.line || '' }, health.line || '读取中…'),
            health.reason ? h(Pill, { tone: 'warn' }, health.reason) : null
          ),
          h('span', { className: 'jy-status-extra' },
            h('span', { className: 'jy-sep', 'aria-hidden': 'true' }),
            stats
              ? h('span', { className: 'jy-status-counts' },
                '共 ' + (stats.total || 0) + ' · 活跃 ' + (stats.active || 0) + ' · 冷 ' + (stats.cold || 0))
              : h('span', { className: 'jy-status-counts' }, '读取中…'),
            health.lastHitTurnsAgo != null
              ? h('span', { className: 'jy-status-muted' }, '最近命中 ' + health.lastHitTurnsAgo + ' 轮前')
              : null,
            health.consecutiveMiss
              ? h('span', { className: 'jy-status-muted' }, '连续空手 ' + health.consecutiveMiss + ' 轮')
              : null
          )
        )
      );

      /* ----- 工具栏：搜索行 + 筛选行 ----- */

      const toolbar = h('div', { className: 'jy-toolbar' },
        h('div', { className: 'jy-toolbar-row' },
          h('div', { className: 'jy-search-wrap' },
            h('span', { className: 'jy-search-icon', 'aria-hidden': 'true' }, '⌕'),
            h('input', {
              ref: searchRef,
              className: 'jy-search',
              value: q,
              placeholder: '搜索记忆（按 / 聚焦）',
              onChange: (e) => setQ(e.target.value)
            }),
            q
              ? h('button', {
                type: 'button',
                className: 'jy-search-clear',
                onClick: () => setQ(''),
                title: '清空',
                'aria-label': '清空搜索'
              }, '✕')
              : null
          ),
          h('span', { className: 'jy-result-count' },
            listLoading ? '检索中…' : (q.trim() ? '命中 ' + rowCount + ' 条' : '显示 ' + rowCount + (listTotal != null && listTotal !== rowCount ? ' / ' + listTotal : '') + ' 条')),
          filtersDirty
            ? h('button', {
              type: 'button',
              className: 'jy-btn ghost',
              onClick: () => { setQ(''); setFilters(EMPTY_FILTERS); }
            }, '重置筛选')
            : null
        ),
        h('div', { className: 'jy-toolbar-row' },
          h('div', { className: 'jy-chips' },
            h('button', {
              type: 'button',
              className: 'jy-chip' + (filters.category === 'all' ? ' on' : ''),
              onClick: () => setFilters((f) => ({ ...f, category: 'all' }))
            }, '全部'),
            CATEGORIES.map((c) => h('button', {
              key: c.key,
              type: 'button',
              className: 'jy-chip' + (filters.category === c.key ? ' on' : ''),
              'data-cat': c.key,
              title: c.desc,
              onClick: () => setFilters((f) => ({ ...f, category: c.key }))
            }, c.label))
          ),
          h('span', { className: 'jy-grow' }),
          h('select', {
            className: 'jy-select',
            value: filters.status,
            onChange: (e) => setFilters((f) => ({ ...f, status: e.target.value }))
          },
            h('option', { value: 'active' }, '正常'),
            h('option', { value: 'archived' }, '已归档'),
            h('option', { value: 'revoked' }, '已作废'),
            h('option', { value: 'all' }, '全部状态')),
          h('select', {
            className: 'jy-select',
            value: filters.cold,
            onChange: (e) => setFilters((f) => ({ ...f, cold: e.target.value }))
          },
            h('option', { value: 'all' }, '冷暖不限'),
            h('option', { value: 'hot' }, '只看热'),
            h('option', { value: 'cold' }, '只看冷')),
          sessions.length
            ? h('select', {
              className: 'jy-select',
              value: filters.session,
              onChange: (e) => setFilters((f) => ({ ...f, session: e.target.value }))
            },
              h('option', { value: '' }, '全部对话'),
              sessions.map((s) => h('option', { key: s.session, value: s.session }, s.session + '（' + s.count + '）')))
            : null
        )
      );

      /* ----- 列表 ----- */

      const listBody = listLoading && items.length === 0
        ? h(Skeleton, { rows: 6 })
        : items.length === 0
          ? h(Empty, {
            icon: q.trim() ? '⌕' : '◍',
            title: q.trim() ? '没搜到' : '这个筛选下没有条目',
            hint: q.trim() ? '换个短一点的关键词，或点「重置筛选」。' : '点右上角「新建」记一条。'
          })
          : items.map((item) => h('button', {
            key: item.id,
            type: 'button',
            className: 'jy-card' + (detail && detail.entry && detail.entry.id === item.id ? ' on' : ''),
            'data-cat': item.category,
            onClick: () => openItem(item.id)
          },
            h('div', { className: 'jy-card-head' },
              h('span', { className: 'jy-badge cat', 'data-cat': item.category },
                item.categoryLabel || CAT_LABEL[item.category] || item.category),
              h('span', { className: 'jy-card-title' }, highlight(item.title || '(无标题)', q)),
              h('span', { className: 'jy-grow' }),
              item.zone === 'cold' ? h(Pill, { tone: 'cold' }, '冷') : null,
              item.status !== 'active' ? h(Pill, { tone: 'warn' }, item.statusLabel || item.status) : null,
              item.quote_edited ? h(Pill, { tone: 'warn' }, '原话已改') : null,
              (item.issues || []).length ? h(Pill, { tone: 'bad' }, '损坏') : null,
              item.score != null ? h('span', { className: 'jy-score', title: '检索分数' }, item.score) : null
            ),
            h('div', { className: 'jy-card-text' }, highlight(item.preview || item.content || '', q)),
            h('div', { className: 'jy-card-meta' },
              h('span', null, item.sourceLabel || SOURCE_LABEL[item.source] || item.source),
              h('span', { className: 'jy-meta-star', title: (item.importance || 0) + ' 星' }, stars(item.importance)),
              h('span', null, '用过 ' + (item.uses || 0)),
              h('span', null, fmtTime(item.updated_at)),
              item.project ? h('span', { className: 'jy-meta-tag' }, item.project) : null,
              item.session ? h('span', { className: 'jy-meta-tag' }, '对话 ' + item.session) : null
            )
          ));

      const list = h('div', { className: 'jy-list' }, listBody);

      const itemsView = h('div', { className: 'jy-split' },
        h('div', { className: 'jy-main' }, toolbar, list),
        detail ? h(ItemEditor, {
          key: (detail.new ? 'new' : (detail.entry && detail.entry.id) || 'x'),
          detail,
          onClose: () => setDetail(null),
          onSaved: () => { setDetail(null); refresh(); }
        }) : null
      );

      /* ----- 权重 ----- */

      const tuneView = h('div', { className: 'jy-pane' },
        h(PaneHead, {
          title: '分类权重',
          desc: '只有工作模式一列。权重越高，这一类的条目在检索里越容易被选中；忽略＝永不自动检索。'
        }, h('button', { type: 'button', className: 'jy-btn', onClick: refresh, disabled: busy }, '刷新')),
        h('section', { className: 'jy-card-panel' },
          h('table', { className: 'jy-table' },
            h('thead', null, h('tr', null,
              h('th', null, '分类'),
              h('th', null, '文件'),
              h('th', null, '权重')
            )),
            h('tbody', null,
              ((weights && weights.rows) || []).map((row) => h('tr', { key: row.category },
                h('td', null, h('span', { className: 'jy-badge cat', 'data-cat': row.category }, row.label)),
                h('td', { className: 'jy-dim' }, row.file),
                h('td', null, h('select', {
                  className: 'jy-select',
                  value: (row.cells && row.cells.work && row.cells.work.level) || 'normal',
                  disabled: busy,
                  onChange: (e) => changeWeight(row.category, e.target.value)
                }, LEVELS.map((l) => h('option', { key: l.key, value: l.key }, l.label + '（×' + l.value + '）'))))
              ))
            )
          )
        ),
        h('div', { className: 'jy-note' },
          '重要度系数：★1 ×' + (weights && weights.importanceFactors && weights.importanceFactors['1']) +
          ' · ★2 ×' + (weights && weights.importanceFactors && weights.importanceFactors['2']) +
          ' · ★3 ×' + (weights && weights.importanceFactors && weights.importanceFactors['3']) +
          ' · ★4 ×' + (weights && weights.importanceFactors && weights.importanceFactors['4']) +
          ' ｜ 冷区 ×' + (weights && weights.coldFactor))
      );

      /* ----- 自检 ----- */

      const diagView = h('div', { className: 'jy-pane' },
        h(PaneHead, {
          title: '自检',
          desc: '最近 30 轮检索的真实命中情况。空手连续多轮，说明条目写法或关键词不合适。'
        },
          h('button', { type: 'button', className: 'jy-btn', onClick: refresh, disabled: diagLoading }, diagLoading ? '读取中…' : '刷新')
        ),
        h('section', { className: 'jy-card-panel' },
          diagLoading && !diag
            ? h(Skeleton, { rows: 4 })
            : !diag
              ? h(Empty, { title: '读取中…' })
              : (diag.turns || []).length === 0
                ? h(Empty, { icon: '◎', title: '还没有真实轮次', hint: '下一轮对话开始后这里就会有记录。' })
                : h('table', { className: 'jy-table' },
                  h('thead', null, h('tr', null,
                    h('th', null, '时间'), h('th', null, '问句'), h('th', null, '结果'), h('th', null, '命中/原因'), h('th', null, '耗时')
                  )),
                  h('tbody', null, diag.turns.map((t, i) => h('tr', { key: i },
                    h('td', { className: 'jy-dim' }, fmtTime(t.ts)),
                    h('td', { className: 'jy-cell-q', title: t.query }, t.query || '—'),
                    h('td', null, t.hit ? h(Pill, { tone: 'hot' }, '命中 ' + t.hits.length) : h(Pill, { tone: 'warn' }, '空手')),
                    h('td', { className: 'jy-cell-result' }, t.hit
                      ? h('div', { className: 'jy-hit-list' }, t.hits.map((x, k) => h('span', {
                        key: k,
                        className: 'jy-hit',
                        'data-cat': x.category,
                        title: x.id + (x.reason ? ' · ' + x.reason : '')
                      },
                        h('span', { className: 'jy-hit-cat' }, x.categoryLabel || x.category || ''),
                        h('span', { className: 'jy-hit-title' }, x.title || x.id)
                      )))
                      : h('span', { className: 'jy-dim' }, (t.missReason || '未命中') +
                        ((t.nearMiss || []).length ? ' · 差一点：' + t.nearMiss.map((x) => (x.title || x.id)).join('；') : ''))),
                    h('td', { className: 'jy-dim' }, String(t.ms || 0) + 'ms')
                  )))
                )
        )
      );

      /* ----- 整理 ----- */

      const organizeView = h('div', { className: 'jy-pane' },
        h(PaneHead, { title: '整理', desc: '把散条目并成一条、拍快照、看时间轴。' }),
        h('section', { className: 'jy-card-panel' },
          h('h3', null, '自动整理'),
          h('p', { className: 'jy-dim' }, '攒够轮次后把散条目并成一条；整理的写入也会进时间轴。'),
          h('div', { className: 'jy-row' },
            h('label', { className: 'jy-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(consolidation && consolidation.enabled !== false),
                onChange: (e) => saveConsolidation({ enabled: e.target.checked })
              }),
              h('span', null, '自动整理')),
            h('label', { className: 'jy-inline' },
              h('span', null, '每'),
              h('input', {
                type: 'number', min: 1, max: 200, className: 'jy-num',
                value: Number((consolidation && consolidation.everyTurns) || 25),
                onChange: (e) => saveConsolidation({ everyTurns: Number(e.target.value) || 25 })
              }),
              h('span', null, '轮')),
            h('button', { type: 'button', className: 'jy-btn', disabled: busy, onClick: runConsolidate }, '立即整理')
          ),
          consolidation && consolidation.dueIn != null
            ? h('div', { className: 'jy-note' }, '距下次还有 ' + consolidation.dueIn + ' 轮 · ' + (consolidation.title || ''))
            : null
        ),
        h('section', { className: 'jy-card-panel' },
          h('div', { className: 'jy-sec-head' },
            h('h3', null, '快照'),
            h('span', { className: 'jy-grow' }),
            h('button', { type: 'button', className: 'jy-btn', disabled: busy, onClick: snapshot }, '拍快照')
          ),
          snapshots.length === 0
            ? h(Empty, { icon: '❑', title: '还没有快照', hint: '点「拍快照」留一个还原点。' })
            : snapshots.slice(0, 12).map((s) => h('div', { key: s.name, className: 'jy-snap-row' },
              h('div', { className: 'jy-snap-main' },
                h('span', { className: 'jy-snap-name' }, s.name),
                h('span', { className: 'jy-snap-time' }, fmtTime(s.createdAt || s.ts))
              ),
              s.note ? h('div', { className: 'jy-snap-note' }, s.note) : null,
              h('button', { type: 'button', className: 'jy-btn', disabled: busy, onClick: () => rollback(s.name) }, '回滚')
            ))
        ),
        h('section', { className: 'jy-card-panel' },
          h('h3', null, '时间轴'),
          timeline.length === 0
            ? h(Empty, { icon: '≡', title: '还没有事件' })
            : timeline.slice(0, 40).map((row, i) => h('div', { key: i, className: 'jy-tl-row' },
              h('span', { className: 'jy-dim jy-tl-time' }, fmtTime(row.ts)),
              h('span', { className: 'jy-badge type' }, TYPE_LABEL[row.type] || row.type),
              h('span', { className: 'jy-tl-text' }, (row.title || '') + (row.detail ? ' · ' + row.detail : ''))
            ))
        )
      );

      return h('div', { className: 'jy-page' },
        header,
        notice ? h('div', { className: 'jy-notice', onClick: () => setNotice(''), role: 'status' }, notice) : null,
        tab === 'items' ? itemsView : tab === 'tune' ? tuneView : tab === 'diag' ? diagView : organizeView
      );
    }

    /* ---------- 样式（全部挂 .jy- 前缀，只用 --dsw-alias-* token） ---------- */

    const CSS = `
.jy-page{width:100%;min-width:0;height:100%;min-height:0;display:flex;flex-direction:column;
  /* 亮色主题下 bg-layer-1/2 都等于纯白，抬升面全靠 label-primary 混一点底，否则卡片与按钮全部融成一片 */
  --jy-surface:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-base));
  --jy-fill:color-mix(in srgb, var(--dsw-alias-label-primary) 9%, var(--dsw-alias-bg-base));
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font-size:14px;line-height:1.6;overflow:hidden;container-type:inline-size;
  -webkit-font-smoothing:antialiased}
.jy-page *,.jy-page *::before,.jy-page *::after{box-sizing:border-box}
.jy-page :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.jy-page ::selection{background:var(--dsw-alias-brand-primary);color:#fff}

/* 顶部 */
.jy-head{flex:0 0 auto;display:flex;flex-direction:column;
  border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.jy-head-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:16px clamp(18px,3vw,36px) 10px}
.jy-logo{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
  border-radius:9px;color:var(--dsw-alias-brand-primary);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);flex:0 0 auto}
.jy-title{display:flex;flex-direction:column;gap:1px;margin-right:4px;min-width:0}
.jy-title h1{font-size:19px;font-weight:500;line-height:26px;margin:0;letter-spacing:.01em}
.jy-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.jy-statusbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:0 clamp(18px,3vw,36px) 10px;font-size:11.5px;
  color:var(--dsw-alias-label-secondary);min-height:20px}
.jy-status-main{display:inline-flex;align-items:center;gap:7px;min-width:0;flex:0 1 auto}
.jy-status-extra{display:inline-flex;align-items:center;gap:9px;min-width:0;flex:0 1 auto;
  flex-wrap:wrap}
.jy-status-line{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.jy-status-counts{font-variant-numeric:tabular-nums;white-space:nowrap}
.jy-status-muted{opacity:.8;white-space:nowrap}
.jy-sep{width:1px;height:10px;background:var(--dsw-alias-border-l2);flex:0 0 auto}
.jy-grow{flex:1 1 auto;min-width:0}
.jy-dim{color:var(--dsw-alias-label-secondary);font-size:12px}
.jy-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:0 0 auto;
  background:var(--dsw-alias-state-idle-primary)}
.jy-dot.ok{background:var(--dsw-alias-state-success-primary)}
.jy-dot.warn{background:var(--dsw-alias-state-warn-primary)}
.jy-dot.red{background:var(--dsw-alias-state-error-primary)}

/* 分段 tabs / 按钮 */
.jy-seg{display:inline-flex;padding:2px;border-radius:10px;gap:2px;
  background:var(--jy-fill);border:1px solid var(--dsw-alias-border-l1)}
.jy-seg-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:13px;padding:4px 13px;border-radius:8px;cursor:pointer;
  transition:background .12s ease,color .12s ease}
.jy-seg-btn:hover{color:var(--dsw-alias-label-primary)}
.jy-seg-btn.on{background:var(--jy-surface);color:var(--dsw-alias-label-primary);
  box-shadow:0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)}
.jy-btn{appearance:none;font:inherit;font-size:13px;padding:5px 13px;border-radius:9px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);background:var(--jy-surface);
  color:var(--dsw-alias-label-primary);white-space:nowrap;
  transition:background .12s ease,border-color .12s ease}
.jy-btn:hover:not(:disabled){background:var(--jy-fill)}
.jy-btn:disabled{opacity:.45;cursor:default}
.jy-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.jy-btn.primary:hover:not(:disabled){opacity:.9;background:var(--dsw-alias-brand-primary)}
.jy-btn.danger{color:var(--dsw-alias-state-error-primary)}
.jy-btn.ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.jy-btn.ghost:hover:not(:disabled){background:var(--jy-fill);color:var(--dsw-alias-label-primary)}
.jy-icon-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  font-size:14px;cursor:pointer;padding:3px 7px;border-radius:7px;line-height:1}
.jy-icon-btn:hover{background:var(--jy-fill);color:var(--dsw-alias-label-primary)}
.jy-notice{padding:7px clamp(18px,3vw,36px);font-size:12px;cursor:pointer;flex:0 0 auto;
  background:var(--jy-fill);border-bottom:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-secondary)}

/* 条目页 */
.jy-split{flex:1 1 auto;display:flex;min-height:0;overflow:hidden;position:relative}
.jy-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0}
.jy-toolbar{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;
  padding:12px clamp(18px,3vw,36px) 10px;width:100%;max-width:1120px;margin-inline:auto}
.jy-toolbar-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.jy-search-wrap{position:relative;flex:1 1 240px;min-width:150px;display:flex;align-items:center}
.jy-search-icon{position:absolute;left:9px;font-size:14px;line-height:1;pointer-events:none;
  color:var(--dsw-alias-label-secondary)}
.jy-search{width:100%;font:inherit;font-size:13px;padding:6px 30px 6px 27px;
  border-radius:9px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--jy-surface);color:var(--dsw-alias-label-primary);
  transition:border-color .12s ease}
.jy-search:hover{border-color:var(--dsw-alias-border-l2)}
.jy-search:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.jy-search::placeholder{color:var(--dsw-alias-label-secondary)}
.jy-search-clear{position:absolute;right:4px;appearance:none;border:0;background:transparent;
  color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;padding:3px 6px;border-radius:6px;line-height:1}
.jy-search-clear:hover{background:var(--jy-fill);color:var(--dsw-alias-label-primary)}
.jy-result-count{font-size:11.5px;color:var(--dsw-alias-label-secondary);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.jy-chips{display:flex;gap:6px;flex-wrap:wrap}
.jy-chip{appearance:none;font:inherit;font-size:12px;padding:3px 11px;border-radius:999px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);background:transparent;
  color:var(--dsw-alias-label-secondary);transition:background .12s ease,color .12s ease,border-color .12s ease}
.jy-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.jy-chip.on{background:var(--jy-fill);color:var(--dsw-alias-label-primary);
  border-color:var(--dsw-alias-border-l2)}
.jy-chip.on[data-cat="rules"]{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent)}
.jy-chip.on[data-cat="facts"]{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent)}
.jy-chip.on[data-cat="pitfalls"]{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, transparent)}
.jy-chip.on[data-cat="progress"]{border-color:color-mix(in srgb, var(--dsw-alias-state-idle-primary) 55%, transparent)}
.jy-select{font:inherit;font-size:12.5px;padding:4px 7px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--jy-surface);color:var(--dsw-alias-label-primary);cursor:pointer}
.jy-select:hover{border-color:var(--dsw-alias-border-l2)}

/* 卡片列表 */
.jy-list{flex:1 1 auto;overflow:auto;padding:2px clamp(18px,3vw,36px) 28px;
  display:flex;flex-direction:column;gap:6px;overscroll-behavior:contain;
  width:100%;max-width:1120px;margin-inline:auto}
.jy-card{width:100%;text-align:left;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:3px;
  padding:10px 12px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--dsw-alias-bg-base));
  color:var(--dsw-alias-label-primary);
  transition:background .12s ease,border-color .12s ease}
.jy-card:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-base));
  border-color:var(--dsw-alias-border-l2)}
.jy-card.on{border-color:var(--dsw-alias-brand-primary);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, var(--jy-surface))}
.jy-card-head{display:flex;align-items:center;gap:7px;flex-wrap:nowrap;min-width:0}
.jy-card-title{font-weight:500;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;min-width:0;flex:0 1 auto}
.jy-card-text{font-size:12.5px;color:var(--dsw-alias-label-secondary);line-height:1.5;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jy-card-meta{display:flex;gap:9px;flex-wrap:wrap;font-size:11px;
  color:var(--dsw-alias-label-secondary);opacity:.92}
.jy-meta-star{letter-spacing:.5px}
.jy-meta-tag{padding:0 6px;border-radius:999px;
  background:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)}
.jy-score{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;
  flex:0 0 auto}
.jy-mark{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent);
  color:var(--dsw-alias-label-primary);border-radius:3px;padding:0 1px}

/* 徽章 */
.jy-badge{font-size:10.5px;padding:1px 7px;border-radius:999px;white-space:nowrap;flex:0 0 auto;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);
  background:var(--jy-fill)}
.jy-badge.cat{color:var(--dsw-alias-label-primary)}
.jy-badge.cat[data-cat="rules"]{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent)}
.jy-badge.cat[data-cat="facts"]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);
  border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent)}
.jy-badge.cat[data-cat="pitfalls"]{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);
  border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent)}
.jy-badge.cat[data-cat="progress"]{background:color-mix(in srgb, var(--dsw-alias-state-idle-primary) 14%, transparent);
  border-color:color-mix(in srgb, var(--dsw-alias-state-idle-primary) 30%, transparent)}
.jy-badge.type{background:transparent}
.jy-pill{font-size:10.5px;padding:1px 7px;border-radius:999px;white-space:nowrap;flex:0 0 auto;
  background:var(--jy-fill);color:var(--dsw-alias-label-secondary)}
.jy-pill.hot{color:var(--dsw-alias-state-success-primary)}
.jy-pill.cold{color:var(--dsw-alias-state-idle-primary)}
.jy-pill.warn{color:var(--dsw-alias-state-warn-primary)}
.jy-pill.bad{color:var(--dsw-alias-state-error-primary)}

/* 空态 / 骨架 */
.jy-empty{padding:44px 12px;text-align:center;color:var(--dsw-alias-label-secondary);
  display:flex;flex-direction:column;align-items:center;gap:5px}
.jy-empty-icon{font-size:22px;opacity:.45;line-height:1}
.jy-empty-title{font-size:13px;color:var(--dsw-alias-label-primary);opacity:.85}
.jy-empty-hint{font-size:12px;max-width:360px}
.jy-skel{display:flex;flex-direction:column;gap:6px;padding:2px 0}
.jy-skel-row{height:58px;border-radius:11px;
  background:color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-base));
  animation:jy-pulse 1.4s ease-in-out infinite}
@keyframes jy-pulse{0%,100%{opacity:.55}50%{opacity:.9}}
@media (prefers-reduced-motion: reduce){
  .jy-skel-row{animation:none}
  .jy-page *{transition:none !important}
}

/* 详情栏 */
.jy-inspector{flex:0 0 clamp(300px,32vw,410px);display:flex;flex-direction:column;min-height:0;
  border-left:1px solid var(--dsw-alias-border-l1);background:var(--jy-surface)}
.jy-inspector-head{display:flex;align-items:center;gap:7px;padding:12px 14px;
  border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap;flex:0 0 auto}
.jy-inspector-head strong{font-size:13.5px;font-weight:500}
.jy-inspector-body{flex:1 1 auto;overflow:auto;padding:12px 14px 18px;
  display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}
.jy-inspector-foot{flex:0 0 auto;display:flex;align-items:center;gap:7px;flex-wrap:wrap;
  padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);
  background:var(--jy-surface)}
.jy-form{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.jy-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.jy-field.wide{grid-column:1/-1}
.jy-field-label{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.jy-field input,.jy-field select,.jy-field textarea{width:100%;font:inherit;font-size:12.5px;
  padding:5px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.jy-field input:focus,.jy-field select:focus,.jy-field textarea:focus{
  border-color:var(--dsw-alias-brand-primary);outline:none}
.jy-field textarea{resize:vertical;line-height:1.55;min-height:150px}
.jy-check{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer}
.jy-check input{accent-color:var(--dsw-alias-brand-primary)}
.jy-inline{display:inline-flex;align-items:center;gap:6px;font-size:12.5px}
.jy-num{width:62px;font:inherit;font-size:12.5px;padding:4px 8px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary)}
.jy-readonly{font-size:12.5px;padding:5px 9px;color:var(--dsw-alias-label-secondary);
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent)}
.jy-note{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.jy-note.bad{color:var(--dsw-alias-state-error-primary)}
.jy-actions{display:flex;gap:7px;flex-wrap:wrap}
.jy-fold{border-top:1px solid var(--dsw-alias-border-l1);font-size:11.5px;flex:0 0 auto;
  color:var(--dsw-alias-label-secondary);max-height:200px;display:flex;flex-direction:column;min-height:0}
.jy-fold summary{cursor:pointer;padding:9px 14px;flex:0 0 auto}
.jy-fold-body{overflow:auto;padding:0 14px 10px}
.jy-audit-row{padding:2px 0;border-bottom:1px dashed var(--dsw-alias-border-l1)}

/* 其它页 */
.jy-pane{flex:1 1 auto;overflow:auto;padding:16px clamp(18px,3vw,36px) 36px;
  display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain;
  width:100%;max-width:1120px;margin-inline:auto}
.jy-pane-head{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.jy-pane-head h2{font-size:15px;font-weight:500;margin:0;line-height:22px}
.jy-pane-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:0;max-width:620px}
.jy-card-panel{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;
  padding:14px 16px;background:var(--jy-surface);
  display:flex;flex-direction:column;gap:9px}
.jy-card-panel h2{font-size:15px;font-weight:500;margin:0}
.jy-card-panel h3{font-size:13.5px;font-weight:500;margin:0}
.jy-card-panel p{margin:0}
.jy-sec-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.jy-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.jy-snap-row{display:grid;grid-template-columns:1fr auto;grid-template-areas:'main btn' 'note note';
  gap:2px 10px;align-items:center;padding:7px 0;
  border-bottom:1px dashed var(--dsw-alias-border-l1);font-size:12.5px}
.jy-snap-row:last-child{border-bottom:0}
.jy-snap-main{grid-area:main;display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}
.jy-snap-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.jy-snap-time{font-size:11.5px;color:var(--dsw-alias-label-secondary);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.jy-snap-note{grid-area:note;font-size:11.5px;color:var(--dsw-alias-label-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jy-snap-row > .jy-btn{grid-area:btn}
.jy-table{width:100%;border-collapse:collapse;font-size:12.5px}
.jy-table th{text-align:left;font-weight:500;font-size:11.5px;padding:6px 8px;
  color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1);
  white-space:nowrap}
.jy-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}
.jy-table tr:last-child td{border-bottom:0}
.jy-cell-q{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jy-cell-result{max-width:520px;word-break:break-word}
.jy-hit-list{display:flex;flex-wrap:wrap;gap:4px}
.jy-hit{display:inline-flex;align-items:center;gap:5px;max-width:100%;
  padding:1px 7px 1px 3px;border-radius:999px;font-size:11px;
  border:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)}
.jy-hit-cat{flex:0 0 auto;padding:0 5px;border-radius:999px;font-size:10px;
  color:var(--dsw-alias-label-primary);
  background:color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent)}
.jy-hit[data-cat="rules"] .jy-hit-cat{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent)}
.jy-hit[data-cat="facts"] .jy-hit-cat{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 26%, transparent)}
.jy-hit[data-cat="pitfalls"] .jy-hit-cat{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 26%, transparent)}
.jy-hit[data-cat="progress"] .jy-hit-cat{background:color-mix(in srgb, var(--dsw-alias-state-idle-primary) 26%, transparent)}
.jy-hit-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.jy-tl-row{display:flex;align-items:baseline;gap:8px;font-size:11.5px;padding:3px 0;
  border-bottom:1px dashed var(--dsw-alias-border-l1)}
.jy-tl-row:last-child{border-bottom:0}
.jy-tl-time{flex:0 0 auto;font-variant-numeric:tabular-nums}
.jy-tl-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* 窄屏：详情栏整屏覆盖，不挤列表 */
@container (max-width: 760px){
  .jy-inspector{position:absolute;inset:0;flex:0 0 auto;width:100%;z-index:2;
    border-left:0;background:var(--dsw-alias-bg-base)}
  .jy-toolbar-row{flex-wrap:wrap}
  .jy-toolbar-row .jy-grow{display:none}
  .jy-toolbar-row .jy-select{flex:1 1 88px;min-width:0}
  .jy-title h1{font-size:17px}
  .jy-sub{display:none}
}
@container (max-width: 560px){
  .jy-form{grid-template-columns:1fr}
  .jy-status-line{max-width:180px}
  .jy-toolbar-row .jy-chips{flex:1 1 100%}
  .jy-toolbar-row .jy-select{flex:1 1 0;min-width:0}
  .jy-toolbar-row .jy-grow{display:none}
  .jy-list{gap:4px}
  .jy-card{padding:9px 10px}
  .jy-card-meta{gap:7px}
}
`;

    function installCss() {
      if (typeof document === 'undefined') return () => {};
      // 热重载时旧 style 还在，直接复用它的节点换内容，避免同一 id 两份样式打架。
      const existing = document.getElementById(CSS_ID);
      if (existing) {
        existing.textContent = CSS;
        return () => {};
      }
      const el = document.createElement('style');
      el.id = CSS_ID;
      el.textContent = CSS;
      document.head.appendChild(el);
      return () => {
        try { el.remove(); } catch { /* ignore */ }
      };
    }

    /* ---------- 注册 ---------- */

    function apply(ctx) {
      const disposers = [];
      try {
        disposers.push(installCss());

        const slots = ctx.slots;
        if (!slots || typeof slots.register !== 'function') {
          console.error('[机忆] 宿主没有 slots 服务，面板没有挂上');
          return;
        }

        // 侧栏图标：宿主只传 { size, active }，label 由 sidebar 读注册项解析。
        disposers.push(slots.inject('sidebar.panellist', () => slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: PANEL_ORDER,
          label: () => '机忆',
          registrant: PANEL_ID
        }, JiyiIcon)));

        // 中央面板：key 必须与侧栏 id 一致，点图标才会切到这里。
        disposers.push(slots.inject('main', () => slots.register({
          name: 'main',
          key: PANEL_ID,
          registrant: PANEL_ID
        }, JiyiPanel)));

        console.info('[机忆] 原生面板已注册（sidebar.panellist + main）');
      } catch (e) {
        console.error('[机忆] 面板注册失败', e);
      }

      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          for (const dispose of disposers) {
            try { if (typeof dispose === 'function') dispose(); } catch { /* ignore */ }
          }
        }, 'workmem: panel');
      }
    }

    return { apply, inject: ['slots'] };
  }
});
