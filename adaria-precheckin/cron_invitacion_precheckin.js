#!/usr/bin/env node
'use strict';

// Se invoca desde crontab, igual que cron_precheckin_mejoras.js: hace falta
// cargar el .env a mano (systemd no está de por medio aquí).
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); }
catch (e) { /* dotenv no instalado: asumimos que el entorno ya trae las vars */ }

/**
 * Cron de invitación proactiva al pre check-in.
 * Ejecutar: node cron_invitacion_precheckin.js
 * Crontab sugerido (una vez al día, antes de que recepción abra):
 *   0 6 * * * cd /opt/adaria-precheckin && node cron_invitacion_precheckin.js >> logs/cron-invitacion.log 2>&1
 *
 * Qué hace (SOLO LECTURA contra ACI — ver REGLA DE ORO en aci.js; escritura
 * únicamente en la BD propia precheckin_adaria, tabla precheckin_envio):
 *
 * 1. Lee las llegadas de los próximos 7 días con aci.getArrivalsNextDays(7).
 * 2. Para cada llegada con email, decide si es entregable con
 *    aci.esEmailEntregable() (descarta buzones proxy de OTA conocidos).
 * 3. Si ya existe una fila en precheckin_envio para (reserva_codigo, email)
 *    no se vuelve a invitar (idempotente día a día — el cron corre una vez
 *    diaria pero la ventana de 7 días se solapa con la ejecución anterior).
 * 4. Si es entregable: genera token, registra la fila, y manda el email de
 *    invitación con enlace `${PUBLIC_BASE_URL}/?codigo=...&apellido=...&t=token`
 *    vía mail.notify() — que sigue respetando SEND_MODE (test = redirige a
 *    TEST_MAILBOX, live = al destinatario real), exactamente igual que el
 *    resto de correos de esta app. Este cron NO decide test/live, solo llama
 *    a mail.notify() como el resto del código.
 * 5. Si no es entregable: se registra igual (estado='no_entregable'), sin
 *    enviar nada, para que quede visible que esa reserva no recibió invitación
 *    y por qué.
 */

const crypto = require('crypto');
const { pool } = require('./db');
const aci = require('./aci');
const mail = require('./mail');

const DIAS_ANTELACION = parseInt(process.env.PRECHECKIN_INVITACION_DIAS || '7', 10);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://precheckin.hoteladariavera.com').replace(/\/+$/, '');

function generarToken() {
  return crypto.randomBytes(24).toString('hex');
}

function enlaceInvitacion(reserva, token) {
  const params = new URLSearchParams({
    codigo: reserva.codigo || '',
    apellido: reserva.titularApellido || '',
    t: token,
  });
  return `${PUBLIC_BASE_URL}/?${params.toString()}`;
}

async function ejecutar() {
  const inicio = Date.now();
  console.log('[cron-invitacion] Iniciando invitación de pre check-in...');

  const stats = { llegadas: 0, sinEmail: 0, yaInvitadas: 0, noEntregables: 0, enviadas: 0, errores: 0 };

  try {
    const llegadas = await aci.getArrivalsNextDays(DIAS_ANTELACION);
    stats.llegadas = llegadas.length;

    for (const reserva of llegadas) {
      if (!reserva.codigo) continue; // sin localizador no hay a qué enlazar el token
      if (!reserva.email) { stats.sinEmail++; continue; }

      const email = reserva.email.trim().toLowerCase();

      // Idempotencia: no reinvitar si ya hay fila para esta (reserva, email).
      const existente = await pool.query(
        `SELECT id, estado FROM precheckin_envio WHERE reserva_codigo = $1 AND email = $2 LIMIT 1`,
        [reserva.codigo, email]
      );
      if (existente.rows.length) { stats.yaInvitadas++; continue; }

      const entregable = aci.esEmailEntregable(email);
      const token = generarToken();

      if (!entregable) {
        await pool.query(
          `INSERT INTO precheckin_envio
             (reserva_codigo, email, email_entregable, token, estado,
              titular_nombre, titular_apellido, habitacion, fecha_entrada)
           VALUES ($1, $2, false, $3, 'no_entregable', $4, $5, $6, $7)`,
          [reserva.codigo, email, token, reserva.titularNombre, reserva.titularApellido,
           reserva.habitacion, reserva.entrada]
        );
        stats.noEntregables++;
        continue;
      }

      // Registrar ANTES de intentar enviar (mismo criterio que
      // registrarYNotificar en server.js): una caída entre el intento y el
      // registro no deja un envío fantasma sin traza.
      await pool.query(
        `INSERT INTO precheckin_envio
           (reserva_codigo, email, email_entregable, token, estado,
            titular_nombre, titular_apellido, habitacion, fecha_entrada)
         VALUES ($1, $2, true, $3, 'pendiente', $4, $5, $6, $7)`,
        [reserva.codigo, email, token, reserva.titularNombre, reserva.titularApellido,
         reserva.habitacion, reserva.entrada]
      );

      let resultado;
      try {
        resultado = await mail.notify({
          destinatario: email,
          asunto: `Complete su pre check-in — reserva ${reserva.codigo} — Hotel Adaria Vera`,
          cuerpo:
            `Estimado/a ${reserva.titularNombre || ''} ${reserva.titularApellido || ''}\n\n` +
            `Le esperamos en Hotel Adaria Vera el ${reserva.entrada || '-'}. Para agilizar su llegada, ` +
            `complete el pre check-in online en el siguiente enlace:\n\n${enlaceInvitacion(reserva, token)}\n\n` +
            `Reserva: ${reserva.codigo}\nHabitación: ${reserva.habitacion || '-'}\n` +
            `Entrada: ${reserva.entrada || '-'} · Salida: ${reserva.salida || '-'}\n\n` +
            `Hotel Adaria Vera`,
        });
      } catch (err) {
        resultado = { enviado: false, modo: 'excepcion', error: String(err.message || err) };
        console.error(`[cron-invitacion] Excepción invitando reserva ${reserva.codigo}:`, err.message);
      }

      const estado = resultado.enviado ? 'enviado' : 'error';
      await pool.query(
        `UPDATE precheckin_envio SET estado = $2, enviado_en = CASE WHEN $3 THEN now() ELSE enviado_en END
         WHERE token = $1`,
        [token, estado, !!resultado.enviado]
      );

      if (resultado.enviado) stats.enviadas++;
      else stats.errores++;
    }

    const duracionMs = Date.now() - inicio;
    console.log(
      `[cron-invitacion] Completado en ${duracionMs}ms — llegadas:${stats.llegadas} ` +
      `sin_email:${stats.sinEmail} ya_invitadas:${stats.yaInvitadas} no_entregables:${stats.noEntregables} ` +
      `enviadas:${stats.enviadas} errores:${stats.errores}`
    );
  } catch (err) {
    console.error('[cron-invitacion] Error ejecutando el cron:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

ejecutar();
