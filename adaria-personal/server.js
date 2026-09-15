'use strict';

// Adaria Personal — Gestión de Personal (RRHH) del grupo.
// NÚCLEO multi-propiedad: este mismo código sirve a cualquier propiedad del
// grupo (Hotel Adaria Vera ahora, Monasterio de Poblet / BTR después).
// La propiedad concreta la define property.json + .env de cada despliegue.
// Sin nómina. Sin WhatsApp (todo por correo, en fases posteriores).
//
// FASE 1: datos de empleado (núcleo + ficha + documentos).
// FASE 2: autofichaje / quiosco — el empleado ficha él mismo por PIN o QR en
// una tablet de recepción, y el admin gestiona PIN/QR y corrige fichajes.
// FASE 3: Inspección de Trabajo — registro de jornada legal (RD 8/2019),
// calculado a partir de `fichaje`, con exportación PDF/CSV selladas
// (SHA-256) y auditoría de exportaciones (`export_log`). Retención ≥4 años.
// FASE 4: Informes — horas/coste/"días sin fichaje" por empleado,
// departamento y propiedad, comparativa entre periodos, exportación
// PDF/CSV y envío por correo (gate SEND_MODE, por defecto 'test').
// Reutiliza el MISMO cálculo de jornada de la Fase 3 (calcularInspeccion),
// no lo duplica.
// FASE 5: Motivación — mensaje motivacional diario por departamento,
// felicitación de cumpleaños y aniversario de antigüedad, mostrados en el
// QUIOSCO al fichar (y, en reposo, en bucle en pantalla). Cumpleaños y
// aniversarios se calculan en caliente a partir de fecha_nacimiento y
// fecha_alta (no se guardan en tabla propia). PRIVACIDAD: en el quiosco
// NUNCA se muestra la edad ni el año de nacimiento de nadie; solo el
// nombre de pila y, en aniversarios, los años de antigüedad en la
// empresa (dato que sí se pide mostrar).
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const redis = require('redis');
const RedisStore = require('connect-redis').default;
const ssoMiddleware = require('./sso-middleware');
const multer = require('multer');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { pool } = require('./db');
const { compararRango } = require('./lib/comparativa');
const { ejecutarChecklistAuditoria } = require('./lib/auditoria');
const { calcularDeduperKey, severidadComparativa, severidadAuditoria, ESTADOS_COMPARATIVA_SIN_INCIDENCIA } = require('./lib/incidencias');

const PORT = parseInt(process.env.PORT || '3096', 10);
const SECRET = process.env.SESSION_SECRET || 'cambia-esto';
const ADMIN_USER = (process.env.ADMIN_USER || '').toLowerCase();
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const KIOSK_KEY = process.env.KIOSK_KEY || '';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const LOGS_DIR = path.join(__dirname, 'logs');
const APP_VERSION = '1.4';

// ─── FASE RRHH-SUBPATH — Publicación bajo https://gestion.hoteladariavera.com/rrhh
// El subdominio propio no está dado de alta en DNS, así que este módulo se
// publica bajo un subpath del portal de gestión (edge Apache hace ProxyPass
// /rrhh/ -> :3096/ SIN el sufijo /rrhh en el destino, es decir recorta el
// prefijo antes de reenviar: el backend sigue viendo rutas "normales" sin
// prefijo). BASE_PATH solo se usa para construir URLs ABSOLUTAS que salen
// hacia el navegador (redirects, href/src de las páginas, y el prefijo que
// usan app.js/quiosco.js para sus llamadas a /api/*): así el navegador,
// que sí ve la URL pública con /rrhh, navega siempre de forma coherente.
// Si BASE_PATH queda vacío (otros despliegues de este mismo núcleo
// multi-propiedad que no publican bajo subpath) el comportamiento es
// exactamente el de antes.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

// ─── FASE 4 — Envío de informes por correo (gate SEND_MODE) ───
// SEND_MODE=test (valor por defecto, también si no está definido) → NUNCA
// se envía correo real: se registra en logs/mail-test.log el destinatario,
// asunto y cuerpo. Cualquier otro valor (p.ej. 'production') intenta el
// envío real vía SMTP_* (nodemailer). El destinatario NUNCA lo elige quien
// llama al endpoint: siempre es NOTIFY_EMAIL (evita reenvíos a terceros).
const SEND_MODE = (process.env.SEND_MODE || 'test').trim();
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || '';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { mode: 0o700 });

const property = JSON.parse(fs.readFileSync(path.join(__dirname, 'property.json'), 'utf8'));
const PROPERTY_ID = property.id_propiedad;
const PROPERTY_NAME = property.nombre;
// FASE 7 — Plan B: config de jornada estándar usada SOLO cuando un empleado
// ficha sin tener cuadrante asignado ese día. Si falta en property.json,
// Plan B queda desactivado (nunca se inventan horas esperadas por defecto).
const PLAN_B = {
  activo: !!(property.planB && property.planB.activo),
  horasEsperadas: property.planB && property.planB.horas_dia != null ? property.planB.horas_dia : null,
  toleranciaMin: property.planB && property.planB.tolerancia_min != null ? property.planB.tolerancia_min : 0,
};
const COLORS = property.branding.colores;
const ICON = property.branding.icono_emoji || '👥';

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { mode: 0o700 });

const TIPOS_DOCUMENTO = ['contrato', 'dni', 'titulacion', 'otro'];
const MIME_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FICHERO_BYTES = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_DIR, String(req.params.id));
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: MAX_FICHERO_BYTES },
  fileFilter: (req, file, cb) => {
    if (!MIME_PERMITIDOS.includes(file.mimetype)) {
      return cb(new Error('Tipo de fichero no permitido (solo PDF, JPG o PNG)'));
    }
    cb(null, true);
  },
});

const app = express();
app.set('trust proxy', 1);

// Red de seguridad: si alguien llega directamente al backend (p.ej. IP:3096)
// con el prefijo /rrhh ya puesto, lo recortamos aquí para que las rutas
// definidas más abajo (que no conocen el prefijo) sigan haciendo match. El
// caso normal (edge Apache haciendo ProxyPass con recorte de /rrhh/) ya
// llega sin prefijo y esta comprobación no hace nada.
if (BASE_PATH) {
  app.use((req, res, next) => {
    if (req.url === BASE_PATH || req.url.startsWith(BASE_PATH + '/')) {
      req.url = req.url.slice(BASE_PATH.length) || '/';
    }
    next();
  });
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const redisClient = redis.createClient({
  host: '127.0.0.1',
  port: 6379,
  legacyMode: false
});
redisClient.connect().catch(e => console.error('[Redis]', e.message));

app.use(session({
  store: new RedisStore({ client: redisClient }),
  name: 'adaria_session',
  secret: process.env.SSO_SESSION_SECRET || SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 1000 * 60 * 60 * 8,
  },
}));
// Middleware SSO: intenta leer cookie btr_sso desde portal
app.use(ssoMiddleware.attachSsoUser());

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const favicon = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${ICON}</text></svg>`
)}`;

// ─── Salud (pública, sin auth, para systemd/monitorización) ───

// Middleware de autorización que combina SSO + local
function ensureAuth(req, res, next) {
  req.user = req.session.user || req.ssoUser;
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

function ensureAdmin(req, res, next) {
  ensureAuth(req, res, () => {
    const userRol = req.user.rol || (req.user.source === 'local' ? 'superadmin' : 'usuario');
    if (userRol !== 'admin' && userRol !== 'superadmin') {
      return res.status(403).json({ error: 'Acceso denegado — se requiere rol admin' });
    }
    next();
  });
}

function ensureSuperadmin(req, res, next) {
  ensureAuth(req, res, () => {
    const userRol = req.user.rol || (req.user.source === 'local' ? 'superadmin' : 'usuario');
    if (userRol !== 'superadmin') {
      return res.status(403).json({ error: 'Acceso denegado — se requiere rol superadmin' });
    }
    next();
  });
}

// ─── Salud (pública, sin auth, para systemd/monitorización) ───
app.get('/api/version', (req, res) => res.json({ version: require('./package.json').version }));

app.get('/health', (req, res) => res.json({ ok: true, app: 'adaria-personal', v: APP_VERSION, property: PROPERTY_ID }));
app.get('/halo', (req, res) => res.json({ ok: true, modulo: 'personal', timestamp: Date.now(), version: APP_VERSION }));

// ─── Changelog (público, sin auth) ───
// Sirve VERSION/changelog.json (histórico de commits generado desde git log)
// y una vista HTML de tabla que lo consume vía fetch. Sin autenticación a
// propósito: mismo criterio que /health y /api/version (info operativa,
// no datos de empleados). Respeta BASE_PATH en todas las URLs que salen
// hacia el navegador (igual que el resto de vistas de este módulo).
// NOTA: sin prefijo BASE_PATH aquí — igual que el resto de rutas de este
// fichero (/login, /health…), porque el middleware de arriba ya recorta
// /rrhh de req.url antes de llegar a esta definición (tanto si lo recorta
// el edge Apache como si llega directo al puerto 3096 con el prefijo puesto).
app.use('/VERSION', express.static(path.join(__dirname, 'VERSION')));

app.get('/changelog', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<link rel="icon" href="${favicon}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Changelog · Personal · ${esc(PROPERTY_NAME)}</title><style>
:root{--od:${COLORS.primario};--om:${COLORS.acento_medio};--ol:${COLORS.acento_claro}}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#333;background:#f8f9fa;padding:24px}
h1{color:var(--od);font-size:20px;margin-bottom:4px}
.sub{color:var(--om);font-size:13px;margin-bottom:20px;font-weight:600}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.08)}
th,td{text-align:left;padding:10px 14px;font-size:13px;border-bottom:1px solid #eee;vertical-align:top}
th{background:var(--od);color:#fff;font-weight:600}
td.ver{font-family:monospace;color:var(--om);white-space:nowrap}
td.fecha{white-space:nowrap;color:#888}
td.resumen{white-space:pre-line;color:#555}
tr:last-child td{border-bottom:none}
.empty{padding:24px;text-align:center;color:#999}
</style></head><body>
<h1>📋 Changelog · Personal</h1>
<div class="sub">${esc(PROPERTY_NAME)}</div>
<table id="tbl"><thead><tr><th>Versión</th><th>Fecha</th><th>Cambio</th></tr></thead>
<tbody id="tbody"><tr><td colspan="3" class="empty">Cargando…</td></tr></tbody></table>
<script>
var BASE_PATH = ${JSON.stringify(BASE_PATH)};
fetch(BASE_PATH + '/VERSION/changelog.json')
  .then(function(r){ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
  .then(function(d){
    var body = document.getElementById('tbody');
    var versiones = (d && d.versiones) || [];
    if (!versiones.length) { body.innerHTML = '<tr><td colspan="3" class="empty">Sin entradas</td></tr>'; return; }
    body.innerHTML = versiones.map(function(v){
      var esc = function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
      return '<tr><td class="ver">' + esc(v.version) + '</td><td class="fecha">' + esc(v.fecha) + '</td><td class="resumen">' + esc(v.titulo) + '</td></tr>';
    }).join('');
  })
  .catch(function(){ document.getElementById('tbody').innerHTML = '<tr><td colspan="3" class="empty">No se pudo cargar el changelog</td></tr>'; });
</script>
</body></html>`);
});

// ─── Login (único admin, definido en .env; preparado para SSO futuro) ───
const loginPage = (err) => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<link rel="icon" href="${favicon}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceso · Personal · ${esc(PROPERTY_NAME)}</title><style>
:root{--od:${COLORS.primario};--om:${COLORS.acento_medio};--ol:${COLORS.acento_claro};--tc:${COLORS.terracota};--off:#f8f9fa;--ch:#333}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:var(--ch);background:var(--off);min-height:100vh}
.login{max-width:380px;margin:10vh auto;background:#fff;border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.18);padding:38px 34px}
.login .bar{height:5px;background:linear-gradient(90deg,var(--ol),var(--tc));border-radius:16px 16px 0 0;margin:-38px -34px 26px}
.login h2{color:var(--od);text-align:center;margin-bottom:4px}
.login .s{text-align:center;color:var(--om);font-size:13px;margin-bottom:22px;font-weight:600}
.login label{font-size:13px;font-weight:600;color:#555;display:block;margin:12px 0 5px}
.login input{width:100%;padding:10px 12px;border:1px solid #cfdde3;border-radius:9px;font-size:15px}
.login button{width:100%;margin-top:20px;background:var(--od);color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:600;cursor:pointer}
.err{background:#fdecea;color:#c0392b;padding:9px 12px;border-radius:8px;font-size:13px;margin-top:14px;text-align:center}
.ver{position:fixed;bottom:8px;right:12px;font-size:11px;color:#bbb}
</style></head><body>
<div class="login"><div class="bar"></div><h2>${ICON} ${esc(PROPERTY_NAME)}</h2><div class="s">Gestión de Personal</div>
<form method="post" action="${BASE_PATH}/login"><label>Usuario</label><input name="u" autofocus autocomplete="username">
<label>Contraseña</label><input name="p" type="password" autocomplete="current-password"><button>Entrar</button>
${err ? '<div class="err">Usuario o contraseña incorrectos</div>' : ''}</form></div>
<div class="ver">Adaria Personal v${APP_VERSION}</div></body></html>`;

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(BASE_PATH + '/');
  res.send(loginPage(!!req.query.e));
});
// Credenciales compartidas del staff (10/09/2026): mismo usuario/contraseña
// que adaria-gestion y adaria-parking, para no obligar a recordar un login
// distinto por módulo. Fuente única: users.json de adaria-gestion (mismo
// contenedor CT111) — si cambia ahí (alta, reset de contraseña), aquí se
// refleja sola, sin sincronizar nada a mano.
const GESTION_USERS_FILE = '/opt/adaria-gestion/users.json';
function checkGestionSharedCreds(u, p) {
  try {
    const users = JSON.parse(fs.readFileSync(GESTION_USERS_FILE, 'utf8'));
    const rec = users[u];
    if (rec && bcrypt.compareSync(p, rec.hash)) return rec;
  } catch (e) { /* fichero no accesible (p.ej. en local sin ese path): se ignora */ }
  return null;
}

app.post('/login', (req, res) => {
  const u = (req.body.u || '').trim().toLowerCase();
  const p = (req.body.p || '').trim();

  // Si hay sesión SSO válida, redireccionar (ya está autenticado)
  if (req.ssoUser) {
    return res.redirect(BASE_PATH + '/');
  }

  // Validar contra login local (fallback)
  if (u && ADMIN_USER && u === ADMIN_USER && ADMIN_PASSWORD_HASH && bcrypt.compareSync(p, ADMIN_PASSWORD_HASH)) {
    req.session.user = { login: u, rol: 'superadmin', source: 'local' };
    return res.redirect(BASE_PATH + '/');
  }

  // Validar contra las credenciales compartidas del staff (gestion)
  const shared = checkGestionSharedCreds(u, p);
  if (shared) {
    const rol = (shared.role === 'superadmin' || shared.role === 'admin') ? 'superadmin' : 'usuario';
    req.session.user = { login: u, rol, source: 'gestion' };
    return res.redirect(BASE_PATH + '/');
  }

  res.redirect(BASE_PATH + '/login?e=1');
});
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect(BASE_PATH + '/login')); });

function requireAuth(req, res, next) {
  // El quiosco (FASE 2) NO usa el login de admin: tiene su propia puerta
  // (KIOSK_KEY, ver requireKiosk más abajo). Se excluye aquí del login admin.
  // req.path ya llega SIN el prefijo /rrhh (Apache lo recorta al reenviar,
  // y la red de seguridad de más arriba lo recorta si llegase puesto).
  // version-badge.js también se exime: lo carga tanto la SPA autenticada
  // como la vista /quiosco (sin sesión de admin) — es un script estático
  // sin datos sensibles, y sin esta excepción el quiosco lo recibiría
  // redirigido a /login en vez de al JS real.
  if (req.path.startsWith('/quiosco') || req.path.startsWith('/api/quiosco') || req.path === '/version-badge.js') return next();
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autenticado' });
  res.redirect(BASE_PATH + '/login');
}
app.use(requireAuth);

// Config de la propiedad para el frontend (branding, nombre; NO credenciales)
app.get('/api/property', ensureAuth, (req, res) => {
  res.json({ id: PROPERTY_ID, nombre: PROPERTY_NAME, branding: property.branding, version: APP_VERSION });
});

// ═══════════════════════════════════════════════════════════════════
// FASE 2 — Autofichaje / Quiosco: helpers de seguridad y de estado.
// El quiosco es una puerta totalmente distinta del login de admin: la
// tablet se configura UNA VEZ visitando /quiosco?key=<KIOSK_KEY> (define
// una cookie httpOnly de larga duración en ese dispositivo) y a partir de
// ahí solo puede identificar empleados (por PIN o QR) y registrar SU
// fichaje. Nunca ve datos de otros empleados ni el panel admin.
// ═══════════════════════════════════════════════════════════════════
const KIOSK_COOKIE_NAME = 'ap_kiosk';
const KIOSK_COOKIE_OPTS = {
  httpOnly: true, sameSite: 'lax', secure: false,
  maxAge: 1000 * 60 * 60 * 24 * 365 * 5, // 5 años: se configura una sola vez
};

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    if (k) out[k] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function kioskAutorizado(req) {
  if (!KIOSK_KEY) return false;
  const cookies = parseCookies(req);
  return cookies[KIOSK_COOKIE_NAME] === KIOSK_KEY
    || req.query.key === KIOSK_KEY
    || req.headers['x-kiosk-key'] === KIOSK_KEY;
}

function requireKiosk(req, res, next) {
  if (kioskAutorizado(req)) return next();
  res.status(403).json({ error: 'Este dispositivo no está configurado como quiosco' });
}

// PIN: nunca se guarda en claro. pin_hash (bcrypt) verifica el PIN;
// pin_lookup (HMAC-SHA256 con SESSION_SECRET) permite ENCONTRAR al
// empleado por su PIN con una consulta indexada, sin comparar por bcrypt
// contra toda la plantilla y sin riesgo de colisión silenciosa entre dos
// empleados con el mismo PIN (la unicidad se exige a nivel de BD).
function pinLookupHash(pin) {
  return crypto.createHmac('sha256', SECRET).update(`${PROPERTY_ID}:${pin}`).digest('hex');
}
const PIN_REGEX = /^\d{4,6}$/;

// Freno sencillo contra fuerza bruta de PIN por IP (en memoria; suficiente
// para una tablet de recepción, no es un servicio expuesto a internet).
const intentosFallidos = new Map();
const MAX_INTENTOS_PIN = 10;
const VENTANA_INTENTOS_MS = 5 * 60 * 1000;
function demasiadosIntentos(ip) {
  const rec = intentosFallidos.get(ip);
  return !!(rec && rec.resetAt > Date.now() && rec.count >= MAX_INTENTOS_PIN);
}
function registrarIntentoFallido(ip) {
  const now = Date.now();
  const rec = intentosFallidos.get(ip);
  if (!rec || rec.resetAt < now) { intentosFallidos.set(ip, { count: 1, resetAt: now + VENTANA_INTENTOS_MS }); return; }
  rec.count += 1;
}
function limpiarIntentos(ip) { intentosFallidos.delete(ip); }

// Máquina de estados del fichaje. El estado NO se acota por día de
// calendario: se deriva del ÚLTIMO fichaje cronológico del empleado (sea
// de hoy o de ayer), lo que resuelve de forma natural los turnos que
// cruzan la medianoche (entrada 23:40 → sigue "dentro" pasada la 00:00,
// hasta que ficha su salida a las 07:10 del día siguiente).
const TIPOS_FICHAJE = ['entrada', 'salida', 'pausa_inicio', 'pausa_fin'];
const ESTADO_TRAS_TIPO = { entrada: 'dentro', pausa_fin: 'dentro', pausa_inicio: 'en_pausa', salida: 'fuera' };
const ACCIONES_PERMITIDAS = { fuera: ['entrada'], dentro: ['pausa_inicio', 'salida'], en_pausa: ['pausa_fin'] };
const ETIQUETA_ESTADO = { fuera: 'Fuera', dentro: 'Dentro', en_pausa: 'En pausa' };
const ETIQUETA_ACCION = { entrada: 'Entrada', salida: 'Salida', pausa_inicio: 'Iniciar pausa', pausa_fin: 'Fin de pausa' };

async function estadoActual(empleadoId) {
  const { rows } = await pool.query(
    'SELECT tipo, ts FROM fichaje WHERE empleado_id = $1 ORDER BY ts DESC, id DESC LIMIT 1',
    [empleadoId]
  );
  const estado = rows.length ? (ESTADO_TRAS_TIPO[rows[0].tipo] || 'fuera') : 'fuera';
  return { estado, ultimo: rows[0] || null };
}

function resumenEmpleadoEstado(emp, estado) {
  return {
    empleado_id: emp.id,
    nombre: emp.nombre,
    apellidos: emp.apellidos,
    estado,
    estado_texto: ETIQUETA_ESTADO[estado],
    acciones: (ACCIONES_PERMITIDAS[estado] || []).map((tipo) => ({ tipo, texto: ETIQUETA_ACCION[tipo] })),
  };
}

// index.html se sirve con una ruta explícita (no por express.static puro)
// para poder inyectarle el prefijo /rrhh en sus assets y en window.__BASE_PATH__
// (que lee public/app.js para saber contra qué prefijo llamar a /api/*).
// El fichero público lleva el token __BASE_PATH__ literal donde corresponde;
// aquí se sustituye por el valor real (vacío en despliegues sin subpath).
const INDEX_HTML_TEMPLATE = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
app.get('/', (req, res) => {
  res.send(INDEX_HTML_TEMPLATE.split('__BASE_PATH__').join(BASE_PATH));
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Departamentos ───
app.get('/api/departamentos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre FROM departamento WHERE property_id = $1 ORDER BY nombre',
      [PROPERTY_ID]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer departamentos' });
  }
});

app.post('/api/departamentos', async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre del departamento es obligatorio' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO departamento(property_id, nombre) VALUES ($1,$2) RETURNING id, nombre',
      [PROPERTY_ID, nombre]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un departamento con ese nombre' });
    console.error(err);
    res.status(500).json({ error: 'Error al crear el departamento' });
  }
});

app.put('/api/departamentos/:id', async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre del departamento es obligatorio' });
  try {
    const { rows } = await pool.query(
      'UPDATE departamento SET nombre = $1 WHERE id = $2 AND property_id = $3 RETURNING id, nombre',
      [nombre, req.params.id, PROPERTY_ID]
    );
    if (!rows.length) return res.status(404).json({ error: 'Departamento no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un departamento con ese nombre' });
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el departamento' });
  }
});

app.delete('/api/departamentos/:id', async (req, res) => {
  try {
    const enUso = await pool.query(
      'SELECT COUNT(*)::int AS n FROM empleado WHERE departamento_id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (enUso.rows[0].n > 0) {
      return res.status(409).json({ error: `No se puede borrar: hay ${enUso.rows[0].n} empleado(s) en este departamento` });
    }
    const { rowCount } = await pool.query(
      'DELETE FROM departamento WHERE id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Departamento no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar el departamento' });
  }
});

// ─── Empleados ───
const EMPLEADO_CAMPOS = ['nombre', 'apellidos', 'dni_nie', 'fecha_nacimiento', 'telefono', 'email', 'puesto', 'departamento_id', 'fecha_alta', 'notas'];

function limpiarEmpleadoBody(body) {
  const out = {};
  for (const c of EMPLEADO_CAMPOS) {
    let v = body[c];
    if (v === '' || v === undefined) v = null;
    out[c] = v;
  }
  return out;
}

// coste_hora (FASE 4 — Informes): OPCIONAL. null = "(coste pendiente)", NUNCA
// se asume 0 ni se inventa un valor. Se valida aparte porque es numérico
// (no cabe en limpiarEmpleadoBody, pensado para texto/fechas).
// Devuelve { ok:true, valor } o { ok:false, error }.
function parseCosteHora(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, valor: null };
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'El coste por hora debe ser un número igual o mayor que 0 (o dejarse en blanco si aún no se conoce)' };
  }
  return { ok: true, valor: Math.round(n * 100) / 100 };
}

app.get('/api/empleados', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const departamentoId = req.query.departamento_id || null;
    const activo = req.query.activo; // 'true' | 'false' | undefined (todos)

    const cond = ['e.property_id = $1'];
    const params = [PROPERTY_ID];
    if (q) {
      params.push(`%${q}%`);
      cond.push(`(e.nombre ILIKE $${params.length} OR e.apellidos ILIKE $${params.length} OR e.dni_nie ILIKE $${params.length})`);
    }
    if (departamentoId) {
      params.push(departamentoId);
      cond.push(`e.departamento_id = $${params.length}`);
    }
    if (activo === 'true' || activo === 'false') {
      params.push(activo === 'true');
      cond.push(`e.activo = $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT e.id, e.nombre, e.apellidos, e.dni_nie, e.puesto, e.departamento_id, d.nombre AS departamento_nombre,
              e.fecha_alta, e.fecha_baja, e.activo
       FROM empleado e
       LEFT JOIN departamento d ON d.id = e.departamento_id
       WHERE ${cond.join(' AND ')}
       ORDER BY e.activo DESC, e.apellidos, e.nombre`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer empleados' });
  }
});

app.get('/api/empleados/:id', async (req, res) => {
  try {
    // No se seleccionan pin_hash ni pin_lookup: el panel admin solo necesita
    // saber SI hay PIN asignado (tiene_pin), nunca el hash en sí.
    const { rows } = await pool.query(
      `SELECT e.id, e.property_id, e.nombre, e.apellidos, e.dni_nie, e.fecha_nacimiento, e.telefono, e.email,
              e.puesto, e.departamento_id, e.fecha_alta, e.fecha_baja, e.activo, e.notas, e.creado_en, e.actualizado_en,
              e.coste_hora,
              (e.pin_hash IS NOT NULL) AS tiene_pin, e.qr_token,
              d.nombre AS departamento_nombre
       FROM empleado e LEFT JOIN departamento d ON d.id = e.departamento_id
       WHERE e.id = $1 AND e.property_id = $2`,
      [req.params.id, PROPERTY_ID]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empleado no encontrado' });
    const docs = await pool.query(
      'SELECT id, tipo, nombre_fichero, subido_en FROM documento_empleado WHERE empleado_id = $1 ORDER BY subido_en DESC',
      [req.params.id]
    );
    res.json({ ...rows[0], documentos: docs.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer el empleado' });
  }
});

async function departamentoValido(departamentoId) {
  if (!departamentoId) return true;
  const { rows } = await pool.query(
    'SELECT 1 FROM departamento WHERE id = $1 AND property_id = $2',
    [departamentoId, PROPERTY_ID]
  );
  return rows.length > 0;
}

app.post('/api/empleados', async (req, res) => {
  const d = limpiarEmpleadoBody(req.body);
  if (!d.nombre || !d.apellidos || !d.fecha_alta) {
    return res.status(400).json({ error: 'Nombre, apellidos y fecha de alta son obligatorios' });
  }
  if (!(await departamentoValido(d.departamento_id))) {
    return res.status(400).json({ error: 'Departamento no válido' });
  }
  const coste = parseCosteHora(req.body.coste_hora);
  if (!coste.ok) return res.status(400).json({ error: coste.error });
  try {
    const { rows } = await pool.query(
      `INSERT INTO empleado(property_id, nombre, apellidos, dni_nie, fecha_nacimiento, telefono, email, puesto, departamento_id, fecha_alta, notas, coste_hora)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [PROPERTY_ID, d.nombre, d.apellidos, d.dni_nie, d.fecha_nacimiento, d.telefono, d.email, d.puesto, d.departamento_id, d.fecha_alta, d.notas, coste.valor]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un empleado con ese DNI/NIE' });
    console.error(err);
    res.status(500).json({ error: 'Error al crear el empleado' });
  }
});

app.put('/api/empleados/:id', async (req, res) => {
  const d = limpiarEmpleadoBody(req.body);
  if (!d.nombre || !d.apellidos || !d.fecha_alta) {
    return res.status(400).json({ error: 'Nombre, apellidos y fecha de alta son obligatorios' });
  }
  if (!(await departamentoValido(d.departamento_id))) {
    return res.status(400).json({ error: 'Departamento no válido' });
  }
  const coste = parseCosteHora(req.body.coste_hora);
  if (!coste.ok) return res.status(400).json({ error: coste.error });
  try {
    const { rowCount } = await pool.query(
      `UPDATE empleado SET nombre=$1, apellidos=$2, dni_nie=$3, fecha_nacimiento=$4, telefono=$5, email=$6,
              puesto=$7, departamento_id=$8, fecha_alta=$9, notas=$10, coste_hora=$11, actualizado_en=now()
       WHERE id = $12 AND property_id = $13`,
      [d.nombre, d.apellidos, d.dni_nie, d.fecha_nacimiento, d.telefono, d.email, d.puesto, d.departamento_id, d.fecha_alta, d.notas, coste.valor, req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un empleado con ese DNI/NIE' });
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el empleado' });
  }
});

// Baja: soft-delete (activo=false + fecha_baja). No se borra nada físicamente.
app.post('/api/empleados/:id/baja', async (req, res) => {
  const fechaBaja = req.body.fecha_baja || new Date().toISOString().slice(0, 10);
  try {
    const { rowCount } = await pool.query(
      "UPDATE empleado SET activo = false, fecha_baja = $1, actualizado_en = now() WHERE id = $2 AND property_id = $3",
      [fechaBaja, req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al dar de baja al empleado' });
  }
});

// Necesario para las pruebas de verificación de Fase 1 (deja la tabla vacía al terminar).
app.delete('/api/empleados/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM empleado WHERE id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar el empleado' });
  }
});

// ─── Documentos del empleado ───
async function empleadoDeLaPropiedad(id) {
  const { rows } = await pool.query('SELECT id FROM empleado WHERE id = $1 AND property_id = $2', [id, PROPERTY_ID]);
  return rows.length > 0;
}

app.post('/api/empleados/:id/documentos', (req, res) => {
  upload.single('documento')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      if (!(await empleadoDeLaPropiedad(req.params.id))) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: 'Empleado no encontrado' });
      }
      if (!req.file) return res.status(400).json({ error: 'Falta el fichero' });
      const tipo = TIPOS_DOCUMENTO.includes(req.body.tipo) ? req.body.tipo : 'otro';
      const rutaRelativa = path.join(String(req.params.id), path.basename(req.file.path));
      const { rows } = await pool.query(
        'INSERT INTO documento_empleado(empleado_id, tipo, nombre_fichero, ruta) VALUES ($1,$2,$3,$4) RETURNING id, tipo, nombre_fichero, subido_en',
        [req.params.id, tipo, req.file.originalname, rutaRelativa]
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al guardar el documento' });
    }
  });
});

app.get('/api/documentos/:id/descargar', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT doc.nombre_fichero, doc.ruta FROM documento_empleado doc
       JOIN empleado e ON e.id = doc.empleado_id
       WHERE doc.id = $1 AND e.property_id = $2`,
      [req.params.id, PROPERTY_ID]
    );
    if (!rows.length) return res.status(404).json({ error: 'Documento no encontrado' });
    const full = path.join(UPLOADS_DIR, rows[0].ruta);
    if (!full.startsWith(UPLOADS_DIR) || !fs.existsSync(full)) {
      return res.status(404).json({ error: 'Fichero no encontrado' });
    }
    res.download(full, rows[0].nombre_fichero);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al descargar el documento' });
  }
});

app.delete('/api/documentos/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT doc.ruta FROM documento_empleado doc
       JOIN empleado e ON e.id = doc.empleado_id
       WHERE doc.id = $1 AND e.property_id = $2`,
      [req.params.id, PROPERTY_ID]
    );
    if (!rows.length) return res.status(404).json({ error: 'Documento no encontrado' });
    await pool.query('DELETE FROM documento_empleado WHERE id = $1', [req.params.id]);
    const full = path.join(UPLOADS_DIR, rows[0].ruta);
    if (full.startsWith(UPLOADS_DIR)) fs.unlink(full, () => {});
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar el documento' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// FASE 2 — Admin: asignar/regenerar PIN y QR, ver y corregir fichajes.
// Todo bajo requireAuth (admin), igual que el resto del panel.
// ═══════════════════════════════════════════════════════════════════

app.post('/api/empleados/:id/pin', async (req, res) => {
  const pin = String(req.body.pin || '').trim();
  if (!PIN_REGEX.test(pin)) {
    return res.status(400).json({ error: 'El PIN debe tener entre 4 y 6 dígitos' });
  }
  try {
    if (!(await empleadoDeLaPropiedad(req.params.id))) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }
    const hash = bcrypt.hashSync(pin, 10);
    const lookup = pinLookupHash(pin);
    await pool.query(
      'UPDATE empleado SET pin_hash = $1, pin_lookup = $2, actualizado_en = now() WHERE id = $3 AND property_id = $4',
      [hash, lookup, req.params.id, PROPERTY_ID]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ese PIN ya está en uso por otro empleado; elige otro' });
    console.error(err);
    res.status(500).json({ error: 'Error al asignar el PIN' });
  }
});

app.delete('/api/empleados/:id/pin', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'UPDATE empleado SET pin_hash = NULL, pin_lookup = NULL, actualizado_en = now() WHERE id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al quitar el PIN' });
  }
});

app.post('/api/empleados/:id/qr/regenerar', async (req, res) => {
  try {
    if (!(await empleadoDeLaPropiedad(req.params.id))) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }
    const token = crypto.randomBytes(20).toString('hex');
    await pool.query(
      'UPDATE empleado SET qr_token = $1, actualizado_en = now() WHERE id = $2 AND property_id = $3',
      [token, req.params.id, PROPERTY_ID]
    );
    res.json({ ok: true, qr_token: token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el QR' });
  }
});

app.get('/api/empleados/:id/qr', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT qr_token FROM empleado WHERE id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empleado no encontrado' });
    if (!rows[0].qr_token) return res.status(404).json({ error: 'Este empleado todavía no tiene QR asignado' });
    const dataUrl = await QRCode.toDataURL(rows[0].qr_token, { margin: 2, width: 320 });
    res.json({ qr_token: rows[0].qr_token, imagen: dataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar la imagen del QR' });
  }
});

// ─── Fichajes: listado (hoy / rango / por empleado) y corrección manual ───
app.get('/api/fichajes', async (req, res) => {
  try {
    const cond = ['f.property_id = $1'];
    const params = [PROPERTY_ID];
    if (req.query.empleado_id) {
      params.push(req.query.empleado_id);
      cond.push(`f.empleado_id = $${params.length}`);
    }
    if (req.query.desde) {
      params.push(req.query.desde);
      cond.push(`f.ts >= $${params.length}::timestamptz`);
    }
    if (req.query.hasta) {
      params.push(req.query.hasta);
      cond.push(`f.ts < ($${params.length}::timestamptz + interval '1 day')`);
    }
    if (req.query.hoy === 'true') {
      // "Hoy" según el huso horario de la propiedad, no el del servidor.
      params.push(property.timezone || 'Europe/Madrid');
      cond.push(`date_trunc('day', f.ts AT TIME ZONE $${params.length}) = date_trunc('day', now() AT TIME ZONE $${params.length})`);
    }
    const { rows } = await pool.query(
      `SELECT f.id, f.empleado_id, e.nombre, e.apellidos, f.tipo, f.ts, f.origen, f.nota, f.creado_por
       FROM fichaje f JOIN empleado e ON e.id = f.empleado_id
       WHERE ${cond.join(' AND ')}
       ORDER BY f.ts DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer los fichajes' });
  }
});

app.post('/api/fichajes', async (req, res) => {
  const empleadoId = parseInt(req.body.empleado_id, 10);
  const tipo = String(req.body.tipo || '');
  const ts = req.body.ts || new Date().toISOString();
  const nota = (req.body.nota || '').trim() || null;
  if (!empleadoId || !TIPOS_FICHAJE.includes(tipo)) {
    return res.status(400).json({ error: 'Empleado y tipo de fichaje son obligatorios' });
  }
  try {
    if (!(await empleadoDeLaPropiedad(empleadoId))) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }
    const { rows } = await pool.query(
      `INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen, nota, creado_por)
       VALUES ($1,$2,$3,$4,'manual',$5,$6) RETURNING id`,
      [PROPERTY_ID, empleadoId, tipo, ts, nota, req.session.user.login]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el fichaje manual' });
  }
});

app.put('/api/fichajes/:id', async (req, res) => {
  const tipo = String(req.body.tipo || '');
  const ts = req.body.ts;
  const nota = (req.body.nota || '').trim() || null;
  if (!TIPOS_FICHAJE.includes(tipo) || !ts) {
    return res.status(400).json({ error: 'Tipo y fecha/hora son obligatorios' });
  }
  try {
    // La corrección manual queda siempre trazada: origen='manual' + quién la hizo.
    const { rowCount } = await pool.query(
      `UPDATE fichaje SET tipo = $1, ts = $2, nota = $3, origen = 'manual', creado_por = $4
       WHERE id = $5 AND property_id = $6`,
      [tipo, ts, nota, req.session.user.login, req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Fichaje no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al corregir el fichaje' });
  }
});

app.delete('/api/fichajes/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM fichaje WHERE id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Fichaje no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar el fichaje' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// FASE 2 — Quiosco: pantalla pública (protegida por KIOSK_KEY) para que
// el empleado ficha él mismo. Sin login de admin, sin ver datos de otros.
// ═══════════════════════════════════════════════════════════════════

const kioskAvisoPage = (titulo, texto) => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<link rel="icon" href="${favicon}"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · ${esc(PROPERTY_NAME)}</title><style>
:root{--od:${COLORS.primario};--om:${COLORS.acento_medio}}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:var(--od);color:#fff;
min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}
.box{max-width:420px}.box h2{margin-bottom:14px}.box p{opacity:.85;font-size:14px;line-height:1.5}
</style></head><body><div class="box"><h2>${esc(titulo)}</h2><p>${esc(texto)}</p></div></body></html>`;

app.get('/quiosco', (req, res) => {
  if (!KIOSK_KEY) {
    return res.status(503).send(kioskAvisoPage('Quiosco no configurado', 'Falta KIOSK_KEY en el servidor. Contacta con administración.'));
  }
  if (req.query.key === KIOSK_KEY) {
    res.cookie(KIOSK_COOKIE_NAME, KIOSK_KEY, KIOSK_COOKIE_OPTS);
    return res.redirect(BASE_PATH + '/quiosco');
  }
  // Permitir acceso si: (1) cookie válida O (2) sesión de admin válida (superadmin/admin desde gestion)
  const tieneSessionAdmin = req.session?.user?.role && ['admin', 'superadmin'].includes(req.session.user.role);
  if (!kioskAutorizado(req) && !tieneSessionAdmin) {
    return res.status(403).send(kioskAvisoPage(
      'Dispositivo no configurado',
      'Este dispositivo no está autorizado como quiosco de fichaje. Pide a administración la URL de configuración (con la clave) para configurarlo una vez.'
    ));
  }
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<link rel="icon" href="${favicon}"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Fichar · ${esc(PROPERTY_NAME)}</title><link rel="stylesheet" href="${BASE_PATH}/quiosco.css"></head>
<body>
<div id="adaria-header-version" class="k-ver k-ver-top"></div>
<div id="app" class="k-wrap"><div class="k-loading">Cargando…</div></div>
<div id="adaria-footer-version" class="k-ver k-ver-bottom"></div>
<script>window.__PROPERTY__ = ${JSON.stringify({ nombre: PROPERTY_NAME, icono: ICON, colores: COLORS })};
window.BASE_PATH = ${JSON.stringify(BASE_PATH)};</script>
<script src="${BASE_PATH}/quiosco.js"></script>
<script src="${BASE_PATH}/version-badge.js"></script>
</body></html>`);
});

// ─── API del quiosco (requireKiosk: sin cookie/clave válida, 403) ───
app.post('/api/quiosco/identificar', requireKiosk, async (req, res) => {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'desconocida';
  if (demasiadosIntentos(ip)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  }
  const pin = String(req.body.pin || '').trim();
  if (!PIN_REGEX.test(pin)) {
    return res.status(400).json({ error: 'PIN no válido' });
  }
  try {
    const lookup = pinLookupHash(pin);
    const { rows } = await pool.query(
      'SELECT id, nombre, apellidos, pin_hash FROM empleado WHERE property_id = $1 AND activo = true AND pin_lookup = $2',
      [PROPERTY_ID, lookup]
    );
    if (!rows.length || !rows[0].pin_hash || !bcrypt.compareSync(pin, rows[0].pin_hash)) {
      registrarIntentoFallido(ip);
      return res.status(401).json({ error: 'PIN incorrecto' });
    }
    limpiarIntentos(ip);
    const { estado } = await estadoActual(rows[0].id);
    res.json(resumenEmpleadoEstado(rows[0], estado));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al identificar' });
  }
});

app.get('/api/quiosco/qr/:token', requireKiosk, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, apellidos FROM empleado WHERE property_id = $1 AND activo = true AND qr_token = $2',
      [PROPERTY_ID, req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: 'QR no reconocido' });
    const { estado } = await estadoActual(rows[0].id);
    res.json(resumenEmpleadoEstado(rows[0], estado));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer el QR' });
  }
});

app.post('/api/quiosco/fichar', requireKiosk, async (req, res) => {
  const empleadoId = parseInt(req.body.empleado_id, 10);
  const tipo = String(req.body.tipo || '');
  const origen = req.body.origen === 'qr' ? 'qr' : 'quiosco';
  if (!empleadoId || !TIPOS_FICHAJE.includes(tipo)) {
    return res.status(400).json({ error: 'Datos de fichaje no válidos' });
  }
  try {
    const emp = await pool.query(
      'SELECT id, nombre, apellidos, departamento_id FROM empleado WHERE id = $1 AND property_id = $2 AND activo = true',
      [empleadoId, PROPERTY_ID]
    );
    if (!emp.rows.length) return res.status(404).json({ error: 'Empleado no encontrado' });

    // Re-validar el estado justo antes de insertar: evita doble-tap y
    // dobles entradas seguidas sin salida (o cualquier salto de estado).
    const { estado } = await estadoActual(empleadoId);
    if (!(ACCIONES_PERMITIDAS[estado] || []).includes(tipo)) {
      return res.status(409).json({ error: `Acción no permitida ahora mismo (estado actual: ${ETIQUETA_ESTADO[estado]})` });
    }

    const { rows } = await pool.query(
      "INSERT INTO fichaje(property_id, empleado_id, tipo, origen) VALUES ($1,$2,$3,$4) RETURNING id, tipo, ts",
      [PROPERTY_ID, empleadoId, tipo, origen]
    );
    const nuevoEstado = ESTADO_TRAS_TIPO[tipo];
    // FASE 5 — Motivación: tras la confirmación del fichaje se muestra el
    // mensaje del día (por departamento) y, si procede, cumpleaños/aniversario
    // de HOY (propio o de un/a compañero/a). Nunca incluye edad ni fecha de
    // nacimiento (ver datosMotivacion).
    const motivacion = await datosMotivacion(empleadoId, emp.rows[0].departamento_id);
    res.status(201).json({
      ok: true,
      fichaje_id: rows[0].id,
      tipo: rows[0].tipo,
      ts: rows[0].ts,
      nombre: emp.rows[0].nombre,
      apellidos: emp.rows[0].apellidos,
      estado: nuevoEstado,
      estado_texto: ETIQUETA_ESTADO[nuevoEstado],
      motivacion,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar el fichaje' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// FASE 3 — Inspección de Trabajo: registro de jornada legal (RD 8/2019).
// Las horas NO se guardan en una tabla propia: se calculan en caliente a
// partir de `fichaje` (fuente única de verdad), igual que el estado del
// quiosco (Fase 2). Esto evita datos duplicados o divergentes.
//
// Cálculo de jornada por empleado:
//  - Se recorren sus fichajes en orden cronológico (sin acotar por día de
//    calendario), igual que la máquina de estados del quiosco: una jornada
//    empieza en 'entrada' y termina en la 'salida' correspondiente, con las
//    pausas ('pausa_inicio'/'pausa_fin') intercaladas descontadas.
//  - Un turno que cruza medianoche (entrada 23:xx, salida al día siguiente)
//    genera UNA sola jornada; la fecha del registro es la del día de la
//    ENTRADA, y se marca cruza_medianoche=true.
//  - Fichajes huérfanos o incoherentes (pausa sin inicio/fin, salida sin
//    entrada previa) se ignoran para el cálculo de horas —nunca se inventa
//    un valor— pero se deja constancia como incidencia cuando corresponde.
//  - Una 'entrada' sin 'salida' deja la jornada abierta: horas_trabajadas
//    queda a null (nunca se estima) y se marca la incidencia
//    "Entrada sin salida registrada (jornada incompleta)".
// ═══════════════════════════════════════════════════════════════════

function fechaEnZona(ts, tz) {
  // 'en-CA' devuelve YYYY-MM-DD: cómodo para comparar/ordenar como texto.
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: tz });
}
function horaEnZona(ts, tz) {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString('es-ES', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
}

async function fichajesParaCalculo(empleadoIds, desde, hasta) {
  // Margen de 2 días a cada lado para no perder turnos que cruzan el límite
  // del rango solicitado (p.ej. entrada 23:50 del día anterior a "desde").
  const cond = ['property_id = $1'];
  const params = [PROPERTY_ID];
  if (empleadoIds && empleadoIds.length) {
    params.push(empleadoIds);
    cond.push(`empleado_id = ANY($${params.length}::int[])`);
  }
  params.push(desde);
  cond.push(`ts >= ($${params.length}::date - interval '2 days')`);
  params.push(hasta);
  cond.push(`ts < ($${params.length}::date + interval '3 days')`);
  const { rows } = await pool.query(
    `SELECT id, empleado_id, tipo, ts FROM fichaje WHERE ${cond.join(' AND ')} ORDER BY empleado_id, ts ASC, id ASC`,
    params
  );
  return rows;
}

// Construye las jornadas de UN empleado a partir de sus fichajes ordenados.
function construirJornadas(fichajesEmpleado) {
  const jornadas = [];
  let actual = null;
  for (const f of fichajesEmpleado) {
    if (f.tipo === 'entrada') {
      if (actual) {
        // Doble entrada sin salida intermedia: se cierra la anterior como incompleta.
        actual.incidencias.push('Entrada sin salida registrada (jornada incompleta)');
        jornadas.push(actual);
      }
      actual = { inicio: f.ts, fin: null, pausas: [], incidencias: [] };
    } else if (f.tipo === 'pausa_inicio') {
      if (!actual) continue; // pausa sin entrada previa: fichaje huérfano, se ignora sin inventar
      if (actual.pausas.some((p) => !p.fin)) continue; // ya había una pausa abierta
      actual.pausas.push({ inicio: f.ts, fin: null });
    } else if (f.tipo === 'pausa_fin') {
      if (!actual) continue;
      const abierta = [...actual.pausas].reverse().find((p) => !p.fin);
      if (!abierta) continue; // fin de pausa sin inicio: se ignora sin inventar
      abierta.fin = f.ts;
    } else if (f.tipo === 'salida') {
      if (!actual) continue; // salida sin entrada previa: se ignora sin inventar
      const abierta = actual.pausas.find((p) => !p.fin);
      if (abierta) {
        abierta.fin = f.ts;
        actual.incidencias.push('Pausa sin cierre explícito (descontada hasta la salida)');
      }
      actual.fin = f.ts;
      jornadas.push(actual);
      actual = null;
    }
  }
  if (actual) {
    actual.incidencias.push('Entrada sin salida registrada (jornada incompleta)');
    jornadas.push(actual);
  }
  return jornadas;
}

function calcularRegistroDia(j, tz) {
  const inicioMs = new Date(j.inicio).getTime();
  const finMs = j.fin ? new Date(j.fin).getTime() : null;
  const pausaMin = j.pausas.reduce((acc, p) => (p.fin ? acc + (new Date(p.fin) - new Date(p.inicio)) / 60000 : acc), 0);
  let horas = null;
  if (finMs != null) {
    horas = Math.round(((finMs - inicioMs) / 3600000 - pausaMin / 60) * 100) / 100;
  }
  return {
    fecha: fechaEnZona(j.inicio, tz),
    entrada: j.inicio,
    salida: j.fin,
    entrada_hora: horaEnZona(j.inicio, tz),
    salida_hora: horaEnZona(j.fin, tz),
    pausa_min: Math.round(pausaMin),
    horas_trabajadas: horas,
    incompleta: horas === null,
    cruza_medianoche: !!(j.fin && fechaEnZona(j.inicio, tz) !== fechaEnZona(j.fin, tz)),
    incidencias: j.incidencias,
  };
}

// Registro diario de uno o varios empleados en [desde,hasta] (ambos incluidos).
async function calcularInspeccion(empleadoIds, desde, hasta) {
  const tz = property.timezone || 'Europe/Madrid';
  const fichajes = await fichajesParaCalculo(empleadoIds, desde, hasta);
  const porEmpleado = new Map();
  for (const f of fichajes) {
    if (!porEmpleado.has(f.empleado_id)) porEmpleado.set(f.empleado_id, []);
    porEmpleado.get(f.empleado_id).push(f);
  }
  const resultado = new Map();
  for (const [empId, lista] of porEmpleado.entries()) {
    const jornadas = construirJornadas(lista);
    const registros = jornadas
      .map((j) => calcularRegistroDia(j, tz))
      .filter((r) => r.fecha >= desde && r.fecha <= hasta)
      .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
    resultado.set(empId, registros);
  }
  return resultado;
}

function totalizar(registros) {
  const horas = registros.reduce((acc, r) => acc + (r.horas_trabajadas || 0), 0);
  const incidencias = registros.filter((r) => r.incidencias.length > 0).length;
  return { dias: registros.length, horas_totales: Math.round(horas * 100) / 100, dias_con_incidencia: incidencias };
}

function validarRangoFechas(desde, hasta) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!desde || !hasta || !re.test(desde) || !re.test(hasta)) return 'Formato de fecha no válido (usa AAAA-MM-DD)';
  if (desde > hasta) return 'La fecha "desde" no puede ser posterior a "hasta"';
  return null;
}

// ─── Vista de inspección (admin): uno o todos los empleados, con totales ───
app.get('/api/inspeccion', async (req, res) => {
  const desde = req.query.desde;
  const hasta = req.query.hasta;
  const errFecha = validarRangoFechas(desde, hasta);
  if (errFecha) return res.status(400).json({ error: errFecha });
  try {
    let empleados;
    if (req.query.empleado_id) {
      const { rows } = await pool.query(
        'SELECT id, nombre, apellidos, dni_nie FROM empleado WHERE id = $1 AND property_id = $2',
        [req.query.empleado_id, PROPERTY_ID]
      );
      if (!rows.length) return res.status(404).json({ error: 'Empleado no encontrado' });
      empleados = rows;
    } else {
      const { rows } = await pool.query(
        'SELECT id, nombre, apellidos, dni_nie FROM empleado WHERE property_id = $1 ORDER BY apellidos, nombre',
        [PROPERTY_ID]
      );
      empleados = rows;
    }
    const porEmpleado = await calcularInspeccion(empleados.map((e) => e.id), desde, hasta);
    const salida = empleados.map((e) => {
      const registros = porEmpleado.get(e.id) || [];
      return { empleado: e, registros, totales: totalizar(registros) };
    });
    const todos = salida.flatMap((s) => s.registros);
    res.json({ desde, hasta, empleados: salida, totales_periodo: totalizar(todos) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular la inspección' });
  }
});

// ─── Sello de integridad: SHA-256 de una representación canónica del informe ───
// Depende SOLO de datos + metadatos ya fijados en el momento de generar el
// informe (nunca del PDF/CSV ya renderizado), para que sea reproducible:
// recalculando con los mismos fichajes y los mismos metadatos (guardados en
// export_log) se debe obtener exactamente el mismo hash.
function contenidoCanonico(meta, registros) {
  return JSON.stringify({
    property_id: meta.property_id,
    sociedad: meta.sociedad,
    empleado: meta.empleado || null,
    desde: meta.desde,
    hasta: meta.hasta,
    generado_por: meta.generado_por,
    generado_en: meta.generado_en,
    registros: registros.map((r) => ({
      fecha: r.fecha, entrada: r.entrada, salida: r.salida,
      pausa_min: r.pausa_min, horas_trabajadas: r.horas_trabajadas, incidencias: r.incidencias,
    })),
  });
}
function sha256(texto) {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}
async function registrarExport(empleadoId, desde, hasta, formato, generadoPor, hash) {
  await pool.query(
    'INSERT INTO export_log(property_id, generado_por, empleado_id, desde, hasta, formato, hash) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [PROPERTY_ID, generadoPor, empleadoId || null, desde, hasta, formato, hash]
  );
}

// ─── Exportación PDF (por empleado y periodo, con sello de integridad) ───
app.get('/api/inspeccion/pdf', async (req, res) => {
  const desde = req.query.desde;
  const hasta = req.query.hasta;
  const empleadoId = req.query.empleado_id;
  const errFecha = validarRangoFechas(desde, hasta);
  if (errFecha) return res.status(400).json({ error: errFecha });
  if (!empleadoId) return res.status(400).json({ error: 'El PDF se genera por empleado: falta empleado_id' });
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, apellidos, dni_nie FROM empleado WHERE id = $1 AND property_id = $2',
      [empleadoId, PROPERTY_ID]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empleado no encontrado' });
    const emp = rows[0];
    const porEmpleado = await calcularInspeccion([emp.id], desde, hasta);
    const registros = porEmpleado.get(emp.id) || [];
    const totales = totalizar(registros);
    const generadoPor = req.session.user.login;
    const generadoEn = new Date().toISOString();
    const sociedad = property.sociedad || {};
    const meta = {
      property_id: PROPERTY_ID, sociedad,
      empleado: { id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos, dni_nie: emp.dni_nie },
      desde, hasta, generado_por: generadoPor, generado_en: generadoEn,
    };
    const hash = sha256(contenidoCanonico(meta, registros));
    // Se registra ANTES de servir la respuesta: garantiza traza aunque el
    // cliente cierre la descarga a medio camino.
    await registrarExport(emp.id, desde, hasta, 'pdf', generadoPor, hash);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const nombreFichero = `inspeccion-${emp.apellidos}-${desde}_${hasta}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero}"`);
    doc.pipe(res);

    doc.fontSize(14).text(sociedad.razon_social || '(dato pendiente)');
    doc.fontSize(9).fillColor('#555')
      .text(`CIF: ${sociedad.cif || '(dato pendiente)'}    Domicilio: ${sociedad.domicilio || '(dato pendiente)'}`)
      .text(`Propiedad: ${PROPERTY_NAME}`)
      .moveDown(0.5);
    doc.fillColor('#000').fontSize(13).text('Registro de jornada laboral (RD 8/2019)', { underline: true }).moveDown(0.3);
    doc.fontSize(10)
      .text(`Empleado: ${emp.nombre} ${emp.apellidos}`)
      .text(`DNI/NIE: ${emp.dni_nie || '(dato pendiente)'}`)
      .text(`Periodo: ${desde} a ${hasta}`)
      .moveDown(0.6);

    const colX = [40, 110, 175, 240, 305, 370];
    const anchos = [70, 65, 65, 65, 65, 185];
    const cab = ['Fecha', 'Entrada', 'Salida', 'Pausa(min)', 'Horas', 'Incidencia'];
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    cab.forEach((c, i) => doc.text(c, colX[i], y, { width: anchos[i] }));
    doc.font('Helvetica').fontSize(9);
    y += 16;
    doc.moveTo(40, y - 3).lineTo(555, y - 3).strokeColor('#ccc').stroke();

    if (!registros.length) {
      doc.text('Sin fichajes en este periodo.', 40, y);
      y += 16;
    }
    for (const r of registros) {
      if (y > 740) { doc.addPage(); y = 40; }
      const fila = [
        r.fecha,
        r.entrada_hora || '—',
        r.salida_hora || '—',
        String(r.pausa_min),
        r.horas_trabajadas != null ? r.horas_trabajadas.toFixed(2) : '—',
        r.incidencias.length ? r.incidencias.join('; ') : (r.cruza_medianoche ? 'Turno nocturno (cruza medianoche)' : ''),
      ];
      fila.forEach((v, i) => doc.text(v, colX[i], y, { width: anchos[i] }));
      y += 16;
    }
    y += 8;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#ccc').stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(10).text(
      `Total días registrados: ${totales.dias}    Horas totales: ${totales.horas_totales.toFixed(2)}    Días con incidencia: ${totales.dias_con_incidencia}`,
      40, y
    );

    doc.font('Helvetica').fontSize(8).fillColor('#666').text(
      `Generado el ${new Date(generadoEn).toLocaleString('es-ES', { timeZone: property.timezone || 'Europe/Madrid' })} por ${generadoPor}. ` +
      `Sello de integridad (SHA-256): ${hash}. ` +
      `Este sello es una garantía de integridad del contenido, no una firma electrónica cualificada.`,
      40, 780, { width: 515 }
    );

    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar el PDF' });
  }
});

// ─── Exportación CSV (un empleado o todos) ───
app.get('/api/inspeccion/csv', async (req, res) => {
  const desde = req.query.desde;
  const hasta = req.query.hasta;
  const empleadoId = req.query.empleado_id || null;
  const errFecha = validarRangoFechas(desde, hasta);
  if (errFecha) return res.status(400).json({ error: errFecha });
  try {
    let empleados;
    if (empleadoId) {
      const { rows } = await pool.query('SELECT id, nombre, apellidos, dni_nie FROM empleado WHERE id = $1 AND property_id = $2', [empleadoId, PROPERTY_ID]);
      if (!rows.length) return res.status(404).json({ error: 'Empleado no encontrado' });
      empleados = rows;
    } else {
      const { rows } = await pool.query('SELECT id, nombre, apellidos, dni_nie FROM empleado WHERE property_id = $1 ORDER BY apellidos, nombre', [PROPERTY_ID]);
      empleados = rows;
    }
    const porEmpleado = await calcularInspeccion(empleados.map((e) => e.id), desde, hasta);
    const generadoPor = req.session.user.login;
    const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const filas = ['empleado,fecha,entrada,salida,pausa_min,horas_trabajadas,incidencia'];
    const todos = [];
    for (const e of empleados) {
      const registros = porEmpleado.get(e.id) || [];
      for (const r of registros) {
        todos.push(r);
        filas.push([
          csvEsc(`${e.apellidos}, ${e.nombre}`),
          r.fecha,
          r.entrada_hora || '',
          r.salida_hora || '',
          r.pausa_min,
          r.horas_trabajadas != null ? r.horas_trabajadas.toFixed(2) : '',
          csvEsc(r.incidencias.join('; ')),
        ].join(','));
      }
    }
    const csv = filas.join('\n');
    const generadoEn = new Date().toISOString();
    const meta = {
      property_id: PROPERTY_ID, sociedad: property.sociedad || {},
      empleado: empleadoId ? empleados[0] : null,
      desde, hasta, generado_por: generadoPor, generado_en: generadoEn,
    };
    const hash = sha256(contenidoCanonico(meta, todos));
    await registrarExport(empleadoId, desde, hasta, 'csv', generadoPor, hash);

    const nombreFichero = `inspeccion-${desde}_${hasta}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero}"`);
    res.send('﻿' + csv);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar el CSV' });
  }
});

// ─── Registro de auditoría de exportaciones (trazabilidad) ───
app.get('/api/export_log', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT x.id, x.generado_por, x.empleado_id, e.nombre, e.apellidos, x.desde, x.hasta, x.formato, x.ts, x.hash
       FROM export_log x LEFT JOIN empleado e ON e.id = x.empleado_id
       WHERE x.property_id = $1 ORDER BY x.ts DESC LIMIT 100`,
      [PROPERTY_ID]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer el registro de exportaciones' });
  }
});

// ─── Política de retención (documentada, NO ejecutada automáticamente) ───
// Los fichajes son la fuente del registro de jornada legal y deben
// conservarse un mínimo de 4 años (RD 8/2019). Esta fase NO borra ningún
// fichaje. Plantilla lista pero DESACTIVADA a propósito, por si en el
// futuro se decide limpiar datos con más de 4 años (requiere activación
// manual explícita, revisando antes el impacto; no hay cron programado):
//
// async function limpiarFichajesAntiguos() {
//   return pool.query(
//     "DELETE FROM fichaje WHERE property_id = $1 AND ts < (now() - interval '4 years')",
//     [PROPERTY_ID]
//   );
// }

// ═══════════════════════════════════════════════════════════════════
// FASE 4 — Informes: horas, coste y "días sin fichaje" por empleado,
// departamento y propiedad, comparativa entre periodos, exportación
// PDF/CSV y envío por correo.
//
// REUTILIZA el cálculo de jornada de la Fase 3 (calcularInspeccion +
// totalizar) — no se duplica ninguna lógica de horas: aquí solo se agrega.
//
// "Días sin fichaje": como todavía no hay cuadrantes/turnos previstos, NO
// se puede calcular una ausencia real contra un horario teórico. Se
// reporta, de forma honesta, el nº de días DENTRO del periodo consultado
// en los que un empleado ACTUALMENTE ACTIVO (y ya dado de alta) no tiene
// NINGÚN fichaje. Esto no es una ausencia justificada ni injustificada:
// es literalmente "no hay ningún registro de fichaje ese día". Se etiqueta
// así (nunca como "ausencia") en la API, el PDF, el CSV y el correo.
//
// Coste: `empleado.coste_hora` es OPCIONAL. Si es null, ese empleado se
// muestra como "(coste pendiente)" y se EXCLUYE del total del periodo y
// de cada departamento, dejando constancia en una nota de quién queda
// excluido. Nunca se asume 0 ni se inventa un coste.
//
// Multi-propiedad: todas las consultas ya van filtradas por PROPERTY_ID
// (igual que el resto de fases); si en el futuro esta misma base de datos
// aloja más de una propiedad, "por propiedad" seguirá siendo exactamente
// estos mismos totales para PROPERTY_ID.
// ═══════════════════════════════════════════════════════════════════

function redondear2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Lista de fechas 'YYYY-MM-DD' entre desde y hasta, ambos incluidos.
// Aritmética en UTC para no depender del huso horario del servidor (son
// fechas de calendario, no instantes).
function listaDeDias(desde, hasta) {
  const dias = [];
  let d = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  while (d <= fin) {
    dias.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return dias;
}

// Periodo inmediatamente anterior, con la MISMA duración (en días) que
// [desde,hasta]. P.ej. [2026-08-01,2026-08-11] (11 días) → periodo
// anterior [2026-07-21,2026-07-31].
function periodoAnterior(desde, hasta) {
  const d1 = new Date(`${desde}T00:00:00Z`);
  const d2 = new Date(`${hasta}T00:00:00Z`);
  const durDias = Math.round((d2 - d1) / 86400000) + 1;
  const nuevoHasta = new Date(d1.getTime() - 86400000);
  const nuevoDesde = new Date(nuevoHasta.getTime() - (durDias - 1) * 86400000);
  return { desde: nuevoDesde.toISOString().slice(0, 10), hasta: nuevoHasta.toISOString().slice(0, 10) };
}

// "Días sin fichaje" de UN empleado activo: solo cuenta días dentro del
// solape entre su antigüedad (fecha_alta) y el periodo consultado.
function diasSinFichajeEmpleado(fechaAltaStr, desde, hasta, fechasConFichaje) {
  const efectivoDesde = fechaAltaStr && fechaAltaStr > desde ? fechaAltaStr : desde;
  if (efectivoDesde > hasta) return 0;
  return listaDeDias(efectivoDesde, hasta).filter((d) => !fechasConFichaje.has(d)).length;
}

const NOTA_DIAS_SIN_FICHAJE = 'Días DENTRO del periodo, de empleados actualmente activos (y ya dados de alta), sin NINGÚN fichaje. No es una ausencia justificada ni injustificada -no existen cuadrantes/turnos previstos todavía-, es solo la ausencia de registro de fichaje ese día.';
const NOTA_COSTE_PENDIENTE = 'El coste excluye a los empleados sin "coste/hora" asignado en su ficha (aparecen como "(coste pendiente)"); nunca se asume 0 ni se inventa un valor.';
const NOTA_PLAN_B = 'Sin cuadrante asignado: resultado calculado contra jornada estándar configurada (Plan B), no contra un horario específico. Valores de este tipo son estimados.';

// Construye el informe de un periodo (con filtros opcionales de
// departamento/empleado), agregando por empleado y por departamento.
async function construirInformePeriodo(desde, hasta, departamentoId, empleadoId) {
  const cond = ['e.property_id = $1'];
  const params = [PROPERTY_ID];
  if (departamentoId) { params.push(departamentoId); cond.push(`e.departamento_id = $${params.length}`); }
  if (empleadoId) { params.push(empleadoId); cond.push(`e.id = $${params.length}`); }
  const { rows: empleados } = await pool.query(
    `SELECT e.id, e.nombre, e.apellidos, e.activo, e.coste_hora,
            to_char(e.fecha_alta, 'YYYY-MM-DD') AS fecha_alta,
            e.departamento_id, d.nombre AS departamento_nombre
     FROM empleado e LEFT JOIN departamento d ON d.id = e.departamento_id
     WHERE ${cond.join(' AND ')}
     ORDER BY d.nombre NULLS LAST, e.apellidos, e.nombre`,
    params
  );

  // Cálculo de jornadas: EXACTAMENTE la misma función que la Fase 3.
  const porEmpleado = await calcularInspeccion(empleados.map((e) => e.id), desde, hasta);

  const filasEmpleado = empleados.map((e) => {
    const registros = porEmpleado.get(e.id) || [];
    const tot = totalizar(registros); // { dias, horas_totales, dias_con_incidencia } — Fase 3
    const horasMedia = tot.dias > 0 ? redondear2(tot.horas_totales / tot.dias) : 0;
    const costeHora = e.coste_hora != null ? Number(e.coste_hora) : null;
    const costePeriodo = costeHora != null ? redondear2(tot.horas_totales * costeHora) : null;
    const diasSinFichaje = e.activo
      ? diasSinFichajeEmpleado(e.fecha_alta, desde, hasta, new Set(registros.map((r) => r.fecha)))
      : null; // no aplica: solo se reporta de empleados activos

    return {
      id: e.id, nombre: e.nombre, apellidos: e.apellidos, activo: e.activo,
      departamento_id: e.departamento_id, departamento_nombre: e.departamento_nombre || 'Sin departamento',
      dias_trabajados: tot.dias, horas_totales: tot.horas_totales, horas_media: horasMedia,
      dias_con_incidencia: tot.dias_con_incidencia,
      dias_sin_fichaje: diasSinFichaje,
      coste_hora: costeHora, coste_periodo: costePeriodo, coste_pendiente: costeHora == null,
    };
  });

  // ─── Agregación por departamento ───
  const deptMap = new Map();
  for (const f of filasEmpleado) {
    const key = f.departamento_id || 'sin_departamento';
    if (!deptMap.has(key)) {
      deptMap.set(key, {
        departamento_id: f.departamento_id, departamento_nombre: f.departamento_nombre,
        horas_totales: 0, dias_trabajados: 0, dias_con_incidencia: 0, dias_sin_fichaje: 0,
        coste_periodo: 0, coste_pendiente_empleados: [],
      });
    }
    const dep = deptMap.get(key);
    dep.horas_totales += f.horas_totales;
    dep.dias_trabajados += f.dias_trabajados;
    dep.dias_con_incidencia += f.dias_con_incidencia;
    dep.dias_sin_fichaje += f.dias_sin_fichaje || 0;
    if (f.coste_periodo != null) dep.coste_periodo += f.coste_periodo;
    else if (f.horas_totales > 0) dep.coste_pendiente_empleados.push(`${f.apellidos}, ${f.nombre}`);
  }
  const departamentos = [...deptMap.values()]
    .map((dep) => ({
      ...dep,
      horas_totales: redondear2(dep.horas_totales),
      coste_periodo: redondear2(dep.coste_periodo),
      horas_media: dep.dias_trabajados > 0 ? redondear2(dep.horas_totales / dep.dias_trabajados) : 0,
    }))
    .sort((a, b) => a.departamento_nombre.localeCompare(b.departamento_nombre, 'es'));

  // ─── Totales del periodo (según los filtros aplicados) ───
  const horasTotales = redondear2(filasEmpleado.reduce((acc, f) => acc + f.horas_totales, 0));
  const diasTrabajados = filasEmpleado.reduce((acc, f) => acc + f.dias_trabajados, 0);
  const totales = {
    horas_totales: horasTotales,
    horas_media: diasTrabajados > 0 ? redondear2(horasTotales / diasTrabajados) : 0,
    dias_trabajados: diasTrabajados,
    dias_con_incidencia: filasEmpleado.reduce((acc, f) => acc + f.dias_con_incidencia, 0),
    dias_sin_fichaje: filasEmpleado.reduce((acc, f) => acc + (f.dias_sin_fichaje || 0), 0),
    empleados_activos_evaluados: filasEmpleado.filter((f) => f.dias_sin_fichaje != null).length,
    coste_periodo: redondear2(filasEmpleado.reduce((acc, f) => acc + (f.coste_periodo || 0), 0)),
    coste_pendiente_empleados: filasEmpleado.filter((f) => f.coste_pendiente && f.horas_totales > 0).map((f) => `${f.apellidos}, ${f.nombre}`),
    nota_dias_sin_fichaje: NOTA_DIAS_SIN_FICHAJE,
    nota_coste: NOTA_COSTE_PENDIENTE,
  };

  return {
    desde, hasta, property_id: PROPERTY_ID, property_nombre: PROPERTY_NAME,
    empleados: filasEmpleado, departamentos, totales,
  };
}

// ─── Sello de integridad del informe (mismo patrón que la Fase 3) ───
function contenidoCanonicoInforme(meta, informe) {
  return JSON.stringify({
    property_id: informe.property_id, sociedad: meta.sociedad, filtro: meta.filtro,
    desde: informe.desde, hasta: informe.hasta,
    generado_por: meta.generado_por, generado_en: meta.generado_en,
    empleados: informe.empleados.map((e) => ({
      id: e.id, horas_totales: e.horas_totales, dias_trabajados: e.dias_trabajados,
      dias_con_incidencia: e.dias_con_incidencia, dias_sin_fichaje: e.dias_sin_fichaje,
      coste_periodo: e.coste_periodo,
    })),
  });
}

// ─── Contenido del PDF (reutilizado tanto en la descarga directa como en
// el adjunto del correo, para no duplicar el layout) ───
function escribirInformePDF(doc, informe, meta, comparativa) {
  const sociedad = property.sociedad || {};
  doc.fontSize(14).text(sociedad.razon_social || '(dato pendiente)');
  doc.fontSize(9).fillColor('#555')
    .text(`CIF: ${sociedad.cif || '(dato pendiente)'}    Domicilio: ${sociedad.domicilio || '(dato pendiente)'}`)
    .text(`Propiedad: ${informe.property_nombre}`)
    .moveDown(0.5);
  doc.fillColor('#000').fontSize(13).text('Informe de Personal', { underline: true }).moveDown(0.3);
  doc.fontSize(10).text(`Periodo: ${informe.desde} a ${informe.hasta}`).text(meta.filtro_texto).moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(11).text('Totales del periodo').moveDown(0.2);
  doc.font('Helvetica').fontSize(9.5);
  doc.text(`Horas totales: ${informe.totales.horas_totales.toFixed(2)} h    Media por jornada trabajada: ${informe.totales.horas_media.toFixed(2)} h`);
  doc.text(`Días trabajados (jornadas): ${informe.totales.dias_trabajados}    Jornadas con incidencia: ${informe.totales.dias_con_incidencia}`);
  doc.text(`Días sin ningún fichaje: ${informe.totales.dias_sin_fichaje}`, { continued: false });
  doc.fontSize(7.5).fillColor('#666').text(informe.totales.nota_dias_sin_fichaje, { width: 515 }).fillColor('#000').fontSize(9.5);
  const costeLinea = informe.totales.coste_pendiente_empleados.length
    ? `Coste del periodo: ${informe.totales.coste_periodo.toFixed(2)} € (excluye, por coste/hora pendiente: ${informe.totales.coste_pendiente_empleados.join(', ')})`
    : `Coste del periodo: ${informe.totales.coste_periodo.toFixed(2)} €`;
  doc.text(costeLinea, { width: 515 });
  doc.moveDown(0.4);

  if (comparativa) {
    doc.font('Helvetica-Bold').fontSize(10).text('Comparativa con el periodo anterior').moveDown(0.15);
    doc.font('Helvetica').fontSize(9.5).text(
      `Periodo anterior (${comparativa.periodo_anterior.desde} a ${comparativa.periodo_anterior.hasta}): ${comparativa.periodo_anterior.horas_totales.toFixed(2)} h. ` +
      `Variación: ${comparativa.variacion_horas >= 0 ? '+' : ''}${comparativa.variacion_horas.toFixed(2)} h` +
      (comparativa.variacion_pct != null ? ` (${comparativa.variacion_pct >= 0 ? '+' : ''}${comparativa.variacion_pct.toFixed(1)}%)` : ' (sin base para calcular %)')
    );
    doc.moveDown(0.4);
  }

  doc.font('Helvetica-Bold').fontSize(10).text('Por departamento').moveDown(0.2);
  let y = doc.y;
  const colD = [40, 210, 275, 335, 400, 470];
  const anchoD = [165, 60, 55, 60, 65, 85];
  doc.font('Helvetica-Bold').fontSize(8.5);
  ['Departamento', 'Horas', 'Días', 'Incid.', 'S/fichaje', 'Coste (€)'].forEach((c, i) => doc.text(c, colD[i], y, { width: anchoD[i] }));
  y += 14;
  doc.moveTo(40, y - 3).lineTo(555, y - 3).strokeColor('#ccc').stroke();
  doc.font('Helvetica').fontSize(8.5);
  for (const dep of informe.departamentos) {
    if (y > 740) { doc.addPage(); y = 40; }
    const fila = [
      dep.departamento_nombre, dep.horas_totales.toFixed(2), String(dep.dias_trabajados),
      String(dep.dias_con_incidencia), String(dep.dias_sin_fichaje),
      dep.coste_pendiente_empleados.length ? `${dep.coste_periodo.toFixed(2)} *` : dep.coste_periodo.toFixed(2),
    ];
    fila.forEach((v, i) => doc.text(v, colD[i], y, { width: anchoD[i] }));
    y += 14;
  }
  y += 4;
  doc.fontSize(7).fillColor('#666').text('* Excluye empleados con coste/hora pendiente en ese departamento.', 40, y);
  y += 18;

  if (y > 700) { doc.addPage(); y = 40; }
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text('Por empleado', 40, y);
  y += 16;
  const colE = [40, 170, 240, 285, 325, 365, 415, 465];
  const anchoE = [130, 68, 42, 38, 38, 48, 48, 85];
  doc.font('Helvetica-Bold').fontSize(8);
  ['Empleado', 'Depto.', 'Horas', 'Media', 'Días', 'Incid.', 'S/fich.', 'Coste'].forEach((c, i) => doc.text(c, colE[i], y, { width: anchoE[i] }));
  y += 13;
  doc.moveTo(40, y - 3).lineTo(555, y - 3).strokeColor('#ccc').stroke();
  doc.font('Helvetica').fontSize(8);
  for (const emp of informe.empleados) {
    if (y > 750) { doc.addPage(); y = 40; }
    const fila = [
      `${emp.apellidos}, ${emp.nombre}`, emp.departamento_nombre,
      emp.horas_totales.toFixed(2), emp.horas_media.toFixed(2), String(emp.dias_trabajados),
      String(emp.dias_con_incidencia), emp.dias_sin_fichaje != null ? String(emp.dias_sin_fichaje) : '—',
      emp.coste_periodo != null ? `${emp.coste_periodo.toFixed(2)} €` : '(coste pendiente)',
    ];
    fila.forEach((v, i) => doc.text(v, colE[i], y, { width: anchoE[i] }));
    y += 13;
  }

  doc.fontSize(7).fillColor('#666').text(
    `Generado el ${new Date(meta.generado_en).toLocaleString('es-ES', { timeZone: property.timezone || 'Europe/Madrid' })} por ${meta.generado_por}. ` +
    `Sello de integridad (SHA-256): ${meta.hash}. Este sello es una garantía de integridad del contenido, no una firma electrónica cualificada.`,
    40, 795, { width: 515 }
  );
}

function generarInformePDFBuffer(informe, meta, comparativa) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    escribirInformePDF(doc, informe, meta, comparativa);
    doc.end();
  });
}

function filtroTextoInforme(departamentoId, empleadoId, empleadoNombre) {
  if (empleadoId) return `Empleado: ${empleadoNombre || `id ${empleadoId}`}`;
  if (departamentoId) return `Departamento id ${departamentoId}`;
  return 'Todos los empleados y departamentos';
}

// ─── Vista de informes (admin): agregado + comparativa opcional ───
app.get('/api/informes', async (req, res) => {
  const desde = req.query.desde;
  const hasta = req.query.hasta;
  const errFecha = validarRangoFechas(desde, hasta);
  if (errFecha) return res.status(400).json({ error: errFecha });
  const departamentoId = req.query.departamento_id || null;
  const empleadoId = req.query.empleado_id || null;
  try {
    const informe = await construirInformePeriodo(desde, hasta, departamentoId, empleadoId);
    let comparativa = null;
    if (req.query.comparar === 'true' || (req.query.desde2 && req.query.hasta2)) {
      let periodo2 = { desde: req.query.desde2, hasta: req.query.hasta2 };
      if (!periodo2.desde || !periodo2.hasta) periodo2 = periodoAnterior(desde, hasta);
      const errFecha2 = validarRangoFechas(periodo2.desde, periodo2.hasta);
      if (errFecha2) return res.status(400).json({ error: `Periodo de comparación: ${errFecha2}` });
      const informe2 = await construirInformePeriodo(periodo2.desde, periodo2.hasta, departamentoId, empleadoId);
      const variacion = redondear2(informe.totales.horas_totales - informe2.totales.horas_totales);
      comparativa = {
        periodo_anterior: { desde: periodo2.desde, hasta: periodo2.hasta, horas_totales: informe2.totales.horas_totales },
        variacion_horas: variacion,
        variacion_pct: informe2.totales.horas_totales !== 0 ? redondear2((variacion / informe2.totales.horas_totales) * 100) : null,
      };
    }
    res.json({ ...informe, comparativa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular el informe' });
  }
});

// ─── Exportación PDF del informe (con sello de integridad) ───
app.get('/api/informes/pdf', async (req, res) => {
  const desde = req.query.desde;
  const hasta = req.query.hasta;
  const errFecha = validarRangoFechas(desde, hasta);
  if (errFecha) return res.status(400).json({ error: errFecha });
  const departamentoId = req.query.departamento_id || null;
  const empleadoId = req.query.empleado_id || null;
  try {
    const informe = await construirInformePeriodo(desde, hasta, departamentoId, empleadoId);
    let comparativa = null;
    if (req.query.comparar === 'true') {
      const periodo2 = periodoAnterior(desde, hasta);
      const informe2 = await construirInformePeriodo(periodo2.desde, periodo2.hasta, departamentoId, empleadoId);
      const variacion = redondear2(informe.totales.horas_totales - informe2.totales.horas_totales);
      comparativa = {
        periodo_anterior: { desde: periodo2.desde, hasta: periodo2.hasta, horas_totales: informe2.totales.horas_totales },
        variacion_horas: variacion,
        variacion_pct: informe2.totales.horas_totales !== 0 ? redondear2((variacion / informe2.totales.horas_totales) * 100) : null,
      };
    }
    const generadoPor = req.session.user.login;
    const generadoEn = new Date().toISOString();
    const empNombre = empleadoId ? informe.empleados[0] && `${informe.empleados[0].apellidos}, ${informe.empleados[0].nombre}` : null;
    const meta = {
      sociedad: property.sociedad || {}, filtro: { departamentoId, empleadoId },
      filtro_texto: filtroTextoInforme(departamentoId, empleadoId, empNombre),
      generado_por: generadoPor, generado_en: generadoEn,
    };
    const hash = sha256(contenidoCanonicoInforme(meta, informe));
    meta.hash = hash;
    await registrarExport(empleadoId ? parseInt(empleadoId, 10) : null, desde, hasta, 'informe_pdf', generadoPor, hash);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const nombreFichero = `informe-personal-${desde}_${hasta}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero}"`);
    doc.pipe(res);
    escribirInformePDF(doc, informe, meta, comparativa);
    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar el PDF del informe' });
  }
});

// ─── Exportación CSV del informe (filas por empleado + totales por
// departamento + total del periodo, todo en el mismo fichero) ───
app.get('/api/informes/csv', async (req, res) => {
  const desde = req.query.desde;
  const hasta = req.query.hasta;
  const errFecha = validarRangoFechas(desde, hasta);
  if (errFecha) return res.status(400).json({ error: errFecha });
  const departamentoId = req.query.departamento_id || null;
  const empleadoId = req.query.empleado_id || null;
  try {
    const informe = await construirInformePeriodo(desde, hasta, departamentoId, empleadoId);
    const generadoPor = req.session.user.login;
    const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const filas = ['empleado,departamento,horas_totales,horas_media,dias_trabajados,dias_con_incidencia,dias_sin_fichaje,coste_hora,coste_periodo'];
    for (const e of informe.empleados) {
      filas.push([
        csvEsc(`${e.apellidos}, ${e.nombre}`), csvEsc(e.departamento_nombre),
        e.horas_totales.toFixed(2), e.horas_media.toFixed(2), e.dias_trabajados, e.dias_con_incidencia,
        e.dias_sin_fichaje != null ? e.dias_sin_fichaje : '',
        e.coste_hora != null ? e.coste_hora.toFixed(2) : '',
        e.coste_periodo != null ? e.coste_periodo.toFixed(2) : 'PENDIENTE',
      ].join(','));
    }
    filas.push('');
    filas.push(csvEsc(`--- Totales por departamento (${informe.desde} a ${informe.hasta}) ---`));
    filas.push('departamento,horas_totales,horas_media,dias_trabajados,dias_con_incidencia,dias_sin_fichaje,coste_periodo,nota');
    for (const dep of informe.departamentos) {
      filas.push([
        csvEsc(dep.departamento_nombre), dep.horas_totales.toFixed(2), dep.horas_media.toFixed(2),
        dep.dias_trabajados, dep.dias_con_incidencia, dep.dias_sin_fichaje, dep.coste_periodo.toFixed(2),
        csvEsc(dep.coste_pendiente_empleados.length ? `Coste pendiente excluido de: ${dep.coste_pendiente_empleados.join('; ')}` : ''),
      ].join(','));
    }
    filas.push('');
    filas.push(csvEsc(`--- Total del periodo (propiedad: ${informe.property_nombre}) ---`));
    filas.push('horas_totales,horas_media,dias_trabajados,dias_con_incidencia,dias_sin_fichaje,coste_periodo,nota_dias_sin_fichaje,nota_coste');
    filas.push([
      informe.totales.horas_totales.toFixed(2), informe.totales.horas_media.toFixed(2),
      informe.totales.dias_trabajados, informe.totales.dias_con_incidencia, informe.totales.dias_sin_fichaje,
      informe.totales.coste_periodo.toFixed(2),
      csvEsc(informe.totales.nota_dias_sin_fichaje),
      csvEsc(informe.totales.coste_pendiente_empleados.length ? `${informe.totales.nota_coste} Excluidos: ${informe.totales.coste_pendiente_empleados.join('; ')}` : informe.totales.nota_coste),
    ].join(','));

    const csv = filas.join('\n');
    const generadoEn = new Date().toISOString();
    const meta = {
      sociedad: property.sociedad || {}, filtro: { departamentoId, empleadoId },
      generado_por: generadoPor, generado_en: generadoEn,
    };
    const hash = sha256(contenidoCanonicoInforme(meta, informe));
    await registrarExport(empleadoId ? parseInt(empleadoId, 10) : null, desde, hasta, 'informe_csv', generadoPor, hash);

    const nombreFichero = `informe-personal-${desde}_${hasta}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero}"`);
    res.send('﻿' + csv);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar el CSV del informe' });
  }
});

// ─── Envío del informe por correo (gate SEND_MODE) ───
// El destinatario NUNCA lo elige la llamada: siempre es NOTIFY_EMAIL (evita
// que alguien con acceso al panel reenvíe datos de personal a cualquier
// dirección). En modo 'test' (por defecto) NO se envía nada real: se anota
// en logs/mail-test.log. Cualquier otro valor de SEND_MODE intenta el envío
// real vía SMTP_* (nodemailer); si falta SMTP_HOST, se informa el error en
// vez de fallar en silencio.
async function enviarInformePorCorreo(desde, hasta, departamentoId, empleadoId, generadoPor) {
  const informe = await construirInformePeriodo(desde, hasta, departamentoId, empleadoId);
  const periodo2 = periodoAnterior(desde, hasta);
  const informe2 = await construirInformePeriodo(periodo2.desde, periodo2.hasta, departamentoId, empleadoId);
  const variacion = redondear2(informe.totales.horas_totales - informe2.totales.horas_totales);
  const comparativa = {
    periodo_anterior: { desde: periodo2.desde, hasta: periodo2.hasta, horas_totales: informe2.totales.horas_totales },
    variacion_horas: variacion,
    variacion_pct: informe2.totales.horas_totales !== 0 ? redondear2((variacion / informe2.totales.horas_totales) * 100) : null,
  };

  const generadoEn = new Date().toISOString();
  const empNombre = empleadoId ? informe.empleados[0] && `${informe.empleados[0].apellidos}, ${informe.empleados[0].nombre}` : null;
  const meta = {
    sociedad: property.sociedad || {}, filtro: { departamentoId, empleadoId },
    filtro_texto: filtroTextoInforme(departamentoId, empleadoId, empNombre),
    generado_por: generadoPor, generado_en: generadoEn,
  };
  const hash = sha256(contenidoCanonicoInforme(meta, informe));
  meta.hash = hash;
  await registrarExport(empleadoId ? parseInt(empleadoId, 10) : null, desde, hasta, 'informe_pdf', generadoPor, hash);

  const pdfBuffer = await generarInformePDFBuffer(informe, meta, comparativa);

  const asunto = `Informe de Personal — ${PROPERTY_NAME} (${desde} a ${hasta})`;
  const pendienteTxt = informe.totales.coste_pendiente_empleados.length
    ? `\nCoste pendiente (excluido del total anterior): ${informe.totales.coste_pendiente_empleados.join(', ')}.`
    : '';
  const cuerpo = `Informe de Personal - ${PROPERTY_NAME}\nPeriodo: ${desde} a ${hasta}\n\n` +
    `Horas totales: ${informe.totales.horas_totales.toFixed(2)} h\n` +
    `Media por jornada trabajada: ${informe.totales.horas_media.toFixed(2)} h\n` +
    `Dias trabajados (jornadas): ${informe.totales.dias_trabajados}\n` +
    `Jornadas con incidencia: ${informe.totales.dias_con_incidencia}\n` +
    `Dias sin ningun fichaje (empleados activos; NO es ausencia justificada/injustificada): ${informe.totales.dias_sin_fichaje}\n` +
    `Coste del periodo: ${informe.totales.coste_periodo.toFixed(2)} EUR${pendienteTxt}\n\n` +
    `Comparativa con el periodo anterior (${comparativa.periodo_anterior.desde} a ${comparativa.periodo_anterior.hasta}): ` +
    `${comparativa.periodo_anterior.horas_totales.toFixed(2)} h -> variacion ${comparativa.variacion_horas >= 0 ? '+' : ''}${comparativa.variacion_horas.toFixed(2)} h` +
    (comparativa.variacion_pct != null ? ` (${comparativa.variacion_pct >= 0 ? '+' : ''}${comparativa.variacion_pct.toFixed(1)}%)` : '') + '\n\n' +
    `Se adjunta el informe completo en PDF. Sello de integridad (SHA-256): ${hash}.`;

  const destinatario = NOTIFY_EMAIL;
  if (!destinatario) throw new Error('Falta NOTIFY_EMAIL en el .env: no hay destinatario configurado para el envío de informes');

  if (SEND_MODE === 'test') {
    const linea = `[${new Date().toISOString()}] MODO TEST (SEND_MODE=test) — NO se ha enviado ningún correo real.\n` +
      `Destinatario: ${destinatario}\nAsunto: ${asunto}\n${cuerpo}\n${'-'.repeat(60)}\n`;
    fs.appendFileSync(path.join(LOGS_DIR, 'mail-test.log'), linea);
    return { modo: 'test', destinatario, asunto };
  }

  if (!SMTP_HOST) {
    throw new Error('SEND_MODE no es "test" pero falta SMTP_HOST en el .env: configura el SMTP antes de enviar en real');
  }
  const transportador = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
  });
  await transportador.sendMail({
    from: SMTP_USER || destinatario, to: destinatario, subject: asunto, text: cuerpo,
    attachments: [{ filename: `informe-personal-${desde}_${hasta}.pdf`, content: pdfBuffer }],
  });
  return { modo: 'real', destinatario, asunto };
}

app.post('/api/informes/enviar', async (req, res) => {
  const desde = req.body.desde;
  const hasta = req.body.hasta;
  const errFecha = validarRangoFechas(desde, hasta);
  if (errFecha) return res.status(400).json({ error: errFecha });
  const departamentoId = req.body.departamento_id || null;
  const empleadoId = req.body.empleado_id || null;
  try {
    const resultado = await enviarInformePorCorreo(desde, hasta, departamentoId, empleadoId, req.session.user.login);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al enviar el informe por correo' });
  }
});

// ─── Informe periódico automático (PREPARADO, NO ACTIVADO) ───
// Para activar un envío periódico (p.ej. el día 1 de cada mes a las 07:00,
// con el informe del mes anterior completo) sin tocar código:
//  1) Revisar en .env: SEND_MODE=production (o el valor real que se use) y
//     SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD ya configurados y
//     probados (primero en SEND_MODE=test).
//  2) Añadir una tarea programada (cron o systemd timer) que llame a este
//     mismo endpoint autenticado, con el primer y último día del mes
//     anterior. Ejemplo de cron (requiere una sesión/cookie de admin o,
//     mejor, exponer una pequeña variante interna del endpoint protegida
//     por un token de servicio en vez del login de sesión):
//       5 7 1 * *  curl -s -X POST http://127.0.0.1:3096/api/informes/enviar \
//         -H "Content-Type: application/json" \
//         -d "{\"desde\":\"<primer día mes anterior>\",\"hasta\":\"<último día mes anterior>\"}"
//  3) NO se ha creado ningún cron/timer todavía: esta fase deja la lógica
//     de envío lista y probada en modo test, pero la periodicidad requiere
//     una decisión y activación explícitas.

// ═══════════════════════════════════════════════════════════════════
// FASE 5 — Motivación.
// Todo se muestra en el QUIOSCO (Fase 2), nunca por otro canal.
//
// 1) Mensaje motivacional del día por departamento: rotación determinista
//    por día del año (índice = día_del_año % nº mensajes activos), así es
//    ESTABLE durante todo el día y cambia cada día. Si el departamento no
//    tiene mensajes propios activos, se usan los globales (departamento_id
//    NULL). Si tampoco hay globales, no se muestra nada (nunca se inventa).
//
// 2) Cumpleaños y 3) Aniversario de antigüedad: se calculan en caliente a
//    partir de empleado.fecha_nacimiento / empleado.fecha_alta comparando
//    solo MES-DÍA con el día de hoy (huso horario de la propiedad). NO se
//    guardan en tabla propia (misma filosofía que Fases 3-4).
//
// PRIVACIDAD (requisito explícito): el quiosco NUNCA expone edad ni año de
// nacimiento de nadie. Solo se usa el nombre de pila (campo `nombre`, ya
// separado de `apellidos` en el esquema) y, en aniversarios, los años de
// antigüedad en la empresa (dato que SÍ se pide mostrar).
// ═══════════════════════════════════════════════════════════════════

function hoyEnZona(tz) {
  // 'en-CA' devuelve YYYY-MM-DD (mismo truco que fechaEnZona/horaEnZona de la Fase 3).
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

function diaDelAnioEnZona(tz) {
  const hoy = hoyEnZona(tz); // YYYY-MM-DD
  const inicioAnio = `${hoy.slice(0, 4)}-01-01`;
  const ms = new Date(`${hoy}T00:00:00Z`) - new Date(`${inicioAnio}T00:00:00Z`);
  return Math.floor(ms / 86400000) + 1; // 1 de enero = día 1
}

// Mensaje "del día" para un departamento (o global si departamentoId es null
// o no tiene mensajes propios activos). Devuelve el texto o null.
async function mensajeMotivacionalDelDia(departamentoId) {
  const tz = property.timezone || 'Europe/Madrid';
  let rows = [];
  if (departamentoId) {
    const r = await pool.query(
      `SELECT texto FROM mensaje_motivacional
       WHERE property_id = $1 AND activo = true AND departamento_id = $2
       ORDER BY id`,
      [PROPERTY_ID, departamentoId]
    );
    rows = r.rows;
  }
  if (!rows.length) {
    const r = await pool.query(
      `SELECT texto FROM mensaje_motivacional
       WHERE property_id = $1 AND activo = true AND departamento_id IS NULL
       ORDER BY id`,
      [PROPERTY_ID]
    );
    rows = r.rows;
  }
  if (!rows.length) return null;
  const idx = diaDelAnioEnZona(tz) % rows.length;
  return rows[idx].texto;
}

// Cumpleaños y aniversarios de HOY entre los empleados ACTIVOS de la
// propiedad. Los años de aniversario se calculan íntegramente en SQL
// (EXTRACT(YEAR ...)) para no depender de cómo el driver parsea DATE.
async function especialesDeHoy() {
  const tz = property.timezone || 'Europe/Madrid';
  const hoy = hoyEnZona(tz); // YYYY-MM-DD
  const hoyMD = hoy.slice(5); // MM-DD
  const anioActual = parseInt(hoy.slice(0, 4), 10);

  const { rows: cumples } = await pool.query(
    `SELECT id, nombre FROM empleado
     WHERE property_id = $1 AND activo = true AND fecha_nacimiento IS NOT NULL
       AND to_char(fecha_nacimiento, 'MM-DD') = $2`,
    [PROPERTY_ID, hoyMD]
  );

  const { rows: altas } = await pool.query(
    `SELECT id, nombre, EXTRACT(YEAR FROM fecha_alta)::int AS anio_alta FROM empleado
     WHERE property_id = $1 AND activo = true
       AND to_char(fecha_alta, 'MM-DD') = $2`,
    [PROPERTY_ID, hoyMD]
  );
  // N==0 (menos de un año) no cuenta como aniversario.
  const aniversarios = altas
    .map((e) => ({ id: e.id, nombre: e.nombre, anios: anioActual - e.anio_alta }))
    .filter((e) => e.anios >= 1);

  return { cumples, aniversarios };
}

// Payload de motivación para UN empleado que acaba de fichar: distingue
// entre "es él/ella quien cumple" (felicitación personal) y "es un
// compañero/a" (aviso, sin edad). Se combina con el mensaje del día.
async function datosMotivacion(empleadoId, departamentoId) {
  const { cumples, aniversarios } = await especialesDeHoy();
  const propioCumple = cumples.find((e) => e.id === empleadoId);
  const propioAniversario = aniversarios.find((e) => e.id === empleadoId);
  const avisos = [];
  cumples
    .filter((e) => e.id !== empleadoId)
    .forEach((e) => avisos.push({ tipo: 'cumpleanos', nombre: e.nombre }));
  aniversarios
    .filter((e) => e.id !== empleadoId)
    .forEach((e) => avisos.push({ tipo: 'aniversario', nombre: e.nombre, anios: e.anios }));

  return {
    mensaje_dia: await mensajeMotivacionalDelDia(departamentoId),
    cumpleanos_propio: !!propioCumple,
    aniversario_propio: propioAniversario ? { anios: propioAniversario.anios } : null,
    avisos,
  };
}

// ─── Quiosco: pantalla de reposo ("cartelera") — Fase 5, opcional ───
// Cuando nadie está fichando, el quiosco puede mostrar en bucle los avisos
// del día (cumpleaños/aniversarios, sin edad, solo nombre de pila) y un
// mensaje motivacional GLOBAL (no hay empleado concreto en reposo, así que
// no aplica la rotación por departamento). requireKiosk: misma puerta que
// el resto de la API del quiosco.
app.get('/api/quiosco/cartelera', requireKiosk, async (req, res) => {
  try {
    const { cumples, aniversarios } = await especialesDeHoy();
    const avisos = [
      ...cumples.map((e) => ({ tipo: 'cumpleanos', nombre: e.nombre })),
      ...aniversarios.map((e) => ({ tipo: 'aniversario', nombre: e.nombre, anios: e.anios })),
    ];
    const mensaje = await mensajeMotivacionalDelDia(null);
    res.json({ avisos, mensaje });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular la cartelera' });
  }
});

// ─── Admin: CRUD de mensajes motivacionales (pestaña "Motivación") ───
app.get('/api/mensajes-motivacionales', async (req, res) => {
  try {
    const cond = ['m.property_id = $1'];
    const params = [PROPERTY_ID];
    if (req.query.departamento_id) {
      params.push(req.query.departamento_id);
      cond.push(`m.departamento_id = $${params.length}`);
    }
    if (req.query.activo === 'true' || req.query.activo === 'false') {
      params.push(req.query.activo === 'true');
      cond.push(`m.activo = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT m.id, m.departamento_id, d.nombre AS departamento_nombre, m.texto, m.activo, m.creado_en
       FROM mensaje_motivacional m LEFT JOIN departamento d ON d.id = m.departamento_id
       WHERE ${cond.join(' AND ')}
       ORDER BY (m.departamento_id IS NULL) DESC, d.nombre, m.id`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer los mensajes motivacionales' });
  }
});

app.post('/api/mensajes-motivacionales', async (req, res) => {
  const texto = (req.body.texto || '').trim();
  const departamentoId = req.body.departamento_id || null;
  const activo = req.body.activo === undefined ? true : !!req.body.activo;
  if (!texto) return res.status(400).json({ error: 'El texto del mensaje es obligatorio' });
  if (!(await departamentoValido(departamentoId))) {
    return res.status(400).json({ error: 'Departamento no válido' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO mensaje_motivacional(property_id, departamento_id, texto, activo)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [PROPERTY_ID, departamentoId, texto, activo]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el mensaje motivacional' });
  }
});

app.put('/api/mensajes-motivacionales/:id', async (req, res) => {
  const texto = (req.body.texto || '').trim();
  const departamentoId = req.body.departamento_id || null;
  const activo = req.body.activo === undefined ? true : !!req.body.activo;
  if (!texto) return res.status(400).json({ error: 'El texto del mensaje es obligatorio' });
  if (!(await departamentoValido(departamentoId))) {
    return res.status(400).json({ error: 'Departamento no válido' });
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE mensaje_motivacional SET departamento_id = $1, texto = $2, activo = $3
       WHERE id = $4 AND property_id = $5`,
      [departamentoId, texto, activo, req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Mensaje no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el mensaje motivacional' });
  }
});

app.delete('/api/mensajes-motivacionales/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM mensaje_motivacional WHERE id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Mensaje no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar el mensaje motivacional' });
  }
});

// ─── Admin: cumpleaños y aniversarios del mes (vista para RRHH/recepción) ───
// Devuelve, para el mes indicado (por defecto el mes actual en el huso de
// la propiedad), los empleados ACTIVOS cuyo cumpleaños o aniversario de
// antigüedad caen en ese mes. Vista de panel admin: aquí SÍ se identifica
// al empleado por nombre y apellidos (el admin ya ve fecha_nacimiento en su
// ficha); esta vista no expone la edad, solo el día del mes.
app.get('/api/motivacion/mes', async (req, res) => {
  try {
    const tz = property.timezone || 'Europe/Madrid';
    const mesParam = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoyEnZona(tz).slice(0, 7);
    const mesNum = mesParam.slice(5, 7);
    const anioMes = parseInt(mesParam.slice(0, 4), 10);

    const { rows: cumpleanos } = await pool.query(
      `SELECT id, nombre, apellidos, to_char(fecha_nacimiento, 'DD') AS dia
       FROM empleado
       WHERE property_id = $1 AND activo = true AND fecha_nacimiento IS NOT NULL
         AND to_char(fecha_nacimiento, 'MM') = $2
       ORDER BY dia`,
      [PROPERTY_ID, mesNum]
    );

    const { rows: altas } = await pool.query(
      `SELECT id, nombre, apellidos, to_char(fecha_alta, 'DD') AS dia, EXTRACT(YEAR FROM fecha_alta)::int AS anio_alta
       FROM empleado
       WHERE property_id = $1 AND activo = true AND to_char(fecha_alta, 'MM') = $2
       ORDER BY dia`,
      [PROPERTY_ID, mesNum]
    );
    const aniversarios = altas
      .map((e) => ({ id: e.id, nombre: e.nombre, apellidos: e.apellidos, dia: e.dia, anios: anioMes - e.anio_alta }))
      .filter((e) => e.anios >= 1);

    res.json({ mes: mesParam, cumpleanos, aniversarios });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular cumpleaños y aniversarios del mes' });
  }
});

// ─── Admin: generar enlace de autorización del quiosco ────────────────
// Endpoint para que el admin genere un enlace que pueda compartir con alguien
// que vaya a configurar una tablet/kiosco de fichaje.
// POST /api/admin/kiosk-link → { link: "https://..." }
app.post('/api/admin/kiosk-link', (req, res) => {
  if (!req.session?.user || !['admin', 'superadmin'].includes(req.session.user.rol)) {
    return res.status(403).json({ error: 'Acceso restringido a admin/superadmin' });
  }
  if (!KIOSK_KEY) {
    return res.status(503).json({ error: 'Quiosco no configurado en servidor (falta KIOSK_KEY)' });
  }
  const baseUrl = (process.env.PUBLIC_BASE_URL || `https://gestion.hoteladariavera.com`).replace(/\/+$/, '');
  const link = `${baseUrl}${BASE_PATH}/quiosco?key=${encodeURIComponent(KIOSK_KEY)}`;
  res.json({ link, info: 'Comparte este enlace con el dispositivo para configurar como quiosco de fichaje' });
});

// ═══════════════════════════════════════════════════════════════════
// FASE 6 — Turnos y Cuadrantes
// turno_config: catálogo de turnos por propiedad (código, horario previsto,
// tolerancias). Nunca se borra físicamente (solo activo=false) porque
// cuadrante ya planificado/histórico referencia su id.
// cuadrante: qué turno le toca a cada empleado cada día. Es planificación,
// NO registro legal de jornada (eso sigue siendo `fichaje`): por eso aquí
// SÍ se permite el borrado físico.
// Importación CSV: se valida en un paso separado (/import/validar) sin
// escribir nada en BD, y solo se aplica en /import/confirmar, dentro de
// una transacción. La validación se guarda en sesión indexada por el hash
// SHA-256 del fichero, así el confirmar comprueba que el CSV no cambió
// entre medias (y no hace falta reenviar/re-parsear el fichero completo).
// ═══════════════════════════════════════════════════════════════════
const TIPOS_TURNO = ['trabajo', 'libre', 'vacaciones', 'baja', 'otros'];
const uploadCsvMemoria = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, de sobra para un CSV de cuadrante
});

// ─── Turnos (catálogo) ───

app.get('/api/turnos', ensureAdmin, async (req, res) => {
  try {
    const cond = ['property_id = $1'];
    const params = [PROPERTY_ID];
    if (req.query.activo === 'true' || req.query.activo === 'false') {
      params.push(req.query.activo === 'true');
      cond.push(`activo = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT * FROM turno_config WHERE ${cond.join(' AND ')} ORDER BY codigo`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer los turnos' });
  }
});

app.post('/api/turnos', ensureAdmin, async (req, res) => {
  const codigo = (req.body.codigo || '').trim();
  const nombre = (req.body.nombre || '').trim();
  const tipo = String(req.body.tipo || '');
  const horaEntrada = req.body.hora_entrada || null;
  const horaSalida = req.body.hora_salida || null;
  const duracionPrevistaMin = req.body.duracion_prevista_min === undefined || req.body.duracion_prevista_min === null || req.body.duracion_prevista_min === ''
    ? null : parseInt(req.body.duracion_prevista_min, 10);
  const turnoNocturno = !!req.body.turno_nocturno;
  const toleranciaEntradaMin = parseInt(req.body.tolerancia_entrada_min, 10) || 0;
  const toleranciaSalidaMin = parseInt(req.body.tolerancia_salida_min, 10) || 0;
  if (!codigo || !nombre || !TIPOS_TURNO.includes(tipo)) {
    return res.status(400).json({ error: 'Código, nombre y tipo son obligatorios (tipo válido: ' + TIPOS_TURNO.join(', ') + ')' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO turno_config(property_id, codigo, nombre, tipo, hora_entrada, hora_salida, duracion_prevista_min, turno_nocturno, tolerancia_entrada_min, tolerancia_salida_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [PROPERTY_ID, codigo, nombre, tipo, horaEntrada, horaSalida, duracionPrevistaMin, turnoNocturno, toleranciaEntradaMin, toleranciaSalidaMin]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Ya existe un turno con código "${codigo}" en esta propiedad` });
    }
    console.error(err);
    res.status(500).json({ error: 'Error al crear el turno' });
  }
});

app.put('/api/turnos/:id', ensureAdmin, async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  const tipo = String(req.body.tipo || '');
  const horaEntrada = req.body.hora_entrada || null;
  const horaSalida = req.body.hora_salida || null;
  const duracionPrevistaMin = req.body.duracion_prevista_min === undefined || req.body.duracion_prevista_min === null || req.body.duracion_prevista_min === ''
    ? null : parseInt(req.body.duracion_prevista_min, 10);
  const turnoNocturno = !!req.body.turno_nocturno;
  const toleranciaEntradaMin = parseInt(req.body.tolerancia_entrada_min, 10) || 0;
  const toleranciaSalidaMin = parseInt(req.body.tolerancia_salida_min, 10) || 0;
  const activo = req.body.activo === undefined ? true : !!req.body.activo;
  if (!nombre || !TIPOS_TURNO.includes(tipo)) {
    return res.status(400).json({ error: 'Nombre y tipo son obligatorios (tipo válido: ' + TIPOS_TURNO.join(', ') + ')' });
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE turno_config SET nombre=$1, tipo=$2, hora_entrada=$3, hora_salida=$4, duracion_prevista_min=$5,
         turno_nocturno=$6, tolerancia_entrada_min=$7, tolerancia_salida_min=$8, activo=$9, actualizado_en=now()
       WHERE id=$10 AND property_id=$11`,
      [nombre, tipo, horaEntrada, horaSalida, duracionPrevistaMin, turnoNocturno, toleranciaEntradaMin, toleranciaSalidaMin, activo, req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Turno no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el turno' });
  }
});

// ─── Cuadrante (planificación por empleado y día) ───

app.get('/api/cuadrante', ensureAdmin, async (req, res) => {
  const desde = req.query.desde;
  const hasta = req.query.hasta;
  if (!desde || !hasta) {
    return res.status(400).json({ error: 'desde y hasta son obligatorios (YYYY-MM-DD)' });
  }
  try {
    const cond = ['c.property_id = $1', 'c.fecha >= $2', 'c.fecha <= $3'];
    const params = [PROPERTY_ID, desde, hasta];
    if (req.query.empleado_id) {
      params.push(req.query.empleado_id);
      cond.push(`c.empleado_id = $${params.length}`);
    }
    if (req.query.departamento_id) {
      params.push(req.query.departamento_id);
      cond.push(`e.departamento_id = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.empleado_id, e.nombre, e.apellidos, e.departamento_id, c.fecha,
              c.turno_config_id, t.codigo AS turno_codigo, t.nombre AS turno_nombre, t.tipo AS turno_tipo,
              c.nota, c.origen, c.creado_por, c.creado_en, c.actualizado_en
       FROM cuadrante c
       JOIN empleado e ON e.id = c.empleado_id
       JOIN turno_config t ON t.id = c.turno_config_id
       WHERE ${cond.join(' AND ')}
       ORDER BY c.fecha, e.apellidos, e.nombre`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer el cuadrante' });
  }
});

app.post('/api/cuadrante', ensureAdmin, async (req, res) => {
  const empleadoId = parseInt(req.body.empleado_id, 10);
  const fecha = req.body.fecha;
  const turnoConfigId = parseInt(req.body.turno_config_id, 10);
  const nota = (req.body.nota || '').trim() || null;
  if (!empleadoId || !fecha || !turnoConfigId) {
    return res.status(400).json({ error: 'empleado_id, fecha y turno_config_id son obligatorios' });
  }
  try {
    if (!(await empleadoDeLaPropiedad(empleadoId))) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }
    const creadoPor = req.session?.user?.login || req.user?.login || req.user?.username || 'admin';
    const { rows } = await pool.query(
      `INSERT INTO cuadrante(property_id, empleado_id, fecha, turno_config_id, nota, creado_por, origen)
       VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING id`,
      [PROPERTY_ID, empleadoId, fecha, turnoConfigId, nota, creadoPor]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un cuadrante para ese empleado ese día — edita el existente en vez de duplicarlo' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error al crear el cuadrante' });
  }
});

app.put('/api/cuadrante/:id', ensureAdmin, async (req, res) => {
  const turnoConfigId = parseInt(req.body.turno_config_id, 10);
  const nota = (req.body.nota || '').trim() || null;
  if (!turnoConfigId) {
    return res.status(400).json({ error: 'turno_config_id es obligatorio' });
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE cuadrante SET turno_config_id=$1, nota=$2, actualizado_en=now()
       WHERE id=$3 AND property_id=$4`,
      [turnoConfigId, nota, req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Cuadrante no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el cuadrante' });
  }
});

app.delete('/api/cuadrante/:id', ensureAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM cuadrante WHERE id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Cuadrante no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar el cuadrante' });
  }
});

// ─── Importación CSV del cuadrante (validar → confirmar) ───
// Formato esperado, cabecera obligatoria: empleado_id,fecha,codigo_turno,nota
// (nota opcional). Parseo propio muy simple (split por líneas/comas): no se
// añade la dependencia csv-parse porque no está en package.json y el
// formato de entrada es deliberadamente básico.
function parsearCsvCuadrante(texto) {
  const lineas = texto.split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
  if (!lineas.length) return { cabecera: [], filas: [] };
  const cabecera = lineas[0].split(',').map(c => c.trim().toLowerCase());
  const filas = lineas.slice(1).map(linea => {
    const celdas = linea.split(',').map(c => c.trim());
    const obj = {};
    cabecera.forEach((nombreCol, i) => { obj[nombreCol] = celdas[i] !== undefined ? celdas[i] : ''; });
    return obj;
  });
  return { cabecera, filas };
}

app.post('/api/cuadrante/import/validar', ensureAdmin, uploadCsvMemoria.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el fichero CSV (campo "file")' });
  }
  const contenido = req.file.buffer.toString('utf8');
  const hash = sha256(contenido);
  const { cabecera, filas } = parsearCsvCuadrante(contenido);

  const columnasEsperadas = ['empleado_id', 'fecha', 'codigo_turno'];
  const faltan = columnasEsperadas.filter(c => !cabecera.includes(c));
  if (faltan.length) {
    return res.status(400).json({ error: `Cabecera del CSV inválida — faltan columnas: ${faltan.join(', ')}` });
  }

  try {
    const [{ rows: empleados }, { rows: turnos }] = await Promise.all([
      pool.query('SELECT id FROM empleado WHERE property_id = $1', [PROPERTY_ID]),
      pool.query('SELECT id, codigo FROM turno_config WHERE property_id = $1 AND activo = true', [PROPERTY_ID]),
    ]);
    const empleadosValidos = new Set(empleados.map(e => e.id));
    const turnosPorCodigo = new Map(turnos.map(t => [t.codigo, t.id]));

    const errores = [];
    const duplicados = [];
    const vistos = new Set();
    const filasParseadas = [];

    filas.forEach((fila, idx) => {
      const numFila = idx + 2; // +1 cabecera, +1 base 1
      const empleadoId = parseInt(fila.empleado_id, 10);
      const fecha = fila.fecha;
      const codigoTurno = fila.codigo_turno;
      const nota = fila.nota || null;

      if (!empleadoId || !empleadosValidos.has(empleadoId)) {
        errores.push({ fila: numFila, motivo: `empleado_id "${fila.empleado_id}" no existe en esta propiedad` });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') || isNaN(Date.parse(fecha))) {
        errores.push({ fila: numFila, motivo: `fecha "${fecha}" no tiene formato válido YYYY-MM-DD` });
        return;
      }
      if (!turnosPorCodigo.has(codigoTurno)) {
        errores.push({ fila: numFila, motivo: `codigo_turno "${codigoTurno}" no existe o no está activo en esta propiedad` });
        return;
      }
      const clave = `${empleadoId}|${fecha}`;
      if (vistos.has(clave)) {
        duplicados.push({ fila: numFila, motivo: `empleado_id ${empleadoId} + fecha ${fecha} repetido dentro del propio CSV` });
        return;
      }
      vistos.add(clave);
      filasParseadas.push({ fila: numFila, empleado_id: empleadoId, fecha, turno_config_id: turnosPorCodigo.get(codigoTurno), nota });
    });

    if (!req.session.cuadranteImportValidaciones) req.session.cuadranteImportValidaciones = {};
    req.session.cuadranteImportValidaciones[hash] = {
      nombreFichero: req.file.originalname,
      filasParseadas,
      errores,
      duplicados,
      filasTotales: filas.length,
    };

    res.json({
      filas_ok: filasParseadas.length,
      filas_totales: filas.length,
      errores,
      duplicados,
      hash,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al validar el CSV' });
  }
});

app.post('/api/cuadrante/import/confirmar', ensureAdmin, async (req, res) => {
  const hashValidacion = req.body.hash_validacion;
  const aplicaSoloFilasValidas = req.body.aplica_solo_filas_validas === true;
  if (!hashValidacion) {
    return res.status(400).json({ error: 'hash_validacion es obligatorio' });
  }
  const validacion = req.session.cuadranteImportValidaciones && req.session.cuadranteImportValidaciones[hashValidacion];
  if (!validacion) {
    return res.status(400).json({ error: 'Ejecuta primero /api/cuadrante/import/validar — el CSV ha caducado o no se reconoce en esta sesión' });
  }
  const totalErrores = validacion.errores.length + validacion.duplicados.length;
  if (totalErrores > 0 && !aplicaSoloFilasValidas) {
    return res.status(400).json({
      error: 'El CSV tiene filas con error o duplicadas — pasa aplica_solo_filas_validas=true para aplicar solo las filas válidas, o corrige el fichero',
      errores: validacion.errores,
      duplicados: validacion.duplicados,
    });
  }

  const creadoPor = req.session?.user?.login || req.user?.login || req.user?.username || 'admin';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of validacion.filasParseadas) {
      await client.query(
        `INSERT INTO cuadrante(property_id, empleado_id, fecha, turno_config_id, nota, creado_por, origen)
         VALUES ($1,$2,$3,$4,$5,$6,'import_csv')
         ON CONFLICT (property_id, empleado_id, fecha)
         DO UPDATE SET turno_config_id = EXCLUDED.turno_config_id, nota = EXCLUDED.nota,
                        origen = 'import_csv', creado_por = EXCLUDED.creado_por, actualizado_en = now()`,
        [PROPERTY_ID, f.empleado_id, f.fecha, f.turno_config_id, f.nota, creadoPor]
      );
    }
    await client.query(
      `INSERT INTO cuadrante_import_log(property_id, importado_por, nombre_fichero, filas_totales, filas_aplicadas, filas_error, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [PROPERTY_ID, creadoPor, validacion.nombreFichero, validacion.filasTotales, validacion.filasParseadas.length, totalErrores, hashValidacion]
    );
    await client.query('COMMIT');
    delete req.session.cuadranteImportValidaciones[hashValidacion];
    res.json({
      ok: true,
      filas_aplicadas: validacion.filasParseadas.length,
      filas_error: totalErrores,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al confirmar la importación del cuadrante', detalle: err.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════
// FASE 7 — Comparativa fichaje vs cuadrante + Plan B.
// La lógica de comparación vive en lib/comparativa.js (módulo puro, sin
// BD/Express, testeable en aislado). Aquí solo se cargan los datos
// (turno_config+cuadrante, fichaje, ausencias aprobadas, Plan B de
// property.json) y se le pasan ya en memoria.
//
// La tabla `ausencia_justificada` (Fase 8) alimenta ausenciasPorEmpleado:
// solo se cargan las de estado='aprobada' que solapan [desde, hasta].
// ═══════════════════════════════════════════════════════════════════

// Agrupa los fichajes de un rango de empleados en jornadas (reutilizando
// construirJornadas/fechaEnZona de la Fase 3) y las indexa por
// `${empleado_id}|${fecha}` → array de fichajes de ESA jornada, con la
// misma atribución de fecha que Fase 3 para turnos que cruzan medianoche
// (la fecha es la del día de la ENTRADA).
async function fichajesPorEmpleadoFechaPara(empleadoIds, desde, hasta) {
  const tz = property.timezone || 'Europe/Madrid';
  const fichajes = await fichajesParaCalculo(empleadoIds, desde, hasta);
  const porEmpleado = new Map();
  for (const f of fichajes) {
    if (!porEmpleado.has(f.empleado_id)) porEmpleado.set(f.empleado_id, []);
    porEmpleado.get(f.empleado_id).push(f);
  }
  const mapa = new Map();
  for (const [empId, lista] of porEmpleado.entries()) {
    const jornadas = construirJornadas(lista);
    for (const j of jornadas) {
      const fecha = fechaEnZona(j.inicio, tz);
      if (fecha < desde || fecha > hasta) continue;
      const eventos = [{ tipo: 'entrada', ts: j.inicio }];
      for (const p of j.pausas) {
        eventos.push({ tipo: 'pausa_inicio', ts: p.inicio });
        if (p.fin) eventos.push({ tipo: 'pausa_fin', ts: p.fin });
      }
      if (j.fin) eventos.push({ tipo: 'salida', ts: j.fin });
      mapa.set(`${empId}|${fecha}`, eventos);
    }
  }
  return mapa;
}

// Cuadrante (turno_config unido a cuadrante) indexado por `${empleado_id}|${fecha}`.
async function turnosPorEmpleadoFechaPara(empleadoIds, desde, hasta) {
  const cond = ['c.property_id = $1', 'c.fecha >= $2', 'c.fecha <= $3'];
  const params = [PROPERTY_ID, desde, hasta];
  if (empleadoIds && empleadoIds.length) {
    params.push(empleadoIds);
    cond.push(`c.empleado_id = ANY($${params.length}::int[])`);
  }
  const { rows } = await pool.query(
    `SELECT c.empleado_id, c.fecha, t.tipo, t.hora_entrada, t.hora_salida,
            t.duracion_prevista_min, t.turno_nocturno, t.tolerancia_entrada_min, t.tolerancia_salida_min,
            t.codigo AS turno_codigo, t.nombre AS turno_nombre
     FROM cuadrante c
     JOIN turno_config t ON t.id = c.turno_config_id
     WHERE ${cond.join(' AND ')}`,
    params
  );
  const mapa = new Map();
  for (const r of rows) {
    const fecha = r.fecha instanceof Date ? fechaEnZona(r.fecha, property.timezone || 'Europe/Madrid') : String(r.fecha).slice(0, 10);
    mapa.set(`${r.empleado_id}|${fecha}`, r);
  }
  return mapa;
}

// Ausencias aprobadas que solapan [desde, hasta], indexadas por empleado_id →
// array de filas (campos fecha_inicio/fecha_fin/tipo/estado, que
// ausenciaCubreFecha() de lib/comparativa.js sabe leer directamente).
async function ausenciasPorEmpleadoFechaPara(empleadoIds, desde, hasta) {
  const cond = ['property_id = $1', "estado = 'aprobada'", 'fecha_inicio <= $2', 'fecha_fin >= $3'];
  const params = [PROPERTY_ID, hasta, desde];
  if (empleadoIds && empleadoIds.length) {
    params.push(empleadoIds);
    cond.push(`empleado_id = ANY($${params.length}::int[])`);
  }
  const { rows } = await pool.query(
    `SELECT empleado_id, tipo, fecha_inicio, fecha_fin, estado
     FROM ausencia_justificada
     WHERE ${cond.join(' AND ')}`,
    params
  );
  const mapa = new Map();
  for (const r of rows) {
    // lib/comparativa.js (ausenciaCubreFecha) espera desde/hasta (o
    // fecha_desde/fecha_hasta), no los nombres de columna reales.
    const ausencia = { ...r, desde: r.fecha_inicio, hasta: r.fecha_fin };
    if (!mapa.has(r.empleado_id)) mapa.set(r.empleado_id, []);
    mapa.get(r.empleado_id).push(ausencia);
  }
  return mapa;
}

async function empleadosParaComparativa(empleadoId, departamentoId) {
  const cond = ['property_id = $1'];
  const params = [PROPERTY_ID];
  if (empleadoId) {
    params.push(empleadoId);
    cond.push(`id = $${params.length}`);
  }
  if (departamentoId) {
    params.push(departamentoId);
    cond.push(`departamento_id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT id, nombre, apellidos, departamento_id FROM empleado WHERE ${cond.join(' AND ')} ORDER BY apellidos, nombre`,
    params
  );
  return rows;
}

async function construirComparativaPeriodo(desde, hasta, empleadoId, departamentoId) {
  const empleados = await empleadosParaComparativa(empleadoId, departamentoId);
  const empleadoIds = empleados.map((e) => e.id);
  const fechas = listaDeDias(desde, hasta);
  const [turnosPorEmpleadoFecha, fichajesPorEmpleadoFecha, ausenciasPorEmpleado] = await Promise.all([
    turnosPorEmpleadoFechaPara(empleadoIds, desde, hasta),
    fichajesPorEmpleadoFechaPara(empleadoIds, desde, hasta),
    ausenciasPorEmpleadoFechaPara(empleadoIds, desde, hasta),
  ]);
  return compararRango({
    fechas,
    turnosPorEmpleadoFecha,
    fichajesPorEmpleadoFecha,
    ausenciasPorEmpleado,
    empleados,
    planB: PLAN_B,
  });
}

function filtrarComparativa(filas, { tipoIncidencia, estado }) {
  let out = filas;
  if (estado) out = out.filter((f) => f.estado === estado);
  if (tipoIncidencia) out = out.filter((f) => f.estado === tipoIncidencia);
  return out;
}

// ─── Comparativa: fichaje real vs cuadrante previsto (+ Plan B) ───
app.get('/api/comparativa', ensureAdmin, async (req, res) => {
  const desde = req.query.desde;
  const hasta = req.query.hasta;
  const errFecha = validarRangoFechas(desde, hasta);
  if (errFecha) return res.status(400).json({ error: errFecha });
  const empleadoId = req.query.empleado_id || null;
  const departamentoId = req.query.departamento_id || null;
  try {
    let filas = await construirComparativaPeriodo(desde, hasta, empleadoId, departamentoId);
    filas = filtrarComparativa(filas, { tipoIncidencia: req.query.tipo_incidencia, estado: req.query.estado });
    res.json({
      desde,
      hasta,
      plan_b: PLAN_B,
      nota_plan_b: NOTA_PLAN_B,
      resultados: filas,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular la comparativa' });
  }
});

// ─── Exportación de la comparativa (PDF/CSV, con sello de integridad) ───
app.get('/api/comparativa/export', ensureAdmin, async (req, res) => {
  const desde = req.query.desde;
  const hasta = req.query.hasta;
  const errFecha = validarRangoFechas(desde, hasta);
  if (errFecha) return res.status(400).json({ error: errFecha });
  const empleadoId = req.query.empleado_id || null;
  const departamentoId = req.query.departamento_id || null;
  const formato = (req.query.formato || 'csv').toLowerCase();
  if (!['pdf', 'csv'].includes(formato)) {
    return res.status(400).json({ error: 'formato debe ser "pdf" o "csv"' });
  }
  try {
    let filas = await construirComparativaPeriodo(desde, hasta, empleadoId, departamentoId);
    filas = filtrarComparativa(filas, { tipoIncidencia: req.query.tipo_incidencia, estado: req.query.estado });
    const generadoPor = req.session.user.login;
    const generadoEn = new Date().toISOString();
    const meta = { property_id: PROPERTY_ID, sociedad: property.sociedad || {}, desde, hasta, generado_por: generadoPor, generado_en: generadoEn };
    const hash = sha256(JSON.stringify({ ...meta, filas }));
    await registrarExport(empleadoId ? parseInt(empleadoId, 10) : null, desde, hasta, `comparativa_${formato}`, generadoPor, hash);

    if (formato === 'csv') {
      const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const cab = ['empleado', 'fecha', 'estado', 'source', 'minutos_retraso', 'minutos_anticipada', 'horas_esperadas', 'horas_trabajadas', 'detalle'];
      const lineas = [cab.join(',')];
      for (const f of filas) {
        lineas.push([
          csvEsc(`${f.apellidos}, ${f.nombre}`), f.fecha, f.estado, f.source,
          f.minutos_retraso != null ? f.minutos_retraso : '',
          f.minutos_anticipada != null ? f.minutos_anticipada : '',
          f.horas_esperadas != null ? f.horas_esperadas : '',
          f.horas_trabajadas != null ? f.horas_trabajadas : '',
          csvEsc(f.detalle),
        ].join(','));
      }
      lineas.push('');
      const nJustificadas = filas.filter((f) => f.estado === 'JUSTIFICADO').length;
      if (nJustificadas > 0) {
        lineas.push(csvEsc(`Justificadas por ausencia aprobada: ${nJustificadas} registros`));
      }
      lineas.push(csvEsc(NOTA_PLAN_B));
      lineas.push(csvEsc(`Sello de integridad (SHA-256): ${hash}`));
      const nombreFichero = `comparativa-${desde}_${hasta}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero}"`);
      return res.send('﻿' + lineas.join('\n'));
    }

    // formato === 'pdf'
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const nombreFichero = `comparativa-${desde}_${hasta}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero}"`);
    doc.pipe(res);
    doc.fontSize(16).text(`Comparativa fichaje vs cuadrante — ${PROPERTY_NAME}`, { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555').text(`Periodo: ${desde} a ${hasta}  ·  Generado por: ${generadoPor}  ·  ${generadoEn}`);
    doc.moveDown(0.8);
    doc.fontSize(9).fillColor('#000');
    let usaPlanB = false;
    for (const f of filas) {
      if (f.source === 'PLAN_B') usaPlanB = true;
      doc.text(
        `${f.fecha}  ${f.apellidos}, ${f.nombre}  —  ${f.estado} (${f.source})` +
        (f.minutos_retraso != null ? `  retraso: ${f.minutos_retraso} min` : '') +
        (f.minutos_anticipada != null ? `  anticipada: ${f.minutos_anticipada} min` : '') +
        (f.horas_trabajadas != null ? `  horas: ${f.horas_trabajadas}` : '')
      );
      doc.fontSize(8).fillColor('#666').text(f.detalle, { indent: 10 });
      doc.fontSize(9).fillColor('#000');
    }
    doc.moveDown(1);
    const nJustificadas = filas.filter((f) => f.estado === 'JUSTIFICADO').length;
    if (nJustificadas > 0) {
      doc.fontSize(8).fillColor('#888').text(`Justificadas por ausencia aprobada: ${nJustificadas} registros`);
    }
    if (usaPlanB) {
      doc.fontSize(8).fillColor('#888').text(NOTA_PLAN_B);
    }
    doc.fontSize(7).fillColor('#aaa').text(`Sello de integridad (SHA-256): ${hash}`);
    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al exportar la comparativa' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// FASE 8 — Vacaciones y ausencias justificadas.
// Solicitud (pendiente) → aprobar/rechazar → opcionalmente cancelar
// (solo si ya estaba aprobada). Las aprobadas alimentan la comparativa
// de Fase 7 (ver ausenciasPorEmpleadoPara() más abajo).
// ═══════════════════════════════════════════════════════════════════

const TIPOS_AUSENCIA = ['vacaciones', 'baja', 'permiso', 'libre', 'compensacion', 'otros'];

app.get('/api/ausencias', ensureAdmin, async (req, res) => {
  try {
    const cond = ['property_id = $1'];
    const params = [PROPERTY_ID];
    if (req.query.empleado_id) {
      params.push(req.query.empleado_id);
      cond.push(`empleado_id = $${params.length}`);
    }
    if (req.query.estado) {
      params.push(req.query.estado);
      cond.push(`estado = $${params.length}`);
    }
    if (req.query.desde) {
      params.push(req.query.desde);
      cond.push(`fecha_fin >= $${params.length}`);
    }
    if (req.query.hasta) {
      params.push(req.query.hasta);
      cond.push(`fecha_inicio <= $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT a.*, e.nombre, e.apellidos
       FROM ausencia_justificada a
       JOIN empleado e ON e.id = a.empleado_id
       WHERE ${cond.join(' AND ')}
       ORDER BY a.fecha_inicio DESC, e.apellidos, e.nombre`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer las ausencias' });
  }
});

app.post('/api/ausencias', ensureAdmin, async (req, res) => {
  const empleadoId = parseInt(req.body.empleado_id, 10);
  const tipo = req.body.tipo;
  const fechaInicio = req.body.fecha_inicio;
  const fechaFin = req.body.fecha_fin;
  const dias = Number(req.body.dias);
  const observaciones = (req.body.observaciones || '').trim() || null;
  if (!empleadoId || !tipo || !fechaInicio || !fechaFin) {
    return res.status(400).json({ error: 'empleado_id, tipo, fecha_inicio y fecha_fin son obligatorios' });
  }
  if (!TIPOS_AUSENCIA.includes(tipo)) {
    return res.status(400).json({ error: `tipo debe ser uno de: ${TIPOS_AUSENCIA.join(', ')}` });
  }
  if (fechaFin < fechaInicio) {
    return res.status(400).json({ error: 'fecha_fin no puede ser anterior a fecha_inicio' });
  }
  if (!(dias > 0)) {
    return res.status(400).json({ error: 'dias debe ser un número mayor que 0' });
  }
  try {
    if (!(await empleadoDeLaPropiedad(empleadoId))) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }
    const solicitadoPor = req.session.user.login;
    const { rows } = await pool.query(
      `INSERT INTO ausencia_justificada(property_id, empleado_id, tipo, fecha_inicio, fecha_fin, dias, estado, solicitado_por, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,'pendiente',$7,$8) RETURNING id`,
      [PROPERTY_ID, empleadoId, tipo, fechaInicio, fechaFin, dias, solicitadoPor, observaciones]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la ausencia' });
  }
});

app.put('/api/ausencias/:id/aprobar', ensureAdmin, async (req, res) => {
  const observaciones = (req.body.observaciones_aprobador || '').trim() || null;
  try {
    const aprobadoPor = req.session.user.login;
    const { rowCount } = await pool.query(
      `UPDATE ausencia_justificada
       SET estado='aprobada', aprobado_por=$1, fecha_aprobacion=now(),
           observaciones = COALESCE($2, observaciones), actualizado_en=now()
       WHERE id=$3 AND property_id=$4 AND estado='pendiente'`,
      [aprobadoPor, observaciones, req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Ausencia no encontrada o no está pendiente' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al aprobar la ausencia' });
  }
});

app.put('/api/ausencias/:id/rechazar', ensureAdmin, async (req, res) => {
  const observaciones = (req.body.observaciones_rechazo || '').trim();
  if (!observaciones) {
    return res.status(400).json({ error: 'observaciones_rechazo es obligatorio' });
  }
  try {
    const aprobadoPor = req.session.user.login;
    const { rowCount } = await pool.query(
      `UPDATE ausencia_justificada
       SET estado='rechazada', aprobado_por=$1, fecha_aprobacion=now(),
           observaciones=$2, actualizado_en=now()
       WHERE id=$3 AND property_id=$4 AND estado='pendiente'`,
      [aprobadoPor, observaciones, req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Ausencia no encontrada o no está pendiente' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al rechazar la ausencia' });
  }
});

app.put('/api/ausencias/:id/cancelar', ensureAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE ausencia_justificada
       SET estado='cancelada', actualizado_en=now()
       WHERE id=$1 AND property_id=$2 AND estado='aprobada'`,
      [req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Ausencia no encontrada o no está aprobada (solo se puede cancelar una ausencia ya aprobada)' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cancelar la ausencia' });
  }
});

app.delete('/api/ausencias/:id', ensureAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ausencia_justificada WHERE id=$1 AND property_id=$2 AND estado='pendiente'`,
      [req.params.id, PROPERTY_ID]
    );
    if (!rowCount) return res.status(404).json({ error: 'Ausencia no encontrada o no está pendiente (solo se borra una solicitud sin procesar)' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar la ausencia' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// FASE 9 — Auditoría legal de control horario.
// El checklist vive en lib/auditoria.js (módulo puro, sin BD/Express,
// testeable en aislado, mismo patrón que lib/comparativa.js de Fase 7).
// Aquí solo se cargan los fichajes RAW del rango + los empleados, se le
// pasan ya en memoria, y se persiste el resultado en auditoria_run +
// auditoria_control (transacción), con sello de integridad SHA-256 sobre
// la representación canónica de los controles — mismo patrón que
// export_log (Fase 3/4/7).
// ═══════════════════════════════════════════════════════════════════

// Representación canónica y determinista del array de controles, para que
// recalculando con los mismos controles se obtenga siempre el mismo hash.
function contenidoCanonicoAuditoria(meta, controles) {
  const controlesOrdenados = [...controles].sort((a, b) => {
    if (a.codigo_control !== b.codigo_control) return a.codigo_control < b.codigo_control ? -1 : 1;
    if ((a.empleado_id || 0) !== (b.empleado_id || 0)) return (a.empleado_id || 0) - (b.empleado_id || 0);
    const fa = a.fecha_referencia || '';
    const fb = b.fecha_referencia || '';
    if (fa !== fb) return fa < fb ? -1 : 1;
    return String(a.detalle).localeCompare(String(b.detalle));
  });
  return JSON.stringify({
    property_id: meta.property_id,
    desde: meta.desde,
    hasta: meta.hasta,
    ejecutado_por: meta.ejecutado_por,
    controles: controlesOrdenados.map((c) => ({
      codigo_control: c.codigo_control,
      empleado_id: c.empleado_id,
      estado: c.estado,
      detalle: c.detalle,
      fecha_referencia: c.fecha_referencia,
    })),
  });
}

// ═══════════════════════════════════════════════════════════════════
// FASE 10 — Incidencias.
// Bandeja alimentada por Fase 7 (comparativa) y Fase 9 (auditoría).
// Deduplicación vía UNIQUE(dedupe_key) + INSERT ... ON CONFLICT DO
// NOTHING: recalcular nunca duplica ni reabre una incidencia ya
// RESOLVED/DISMISSED (eso solo lo hace un admin explícitamente vía
// PUT /api/incidencias/:id/estado).
// ═══════════════════════════════════════════════════════════════════

// calcularDeduperKey / severidadComparativa / severidadAuditoria /
// ESTADOS_COMPARATIVA_SIN_INCIDENCIA ahora viven en lib/incidencias.js
// (módulo puro, testeable sin BD — ver test/unit/deduplicacion.test.js).

async function insertarIncidencia(client, {
  propertyId, empleadoId, fecha, origen, tipo, severidad, descripcion, refTipo, refId,
}) {
  const dedupeKey = calcularDeduperKey(propertyId, empleadoId, fecha, origen, tipo);
  const { rowCount } = await client.query(
    `INSERT INTO incidencia(property_id, empleado_id, fecha, origen, tipo, severidad, descripcion, ref_tipo, ref_id, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [propertyId, empleadoId, fecha, origen, tipo, severidad, descripcion, refTipo || null, refId || null, dedupeKey]
  );
  return rowCount > 0; // true = creada, false = ya existía (duplicada/ignorada)
}

// ─── Genera incidencias a partir de la comparativa fichaje vs cuadrante ───
async function generarIncidenciasDesdeComparativa(propertyId, desde, hasta) {
  const filas = await construirComparativaPeriodo(desde, hasta, null, null);
  let creadas = 0;
  let duplicadas = 0;
  for (const f of filas) {
    if (ESTADOS_COMPARATIVA_SIN_INCIDENCIA.has(f.estado)) continue;
    const severidad = severidadComparativa(f.estado, f.minutos_retraso);
    const ok = await insertarIncidencia(pool, {
      propertyId,
      empleadoId: f.empleado_id,
      fecha: f.fecha,
      origen: 'comparativa',
      tipo: f.estado,
      severidad,
      descripcion: f.detalle,
      refTipo: null,
      refId: null,
    });
    if (ok) creadas++; else duplicadas++;
  }
  return { creadas, duplicadas, total: creadas + duplicadas };
}

// ─── Genera incidencias a partir de una ejecución de auditoría legal ───
async function generarIncidenciasDesdeAuditoria(auditoriaRunId) {
  const { rows: runRows } = await pool.query(
    'SELECT id, property_id FROM auditoria_run WHERE id = $1',
    [auditoriaRunId]
  );
  if (!runRows.length) return { creadas: 0, duplicadas: 0, total: 0 };
  const propertyId = runRows[0].property_id;
  const { rows: controles } = await pool.query(
    `SELECT id, empleado_id, codigo_control, estado, detalle, fecha_referencia
     FROM auditoria_control WHERE auditoria_run_id = $1 AND estado != 'GREEN'`,
    [auditoriaRunId]
  );
  const tz = property.timezone || 'Europe/Madrid';
  let creadas = 0;
  let duplicadas = 0;
  for (const c of controles) {
    // c.fecha_referencia llega como Date (tipo DATE de pg): normalizar a
    // YYYY-MM-DD igual que el resto del código (ver fechaEnZona), para que
    // el dedupe_key sea estable y no dependa del timezone del proceso.
    const fecha = c.fecha_referencia
      ? (c.fecha_referencia instanceof Date ? fechaEnZona(c.fecha_referencia, tz) : String(c.fecha_referencia).slice(0, 10))
      : fechaEnZona(new Date(), tz);
    const severidad = severidadAuditoria(c.estado);
    const ok = await insertarIncidencia(pool, {
      propertyId,
      empleadoId: c.empleado_id,
      fecha,
      origen: 'auditoria',
      tipo: `AUDIT_${c.codigo_control}`,
      severidad,
      descripcion: c.detalle,
      refTipo: 'auditoria_control',
      refId: c.id,
    });
    if (ok) creadas++; else duplicadas++;
  }
  return { creadas, duplicadas, total: creadas + duplicadas };
}

async function empleadosParaAuditoria(empleadoId) {
  const cond = ['property_id = $1'];
  const params = [PROPERTY_ID];
  if (empleadoId) {
    params.push(empleadoId);
    cond.push(`id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT id, nombre, apellidos, pin_hash, qr_token FROM empleado WHERE ${cond.join(' AND ')} ORDER BY apellidos, nombre`,
    params
  );
  return rows;
}

// Fichajes RAW del rango (sin el margen de 2/3 días de fichajesParaCalculo:
// la auditoría necesita ver exactamente lo registrado en [desde, hasta],
// incluida cualquier jornada que quede abierta al final del rango).
async function fichajesRawParaAuditoria(desde, hasta) {
  const { rows } = await pool.query(
    `SELECT id, empleado_id, tipo, ts FROM fichaje
     WHERE property_id = $1 AND ts >= $2::date AND ts < ($3::date + interval '1 day')
     ORDER BY empleado_id, ts ASC, id ASC`,
    [PROPERTY_ID, desde, hasta]
  );
  return rows;
}

// ─── Ejecutar el checklist de auditoría y persistir el resultado ───
app.post('/api/auditoria/ejecutar', ensureAdmin, async (req, res) => {
  const desde = req.query.desde;
  const hasta = req.query.hasta;
  const errFecha = validarRangoFechas(desde, hasta);
  if (errFecha) return res.status(400).json({ error: errFecha });
  const client = await pool.connect();
  try {
    const [fichajes, empleados] = await Promise.all([
      fichajesRawParaAuditoria(desde, hasta),
      empleadosParaAuditoria(null),
    ]);
    const { controles, resumen } = ejecutarChecklistAuditoria({
      fichajes, empleados, property_id: PROPERTY_ID,
    });
    const ejecutadoPor = req.session.user.login;
    const meta = { property_id: PROPERTY_ID, desde, hasta, ejecutado_por: ejecutadoPor };
    const hash = sha256(contenidoCanonicoAuditoria(meta, controles));

    await client.query('BEGIN');
    const { rows: runRows } = await client.query(
      'INSERT INTO auditoria_run(property_id, ejecutado_por, desde, hasta, hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, ts',
      [PROPERTY_ID, ejecutadoPor, desde, hasta, hash]
    );
    const auditoriaRunId = runRows[0].id;
    for (const c of controles) {
      await client.query(
        `INSERT INTO auditoria_control(auditoria_run_id, empleado_id, codigo_control, estado, detalle, fecha_referencia)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [auditoriaRunId, c.empleado_id, c.codigo_control, c.estado, c.detalle, c.fecha_referencia]
      );
    }
    await client.query('COMMIT');

    await generarIncidenciasDesdeAuditoria(auditoriaRunId);

    res.json({
      auditoria_run_id: auditoriaRunId,
      desde,
      hasta,
      fecha_ejecucion: runRows[0].ts,
      resumen,
      controles,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al ejecutar la auditoría' });
  } finally {
    client.release();
  }
});

// ─── Histórico de ejecuciones ───
app.get('/api/auditoria/runs', ensureAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const cond = ['r.property_id = $1'];
    const params = [PROPERTY_ID];
    if (req.query.desde) {
      params.push(req.query.desde);
      cond.push(`r.hasta >= $${params.length}`);
    }
    if (req.query.hasta) {
      params.push(req.query.hasta);
      cond.push(`r.desde <= $${params.length}`);
    }
    params.push(limit);
    params.push(offset);
    const { rows } = await pool.query(
      `SELECT r.id, r.ejecutado_por, r.desde, r.hasta, r.ts, r.hash,
              COUNT(c.id) AS total,
              COUNT(*) FILTER (WHERE c.estado = 'GREEN') AS green,
              COUNT(*) FILTER (WHERE c.estado = 'AMBER') AS amber,
              COUNT(*) FILTER (WHERE c.estado = 'RED') AS red,
              COUNT(*) FILTER (WHERE c.estado = 'UNKNOWN') AS unknown
       FROM auditoria_run r
       LEFT JOIN auditoria_control c ON c.auditoria_run_id = r.id
       WHERE ${cond.join(' AND ')}
       GROUP BY r.id
       ORDER BY r.ts DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(rows.map((r) => ({
      id: r.id, ejecutado_por: r.ejecutado_por, desde: r.desde, hasta: r.hasta, ts: r.ts, hash: r.hash,
      resumen: {
        total: Number(r.total), green: Number(r.green), amber: Number(r.amber),
        red: Number(r.red), unknown: Number(r.unknown),
      },
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar las ejecuciones de auditoría' });
  }
});

// ─── Detalle de una ejecución ───
app.get('/api/auditoria/runs/:id', ensureAdmin, async (req, res) => {
  try {
    const { rows: runRows } = await pool.query(
      'SELECT id, ejecutado_por, desde, hasta, ts, hash FROM auditoria_run WHERE id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (!runRows.length) return res.status(404).json({ error: 'Ejecución de auditoría no encontrada' });
    const { rows: controles } = await pool.query(
      `SELECT c.id, c.empleado_id, e.nombre, e.apellidos, c.codigo_control, c.estado, c.detalle, c.fecha_referencia, c.creado_en
       FROM auditoria_control c LEFT JOIN empleado e ON e.id = c.empleado_id
       WHERE c.auditoria_run_id = $1
       ORDER BY c.codigo_control, c.empleado_id, c.fecha_referencia`,
      [req.params.id]
    );
    res.json({ ...runRows[0], controles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer el detalle de la auditoría' });
  }
});

// ─── Exportación PDF/CSV de una ejecución (informe sellado SHA-256) ───
app.get('/api/auditoria/runs/:id/export', ensureAdmin, async (req, res) => {
  const formato = (req.query.formato || 'csv').toLowerCase();
  if (!['pdf', 'csv'].includes(formato)) {
    return res.status(400).json({ error: 'formato debe ser "pdf" o "csv"' });
  }
  try {
    const { rows: runRows } = await pool.query(
      'SELECT id, ejecutado_por, desde, hasta, ts, hash FROM auditoria_run WHERE id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (!runRows.length) return res.status(404).json({ error: 'Ejecución de auditoría no encontrada' });
    const run = runRows[0];
    const { rows: controles } = await pool.query(
      `SELECT c.empleado_id, e.nombre, e.apellidos, c.codigo_control, c.estado, c.detalle, c.fecha_referencia
       FROM auditoria_control c LEFT JOIN empleado e ON e.id = c.empleado_id
       WHERE c.auditoria_run_id = $1
       ORDER BY c.codigo_control, c.empleado_id, c.fecha_referencia`,
      [req.params.id]
    );
    const generadoPor = req.session.user.login;
    const generadoEn = new Date().toISOString();
    const meta = { property_id: PROPERTY_ID, sociedad: property.sociedad || {}, desde: run.desde, hasta: run.hasta, generado_por: generadoPor, generado_en: generadoEn };
    const hashExport = sha256(JSON.stringify({ ...meta, run_id: run.id, controles }));
    await registrarExport(null, run.desde, run.hasta, `auditoria_${formato}`, generadoPor, hashExport);

    if (formato === 'csv') {
      const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const cab = ['empleado', 'codigo_control', 'estado', 'fecha_referencia', 'detalle'];
      const lineas = [cab.join(',')];
      for (const c of controles) {
        lineas.push([
          csvEsc(c.empleado_id ? `${c.apellidos}, ${c.nombre}` : ''),
          c.codigo_control, c.estado, c.fecha_referencia || '', csvEsc(c.detalle),
        ].join(','));
      }
      lineas.push('');
      lineas.push(csvEsc(`Auditoría ejecutada por ${run.ejecutado_por} el ${run.ts} · sello original: ${run.hash}`));
      lineas.push(csvEsc(`Sello de integridad de esta exportación (SHA-256): ${hashExport}`));
      const nombreFichero = `auditoria-${run.desde}_${run.hasta}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero}"`);
      return res.send('﻿' + lineas.join('\n'));
    }

    // formato === 'pdf'
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const nombreFichero = `auditoria-${run.desde}_${run.hasta}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero}"`);
    doc.pipe(res);
    doc.fontSize(16).text(`Auditoría legal de control horario — ${PROPERTY_NAME}`, { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555').text(
      `Periodo: ${run.desde} a ${run.hasta}  ·  Ejecutado por: ${run.ejecutado_por} el ${new Date(run.ts).toLocaleString('es-ES', { timeZone: property.timezone || 'Europe/Madrid' })}`
    );
    doc.moveDown(0.8);
    doc.fontSize(9).fillColor('#000');
    for (const c of controles) {
      doc.text(
        `[${c.estado}] ${c.codigo_control}` +
        (c.empleado_id ? `  —  ${c.apellidos}, ${c.nombre}` : '') +
        (c.fecha_referencia ? `  (${c.fecha_referencia})` : '')
      );
      doc.fontSize(8).fillColor('#666').text(c.detalle || '', { indent: 10 });
      doc.fontSize(9).fillColor('#000');
    }
    if (!controles.length) doc.text('Sin hallazgos en este periodo.');
    doc.moveDown(1);
    doc.fontSize(7).fillColor('#aaa').text(`Sello original de la ejecución (SHA-256): ${run.hash}`);
    doc.fontSize(7).fillColor('#aaa').text(`Sello de integridad de esta exportación (SHA-256): ${hashExport}`);
    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al exportar la auditoría' });
  }
});

// ─── Bandeja de incidencias: listado con filtros ───
app.get('/api/incidencias', ensureAdmin, async (req, res) => {
  try {
    const cond = ['i.property_id = $1'];
    const params = [PROPERTY_ID];
    if (req.query.empleado_id) {
      params.push(req.query.empleado_id);
      cond.push(`i.empleado_id = $${params.length}`);
    }
    if (req.query.estado) {
      params.push(req.query.estado);
      cond.push(`i.estado = $${params.length}`);
    }
    if (req.query.severidad) {
      params.push(req.query.severidad);
      cond.push(`i.severidad = $${params.length}`);
    }
    if (req.query.origen) {
      params.push(req.query.origen);
      cond.push(`i.origen = $${params.length}`);
    }
    if (req.query.desde) {
      params.push(req.query.desde);
      cond.push(`i.fecha >= $${params.length}`);
    }
    if (req.query.hasta) {
      params.push(req.query.hasta);
      cond.push(`i.fecha <= $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT i.*, e.nombre, e.apellidos
       FROM incidencia i
       LEFT JOIN empleado e ON e.id = i.empleado_id
       WHERE ${cond.join(' AND ')}
       ORDER BY i.fecha DESC, i.id DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar las incidencias' });
  }
});

// ─── Matriz explícita de transiciones de estado permitidas ───
// OPEN        -> IN_PROGRESS, DISMISSED, OPEN (solo editar notas)
// IN_PROGRESS -> RESOLVED, OPEN
// RESOLVED    -> OPEN (reapertura manual, no automática)
// DISMISSED   -> OPEN (cambio de criterio, no automática)
// Cualquier transición no listada aquí se rechaza con 400.
const TRANSICIONES_INCIDENCIA = {
  OPEN: new Set(['OPEN', 'IN_PROGRESS', 'DISMISSED']),
  IN_PROGRESS: new Set(['RESOLVED', 'OPEN']),
  RESOLVED: new Set(['OPEN']),
  DISMISSED: new Set(['OPEN']),
};

app.put('/api/incidencias/:id/estado', ensureAdmin, async (req, res) => {
  const nuevoEstado = req.body.estado;
  const notas = (req.body.notas || '').trim() || null;
  if (!nuevoEstado || !['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'].includes(nuevoEstado)) {
    return res.status(400).json({ error: 'estado debe ser OPEN, IN_PROGRESS, RESOLVED o DISMISSED' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, estado FROM incidencia WHERE id = $1 AND property_id = $2',
      [req.params.id, PROPERTY_ID]
    );
    if (!rows.length) return res.status(404).json({ error: 'Incidencia no encontrada' });
    const estadoActual = rows[0].estado;
    const permitidos = TRANSICIONES_INCIDENCIA[estadoActual];
    if (!permitidos || !permitidos.has(nuevoEstado)) {
      return res.status(400).json({ error: `Transición no permitida: ${estadoActual} → ${nuevoEstado}` });
    }
    const usuarioResponsable = req.session.user.login;
    const resuelveAhora = nuevoEstado === 'RESOLVED' || nuevoEstado === 'DISMISSED';
    const { rows: updated } = await pool.query(
      `UPDATE incidencia
       SET estado = $1,
           notas = COALESCE($2, notas),
           usuario_responsable = $3,
           actualizado_en = now(),
           resuelto_en = CASE WHEN $4 THEN now() ELSE resuelto_en END
       WHERE id = $5 AND property_id = $6
       RETURNING *`,
      [nuevoEstado, notas, usuarioResponsable, resuelveAhora, req.params.id, PROPERTY_ID]
    );
    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cambiar el estado de la incidencia' });
  }
});

// ─── Recalcular manualmente incidencias (sin re-ejecutar auditoría) ───
app.post('/api/incidencias/generar', ensureAdmin, async (req, res) => {
  const origen = req.query.origen;
  if (!['comparativa', 'auditoria'].includes(origen)) {
    return res.status(400).json({ error: 'origen debe ser "comparativa" o "auditoria"' });
  }
  try {
    if (origen === 'comparativa') {
      const desde = req.query.desde;
      const hasta = req.query.hasta;
      const errFecha = validarRangoFechas(desde, hasta);
      if (errFecha) return res.status(400).json({ error: errFecha });
      const resultado = await generarIncidenciasDesdeComparativa(PROPERTY_ID, desde, hasta);
      return res.json(resultado);
    }
    // origen === 'auditoria'
    const auditoriaRunId = parseInt(req.query.auditoria_run_id, 10);
    if (!auditoriaRunId) {
      return res.status(400).json({ error: 'auditoria_run_id es obligatorio para origen=auditoria' });
    }
    const { rows } = await pool.query(
      'SELECT id FROM auditoria_run WHERE id = $1 AND property_id = $2',
      [auditoriaRunId, PROPERTY_ID]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ejecución de auditoría no encontrada' });
    const resultado = await generarIncidenciasDesdeAuditoria(auditoriaRunId);
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar las incidencias' });
  }
});

// Arranque real solo si se ejecuta directamente (`node server.js` / systemd).
// Cuando el fichero se hace require() (p.ej. desde test/setup.js con
// supertest, que no necesita el puerto TCP real) NO se levanta el listener.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Adaria Personal v${APP_VERSION} (${PROPERTY_ID}) en :${PORT}`));
}

// Export para la suite de tests de integración (test/integration/*.test.js
// vía supertest). La lógica pura de deduplicación/severidad se testea
// directamente desde lib/incidencias.js (test/unit/deduplicacion.test.js),
// sin necesidad de requerir este fichero completo (evita depender de
// Redis/Postgres reales solo para un test de un helper de string).
module.exports = { app, PROPERTY_ID };
