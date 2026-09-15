// Conexion PostgreSQL local (BD propia de la app). Aqui se guardan firmas y PDFs.
// NUNCA se conecta a ACI desde este modulo.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
  console.error('[db] Error inesperado en el pool de PostgreSQL:', err.message);
});

// Pool de SOLO LECTURA hacia la BD del módulo Pre check-in online
// (precheckin_adaria). Welcome NUNCA escribe ahí; solo consulta para
// precargar los datos que el huésped ya rellenó antes de llegar.
const precheckinPool = new Pool({
  host: process.env.PRECHECKIN_PG_HOST || process.env.PG_HOST,
  port: parseInt(process.env.PRECHECKIN_PG_PORT || process.env.PG_PORT || '5432', 10),
  database: process.env.PRECHECKIN_PG_DATABASE || 'precheckin_adaria',
  user: process.env.PRECHECKIN_PG_USER || process.env.PG_USER,
  password: process.env.PRECHECKIN_PG_PASSWORD || process.env.PG_PASSWORD,
  max: 5,
  idleTimeoutMillis: 30000
});

precheckinPool.on('error', (err) => {
  console.error('[db] Error inesperado en el pool de precheckin_adaria:', err.message);
});

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS checkins (
  id                  SERIAL PRIMARY KEY,
  uuid                UUID NOT NULL DEFAULT gen_random_uuid(),
  aci_res_guid        INTEGER,
  aci_res_cod         VARCHAR(20),
  aci_hue_guid        INTEGER,
  room_code           VARCHAR(20),
  checkin_date        DATE,
  checkout_date       DATE,
  language            VARCHAR(2) NOT NULL DEFAULT 'es',
  titular_json        JSONB NOT NULL,
  acompanantes_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  consent_conditions  BOOLEAN NOT NULL DEFAULT false,
  consent_privacy     BOOLEAN NOT NULL DEFAULT false,
  consent_image       BOOLEAN NOT NULL DEFAULT false,
  consent_marketing   BOOLEAN NOT NULL DEFAULT false,
  document_number_enc TEXT,
  signature_png_path  TEXT,
  pdf_path            TEXT,
  pdf_hash_sha256     VARCHAR(64),
  client_ip           VARCHAR(45),
  signed_at           TIMESTAMPTZ,
  estado              VARCHAR(20) NOT NULL DEFAULT 'firmado',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkins_aci_res_guid ON checkins (aci_res_guid);
CREATE INDEX IF NOT EXISTS idx_checkins_checkin_date ON checkins (checkin_date);

CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  accion      VARCHAR(50) NOT NULL,
  detalle     JSONB,
  client_ip   VARCHAR(45),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function initSchema() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(SCHEMA_SQL);
  console.log('[db] Esquema verificado/creado correctamente.');
}

async function logAudit(accion, detalle, clientIp) {
  try {
    await pool.query(
      'INSERT INTO audit_log (accion, detalle, client_ip) VALUES ($1, $2, $3)',
      [accion, detalle ? JSON.stringify(detalle) : null, clientIp || null]
    );
  } catch (e) {
    console.error('[db] Error registrando audit_log:', e.message);
  }
}

module.exports = { pool, precheckinPool, initSchema, logAudit };
