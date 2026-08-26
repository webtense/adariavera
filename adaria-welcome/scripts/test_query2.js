require('dotenv').config({ path: '.env.discover' });
const sql = require('mssql');

const config = {
  server: process.env.ACI_HOST,
  port: parseInt(process.env.ACI_PORT || '1433', 10),
  database: process.env.ACI_DATABASE,
  user: process.env.ACI_USER,
  password: process.env.ACI_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 15000
};

async function main() {
  const pool = await sql.connect(config);

  console.log('--- Reservas HAB_GUID sample para hoy ---');
  const r1 = await pool.request().query(`
    SELECT TOP 10 RES_GUID, HAB_GUID, HUE_GUID, res_ent_dat, res_anu_bln
    FROM Reservas
    WHERE CAST(res_ent_dat AS DATE) = CAST(GETDATE() AS DATE)
  `);
  console.table(r1.recordset);

  console.log('--- Total reservas hoy (sin filtro anu) ---');
  const rc = await pool.request().query(`
    SELECT COUNT(*) AS n FROM Reservas WHERE CAST(res_ent_dat AS DATE) = CAST(GETDATE() AS DATE)
  `);
  console.table(rc.recordset);

  console.log('--- Total reservas hoy anu=0 ---');
  const rc2 = await pool.request().query(`
    SELECT COUNT(*) AS n FROM Reservas WHERE CAST(res_ent_dat AS DATE) = CAST(GETDATE() AS DATE) AND res_anu_bln = 0
  `);
  console.table(rc2.recordset);

  console.log('--- Habitaciones sample ---');
  const rh = await pool.request().query(`SELECT TOP 5 HAB_GUID, HAB_COD_str, hab_des_str FROM Habitaciones`);
  console.table(rh.recordset);

  console.log('--- ReservaHuespedes sample para una reserva de hoy ---');
  const rrh = await pool.request().query(`
    SELECT TOP 10 rh.RES_GUID, rh.HUE_GUID
    FROM ReservaHuespedes rh
    INNER JOIN Reservas r ON r.RES_GUID = rh.RES_GUID
    WHERE CAST(r.res_ent_dat AS DATE) = CAST(GETDATE() AS DATE)
  `);
  console.table(rrh.recordset);

  console.log('--- Conteo ReservaHuespedes total ---');
  const rhc = await pool.request().query(`SELECT COUNT(*) AS n FROM ReservaHuespedes`);
  console.table(rhc.recordset);

  await pool.close();
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
