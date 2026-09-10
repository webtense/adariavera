'use strict';

// Adaria Pre check-in online — Hotel Adaria Vera — v1.2.0
//
// REGLA DE ORO: este servicio LEE reservas de ACI Dali con SELECT y nada más
// (ver aci.js). Los datos que rellena el huésped se guardan EXCLUSIVAMENTE en
// su propia base PostgreSQL (precheckin_adaria, ver db.js / init.sql).
// Notificaciones solo por email, nunca WhatsApp (ver mail.js).
//
// v1.2.0 (10/09/2026) fusiona dos líneas de trabajo que habían divergido:
//  - FASE 3 (commit 37668bf, 26/08/2026): PROPERTY_MAP + requireProperty(),
//    reintentos con traza (precheckin_notificacion_log / _cron_log) y panel
//    /admin/errores. Nunca se había desplegado a producción.
//  - mail.js real (28/08/2026, ya en producción): envío SMTP real con
//    nodemailer, redirección a buzón de pruebas en SEND_MODE=test y copia de
//    auditoría (BCC) en ambos modos.
// mail.js NO se toca en esta fusión: su lógica de envío real manda sobre la
// de FASE 3 (que solo escribía a log, sin SMTP implementado todavía). Los
// gates PRECHECKIN_EMAIL_ENABLED/WRITE/ALTA quedan los tres como reservados
// sin cablear a ningún código (ver bloque de gates más abajo) — el envío de
// email real lo sigue controlando SEND_MODE dentro de mail.js, sin cambios.

try { require('dotenv').config(); } catch (e) { /* systemd ya inyecta el .env */ }

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const { pool } = require('./db');
const aci = require('./aci');
const mail = require('./mail');

const VERSION = '1.2.0';
const PORT = parseInt(process.env.PORT || '3095', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-esto-precheckin';
const ADMIN_USER = (process.env.ADMIN_USER || '').trim().toLowerCase();
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

const TIPOS_DOCUMENTO = ['DNI', 'NIE', 'PASAPORTE', 'OTRO'];

// ─── FASE 3 — Gates, todos reservados y SIN CABLEAR a ningún código ────────
//
// Los tres (PRECHECKIN_EMAIL_ENABLED, PRECHECKIN_WRITE, PRECHECKIN_ALTA) se
// dejan aquí solo por continuidad de nombre con btr_gestion_portal (mismo
// patrón de gates que el resto del ecosistema Adaria/BTR). Ninguno cambia
// comportamiento real hoy:
//  - PRECHECKIN_EMAIL_ENABLED: el diseño original de FASE 3 lo cableaba
//    DENTRO de mail.js para bloquear el envío. Producción evolucionó mail.js
//    en paralelo (28/08) con su propio mecanismo real (SEND_MODE test/live +
//    redirección a buzón de pruebas + BCC de auditoría) que NO consulta este
//    gate. Para no regresar ese mail.js real, este gate se deja reservado y
//    sin cablear — el control real de envío sigue siendo SEND_MODE en
//    mail.js, sin cambios.
//  - PRECHECKIN_WRITE / PRECHECKIN_ALTA: igual que en el diseño original —
//    esta app sigue siendo SOLO LECTURA contra ACI (no hay usuario adaria_rw
//    ni conector de escritura verificado; Tarea E sigue bloqueada).
const EMAIL_ENABLED = String(process.env.PRECHECKIN_EMAIL_ENABLED ?? 'false').toLowerCase() === 'true'; // reservado, no gatea mail.js — ver nota arriba
const PRECHECKIN_WRITE = String(process.env.PRECHECKIN_WRITE ?? 'false').toLowerCase() === 'true'; // reservado, sin implementación
const PRECHECKIN_ALTA = String(process.env.PRECHECKIN_ALTA ?? 'false').toLowerCase() === 'true'; // reservado, sin implementación

// ─── Filtrado por propiedad ─────────────────────────────────────────────────
// Hoy solo hay una propiedad conectada (Vera Adaria, BD ACI AdariaVeraHotel).
// Se deja el mapa y el middleware ya montados para cuando entre la segunda
// (Monasterio de Poblet, prevista sep-2026): las reservas ya se guardan con
// su `property` (migración 002, ya aplicada en la BD real — columna con
// DEFAULT 'adaria', así que todo lo existente ya queda cubierto sin
// migración de datos) y las rutas de admin ya filtran, así que activar una
// propiedad nueva no exige tocar las rutas, solo el mapa y la sesión del
// usuario que la vaya a ver.
const PROPERTY_MAP = {
  adaria: 'Hotel Adaria Vera',
  // poblet: 'Monasterio de Poblet',  // reservado — sin conector ACI todavía (Tarea E)
};

/**
 * Propiedades a las que puede acceder el usuario de la sesión. Con un único
 * login (`recepcion`) y una única propiedad operativa, hoy siempre es
 * ['adaria']; en cuanto haya más de un usuario/propiedad esto pasa a leerse
 * de la ficha del usuario en vez de asumirse.
 */
function propiedadesDeUsuario(user) {
  if (user && Array.isArray(user.properties) && user.properties.length) return user.properties;
  return ['adaria'];
}

/**
 * Middleware: exige que la sesión tenga acceso a al menos una de las
 * propiedades indicadas. Inyecta `req.properties` (SIEMPRE desde la sesión,
 * nunca desde el body/query) con la intersección para que las consultas
 * filtren por `property = ANY($1)`.
 */
function requireProperty(allowed) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'no_autenticado' });
    const propias = propiedadesDeUsuario(req.session.user);
    const interseccion = propias.filter((p) => allowed.includes(p));
    if (!interseccion.length) {
      return res.status(403).json({ error: 'sin_acceso_a_propiedad' });
    }
    req.properties = interseccion;
    next();
  };
}

// ─── Notificaciones con traza (para el cron de reintentos y el panel) ──────
// Registra el intento en precheckin_notificacion_log ANTES de intentar
// enviar (así una caída del proceso entre el intento y el registro no deja
// un envío fantasma sin traza) y actualiza el resultado después. Un mismo
// `tipo` por reserva es idempotente (UNIQUE reserva_id,tipo): reenviar el
// mismo pre check-in solo actualiza el intento, no duplica filas.
//
// Adaptado al mail.js REAL (no al de FASE 3): mail.notify() de producción
// devuelve { enviado, modo, to, messageId?, error? } — sin campo `motivo`.
// Aquí se usa `modo` (test|live|sin_smtp|sin_destinatario|error) como motivo
// para el panel de errores; sigue siendo el mismo dato útil, solo con el
// nombre de campo real.
async function registrarYNotificar(reservaId, tipo, { asunto, cuerpo }) {
  await pool.query(
    `INSERT INTO precheckin_notificacion_log (reserva_id, tipo, intentos, estado, ultimo_intento_en)
     VALUES ($1, $2, 1, 'pendiente', now())
     ON CONFLICT (reserva_id, tipo) DO UPDATE SET
       intentos = precheckin_notificacion_log.intentos + 1,
       estado = 'pendiente',
       ultimo_intento_en = now()`,
    [reservaId, tipo]
  );
  let resultado;
  try {
    resultado = await mail.notify({ asunto, cuerpo });
  } catch (err) {
    resultado = { enviado: false, modo: 'excepcion', error: String(err.message || err) };
    await pool.query(
      `UPDATE precheckin_notificacion_log SET estado = 'error', motivo = $2, detalle = $3
       WHERE reserva_id = $1 AND tipo = $4`,
      [reservaId, 'excepcion', String(err.message || err), tipo]
    );
    throw err;
  }
  const estado = resultado.enviado ? 'enviado' : 'error';
  const motivo = resultado.modo || resultado.error || null;
  await pool.query(
    `UPDATE precheckin_notificacion_log SET estado = $2, motivo = $3
     WHERE reserva_id = $1 AND tipo = $4`,
    [reservaId, estado, motivo, tipo]
  );
  return resultado;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 8 },
}));

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ─── Layout admin (paleta Vera, igual que adaria-gestion) ─────────────────────
const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>%F0%9F%93%9D</text></svg>";

function layout(title, body, user) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<link rel="icon" href="${FAVICON}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Pre check-in · Hotel Adaria Vera</title>
<style>
:root{--od:#1b5e75;--om:#2d8aa3;--ol:#5ba8c7;--tc:#c67c6f;--off:#f8f9fa;--ch:#333}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:var(--ch);background:var(--off)}
.top{background:linear-gradient(135deg,var(--od),var(--om));color:#fff;padding:14px 24px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.top .b{font-size:17px;font-weight:700}.top .b span{font-size:21px;margin-right:6px}
.top .r{margin-left:auto;font-size:13px}.top .r a{color:#fff;margin-left:12px;opacity:.85;text-decoration:none}
.wrap{max-width:1100px;margin:0 auto;padding:26px 24px}
h1{color:var(--od);font-size:22px;margin-bottom:4px}.muted{color:#888;font-size:14px;margin-bottom:20px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.06);font-size:14px}
th{background:var(--od);color:#fff;text-align:left;padding:9px 12px;font-size:13px}
td{border-bottom:1px solid #eee;padding:9px 12px;vertical-align:top}
.btn{background:var(--od);color:#fff;border:none;border-radius:8px;padding:7px 13px;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
.btn:hover{background:var(--om)}.btn.s{background:var(--tc)}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600}
.pill.ok{background:#e8f8ef;color:#27ae60}.pill.pend{background:#fef5e7;color:#b9770e}
.box{background:#fff;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.06);padding:18px;margin-bottom:20px}
.login{max-width:380px;margin:8vh auto;background:#fff;border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.18);padding:38px 34px}
.login .bar{height:5px;background:linear-gradient(90deg,var(--ol),var(--tc));border-radius:16px 16px 0 0;margin:-38px -34px 26px}
.login h2{color:var(--od);text-align:center;margin-bottom:4px}
.login .s{text-align:center;color:var(--om);font-size:13px;margin-bottom:22px;font-weight:600}
.login label{font-size:13px;font-weight:600;color:#555;display:block;margin:12px 0 5px}
.login input{width:100%;padding:8px 11px;border:1px solid #cfdde3;border-radius:8px;font-size:14px}
.login button{width:100%;margin-top:20px;background:var(--od);color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:600;cursor:pointer}
.err{background:#fdecea;color:#c0392b;padding:9px 12px;border-radius:8px;font-size:13px;margin-top:14px;text-align:center}
.ver{position:fixed;bottom:8px;right:12px;font-size:11px;color:#bbb}
</style></head><body>${user ? topbar(user) : ''}${body}<div class="ver">Pre check-in v${VERSION}</div></body></html>`;
}

function topbar(u) {
  return `<div class="top"><div class="b"><span>📝</span>Adaria Vera · Pre check-in</div>
   <div class="r">👤 ${esc(u.login)} <a href="/admin/logout">Salir</a></div></div>`;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/admin/login');
}

// ─── Salud ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'adaria-precheckin', version: VERSION, ts: new Date().toISOString() });
});

// ─── API pública (huésped) ──────────────────────────────────────────────────

// Busca la reserva por localizador+apellido o fecha de entrada+apellido.
// SOLO LECTURA contra ACI. No se guarda nada en este paso.
app.post('/api/buscar', async (req, res) => {
  try {
    const { codigo, fechaEntrada, apellido } = req.body || {};
    const reserva = await aci.buscarReserva({ codigoReserva: codigo, fechaEntrada, apellido });
    if (!reserva) return res.status(404).json({ ok: false, error: 'reserva_no_encontrada' });
    res.json({ ok: true, reserva });
  } catch (err) {
    const conocidos = ['apellido_requerido', 'localizador_o_fecha_requerido'];
    if (conocidos.includes(err.message)) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('[adaria-precheckin] Error consultando ACI:', err.message);
    res.status(503).json({ ok: false, error: 'aci_no_disponible' });
  }
});

function validarPersona(p) {
  const nombre = String((p && p.nombre) || '').trim().slice(0, 100);
  const apellido1 = String((p && p.apellido1) || '').trim().slice(0, 100);
  if (nombre.length < 2 || apellido1.length < 2) return null;
  const tipoDocumento = TIPOS_DOCUMENTO.includes((p && p.tipoDocumento) || '') ? p.tipoDocumento : null;
  return {
    esTitular: !!(p && p.esTitular),
    nombre,
    apellido1,
    apellido2: String((p && p.apellido2) || '').trim().slice(0, 100) || null,
    tipoDocumento,
    numeroDocumento: String((p && p.numeroDocumento) || '').trim().slice(0, 30) || null,
    fechaNacimiento: (p && p.fechaNacimiento) || null,
    nacionalidad: String((p && p.nacionalidad) || '').trim().slice(0, 60) || null,
  };
}

// Guarda el pre check-in. Vuelve a consultar ACI con el mismo localizador+apellido
// (nunca se fía del snapshot que manda el cliente) y solo entonces escribe en
// precheckin_adaria. Si ACI no responde en este paso, no se guarda nada: es
// preferible que el huésped reintente a guardar un pre check-in sin reserva
// verificada.
app.post('/api/precheckin', async (req, res) => {
  const body = req.body || {};
  const codigo = String(body.codigo || '').trim();
  const apellidoBusqueda = String(body.apellidoBusqueda || '').trim();
  const idioma = ['es', 'en', 'fr'].includes(body.idioma) ? body.idioma : 'es';
  const email = String((body.contacto && body.contacto.email) || '').trim().slice(0, 150) || null;
  const telefono = String((body.contacto && body.contacto.telefono) || '').trim().slice(0, 30) || null;
  const horaLlegada = /^\d{2}:\d{2}$/.test(body.horaLlegada || '') ? body.horaLlegada : null;
  const observaciones = String(body.observaciones || '').trim().slice(0, 1000) || null;

  const personasRaw = Array.isArray(body.personas) ? body.personas : [];
  const personas = personasRaw.map(validarPersona).filter(Boolean);

  if (!codigo && !body.fechaEntrada) {
    return res.status(400).json({ ok: false, error: 'localizador_o_fecha_requerido' });
  }
  if (personas.length === 0) {
    return res.status(400).json({ ok: false, error: 'personas_requeridas' });
  }

  let reserva;
  try {
    reserva = await aci.buscarReserva({
      codigoReserva: codigo,
      fechaEntrada: body.fechaEntrada,
      apellido: apellidoBusqueda,
    });
  } catch (err) {
    console.error('[adaria-precheckin] Error verificando reserva en ACI:', err.message);
    return res.status(503).json({ ok: false, error: 'aci_no_disponible' });
  }
  if (!reserva) {
    return res.status(404).json({ ok: false, error: 'reserva_no_encontrada' });
  }

  const codigoFinal = reserva.codigo || codigo || ('SIN-COD-' + reserva.resGuid);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO precheckin_reserva
         (res_guid, codigo, apellido_busqueda, titular_nombre, titular_apellido,
          habitacion, fecha_entrada, fecha_salida, pax, email, telefono,
          hora_llegada_estimada, observaciones, idioma, property, actualizado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       ON CONFLICT (codigo) DO UPDATE SET
          apellido_busqueda = EXCLUDED.apellido_busqueda,
          titular_nombre = EXCLUDED.titular_nombre,
          titular_apellido = EXCLUDED.titular_apellido,
          habitacion = EXCLUDED.habitacion,
          fecha_entrada = EXCLUDED.fecha_entrada,
          fecha_salida = EXCLUDED.fecha_salida,
          pax = EXCLUDED.pax,
          email = EXCLUDED.email,
          telefono = EXCLUDED.telefono,
          hora_llegada_estimada = EXCLUDED.hora_llegada_estimada,
          observaciones = EXCLUDED.observaciones,
          idioma = EXCLUDED.idioma,
          property = EXCLUDED.property,
          actualizado_en = now()
       RETURNING id`,
      [reserva.resGuid, codigoFinal, apellidoBusqueda, reserva.titularNombre, reserva.titularApellido,
       reserva.habitacion, reserva.entrada, reserva.salida, reserva.pax, email, telefono,
       horaLlegada, observaciones, idioma, 'adaria']
    );
    const reservaId = r.rows[0].id;

    await client.query('DELETE FROM precheckin_persona WHERE reserva_id = $1', [reservaId]);
    for (const p of personas) {
      await client.query(
        `INSERT INTO precheckin_persona
           (reserva_id, es_titular, nombre, apellido1, apellido2, tipo_documento,
            numero_documento, fecha_nacimiento, nacionalidad)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [reservaId, p.esTitular, p.nombre, p.apellido1, p.apellido2, p.tipoDocumento,
         p.numeroDocumento, p.fechaNacimiento, p.nacionalidad]
      );
    }
    await client.query('COMMIT');

    registrarYNotificar(reservaId, 'confirmacion_recepcion', {
      asunto: `Pre check-in recibido — reserva ${codigoFinal} — Adaria Vera`,
      cuerpo: `Reserva ${codigoFinal}\nHabitación: ${reserva.habitacion || '-'}\n` +
        `Entrada: ${reserva.entrada || '-'} · Salida: ${reserva.salida || '-'}\n` +
        `Personas registradas: ${personas.length}\nContacto: ${email || '-'} / ${telefono || '-'}\n` +
        `Hora estimada de llegada: ${horaLlegada || 'no indicada'}\n` +
        `Observaciones: ${observaciones || '-'}`,
    }).catch((e) => console.error('[adaria-precheckin] Error notificando:', e.message));
    // El fallo aquí no impide guardar el pre check-in (ya hizo COMMIT arriba):
    // registrarYNotificar deja constancia en precheckin_notificacion_log y el
    // cron de FASE 3 (cron_precheckin_mejoras.js) la recoge para reintentar.

    res.json({ ok: true, reservaId, codigo: codigoFinal });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[adaria-precheckin] Error guardando pre check-in:', err.message);
    res.status(500).json({ ok: false, error: 'error_guardando' });
  } finally {
    client.release();
  }
});

// ─── Estático (formulario público) ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Panel de recepción (login sencillo, usuario en .env) ──────────────────
app.get('/admin/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  const err = req.query.e ? '<div class="err">Usuario o contraseña incorrectos</div>' : '';
  res.send(layout('Acceso', `<div class="login"><div class="bar"></div><h2>📝 Pre check-in</h2>
    <div class="s">Hotel Adaria Vera</div>
    <form method="post" action="/admin/login">
      <label>Usuario</label><input name="u" autofocus autocomplete="username">
      <label>Contraseña</label><input name="p" type="password" autocomplete="current-password">
      <button>Entrar</button>${err}
    </form></div>`));
});

app.post('/admin/login', (req, res) => {
  const u = String(req.body.u || '').trim().toLowerCase();
  const p = String(req.body.p || '');
  const ok = ADMIN_USER && ADMIN_PASSWORD_HASH && u === ADMIN_USER && bcrypt.compareSync(p, ADMIN_PASSWORD_HASH);
  if (ok) {
    req.session.user = { login: u, properties: ['adaria'] };
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?e=1');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

app.get('/admin', requireAuth, requireProperty(['adaria']), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, codigo, titular_nombre, titular_apellido, habitacion,
              fecha_entrada, fecha_salida, pax, procesado, creado_en
       FROM precheckin_reserva WHERE property = ANY($1)
       ORDER BY fecha_entrada ASC NULLS LAST, creado_en DESC LIMIT 200`,
      [req.properties]
    );
    const filas = rows.map((r) => `<tr>
        <td><b>${esc(r.codigo)}</b></td>
        <td>${esc(r.titular_nombre)} ${esc(r.titular_apellido)}</td>
        <td>${esc(r.habitacion)}</td>
        <td>${r.fecha_entrada ? String(r.fecha_entrada).slice(0, 10) : '-'}</td>
        <td>${r.fecha_salida ? String(r.fecha_salida).slice(0, 10) : '-'}</td>
        <td>${r.pax}</td>
        <td>${r.procesado ? '<span class="pill ok">Procesado</span>' : '<span class="pill pend">Pendiente</span>'}</td>
        <td><a class="btn" href="/admin/${r.id}">Ver</a></td>
      </tr>`).join('');
    res.send(layout('Pre check-ins', `<div class="wrap"><h1>Pre check-ins recibidos</h1>
      <p class="muted">Últimos 200 registros, ordenados por fecha de entrada. · <a href="/admin/errores">⚠️ Panel de errores</a></p>
      <table><tr><th>Localizador</th><th>Titular</th><th>Hab.</th><th>Entrada</th><th>Salida</th><th>Pax</th><th>Estado</th><th></th></tr>
      ${filas || '<tr><td colspan="8">Sin pre check-ins todavía</td></tr>'}</table></div>`, req.session.user));
  } catch (err) {
    console.error('[adaria-precheckin] Error listando:', err.message);
    res.status(500).send('Error consultando la base de datos');
  }
});

// Panel de errores — FASE 3. Muestra lo que el cron de reintentos
// (cron_precheckin_mejoras.js) va dejando: notificaciones que no salieron
// (con motivo diferenciado), reservas con check-in a la vuelta de la esquina
// que nadie ha marcado como procesadas todavía, y el resumen de la última
// ejecución del cron (para saber que corre, no solo que existe el script).
app.get('/admin/errores', requireAuth, requireProperty(['adaria']), async (req, res) => {
  try {
    const { rows: notifs } = await pool.query(
      `SELECT n.id, n.tipo, n.intentos, n.estado, n.motivo, n.ultimo_intento_en,
              r.codigo, r.titular_nombre, r.titular_apellido
       FROM precheckin_notificacion_log n
       JOIN precheckin_reserva r ON r.id = n.reserva_id
       WHERE n.estado IN ('error','agotado','pendiente') AND r.property = ANY($1)
       ORDER BY n.ultimo_intento_en DESC NULLS LAST LIMIT 100`,
      [req.properties]
    );
    const { rows: proximas } = await pool.query(
      `SELECT id, codigo, titular_nombre, titular_apellido, habitacion, fecha_entrada
       FROM precheckin_reserva
       WHERE property = ANY($1) AND procesado = false
         AND fecha_entrada IS NOT NULL AND fecha_entrada <= (CURRENT_DATE + INTERVAL '2 days')
       ORDER BY fecha_entrada ASC LIMIT 100`,
      [req.properties]
    );
    const { rows: cronRuns } = await pool.query(
      `SELECT ejecutado_at, candidatos, reintentados, enviados, errores, agotados, proximas_sin_procesar, duracion_ms
       FROM precheckin_cron_log ORDER BY id DESC LIMIT 10`
    );
    const filasNotif = notifs.map((n) => `<tr>
        <td><b>${esc(n.codigo)}</b></td>
        <td>${esc(n.titular_nombre)} ${esc(n.titular_apellido)}</td>
        <td>${esc(n.tipo)}</td>
        <td>${n.intentos}</td>
        <td><span class="pill ${n.estado === 'error' ? 'pend' : ''}">${esc(n.estado)}</span></td>
        <td>${esc(n.motivo) || '-'}</td>
        <td>${n.ultimo_intento_en ? String(n.ultimo_intento_en).slice(0, 16).replace('T', ' ') : '-'}</td>
      </tr>`).join('');
    const filasProximas = proximas.map((r) => `<tr>
        <td><b>${esc(r.codigo)}</b></td>
        <td>${esc(r.titular_nombre)} ${esc(r.titular_apellido)}</td>
        <td>${esc(r.habitacion)}</td>
        <td>${r.fecha_entrada ? String(r.fecha_entrada).slice(0, 10) : '-'}</td>
        <td><a class="btn" href="/admin/${r.id}">Ver</a></td>
      </tr>`).join('');
    const filasCron = cronRuns.map((c) => `<tr>
        <td>${String(c.ejecutado_at).slice(0, 16).replace('T', ' ')}</td>
        <td>${c.candidatos}</td><td>${c.reintentados}</td><td>${c.enviados}</td>
        <td>${c.errores}</td><td>${c.agotados}</td><td>${c.proximas_sin_procesar}</td>
        <td>${c.duracion_ms != null ? c.duracion_ms + ' ms' : '-'}</td>
      </tr>`).join('');
    res.send(layout('Panel de errores', `<div class="wrap">
      <h1>⚠️ Panel de errores — Pre check-in</h1>
      <p class="muted">Gates: PRECHECKIN_EMAIL_ENABLED=${EMAIL_ENABLED} (reservado, no gatea envío — ver SEND_MODE en mail.js) · PRECHECKIN_WRITE=${PRECHECKIN_WRITE} (reservado, sin implementación) · PRECHECKIN_ALTA=${PRECHECKIN_ALTA} (reservado, sin implementación) · <a href="/admin">← Volver al listado</a></p>

      <div class="box"><h3 style="margin-bottom:8px">Notificaciones pendientes / con error</h3>
      <table><tr><th>Localizador</th><th>Titular</th><th>Tipo</th><th>Intentos</th><th>Estado</th><th>Motivo</th><th>Último intento</th></tr>
      ${filasNotif || '<tr><td colspan="7">Sin incidencias de notificación</td></tr>'}</table></div>

      <div class="box"><h3 style="margin-bottom:8px">Check-in en ≤2 días sin marcar como procesado</h3>
      <table><tr><th>Localizador</th><th>Titular</th><th>Hab.</th><th>Entrada</th><th></th></tr>
      ${filasProximas || '<tr><td colspan="5">Nada pendiente a la vista</td></tr>'}</table></div>

      <div class="box"><h3 style="margin-bottom:8px">Últimas ejecuciones del cron</h3>
      <table><tr><th>Ejecutado</th><th>Candidatos</th><th>Reintentados</th><th>Enviados</th><th>Errores</th><th>Agotados</th><th>Próx. sin procesar</th><th>Duración</th></tr>
      ${filasCron || '<tr><td colspan="8">El cron todavía no se ha ejecutado (cron_precheckin_mejoras.js)</td></tr>'}</table></div>
      </div>`, req.session.user));
  } catch (err) {
    console.error('[adaria-precheckin] Error panel de errores:', err.message);
    res.status(500).send('Error consultando la base de datos');
  }
});

app.get('/admin/:id', requireAuth, requireProperty(['adaria']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(404).send('No encontrado');
  try {
    const { rows } = await pool.query(
      'SELECT * FROM precheckin_reserva WHERE id = $1 AND property = ANY($2)', [id, req.properties]);
    if (!rows.length) return res.status(404).send('No encontrado');
    const r = rows[0];
    const { rows: personas } = await pool.query(
      'SELECT * FROM precheckin_persona WHERE reserva_id = $1 ORDER BY es_titular DESC, id ASC', [id]
    );
    const filasPersonas = personas.map((p) => `<tr>
        <td>${p.es_titular ? '⭐ ' : ''}${esc(p.nombre)} ${esc(p.apellido1)} ${esc(p.apellido2 || '')}</td>
        <td>${esc(p.tipo_documento)} ${esc(p.numero_documento)}</td>
        <td>${p.fecha_nacimiento ? String(p.fecha_nacimiento).slice(0, 10) : '-'}</td>
        <td>${esc(p.nacionalidad)}</td>
      </tr>`).join('');
    const btnProcesar = r.procesado
      ? `<span class="pill ok">Procesado por ${esc(r.procesado_por)} el ${String(r.procesado_en).slice(0, 16).replace('T', ' ')}</span>`
      : `<form method="post" action="/admin/${id}/procesar"><button class="btn s">Marcar como procesado</button></form>`;
    res.send(layout('Reserva ' + r.codigo, `<div class="wrap">
      <h1>Reserva ${esc(r.codigo)}</h1>
      <p class="muted">Habitación ${esc(r.habitacion)} · ${r.fecha_entrada ? String(r.fecha_entrada).slice(0, 10) : '-'} → ${r.fecha_salida ? String(r.fecha_salida).slice(0, 10) : '-'} · ${r.pax} pax</p>
      <div class="box">
        <p><b>Contacto:</b> ${esc(r.email) || '-'} · ${esc(r.telefono) || '-'}</p>
        <p><b>Hora estimada de llegada:</b> ${esc(r.hora_llegada_estimada) || 'no indicada'}</p>
        <p><b>Observaciones:</b> ${esc(r.observaciones) || '-'}</p>
        <p style="margin-top:10px">${btnProcesar}</p>
      </div>
      <table><tr><th>Persona</th><th>Documento</th><th>Nacimiento</th><th>Nacionalidad</th></tr>
      ${filasPersonas || '<tr><td colspan="4">Sin personas</td></tr>'}</table>
      <p style="margin-top:16px"><a class="btn" href="/admin">← Volver</a></p>
    </div>`, req.session.user));
  } catch (err) {
    console.error('[adaria-precheckin] Error detalle:', err.message);
    res.status(500).send('Error consultando la base de datos');
  }
});

app.post('/admin/:id/procesar', requireAuth, requireProperty(['adaria']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(404).send('No encontrado');
  try {
    await pool.query(
      `UPDATE precheckin_reserva SET procesado = true, procesado_por = $2, procesado_en = now()
       WHERE id = $1 AND procesado = false AND property = ANY($3)`,
      [id, req.session.user.login, req.properties]
    );
    res.redirect('/admin/' + id);
  } catch (err) {
    console.error('[adaria-precheckin] Error marcando procesado:', err.message);
    res.status(500).send('Error actualizando');
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[adaria-precheckin] Hotel Adaria Vera · Pre check-in v${VERSION} escuchando en http://${HOST}:${PORT}`);
});
