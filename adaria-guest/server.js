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
