try {
  if (localStorage.getItem('backend') !== 'ultraviolet' && typeof window['$scramjetLoadController'] === 'function') {
    const controllerFactory = window['$scramjetLoadController']();
    const ScramjetControllerRef = controllerFactory['ScramjetController'];
    const scramjet = new ScramjetControllerRef({
      prefix: "/b/s/",
      files: {
        wasm: "/b/s/scramjet.wasm.wasm",
        all: "/b/s/scramjet.all.js",
        sync: "/b/s/scramjet.sync.js"
      },
      flags: {
        rewriterLogs: true
      }
    });
    window.scramjetReady = scramjet.init();
  } else {
    window.scramjetReady = Promise.resolve();
  }
} catch(e) {
    console.warn("Could not initialize Scramjet, which is expected if you are on Ultraviolet.");
    window.scramjetReady = Promise.resolve();
}

document.addEventListener('DOMContentLoaded', function () {
  const searchBar = document.querySelector('.search-bar');
  if (searchBar) {
    const lightBg = searchBar.querySelector('.light');
    const lightBorder = searchBar.querySelector('.light-border');
    const lightSize = 400;

    let targetX = 0, currentX = 0, lastX = 0, velocityX = 0;
    let targetY = 0, currentY = 0, lastY = 0, velocityY = 0;
    let raf;

    function animate() {
      currentX += (targetX - currentX) * 0.15;
      currentY += (targetY - currentY) * 0.15;

      const elasticX = Math.min(Math.max(velocityX * 0.5, -20), 20);
      const elasticY = Math.min(Math.max(velocityY * 0.5, -20), 20);

      const bgX = `${currentX - lightSize / 2 + elasticX}px`;
      const bgY = `${currentY - lightSize / 2 + elasticY}px`;

      lightBg.style.setProperty('--bg-x', bgX);
      lightBg.style.setProperty('--bg-y', bgY);
      lightBorder.style.setProperty('--bg-x', bgX);
      lightBorder.style.setProperty('--bg-y', bgY);

      raf = requestAnimationFrame(animate);
    }

    searchBar.addEventListener('mouseenter', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(animate);
      lightBg.style.opacity = 1;
      lightBorder.style.opacity = 1;
      lightBg.style.transition = "opacity 0.4s ease, transform 0.4s ease, filter 0.6s ease";
      lightBorder.style.transition = "opacity 0.4s ease, transform 0.4s ease, filter 0.6s ease";
      lightBg.style.filter = "blur(20px)";
      lightBorder.style.filter = "blur(6px)";

      setTimeout(() => {
        lightBg.style.transform = "scale(1)";
        lightBg.style.filter = "blur(12px)";
        lightBorder.style.transform = "scale(1)";
        lightBorder.style.filter = "blur(4px)";
      }, 300);
    });

    searchBar.addEventListener('mouseleave', () => {
      cancelAnimationFrame(raf);
      lightBg.style.transition = "opacity 0.6s ease, transform 0.6s ease, filter 0.6s ease";
      lightBorder.style.transition = "opacity 0.6s ease, transform 0.6s ease, filter 0.6s ease";
      lightBg.style.opacity = 0;
      lightBorder.style.opacity = 0;
      lightBg.style.transform = "scale(0.95)";
      lightBorder.style.transform = "scale(0.95)";
      lightBg.style.filter = "blur(30px)";
      lightBorder.style.filter = "blur(12px)";
    });

    searchBar.addEventListener('mousemove', (e) => {
      const rect = searchBar.getBoundingClientRect();
      targetX = e.clientX - rect.left;
      targetY = e.clientY - rect.top;
      velocityX = targetX - lastX;
      velocityY = targetY - lastY;
      lastX = targetX;
      lastY = targetY;
      const glowStrength = Math.min(1.2, 1.2 + targetX / rect.width * 0.4);
      lightBg.style.transform = `scale(${glowStrength})`;
    });
  }

  window.xinUpdater = {
    successEl: document.getElementById("updateSuccess"),
    overlay: document.getElementById("overlay"),
    closeBtn: document.getElementById("updateSuccessClose"),
    init() {
      this.closeBtn?.addEventListener('click', () => this.hideSuccess(false));
      if (localStorage.getItem("justUpdated") === "true") {
        localStorage.removeItem("justUpdated");
        this.showSuccess();
      }
      this.checkVersion();
    },
    showSuccess() {
      if (this.successEl && this.overlay) {
        if (window.hideGamesMenu) window.hideGamesMenu(true);
        if (window.toggleSettingsMenu && document.getElementById('settings-menu')?.classList.contains('open')) {
            window.toggleSettingsMenu();
        }
        if (window.SharePromoter && typeof window.SharePromoter.hideSharePrompt === 'function' && document.getElementById('sharePrompt')?.style.display === 'block') {
            window.SharePromoter.hideSharePrompt(true); 
        }
        if (window.hideBookmarkPrompt && document.getElementById('bookmark-prompt')?.style.display === 'block') {
            window.hideBookmarkPrompt(true);
        }

        this.overlay.classList.add("show");
        this.successEl.style.display = "block";
        this.successEl.classList.remove("fade-out");
      }
    },
    hideSuccess(calledByOther) {
        if (!this.successEl || this.successEl.style.display === 'none') return;

        this.successEl.classList.add("fade-out");
        this.successEl.addEventListener("animationend", () => {
            this.successEl.style.display = "none";
            this.successEl.classList.remove("fade-out");
            
            if (calledByOther) return;

            const settingsMenu = document.getElementById('settings-menu');
            const gamesMenu = document.getElementById('games-menu');
            const sharePrompt = document.getElementById('sharePrompt');
            const bookmarkPrompt = document.getElementById('bookmark-prompt');
            const shortcutPrompt = document.getElementById('shortcut-prompt');
            const isOtherModalOpen = (settingsMenu && settingsMenu.classList.contains('open')) ||
                                     (gamesMenu && gamesMenu.classList.contains('open')) ||
                                     (sharePrompt && sharePrompt.style.display === 'block' && !sharePrompt.classList.contains('fade-out')) ||
                                     (bookmarkPrompt && bookmarkPrompt.style.display === 'block' && !bookmarkPrompt.classList.contains('fade-out-prompt')) ||
                                     (shortcutPrompt && shortcutPrompt.style.display === 'block');

            if (!isOtherModalOpen) {
                this.overlay.classList.remove("show");
            }
        }, { once: true });
    },
    async performUpdate() {
      localStorage.setItem("justUpdated", "true");
      try {
        if ("serviceWorker" in navigator) {
          await Promise.all((await navigator.serviceWorker.getRegistrations()).map(e => e.unregister()));
        }
        if ("caches" in window) {
          await Promise.all((await caches.keys()).map(e => caches.delete(e)));
        }
      } catch (e) {
        console.error("Automatic update failed:", e);
        localStorage.removeItem("justUpdated");
      }
      location.reload();
    },
    async checkVersion() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = await res.json();
        this.versionEl && (this.versionEl.textContent = "Version " + version);
        const prev = localStorage.getItem("wVersion");
        localStorage.setItem("wVersion", version);
        if (prev && version !== prev) await this.performUpdate();
      } catch (e) {
        console.warn("Version check failed:", e);
      }
    }
  };
  window.xinUpdater.init();

  window.SharePromoter = {
    shareEl: document.getElementById("sharePrompt"),
    overlay: document.getElementById("overlay"),
    closeBtn: document.getElementById("sharePromptClose"),
    init() {
      this.closeBtn?.addEventListener('click', () => this.hideSharePrompt(false));
      const visited = localStorage.getItem("wavesVisited");
      
      if (!visited) {
        localStorage.setItem("wavesVisited", "true");
        this.showSharePrompt();
      } else {
        if (Math.random() < 0.20) {
          this.showSharePrompt();
        }
      }
    },
    showSharePrompt() {
      if (this.shareEl && this.overlay) {
        if (window.hideGamesMenu) window.hideGamesMenu(true);
        if (window.toggleSettingsMenu && document.getElementById('settings-menu')?.classList.contains('open')) {
            window.toggleSettingsMenu();
        }
        if (window.xinUpdater && typeof window.xinUpdater.hideSuccess === 'function' && document.getElementById('updateSuccess')?.style.display === 'block') {
            window.xinUpdater.hideSuccess(true);
        }
        if (window.hideBookmarkPrompt && document.getElementById('bookmark-prompt')?.style.display === 'block') {
            window.hideBookmarkPrompt(true);
        }

        this.overlay.classList.add("show");
        this.shareEl.style.display = "block";
        this.shareEl.classList.remove("fade-out");
      }
    },
    hideSharePrompt(calledByOther) {
        if (!this.shareEl || this.shareEl.style.display === 'none') return;

        this.shareEl.classList.add("fade-out");
        this.shareEl.addEventListener("animationend", () => {
            this.shareEl.style.display = "none";
            this.shareEl.classList.remove("fade-out");
            
            if (calledByOther) return;

            const settingsMenu = document.getElementById('settings-menu');
            const gamesMenu = document.getElementById('games-menu');
            const updateSuccess = document.getElementById('updateSuccess');
            const bookmarkPrompt = document.getElementById('bookmark-prompt');
            const shortcutPrompt = document.getElementById('shortcut-prompt');

            const isOtherModalOpen = (settingsMenu && settingsMenu.classList.contains('open')) ||
                                     (gamesMenu && gamesMenu.classList.contains('open')) ||
                                     (updateSuccess && updateSuccess.style.display === 'block' && !updateSuccess.classList.contains('fade-out')) ||
                                     (bookmarkPrompt && bookmarkPrompt.style.display === 'block' && !bookmarkPrompt.classList.contains('fade-out-prompt')) ||
                                     (shortcutPrompt && shortcutPrompt.style.display === 'block');
            
            if (!isOtherModalOpen) {
                this.overlay.classList.remove("show");
            }
        }, { once: true });
    }
  };

  const erudaIcon = document.getElementById('erudaIcon');
  const erudaLoadingScreen = document.getElementById('erudaLoadingScreen');
  let erudaLoaded = false;
  let loadingTimeoutId = null;

  function showErudaMessage(text, isError = false) {
    if (!erudaLoadingScreen) return;
    erudaLoadingScreen.textContent = text;
    erudaLoadingScreen.style.display = 'block';
    erudaLoadingScreen.style.color = isError ? 'red' : 'white';
  }

  function hideErudaLoadingScreen() {
    if (erudaLoadingScreen) {
      erudaLoadingScreen.style.display = 'none';
      erudaLoadingScreen.style.color = 'white';
    }
    clearTimeout(loadingTimeoutId);
  }

  function injectErudaScript() {
    const activeTab = window.WavesApp.getActiveTab();
    if (!activeTab || !activeTab.iframe) {
        showErudaMessage('Error: No active iframe found.', true);
        return;
    }
    const iframe = activeTab.iframe;
    
    if (!iframe.contentDocument || !iframe.contentWindow) {
      showErudaMessage('Error: Iframe content not ready.', true);
      return;
    }
    if (iframe.contentDocument.getElementById('erudaScript')) {
      initializeEruda();
      return;
    }
    showErudaMessage('Eruda is loading...');
    loadingTimeoutId = setTimeout(() => {
      showErudaMessage('Error: Eruda is taking too long to load.', true);
      const existingScript = iframe.contentDocument.getElementById('erudaScript');
      if (existingScript) existingScript.remove();
    }, 15000);
    const script = iframe.contentDocument.createElement('script');
    script.id = 'erudaScript';
    script.src = 'https://cdn.jsdelivr.net/npm/eruda';
    script.async = true;
    script.onload = () => {
      clearTimeout(loadingTimeoutId);
      initializeEruda();
    };
    script.onerror = () => {
      clearTimeout(loadingTimeoutId);
      showErudaMessage('Error: Could not load Eruda script. Check network connection.', true);
      script.remove();
    };
    iframe.contentDocument.head.appendChild(script);
  }

  function initializeEruda() {
    const activeTab = window.WavesApp.getActiveTab();
    if (!activeTab || !activeTab.iframe) {
        showErudaMessage('Error: No active iframe found to initialize Eruda.', true);
        return;
    }
    const iframe = activeTab.iframe;

    try {
      const ew = iframe.contentWindow;
      if (!ew.eruda) {
        showErudaMessage('Error: Eruda object not found after script load.', true);
        console.error('Eruda object undefined.');
        return;
      }
      ew.eruda.init();
      ew.eruda.show();
      erudaLoaded = true;
      hideErudaLoadingScreen();
    } catch (err) {
      console.error('Error initializing Eruda:', err);
      showErudaMessage('Error: Could not initialize Eruda. ' + err.message, true);
    }
  }

  function toggleEruda() {
    const activeTab = window.WavesApp.getActiveTab();
    if (!activeTab || !activeTab.iframe) {
        showErudaMessage('Error: No active iframe found in the DOM.', true);
        return;
    }
    const iframe = activeTab.iframe;

    if (!iframe.contentWindow) {
      showErudaMessage('Error: Iframe not accessible.', true);
      return;
    }
    try {
      if (erudaLoaded && iframe.contentWindow.eruda) {
        iframe.contentWindow.eruda.destroy();
        erudaLoaded = false;
        hideErudaLoadingScreen();
      } else {
        injectErudaScript();
      }
    } catch (err) {
      console.error('Error toggling Eruda:', err);
      showErudaMessage('Error: Could not toggle Eruda. ' + err.message, true);
    }
  }

  if (erudaIcon) {
    erudaIcon.addEventListener('click', toggleEruda);
  }
  
  if (window.NProgress) {
    NProgress.configure({ showSpinner: false });
  }
  const titleElement = document.querySelector(".search-title");
  const phrases = ["Current", "Current!", "Current 2 tuff", "Current... I guess"];
  if (titleElement) {
    titleElement.textContent = phrases[Math.floor(Math.random() * phrases.length)];
  }

  // Prepare a direct, client-side beacon (invoked on consent each time)
  function clientAdBeacon() {
    try {
      const base = 'https://www.effectivegatecpm.com/d8vbqize4?key=efe3c808c89563aff3dcaa89aabc9590';
      const url = base + (base.includes('?') ? '&' : '?') + '_=' + Date.now();
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    } catch (_) { /* noop */ }
  }

  window.SharePromoter.init();
});

function loadBannerAdsSequentially(adsQueue) {
  if (!adsQueue || adsQueue.length === 0) {
    return;
  }

  const adConfig = adsQueue.shift();
  const adContainer = document.getElementById(adConfig.containerId);

  if (!adContainer) {
    console.warn(`Skipping ad: Could not find container ${adConfig.containerId}`);
    loadBannerAdsSequentially(adsQueue);
    return;
  }
  
  window.atOptions = adConfig.options;
  
  const invokeScript = document.createElement('script');
  invokeScript.type = 'text/javascript';
  invokeScript.src = `//spaniardinformationbookworm.com/${adConfig.options.key}/invoke.js`;
  invokeScript.async = true;

  const onFinish = () => {
    invokeScript.removeEventListener('load', onFinish);
    invokeScript.removeEventListener('error', onFinish);
    loadBannerAdsSequentially(adsQueue);
  };

  invokeScript.addEventListener('load', onFinish);
  invokeScript.addEventListener('error', onFinish);

  adContainer.appendChild(invokeScript);
}


window.addEventListener("load", function () {
  function loadAdScriptWithRetry(src, retries = 3, delay = 5000) {
    function attempt(remaining) {
      const script = document.createElement("script");
      script.type = "text/javascript";
      script.src = src + (src.includes("?") ? "&" : "?") + "cb=" + Date.now();
      script.async = true;

      script.onload = () =>
      script.onerror = () => {
        console.warn(
          `Failed to load ${src}. Remaining attempts: ${remaining - 1}`
        );
        if (remaining > 1) {
          setTimeout(() => attempt(remaining - 1), delay);
        } else {
          console.error(`All attempts to load ${src} has failed!`);
        }
      };

      document.body.appendChild(script);
    }
    attempt(retries);
  }

  function loadAdScripts() {
    const adSources = [
      "//spaniardinformationbookworm.com/a1/37/68/a1376848d2be9154b24a145e7a3a8df6.js",
      "//spaniarlinformationbookworm.com/1d/8d/ce/1d8dce254be83f85ebd908954bceb5f1.js",
    ];

    const incrementalDelay = 300000;

    adSources.forEach((src, index) => {
      setTimeout(() => loadAdScriptWithRetry(src, 3, 5000), index * incrementalDelay);
    });
  }

  // Expose to settings and power users to trigger ads for current session
  function triggerSupportAds() {
    clientAdBeacon();
    renderSmartlinkBanners();
    loadAdScripts();
  }
  window.triggerSupportAds = triggerSupportAds;

  // Open the consent prompt programmatically
  function openSupportPrompt() {
    const overlay = document.getElementById('overlay');
    const prompt = document.getElementById('supportPrompt');
    const yesBtn = document.getElementById('supportYes');
    const noBtn = document.getElementById('supportNo');
    if (!overlay || !prompt || !yesBtn || !noBtn) return;

    overlay.classList.add('show');
    prompt.style.display = 'block';
    prompt.style.opacity = '1';

    const closePrompt = () => {
      prompt.style.display = 'none';
      prompt.style.opacity = '0';
      const anyOther = (
        document.getElementById('sharePrompt')?.style.display === 'block' ||
        document.getElementById('updateSuccess')?.style.display === 'block' ||
        document.getElementById('bookmark-prompt')?.style.display === 'block'
      );
      if (!anyOther) overlay.classList.remove('show');
    };

    yesBtn.addEventListener('click', () => {
      try {
        localStorage.setItem('adConsent', 'granted');
        localStorage.setItem('adConsentAt', Date.now().toString());
      } catch {}
      closePrompt();
      triggerSupportAds();
    }, { once: true });

    noBtn.addEventListener('click', () => {
      try {
        localStorage.setItem('adConsent', 'denied');
        localStorage.setItem('adConsentAt', Date.now().toString());
      } catch {}
      closePrompt();
    }, { once: true });
  }
  window.openSupportPrompt = openSupportPrompt;

  function showSupportPromptAndMaybeLoadAds() {
    try {
      const CONSENT_KEY = 'adConsent';
      const CONSENT_TIME_KEY = 'adConsentAt';
      const AD_CONSENT_TTL_MS = 1000 * 60 * 60 * 24 * 2; // 2 days

      const consent = localStorage.getItem(CONSENT_KEY);
      const tsRaw = localStorage.getItem(CONSENT_TIME_KEY);
      const ts = tsRaw ? parseInt(tsRaw, 10) : NaN;
      const now = Date.now();
      const expired = !ts || isNaN(ts) || (now - ts) > AD_CONSENT_TTL_MS;

      if (!consent || expired) {
        openSupportPrompt();
        return;
      }
      if (consent === 'granted') {
        triggerSupportAds();
      }
    } catch (e) {
      // If anything goes wrong, fail closed (no ads) to avoid user impact
      console.warn('Ad consent prompt failed:', e);
    }
  }

  showSupportPromptAndMaybeLoadAds();
});

// Basic close behavior for side ad containers
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.ad-close');
  if (!btn) return;
  const parent = btn.closest('#ad-container-left, #ad-container-right, #ad-container-bottom');
  if (parent) parent.style.display = 'none';
});

// Render the smartlink call-to-action inside visible side banner slots
function renderSmartlinkBanners() {
  try {
    const SMART_URL = 'https://www.effectivegatecpm.com/d8vbqize4?key=efe3c808c89563aff3dcaa89aabc9590';
    const SMART_URL_SCRAMJET = '/b/s/' + SMART_URL;
    const slots = [
      document.querySelector('#ad-container-left .ad-slot'),
      document.querySelector('#ad-container-right .ad-slot')
    ].filter(Boolean);

    slots.forEach(slot => {
      // Clear previous content
      while (slot.firstChild) slot.removeChild(slot.firstChild);

      // Impression beacon (client-originated GET)
      const beacon = new Image();
      beacon.referrerPolicy = 'no-referrer';
      beacon.alt = '';
      beacon.decoding = 'async';
      beacon.loading = 'eager';
      beacon.src = SMART_URL + (SMART_URL.includes('?') ? '&' : '?') + '_=' + Date.now();
      beacon.style.position = 'absolute';
      beacon.style.width = '1px';
      beacon.style.height = '1px';
      beacon.style.opacity = '0';
      beacon.style.pointerEvents = 'none';

      // Try to embed the smartlink page via Scramjet within the banner
      const frame = document.createElement('iframe');
      frame.className = 'smartlink-iframe';
      frame.src = SMART_URL_SCRAMJET;
      frame.title = 'Sponsored';
      frame.referrerPolicy = 'no-referrer';
      frame.loading = 'lazy';
      frame.setAttribute('allow', 'fullscreen');
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups');

      let loaded = false;
      const fallbackTimer = setTimeout(() => {
        if (loaded) return;
        // Fallback: render a simple creative with a Scramjet CTA
        while (slot.firstChild) slot.removeChild(slot.firstChild);
        const wrap = document.createElement('div');
        wrap.className = 'smartlink-ad';
        const tag = document.createElement('div');
        tag.className = 'smartlink-ad-tag';
        tag.textContent = 'Sponsored';
        const h = document.createElement('div');
        h.className = 'smartlink-ad-title';
        h.textContent = 'Support Current';
        const p = document.createElement('div');
        p.className = 'smartlink-ad-text';
        p.textContent = 'Your clicks help keep it free. Thanks!';
        const cta = document.createElement('a');
        cta.className = 'smartlink-ad-btn';
        cta.href = SMART_URL_SCRAMJET;
        cta.target = '_blank';
        cta.rel = 'noopener noreferrer';
        cta.textContent = 'Open Offer';
        wrap.appendChild(tag);
        wrap.appendChild(h);
        wrap.appendChild(p);
        wrap.appendChild(cta);
        slot.appendChild(wrap);
        slot.appendChild(beacon);
      }, 3500);

      frame.addEventListener('load', () => {
        loaded = true;
        clearTimeout(fallbackTimer);
      });

      slot.appendChild(frame);
      slot.appendChild(beacon);
    });
  } catch (e) {
    console.warn('Failed to render smartlink banners:', e);
  }
}
