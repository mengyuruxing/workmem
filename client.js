// workmem / client.js — DSH 悬浮入口，打开 /workmem/panel/ 原生面板。
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
      '.wm-frame{flex:1;width:100%;border:0;background:#101317;}'
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
        title: '工作记忆',
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

    function apply(ctx) {
      try {
        installCss();
        const slots = ctx.slots;
        if (!slots || typeof slots.register !== 'function') return;
        const register = () => slots.register({ name: 'shell.overlay', id: 'workmem-launcher', order: 57 }, Launcher);
        const dispose = typeof slots.inject === 'function' ? slots.inject('shell.overlay', register) : register();
        if (typeof ctx.effect === 'function' && typeof dispose === 'function') ctx.effect(() => dispose, 'workmem: launcher');
        console.info('[workmem] launcher registered');
      } catch (e) {
        console.error('[workmem] client apply failed', e);
      }
    }

    return { apply, inject: ['slots'] };
  }
});
