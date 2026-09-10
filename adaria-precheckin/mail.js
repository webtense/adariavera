'use strict';

// Notificaciones por email — NUNCA WhatsApp.
//
// SEND_MODE=live: envío real vía SMTP_* con el TO real (destinatario del
// llamador, o NOTIFY_EMAIL si no se pasa uno explícito).
// Cualquier otro valor (incluido el default 'test') redirige el TO al buzón
// de pruebas fijo TEST_MAILBOX, para poder verificar remitente/plantilla sin
// arriesgar avisos a recepción real. Confirmado por Andrés 28/08/2026:
// mantener esta redirección hasta que se decida pasar a SEND_MODE=live en
// producción.
//
// En AMBOS modos se añade BCC a TEST_MAILBOX como copia de auditoría: queda
// constancia de cada envío real (modo live) igual que en modo test.
//
// Si SMTP no está configurado (falta SMTP_HOST/SMTP_USER), o si el envío
// falla, se cae a un log local (logs/mail.log) para no perder el aviso.

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const SEND_MODE = (process.env.SEND_MODE || 'test').toLowerCase();
const IS_LIVE = SEND_MODE === 'live';

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || '';

// Buzón de pruebas/auditoría — fijo a propósito, no viene de .env: es un
// valor de implementación (redirección en test + BCC de auditoría en
// ambos modos), no config de despliegue. Confirmado por Andrés 28/08/2026.
const TEST_MAILBOX = 'prechkinvera@boitaullresort.com';

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'mail.log');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

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
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    console.error('[adaria-precheckin] No se pudo escribir el log de mail:', e.message);
  }
}

/**
 * Envía (o simula, según SEND_MODE) una notificación por email.
 * Devuelve { enviado, modo, to, messageId?, error? }.
 */
async function notify({ asunto, cuerpo, destinatario }) {
  const realTo = destinatario || NOTIFY_EMAIL;
  const to = IS_LIVE ? realTo : TEST_MAILBOX;
  const modo = IS_LIVE ? 'live' : 'test';

  if (!to) {
    appendLog({ modo: 'sin_destinatario', asunto, cuerpo });
    return { enviado: false, modo: 'sin_destinatario' };
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    appendLog({ modo: 'sin_smtp', to, asunto, cuerpo });
    return { enviado: false, modo: 'sin_smtp', to };
  }

  const subject = modo === 'test' && realTo !== TEST_MAILBOX
    ? `[TEST -> ${realTo}] ${asunto}`
    : asunto;

  try {
    const info = await getTransporter().sendMail({
      from: process.env.SMTP_FROM_NAME
        ? `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM}>`
        : process.env.SMTP_FROM,
      to,
      bcc: TEST_MAILBOX,
      subject,
      text: cuerpo,
    });
    appendLog({
      modo, to, bcc: TEST_MAILBOX, destinatarioReal: realTo, asunto,
      messageId: info.messageId,
    });
    return { enviado: true, modo, to, messageId: info.messageId };
  } catch (err) {
    appendLog({ modo: 'error', to, asunto, error: err.message });
    return { enviado: false, modo: 'error', to, error: err.message };
  }
}

module.exports = { notify, LOG_FILE };
