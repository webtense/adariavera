'use strict';

const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const aci = require('./aci');

const PORT = parseInt(process.env.PORT || '3091', 10);
const TOTAL_PLAZAS = 61;

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'parking_adaria',
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function toNumber(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

async function getTarifaDia() {
  const { rows } = await pool.query("SELECT valor FROM ajustes WHERE clave = 'tarifa_dia_eur'");
  return rows.length ? Number(rows[0].valor) : 15;
}

function calcularNoches(fechaEntrada, fechaSalida) {
  const ent = new Date(fechaEntrada + 'T00:00:00Z');
  const sal = new Date(fechaSalida + 'T00:00:00Z');
  const diffMs = sal.getTime() - ent.getTime();
  const noches = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, noches);
}

// --- API: tablero de plazas -------------------------------------------------

app.get('/api/version', (req, res) => res.json({ version: require('./package.json').version }));

app.get('/api/plazas', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.numero,
             a.id AS asignacion_id,
             a.habitacion,
             a.huesped_nombre,
             a.fecha_entrada,
             a.fecha_salida,
             a.noches,
             a.tarifa_dia,
             a.importe_total,
             a.cobrado,
             a.origen,
             a.notas
      FROM plazas p
      LEFT JOIN asignaciones a
        ON a.plaza_numero = p.numero AND a.estado = 'activa'
      ORDER BY p.numero
    `);
    const plazas = rows.map((r) => ({
      numero: r.numero,
      estado: r.asignacion_id ? 'ocupada' : 'libre',
      asignacion: r.asignacion_id
        ? {
            id: r.asignacion_id,
            habitacion: r.habitacion,
            huespedNombre: r.huesped_nombre,
            fechaEntrada: r.fecha_entrada,
            fechaSalida: r.fecha_salida,
            noches: r.noches,
            tarifaDia: Number(r.tarifa_dia),
            importeTotal: Number(r.importe_total),
            cobrado: r.cobrado,
            origen: r.origen,
            notas: r.notas,
          }
        : null,
    }));
    res.json({ total: TOTAL_PLAZAS, plazas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer el tablero de plazas' });
  }
});

// --- API: ajustes (tarifa) ---------------------------------------------------

app.get('/api/ajustes', async (req, res) => {
  try {
    const tarifa = await getTarifaDia();
    res.json({ tarifaDiaEur: tarifa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer los ajustes' });
  }
});

app.put('/api/ajustes', async (req, res) => {
  try {
    const tarifa = toNumber(req.body.tarifaDiaEur, null);
    if (tarifa === null || tarifa <= 0) {
      return res.status(400).json({ error: 'tarifaDiaEur debe ser un número positivo' });
    }
    await pool.query(
      "INSERT INTO ajustes(clave, valor) VALUES ('tarifa_dia_eur', $1) ON CONFLICT (clave) DO UPDATE SET valor = $1",
      [String(tarifa)]
    );
    res.json({ tarifaDiaEur: tarifa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar los ajustes' });
  }
});

// --- API: búsqueda en ACI (solo lectura) ------------------------------------

app.get('/api/aci/habitacion/:numero', async (req, res) => {
  try {
    const resultado = await aci.buscarHuespedActualPorHabitacion(req.params.numero);
    if (!resultado) {
      return res.json({ encontrado: false });
    }
    res.json({
      encontrado: true,
      habitacion: resultado.habitacion,
      huesped: resultado.huesped,
      fechaEntrada: resultado.entrada,
      fechaSalida: resultado.salida,
      reserva: resultado.reserva,
    });
  } catch (err) {
    console.error('Error consultando ACI:', err.message);
    // ACI no disponible o habitación no localizable: el frontend cae a entrada manual.
    res.json({ encontrado: false, avisoAci: 'No se ha podido consultar ACI, introduce los datos a mano.' });
  }
});

// --- API: asignar plaza ------------------------------------------------------

app.post('/api/plazas/:numero/asignar', async (req, res) => {
  const numero = parseInt(req.params.numero, 10);
  if (!Number.isInteger(numero) || numero < 1 || numero > TOTAL_PLAZAS) {
    return res.status(400).json({ error: 'Número de plaza no válido' });
  }
  const { habitacion, huespedNombre, fechaEntrada, fechaSalida, origen, notas } = req.body;
  if (!fechaEntrada || !fechaSalida) {
    return res.status(400).json({ error: 'fechaEntrada y fechaSalida son obligatorias' });
  }
  if (new Date(fechaSalida) < new Date(fechaEntrada)) {
    return res.status(400).json({ error: 'La fecha de salida no puede ser anterior a la de entrada' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activa = await client.query(
      "SELECT id FROM asignaciones WHERE plaza_numero = $1 AND estado = 'activa'",
      [numero]
    );
    if (activa.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La plaza ya está ocupada' });
    }

    const tarifaDia = await getTarifaDia();
    const noches = calcularNoches(fechaEntrada, fechaSalida);
    const importeTotal = Math.round(noches * tarifaDia * 100) / 100;

    const insert = await client.query(
      `INSERT INTO asignaciones
        (plaza_numero, habitacion, huesped_nombre, fecha_entrada, fecha_salida, noches, tarifa_dia, importe_total, estado, origen, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'activa',$9,$10)
       RETURNING *`,
      [numero, habitacion || null, huespedNombre || null, fechaEntrada, fechaSalida, noches, tarifaDia, importeTotal, origen || 'manual', notas || null]
    );
    await client.query('COMMIT');
    res.status(201).json(insert.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al asignar la plaza' });
  } finally {
    client.release();
  }
});

// --- API: liberar plaza -------------------------------------------------------

app.post('/api/plazas/:numero/liberar', async (req, res) => {
  const numero = parseInt(req.params.numero, 10);
  if (!Number.isInteger(numero) || numero < 1 || numero > TOTAL_PLAZAS) {
    return res.status(400).json({ error: 'Número de plaza no válido' });
  }
  try {
    const result = await pool.query(
      `UPDATE asignaciones
       SET estado = 'liberada', liberado_en = now()
       WHERE plaza_numero = $1 AND estado = 'activa'
       RETURNING *`,
      [numero]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'La plaza no tiene una asignación activa' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al liberar la plaza' });
  }
});

// --- API: marcar como cobrada --------------------------------------------------

app.post('/api/asignaciones/:id/cobrar', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await pool.query(
      `UPDATE asignaciones SET cobrado = true WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asignación no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al marcar como cobrada' });
  }
});

// --- API: histórico ------------------------------------------------------------

app.get('/api/asignaciones', async (req, res) => {
  try {
    const estado = req.query.estado;
    const params = [];
    let where = '';
    if (estado) {
      params.push(estado);
      where = 'WHERE estado = $1';
    }
    const { rows } = await pool.query(
      `SELECT * FROM asignaciones ${where} ORDER BY creado_en DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer el histórico' });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Adaria Parking escuchando en 0.0.0.0:${PORT}`);
});
