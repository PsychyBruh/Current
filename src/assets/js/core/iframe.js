import { dom } from '../ui/dom.js';
import { showLoadingScreen, hideLoadingScreen } from '../ui/ui.js';
import { decodeUrl } from './utils.js';

let loadingTimeout = null;

export function navigateIframeTo(iframe, url) {
    if (!url || !iframe) return;
    showLoadingScreen();
    window.WavesApp.isLoading = true;
    delete iframe.dataset.reloadAttempted;

    if (loadingTimeout) clearTimeout(loadingTimeout);
    loadingTimeout = setTimeout(() => {
        console.warn('Loading timed out. Forcing UI update...');
        hideLoadingScreen();
        window.WavesApp.isLoading = false;
        
        const activeTab = window.WavesApp.getActiveTab();
        if (activeTab && activeTab.iframe === iframe) {
            updateTabDetails(iframe);
            try {
                const currentUrl = iframe.contentWindow.location.href;
                if (currentUrl && currentUrl !== 'about:blank') {
                    activeTab.historyManager.push(currentUrl);
                }
            } catch (e) {
                console.warn("Could not force-grab URL on timeout.", e);
            }
        }
    }, 20000);

    const decodedUrl = decodeUrl(url);

    if (decodedUrl.startsWith("https://cdn.jsdelivr.net/gh/gn-math/html@main/")) {
        
        iframe.dataset.manualUrl = decodedUrl; 
        
        fetch(decodedUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to fetch game: ${response.statusText}`);
                }
                return response.text();
            })
            .then(html => {
                iframe.contentDocument.open();
                iframe.contentDocument.write(html);
                iframe.contentDocument.close();
            })
            .catch(error => {
                console.error('Failed to load gn-math game:', error);
                if (loadingTimeout) clearTimeout(loadingTimeout);
                hideLoadingScreen();
                window.WavesApp.isLoading = false;
                delete iframe.dataset.manualUrl;
                iframe.src = 'about:blank';
            });
    } else {
        iframe.src = url;
    }
}

function updateTabDetails(iframe) {
    const activeTab = window.WavesApp.getActiveTab();
    if (!activeTab) return;

    try {
        const iframeWindow = iframe.contentWindow;
        const doc = iframeWindow.document;
        const newUrl = iframe.dataset.manualUrl || iframeWindow.location.href;

        activeTab.title = doc.title || 'New Tab';

        if ((activeTab.title === '404!!' || activeTab.title === 'Scramjet')) {
            let reloadCount = parseInt(iframe.dataset.reloadCount || '0', 10);
            if (reloadCount < 5) {
                try {
                    iframe.dataset.reloadCount = (reloadCount + 1).toString();
                    setTimeout(() => {
                        try {
                            iframe.contentWindow.location.reload(true);
                        } catch (err) {
                            console.warn('Could not force-reload page:', err);
                        }
                    }, 2000);
                    return;
                } catch (e) {
                    console.warn('Error scheduling reload:', e);
                }
            }
        }

        const iconLink = doc.querySelector("link[rel*='icon']");
        if (iconLink) {
            activeTab.favicon = new URL(iconLink.href, newUrl).href;
        } else {
            activeTab.favicon = new URL('/favicon.ico', newUrl).origin + '/favicon.ico';
        }
    } catch (e) {
        activeTab.title = 'New Tab';
        activeTab.favicon = null;
    } finally {
        if (window.WavesApp.renderTabs) {
            window.WavesApp.renderTabs();
        }
        if (activeTab && activeTab.iframe?.dataset.manualUrl) {
            delete activeTab.iframe.dataset.manualUrl;
        }
    }
}

function setupIframeContentListeners(iframe, historyManager) {
    try {
        const iframeWindow = iframe.contentWindow;
        if (!iframeWindow || iframeWindow === window || iframeWindow.location.href === 'about:blank') return;

        const baseUrl = iframe.dataset.manualUrl || iframeWindow.location.href;

        const handleNav = (isReplace = false) => {
            const newUrlInIframe = iframeWindow.location.href;
            if (newUrlInIframe !== 'about:blank') {
                if (isReplace) {
                    historyManager.replace(newUrlInIframe);
                } else {
                    if (newUrlInIframe !== baseUrl) {
                        historyManager.push(newUrlInIframe);
                    }
                }
            }
        };

        if (!iframeWindow.history.pushState.__isPatched) {
            const originalPushState = iframeWindow.history.pushState;
            iframeWindow.history.pushState = function(...args) {
                originalPushState.apply(this, args);
                handleNav();
            };
            iframeWindow.history.pushState.__isPatched = true;
        }
        if (!iframeWindow.history.replaceState.__isPatched) {
            const originalReplaceState = iframeWindow.history.replaceState;
            iframeWindow.history.replaceState = function(...args) {
                originalReplaceState.apply(this, args);
                handleNav(true);
            };
            iframeWindow.history.replaceState.__isPatched = true;
        }

        iframeWindow.removeEventListener('beforeunload', iframeWindow.__beforeUnloadHandler);
        iframeWindow.__beforeUnloadHandler = () => {
            showLoadingScreen();
            window.WavesApp.isLoading = true;
        }
        iframeWindow.addEventListener('beforeunload', iframeWindow.__beforeUnloadHandler);

        iframeWindow.removeEventListener('DOMContentLoaded', iframeWindow.__domContentLoadedHandler);
        iframeWindow.__domContentLoadedHandler = () => {
            if (loadingTimeout) clearTimeout(loadingTimeout);
            hideLoadingScreen();
            window.WavesApp.isLoading = false;

            historyManager.push(baseUrl);
            
            updateTabDetails(iframe);
        };
        iframeWindow.addEventListener('DOMContentLoaded', iframeWindow.__domContentLoadedHandler);

        // Forward Ctrl+Shift+P from the game iframe to parent to toggle DevPanel
        try {
            iframeWindow.removeEventListener('keydown', iframeWindow.__devpanelKeyHandler, true);
        } catch {}
        iframeWindow.__devpanelKeyHandler = (evt) => {
            try {
                const isCtrl = evt.ctrlKey || evt.metaKey; // support Cmd on macOS
                if (isCtrl && evt.shiftKey && String(evt.key || '').toLowerCase() === 'p') {
                    window.parent.postMessage({ type: 'toggle-devpanel' }, '*');
                    evt.preventDefault();
                }
            } catch {}
        };
        iframeWindow.addEventListener('keydown', iframeWindow.__devpanelKeyHandler, true);

        // Inject lightweight console/network forwarder so DevPanel receives logs from the iframe
        try {
            const doc = iframeWindow.document;
            if (!doc.getElementById('devpanel-forwarder')) {
                const s = doc.createElement('script');
                s.id = 'devpanel-forwarder';
                s.textContent = `(() => {
                  try {
                    const post = (level, args) => {
                      try {
                        const safe = (v) => {
                          try { if (v && v.stack) return v.stack; if (typeof v === 'object') return JSON.stringify(v); return String(v); } catch { return '[unprintable]'; }
                        };
                        parent.postMessage({ type: 'devpanel-log', level, args: Array.from(args).map(safe), source: 'iframe' }, '*');
                      } catch {}
                    };
                    ['log','info','warn','error','debug'].forEach(l => {
                      const orig = console[l] || console.log;
                      console[l] = function(...a){ try { post(l, a); } catch {} try { return orig.apply(console, a); } catch {} };
                    });
                    addEventListener('error', e => post('error', [e.message, (e.filename||'')+':' + (e.lineno||0)+':' + (e.colno||0)]));
                    addEventListener('unhandledrejection', e => {
                      const r = e && e.reason; post('error', ['UnhandledRejection:', (r && (r.stack||r.message)) || String(r)]);
                    });
                    if (typeof fetch === 'function') {
                      const of = fetch; 
                      window.fetch = function(...args){
                        try { post('info', ['fetch ' + ((args[1]?.method||'GET').toUpperCase()) + ' ' + (typeof args[0]==='string'?args[0]:(args[0]&&args[0].url)||'')]); } catch {}
                        const t0 = performance.now();
                        return of.apply(this, args).then(res => { try { post('info', ['fetch -> ' + res.status + ' ' + res.statusText + ' (' + Math.round(performance.now()-t0) + 'ms)']); } catch {} return res; })
                        .catch(err => { try { post('error', ['fetch ERR:', (err && (err.stack||err.message)) || String(err)]); } catch {} throw err; });
                      };
                    }
                  } catch {}
                })();`;
                (doc.head || doc.documentElement || doc.body).appendChild(s);
              }
        } catch {}
        
    } catch (e) {
        console.warn("Could not attach listeners to iframe content. Likely transient state or cross-origin.");
        throw e;
    }
}


export function updateHistoryUI(activeTab, { currentUrl, canGoBack, canGoForward }) {
    const stillExists = activeTab && window.WavesApp?.tabs?.some(tab => tab.id === activeTab.id);

    if (!activeTab || !activeTab.iframe || !stillExists) {
        if (dom.searchInputNav) dom.searchInputNav.value = '';
        if (dom.backBtn) dom.backBtn.classList.add('disabled');
        if (dom.forwardBtn) dom.forwardBtn.classList.add('disabled');
        if (dom.lockIcon) dom.lockIcon.className = 'fa-regular fa-unlock-keyhole';
        return;
    }
    
    const { iframe } = activeTab;

    if (dom.backBtn && dom.forwardBtn) {
        dom.backBtn.classList.toggle('disabled', !canGoBack);
        dom.forwardBtn.classList.toggle('disabled', !canGoForward);
    }
    if (dom.searchInputNav) {
        const displayUrl = iframe.dataset.manualUrl || currentUrl || iframe.src;
        const decoded = decodeUrl(displayUrl);
        
        dom.searchInputNav.value = decoded;
        if (dom.lockIcon) {
            const isSecure = decoded && decoded.startsWith('https://');
            dom.lockIcon.className = isSecure ? 'fa-regular fa-lock-keyhole' : 'fa-regular fa-unlock-keyhole';
        }
    }
}

export function initializeIframe(iframe, historyManager) {
    iframe.addEventListener('error', () => {
        if (loadingTimeout) clearTimeout(loadingTimeout);
        hideLoadingScreen();
        window.WavesApp.isLoading = false;
    });

    let pollInterval = null;
    const attemptToSetupListeners = () => {
        try {
            setupIframeContentListeners(iframe, historyManager);
            clearInterval(pollInterval);
            pollInterval = null;
        } catch (e) {}
    };

    pollInterval = setInterval(attemptToSetupListeners, 10);

    iframe.addEventListener('load', () => {
        if (loadingTimeout) clearTimeout(loadingTimeout);
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }

        hideLoadingScreen();
        window.WavesApp.isLoading = false;

        const manualUrl = iframe.dataset.manualUrl;
        const newUrl = manualUrl ?? iframe.contentWindow?.location.href ?? iframe.src;
        
        if (newUrl !== 'about:blank') {
            historyManager.push(newUrl);
        }

        updateTabDetails(iframe);

        try {
            setupIframeContentListeners(iframe, historyManager);
        } catch (e) {}

        window.WavesApp.updateNavbarDisplay?.();
    });
}
