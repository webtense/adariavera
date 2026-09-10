'use strict';
// Inicialización de la base de datos SQLite y esquema.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'veraadaria.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  nombre        TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'lector',   -- 'admin' | 'lector'
  activo        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria     TEXT NOT NULL,
  nombre        TEXT NOT NULL,
  usuario       TEXT,
  password_enc  TEXT,            -- cifrado AES-256-GCM
  url           TEXT,
  notas         TEXT,
  orden         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  username    TEXT,
  accion      TEXT NOT NULL,     -- LOGIN_OK, LOGIN_FAIL, LOGOUT, VER_PASSWORD, USER_CREATE...
  detalle     TEXT,
  ip          TEXT,
  user_agent  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   TEXT NOT NULL,
  expire INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cameras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, modelo TEXT, ip TEXT, usuario TEXT, password_enc TEXT,
  ubicacion TEXT, notas TEXT, orden INTEGER DEFAULT 0,
  monitor INTEGER DEFAULT 0, estado TEXT DEFAULT 'desconocido', last_check TEXT, last_ok TEXT
);

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, rol TEXT, ip TEXT, usuario TEXT, password_enc TEXT,
  so TEXT, notas TEXT, orden INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS switches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, modelo TEXT, ip TEXT, serie TEXT, puertos TEXT, poe TEXT,
  usuario TEXT, ubicacion TEXT, notas TEXT, orden INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria TEXT, nombre TEXT NOT NULL, telefono TEXT, notas TEXT, orden INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wifi_networks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ssid TEXT NOT NULL, tipo TEXT, ip_ap TEXT, banda TEXT, seguridad TEXT,
  usuario TEXT, password_enc TEXT, ubicacion TEXT, notas TEXT, orden INTEGER DEFAULT 0,
  monitor INTEGER DEFAULT 0, estado TEXT DEFAULT 'desconocido', last_check TEXT, last_ok TEXT
);

CREATE TABLE IF NOT EXISTS backup_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, origen TEXT, destino TEXT, tipo TEXT, frecuencia TEXT,
  hora TEXT, retencion TEXT, responsable TEXT, estado TEXT, notas TEXT, orden INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  clave TEXT PRIMARY KEY, valor TEXT
);

CREATE TABLE IF NOT EXISTS magic_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT UNIQUE NOT NULL,
  user_id     INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at  TEXT,             -- NULL = sin caducidad
  revoked     INTEGER NOT NULL DEFAULT 0,
  uses        INTEGER NOT NULL DEFAULT 0,
  last_used   TEXT
);
`);

// Migraciones suaves (añadir columnas a tablas preexistentes sin perder datos)
function addCol(tabla, col, def) {
  try { db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${def}`); } catch (e) { /* ya existe */ }
}
addCol('cameras', 'monitor', "INTEGER DEFAULT 0");
addCol('cameras', 'last_ok', "TEXT");

module.exports = db;
