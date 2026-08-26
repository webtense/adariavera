'use strict';

// ─── Integración ACI Dali (PMS Hotansa, SQL Server) — SOLO LECTURA ────────────
// Hotel Adaria Vera, BD única AdariaVeraHotel. Usuario adaria_ro (mismo que usan
// adaria-ine y adaria-estadisticas — sin permisos de escritura en el PMS).
//
// REGLA DE ORO: este módulo ejecuta EXCLUSIVAMENTE SELECT contra ACI. Jamás
// INSERT/UPDATE/DELETE. Los datos que el huésped rellena en el pre check-in se
// guardan solo en la base propia (precheckin_adaria), nunca aquí.
//
// Consultas y columnas (RES_COD_str, hue_des_str, hue_co1_str, HAB_COD_str,
// res_ent_dat, res_sal_dat, res_anu_bln, res_spe_adu_int, res_spe_nin_int,
// res_spe_cun_int) verificadas contra el código en producción de
// /opt/adaria-parking/aci.js, /opt/adaria-estadisticas/server.js y
// /opt/adaria-ine/aci.py en este mismo host — no son un esquema inventado.

const sql = require('mssql');

const aciConfig = {
  server: process.env.ACI_HOST || '192.168.1.34',
  port: parseInt(process.env.ACI_PORT || '1433', 10),
  user: process.env.ACI_USER || 'adaria_ro',
  password: process.env.ACI_PASSWORD || '',
  database: process.env.ACI_DATABASE || 'AdariaVeraHotel',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 6000,
    requestTimeout: 12000,
  },
  pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise = null;
function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(aciConfig).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// Busca UNA reserva activa (no anulada, todavía no finalizada) por apellido
// del titular + (localizador RES_COD_str) o (fecha de entrada). El apellido
// es obligatorio en ambos modos: evita que basten solo unas fechas para
// localizar una reserva ajena.
//
// { codigoReserva?, fechaEntrada? (YYYY-MM-DD), apellido } -> reserva | null
const QUERY_BUSCAR_RESERVA = `
  SELECT TOP 1
    r.RES_GUID AS res_guid,
    r.RES_COD_str AS codigo,
    hab.HAB_COD_str AS habitacion,
    h.hue_des_str AS titular_nombre,
    h.hue_co1_str AS titular_apellido,
    (ISNULL(r.res_spe_adu_int,0) + ISNULL(r.res_spe_nin_int,0) + ISNULL(r.res_spe_cun_int,0)) AS pax,
    ISNULL(r.res_spe_adu_int,0) AS adultos,
    (ISNULL(r.res_spe_nin_int,0) + ISNULL(r.res_spe_cun_int,0)) AS infantil,
    CONVERT(varchar(10), r.res_ent_dat, 23) AS entrada,
    CONVERT(varchar(10), r.res_sal_dat, 23) AS salida
  FROM Reservas r
  LEFT JOIN Huespedes h ON h.HUE_GUID = r.HUE_GUID
  LEFT JOIN Habitaciones hab ON hab.HAB_GUID = r.HAB_GUID
  WHERE r.res_anu_bln = 0
    AND r.res_sal_dat > CAST(GETDATE() AS DATE)
    AND (UPPER(ISNULL(h.hue_co1_str,'')) LIKE @ape OR UPPER(ISNULL(h.hue_des_str,'')) LIKE @ape)
    AND (
      (@codigo <> '' AND r.RES_COD_str = @codigo)
      OR (@codigo = '' AND @fechaEnt <> '' AND CONVERT(date, r.res_ent_dat) = @fechaEnt)
    )
  ORDER BY r.res_ent_dat ASC
`;

async function buscarReserva({ codigoReserva, fechaEntrada, apellido }) {
  const apellidoLimpio = String(apellido || '').trim();
  if (apellidoLimpio.length < 2) {
    throw new Error('apellido_requerido');
  }
  const codigo = String(codigoReserva || '').trim();
  const fechaEnt = String(fechaEntrada || '').trim();
  if (!codigo && !fechaEnt) {
    throw new Error('localizador_o_fecha_requerido');
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('ape', sql.NVarChar, '%' + apellidoLimpio.toUpperCase() + '%')
    .input('codigo', sql.VarChar, codigo)
    .input('fechaEnt', sql.VarChar, fechaEnt)
    .query(QUERY_BUSCAR_RESERVA);

  if (!result.recordset.length) return null;
  const row = result.recordset[0];
  return {
    resGuid: row.res_guid,
    codigo: (row.codigo || '').trim() || null,
    habitacion: (row.habitacion || '').trim() || null,
    titularNombre: (row.titular_nombre || '').trim() || null,
    titularApellido: (row.titular_apellido || '').trim() || null,
    pax: row.pax != null ? parseInt(row.pax, 10) : 1,
    adultos: row.adultos != null ? parseInt(row.adultos, 10) : 1,
    infantil: row.infantil != null ? parseInt(row.infantil, 10) : 0,
    entrada: row.entrada || null,
    salida: row.salida || null,
  };
}

async function ping() {
  const pool = await getPool();
  await pool.request().query('SELECT 1 AS ok');
  return true;
}

module.exports = { buscarReserva, ping };
