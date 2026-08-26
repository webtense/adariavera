'use strict';

// Notificaciones por email — NUNCA WhatsApp.
//
// Gate: PRECHECKIN_EMAIL_ENABLED (.env), false de fábrica. Con el gate
// apagado, notify() SIEMPRE cae al log (logs/mail-test.log) pase lo que pase
// en SEND_MODE/SMTP_*: ese es el comportamiento de "reserva del gate" que
// pide FASE 3 (PRECHECKIN_EMAIL_ENABLED=false), y hoy además refleja lo que
// YA pasaba de hecho — SEND_MODE en el .env de producción está en "live" pero
// este módulo solo trataba como activo el valor "real" ('live' caía al
// mismo sitio que 'test' sin que nadie lo hubiera decidido así a propósito).
// Con el gate explícito, ese comportamiento queda documentado en vez de ser
// un desajuste de nombres.
//
// Con el gate encendido y SEND_MODE=real + SMTP_HOST configurado: envío real
// (no implementado todavía — falta añadir nodemailer como dependencia; ver
// TODO más abajo). Mientras tanto cae a log igualmente, para no perder el
// aviso.

const fs = require('fs');
const path = require('path');

const EMAIL_ENABLED = String(process.env.PRECHECKIN_EMAIL_ENABLED ?? 'false').toLowerCase() === 'true';
const SEND_MODE = (process.env.SEND_MODE || 'test').toLowerCase();
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || '';
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'mail-test.log');

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) {
    // no-op: si no se puede crear, appendFileSync fallará más abajo y se
    // captura en notify()
  }
}

function appendLog(entry) {
  ensureLogDir();
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(LOG_FILE, line);
}

/**
 * Registra (y, si algún día SEND_MODE=real + SMTP_HOST configurado, enviaría)
 * una notificación. Devuelve { enviado: boolean, modo: string, motivo: string }.
 * `motivo` es el código estable que usan precheckin_notificacion_log y el
 * cron de reintentos para explicar por qué no se envió (o por qué sí).
 */
async function notify({ asunto, cuerpo, destinatario }) {
  const to = destinatario || NOTIFY_EMAIL;

  if (!EMAIL_ENABLED) {
    appendLog({ modo: 'gate_desactivado', to, asunto, cuerpo });
    return { enviado: false, modo: 'gate_desactivado', motivo: 'gate_desactivado' };
  }

  if (SEND_MODE === 'real' && process.env.SMTP_HOST) {
    // TODO(Fase 4): envío real con nodemailer. No implementado a propósito
    // hasta confirmar el SMTP con Fase A (Tarea A del plan orchestrated) y
    // añadir la dependencia. Hasta entonces, aunque el gate esté encendido,
    // cae a log — así el aviso no se pierde y queda constancia del intento.
    appendLog({ modo: 'real_no_implementado', to, asunto, cuerpo });
    return { enviado: false, modo: 'real_no_implementado', motivo: 'smtp_no_implementado' };
  }

  appendLog({ modo: 'test', to, asunto, cuerpo });
  return { enviado: false, modo: 'test', motivo: 'send_mode_test' };
}

module.exports = { notify, LOG_FILE, EMAIL_ENABLED };
