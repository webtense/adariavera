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

  console.log('--- Conteo reservas por fecha entrada (ultimos 30 dias hacia adelante y atras) ---');
  const r1 = await pool.request().query(`
    SELECT CAST(res_ent_dat AS DATE) AS dia, COUNT(*) AS n
    FROM Reservas
    WHERE res_anu_bln = 0 AND res_ent_dat BETWEEN DATEADD(day,-5,GETDATE()) AND DATEADD(day,10,GETDATE())
    GROUP BY CAST(res_ent_dat AS DATE)
    ORDER BY dia
  `);
  console.table(r1.recordset);

  console.log('--- Query llegadas de hoy (join completo) ---');
  const r2 = await pool.request().query(`
    SELECT TOP 20
      r.RES_GUID, r.RES_COD_str, r.res_ent_dat, r.res_sal_dat, r.res_pro_dia_int AS noches,
      r.res_nom_str AS titular_reserva,
      h.HAB_COD_str, h.hab_des_str,
      hu.HUE_GUID, hu.hue_des_str, hu.hue_co1_str, hu.hue_co2_str,
      n.nac_des_str
    FROM Reservas r
    LEFT JOIN Habitaciones h ON h.HAB_GUID = r.HAB_GUID
    LEFT JOIN ReservaHuespedes rh ON rh.RES_GUID = r.RES_GUID
    LEFT JOIN Huespedes hu ON hu.HUE_GUID = rh.HUE_GUID
    LEFT JOIN Naciones n ON n.NAC_GUID = hu.NAC_GUID
    WHERE r.res_anu_bln = 0
    ORDER BY r.res_ent_dat DESC
  `);
  console.table(r2.recordset);

  await pool.close();
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
