'use strict';

// Base de datos PROPIA del módulo (personal_adaria). NÚCLEO común a todas las
// propiedades: cada fila lleva property_id, nunca se separa por base de datos
// distinta salvo que se decida así en el despliegue de una nueva propiedad.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'personal_adaria',
  max: 5,
  idleTimeoutMillis: 30000,
});

module.exports = { pool };
