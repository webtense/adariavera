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

  console.log('--- Query final llegadas de HOY ---');
  const r = await pool.request().query(`
    SELECT
      r.RES_GUID, r.RES_COD_str, r.res_ent_dat, r.res_sal_dat,
      r.res_nom_str AS titular_reserva,
      ISNULL(h.HAB_COD_str, 'Sin asignar') AS habitacion,
      hu.HUE_GUID, hu.hue_des_str AS nombre, hu.hue_co1_str AS apellido1, hu.hue_co2_str AS apellido2,
      n.nac_des_str AS nacionalidad,
      p.PEN_GUID
    FROM Reservas r
    LEFT JOIN Habitaciones h ON h.HAB_GUID = r.HAB_GUID
    LEFT JOIN ReservaHuespedes rh ON rh.RES_GUID = r.RES_GUID
    LEFT JOIN Huespedes hu ON hu.HUE_GUID = rh.HUE_GUID
    LEFT JOIN Naciones n ON n.NAC_GUID = hu.NAC_GUID
    CROSS APPLY (SELECT r.PEN_GUID) p
    WHERE CAST(r.res_ent_dat AS DATE) = CAST(GETDATE() AS DATE)
      AND r.res_anu_bln = 0
    ORDER BY habitacion, r.RES_GUID
  `);
  console.table(r.recordset);

  await pool.close();
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
