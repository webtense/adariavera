// Conector ACI Dali (SQL Server) - SOLO LECTURA.
// Usuario adaria_ro tiene permisos SELECT unicamente sobre AdariaVeraHotel.
// Este modulo NUNCA debe ejecutar INSERT/UPDATE/DELETE.
const sql = require('mssql');

const config = {
  server: process.env.ACI_HOST,
  port: parseInt(process.env.ACI_PORT || '1433', 10),
  database: process.env.ACI_DATABASE,
  user: process.env.ACI_USER,
  password: process.env.ACI_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true
  },
  connectionTimeout: 15000,
  requestTimeout: 15000,
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
};

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect();
  }
  return poolPromise;
}

// Llegadas de hoy: Reservas (res_ent_dat = hoy, res_anu_bln = 0)
// JOIN Habitaciones (HAB_GUID), ReservaHuespedes/Huespedes (HUE_GUID), Naciones (NAC_GUID)
// Agrupado por reserva con su lista de huespedes.
const ARRIVALS_QUERY = `
  SELECT
    r.RES_GUID          AS resGuid,
    r.RES_COD_str       AS resCod,
    r.res_ent_dat        AS checkinDate,
    r.res_sal_dat        AS checkoutDate,
    ISNULL(h.HAB_COD_str, NULL) AS roomCode,
    hu.HUE_GUID          AS hueGuid,
    hu.hue_des_str       AS nombre,
    hu.hue_co1_str       AS apellido1,
    hu.hue_co2_str       AS apellido2,
    n.nac_des_str        AS nacionalidad
  FROM Reservas r
  LEFT JOIN Habitaciones h      ON h.HAB_GUID = r.HAB_GUID
  LEFT JOIN ReservaHuespedes rh ON rh.RES_GUID = r.RES_GUID
  LEFT JOIN Huespedes hu        ON hu.HUE_GUID = rh.HUE_GUID
  LEFT JOIN Naciones n          ON n.NAC_GUID = hu.NAC_GUID
  WHERE CAST(r.res_ent_dat AS DATE) = CAST(GETDATE() AS DATE)
    AND r.res_anu_bln = 0
  ORDER BY r.RES_GUID, hu.HUE_GUID
`;

async function getArrivalsToday() {
  const pool = await getPool();
  const result = await pool.request().query(ARRIVALS_QUERY);

  const reservasMap = new Map();
  for (const row of result.recordset) {
    if (!reservasMap.has(row.resGuid)) {
      reservasMap.set(row.resGuid, {
        resGuid: row.resGuid,
        resCod: (row.resCod || '').trim(),
        checkinDate: row.checkinDate,
        checkoutDate: row.checkoutDate,
        roomCode: row.roomCode ? row.roomCode.trim() : null,
        huespedes: []
      });
    }
    if (row.hueGuid) {
      reservasMap.get(row.resGuid).huespedes.push({
        hueGuid: row.hueGuid,
        nombre: (row.nombre || '').trim(),
        apellido1: (row.apellido1 || '').trim(),
        apellido2: (row.apellido2 || '').trim(),
        nacionalidad: (row.nacionalidad || '').trim()
      });
    }
  }
  return Array.from(reservasMap.values());
}

async function testConnection() {
  const pool = await getPool();
  await pool.request().query('SELECT 1 AS ok');
  return true;
}

module.exports = { getArrivalsToday, testConnection };
