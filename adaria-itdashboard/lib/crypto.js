'use strict';
// Cifrado AES-256-GCM para las contraseñas de infraestructura.
// La clave maestra se deriva de APP_CRYPTO_KEY (.env). Formato almacenado: iv:tag:ciphertext (base64).
const crypto = require('crypto');

const RAW = process.env.APP_CRYPTO_KEY || '';
if (!RAW || RAW.length < 16) {
  throw new Error('APP_CRYPTO_KEY ausente o demasiado corta en .env (mínimo 16 caracteres).');
}
// Normaliza cualquier passphrase a 32 bytes con SHA-256.
const KEY = crypto.createHash('sha256').update(RAW, 'utf8').digest();

function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) plaintext = '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(stored) {
  if (!stored) return '';
  try {
    const [ivB64, tagB64, ctB64] = String(stored).split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    return '⚠️ error descifrado';
  }
}

module.exports = { encrypt, decrypt };
