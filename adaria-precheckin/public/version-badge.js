/**
 * version-badge.js — rellenar versión en header y footer (Vera Adaria)
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
 *  3. Si ambos fallan, no muestra nada. Nunca rompe la página (fail-safe).
 *  4. Rellena textContent de:
 *     - document.getElementById('adaria-header-version') con 'vX.Y.Z'
 *     - document.getElementById('adaria-footer-version') con 'vX.Y.Z'
 *
 * Respeta window.BASE_PATH si el módulo lo define (p.ej. adaria-personal,
 * servido tras un prefijo de ruta) — igual que hace su propio app.js.
 */
(function () {
  var BASE = (typeof window !== 'undefined' && window.BASE_PATH) || '';

  function setVersion(version) {
    if (!version) return;
    var versionText = 'v' + version;
    var headerEl = document.getElementById('adaria-header-version');
    var footerEl = document.getElementById('adaria-footer-version');
    if (headerEl) headerEl.textContent = versionText;
    if (footerEl) footerEl.textContent = versionText;
  }

  function fetchJson(url) {
    return fetch(BASE + url).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  fetchJson('/api/version')
    .then(function (d) { setVersion(d && d.version); })
    .catch(function () {
      fetchJson('/VERSION/version.json')
        .then(function (d) { setVersion(d && d.version); })
        .catch(function () { /* fail-safe: sin versión */ });
    });
})();
