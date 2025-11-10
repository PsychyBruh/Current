document.addEventListener('DOMContentLoaded', () => {
  const home = document.getElementById('games-home');
  if (!home) return;

  const ZONES_URL = "https://cdn.jsdelivr.net/gh/gn-math/assets@latest/zones.json";
  const COVER_URL = "https://cdn.jsdelivr.net/gh/gn-math/covers@main";
  const HTML_URL = "https://cdn.jsdelivr.net/gh/gn-math/html@main";

  const searchInput = document.getElementById('gamesHomeSearchInput');
  const grid = document.getElementById('gamesHomeGrid');
  const credits = document.getElementById('gamesHomeCredits');
  const statusEl = document.getElementById('gamesHomeStatus');

  let allGames = window.WavesApp?.allGames || [];
  let loaded = allGames.length > 0;

  function mapZonesToGames(data) {
    return data
      .map(zone => {
        const isExternal = zone.url.startsWith('http');
        return {
          id: zone.id,
          name: zone.name,
          author: zone.author,
          description: `By ${zone.author || 'Unknown'}`,
          coverUrl: zone.cover.replace("{COVER_URL}", COVER_URL),
          gameUrl: isExternal ? zone.url : zone.url.replace("{HTML_URL}", HTML_URL),
          isExternal,
          featured: !!zone.featured,
        };
      })
      .filter(g => !g.name.startsWith('[!]') && !g.name.startsWith('Chat Bot'));
  }

  function ensureData() {
    if (loaded) return Promise.resolve(allGames);
    setStatus('Fetching games…');
    return fetch(ZONES_URL)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(zones => {
        allGames = mapZonesToGames(zones);
        // Prepend custom cloud games (Clash Royale, Roblox) to appear at the top
        try {
          const customGames = [
            {
              id: 'custom-clash-royale',
              name: 'Clash Royale',
              author: 'Cloud',
              description: 'By Cloud',
              coverUrl: '/assets/images/clash.jpg',
              gameUrl: 'https://www.easyfun.gg/cloud-games/clash-royale-cloud-online.html',
              isExternal: false,
              featured: true,
            },
            {
              id: 'custom-roblox',
              name: 'Roblox',
              author: 'Cloud',
              description: 'By Cloud',
              coverUrl: '/assets/images/roblox.jpg',
              gameUrl: 'https://www.easyfun.gg/cloud-games/roblox.html',
              isExternal: false,
              featured: true,
            },
          ];
          for (let i = customGames.length - 1; i >= 0; i--) {
            const g = customGames[i];
            if (!allGames.some(x => (x.name || '').toLowerCase() === g.name.toLowerCase())) {
              allGames.unshift(g);
            }
          }
        } catch (_) {}
        if (window.WavesApp) {
          window.WavesApp.allGames = allGames; // share cache with rest of app
        }
        loaded = true;
        clearStatus();
        return allGames;
      })
      .catch(err => {
        setStatus('Error loading games. Please try again later.');
        console.error('games-home load failed', err);
        throw err;
      });
  }

  function setStatus(text) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.display = 'block';
    }
    if (credits) credits.style.display = 'none';
  }
  function clearStatus() {
    if (statusEl) statusEl.style.display = 'none';
    if (credits) credits.style.display = '';
  }

  function createCard(game) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.gameUrl = game.gameUrl;
    card.dataset.isExternal = game.isExternal;

    const imgWrap = document.createElement('div');
    imgWrap.className = 'game-image';
    const img = document.createElement('img');
    img.alt = `${game.name} Icon`;
    img.loading = 'lazy';
    img.src = game.coverUrl;
    imgWrap.appendChild(img);

    const info = document.createElement('div');
    info.className = 'game-info';
    const name = document.createElement('h2');
    name.textContent = game.name;
    const desc = document.createElement('p');
    desc.className = 'game-description';
    desc.textContent = game.description || '';
    info.appendChild(name);
    info.appendChild(desc);

    card.appendChild(imgWrap);
    card.appendChild(info);
    return card;
  }

  function render(list) {
    if (!grid) return;
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach(g => frag.appendChild(createCard(g)));
    grid.appendChild(frag);
  }

  function applyFilter() {
    const q = (searchInput?.value || '').toLowerCase().trim();
    const list = q ? allGames.filter(g => (g.name || '').toLowerCase().includes(q)) : allGames;
    if (!list.length && q) setStatus('No games match your search');
    else clearStatus();
    render(list);
  }

  ensureData().then(() => {
    applyFilter();
  });

  if (searchInput) {
    searchInput.addEventListener('input', applyFilter);
  }

  if (grid) {
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.game-card');
      if (!card) return;
      const url = card.dataset.gameUrl;
      const isExternal = card.dataset.isExternal === 'true';
      if (!url) return;

      if (isExternal) {
        window.open(url, '_blank');
        return;
      }

      if (window.WavesApp?.handleSearch) {
        window.WavesApp.handleSearch(url);
      }

      // Attempt to enter fullscreen on user gesture for best immersion
      try {
        const activeTab = window.WavesApp?.getActiveTab?.();
        const el = activeTab?.iframe || document.documentElement;
        if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
        else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
      } catch {}
    });
  }
});
