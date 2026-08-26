'use strict';

// Notificaciones por email — NUNCA WhatsApp.
//
// SEND_MODE=test (por defecto): no se envía correo real. El buzón NOTIFY_EMAIL
// (vera@boitaullresort.com, de pruebas — ese buzón real aún no existe) recibe
// solo un registro en logs/mail-test.log con lo que se habría enviado.
//
// SEND_MODE=real: envío real vía SMTP_* (no configurado todavía — no hay
// servidor SMTP confirmado para Adaria Vera). Mientras SMTP_HOST esté vacío,
// el envío real se aborta y se cae también a log, para no perder el aviso.

const fs = require('fs');
const path = require('path');

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
 * una notificación. Devuelve { enviado: boolean, modo: string }.
 */
async function notify({ asunto, cuerpo, destinatario }) {
  const to = destinatario || NOTIFY_EMAIL;

  if (SEND_MODE === 'real' && process.env.SMTP_HOST) {
    // Gate real: no implementado a propósito hasta que exista un SMTP
    // confirmado para Adaria Vera. Cuando se configure SMTP_HOST, sustituir
    // este bloque por el envío con nodemailer y mantener el log como
    // constancia además del envío.
    appendLog({ modo: 'real_no_implementado', to, asunto, cuerpo });
    return { enviado: false, modo: 'real_no_implementado' };
  }

  appendLog({ modo: 'test', to, asunto, cuerpo });
  return { enviado: false, modo: 'test' };
}

module.exports = { notify, LOG_FILE };
