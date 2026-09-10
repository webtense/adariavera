require('dotenv').config();
const express = require('express');
const sql = require('mssql');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3101;
const TOTAL_HABITACIONES = parseInt(process.env.TOTAL_HABITACIONES || '75', 10);

const dbConfig = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  connectionTimeout: 8000,
  requestTimeout: 15000,
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let poolPromise = null;
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(dbConfig)
      .connect()
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

// Todas las consultas son SOLO LECTURA (SELECT) sobre ACI Dali / Hotansa.
// Filtro común de ocupación "hoy": reservas no anuladas, con habitación
// asignada, cuya estancia cubre la fecha actual (entrada <= hoy < salida).
const SQL_OCUPACION_HOY = `
  SELECT COUNT(DISTINCT HAB_GUID) AS habitaciones_ocupadas
  FROM Reservas
  WHERE res_ent_dat <= CONVERT(date, GETDATE())
    AND res_sal_dat > CONVERT(date, GETDATE())
    AND (res_anu_bln = 0 OR res_anu_bln IS NULL)
    AND HAB_GUID IS NOT NULL
`;

const SQL_ENTRADAS_HOY = `
  SELECT COUNT(*) AS entradas
  FROM Reservas
  WHERE CONVERT(date, res_ent_dat) = CONVERT(date, GETDATE())
    AND (res_anu_bln = 0 OR res_anu_bln IS NULL)
`;

const SQL_SALIDAS_HOY = `
  SELECT COUNT(*) AS salidas
  FROM Reservas
  WHERE CONVERT(date, res_sal_dat) = CONVERT(date, GETDATE())
    AND (res_anu_bln = 0 OR res_anu_bln IS NULL)
`;

const SQL_HUESPEDES_HOY = `
  SELECT COUNT(DISTINCT rh.HUE_GUID) AS huespedes
  FROM ReservaHuespedes rh
  INNER JOIN Reservas r ON r.RES_GUID = rh.RES_GUID
  WHERE r.res_ent_dat <= CONVERT(date, GETDATE())
    AND r.res_sal_dat > CONVERT(date, GETDATE())
    AND (r.res_anu_bln = 0 OR r.res_anu_bln IS NULL)
    AND r.HAB_GUID IS NOT NULL
`;

const SQL_NACIONALIDADES_HOY = `
  SELECT n.nac_des_str AS nacionalidad, COUNT(DISTINCT h.HUE_GUID) AS total
  FROM ReservaHuespedes rh
  INNER JOIN Reservas r ON r.RES_GUID = rh.RES_GUID
  INNER JOIN Huespedes h ON h.HUE_GUID = rh.HUE_GUID
  LEFT JOIN Naciones n ON n.NAC_GUID = h.NAC_GUID
  WHERE r.res_ent_dat <= CONVERT(date, GETDATE())
    AND r.res_sal_dat > CONVERT(date, GETDATE())
    AND (r.res_anu_bln = 0 OR r.res_anu_bln IS NULL)
    AND r.HAB_GUID IS NOT NULL
  GROUP BY n.nac_des_str
  ORDER BY total DESC
`;

async function fetchStats() {
  const pool = await getPool();

  const [ocupacion, entradas, salidas, huespedes, nacionalidades] = await Promise.all([
    pool.request().query(SQL_OCUPACION_HOY),
    pool.request().query(SQL_ENTRADAS_HOY),
    pool.request().query(SQL_SALIDAS_HOY),
    pool.request().query(SQL_HUESPEDES_HOY),
    pool.request().query(SQL_NACIONALIDADES_HOY),
  ]);

  const habitacionesOcupadas = ocupacion.recordset[0].habitaciones_ocupadas || 0;

  return {
    generado: new Date().toISOString(),
    ocupacion: {
      habitaciones_ocupadas: habitacionesOcupadas,
      total_habitaciones: TOTAL_HABITACIONES,
      porcentaje: Math.round((habitacionesOcupadas / TOTAL_HABITACIONES) * 1000) / 10,
    },
    entradas_hoy: entradas.recordset[0].entradas || 0,
    salidas_hoy: salidas.recordset[0].salidas || 0,
    huespedes_hoy: huespedes.recordset[0].huespedes || 0,
    nacionalidades: nacionalidades.recordset.map((row) => ({
      nacionalidad: (row.nacionalidad || 'Sin especificar').trim(),
      total: row.total,
    })),
  };
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await fetchStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    console.error('Error consultando ACI:', err.message);
    res.status(200).json({
      ok: false,
      error: 'No se pudo conectar con ACI en este momento',
      generado: new Date().toISOString(),
    });
  }
});

app.get('/api/version', (req, res) => res.json({ version: require('./package.json').version }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Adaria Estadisticas escuchando en 0.0.0.0:${PORT}`);
});
