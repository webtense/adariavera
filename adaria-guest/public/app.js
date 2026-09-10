(function () {
  'use strict';

  var LANGS = ['es', 'en', 'fr'];

  var STRINGS = {
    back: { es: 'Volver', en: 'Back', fr: 'Retour' },
    empty: {
      es: 'Información no disponible por el momento.',
      en: 'Information not available at this time.',
      fr: 'Information non disponible pour le moment.',
    },
    loading: { es: 'Cargando…', en: 'Loading…', fr: 'Chargement…' },
    errorLoad: {
      es: 'No se pudo cargar la información del hotel. Inténtalo más tarde.',
      en: 'Could not load hotel information. Please try again later.',
      fr: "Impossible de charger les informations de l'hôtel. Veuillez réessayer plus tard.",
    },
    password: { es: 'Contraseña', en: 'Password', fr: 'Mot de passe' },
    heroGreeting: { es: 'Bienvenido', en: 'Welcome', fr: 'Bienvenue' },
    heroSub: {
      es: 'Toda la información de tu estancia, en un solo lugar.',
      en: 'Everything you need for your stay, in one place.',
      fr: 'Toutes les informations de votre séjour, au même endroit.',
    },
    pendingNote: {
      es: 'Este dato lo confirma recepción próximamente.',
      en: 'This information will be confirmed by reception soon.',
      fr: 'Cette information sera confirmée prochainement par la réception.',
    },
  };

  // Iconos SVG lineales (24x24, stroke=currentColor) — sin dependencias externas.
  var ICONS = {
    services:
      '<path d="M3 18v-6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M3 18v2M21 18v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M5 12V9a2 2 0 0 1 2-2h3v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="7.5" cy="9.2" r="0" fill="none"/>',
    pools:
      '<path d="M3 16c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M3 20c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M8 12V5l3 2 3-2 3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    dining:
      '<path d="M7 3v7a2 2 0 0 0 2 2v9M7 3v7M9 3v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M17 3c-1.5 0-2.5 1.8-2.5 4s1 4 2.5 4v10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    wifi:
      '<path d="M4 9.5a13 13 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M7 13a8.3 8.3 0 0 1 10 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M10 16.5a3.6 3.6 0 0 1 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<circle cx="12" cy="19.3" r="1.15" fill="currentColor" stroke="none"/>',
    parking:
      '<rect x="4" y="3" width="16" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M9.5 16V8h3.2a2.6 2.6 0 1 1 0 5.2H9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    hours:
      '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    phones:
      '<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    activities:
      '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M15 9l-2 6-6 2 2-6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  };

  var MODULES = [
    { key: 'services', icon: 'services' },
    { key: 'pools', icon: 'pools' },
    { key: 'dining', icon: 'dining' },
    { key: 'wifi', icon: 'wifi' },
    { key: 'parking', icon: 'parking' },
    { key: 'hours', icon: 'hours' },
    { key: 'phones', icon: 'phones' },
    { key: 'activities', icon: 'activities' },
  ];

  var state = {
    lang: readStoredLang(),
    content: null,
  };

  var els = {};

  document.addEventListener('DOMContentLoaded', init);

  function readStoredLang() {
    try {
      var stored = localStorage.getItem('adaria_guest_lang');
      if (stored && LANGS.indexOf(stored) !== -1) return stored;
    } catch (e) { /* localStorage no disponible */ }
    var nav = (navigator.language || 'es').slice(0, 2).toLowerCase();
    return LANGS.indexOf(nav) !== -1 ? nav : 'es';
  }

  function init() {
    els.topbar = document.getElementById('topbar');
    els.hero = document.getElementById('hero');
    els.heroGreeting = document.getElementById('hero-greeting');
    els.heroSub = document.getElementById('hero-sub');
    els.grid = document.getElementById('module-grid');
    els.contentArea = document.getElementById('content-area');
    els.contentBody = document.getElementById('content-body');
    els.backBtn = document.getElementById('back-btn');
    els.brandBlock = document.getElementById('brand-block');
    els.headerTitle = document.getElementById('header-title');
    els.loading = document.getElementById('loading');
    els.loadingText = document.getElementById('loading-text');

    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setLang(btn.getAttribute('data-lang'));
      });
    });

    els.backBtn.addEventListener('click', showGrid);

    applyLangUI();
    loadContent();

    window.addEventListener('popstate', handleRoute);
  }

  function loadContent() {
    fetch('/api/content')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        state.content = data;
        els.loading.hidden = true;
        renderGrid();
        handleRoute();
      })
      .catch(function (err) {
        els.loadingText.textContent = STRINGS.errorLoad[state.lang];
        console.error('[adaria-guest] error loading content', err);
      });
  }

  function setLang(lang) {
    if (LANGS.indexOf(lang) === -1) return;
    state.lang = lang;
    try { localStorage.setItem('adaria_guest_lang', lang); } catch (e) { /* noop */ }
    applyLangUI();
    if (state.content) {
      renderGrid();
      var params = new URLSearchParams(window.location.search);
      var section = params.get('section');
      if (section) renderSection(section);
    }
  }

  function applyLangUI() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      var isActive = btn.getAttribute('data-lang') === state.lang;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
    var backLabel = els.backBtn.querySelector('[data-i18n="back"]');
    if (backLabel) backLabel.textContent = STRINGS.back[state.lang];
    els.backBtn.setAttribute('aria-label', STRINGS.back[state.lang]);
    els.heroGreeting.textContent = STRINGS.heroGreeting[state.lang];
    els.heroSub.textContent = STRINGS.heroSub[state.lang];
    els.loadingText.textContent = STRINGS.loading[state.lang];
  }

  function moduleData(key) {
    var sec = state.content && state.content[key];
    return sec && sec[state.lang] ? sec[state.lang] : null;
  }

  function moduleTitle(key) {
    var data = moduleData(key);
    return data && data.title ? data.title : key;
  }

  function renderGrid() {
    els.grid.innerHTML = '';
    MODULES.forEach(function (mod) {
      var sec = state.content[mod.key];
      if (!sec) return; // sección completamente sin contenido publicable -> se oculta
      var data = moduleData(mod.key);
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'module-card';
      card.innerHTML =
        '<span class="module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26">' + ICONS[mod.icon] + '</svg></span>' +
        '<span class="module-text">' +
          '<span class="module-title">' + escapeHtml(moduleTitle(mod.key)) + '</span>' +
          (data && data.subtitle ? '<span class="module-subtitle">' + escapeHtml(data.subtitle) + '</span>' : '') +
        '</span>' +
        '<svg class="module-arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      card.addEventListener('click', function () {
        navigateTo(mod.key);
      });
      els.grid.appendChild(card);
    });
  }

  function navigateTo(sectionKey) {
    var url = new URL(window.location.href);
    url.searchParams.set('section', sectionKey);
    window.history.pushState({}, '', url);
    renderSection(sectionKey);
  }

  function handleRoute() {
    var params = new URLSearchParams(window.location.search);
    var section = params.get('section');
    if (section && state.content && state.content[section]) {
      renderSection(section);
    } else {
      showGrid();
    }
  }

  function showGrid() {
    var url = new URL(window.location.href);
    url.searchParams.delete('section');
    window.history.pushState({}, '', url);

    els.topbar.classList.remove('detail-mode');
    els.backBtn.hidden = true;
    els.brandBlock.hidden = false;
    els.headerTitle.hidden = true;
    els.hero.hidden = false;

    els.contentArea.classList.remove('is-visible');
    els.contentArea.hidden = true;
    els.grid.hidden = false;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function renderSection(key) {
    var sec = state.content[key];
    if (!sec) { showGrid(); return; }

    els.topbar.classList.add('detail-mode');
    els.backBtn.hidden = false;
    els.brandBlock.hidden = true;
    els.headerTitle.hidden = false;
    els.headerTitle.textContent = moduleTitle(key);
    els.hero.hidden = true;

    els.grid.hidden = true;
    els.contentArea.hidden = false;
    // Forzar reflow para que la transición de entrada se aplique
    void els.contentArea.offsetWidth;
    els.contentArea.classList.add('is-visible');

    var html = (renderers[key] ? renderers[key](sec) : renderGeneric(sec));
    if (sec.source) {
      html += '<p class="source-note">' + escapeHtml(sec.source) + '</p>';
    }
    els.contentBody.innerHTML = html;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function listCard(items) {
    if (!items || !items.length) return '';
    return '<div class="card"><ul>' + items.map(function (i) {
      return '<li>' + escapeHtml(i) + '</li>';
    }).join('') + '</ul></div>';
  }

  function renderGeneric(sec) {
    var data = sec[state.lang];
    if (!data) return emptyMsg();
    return listCard(data.items) || emptyMsg();
  }

  var renderers = {
    services: renderGeneric,

    pools: function (sec) {
      var data = sec[state.lang];
      if (!data) return emptyMsg();
      var extra = [];
      if (data.hours) extra.push(data.hours);
      if (data.heated_indoor) extra.push(data.heated_indoor);
      return listCard((data.items || []).concat(extra));
    },

    dining: function (sec) {
      var data = sec[state.lang];
      if (!data) return emptyMsg();
      var extra = [];
      if (data.board_basis) extra.push(data.board_basis);
      if (data.meal_hours) extra.push(data.meal_hours);
      return listCard((data.items || []).concat(extra));
    },

    wifi: function (sec) {
      var data = sec[state.lang];
      if (!data) return emptyMsg();
      var html = '<div class="card"><ul>';
      (data.items || []).forEach(function (i) { html += '<li>' + escapeHtml(i) + '</li>'; });
      if (data.ssid) html += '<li><strong>SSID:</strong> ' + escapeHtml(data.ssid) + '</li>';
      if (data.password) html += '<li><strong>' + STRINGS.password[state.lang] + ':</strong> ' + escapeHtml(data.password) + '</li>';
      html += '</ul>';
      if (data.note) html += '<p class="note">' + escapeHtml(data.note) + '</p>';
      html += '</div>';
      return html;
    },

    parking: function (sec) {
      var data = sec[state.lang];
      if (!data) return emptyMsg();
      var extra = [];
      if (data.price) extra.push(data.price);
      if (data.spaces) extra.push(data.spaces);
      if (data.max_height) extra.push(data.max_height);
      return listCard((data.items || []).concat(extra));
    },

    hours: function (sec) {
      var data = sec[state.lang];
      if (!data) return emptyMsg();
      var extra = [];
      ['checkin', 'checkout', 'pool_hours', 'restaurant_hours', 'gym_hours'].forEach(function (f) {
        if (data[f]) extra.push(data[f]);
      });
      return listCard((data.items || []).concat(extra));
    },

    phones: function (sec) {
      var data = sec[state.lang];
      if (!data) return emptyMsg();
      var html = '<div class="card"><ul class="phone-list">';
      (data.items || []).forEach(function (item) {
        var isPhone = /^[+0-9\s]+$/.test(item.value);
        var valueHtml = isPhone
          ? '<a href="tel:' + item.value.replace(/\s+/g, '') + '">' + escapeHtml(item.value) + '</a>'
          : (item.value.indexOf('@') !== -1
              ? '<a href="mailto:' + item.value + '">' + escapeHtml(item.value) + '</a>'
              : escapeHtml(item.value));
        html += '<li><span class="phone-label">' + escapeHtml(item.label) + '</span>' +
                '<span class="phone-value">' + valueHtml + '</span></li>';
      });
      html += '</ul>';
      if (data.local_services) html += '<p class="note">' + escapeHtml(data.local_services) + '</p>';
      html += '</div>';
      return html;
    },

    activities: function (sec) {
      var data = sec[state.lang];
      if (!data) return emptyMsg();
      var html = '';
      (data.groups || []).forEach(function (g) {
        html += '<div class="card">';
        html += '<p class="group-heading">' + escapeHtml(g.heading) + '</p>';
        html += '<ul>' + (g.items || []).map(function (i) { return '<li>' + escapeHtml(i) + '</li>'; }).join('') + '</ul>';
        if (g.link) {
          html += '<a class="inline-link" href="' + g.link.url + '" target="_blank" rel="noopener">' + escapeHtml(g.link.label) + ' &rarr;</a>';
        }
        html += '</div>';
      });
      if (data.links && data.links.length) {
        html += '<div class="card links-list">';
        data.links.forEach(function (l) {
          html += '<a href="' + l.url + '" target="_blank" rel="noopener">' + escapeHtml(l.label) + ' &rarr;</a>';
        });
        html += '</div>';
      }
      return html;
    },
  };

  function emptyMsg() {
    return '<div class="card"><p class="empty-msg">' + STRINGS.empty[state.lang] + '</p></div>';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
