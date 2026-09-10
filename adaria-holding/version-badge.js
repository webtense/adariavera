/**
 * version-badge.js — inyector de versión dinámica (Vera Adaria)
 *
 * Fichero IDÉNTICO en todos los módulos (no hay filesystem compartido entre
 * ellos, así que se duplica a propósito). NO editar una copia sin replicar
 * el cambio en el resto de módulos que lo usan.
 *
 * Comportamiento:
 *  1. Intenta GET /api/version (módulos Express) → {version:"X.Y.Z"}.
 *  2. Si falla (404, red, etc.), intenta GET /VERSION/version.json
 *     (fallback para módulos servidos como HTML estático puro, sin backend
 *     propio, p.ej. python3 -m http.server).
 *  3. Busca elementos por ID (adaria-header-version y adaria-footer-version)
 *     y les inyecta la versión como textContent.
 *  4. Si ambos fallan o no hay elementos, no rompe la página (fail-safe).
 *
 * Respeta window.BASE_PATH si el módulo lo define (p.ej. adaria-personal,
 * servido tras un prefijo de ruta) — igual que hace su propio app.js.
 *
 * IDs esperados en el HTML:
 *  - adaria-header-version: versión en header
 *  - adaria-footer-version: versión en footer
 */
(function () {
  var BASE = (typeof window !== 'undefined' && window.BASE_PATH) || '';

  function injectVersion(version) {
    if (!version) return;
    var headerEl = document.getElementById('adaria-header-version');
    var footerEl = document.getElementById('adaria-footer-version');
    var text = 'v' + version;
    if (headerEl) headerEl.textContent = text;
    if (footerEl) footerEl.textContent = text;
  }

  function fetchJson(url) {
    return fetch(BASE + url).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  fetchJson('/api/version')
    .then(function (d) { injectVersion(d && d.version); })
    .catch(function () {
      fetchJson('/VERSION/version.json')
        .then(function (d) { injectVersion(d && d.version); })
        .catch(function () { /* fail-safe: sin version inyectada */ });
    });
})();
