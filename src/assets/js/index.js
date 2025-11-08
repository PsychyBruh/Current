import { dom } from './ui/dom.js';
import { HistoryManager } from './core/history.js';
import { initializeUI, hideLoadingScreen, showHomeView, showBrowserView } from './ui/ui.js';
import { initializeIframe, updateHistoryUI } from './core/iframe.js';
import { initializeSearch, handleSearch as performSearch } from './search/search.js';
import { initializeBookmarks } from './features/bookmarks.js';
import './features/devpanel.js';

function handleServiceWorkerMessage(event) {
    const { data } = event;
    if (data && data.type === 'url-update' && data.url) {
        try { window.DevPanel && window.DevPanel.info && window.DevPanel.info('[SW] url-update', data.url); } catch {}
        const activeTab = window.WavesApp.getActiveTab();
        
        if (activeTab && activeTab.historyManager) {
            activeTab.historyManager.push(data.url);
            
            if (!activeTab.isUrlLoaded) {
                 activeTab.isUrlLoaded = true;
                 showBrowserView();
            }
        }
    }
    // Detect transport-level failures (e.g., epoxy TLS handshake issues) and auto-fallback to libcurl
    if (data && data.type === 'transport-error') {
        try {
            try { window.DevPanel && window.DevPanel.error && window.DevPanel.error('[SW] transport-error', data.error, data.target || data.url); } catch {}
            const errMsg = String(data.error || '').toLowerCase();
            const currentTransport = (localStorage.getItem('transport') || 'epoxy').toLowerCase();
            const candidateUrl = data.target || data.url || '';
            // Common epoxy failure signature: "tls handshake eof" or Hyper client errors
            const isTlsHandshakeFailure = /tls\s*handshake|unexpectedeof|unexpected\s*eof|hyper\s*client/.test(errMsg);
            if (isTlsHandshakeFailure && currentTransport === 'epoxy' && candidateUrl) {
                try { localStorage.setItem('retryAfterTransportSwitch', candidateUrl); } catch (_) {}
                // Ask connection manager to switch transports; it will reload on success
                document.dispatchEvent(new CustomEvent('newTransport', { detail: 'libcurl' }));
            }
        } catch (e) {
            console.warn('Failed to process transport-error message', e);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    }

    window.WavesApp = window.WavesApp || {};
    window.WavesApp.isLoading = false;

     if (document.getElementById('new-tab-modal')) {
        document.getElementById('new-tab-modal').style.display = '';
    }

    let tabs = [];
    window.WavesApp.tabs = tabs;
    let activeTabId = null;

    let allGames = window.WavesApp.allGames || [];
    window.WavesApp.allGames = allGames;
    
    let newTabUnifiedWrapper = null;
    let newTabResultsContainer = null;

    const ZONES_URL = "https://cdn.jsdelivr.net/gh/gn-math/assets@latest/zones.json";
    const HTML_URL = "https://cdn.jsdelivr.net/gh/gn-math/html@main";

    function loadNewTabGamesData() {
        if (allGames.length > 0) return Promise.resolve(allGames);
        
        return fetch(ZONES_URL)
            .then(res => {
                if (!res.ok) {
                    throw new Error(`Network response was not ok: ${res.statusText}`);
                }
                return res.json();
            })
            .then(data => {
                const loadedGames = data
                    .map(zone => {
                        const isExternal = zone.url.startsWith('http');
                        return {
                            id: zone.id,
                            name: zone.name,
                            gameUrl: isExternal ? zone.url : zone.url.replace("{HTML_URL}", HTML_URL),
                            isExternal: isExternal
                        };
                    })
                    .filter(game => !game.name.startsWith('[!]') && !game.name.startsWith('Chat Bot'));
                
                loadedGames.sort((a, b) => a.name.localeCompare(b.name));
                
                allGames.splice(0, allGames.length, ...loadedGames); 
                window.WavesApp.allGames = allGames;
                
                return allGames;
            })
            .catch(err => {
                console.error('Failed to load new tab game data:', err);
            });
    }

    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    if(toggleSidebarBtn) {
        toggleSidebarBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.body.classList.toggle('sidebar-hidden'); 
        });
    }

    function getActiveTab() {
        return tabs.find(tab => tab.id === activeTabId);
    }
    
    window.WavesApp.getActiveTab = getActiveTab;

    function createIframe() {
        const iframe = document.createElement('iframe');
        iframe.className = 'iframe';
        iframe.loading = 'lazy';
        iframe.allow = 'fullscreen';
        iframe.referrerPolicy = 'no-referrer';
        dom.iframeContainer.appendChild(iframe);
        return iframe;
    }

    function createTabElement(tab) {
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.dataset.tabId = tab.id;

        const iconEl = document.createElement('img');
        iconEl.className = 'tab-icon';
        const defaultIcon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="%23818181" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1h-2v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';
        iconEl.src = tab.favicon || defaultIcon;
        iconEl.onerror = () => { iconEl.src = defaultIcon; };

        const titleEl = document.createElement('span');
        titleEl.className = 'tab-title';
        titleEl.textContent = tab.title;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.innerHTML = '<i class="fa-solid fa-times"></i>';

        tabEl.appendChild(iconEl);
        tabEl.appendChild(titleEl);
        tabEl.appendChild(closeBtn);

        tabEl.addEventListener('click', () => switchTab(tab.id));
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        });

        return tabEl;
    }

    function renderTabs() {
        dom.tabsContainer.innerHTML = '';
        tabs.forEach(tab => {
            const tabEl = createTabElement(tab);
            if (tab.id === activeTabId) {
                tabEl.classList.add('active');
            }
            dom.tabsContainer.appendChild(tabEl);
        });
    }

    window.WavesApp.renderTabs = renderTabs;

    function addTab(url = null, title = 'New Tab') {
        const newTabId = Date.now();
        const iframe = createIframe();
        const historyManager = new HistoryManager({
            onUpdate: (history) => updateHistoryUI(getActiveTab(), history)
        });

        const newTab = {
            id: newTabId,
            title: title,
            favicon: null,
            iframe: iframe,
            historyManager: historyManager,
            isUrlLoaded: !!url,
            scrollX: 0,
            scrollY: 0
        };

        iframe.addEventListener('load', () => {
            try {
                const doc = newTab.iframe.contentDocument;
                if (doc) {
                    const newTitle = doc.title;
                    if (newTitle && newTitle.trim() !== '') {
                        newTab.title = newTitle;
                    } else {
                        newTab.title = newTab.iframe.contentWindow.location.hostname || 'Untitled';
                    }
                    
                    const faviconLink = doc.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
                    newTab.favicon = faviconLink ? faviconLink.href : null;

                    renderTabs();
                }
            } catch (e) {
                console.warn('Could not access iframe content to update tab title', e);
            }
        });

        tabs.push(newTab);
        
        initializeIframe(iframe, historyManager);
        
        if (url) {
            performSearch(url, newTab);
        }
        
        switchTab(newTabId);
        return newTab;
    }

    function switchTab(tabId) {
        const oldActiveTab = getActiveTab();
        if (oldActiveTab && oldActiveTab.iframe.contentWindow) {
            try {
                oldActiveTab.scrollX = oldActiveTab.iframe.contentWindow.scrollX;
                oldActiveTab.scrollY = oldActiveTab.iframe.contentWindow.scrollY;
            } catch (e) {
                console.warn('Could not save scroll position for tab', oldActiveTab.id, e);
            }
        }

        activeTabId = tabId;
        const activeTab = getActiveTab();

        tabs.forEach(tab => {
            tab.iframe.classList.toggle('active', tab.id === tabId);
        });
        
        renderTabs();

        if (activeTab) {
            if (activeTab.iframe.contentWindow) {
                 try {
                    setTimeout(() => {
                       activeTab.iframe.contentWindow.scrollTo(activeTab.scrollX, activeTab.scrollY);
                    }, 0); 
                 } catch (e) {
                     console.warn('Could not restore scroll position for tab', activeTab.id, e);
                 }
            }

            if (activeTab.isUrlLoaded) {
                showBrowserView();
            } else {
                showHomeView();
            }

            updateHistoryUI(activeTab, {
                currentUrl: activeTab.historyManager.getCurrentUrl(),
                canGoBack: activeTab.historyManager.canGoBack(),
                canGoForward: activeTab.historyManager.canGoForward(),
            });
        } else {
            showHomeView(); 
            if (dom.searchInputNav) dom.searchInputNav.value = '';
            if (dom.backBtn) dom.backBtn.classList.add('disabled');
            if (dom.forwardBtn) dom.forwardBtn.classList.add('disabled');
        }
    }

    function closeTab(tabId) {
        const tabIndex = tabs.findIndex(tab => tab.id === tabId);
        if (tabIndex === -1) return;

        const wasActive = activeTabId === tabId;
        const [closedTab] = tabs.splice(tabIndex, 1);

        closedTab.iframe.remove();

        if (wasActive) {
            if (tabs.length > 0) {
                const newActiveIndex = Math.max(0, tabIndex - 1);
                switchTab(tabs[newActiveIndex].id);
            } else {
                addTab(null, 'New Tab');
            }
        } else {
            renderTabs();
        }
    }
    
    function onWindowBlur() {
        if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
            hideNewTabModal();
        }
    }

    function outsideClickListener(event) {
        if (!dom.newTabModal.contains(event.target) && !dom.addTabBtn.contains(event.target)) {
            hideNewTabModal();
        }
    }
    
    function initializeNewTabModal() {
        if (!newTabUnifiedWrapper) {
            newTabUnifiedWrapper = document.createElement('div');
            newTabUnifiedWrapper.className = 'new-tab-unified-wrapper';
    
            const newTabSearchContainer = document.createElement('div');
            newTabSearchContainer.className = 'new-tab-search-container';
    
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-magnifying-glass';
            newTabSearchContainer.appendChild(icon);
    
            newTabSearchContainer.appendChild(dom.newTabInput);
            
            newTabResultsContainer = document.createElement('div');
            newTabResultsContainer.className = 'new-tab-results-container';
    
            newTabUnifiedWrapper.appendChild(newTabSearchContainer);
            newTabUnifiedWrapper.appendChild(newTabResultsContainer);
    
            dom.newTabModal.appendChild(newTabUnifiedWrapper);
        }
    }

    function showNewTabModal() {
        dom.newTabModal.classList.add('is-visible');
        dom.newTabInput.focus();
        
        if (newTabResultsContainer) {
            newTabResultsContainer.innerHTML = '';
            newTabResultsContainer.style.display = 'none'; 
        }
        
        if (newTabUnifiedWrapper) {
            newTabUnifiedWrapper.classList.remove('has-results');
        }

        loadNewTabGamesData();

        setTimeout(() => {
            window.addEventListener('click', outsideClickListener);
            window.addEventListener('blur', onWindowBlur);
        }, 0);
    }

    function hideNewTabModal() {
        if (!dom.newTabModal.classList.contains('is-visible')) return;

        window.removeEventListener('click', outsideClickListener);
        window.removeEventListener('blur', onWindowBlur);

        dom.newTabModal.classList.remove('is-visible');
        
        dom.newTabInput.value = '';
        
        if (newTabResultsContainer) {
            newTabResultsContainer.innerHTML = '';
            newTabResultsContainer.style.display = 'none';
        }
        
        if (newTabUnifiedWrapper) {
            newTabUnifiedWrapper.classList.remove('has-results');
        }
    }

    function handleNewTabAction(url, title) {
        if (url) {
            addTab(url, title);
        }
        hideNewTabModal();
    }

    function updateNewTabResults() {
        const query = dom.newTabInput.value.trim();
        const lowerCaseQuery = query.toLowerCase();
        newTabResultsContainer.innerHTML = '';

        if (!query) {
            newTabUnifiedWrapper.classList.remove('has-results');
            newTabResultsContainer.style.display = 'none';
            return;
        }

        const currentSearchEngine = localStorage.getItem('searchEngine') || 'DuckDuckGo';

        newTabUnifiedWrapper.classList.add('has-results');
        newTabResultsContainer.style.display = 'block';

        const searchEl = document.createElement('div');
        searchEl.className = 'new-tab-result-item';
        searchEl.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> ${query} - Search with ${currentSearchEngine}`;
        searchEl.addEventListener('click', () => {
            handleNewTabAction(query, 'Loading...');
        });
        
        newTabResultsContainer.appendChild(searchEl);
        
        const filteredGames = allGames.filter(g => (g.name || '').toLowerCase().includes(lowerCaseQuery)).slice(0, 4);

        filteredGames.forEach(game => {
            const gameEl = document.createElement('div');
            gameEl.className = 'new-tab-result-item';
            gameEl.innerHTML = `<i class="fa-solid fa-gamepad"></i> <span>${game.name}</span>`;
            gameEl.addEventListener('click', () => {
                handleNewTabAction(game.gameUrl, game.name);
            });
            newTabResultsContainer.appendChild(gameEl);
        });
    }

    window.WavesApp.handleSearch = (query) => {
        const activeTab = getActiveTab();
        if (activeTab) {
            performSearch(query, activeTab);
        }
    };
    
    initializeUI(getActiveTab);
    initializeSearch(getActiveTab);
    initializeBookmarks();
    initializeNewTabModal();

    dom.addTabBtn.addEventListener('click', showNewTabModal);
    
    dom.newTabInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            const firstResult = newTabResultsContainer.querySelector('.new-tab-result-item');
            if (firstResult) {
                firstResult.click();
            } else {
                handleNewTabAction(dom.newTabInput.value.trim(), 'Loading...');
            }
        } else if (e.key === 'Escape') {
            hideNewTabModal();
        } else {
            updateNewTabResults();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dom.newTabModal.classList.contains('is-visible')) {
            hideNewTabModal();
        }
    });


    addTab(null, 'Loading...');

    window.addEventListener('load', () => {
        const activeTab = getActiveTab();
        if (activeTab && !activeTab.isUrlLoaded) {
            hideLoadingScreen();
            window.WavesApp.isLoading = false;
            showHomeView();
            if (dom.searchInputMain) dom.searchInputMain.disabled = false;
        }

        // If a previous page asked us to switch transports due to a handshake error,
        // resume navigation to the original target once we're loaded.
        try {
            const pending = localStorage.getItem('retryAfterTransportSwitch');
            if (pending) {
                // Give the connection manager a brief moment to finish reinitialization
                setTimeout(() => {
                    try {
                        const tab = getActiveTab();
                        if (tab) {
                            window.WavesApp.handleSearch(pending);
                        }
                    } finally {
                        localStorage.removeItem('retryAfterTransportSwitch');
                    }
                }, 500);
            }
        } catch (_) {}
    });

    // Top-left Games button: switch to games home screen
    const gamesBtn = document.getElementById('games');
    if (gamesBtn) {
        gamesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.body.classList.remove('browser-view');
            document.body.classList.add('games-home-active');
        });
    }

    // Home switch button next to branding
    const homeSwitchBtn = document.getElementById('homeSwitchBtn');
    if (homeSwitchBtn) {
        homeSwitchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.body.classList.remove('browser-view');
            document.body.classList.remove('games-home-active');
        });
    }
});
