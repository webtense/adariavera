/**
 * version-badge.js — versión visible en header/footer (Vera Adaria)
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
 * Reconvertido (10/09/2026): ya NO pinta un div flotante — escribe la
 * versión en los dos puntos fijos del layout (header y footer), que deben
 * existir en el HTML/EJS de cada módulo:
 *   #adaria-header-version
 *   #adaria-footer-version
 *
 * Respeta window.BASE_PATH si el módulo lo define (p.ej. adaria-personal,
 * servido tras un prefijo de ruta) — igual que hace su propio app.js.
 */
(function () {
  var BASE = (typeof window !== 'undefined' && window.BASE_PATH) || '';

  function showVersion(version) {
    if (!version) return;
    ['adaria-header-version', 'adaria-footer-version'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = 'v' + version;
    });
  }

  function fetchJson(url) {
    return fetch(BASE + url).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  fetchJson('/api/version')
    .then(function (d) { showVersion(d && d.version); })
    .catch(function () {
      fetchJson('/VERSION/version.json')
        .then(function (d) { showVersion(d && d.version); })
        .catch(function () { /* fail-safe: sin versión visible */ });
    });
})();
