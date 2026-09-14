'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3500;
const HOST = process.env.HOST || '0.0.0.0';
const CONTENT_PATH = process.env.CONTENT_PATH || path.join(__dirname, 'data', 'content.json');

app.disable('x-powered-by');

// ---- Content loading -------------------------------------------------
// content.json is the single editable source of truth (recepción lo completa).
// Cualquier campo con valor null se considera [PENDIENTE confirmar recepción]
// y se elimina de la respuesta pública: nunca se muestra ni se inventa.

function readContentRaw() {
  const raw = fs.readFileSync(CONTENT_PATH, 'utf8');
  return JSON.parse(raw);
}

// Elimina recursivamente: claves null/undefined, claves que empiezan por "_"
// (metadatos internos de edición) y objetos/arrays que quedan vacíos tras filtrar.
function stripPending(value) {
  if (Array.isArray(value)) {
    const arr = value
      .map(stripPending)
      .filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (key.startsWith('_')) continue;
      if (val === null || val === undefined) continue;
      const cleaned = stripPending(val);
      if (cleaned === undefined) continue;
      out[key] = cleaned;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null) return undefined;
  return value;
}

function getPublicContent() {
  const raw = readContentRaw();
  const cleaned = stripPending(raw) || {};
  return cleaned;
}

// ---- Routes ------------------------------------------------------------

app.get('/api/version', (req, res) => res.json({ version: require('./package.json').version }));

// Ruta para ver el changelog
app.get('/changelog', (req, res) => {
  try {
    const changelogPath = path.join(__dirname, 'VERSION', 'changelog.json');
    const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));

    let html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Historial de versiones - ${changelog.app}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1000px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
    .version-entry { margin: 20px 0; padding: 15px; border-left: 4px solid #0066cc; background: #f9f9f9; }
    .version-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .version-num { font-weight: bold; font-size: 18px; color: #0066cc; }
    .version-date { color: #666; font-size: 14px; }
    .version-title { font-weight: 600; color: #333; margin: 5px 0; }
    .version-sha { font-family: monospace; color: #999; font-size: 12px; }
    .version-body { color: #555; line-height: 1.6; white-space: pre-wrap; word-break: break-word; font-size: 14px; margin-top: 8px; }
    .meta { text-align: center; color: #999; font-size: 12px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Historial de versiones: ${changelog.app}</h1>
`;

    changelog.versiones.forEach(v => {
      html += `
    <div class="version-entry">
      <div class="version-header">
        <div>
          <div class="version-num">v${v.version}</div>
          <div class="version-title">${v.titulo}</div>
        </div>
        <div class="version-date">${v.fecha}</div>
      </div>
      <div class="version-sha">SHA: ${v.sha}</div>
      ${v.resumen ? `<div class="version-body">${v.resumen}</div>` : ''}
    </div>
`;
    });

    html += `
    <div class="meta">Generado: ${changelog.generado}</div>
  </div>
</body>
</html>
`;

    res.send(html);
  } catch (err) {
    console.error('[changelog] Error:', err.message);
    res.status(500).send(`<h1>Error cargando changelog</h1><p>${err.message}</p>`);
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'adaria-guest', ts: new Date().toISOString() });
});

app.get('/api/content', (req, res) => {
  try {
    const content = getPublicContent();
    res.json(content);
  } catch (err) {
    console.error('[adaria-guest] Error leyendo content.json:', err.message);
    res.status(500).json({ error: 'No se pudo cargar el contenido' });
  }
});

// Static frontend
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`[adaria-guest] Guest Portal Hotel Adaria Vera escuchando en http://${HOST}:${PORT}`);
});
