// Utilidades criptograficas: hash de integridad del check-in y cifrado AES-256-GCM
// para datos sensibles en reposo (numero de documento) con WELCOME_MASTER_KEY.
const crypto = require('crypto');

function getKeyBuffer() {
  const hex = process.env.WELCOME_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('WELCOME_MASTER_KEY debe ser una cadena hex de 64 caracteres (256 bits)');
  }
  return Buffer.from(hex, 'hex');
}

function encryptSensitive(plainText) {
  if (plainText === null || plainText === undefined || plainText === '') return null;
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Formato almacenado: iv(hex):tag(hex):ciphertext(hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSensitive(stored) {
  if (!stored) return null;
  const key = getKeyBuffer();
  const [ivHex, tagHex, dataHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

// Hash SHA-256 del "sello" de integridad: cubre los datos del check-in + firma + IP + timestamp.
// Se calcula ANTES de renderizar el PDF (evita el problema de "huevo y gallina" de
// hashear el propio fichero que contiene el hash) y se imprime como texto en el PDF.
function computeIntegrityHash(payloadObject) {
  const canonical = JSON.stringify(payloadObject, Object.keys(payloadObject).sort());
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

module.exports = { encryptSensitive, decryptSensitive, computeIntegrityHash };
