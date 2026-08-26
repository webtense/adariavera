'use strict';

// Base de datos PROPIA del módulo (precheckin_adaria). Aquí, y solo aquí, se
// guardan los datos que rellena el huésped. Nunca se escribe en ACI.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'precheckin_adaria',
  max: 5,
  idleTimeoutMillis: 30000,
});

module.exports = { pool };
