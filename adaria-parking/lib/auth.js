'use strict';

// ─────────────────────────────────────────────────────────────────
// Autenticación local de Adaria Parking.
// Patrón calcado de btr-sso/lib/local-users.js (bcrypt.compare(password,hash)
// contra una tabla propia, SIN llamar a Odoo): Vera no tiene Odoo, así que
// aquí la tabla propia es `usuario` en esta misma base de datos Postgres.
// Sesión con express-session (misma configuración que btr_parking_siente).
// ─────────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const fs = require('fs');

// Credenciales compartidas del staff (10/09/2026): mismo usuario/contraseña
// que adaria-gestion y adaria-personal, para no pedir un login distinto por
// módulo. Fuente única: users.json de adaria-gestion (mismo contenedor
// CT111) — si cambia ahí (alta, reset), aquí se refleja sola. Se usa como
// fallback SOLO si el username no existe (o no coincide) en la tabla propia
// `usuario`, así que las cuentas creadas directamente en parking (p.ej. el
// admin semilla) siguen funcionando igual.
const GESTION_USERS_FILE = '/opt/adaria-gestion/users.json';
function checkGestionSharedCreds(username, password) {
  try {
    const users = JSON.parse(fs.readFileSync(GESTION_USERS_FILE, 'utf8'));
    const rec = users[username];
    if (rec && bcrypt.compareSync(password, rec.hash)) return rec;
  } catch (e) { /* fichero no accesible (p.ej. en local): se ignora */ }
  return null;
}

/**
 * Valida username+password contra la tabla `usuario`; si no hay match ahí,
 * contra las credenciales compartidas de adaria-gestion.
 * @returns {Promise<{ok:boolean, user?:{id:number|null,username:string,rol:string}}>}
 */
async function authenticate(pool, username, password) {
  const u = String(username || '').trim().toLowerCase();
  if (!u || !password) return { ok: false };
  const { rows } = await pool.query(
    'SELECT id, username, password_hash, rol, activo FROM usuario WHERE username = $1',
    [u]
  );
  const row = rows[0];
  if (row && row.activo) {
    const ok = await bcrypt.compare(password, row.password_hash);
    if (ok) return { ok: true, user: { id: row.id, username: row.username, rol: row.rol } };
  }
  const shared = checkGestionSharedCreds(u, password);
  if (shared) {
    const rol = (shared.role === 'superadmin' || shared.role === 'admin') ? 'admin' : 'operador';
    return { ok: true, user: { id: null, username: u, rol } };
  }
  return { ok: false };
}

/**
 * Exige sesión válida (req.session.user). 401 JSON para /api o peticiones
 * que aceptan JSON; redirect a login para navegación normal de página.
 */
function requireAuth(opts = {}) {
  const loginPath = opts.loginPath || '/login.html';
  return (req, res, next) => {
    const user = req.session && req.session.user;
    if (user) {
      req.user = user;
      return next();
    }
    const wantsJson =
      req.path.startsWith('/api') ||
      (req.headers.accept || '').includes('application/json');
    if (wantsJson) return res.status(401).json({ error: 'No autenticado' });
    const next_ = encodeURIComponent(req.originalUrl || req.url || '/');
    return res.redirect(`${loginPath}?next=${next_}`);
  };
}

/** Exige además rol admin (req.user.rol === 'admin'). */
function requireAdmin(opts = {}) {
  const base = requireAuth(opts);
  return (req, res, next) =>
    base(req, res, () => {
      if (req.user && req.user.rol === 'admin') return next();
      const wantsJson =
        req.path.startsWith('/api') ||
        (req.headers.accept || '').includes('application/json');
      if (wantsJson) {
        return res.status(403).json({ error: 'Acceso denegado — se requiere rol admin' });
      }
      return res.status(403).send('Acceso denegado');
    });
}

/** Registra una entrada en audit_log. Nunca lanza (no debe romper la petición). */
async function auditLog(pool, { usuario, accion, plazaId, asignacionId, detalle, ip }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (usuario, accion, plaza_id, ocupacion_id, detalle, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        usuario,
        accion,
        plazaId == null ? null : plazaId,
        asignacionId == null ? null : asignacionId,
        detalle ? JSON.stringify(detalle) : null,
        ip || null,
      ]
    );
  } catch (e) {
    console.error('[audit_log] Error:', e.message);
  }
}

/**
 * Migración idempotente de las tablas usuario + audit_log, con seed OPCIONAL
 * de un primer admin —  solo si la tabla está vacía Y hay credenciales
 * explícitas en el entorno (ADMIN_USERNAME/ADMIN_PASSWORD). Nunca se inventan
 * contraseñas por defecto.
 */
// Sentencias DDL individuales (no un único bloque): si las tablas ya existen
// porque las creó otro rol (p.ej. las migraciones db/*.sql aplicadas como
// postgres/superusuario) y el rol de la app solo tiene privilegios DML
// (GRANT ALL, sin ownership), "CREATE INDEX IF NOT EXISTS" puede fallar con
// "must be owner of table..." AUNQUE el índice ya exista. Si esto formara
// parte de un único await pool.query(...) o de una cadena sin try/catch por
// sentencia, un solo error de permisos abortaría la función entera ANTES de
// llegar al seed del primer admin — dejando el login inutilizable sin que
// nadie lo note (bug real encontrado en la instancia de pruebas 10/09/2026).
// Por eso cada sentencia se ejecuta de forma independiente y no fatal.
async function ensureAuthTables(pool) {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS usuario (
      id            SERIAL       PRIMARY KEY,
      username      VARCHAR(50)  NOT NULL UNIQUE,
      password_hash TEXT         NOT NULL,
      rol           VARCHAR(20)  NOT NULL DEFAULT 'operador'
                        CHECK (rol IN ('admin','operador')),
      activo        BOOLEAN      NOT NULL DEFAULT TRUE,
      creado_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      creado_por    VARCHAR(50)  NOT NULL DEFAULT 'sistema'
    )`,
    `CREATE INDEX IF NOT EXISTS idx_usuario_username ON usuario(username)`,
    `CREATE INDEX IF NOT EXISTS idx_usuario_activo   ON usuario(activo)`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id           BIGSERIAL    PRIMARY KEY,
      usuario      VARCHAR(50)  NOT NULL,
      accion       VARCHAR(50)  NOT NULL,
      plaza_id     INTEGER,
      ocupacion_id INTEGER,
      detalle      JSONB,
      ip           VARCHAR(45),
      creado_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_plaza ON audit_log(plaza_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_at    ON audit_log(creado_at DESC)`,
  ];
  for (const stmt of ddl) {
    try {
      await pool.query(stmt);
    } catch (e) {
      console.warn('[ensureAuthTables] DDL no aplicada (probablemente ya existe y el rol de la app no es su owner):', e.message);
    }
  }

  const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM usuario');
  if (rows[0].cnt === 0) {
    if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      await pool.query(
        `INSERT INTO usuario (username, password_hash, rol, activo, creado_por)
         VALUES ($1, $2, 'admin', TRUE, 'sistema')
         ON CONFLICT (username) DO NOTHING`,
        [process.env.ADMIN_USERNAME.toLowerCase().trim(), hash]
      );
      console.log(`[usuario] Seed inicial: ${process.env.ADMIN_USERNAME} (admin) creado`);
    } else {
      console.warn(
        '[usuario] Tabla vacía y sin ADMIN_USERNAME/ADMIN_PASSWORD en .env — ' +
        'nadie podrá iniciar sesión hasta crear un usuario admin.'
      );
    }
  }
}

module.exports = { authenticate, requireAuth, requireAdmin, auditLog, ensureAuthTables };
