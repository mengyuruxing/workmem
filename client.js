/* client.js — 机忆（workmem）DSH 原生面板。
 *
 * 2026-11-05 改造：原来是 shell.overlay 右下角浮窗 + iframe 加载 /workmem/panel/。
 * 宿主 skill 明确规定不要用 iframe 嵌 Host 页面（拿不到主题 token、locale、明暗切换），
 * 所以整块 UI 用 React 重写，注册到 sidebar.panellist（侧栏图标）+ main（中央面板）。
 * 数据仍走同源 JSON 接口 /workmem/panel/*。
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
    const LEVEL_LABEL = Object.fromEntries(LEVELS.map((l) => [l.key, l.label]));
    const TYPE_LABEL = {
      create: '记', edit: '改', archive: '归档', revoke: '作废', restore: '恢复',
      recall: '想起', miss: '没想起', snapshot: '快照', rollback: '回滚',
      'write-error': '写失败', weights: '权重', manual: '搜', cold: '冷区',
      consolidate: '整理', consolidation: '整理设置'
    };

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

    /* ---------- 图标（侧栏只传 size / active） ---------- */

    function JiyiIcon(props) {
      const size = Number(props && props.size) || 16;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        style: { display: 'block' }
      },
        h('rect', { x: 2.4, y: 2.1, width: 11.2, height: 11.8, rx: 2.6, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', {
          d: 'M5.6 6h4.8M5.6 8.4h4.8M5.6 10.8h2.8',
          stroke: 'currentColor',
          strokeWidth: 1.3,
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

      return h('aside', { className: 'jy-inspector' },
        h('div', { className: 'jy-inspector-head' },
          h('strong', null, isNew ? '新建记忆' : '记忆详情'),
          isNew ? null : h(Pill, null, entry.categoryLabel || CAT_LABEL[entry.category] || entry.category),
          !isNew ? h(Pill, { tone: entry.zone === 'cold' ? 'cold' : 'hot' }, entry.zone === 'cold' ? '冷' : '热') : null,
          entry.quote_edited ? h(Pill, { tone: 'warn' }, '原话已改') : null,
          h('span', { className: 'jy-grow' }),
          h('button', { type: 'button', className: 'jy-icon-btn', onClick: onClose, title: '关闭' }, '✕')
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
                rows: 8,
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
          error ? h('div', { className: 'jy-note bad' }, error) : null,
          h('div', { className: 'jy-actions' },
            h('button', { type: 'button', className: 'jy-btn primary', disabled: busy, onClick: save }, isNew ? '写入' : '保存'),
            !isNew ? h('button', { type: 'button', className: 'jy-btn', onClick: copyId }, '复制 id') : null,
            !isNew && entry.status !== 'archived' ? h('button', { type: 'button', className: 'jy-btn', disabled: busy, onClick: () => act('/archive') }, '归档') : null,
            !isNew && entry.status !== 'active' ? h('button', { type: 'button', className: 'jy-btn', disabled: busy, onClick: () => act('/restore') }, '恢复') : null,
            !isNew && entry.status !== 'revoked' ? h('button', { type: 'button', className: 'jy-btn danger', disabled: busy, onClick: () => act('/revoke') }, '作废') : null
          ),
          (detail && detail.audit || []).length
            ? h('details', { className: 'jy-fold' },
              h('summary', null, '修改记录（' + detail.audit.length + '）'),
              detail.audit.slice().reverse().map((a, i) => h('div', { key: i, className: 'jy-audit-row' },
                fmtTime(a.ts) + ' · ' + (a.actor || '—') + ' · ' + (a.action || '') +
                (a.field ? ' · ' + a.field + '：' + String(a.before == null ? '—' : a.before) + ' → ' + String(a.after == null ? '—' : a.after) : ''))))
            : null
        )
      );
    }

    /* ---------- 主面板 ---------- */

    function JiyiPanel() {
      const [tab, setTab] = useState('items');
      const [q, setQ] = useState('');
      const [filters, setFilters] = useState({ category: 'all', status: 'active', cold: 'all', session: '' });
      const [items, setItems] = useState([]);
      const [stats, setStats] = useState(null);
      const [weights, setWeights] = useState(null);
      const [diag, setDiag] = useState(null);
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
      useEffect(() => {
        let alive = true;
        const query = q.trim();
        const run = async () => {
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
          } catch (e) {
            if (alive) fail(e);
          }
        };
        const timer = setTimeout(run, query ? 260 : 0);
        return () => { alive = false; clearTimeout(timer); };
      }, [q, filters, tick, fail]);

      // 自检页
      useEffect(() => {
        if (tab !== 'diag') return undefined;
        let alive = true;
        api('/diagnostics?limit=30')
          .then((d) => { if (alive) setDiag(d); })
          .catch((e) => { if (alive) fail(e); });
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

      const header = h('header', { className: 'jy-head' },
        h('div', { className: 'jy-title' },
          h('h1', null, '机忆'),
          h('span', { className: 'jy-sub' }, '本地 · 零成本 · 工作模式')
        ),
        h('div', { className: 'jy-head-stats' },
          h('span', { className: 'jy-dot ' + tone }),
          h('span', null, health.line || '读取中…'),
          health.reason ? h(Pill, { tone: 'warn' }, health.reason) : null,
          stats ? h('span', { className: 'jy-dim' }, '共 ' + stats.total + ' 条 · 活跃 ' + stats.active + ' · 冷 ' + stats.cold) : null
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
      );

      const toolbar = h('div', { className: 'jy-toolbar' },
        h('input', {
          ref: searchRef,
          className: 'jy-search',
          value: q,
          placeholder: '搜索记忆（按 / 聚焦）',
          onChange: (e) => setQ(e.target.value)
        }),
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
      );

      const list = h('div', { className: 'jy-list' },
        items.length === 0
          ? h('div', { className: 'jy-empty' }, q.trim() ? '没搜到；换个短一点的关键词试试。' : '这个筛选下没有条目。')
          : items.map((item) => h('button', {
            key: item.id,
            type: 'button',
            className: 'jy-card' + (detail && detail.entry && detail.entry.id === item.id ? ' on' : ''),
            'data-cat': item.category,
            onClick: () => openItem(item.id)
          },
            h('div', { className: 'jy-card-head' },
              h('span', { className: 'jy-badge cat', 'data-cat': item.category }, item.categoryLabel || CAT_LABEL[item.category] || item.category),
              h('span', { className: 'jy-card-title' }, item.title || '(无标题)'),
              h(Pill, { tone: item.zone === 'cold' ? 'cold' : 'hot' }, item.zone === 'cold' ? '冷' : '热'),
              item.status !== 'active' ? h(Pill, { tone: 'warn' }, item.statusLabel || item.status) : null,
              item.quote_edited ? h(Pill, { tone: 'warn' }, '原话已改') : null,
              (item.issues || []).length ? h(Pill, { tone: 'bad' }, '损坏') : null,
              h('span', { className: 'jy-grow' }),
              item.score != null ? h('span', { className: 'jy-score' }, item.score) : null
            ),
            h('div', { className: 'jy-card-text' }, item.preview || item.content || ''),
            h('div', { className: 'jy-card-meta' },
              h('span', null, item.sourceLabel || SOURCE_LABEL[item.source] || item.source),
              h('span', null, stars(item.importance)),
              h('span', null, '用过 ' + (item.uses || 0) + ' 次'),
              h('span', null, fmtTime(item.updated_at)),
              item.project ? h('span', null, item.project) : null,
              item.session ? h('span', null, '对话 ' + item.session) : null
            )
          ))
      );

      const itemsView = h('div', { className: 'jy-split' },
        h('div', { className: 'jy-main' }, toolbar, list),
        detail ? h(ItemEditor, {
          key: (detail.new ? 'new' : (detail.entry && detail.entry.id) || 'x'),
          detail,
          onClose: () => setDetail(null),
          onSaved: () => { setDetail(null); refresh(); }
        }) : null
      );

      const tuneView = h('div', { className: 'jy-pane' },
        h('section', { className: 'jy-card-panel' },
          h('h2', null, '分类权重'),
          h('p', { className: 'jy-dim' }, '只有工作模式一列。权重越高，这一类的条目在检索里越容易被选中；忽略＝永不自动检索。'),
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
          ),
          h('div', { className: 'jy-note' },
            '重要度系数：★1 ×' + (weights && weights.importanceFactors && weights.importanceFactors['1']) +
            ' · ★2 ×' + (weights && weights.importanceFactors && weights.importanceFactors['2']) +
            ' · ★3 ×' + (weights && weights.importanceFactors && weights.importanceFactors['3']) +
            ' · ★4 ×' + (weights && weights.importanceFactors && weights.importanceFactors['4']) +
            ' ｜ 冷区 ×' + (weights && weights.coldFactor))
        )
      );

      const diagView = h('div', { className: 'jy-pane' },
        h('section', { className: 'jy-card-panel' },
          h('div', { className: 'jy-sec-head' },
            h('h2', null, '自检'),
            h('span', { className: 'jy-dot ' + tone }),
            h('span', null, (diag && diag.health && diag.health.line) || health.line || ''),
            h('span', { className: 'jy-grow' }),
            h('button', { type: 'button', className: 'jy-btn', onClick: refresh }, '刷新')
          ),
          h('p', { className: 'jy-dim' },
            '连续空手 ' + ((diag && diag.health && diag.health.consecutiveMiss) || 0) + ' 轮 · 最近命中 ' +
            (diag && diag.health && diag.health.lastHitTurnsAgo != null ? diag.health.lastHitTurnsAgo + ' 轮前' : '无') +
            ' · 窗口 ' + ((diag && diag.health && diag.health.window) || 30) + ' 轮'),
          !diag
            ? h('div', { className: 'jy-empty' }, '读取中…')
            : (diag.turns || []).length === 0
              ? h('div', { className: 'jy-empty' }, '还没有真实轮次')
              : h('table', { className: 'jy-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '时间'), h('th', null, '问句'), h('th', null, '结果'), h('th', null, '命中/原因'), h('th', null, '耗时')
                )),
                h('tbody', null, diag.turns.map((t, i) => h('tr', { key: i },
                  h('td', { className: 'jy-dim' }, fmtTime(t.ts)),
                  h('td', { className: 'jy-cell-q', title: t.query }, t.query || '—'),
                  h('td', null, t.hit ? h(Pill, { tone: 'hot' }, '命中 ' + t.hits.length) : h(Pill, { tone: 'warn' }, '空手')),
                  h('td', { className: 'jy-cell-result' }, t.hit
                    ? t.hits.map((x) => '[' + x.id + '][' + (x.categoryLabel || x.category || '') + '] ' + (x.title || '')).join('；')
                    : (t.missReason || '未命中') +
                      ((t.nearMiss || []).length ? ' · 差一点：' + t.nearMiss.map((x) => (x.title || x.id)).join('；') : '')),
                  h('td', { className: 'jy-dim' }, String(t.ms || 0) + 'ms')
                )))
              )
        )
      );

      const organizeView = h('div', { className: 'jy-pane' },
        h('section', { className: 'jy-card-panel' },
          h('h2', null, '自动整理'),
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
            h('h2', null, '快照'),
            h('span', { className: 'jy-grow' }),
            h('button', { type: 'button', className: 'jy-btn', disabled: busy, onClick: snapshot }, '拍快照')
          ),
          snapshots.length === 0
            ? h('div', { className: 'jy-empty' }, '还没有快照')
            : snapshots.slice(0, 12).map((s) => h('div', { key: s.name, className: 'jy-row' },
              h('span', { className: 'jy-grow' }, s.name + ' · ' + fmtTime(s.createdAt || s.ts) + (s.note ? ' · ' + s.note : '')),
              h('button', { type: 'button', className: 'jy-btn', disabled: busy, onClick: () => rollback(s.name) }, '回滚')
            ))
        ),
        h('section', { className: 'jy-card-panel' },
          h('h2', null, '时间轴'),
          timeline.length === 0
            ? h('div', { className: 'jy-empty' }, '还没有事件')
            : timeline.slice(0, 40).map((row, i) => h('div', { key: i, className: 'jy-tl-row' },
              h('span', { className: 'jy-dim' }, fmtTime(row.ts)),
              h('span', { className: 'jy-badge type' }, TYPE_LABEL[row.type] || row.type),
              h('span', { className: 'jy-tl-text' }, (row.title || '') + (row.detail ? ' · ' + row.detail : ''))
            ))
        )
      );

      return h('div', { className: 'jy-page' },
        header,
        notice ? h('div', { className: 'jy-notice', onClick: () => setNotice('') }, notice) : null,
        tab === 'items' ? itemsView : tab === 'tune' ? tuneView : tab === 'diag' ? diagView : organizeView
      );
    }

    /* ---------- 样式（全部挂 .jy- 前缀，只用 --dsw-alias-* token） ---------- */

    const CSS = `
.jy-page{width:100%;min-width:0;height:100%;min-height:0;display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font-size:14px;line-height:1.6;overflow:hidden}
.jy-page *,.jy-page *::before,.jy-page *::after{box-sizing:border-box}
.jy-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:18px clamp(20px,3vw,40px) 12px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base)}
.jy-title{display:flex;flex-direction:column;gap:2px;margin-right:8px}
.jy-title h1{font-size:20px;font-weight:500;line-height:28px;margin:0}
.jy-sub{font-size:12px;color:var(--dsw-alias-label-secondary)}
.jy-head-stats{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);
  flex-wrap:wrap;max-width:520px}
.jy-grow{flex:1 1 auto}
.jy-dim{color:var(--dsw-alias-label-secondary);font-size:12px}
.jy-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 auto;
  background:var(--dsw-alias-state-idle-primary)}
.jy-dot.ok{background:var(--dsw-alias-state-success-primary)}
.jy-dot.warn{background:var(--dsw-alias-state-warn-primary)}
.jy-dot.red{background:var(--dsw-alias-state-error-primary)}
.jy-seg{display:inline-flex;padding:2px;border-radius:10px;gap:2px;
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.jy-seg-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:13px;padding:4px 12px;border-radius:8px;cursor:pointer}
.jy-seg-btn.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  box-shadow:0 1px 2px rgba(0,0,0,.08)}
.jy-btn{appearance:none;font:inherit;font-size:13px;padding:5px 12px;border-radius:9px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary)}
.jy-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.jy-btn:disabled{opacity:.5;cursor:default}
.jy-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.jy-btn.danger{color:var(--dsw-alias-state-error-primary)}
.jy-icon-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  font-size:15px;cursor:pointer;padding:2px 6px;border-radius:7px}
.jy-icon-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.jy-notice{padding:8px clamp(20px,3vw,40px);font-size:12px;cursor:pointer;
  background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-secondary)}
.jy-split{flex:1 1 auto;display:flex;min-height:0;overflow:hidden}
.jy-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0}
.jy-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:12px clamp(20px,3vw,40px)}
.jy-search{flex:1 1 220px;min-width:160px;font:inherit;font-size:13px;padding:6px 12px;
  border-radius:9px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.jy-search::placeholder{color:var(--dsw-alias-label-secondary)}
.jy-chips{display:flex;gap:6px;flex-wrap:wrap}
.jy-chip{appearance:none;font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);background:transparent;
  color:var(--dsw-alias-label-secondary)}
.jy-chip.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);
  border-color:var(--dsw-alias-border-l2)}
.jy-select{font:inherit;font-size:13px;padding:5px 8px;border-radius:9px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.jy-list{flex:1 1 auto;overflow:auto;padding:0 clamp(20px,3vw,40px) 32px;
  display:flex;flex-direction:column;gap:8px}
.jy-card{width:100%;text-align:left;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:6px;
  padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.jy-card:hover{background:var(--dsw-alias-bg-layer-2)}
.jy-card.on{border-color:var(--dsw-alias-brand-primary)}
.jy-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.jy-card-title{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.jy-card-text{font-size:13px;color:var(--dsw-alias-label-secondary);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.jy-card-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.jy-score{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.jy-badge{font-size:11px;padding:1px 7px;border-radius:999px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.jy-badge.cat{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.jy-badge.cat[data-cat="rules"]{box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.jy-badge.cat[data-cat="facts"]{box-shadow:inset 2px 0 0 var(--dsw-alias-state-success-primary)}
.jy-badge.cat[data-cat="pitfalls"]{box-shadow:inset 2px 0 0 var(--dsw-alias-state-warn-primary)}
.jy-badge.cat[data-cat="progress"]{box-shadow:inset 2px 0 0 var(--dsw-alias-state-idle-primary)}
.jy-pill{font-size:11px;padding:1px 7px;border-radius:999px;white-space:nowrap;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.jy-pill.hot{color:var(--dsw-alias-state-success-primary)}
.jy-pill.cold{color:var(--dsw-alias-state-idle-primary)}
.jy-pill.warn{color:var(--dsw-alias-state-warn-primary)}
.jy-pill.bad{color:var(--dsw-alias-state-error-primary)}
.jy-empty{padding:28px 4px;color:var(--dsw-alias-label-secondary);font-size:13px}
.jy-inspector{flex:0 0 clamp(320px,32vw,420px);display:flex;flex-direction:column;min-height:0;
  border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.jy-inspector-head{display:flex;align-items:center;gap:8px;padding:14px 16px;
  border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.jy-inspector-body{flex:1 1 auto;overflow:auto;padding:14px 16px 28px;
  display:flex;flex-direction:column;gap:12px}
.jy-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.jy-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.jy-field.wide{grid-column:1/-1}
.jy-field-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.jy-field input,.jy-field select,.jy-field textarea{width:100%;font:inherit;font-size:13px;
  padding:5px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.jy-field textarea{resize:vertical;line-height:1.55}
.jy-check{display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer}
.jy-check input{accent-color:var(--dsw-alias-brand-primary)}
.jy-inline{display:inline-flex;align-items:center;gap:6px;font-size:13px}
.jy-num{width:64px;font:inherit;font-size:13px;padding:4px 8px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary)}
.jy-readonly{font-size:13px;padding:5px 0;color:var(--dsw-alias-label-secondary)}
.jy-note{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.jy-note.bad{color:var(--dsw-alias-state-error-primary)}
.jy-actions{display:flex;gap:8px;flex-wrap:wrap}
.jy-fold{border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px;font-size:12px;
  color:var(--dsw-alias-label-secondary)}
.jy-fold summary{cursor:pointer}
.jy-audit-row{padding:2px 0;border-bottom:1px dashed var(--dsw-alias-border-l1)}
.jy-pane{flex:1 1 auto;overflow:auto;padding:16px clamp(20px,3vw,40px) 40px;
  display:flex;flex-direction:column;gap:16px}
.jy-card-panel{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;
  padding:16px 18px;background:var(--dsw-alias-bg-layer-1);
  display:flex;flex-direction:column;gap:10px}
.jy-card-panel h2{font-size:15px;font-weight:500;margin:0}
.jy-sec-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.jy-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.jy-table{width:100%;border-collapse:collapse;font-size:13px}
.jy-table th{text-align:left;font-weight:500;font-size:12px;padding:6px 8px;
  color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.jy-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}
.jy-cell-q{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jy-cell-result{max-width:520px;word-break:break-word}
.jy-tl-row{display:flex;align-items:baseline;gap:8px;font-size:12px;padding:3px 0;
  border-bottom:1px dashed var(--dsw-alias-border-l1)}
.jy-tl-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jy-badge.type{flex:0 0 auto}
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
