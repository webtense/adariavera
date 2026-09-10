require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { initSchema } = require('./src/db');
const apiRoutes = require('./src/routes/api');

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
