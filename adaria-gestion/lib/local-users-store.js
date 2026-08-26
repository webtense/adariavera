'use strict';

// ─── Módulo: Gestión de Usuarios Locales (Adaria Gestión) ──────────────────
// Portado de BTR (btr_gestion_portal/app/lib/local-users-store.js) y adaptado
// al formato de este portal: users.json es un OBJETO {login: {hash,nombre,
// role,apps}} (no un array con campo "login"), porque así lo consume ya
// server.js (login, topbar, /usuarios). bcrypt + backup atómico con
// timestamp, igual que en BTR.
//
// Campo nuevo: apps (string[]) = códigos de card (CARDS[].key) que el
// usuario puede ver/usar. Regla inquebrantable: el login 'asanchez' SIEMPRE
// tiene todos los permisos, se fuerza aquí en cada lectura/escritura para
// que ningún camino (UI manipulada, API directa) pueda degradarlo.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_FILE = path.join(__dirname, '..', 'users.json');
const SUPERADMIN_LOGIN = 'asanchez';

// ─── VALIDACIÓN ─────────────────────────────────────────────────────────────

function validarLogin(login) {
  if (typeof login !== 'string' || !login.trim()) {
    return { ok: false, error: 'Login vacío' };
  }
  const cleaned = login.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,29}$/.test(cleaned)) {
    return { ok: false, error: 'Login debe ser 3-30 caracteres, solo a-z 0-9 . _ -' };
  }
  return { ok: true };
}

function hashear(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Contraseña no válida');
  }
  return bcrypt.hashSync(password, 10);
}

// ─── LECTURA / ESCRITURA ────────────────────────────────────────────────────

function cargar() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const content = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(content);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('formato inesperado (se esperaba objeto {login:{...}})');
    }
    return data;
  } catch (e) {
    throw new Error(`Error leyendo users.json: ${e.message}`);
  }
}

/** Backup con timestamp antes de escribir (igual patrón que BTR). */
function backup() {
  if (!fs.existsSync(DATA_FILE)) return null;
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `${DATA_FILE}.bak-${now}`;
  try {
    fs.copyFileSync(DATA_FILE, backupFile);
    return backupFile;
  } catch (e) {
    throw new Error(`Error creando backup: ${e.message}`);
  }
}

/** Escritura atómica: a fichero temporal, luego rename. */
function escribirAtomico(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Los datos deben ser un objeto {login: {...}}');
  }
  for (const [login, u] of Object.entries(data)) {
    if (!u || typeof u.hash !== 'string') {
      throw new Error(`Usuario inválido: '${login}' sin hash`);
    }
  }
  const tempFile = `${DATA_FILE}.tmp`;
  const json = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(tempFile, json, 'utf8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (e) {
    try { fs.unlinkSync(tempFile); } catch (_) {}
    throw new Error(`Error escribiendo usuarios: ${e.message}`);
  }
}

/**
 * Regla inquebrantable (hardcoded backend, no depende de la UI):
 * 'asanchez' siempre es superadmin con TODOS los permisos (apps).
 */
function aplicarReglaSuperadmin(loginLower, u, todosLosApps) {
  if (loginLower === SUPERADMIN_LOGIN) {
    u.role = 'superadmin';
    u.apps = Array.isArray(todosLosApps) ? todosLosApps.slice() : (u.apps || []);
  }
  return u;
}

// ─── OPERACIONES CRUD ────────────────────────────────────────────────────────

/**
 * Lista usuarios sin exponer hashes. `todosLosApps` (array de app_code
 * vigentes, calculado por el servidor a partir de CARDS) se usa para forzar
 * la regla del superadmin también en la vista de listado.
 */
function listar(todosLosApps = []) {
  const users = cargar();
  return Object.entries(users).map(([login, u]) => {
    const loginLower = login.toLowerCase();
    const copia = {
      login: loginLower,
      nombre: u.nombre || loginLower,
      role: u.role || 'guest',
      apps: Array.isArray(u.apps) ? u.apps.slice() : [],
    };
    return aplicarReglaSuperadmin(loginLower, copia, todosLosApps);
  });
}

/** Alta de usuario. */
function alta(login, password, { nombre = '', role = 'guest', apps = [], todosLosApps = [] } = {}) {
  const valRes = validarLogin(login);
  if (!valRes.ok) return valRes;

  const users = cargar();
  const loginLower = login.toLowerCase();
  if (users[loginLower]) {
    return { ok: false, error: `El usuario '${login}' ya existe` };
  }

  const hash = hashear(password);
  let u = {
    hash,
    nombre: nombre || loginLower,
    role: ['guest', 'admin', 'superadmin'].includes(role) ? role : 'guest',
    apps: Array.isArray(apps) ? apps : [],
  };
  u = aplicarReglaSuperadmin(loginLower, u, todosLosApps);

  users[loginLower] = u;
  backup();
  escribirAtomico(users);

  return { ok: true, mensaje: `Usuario '${login}' creado` };
}

/**
 * Actualiza nombre / rol / apps / (opcionalmente) contraseña de un usuario
 * existente. Cualquier campo omitido (undefined) se deja tal cual.
 */
function actualizar(login, { nombre, role, apps, password, todosLosApps = [] } = {}) {
  const valRes = validarLogin(login);
  if (!valRes.ok) return valRes;

  const users = cargar();
  const loginLower = login.toLowerCase();
  const u = users[loginLower];
  if (!u) {
    return { ok: false, error: `Usuario '${login}' no existe` };
  }

  if (nombre !== undefined) u.nombre = (nombre || '').toString().trim() || loginLower;
  if (role !== undefined && ['guest', 'admin', 'superadmin'].includes(role)) u.role = role;
  if (Array.isArray(apps)) u.apps = apps;
  if (password) u.hash = hashear(password);

  users[loginLower] = aplicarReglaSuperadmin(loginLower, u, todosLosApps);

  backup();
  escribirAtomico(users);

  return { ok: true, mensaje: `Usuario '${login}' actualizado` };
}

/** Resetea solo la contraseña de un usuario. */
function reset(login, password) {
  const valRes = validarLogin(login);
  if (!valRes.ok) return valRes;
  if (!password) return { ok: false, error: 'Contraseña requerida' };

  const users = cargar();
  const loginLower = login.toLowerCase();
  const u = users[loginLower];
  if (!u) {
    return { ok: false, error: `Usuario '${login}' no existe` };
  }

  u.hash = hashear(password);
  backup();
  escribirAtomico(users);

  return { ok: true, mensaje: `Contraseña de '${login}' actualizada` };
}

/** Elimina un usuario. Protegido: nunca se puede borrar a asanchez ni a uno mismo. */
function baja(login, { actorLogin = '' } = {}) {
  const valRes = validarLogin(login);
  if (!valRes.ok) return valRes;

  const loginLower = login.toLowerCase();
  if (loginLower === SUPERADMIN_LOGIN) {
    return { ok: false, error: `No se puede dar de baja a '${SUPERADMIN_LOGIN}' (superadmin permanente)` };
  }
  if (actorLogin && actorLogin.toLowerCase() === loginLower) {
    return { ok: false, error: 'No puedes borrarte a ti mismo' };
  }

  const users = cargar();
  if (!users[loginLower]) {
    return { ok: false, error: `Usuario '${login}' no existe` };
  }

  delete users[loginLower];
  backup();
  escribirAtomico(users);

  return { ok: true, mensaje: `Usuario '${login}' eliminado` };
}

module.exports = {
  SUPERADMIN_LOGIN,
  validarLogin,
  hashear,
  cargar,
  backup,
  escribirAtomico,
  aplicarReglaSuperadmin,

  // CRUD
  listar,
  alta,
  actualizar,
  reset,
  baja,
};
