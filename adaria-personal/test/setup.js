'use strict';

// test/setup.js — arranque común de la suite de integración/unit.
//
// IMPORTANTE: las variables de entorno de test se fijan AQUÍ, antes de
// requerir server.js/db.js — db.js lee process.env.PGDATABASE en el momento
// del require() (crea el Pool ahí mismo), así que si este fichero no es lo
// primero que se importa en cada test, se acaba conectando a la BD de
// producción por accidente. Todos los test/**/*.test.js deben hacer
// `require('../setup')` (o el relativo que corresponda) ANTES de requerir
// '../../server' o '../../db'.
//
// BD de test: personal_adaria_test — SEPARADA de personal_adaria (producción
// / desarrollo). Nunca se apunta a la BD real: así un test con bug (TRUNCATE,
// DROP) no puede tocar datos reales de Hotel Adaria Vera.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

process.env.NODE_ENV = 'test';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5432';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'personal_adaria_test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-no-usar-en-produccion';
process.env.SSO_SESSION_SECRET = process.env.SSO_SESSION_SECRET || process.env.SESSION_SECRET;
process.env.KIOSK_KEY = process.env.KIOSK_KEY || 'test-kiosk-key';
process.env.SEND_MODE = 'test'; // NUNCA enviar correo real durante los tests
process.env.NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'test@example.com';
process.env.BASE_PATH = '';
process.env.PORT = process.env.PORT || '0'; // sin efecto: server.js no hace listen() al hacer require()

// Admin local de test: usuario "testadmin" / password "testpass123",
// hash bcrypt precalculado (evita depender de bcryptjs en tiempo de carga
// del módulo de config — igual de válido que generarlo al vuelo).
process.env.ADMIN_USER = process.env.ADMIN_USER || 'testadmin';
const bcrypt = require('bcryptjs');
const ADMIN_PASSWORD = 'testpass123';
process.env.ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync(ADMIN_PASSWORD, 4);

const ROOT = path.join(__dirname, '..');
const INIT_SQL_PATH = path.join(ROOT, 'init.sql');

const { Pool } = require('pg');

// Pool administrativo contra la BD "postgres" por defecto, solo para poder
// CREATE DATABASE personal_adaria_test si todavía no existe.
async function asegurarBaseDeTest() {
  const admin = new Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT, 10),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: 'postgres',
  });
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [process.env.PGDATABASE]);
    if (!rows.length) {
      await admin.query(`CREATE DATABASE ${process.env.PGDATABASE}`);
    }
  } finally {
    await admin.end();
  }
}

// Aplica init.sql completo contra la BD de test. init.sql está escrito para
// ser idempotente (CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING en
// los seeds), así que aplicarlo repetidamente es seguro (ver también
// test/integration/regresion.test.js, test #73).
async function aplicarInitSql(pool) {
  const sql = fs.readFileSync(INIT_SQL_PATH, 'utf8');
  await pool.query(sql);
}

let poolTest = null;

// Conecta (creando la BD si hace falta) y aplica el esquema. Idempotente:
// llamar varias veces (p.ej. desde distintos ficheros de test) reutiliza el
// mismo pool.
async function crearConexionBD() {
  if (poolTest) return poolTest;
  await asegurarBaseDeTest();
  poolTest = new Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT, 10),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    max: 5,
  });
  await aplicarInitSql(poolTest);
  await sembrarPropiedad(poolTest);
  return poolTest;
}

// Fila mínima de `propiedad` que exige la FK de empleado/departamento/etc.
// PROPERTY_ID='vera' porque property.json (compartido con producción, no se
// duplica por test) trae id_propiedad='vera' fijo.
async function sembrarPropiedad(pool) {
  await pool.query(
    `INSERT INTO propiedad(id, nombre) VALUES ('vera', 'Hotel Adaria Vera (TEST)')
     ON CONFLICT (id) DO NOTHING`
  );
}

// Vacía TODAS las tablas de datos (deja el esquema y la fila de `propiedad`)
// vía TRUNCATE ... CASCADE — más simple y más rápido que envolver cada test
// en una transacción con rollback, dado que varios endpoints abren sus
// propias transacciones (BEGIN/COMMIT) contra el mismo pool de la app y no
// se puede anidar una transacción de test alrededor de eso sin tocar
// server.js. Se llama desde beforeEach/afterEach de cada fichero.
async function limpiarBD(pool) {
  await pool.query(`
    TRUNCATE TABLE
      incidencia, auditoria_control, auditoria_run,
      ausencia_justificada, cuadrante_import_log, cuadrante, turno_config,
      export_log, mensaje_motivacional, documento_empleado, fichaje,
      empleado, departamento
    RESTART IDENTITY CASCADE
  `);
}

async function cerrarConexionBD() {
  if (poolTest) {
    await poolTest.end();
    poolTest = null;
  }
}

// Agente supertest ya autenticado como admin local (login por .env, no por
// las credenciales compartidas de adaria-gestion — ver checkGestionSharedCreds
// en server.js, que no aplica aquí porque /opt/adaria-gestion/users.json no
// existe en el entorno de test y esa rama simplemente no matchea).
async function agenteAdmin(app) {
  const request = require('supertest');
  const agent = request.agent(app);
  const res = await agent.post('/login').type('form').send({ u: process.env.ADMIN_USER, p: ADMIN_PASSWORD });
  if (res.status !== 302 || (res.headers.location || '').includes('?e=1')) {
    throw new Error('No se pudo iniciar sesión como admin de test — revisa ADMIN_USER/ADMIN_PASSWORD_HASH');
  }
  return agent;
}

module.exports = {
  crearConexionBD,
  limpiarBD,
  cerrarConexionBD,
  agenteAdmin,
  ADMIN_USER: process.env.ADMIN_USER,
  ADMIN_PASSWORD,
};
