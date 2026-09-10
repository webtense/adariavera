// Consulta de SOLO LECTURA al PMS ACI Dali (SQL Server) vía tsql/FreeTDS.
// NUNCA se ejecuta ninguna escritura contra ACI desde este módulo.
'use strict';

const { execFile } = require('child_process');

const ACI_HOST = process.env.ACI_HOST || '192.168.1.34';
const ACI_PORT = process.env.ACI_PORT || '1433';
const ACI_USER = process.env.ACI_USER || 'adaria_ro';
const ACI_PASSWORD = process.env.ACI_PASSWORD || '';
const ACI_DATABASE = process.env.ACI_DATABASE || 'AdariaVeraHotel';

// Solo se permiten códigos de habitación alfanuméricos cortos (evita inyección SQL
// al interpolar el valor en la consulta que se envía a tsql).
const ROOM_CODE_RE = /^[A-Za-z0-9_-]{1,10}$/;

function runTsql(sql, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const args = ['-S', ACI_HOST, '-p', ACI_PORT, '-U', ACI_USER, '-P', ACI_PASSWORD, '-D', ACI_DATABASE];
    const child = execFile('tsql', args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`ACI tsql error: ${err.message} ${stderr || ''}`));
      }
      resolve(stdout);
    });
    child.stdin.write(sql + '\n');
    child.stdin.end();
  });
}

// Parsea la salida de línea de comandos de tsql (banners + prompts "1> 2> " + filas
// separadas por tabulador + línea final "(N rows affected)") a un array de objetos.
function parseTsqlOutput(raw) {
  const skipLine = (line) =>
    /^locale is/i.test(line) ||
    /^locale charset is/i.test(line) ||
    /^using default charset/i.test(line) ||
    /^Setting .* as default database/i.test(line) ||
    /^\(\d+ rows? affected\)/i.test(line) ||
    line.trim() === '';

  const stripPrompt = (line) => line.replace(/^(?:\d+>\s?)+/, '');

  const lines = raw.split('\n').map((l) => l.replace(/\r$/, ''));
  const dataLines = [];
  for (const line of lines) {
    if (skipLine(line)) continue;
    dataLines.push(stripPrompt(line));
  }
  if (dataLines.length === 0) return [];

  const headers = dataLines[0].split('\t').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < dataLines.length; i++) {
    const cells = dataLines[i].split('\t');
    if (cells.length === 1 && cells[0].trim() === '') continue;
    const obj = {};
    headers.forEach((h, idx) => {
      let v = cells[idx] !== undefined ? cells[idx].trim() : null;
      if (v === 'NULL' || v === '') v = null;
      obj[h] = v;
    });
    rows.push(obj);
  }
  return rows;
}

// Busca la reserva en curso (hoy entre entrada y salida, no anulada) para una
// habitación dada. Devuelve null si no hay coincidencia o si ACI no responde.
async function buscarHuespedActualPorHabitacion(numeroHabitacion) {
  if (!ROOM_CODE_RE.test(String(numeroHabitacion))) {
    throw new Error('Código de habitación no válido');
  }
  const sql = `
    SELECT TOP 1
      h.HAB_COD_str AS habitacion,
      hu.hue_des_str AS huesped,
      CONVERT(varchar(10), r.res_ent_dat, 23) AS entrada,
      CONVERT(varchar(10), r.res_sal_dat, 23) AS salida,
      r.RES_COD_str AS reserva
    FROM Reservas r
    JOIN Habitaciones h ON r.HAB_GUID = h.HAB_GUID
    LEFT JOIN Huespedes hu ON r.HUE_GUID = hu.HUE_GUID
    WHERE h.HAB_COD_str = '${numeroHabitacion}'
      AND r.res_anu_bln = 0
      AND GETDATE() BETWEEN r.res_ent_dat AND r.res_sal_dat
    ORDER BY r.res_ent_dat DESC;
  `;
  const raw = await runTsql(sql);
  const rows = parseTsqlOutput(raw);
  if (rows.length === 0) return null;
  return rows[0];
}

module.exports = { buscarHuespedActualPorHabitacion, parseTsqlOutput };
