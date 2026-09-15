'use strict';
require('./lib/env')();
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { marked } = require('marked');
const fs = require('fs');
const redis = require('redis');
const RedisStore = require('connect-redis').default;

const db = require('./lib/db');
const audit = require('./lib/audit');
const { encrypt, decrypt } = require('./lib/crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.locals.appVersion = require('./package.json').version;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

const redisClient = redis.createClient({
  host: '127.0.0.1',
  port: 6379,
  legacyMode: false
});
redisClient.connect().catch(e => console.error('[Redis]', e.message));

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: 'adaria-sso-secret-2026',
  name: 'adaria_session',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

// ---- helpers ----
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).render('error', { user: req.session.user, msg: 'Acceso restringido a administradores.' });
}
app.use((req, res, next) => {
  res.locals.user = req.session ? req.session.user : null;
  res.locals.path = req.path;
  next();
});

// ---- LOGIN ----
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.render('login', { error: null, user: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND activo = 1').get((username || '').trim());
  req._loginUser = (username || '').trim();
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    audit.log(req, 'LOGIN_FAIL', `intento usuario "${(username || '').trim()}"`);
    return res.render('login', { error: 'Usuario o contraseña incorrectos.', user: null });
  }
  req.session.user = { id: u.id, username: u.username, nombre: u.nombre, role: u.role };
  db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(u.id);
  audit.log(req, 'LOGIN_OK', `rol ${u.role}`);
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  audit.log(req, 'LOGOUT', '');
  req.session.destroy(() => res.redirect('/login'));
});

// ---- MAGIC LINK (acceso sin contraseña) ----
app.get('/magic/:token', (req, res) => {
  const t = db.prepare('SELECT * FROM magic_tokens WHERE token = ? AND revoked = 0').get(req.params.token);
  if (!t) { audit.log(req, 'MAGIC_FAIL', 'token inválido/revocado'); return res.status(403).render('error', { user: null, msg: 'Enlace de acceso no válido o revocado.' }); }
  if (t.expires_at && new Date(t.expires_at.replace(' ', 'T')) < new Date()) {
    audit.log(req, 'MAGIC_FAIL', `token caducado (#${t.id})`);
    return res.status(403).render('error', { user: null, msg: 'Este enlace de acceso ha caducado. Solicita uno nuevo.' });
  }
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND activo = 1').get(t.user_id);
  if (!u) { audit.log(req, 'MAGIC_FAIL', 'usuario inactivo'); return res.status(403).render('error', { user: null, msg: 'Cuenta no disponible.' }); }
  db.prepare("UPDATE magic_tokens SET uses = uses + 1, last_used = datetime('now','localtime') WHERE id = ?").run(t.id);
  db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(u.id);
  req.session.user = { id: u.id, username: u.username, nombre: u.nombre, role: u.role };
  req._loginUser = u.username;
  audit.log(req, 'MAGIC_LOGIN', `${u.username} (token #${t.id})`);
  res.redirect('/');
});

// ---- DASHBOARD IT ----
app.get('/', requireLogin, (req, res) => {
  let equipos = {};
  try { equipos = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'equipos.json'), 'utf8')); } catch (e) {}
  res.render('dashboard', { equipos });
});

// ---- CREDENCIALES (subapartado Usuarios y Contraseñas) ----
app.get('/credenciales', requireLogin, (req, res) => {
  const rows = db.prepare('SELECT id, categoria, nombre, usuario, url, notas FROM credentials ORDER BY categoria, orden, id').all();
  const cats = {};
  for (const r of rows) { (cats[r.categoria] = cats[r.categoria] || []).push(r); }
  res.render('credenciales', { cats });
});

// revelar contraseña (auditado) — disponible para cualquier usuario logueado
app.post('/api/credenciales/:id/reveal', requireLogin, (req, res) => {
  const c = db.prepare('SELECT id, categoria, nombre, password_enc FROM credentials WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'no existe' });
  audit.log(req, 'VER_PASSWORD', `${c.categoria} / ${c.nombre} (#${c.id})`);
  res.json({ password: decrypt(c.password_enc) });
});

// editar / crear / borrar credencial (solo admin)
app.get('/credenciales/nueva', requireLogin, requireAdmin, (req, res) => {
  res.render('credencial_form', { cred: null });
});
app.get('/credenciales/:id/editar', requireLogin, requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM credentials WHERE id = ?').get(req.params.id);
  if (!c) return res.redirect('/credenciales');
  res.render('credencial_form', { cred: c });
});
app.post('/credenciales/guardar', requireLogin, requireAdmin, (req, res) => {
  const { id, categoria, nombre, usuario, password, url, notas, mantener } = req.body;
  if (id) {
    const cur = db.prepare('SELECT password_enc FROM credentials WHERE id = ?').get(id);
    const enc = (mantener && (!password || password === '')) ? cur.password_enc : (password ? encrypt(password) : '');
    db.prepare(`UPDATE credentials SET categoria=?, nombre=?, usuario=?, password_enc=?, url=?, notas=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(categoria, nombre, usuario || '', enc, url || '', notas || '', id);
    audit.log(req, 'CRED_EDIT', `${categoria} / ${nombre} (#${id})`);
  } else {
    db.prepare(`INSERT INTO credentials (categoria, nombre, usuario, password_enc, url, notas) VALUES (?,?,?,?,?,?)`)
      .run(categoria, nombre, usuario || '', password ? encrypt(password) : '', url || '', notas || '');
    audit.log(req, 'CRED_CREATE', `${categoria} / ${nombre}`);
  }
  res.redirect('/credenciales');
});
app.post('/credenciales/:id/borrar', requireLogin, requireAdmin, (req, res) => {
  const c = db.prepare('SELECT categoria, nombre FROM credentials WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM credentials WHERE id = ?').run(req.params.id);
  if (c) audit.log(req, 'CRED_DELETE', `${c.categoria} / ${c.nombre} (#${req.params.id})`);
  res.redirect('/credenciales');
});

// ---- GESTIÓN DE USUARIOS (solo admin) ----
app.get('/usuarios', requireLogin, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, nombre, role, activo, created_at, last_login FROM users ORDER BY username').all();
  const tokens = db.prepare("SELECT user_id, COUNT(*) n FROM magic_tokens WHERE revoked=0 AND (expires_at IS NULL OR expires_at > datetime('now','localtime')) GROUP BY user_id").all();
  const activeByUser = {}; tokens.forEach(t => activeByUser[t.user_id] = t.n);
  const base = `${req.protocol}://${req.get('host')}`;
  res.render('usuarios', { users, error: null, magic: req.query.magic ? `${base}/magic/${req.query.magic}` : null, magicUser: req.query.u || '', activeByUser });
});

// generar magic link (admin) — reutilizable, caduca a los días indicados (default 90), revocable
app.post('/usuarios/:id/magic', requireLogin, requireAdmin, (req, res) => {
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.redirect('/usuarios');
  const dias = parseInt(req.body.dias || '90', 10);
  const token = crypto.randomBytes(32).toString('base64url');
  // revoca tokens previos del usuario para mantener uno solo vigente
  db.prepare('UPDATE magic_tokens SET revoked = 1 WHERE user_id = ?').run(u.id);
  const exp = dias > 0 ? `datetime('now','localtime','+${dias} days')` : 'NULL';
  db.prepare(`INSERT INTO magic_tokens (token, user_id, expires_at) VALUES (?, ?, ${exp})`).run(token, u.id);
  audit.log(req, 'MAGIC_CREATE', `${u.username} (caduca ${dias>0?dias+'d':'nunca'})`);
  res.redirect(`/usuarios?magic=${token}&u=${encodeURIComponent(u.username)}`);
});

app.post('/usuarios/:id/magic-revoke', requireLogin, requireAdmin, (req, res) => {
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE magic_tokens SET revoked = 1 WHERE user_id = ?').run(req.params.id);
  if (u) audit.log(req, 'MAGIC_REVOKE', u.username);
  res.redirect('/usuarios');
});
app.post('/usuarios/crear', requireLogin, requireAdmin, (req, res) => {
  const { username, nombre, password, role } = req.body;
  const users = () => db.prepare('SELECT id, username, nombre, role, activo, created_at, last_login FROM users ORDER BY username').all();
  if (!username || !password) return res.render('usuarios', { users: users(), error: 'Usuario y contraseña son obligatorios.' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim())) {
    return res.render('usuarios', { users: users(), error: 'Ese usuario ya existe.' });
  }
  db.prepare('INSERT INTO users (username, nombre, password_hash, role) VALUES (?,?,?,?)')
    .run(username.trim(), nombre || '', bcrypt.hashSync(password, 12), role === 'admin' ? 'admin' : 'lector');
  audit.log(req, 'USER_CREATE', `${username.trim()} (${role})`);
  res.redirect('/usuarios');
});
app.post('/usuarios/:id/password', requireLogin, requireAdmin, (req, res) => {
  const { password } = req.body;
  if (password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), req.params.id);
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
    audit.log(req, 'USER_PASSWORD', u ? u.username : `#${req.params.id}`);
  }
  res.redirect('/usuarios');
});
app.post('/usuarios/:id/toggle', requireLogin, requireAdmin, (req, res) => {
  const u = db.prepare('SELECT id, username, activo FROM users WHERE id = ?').get(req.params.id);
  if (u && u.username !== req.session.user.username) {
    db.prepare('UPDATE users SET activo = ? WHERE id = ?').run(u.activo ? 0 : 1, u.id);
    audit.log(req, 'USER_TOGGLE', `${u.username} -> ${u.activo ? 'desactivado' : 'activado'}`);
  }
  res.redirect('/usuarios');
});
app.post('/usuarios/:id/borrar', requireLogin, requireAdmin, (req, res) => {
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (u && u.username !== req.session.user.username) {
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    audit.log(req, 'USER_DELETE', u.username);
  }
  res.redirect('/usuarios');
});

// ---- AUDITORÍA (solo admin) ----
app.get('/auditoria', requireLogin, requireAdmin, (req, res) => {
  const filtro = (req.query.accion || '').trim();
  let rows;
  if (filtro) {
    rows = db.prepare('SELECT * FROM audit_log WHERE accion = ? ORDER BY id DESC LIMIT 500').all(filtro);
  } else {
    rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500').all();
  }
  const acciones = db.prepare('SELECT DISTINCT accion FROM audit_log ORDER BY accion').all().map(r => r.accion);
  res.render('auditoria', { rows, acciones, filtro });
});

// ---- CÁMARAS ----
app.get('/camaras', requireLogin, (req, res) => {
  const cams = db.prepare('SELECT id,nombre,modelo,ip,usuario,ubicacion,notas,estado,last_check FROM cameras ORDER BY orden,id').all();
  res.render('camaras', { cams });
});

// ---- WiFi ----
app.get('/wifi', requireLogin, (req, res) => {
  const redes = db.prepare('SELECT id,ssid,tipo,ip_ap,banda,seguridad,usuario,ubicacion,notas,monitor,estado,last_check,last_ok FROM wifi_networks ORDER BY orden,id').all();
  res.render('wifi', { redes });
});

// ---- COPIAS DE SEGURIDAD ----
app.get('/backups', requireLogin, (req, res) => {
  const jobs = db.prepare('SELECT * FROM backup_jobs ORDER BY orden,id').all();
  const row = db.prepare("SELECT valor FROM settings WHERE clave='backup_doc'").get();
  const doc = row ? marked.parse(row.valor) : '';
  res.render('backups', { jobs, doc });
});

// ---- ESQUEMA DE RED ----
app.get('/changelog', requireLogin, (req, res) => {
  let changelog = { app_name: 'Dashboard IT (Hotel Adaria Vera)', entries: [] };
  try {
    changelog = JSON.parse(fs.readFileSync(path.join(__dirname, 'VERSION', 'changelog.json'), 'utf8'));
  } catch (e) {}
  res.render('changelog', { changelog });
});
app.get('/esquema-red', requireLogin, (req, res) => res.render('esquema'));
app.get('/estructura-red', requireLogin, (req, res) => res.render('estructura'));
app.get('/telefonia', requireLogin, (req, res) => res.render('telefonia'));

// ---- SERVIDORES ----
app.get('/servidores', requireLogin, (req, res) => {
  const servers = db.prepare('SELECT id,nombre,rol,ip,usuario,so,notas FROM servers ORDER BY orden,id').all();
  res.render('servidores', { servers });
});

// ---- SWITCHES ----
app.get('/switches', requireLogin, (req, res) => {
  const sws = db.prepare('SELECT * FROM switches ORDER BY orden,id').all();
  res.render('switches', { sws });
});

// ---- DIRECTORIO ----
app.get('/directorio', requireLogin, (req, res) => {
  const rows = db.prepare('SELECT categoria,nombre,telefono,notas FROM contacts ORDER BY categoria,orden,id').all();
  const cats = {}; rows.forEach(r => (cats[r.categoria || 'Otros'] = cats[r.categoria || 'Otros'] || []).push(r));
  res.render('directorio', { cats });
});

// reveal genérico de contraseñas (cámaras / wifi / servidores) — auditado
app.post('/api/secret/:tabla/:id/reveal', requireLogin, (req, res) => {
  const tablas = { cameras: 'Cámara', wifi_networks: 'WiFi', servers: 'Servidor' };
  const t = req.params.tabla;
  if (!tablas[t]) return res.status(400).json({ error: 'tabla no permitida' });
  const nameCol = t === 'wifi_networks' ? 'ssid' : 'nombre';
  const row = db.prepare(`SELECT ${nameCol} AS n, password_enc FROM ${t} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'no existe' });
  audit.log(req, 'VER_PASSWORD', `${tablas[t]}: ${row.n} (#${req.params.id})`);
  res.json({ password: decrypt(row.password_enc) });
});

// lista de IPs a monitorizar (APs WiFi + cámaras) para el agente del hotel
app.get('/api/ap-list', (req, res) => {
  if ((req.headers['x-report-token'] || '') !== (process.env.REPORT_TOKEN || '')) return res.status(403).json({ error: 'token' });
  const wifi = db.prepare("SELECT ip_ap AS ip FROM wifi_networks WHERE monitor=1 AND ip_ap<>''").all().map(r => r.ip);
  const cams = db.prepare("SELECT ip FROM cameras WHERE monitor=1 AND ip<>''").all().map(r => r.ip);
  res.json({ ips: [...new Set([...wifi, ...cams])] });
});

// receptor del monitor (alimenta un agente que SÍ alcanza la red del hotel). Alerta WhatsApp en transición a offline.
app.post('/api/ap-report', (req, res) => {
  if ((req.headers['x-report-token'] || '') !== (process.env.REPORT_TOKEN || '')) return res.status(403).json({ error: 'token' });
  const { ip, ok } = req.body || {};
  if (!ip) return res.status(400).json({ error: 'ip requerida' });
  const estado = ok ? 'online' : 'offline';
  // localizar el equipo (wifi o cámara) por IP
  let tabla, row;
  row = db.prepare("SELECT id, ssid AS nombre, estado FROM wifi_networks WHERE ip_ap=?").get(ip);
  if (row) tabla = 'wifi_networks';
  else { row = db.prepare("SELECT id, nombre, estado FROM cameras WHERE ip=?").get(ip); if (row) tabla = 'cameras'; }
  if (!row) return res.json({ ok: true, nota: 'ip no registrada' });
  const ipCol = tabla === 'wifi_networks' ? 'ip_ap' : 'ip';
  if (ok) db.prepare(`UPDATE ${tabla} SET estado=?, last_check=datetime('now','localtime'), last_ok=datetime('now','localtime') WHERE ${ipCol}=?`).run(estado, ip);
  else db.prepare(`UPDATE ${tabla} SET estado=?, last_check=datetime('now','localtime') WHERE ${ipCol}=?`).run(estado, ip);
  // alerta solo en la transición a offline (evita spam)
  if (!ok && row.estado !== 'offline') {
    const tipo = tabla === 'wifi_networks' ? 'AP WiFi' : 'Cámara';
    notifyWhatsApp(`⚠️ Adaria Vera IT: ${tipo} "${row.nombre}" (${ip}) NO responde al ping. Revisar.`);
    audit.log({ headers: {}, socket: {} }, 'ALERTA_OFFLINE', `${tipo} ${row.nombre} (${ip})`);
  }
  res.json({ ok: true });
});

// envío de alerta por WhatsApp vía Evolution API (best-effort, no bloquea)
function notifyWhatsApp(text) {
  try {
    const host = process.env.EVO_HOST, key = process.env.EVO_KEY, inst = process.env.EVO_INSTANCE, num = process.env.ALERT_NUMBER;
    if (!host || !key || !inst || !num) return;
    const http = require('http');
    const data = JSON.stringify({ number: num, text });
    const u = new URL(`${host}/message/sendText/${inst}`);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key, 'Content-Length': Buffer.byteLength(data) }, timeout: 8000 });
    r.on('error', () => {}); r.on('timeout', () => r.destroy()); r.write(data); r.end();
  } catch (e) { /* no romper el report */ }
}

// ---- EDITOR GENÉRICO (solo admin) ----
const SCHEMAS = {
  cameras:       { label: 'Cámaras', volver: '/camaras', pw: 'password_enc',
    fields: [['nombre','Nombre','text'],['modelo','Modelo','text'],['ip','IP','text'],['usuario','Usuario','text'],['password','Contraseña','pw'],['ubicacion','Ubicación','text'],['notas','Notas','textarea'],['monitor','Monitorizar (ping)','check'],['orden','Orden','num']] },
  wifi_networks: { label: 'WiFi', volver: '/wifi', pw: 'password_enc',
    fields: [['ssid','SSID','text'],['tipo','Tipo','text'],['ip_ap','IP del AP','text'],['banda','Banda','text'],['seguridad','Seguridad','text'],['usuario','Usuario','text'],['password','Contraseña','pw'],['ubicacion','Ubicación','text'],['notas','Notas','textarea'],['monitor','Monitorizar (ping)','check'],['orden','Orden','num']] },
  servers:       { label: 'Servidores', volver: '/servidores', pw: 'password_enc',
    fields: [['nombre','Nombre','text'],['rol','Rol','text'],['ip','IP','text'],['usuario','Usuario','text'],['password','Contraseña','pw'],['so','Sistema operativo','text'],['notas','Notas','textarea'],['orden','Orden','num']] },
  switches:      { label: 'Switches', volver: '/switches',
    fields: [['nombre','Nombre','text'],['modelo','Modelo','text'],['ip','IP','text'],['serie','Nº serie','text'],['puertos','Puertos','text'],['poe','PoE','text'],['usuario','Usuario','text'],['ubicacion','Ubicación','text'],['notas','Notas','textarea'],['orden','Orden','num']] },
  backup_jobs:   { label: 'Copias de seguridad', volver: '/backups',
    fields: [['nombre','Nombre','text'],['origen','Origen','text'],['destino','Destino','text'],['tipo','Tipo','text'],['frecuencia','Frecuencia','text'],['hora','Hora','text'],['retencion','Retención','text'],['responsable','Responsable','text'],['estado','Estado','text'],['notas','Notas','textarea'],['orden','Orden','num']] },
  contacts:      { label: 'Directorio', volver: '/directorio',
    fields: [['categoria','Categoría','text'],['nombre','Nombre','text'],['telefono','Teléfono','text'],['notas','Notas','textarea'],['orden','Orden','num']] },
};
function titleCol(t){ return t==='wifi_networks'?'ssid':(t==='contacts'?'nombre':'nombre'); }

app.get('/editar/:tabla', requireLogin, requireAdmin, (req, res) => {
  const t = req.params.tabla, sc = SCHEMAS[t];
  if (!sc) return res.redirect('/');
  const rows = db.prepare(`SELECT * FROM ${t} ORDER BY orden,id`).all();
  res.render('editor', { t, sc, rows, row: null, titleCol: titleCol(t) });
});
app.get('/editar/:tabla/:id', requireLogin, requireAdmin, (req, res) => {
  const t = req.params.tabla, sc = SCHEMAS[t];
  if (!sc) return res.redirect('/');
  const rows = db.prepare(`SELECT * FROM ${t} ORDER BY orden,id`).all();
  const row = db.prepare(`SELECT * FROM ${t} WHERE id=?`).get(req.params.id);
  res.render('editor', { t, sc, rows, row, titleCol: titleCol(t) });
});
app.post('/editar/:tabla/guardar', requireLogin, requireAdmin, (req, res) => {
  const t = req.params.tabla, sc = SCHEMAS[t];
  if (!sc) return res.redirect('/');
  const id = req.body.id;
  const cols = [], vals = [];
  sc.fields.forEach(([col, , type]) => {
    if (type === 'pw') {
      if (req.body.password && req.body.password.trim() !== '') { cols.push(sc.pw); vals.push(encrypt(req.body.password)); }
      else if (!id) { cols.push(sc.pw); vals.push(''); }
    } else if (type === 'check') { cols.push(col); vals.push(req.body[col] ? 1 : 0); }
    else { cols.push(col); vals.push(req.body[col] != null ? req.body[col] : ''); }
  });
  if (id) {
    db.prepare(`UPDATE ${t} SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`).run(...vals, id);
    audit.log(req, 'DATO_EDIT', `${sc.label} #${id}`);
  } else {
    db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    audit.log(req, 'DATO_CREATE', `${sc.label}: ${req.body[titleCol(t)] || ''}`);
  }
  res.redirect(`/editar/${t}`);
});
app.post('/editar/:tabla/:id/borrar', requireLogin, requireAdmin, (req, res) => {
  const t = req.params.tabla, sc = SCHEMAS[t];
  if (!sc) return res.redirect('/');
  db.prepare(`DELETE FROM ${t} WHERE id=?`).run(req.params.id);
  audit.log(req, 'DATO_DELETE', `${sc.label} #${req.params.id}`);
  res.redirect(`/editar/${t}`);
});

// health
app.get('/api/status', (req, res) => res.json({ ok: true, app: 'veraadaria-it', ts: new Date().toISOString() }));

app.use((req, res) => res.status(404).render('error', { user: req.session && req.session.user, msg: 'Página no encontrada (404).' }));

app.listen(PORT, '0.0.0.0', () => console.log(`veraadaria-it escuchando en 0.0.0.0:${PORT}`));
