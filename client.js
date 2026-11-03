// workmem / client.js — DSH 界面内两个入口：
//   ① 「记」悬浮按钮 → 打开原生面板 /workmem/panel/
//   ② 「命中 N」徽章 → 点开看本轮命中了哪几条记忆（数据来自记忆命中服务 8796）
window.__ModuleLoader__.load({
  id: 'workmem',
  factory(require) {
    const reactModule = require('react');
    const React = reactModule && typeof reactModule.createElement === 'function'
      ? reactModule
      : reactModule?.default;
    if (!React) return { apply() {}, inject: [] };
    const h = React.createElement;

    const CSS_ID = 'workmem-style';
    const CSS = [
      '.wm-fab{position:fixed;right:18px;bottom:64px;z-index:60;width:36px;height:36px;border-radius:10px;border:1px solid rgba(127,127,127,.35);background:rgba(30,38,48,.92);color:#e7ebef;font-size:13px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.28);}',
      '.wm-fab:hover{border-color:#76a7ff;}',
      '.wm-ovl{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px;}',
      '.wm-win{width:min(1120px,96vw);height:min(760px,92vh);display:flex;flex-direction:column;background:#101317;border:1px solid #2c3540;border-radius:10px;overflow:hidden;box-shadow:0 20px 70px rgba(0,0,0,.55);}',
      '.wm-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#161b21;border-bottom:1px solid #2c3540;color:#e7ebef;font:13px "Segoe UI","Microsoft YaHei",sans-serif;}',
      '.wm-grow{flex:1;}',
      '.wm-close{border:1px solid #2c3540;background:#20272f;color:#e7ebef;border-radius:6px;padding:3px 9px;cursor:pointer;}',
      '.wm-frame{flex:1;width:100%;border:0;background:#101317;}',
      // 命中徽章
      '.mh-chip{position:fixed;right:18px;bottom:110px;z-index:60;display:flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:rgba(24,32,42,.92);color:#cfd8e3;font:12px/1 "Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.25);}',
      '.mh-chip:hover{border-color:#76a7ff;color:#fff;}',
      '.mh-chip .dot{width:6px;height:6px;border-radius:50%;background:#4b5563;}',
      '.mh-chip.hit .dot{background:#34d399;box-shadow:0 0 6px #34d399;}',
      '.mh-chip.zero .dot{background:#9ca3af;}',
      '.mh-pop{position:fixed;right:18px;bottom:142px;z-index:65;width:330px;max-height:52vh;overflow:auto;background:#101317;border:1px solid #2c3540;border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.5);font:13px "Segoe UI","Microsoft YaHei",sans-serif;color:#e7ebef;}',
      '.mh-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #2c3540;background:#161b21;font-size:12px;color:#93a1b1;}',
      '.mh-item{padding:8px 12px;border-bottom:1px solid #1b2129;}',
      '.mh-item:last-child{border-bottom:0;}',
      '.mh-t{font-weight:600;color:#e7ebef;}',
      '.mh-m{color:#6b7480;font-size:11px;margin-top:2px;}',
      '.mh-empty{padding:14px 12px;color:#6b7480;}',
      '.mh-foot{padding:8px 12px;border-top:1px solid #2c3540;color:#7d8798;font-size:11px;display:flex;gap:8px;align-items:center;}'
    ];

    function installCss() {
      try {
        if (document.getElementById(CSS_ID)) return;
        const style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = CSS.join('\n');
        document.head.appendChild(style);
      } catch {}
    }

    const CAT = { rules: '规矩', facts: '事实', pitfalls: '坑', progress: '进度', persona: '人设', project: '项目', fact: '事实', lesson: '经验', topic: '话题', user: '偏好' };

    function Launcher() {
      const [open, setOpen] = React.useState(false);
      React.useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e?.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [open]);

      const fab = h('button', {
        className: 'wm-fab',
        title: '工作记忆面板',
        onClick: () => setOpen(true)
      }, '记');

      if (!open) return fab;
      return h(React.Fragment, null, fab,
        h('div', {
          className: 'wm-ovl',
          onClick: (e) => { if (e.target === e.currentTarget) setOpen(false); }
        },
          h('div', { className: 'wm-win' },
            h('div', { className: 'wm-bar' },
              h('b', null, '工作记忆'),
              h('span', { className: 'wm-grow' }),
              h('button', { className: 'wm-close', onClick: () => setOpen(false) }, '关闭')
            ),
            h('iframe', { className: 'wm-frame', src: '/workmem/panel/', title: '工作记忆面板' })
          )
        ));
    }

    // ── 本轮命中徽章 ────────────────────────────────
    function HitChip() {
      const [data, setData] = React.useState(null);
      const [open, setOpen] = React.useState(false);

      React.useEffect(() => {
        let alive = true;
        const pull = async () => {
          try {
            const r = await fetch('http://127.0.0.1:8796/api/data?limit=1', { cache: 'no-store' });
            const j = await r.json();
            if (alive) setData(j);
          } catch { if (alive) setData(null); }
        };
        pull();
        const t = setInterval(pull, 15000);
        return () => { alive = false; clearInterval(t); };
      }, []);

      const latest = data?.latest;
      const n = latest ? (latest.counts?.total || 0) : 0;
      const cls = 'mh-chip ' + (latest ? (n > 0 ? 'hit' : 'zero') : 'zero');
      const label = latest ? ('命中 ' + n) : '记忆…';

      const items = latest
        ? [...(latest.baseline || []).map((x) => ({ ...x, p: false })), ...(latest.picked || []).map((x) => ({ ...x, p: true }))]
        : [];

      const chip = h('button', {
        className: cls,
        title: latest ? ('本轮命中 ' + n + ' 条（保底 ' + (latest.counts?.baseline || 0) + ' / 检索 ' + (latest.counts?.picked || 0) + '），点击查看') : '记忆命中服务未连接',
        onClick: () => setOpen((v) => !v)
      }, h('span', { className: 'dot' }), label);

      if (!open) return chip;

      return h(React.Fragment, null, chip,
        h('div', { className: 'mh-pop' },
          h('div', { className: 'mh-head' },
            h('b', null, '本轮命中 ' + n + ' 条'),
            h('span', { className: 'wm-grow' }),
            latest ? ('保底 ' + (latest.counts?.baseline || 0) + ' · 检索 ' + (latest.counts?.picked || 0)) : ''
          ),
          items.length
            ? items.map((x, i) => h('div', { className: 'mh-item', key: (x.id || '') + i },
                h('div', { className: 'mh-t' }, x.title || '(无标题)'),
                h('div', { className: 'mh-m' }, (x.id || '') + ' · ' + (CAT[x.category] || x.category || '') + ' · ' + (x.p ? '检索命中' : '保底注入'))
              ))
            : h('div', { className: 'mh-empty' }, latest ? '本轮记忆空手' : '记忆命中服务没连上（8796）'),
          h('div', { className: 'mh-foot' },
            h('span', null, data?.stats ? ('命中率 ' + data.stats.hitRate + '% · 共 ' + data.stats.totalTurns + ' 轮') : ''),
            h('span', { className: 'wm-grow' }),
            h('button', { className: 'wm-close', onClick: () => setOpen(false) }, '关闭')
          )
        ));
    }

    function apply(ctx) {
      try {
        installCss();
        const slots = ctx.slots;
        if (!slots || typeof slots.register !== 'function') return;
        const reg = (name, id, order, Comp) => {
          const fn = () => slots.register({ name, id, order }, Comp);
          return typeof slots.inject === 'function' ? slots.inject(name, fn) : fn();
        };
        const d1 = reg('shell.overlay', 'workmem-launcher', 57, Launcher);
        const d2 = reg('shell.overlay', 'workmem-hitchip', 58, HitChip);
        if (typeof ctx.effect === 'function') {
          if (typeof d1 === 'function') ctx.effect(() => d1, 'workmem: launcher');
          if (typeof d2 === 'function') ctx.effect(() => d2, 'workmem: hitchip');
        }
        console.info('[workmem] launcher + hit chip registered');
      } catch (e) {
        console.error('[workmem] client apply failed', e);
      }
    }

    return { apply, inject: ['slots'] };
  }
});
