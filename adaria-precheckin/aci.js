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

// Reservas activas con entrada dentro de los próximos `diasAntelacion` días
// (usado por el envío proactivo de invitaciones D-30). Incluye el email de
// contacto de la reserva (hue_ema_str) — mismo criterio de columnas que
// buscarReserva: nombres verificados contra el resto del código en
// producción en este host (adaria-parking/adaria-estadisticas/adaria-ine).
// NOTA: a diferencia de HUE_COD_str/hue_des_str/hue_co1_str (usados y
// verificados en buscarReserva), hue_ema_str NO se ha confirmado todavía
// contra un dump real de Huespedes — si el envío D-30 sale con el email
// vacío en todas las filas, revisar aquí primero antes de tocar nada más.
const QUERY_PROXIMAS_RESERVAS = `
  SELECT
    r.RES_GUID AS res_guid,
    r.RES_COD_str AS codigo,
    hab.HAB_COD_str AS habitacion,
    h.hue_des_str AS titular_nombre,
    h.hue_co1_str AS titular_apellido,
    h.hue_ema_str AS email,
    CONVERT(varchar(10), r.res_ent_dat, 23) AS entrada,
    CONVERT(varchar(10), r.res_sal_dat, 23) AS salida
  FROM Reservas r
  LEFT JOIN Huespedes h ON h.HUE_GUID = r.HUE_GUID
  LEFT JOIN Habitaciones hab ON hab.HAB_GUID = r.HAB_GUID
  WHERE r.res_anu_bln = 0
    AND r.res_ent_dat >= CAST(GETDATE() AS DATE)
    AND r.res_ent_dat <= DATEADD(day, @dias, CAST(GETDATE() AS DATE))
  ORDER BY r.res_ent_dat ASC
`;

async function listarProximasReservas({ diasAntelacion = 30 } = {}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('dias', sql.Int, diasAntelacion)
    .query(QUERY_PROXIMAS_RESERVAS);
  return result.recordset.map((row) => ({
    resGuid: row.res_guid,
    codigo: (row.codigo || '').trim() || null,
    habitacion: (row.habitacion || '').trim() || null,
    titularNombre: (row.titular_nombre || '').trim() || null,
    titularApellido: (row.titular_apellido || '').trim() || null,
    email: (row.email || '').trim() || null,
    entrada: row.entrada || null,
    salida: row.salida || null,
  }));
}

// Alias con el nombre pedido para el cron de invitación de pre check-in
// (getArrivalsNextDays(7) = llegadas de los próximos 7 días). Reutiliza
// listarProximasReservas — misma query, mismo aviso sobre hue_ema_str sin
// verificar (ver arriba) — solo cambia el nombre del parámetro para que se
// lea en el sitio de llamada (cron_invitacion_precheckin.js).
async function getArrivalsNextDays(dias = 7) {
  return listarProximasReservas({ diasAntelacion: dias });
}

// ─── Filtro de emails "no entregables" (buzones proxy de OTAs) ─────────────
// Booking.com, Expedia y similares suelen inyectar en el PMS un email proxy
// propio (p.ej. algo@guest.booking.com) que reenvía al huésped mientras la
// reserva está activa, pero que en muchos casos deja de reenviar tras el
// check-out o directamente rebota. Mandar la invitación de pre check-in ahí
// es, en la práctica, no mandarla: mejor detectarlo, no enviar, y dejarlo
// trazado en precheckin_envio con email_entregable=false para que recepción
// sepa que hay que avisar al huésped por otro canal.
//
// Lista de dominios a mantener a mano según se detecten en producción — no
// hay forma fiable de derivarla automáticamente. No valida entregabilidad
// real (no hace SMTP check ni MX lookup), solo descarta proxies conocidos.
const DOMINIOS_NO_ENTREGABLES = [
  'guest.booking.com',
  'message.booking.com',
  'guest.airbnb.com',
  'messages.airbnb.com',
  'expediapartnercentral.com',
  'guest.expedia.com',
  'stay.expediapartnercentral.com',
  'relay.hotelbeds.com',
];

function esEmailEntregable(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  const dominio = e.split('@')[1] || '';
  return !DOMINIOS_NO_ENTREGABLES.some((d) => dominio === d || dominio.endsWith('.' + d));
}

async function ping() {
  const pool = await getPool();
  await pool.request().query('SELECT 1 AS ok');
  return true;
}

module.exports = {
  buscarReserva,
  listarProximasReservas,
  getArrivalsNextDays,
  esEmailEntregable,
  ping,
};
