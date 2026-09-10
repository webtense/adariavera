/**
 * version-badge.js — badge de versión visible (Vera Adaria)
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
 *
 * Respeta window.BASE_PATH si el módulo lo define (p.ej. adaria-personal,
 * servido tras un prefijo de ruta) — igual que hace su propio app.js.
 */
(function () {
  var BASE = (typeof window !== 'undefined' && window.BASE_PATH) || '';

  function showBadge(version) {
    if (!version) return;
    if (document.getElementById('adaria-version-badge')) return;
    var el = document.createElement('div');
    el.id = 'adaria-version-badge';
    el.textContent = 'v' + version;
    el.style.cssText =
      'position:fixed;bottom:8px;right:12px;font-size:11px;color:#bbb;' +
      'background:rgba(255,255,255,.7);padding:2px 6px;border-radius:6px;' +
      'z-index:9999;pointer-events:none;';
    document.body.appendChild(el);
  }

  function fetchJson(url) {
    return fetch(BASE + url).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  fetchJson('/api/version')
    .then(function (d) { showBadge(d && d.version); })
    .catch(function () {
      fetchJson('/VERSION/version.json')
        .then(function (d) { showBadge(d && d.version); })
        .catch(function () { /* fail-safe: sin badge */ });
    });
})();
