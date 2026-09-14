require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { initSchema } = require('./src/db');
const apiRoutes = require('./src/routes/api');
const fs = require('fs');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Verificacion critica del gate de email al arrancar: dejar constancia en logs.
const sendMode = process.env.SEND_MODE || 'test';
console.log(`[startup] SEND_MODE=${sendMode} -> envio de emails reales ${sendMode === 'live' ? 'POSIBLE (revisar ALLOW_REAL_EMAIL)' : 'BLOQUEADO'}`);

app.use(helmet({
  contentSecurityPolicy: false // app autocontenida servida en LAN interna
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' })); // firma PNG base64 puede pesar varios cientos de KB
app.use(express.urlencoded({ extended: true }));

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

app.use('/api', apiRoutes);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'No encontrado' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] Error no controlado:', err);
  res.status(500).json({ ok: false, error: 'Error interno del servidor' });
});

async function start() {
  try {
    await initSchema();
  } catch (e) {
    console.error('[startup] Error inicializando esquema PostgreSQL:', e.message);
    process.exit(1);
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hotel Adaria Vera - Welcome escuchando en 0.0.0.0:${PORT}`);
  });
}

start();
