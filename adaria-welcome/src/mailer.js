// GATE DE EMAIL CRITICO.
// Este modulo NUNCA debe enviar un correo real mientras SEND_MODE != 'live'.
// Precedente: en BTR salieron 1.117 emails [TEST] a clientes reales por no bloquear
// correctamente el modo de pruebas. Aqui el bloqueo es DOBLE e incondicional por defecto:
//   1) SEND_MODE debe valer exactamente 'live'
//   2) ademas se requiere ALLOW_REAL_EMAIL=yes explicito (no presente en este despliegue)
// Si cualquiera de las dos condiciones falla, la funcion NO llama a ningun transporte SMTP:
// solo registra en audit_log que un envio fue bloqueado.
const { logAudit } = require('./db');

async function sendCheckinEmail({ to, subject, body, clientIp }) {
  const sendMode = process.env.SEND_MODE || 'test';
  const allowReal = process.env.ALLOW_REAL_EMAIL === 'yes';

  if (sendMode !== 'live' || !allowReal) {
    console.log(`[mailer] BLOQUEADO (SEND_MODE=${sendMode}) - no se envia email real a ${to ? to.replace(/(.{2}).+(@.+)/, '$1***$2') : '(sin destinatario)'}`);
    await logAudit('email_bloqueado', { to, subject, sendMode, allowReal }, clientIp);
    return { sent: false, reason: 'SEND_MODE gate activo, envio bloqueado' };
  }

  // Esta rama es intencionalmente inalcanzable en este despliegue (SEND_MODE=test fijo en .env).
  // Se deja preparada solo como referencia futura; NO conectar a SMTP sin decision explicita.
  throw new Error('Envio real de email deshabilitado en esta instalacion (Adaria Vera Welcome v1).');
}

module.exports = { sendCheckinEmail };
