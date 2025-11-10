;(function () {
  const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
  let originalConsole = null;
  let originalFetch = null;
  let originalXHROpen = null;
  let originalXHRSend = null;

  let rootEl = null;
  let listEl = null;
  let autoscroll = true;
  let levelFilter = new Set(LEVELS);
  let knownIframeWindows = new WeakSet();

  function ensureUI() {
    if (rootEl) return;

    const style = document.createElement('style');
    style.textContent = `
      #devpanel-root { position: fixed; inset: 0; background: rgba(0,0,0,0.92); color: #d7d7d7; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; z-index: 2147483647; display: none; }
      #devpanel-wrap { display: flex; flex-direction: column; height: 100%; }
      #devpanel-header { display: flex; gap: 8px; align-items: center; padding: 8px 10px; background: #0f0f10; border-bottom: 1px solid #222; }
      #devpanel-header .title { font-weight: 600; margin-right: auto; color: #9fd3ff; }
      #devpanel-header button, #devpanel-header select, #devpanel-header label { background: #1a1a1c; color: #ddd; border: 1px solid #333; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
      #devpanel-header button:hover { background: #222326; }
      #devpanel-loglist { flex: 1; overflow: auto; padding: 8px 10px; line-height: 1.35; }
      .dev-row { white-space: pre-wrap; word-break: break-word; margin: 2px 0; }
      .dev-time { color: #888; margin-right: 6px; }
      .dev-src { color: #aaa; margin-right: 6px; }
      .dev-l-log { color: #eaeaea; }
      .dev-l-info { color: #a0e7ff; }
      .dev-l-warn { color: #ffd166; }
      .dev-l-error { color: #ff7b7b; }
      .dev-l-debug { color: #c2c2ff; }
      #devpanel-footer { padding: 8px 10px; background: #0f0f10; border-top: 1px solid #222; display: flex; gap: 8px; align-items: center; }
      #devpanel-input { flex: 1; background: #111214; color: #ddd; border: 1px solid #333; border-radius: 4px; padding: 6px 8px; font-family: inherit; font-size: 12px; }
    `;
    document.head.appendChild(style);

    rootEl = document.createElement('div');
    rootEl.id = 'devpanel-root';
    rootEl.innerHTML = `
      <div id="devpanel-wrap">
        <div id="devpanel-header">
          <span class="title">Dev Panel</span>
          <label><input id="devpanel-autoscroll" type="checkbox" checked /> Autoscroll</label>
          <label>Level:
            <select id="devpanel-level">
              <option value="all">All</option>
              <option value="log">Log</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
            </select>
          </label>
          <button id="devpanel-clear">Clear</button>
          <button id="devpanel-close">Close (Esc)</button>
        </div>
        <div id="devpanel-loglist"></div>
        <div id="devpanel-footer">
          <input id="devpanel-input" placeholder="Run JS... (Enter=Parent, Shift+Enter=Active Iframe)" />
          <button id="devpanel-run-parent" title="Run in parent">Run Parent</button>
          <button id="devpanel-run-iframe" title="Run in active iframe">Run Iframe</button>
        </div>
      </div>
    `;
    document.body.appendChild(rootEl);

    listEl = rootEl.querySelector('#devpanel-loglist');

    rootEl.querySelector('#devpanel-close').addEventListener('click', close);
    rootEl.querySelector('#devpanel-clear').addEventListener('click', () => { listEl.innerHTML = ''; });
    rootEl.querySelector('#devpanel-autoscroll').addEventListener('change', (e) => { autoscroll = !!e.target.checked; });
    rootEl.querySelector('#devpanel-level').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === 'all') levelFilter = new Set(LEVELS);
      else levelFilter = new Set([v]);
      // Apply filter visually (hide unmatched)
      Array.from(listEl.children).forEach(row => {
        const lvl = row.getAttribute('data-level');
        row.style.display = levelFilter.has(lvl) ? '' : 'none';
      });
    });
    const input = rootEl.querySelector('#devpanel-input');
    const runParent = rootEl.querySelector('#devpanel-run-parent');
    const runIframe = rootEl.querySelector('#devpanel-run-iframe');
    const doRunParent = () => {
      const code = input.value;
      if (!code) return;
      try {
        const res = (0, eval)(code);
        addLog('log', ['[eval parent]', res], 'parent');
      } catch (e) {
        addLog('error', ['[eval parent]', e && (e.stack || e.message) || String(e)], 'parent');
      }
    };
    const doRunIframe = () => {
      const code = input.value;
      if (!code) return;
      try {
        const tab = window.WavesApp && window.WavesApp.getActiveTab && window.WavesApp.getActiveTab();
        const cw = tab && tab.iframe && tab.iframe.contentWindow;
        if (!cw) throw new Error('No accessible iframe window');
        const res = cw.eval(code);
        addLog('log', ['[eval iframe]', res], 'iframe');
      } catch (e) {
        addLog('error', ['[eval iframe]', e && (e.stack || e.message) || String(e)], 'iframe');
      }
    };
    runParent.addEventListener('click', doRunParent);
    runIframe.addEventListener('click', doRunIframe);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doRunParent(); }
      else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); doRunIframe(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    document.addEventListener('keydown', (e) => {
      if (rootEl.style.display !== 'none' && e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); toggle(); }
    });
  }

  function formatArg(arg) {
    try {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === 'string') return arg;
      if (typeof arg === 'function') return arg.toString();
      if (arg && typeof arg === 'object') return JSON.stringify(arg, (k, v) => {
        if (v instanceof Node) return '[Node]';
        if (v instanceof Window) return '[Window]';
        return v;
      }, 2);
      return String(arg);
    } catch {
      try { return String(arg); } catch { return '[unprintable]'; }
    }
  }

  function ts() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
  }

  function addLog(level, args, source) {
    ensureUI();
    if (!levelFilter.has(level)) return;
    const row = document.createElement('div');
    row.className = `dev-row dev-l-${level}`;
    row.setAttribute('data-level', level);
    row.innerHTML = `<span class="dev-time">${ts()}</span><span class="dev-src">[${source}]</span>${args.map(formatArg).join(' ')}`;
    listEl.appendChild(row);
    if (autoscroll) listEl.scrollTop = listEl.scrollHeight;
  }

  function open() { ensureUI(); rootEl.style.display = 'block'; }
  function close() { if (!rootEl) return; rootEl.style.display = 'none'; }
  function toggle() { if (!rootEl || rootEl.style.display === 'none') open(); else close(); }

  function hookConsole() {
    if (originalConsole) return; // already hooked
    originalConsole = {};
    LEVELS.forEach(l => { originalConsole[l] = console[l]; });
    LEVELS.forEach(l => {
      const orig = originalConsole[l] || originalConsole.log;
      console[l] = function (...args) {
        try { addLog(l, args, 'parent'); } catch {}
        return orig.apply(console, args);
      };
    });
    window.addEventListener('error', (e) => {
      addLog('error', [e.message, `${e.filename || ''}:${e.lineno || 0}:${e.colno || 0}`], 'parent');
    });
    window.addEventListener('unhandledrejection', (e) => {
      const reason = e && e.reason;
      addLog('error', ['UnhandledRejection:', reason && (reason.stack || reason.message) || String(reason)], 'parent');
    });
  }

  function hookNetwork() {
    if (!originalFetch) {
      originalFetch = window.fetch;
      if (typeof originalFetch === 'function') {
        window.fetch = function (...args) {
          try {
            const input = args[0];
            const init = args[1] || {};
            const method = (init.method || 'GET').toUpperCase();
            const url = (typeof input === 'string') ? input : (input && input.url) || String(input);
            const start = performance.now();
            addLog('info', [`fetch ${method} ${url}`], 'parent');
            return originalFetch.apply(this, args).then(res => {
              const dur = Math.round(performance.now() - start);
              addLog('info', [`fetch -> ${res.status} ${res.statusText} (${dur}ms)`], 'parent');
              return res;
            }).catch(err => {
              const dur = Math.round(performance.now() - start);
              addLog('error', [`fetch ERR (${dur}ms):`, err && (err.stack || err.message) || String(err)], 'parent');
              throw err;
            });
          } catch (e) {
            addLog('error', ['fetch hook error:', e && (e.stack || e.message) || String(e)], 'parent');
            return originalFetch.apply(this, args);
          }
        };
      }
    }

    if (!originalXHROpen && window.XMLHttpRequest) {
      originalXHROpen = XMLHttpRequest.prototype.open;
      originalXHRSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
        try { this.__devpanel = { method, url, start: 0 }; } catch {}
        return originalXHROpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        try { if (this.__devpanel) this.__devpanel.start = performance.now(); } catch {}
        this.addEventListener('loadend', () => {
          try {
            const meta = this.__devpanel || { method: 'GET', url: this.responseURL };
            const dur = meta.start ? Math.round(performance.now() - meta.start) : 0;
            addLog('info', [`xhr ${meta.method} ${meta.url} -> ${this.status} (${dur}ms)`], 'parent');
          } catch {}
        });
        return originalXHRSend.apply(this, arguments);
      };
    }
  }

  function attachToActiveIframe() {
    try {
      const tab = window.WavesApp && window.WavesApp.getActiveTab && window.WavesApp.getActiveTab();
      const iframe = tab && tab.iframe;
      if (!iframe || !iframe.contentDocument || !iframe.contentWindow) return;
      if (iframe.dataset.devpanelHooked) return;

      // mark known window to accept postMessage logs
      try { knownIframeWindows.add(iframe.contentWindow); } catch {}

      const script = iframe.contentDocument.createElement('script');
      script.text = `(() => {
        try {
          if (window.__devpanelHooked) return; window.__devpanelHooked = true;
          const LEVELS=['log','info','warn','error','debug'];
          const orig = {}; LEVELS.forEach(l=>orig[l]=console[l]);
          const safeSerialize = (v)=>{ try{ if (v instanceof Error) return v.stack||v.message; if (typeof v==='string') return v; if (typeof v==='function') return v.toString(); if (v && typeof v==='object') return JSON.stringify(v, (k,val)=>{ if (val instanceof Node) return '[Node]'; if (val instanceof Window) return '[Window]'; return val;}); return String(v);}catch(e){ try { return String(v);} catch{ return '[unprintable]';}} };
          LEVELS.forEach(l=>{ const o=orig[l]||orig.log; console[l]=function(){ try{ parent.postMessage({ __devpanel:true, type:'iframe-console', level:l, args:Array.from(arguments).map(safeSerialize) }, '*');}catch(_){} return o.apply(console, arguments); } });
          window.addEventListener('error', e=>{ try{ parent.postMessage({ __devpanel:true, type:'iframe-error', message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, stack: e.error && (e.error.stack||e.error.message)}, '*'); }catch(_){} });
          window.addEventListener('unhandledrejection', e=>{ try{ const r=e&&e.reason; parent.postMessage({ __devpanel:true, type:'iframe-unhandledrejection', reason: (r && (r.stack||r.message)) || String(r) }, '*'); }catch(_){} });
        } catch(_) {}
      })();`;
      iframe.contentDocument.head.appendChild(script);
      iframe.dataset.devpanelHooked = '1';
      addLog('info', ['Attached dev hooks to iframe'], 'iframe');
    } catch {}
  }

  function onWindowMessage(e) {
    try {
      const d = e.data;
      if (!d || !d.__devpanel) return;
      if (e.origin && e.origin !== window.location.origin) return;
      const src = knownIframeWindows.has(e.source) ? 'iframe' : 'other';
      if (d.type === 'iframe-console') {
        const lvl = d.level || 'log';
        addLog(lvl, d.args || [], src);
      } else if (d.type === 'iframe-error') {
        addLog('error', [`${d.message || 'Error'} (${d.filename || ''}:${d.lineno || 0}:${d.colno || 0})`, d.stack || ''], src);
      } else if (d.type === 'iframe-unhandledrejection') {
        addLog('error', ['UnhandledRejection:', d.reason || ''], src);
      }
    } catch {}
  }

  function hookSWMessages() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
        navigator.serviceWorker.addEventListener('message', (evt) => {
          try {
            const data = evt.data;
            if (!data) return;
            const t = data.type || 'message';
            addLog(t === 'transport-error' ? 'error' : 'info', ['[SW]', t, data.url || data.target || '', data.error || ''], 'sw');
          } catch {}
        });
      }
    } catch {}
  }

  function init() {
    ensureUI();
    hookConsole();
    hookNetwork();
    hookSWMessages();
    window.addEventListener('message', onWindowMessage);
    // Attempt periodically; Scramjet/UV content becomes accessible after SW rewrites
    setInterval(attachToActiveIframe, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.DevPanel = {
    open, close, toggle,
    log: (...args) => addLog('log', args, 'parent'),
    info: (...args) => addLog('info', args, 'parent'),
    warn: (...args) => addLog('warn', args, 'parent'),
    error: (...args) => addLog('error', args, 'parent'),
    debug: (...args) => addLog('debug', args, 'parent')
  };
})();

// Receive logs forwarded from child iframes and render them in the panel
try {
  window.addEventListener('message', (e) => {
    const d = e && e.data;
    if (!d || d.type !== 'devpanel-log') return;
    try {
      const level = (d.level || 'log');
      const args = Array.isArray(d.args) ? d.args : [String(d.args)];
      if (window.DevPanel && typeof window.DevPanel[level] === 'function') {
        // Call underlying addLog through exposed API by level
        window.DevPanel[level](...args);
      } else if (window.DevPanel && window.DevPanel.log) {
        window.DevPanel.log(...args);
      }
    } catch {}
  });
} catch {}

// Allow toggling from child iframes via postMessage (Ctrl+Shift+P forwarded)
try {
  window.addEventListener('message', (e) => {
    if (e && e.data && e.data.type === 'toggle-devpanel') {
      try { window.DevPanel && window.DevPanel.toggle && window.DevPanel.toggle(); } catch {}
    }
  });
} catch {}
