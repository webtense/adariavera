// Script de descubrimiento ACI (solo lectura) - se usa una vez para validar esquema real.
require('dotenv').config();
const sql = require('mssql');

const config = {
  server: process.env.ACI_HOST,
  port: parseInt(process.env.ACI_PORT || '1433', 10),
  database: process.env.ACI_DATABASE,
  user: process.env.ACI_USER,
  password: process.env.ACI_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    instanceName: process.env.ACI_INSTANCE || undefined
  },
  connectionTimeout: 15000,
  requestTimeout: 15000
};

async function main() {
  console.log('Conectando a', config.server, config.database);
  const pool = await sql.connect(config);

  const tables = ['Reservas', 'Habitaciones', 'ReservaHuespedes', 'Huespedes', 'Naciones'];
  for (const t of tables) {
    try {
      const r = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${t}' ORDER BY ORDINAL_POSITION
      `);
      console.log(`\n=== ${t} (${r.recordset.length} columnas) ===`);
      r.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} : ${c.DATA_TYPE}`));
    } catch (e) {
      console.log(`\n=== ${t} ERROR: ${e.message}`);
    }
  }

  // Buscar tablas parecidas por si el nombre exacto difiere
  console.log('\n=== Tablas que contienen "Reserva" o "Huesped" o "Habitacion" o "Nacion" ===');
  const r2 = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%eserva%' OR TABLE_NAME LIKE '%uesped%' OR TABLE_NAME LIKE '%abitacion%' OR TABLE_NAME LIKE '%acion%'
    ORDER BY TABLE_NAME
  `);
  r2.recordset.forEach(t => console.log(' -', t.TABLE_NAME));

  await pool.close();
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
