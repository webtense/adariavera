'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const redis = require('redis');
const RedisStore = require('connect-redis').default;
const aci = require('./aci');
const auth = require('./lib/auth');

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

// Necesario para que express-session respete X-Forwarded-Proto y la cookie
// Secure funcione cuando se sirve tras un reverse proxy HTTPS.
app.set('trust proxy', 1);

// Redis client para sesiones compartidas (SSO)
const redisClient = redis.createClient({
  host: '127.0.0.1',
  port: 6379,
  legacyMode: false
});
redisClient.connect().catch(e => console.error('[Redis]', e.message));

// ── Sesión (express-session + Redis store para SSO compartido) ────────────
// cookie.secure = true solo cuando se sirve tras HTTPS (reverse proxy con TLS).
// Activar con COOKIE_SECURE=true en .env cuando el vhost HTTPS esté activo.
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const sessionConfig = {
  store: new RedisStore({ client: redisClient }),
  secret: 'adaria-sso-secret-2026',
  name: 'adaria_session',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: 8 * 60 * 60 * 1000
  }
};

app.use(session(sessionConfig));

const requireAuth = auth.requireAuth({ loginPath: '/login.html' });
const requireAdmin = auth.requireAdmin({ loginPath: '/login.html' });

// admin.html va protegido por requireAdmin y por eso su ruta explícita se
// registra ANTES de montar express.static: si static se montara primero,
// serviría el fichero admin.html directamente (existe físicamente en
// public/) sin pasar nunca por el guard, dejándolo accesible a cualquiera.
app.get('/admin.html', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Estáticos SIN servir index.html automáticamente: todo el módulo (incluido
// el tablero de plazas) queda detrás de login, así que '/' se gestiona con
// una ruta explícita más abajo en vez de dejar que express.static lo sirva.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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

// Plaza bonificada (cortesía, vehículos de servicio, dirección…): nunca se cobra.
// Calcado de btr_parking_siente/app/server.js esBonificado().
function esBonificado(metodo) {
  return String(metodo || '').toLowerCase() === 'bonificado';
}

// --- Autenticación -----------------------------------------------------------

// POST /api/login — valida contra la tabla `usuario` propia (bcrypt puro).
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }
  try {
    const r = await auth.authenticate(pool, username, password);
    if (!r.ok) {
      await auth.auditLog(pool, {
        usuario: String(username).toLowerCase().trim(),
        accion: 'login_fallido',
        detalle: null,
        ip: req.ip,
      });
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    req.session.regenerate((err) => {
      if (err) {
        console.error('[POST /api/login] session.regenerate:', err.message);
        return res.status(500).json({ error: 'Error de autenticación' });
      }
      req.session.user = r.user;
      auth.auditLog(pool, {
        usuario: r.user.username,
        accion: 'login',
        detalle: { rol: r.user.rol },
        ip: req.ip,
      });
      res.json({ ok: true, username: r.user.username, rol: r.user.rol });
    });
  } catch (err) {
    console.error('[POST /api/login]', err);
    res.status(500).json({ error: 'Error de autenticación' });
  }
});

// POST /api/logout
app.post('/api/logout', requireAuth, async (req, res) => {
  const username = req.user.username;
  await auth.auditLog(pool, { usuario: username, accion: 'logout', ip: req.ip });
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/me
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, rol: req.user.rol });
});

// --- API: tablero de plazas -------------------------------------------------

app.get('/api/version', (req, res) => res.json({ version: require('./package.json').version }));

// Ruta para ver el changelog
app.get('/changelog', (req, res) => {
  try {
    const changelogPath = path.join(__dirname, 'VERSION', 'changelog.json');
    const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));

    let html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Historial de versiones - ${changelog.app}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1000px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
    .version-entry { margin: 20px 0; padding: 15px; border-left: 4px solid #0066cc; background: #f9f9f9; }
    .version-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .version-num { font-weight: bold; font-size: 18px; color: #0066cc; }
    .version-date { color: #666; font-size: 14px; }
    .version-title { font-weight: 600; color: #333; margin: 5px 0; }
    .version-sha { font-family: monospace; color: #999; font-size: 12px; }
    .version-body { color: #555; line-height: 1.6; white-space: pre-wrap; word-break: break-word; font-size: 14px; margin-top: 8px; }
    .meta { text-align: center; color: #999; font-size: 12px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Historial de versiones: ${changelog.app}</h1>
`;

    changelog.versiones.forEach(v => {
      html += `
    <div class="version-entry">
      <div class="version-header">
        <div>
          <div class="version-num">v${v.version}</div>
          <div class="version-title">${v.titulo}</div>
        </div>
        <div class="version-date">${v.fecha}</div>
      </div>
      <div class="version-sha">SHA: ${v.sha}</div>
      ${v.resumen ? `<div class="version-body">${v.resumen}</div>` : ''}
    </div>
`;
    });

    html += `
    <div class="meta">Generado: ${changelog.generado}</div>
  </div>
</body>
</html>
`;

    res.send(html);
  } catch (err) {
    console.error('[changelog] Error:', err.message);
    res.status(500).send(`<h1>Error cargando changelog</h1><p>${err.message}</p>`);
  }
});

app.get('/api/plazas', requireAuth, async (req, res) => {
  try {
    // LEFT JOIN LATERAL (calcado de btr_parking_siente/app/server.js): coge
    // siempre la última fila activa/bloqueada de la plaza, aunque llegara a
    // haber más de una (la lógica de negocio lo evita, pero así no falla).
    const { rows } = await pool.query(`
      SELECT p.numero,
             a.id AS asignacion_id,
             a.estado AS asignacion_estado,
             a.habitacion,
             a.huesped_nombre,
             a.fecha_entrada,
             a.fecha_salida,
             a.noches,
             a.tarifa_dia,
             a.importe_total,
             a.cobrado,
             a.origen,
             a.notas,
             a.motivo_bloqueo
      FROM plazas p
      LEFT JOIN LATERAL (
        SELECT * FROM asignaciones
        WHERE plaza_numero = p.numero AND estado IN ('activa', 'bloqueada')
        ORDER BY creado_en DESC LIMIT 1
      ) a ON TRUE
      ORDER BY p.numero
    `);
    const plazas = rows.map((r) => {
      const estado = !r.asignacion_id ? 'libre' : (r.asignacion_estado === 'bloqueada' ? 'bloqueada' : 'ocupada');
      return {
        numero: r.numero,
        estado,
        asignacion: estado === 'ocupada'
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
        bloqueo: estado === 'bloqueada'
          ? { id: r.asignacion_id, motivo: r.motivo_bloqueo }
          : null,
      };
    });
    res.json({ total: TOTAL_PLAZAS, plazas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer el tablero de plazas' });
  }
});

// --- API: ajustes (tarifa) ---------------------------------------------------

app.get('/api/ajustes', requireAuth, async (req, res) => {
  try {
    const tarifa = await getTarifaDia();
    res.json({ tarifaDiaEur: tarifa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer los ajustes' });
  }
});

app.put('/api/ajustes', requireAuth, async (req, res) => {
  try {
    const tarifa = toNumber(req.body.tarifaDiaEur, null);
    if (tarifa === null || tarifa <= 0) {
      return res.status(400).json({ error: 'tarifaDiaEur debe ser un número positivo' });
    }
    await pool.query(
      "INSERT INTO ajustes(clave, valor) VALUES ('tarifa_dia_eur', $1) ON CONFLICT (clave) DO UPDATE SET valor = $1",
      [String(tarifa)]
    );
    await auth.auditLog(pool, {
      usuario: req.user.username,
      accion: 'ajustes_tarifa',
      detalle: { tarifaDiaEur: tarifa },
      ip: req.ip,
    });
    res.json({ tarifaDiaEur: tarifa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar los ajustes' });
  }
});

// --- API: búsqueda en ACI (solo lectura) ------------------------------------

app.get('/api/aci/habitacion/:numero', requireAuth, async (req, res) => {
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

app.post('/api/plazas/:numero/asignar', requireAuth, async (req, res) => {
  const numero = parseInt(req.params.numero, 10);
  if (!Number.isInteger(numero) || numero < 1 || numero > TOTAL_PLAZAS) {
    return res.status(400).json({ error: 'Número de plaza no válido' });
  }
  const {
    habitacion, huespedNombre, fechaEntrada, fechaSalida, origen, notas,
    tarifaDia: tarifaDiaBody, importeTotal: importeTotalBody, metodoPago, cobrado,
  } = req.body;
  if (!fechaEntrada || !fechaSalida) {
    return res.status(400).json({ error: 'fechaEntrada y fechaSalida son obligatorias' });
  }
  if (new Date(fechaSalida) < new Date(fechaEntrada)) {
    return res.status(400).json({ error: 'La fecha de salida no puede ser anterior a la de entrada' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ocupadaOBloqueada = await client.query(
      "SELECT id, estado FROM asignaciones WHERE plaza_numero = $1 AND estado IN ('activa', 'bloqueada')",
      [numero]
    );
    if (ocupadaOBloqueada.rows.length > 0) {
      await client.query('ROLLBACK');
      const yaBloqueada = ocupadaOBloqueada.rows[0].estado === 'bloqueada';
      return res.status(409).json({ error: yaBloqueada ? 'La plaza está bloqueada' : 'La plaza ya está ocupada' });
    }

    const noches = calcularNoches(fechaEntrada, fechaSalida);
    // Tarifa: la global por defecto, salvo que venga una específica para esta estancia.
    const tarifaOverride = toNumber(tarifaDiaBody, null);
    const tarifaDia = tarifaOverride !== null && tarifaOverride > 0 ? tarifaOverride : await getTarifaDia();

    // Importe: bonificada = 0 € siempre; si no, el explícito del formulario o el
    // autocalculado (tarifa × noches). Calcado de btr_parking_siente esBonificado().
    const importeOverride = toNumber(importeTotalBody, null);
    const importeTotal = esBonificado(metodoPago)
      ? 0
      : (importeOverride !== null ? Math.round(importeOverride * 100) / 100 : Math.round(noches * tarifaDia * 100) / 100);

    const insert = await client.query(
      `INSERT INTO asignaciones
        (plaza_numero, habitacion, huesped_nombre, fecha_entrada, fecha_salida, noches, tarifa_dia, importe_total, estado, cobrado, metodo_pago, origen, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'activa',$9,$10,$11,$12)
       RETURNING *`,
      [
        numero, habitacion || null, huespedNombre || null, fechaEntrada, fechaSalida, noches, tarifaDia, importeTotal,
        cobrado === true || cobrado === 'true' || cobrado === 1,
        metodoPago || null,
        origen || 'manual', notas || null,
      ]
    );
    await client.query('COMMIT');
    await auth.auditLog(pool, {
      usuario: req.user.username,
      accion: 'asignar',
      plazaId: numero,
      asignacionId: insert.rows[0].id,
      detalle: { habitacion, huespedNombre, fechaEntrada, fechaSalida, importeTotal, metodoPago: metodoPago || null, origen: origen || 'manual' },
      ip: req.ip,
    });
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

app.post('/api/plazas/:numero/liberar', requireAuth, async (req, res) => {
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
    await auth.auditLog(pool, {
      usuario: req.user.username,
      accion: 'liberar',
      plazaId: numero,
      asignacionId: result.rows[0].id,
      detalle: null,
      ip: req.ip,
    });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al liberar la plaza' });
  }
});

// --- API: bloquear / desbloquear plaza ---------------------------------------
// Patrón calcado de btr_parking_siente/app/server.js (POST .../bloquear y
// .../desbloquear): una plaza bloqueada usa la misma tabla que una ocupación
// normal (estado='bloqueada' en vez de 'activa'), sin huésped ni fechas reales
// de estancia — solo motivo. No es facturable (noches/tarifa/importe a 0).

app.post('/api/plazas/:numero/bloquear', requireAuth, async (req, res) => {
  const numero = parseInt(req.params.numero, 10);
  if (!Number.isInteger(numero) || numero < 1 || numero > TOTAL_PLAZAS) {
    return res.status(400).json({ error: 'Número de plaza no válido' });
  }
  const motivo = String((req.body && req.body.motivo) || '').trim();
  if (!motivo) {
    return res.status(400).json({ error: 'El motivo es obligatorio' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      "SELECT id FROM asignaciones WHERE plaza_numero = $1 AND estado IN ('activa', 'bloqueada')",
      [numero]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La plaza ya está ocupada o bloqueada' });
    }

    const hoy = new Date().toISOString().slice(0, 10);
    const insert = await client.query(
      `INSERT INTO asignaciones
        (plaza_numero, estado, motivo_bloqueo, fecha_entrada, fecha_salida, noches, tarifa_dia, importe_total, origen)
       VALUES ($1, 'bloqueada', $2, $3, $3, 0, 0, 0, 'manual')
       RETURNING *`,
      [numero, motivo, hoy]
    );
    await client.query('COMMIT');
    await auth.auditLog(pool, {
      usuario: req.user.username,
      accion: 'bloquear',
      plazaId: numero,
      asignacionId: insert.rows[0].id,
      detalle: { motivo },
      ip: req.ip,
    });
    res.status(201).json(insert.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al bloquear la plaza' });
  } finally {
    client.release();
  }
});

app.post('/api/plazas/:numero/desbloquear', requireAuth, async (req, res) => {
  const numero = parseInt(req.params.numero, 10);
  if (!Number.isInteger(numero) || numero < 1 || numero > TOTAL_PLAZAS) {
    return res.status(400).json({ error: 'Número de plaza no válido' });
  }
  try {
    const result = await pool.query(
      `UPDATE asignaciones
       SET estado = 'liberada', liberado_en = now()
       WHERE plaza_numero = $1 AND estado = 'bloqueada'
       RETURNING *`,
      [numero]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'La plaza no está bloqueada' });
    }
    await auth.auditLog(pool, {
      usuario: req.user.username,
      accion: 'desbloquear',
      plazaId: numero,
      asignacionId: result.rows[0].id,
      detalle: null,
      ip: req.ip,
    });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al desbloquear la plaza' });
  }
});

// --- API: mover ocupación de una plaza a otra ---------------------------------
// Traslada la asignación ACTIVA (con huésped) de la plaza :numero a otra plaza
// libre, conservando fechas/tarifa/importe/cobrado. Patrón calcado de
// btr_parking_siente/app/server.js POST /api/plazas/:id/mover (sin la parte de
// cargador eléctrico: Vera no tiene esa integración, fuera de alcance).

app.post('/api/plazas/:numero/mover', requireAuth, async (req, res) => {
  const numero = parseInt(req.params.numero, 10);
  const destinoNumero = parseInt(req.body && req.body.destinoNumero, 10);
  if (!Number.isInteger(numero) || numero < 1 || numero > TOTAL_PLAZAS ||
      !Number.isInteger(destinoNumero) || destinoNumero < 1 || destinoNumero > TOTAL_PLAZAS) {
    return res.status(400).json({ error: 'Número de plaza no válido' });
  }
  if (numero === destinoNumero) {
    return res.status(400).json({ error: 'Origen y destino son la misma plaza' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const origen = await client.query(
      "SELECT * FROM asignaciones WHERE plaza_numero = $1 AND estado = 'activa'",
      [numero]
    );
    if (origen.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'La plaza de origen no tiene una ocupación activa' });
    }

    const ocupadoDestino = await client.query(
      "SELECT id FROM asignaciones WHERE plaza_numero = $1 AND estado IN ('activa', 'bloqueada')",
      [destinoNumero]
    );
    if (ocupadoDestino.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La plaza de destino ya está ocupada o bloqueada' });
    }

    const asignacionId = origen.rows[0].id;
    const result = await client.query(
      `UPDATE asignaciones SET plaza_numero = $2 WHERE id = $1 RETURNING *`,
      [asignacionId, destinoNumero]
    );

    await client.query('COMMIT');
    await auth.auditLog(pool, {
      usuario: req.user.username,
      accion: 'mover',
      plazaId: numero,
      asignacionId,
      detalle: { origen: numero, destino: destinoNumero },
      ip: req.ip,
    });
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al mover la plaza' });
  } finally {
    client.release();
  }
});

// --- API: marcar como cobrada --------------------------------------------------

app.post('/api/asignaciones/:id/cobrar', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await pool.query(
      `UPDATE asignaciones SET cobrado = true WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asignación no encontrada' });
    }
    await auth.auditLog(pool, {
      usuario: req.user.username,
      accion: 'cobro',
      plazaId: result.rows[0].plaza_numero,
      asignacionId: id,
      detalle: null,
      ip: req.ip,
    });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al marcar como cobrada' });
  }
});

// --- API: editar cobro (método de pago, importe, pagado) ----------------------
// Calcado de btr_parking_siente/app/server.js PATCH /api/ocupacion/:id/cobro:
// SIN restricción de estado -- permite editar el cobro de una asignación YA
// LIBERADA (cerrada), no solo mientras está activa. Es la vía para corregir un
// cobro después del check-out (importe mal anotado, cambio de método de pago…).
app.patch('/api/asignaciones/:id/cobro', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { importeTotal, cobrado, metodoPago, tarifaDia } = req.body || {};
  // Si se marca bonificado, el importe pasa a 0 aunque no venga en el body.
  const importeNum = toNumber(importeTotal, null);
  const importeEfectivo = esBonificado(metodoPago) ? 0 : importeNum;
  const tarifaNum = toNumber(tarifaDia, null);

  try {
    const { rows } = await pool.query(
      `UPDATE asignaciones SET
          importe_total = COALESCE($1, importe_total),
          cobrado       = COALESCE($2, cobrado),
          metodo_pago   = COALESCE($3, metodo_pago),
          tarifa_dia    = COALESCE($4, tarifa_dia)
       WHERE id = $5
       RETURNING *`,
      [
        importeEfectivo,
        cobrado !== undefined ? (cobrado === true || cobrado === 'true' || cobrado === 1) : null,
        metodoPago !== undefined && metodoPago !== '' ? metodoPago : null,
        tarifaNum,
        id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Asignación no encontrada' });
    await auth.auditLog(pool, {
      usuario: req.user.username,
      accion: 'cobro',
      plazaId: rows[0].plaza_numero,
      asignacionId: id,
      detalle: { importeTotal, cobrado, metodoPago, tarifaDia, estado: rows[0].estado },
      ip: req.ip,
    });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PATCH /api/asignaciones/:id/cobro]', err.message);
    res.status(500).json({ error: 'Error al actualizar el cobro' });
  }
});

// --- API: recaudación (resumen de un rango de fechas) --------------------------
// Calcado de btr_parking_siente/app/server.js GET /api/recaudacion: suma los
// importes REALES (importe_total ya editado, no una tarifa nominal) de las
// asignaciones cuya fecha_entrada cae en el rango. Excluye 'bloqueada' (importe
// siempre 0, no factura). Sin filtros -> mes en curso, como en BTR.
app.get('/api/recaudacion', requireAuth, async (req, res) => {
  const { desde, hasta } = req.query;
  const desdeVal = desde || new Date().toISOString().slice(0, 7) + '-01';
  const hastaVal = hasta || '2099-12-31';
  try {
    const { rows } = await pool.query(
      `SELECT
          COUNT(*)                                                      AS total_estancias,
          COUNT(*) FILTER (WHERE cobrado = TRUE)                        AS pagadas,
          COUNT(*) FILTER (WHERE cobrado = FALSE AND estado = 'activa')  AS pendientes,
          COALESCE(SUM(importe_total), 0)                                AS total_importe,
          COALESCE(SUM(importe_total) FILTER (WHERE cobrado = TRUE), 0)  AS cobrado,
          COALESCE(SUM(importe_total) FILTER (
            WHERE cobrado = FALSE AND estado = 'activa'), 0)             AS pendiente
       FROM asignaciones
       WHERE fecha_entrada >= $1 AND fecha_entrada <= $2
         AND estado IN ('activa', 'liberada')`,
      [desdeVal, hastaVal]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[GET /api/recaudacion]', err.message);
    res.status(500).json({ error: 'Error al calcular la recaudación' });
  }
});

// --- API: histórico ------------------------------------------------------------

app.get('/api/asignaciones', requireAuth, async (req, res) => {
  try {
    const { estado, desde, hasta } = req.query;
    const params = [];
    const condiciones = [];
    if (estado) {
      params.push(estado);
      condiciones.push(`estado = $${params.length}`);
    }
    if (desde) {
      params.push(desde);
      condiciones.push(`fecha_entrada >= $${params.length}`);
    }
    if (hasta) {
      params.push(hasta);
      condiciones.push(`fecha_entrada <= $${params.length}`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
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

// ════════════════════════════════════════════════════════════════
// API — ADMINISTRACIÓN DE USUARIOS (solo rol admin)
// Protecciones calcadas de btr_parking_siente: un admin no puede
// autodesactivarse, no puede autodegradarse, y nunca puede quedar la
// tabla con 0 admins activos.
// ════════════════════════════════════════════════════════════════

app.get('/api/admin/usuarios', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, rol, activo, creado_at, creado_por FROM usuario ORDER BY id ASC'
    );
    res.json(rows);
  } catch (e) {
    console.error('[GET /api/admin/usuarios]', e.message);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

app.post('/api/admin/usuarios', requireAdmin, async (req, res) => {
  const { username, password, rol } = req.body || {};
  if (!username || !password || !rol) {
    return res.status(400).json({ error: 'Faltan campos: username, password, rol' });
  }
  if (!['admin', 'operador'].includes(rol)) {
    return res.status(400).json({ error: 'rol debe ser admin u operador' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO usuario (username, password_hash, rol, activo, creado_por)
       VALUES ($1, $2, $3, TRUE, $4)
       RETURNING id, username, rol, activo, creado_at, creado_por`,
      [String(username).toLowerCase().trim(), hash, rol, req.user.username]
    );
    await auth.auditLog(pool, {
      usuario: req.user.username,
      accion: 'usuario_crear',
      detalle: { username: rows[0].username, rol },
      ip: req.ip,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'El nombre de usuario ya existe' });
    }
    console.error('[POST /api/admin/usuarios]', e.message);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

app.patch('/api/admin/usuarios/:id', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'ID inválido' });

  const { activo, rol, password } = req.body || {};
  const adminUsername = req.user.username;

  let target;
  try {
    const { rows } = await pool.query('SELECT * FROM usuario WHERE id = $1', [userId]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    target = rows[0];
  } catch (e) {
    return res.status(500).json({ error: 'Error al buscar usuario' });
  }

  // El admin no puede desactivarse ni degradarse a sí mismo.
  const isSelf = target.username === adminUsername;
  if (isSelf && activo === false) {
    return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
  }
  if (isSelf && rol && rol !== 'admin') {
    return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
  }

  // Nunca puede quedar la tabla con 0 admins activos.
  if (target.rol === 'admin' && (activo === false || (rol && rol !== 'admin'))) {
    const { rows: admins } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM usuario WHERE rol='admin' AND activo=TRUE AND id != $1`,
      [userId]
    );
    if (admins[0].cnt === 0) {
      return res.status(400).json({ error: 'Debe quedar al menos un administrador activo' });
    }
  }

  try {
    const sets = [];
    const vals = [];
    let idx = 1;

    if (activo !== undefined) { sets.push(`activo=$${idx++}`); vals.push(activo); }
    if (rol !== undefined) { sets.push(`rol=$${idx++}`); vals.push(rol); }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      sets.push(`password_hash=$${idx++}`);
      vals.push(hash);
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No hay cambios que aplicar' });

    vals.push(userId);
    const { rows } = await pool.query(
      `UPDATE usuario SET ${sets.join(', ')} WHERE id=$${idx}
       RETURNING id, username, rol, activo, creado_at, creado_por`,
      vals
    );

    const accion = password ? 'usuario_reset_password'
                 : activo !== undefined ? (activo ? 'usuario_activar' : 'usuario_desactivar')
                 : 'usuario_cambiar_rol';
    await auth.auditLog(pool, {
      usuario: adminUsername,
      accion,
      detalle: { username: target.username, cambios: { activo, rol, password_reset: !!password } },
      ip: req.ip,
    });

    res.json(rows[0]);
  } catch (e) {
    console.error('[PATCH /api/admin/usuarios]', e.message);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// Filtros opcionales (desde, hasta, usuario, accion) + paginación con total,
// calcado del contrato de btr_parking_siente/app/server.js GET /api/admin/auditoria.
app.get('/api/admin/auditoria', requireAdmin, async (req, res) => {
  const { desde, hasta, usuario, accion } = req.query;
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);

  const conds = [];
  const vals = [];
  let idx = 1;

  if (desde) { conds.push(`creado_at >= $${idx++}`); vals.push(desde); }
  if (hasta) { conds.push(`creado_at <= $${idx++} + INTERVAL '1 day'`); vals.push(hasta); }
  if (usuario) { conds.push(`usuario ILIKE $${idx++}`); vals.push(`%${usuario}%`); }
  if (accion) { conds.push(`accion ILIKE $${idx++}`); vals.push(`%${accion}%`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const valsConWhere = vals.slice();
  vals.push(limit, offset);

  try {
    const { rows } = await pool.query(
      `SELECT id, usuario, accion, plaza_id, ocupacion_id, detalle, ip, creado_at
       FROM audit_log ${where}
       ORDER BY creado_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      vals
    );
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM audit_log ${where}`,
      valsConWhere
    );
    res.json({ total: cnt[0].total, offset, limit, rows });
  } catch (e) {
    console.error('[GET /api/admin/auditoria]', e.message);
    res.status(500).json({ error: 'Error al leer la auditoría' });
  }
});

// ════════════════════════════════════════════════════════════════
// Páginas — todo el módulo detrás de login
// ════════════════════════════════════════════════════════════════

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.redirect('/login.html');
});

app.get('/halo', (req, res) => res.json({ ok: true, modulo: 'parking', timestamp: Date.now(), version: require('./package.json').version }));

async function start() {
  try {
    await auth.ensureAuthTables(pool);
  } catch (e) {
    console.error('[ensureAuthTables] Error:', e.message);
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Adaria Parking escuchando en 0.0.0.0:${PORT}`);
  });
}

start();
