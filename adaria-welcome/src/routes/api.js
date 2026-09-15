const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const aci = require('../aci');
const { pool, precheckinPool, logAudit } = require('../db');
const { getLegalTexts, SUPPORTED_LANGS } = require('../legal');
const { encryptSensitive, computeIntegrityHash } = require('../crypto');
const { generateCheckinPdf } = require('../pdf');

const PDF_DIR = path.join(__dirname, '..', '..', 'storage', 'pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || req.ip || 'desconocida';
}

function maskDocument(num) {
  if (!num) return '';
  const s = String(num);
  if (s.length <= 4) return '*'.repeat(s.length);
  return `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}

// GET /api/arrivals - llegadas de HOY leidas de ACI (solo lectura)
router.get('/arrivals', async (req, res) => {
  try {
    const arrivals = await aci.getArrivalsToday();
    res.json({ ok: true, count: arrivals.length, arrivals });
  } catch (e) {
    console.error('[api] Error consultando ACI:', e.message);
    res.status(502).json({ ok: false, error: 'No se pudo consultar ACI (llegadas de hoy)' });
  }
});

// GET /api/legal/:lang - textos legales ES/EN
router.get('/legal/:lang', (req, res) => {
  const requested = String(req.params.lang || '').toLowerCase();
  const lang = SUPPORTED_LANGS.includes(requested) ? requested : 'es';
  res.json({ ok: true, lang, texts: getLegalTexts(lang) });
});

// GET /api/precheckin/by-codigo/:codigo - precarga datos ya enviados por el huésped
// desde el módulo Pre check-in online (BD precheckin_adaria, SOLO LECTURA).
// Welcome nunca escribe en esa base; esto es una consulta de precarga para
// evitar que el huésped tenga que volver a teclear lo que ya envió antes de llegar.
router.get('/precheckin/by-codigo/:codigo', async (req, res) => {
  const codigo = String(req.params.codigo || '').trim();
  if (!codigo) {
    return res.status(400).json({ ok: false, error: 'Falta el código de reserva' });
  }
  try {
    const reservaResult = await precheckinPool.query(
      `SELECT id, res_guid, codigo, apellido_busqueda, titular_nombre, titular_apellido,
              habitacion, fecha_entrada, fecha_salida, pax, email, telefono,
              hora_llegada_estimada, observaciones, idioma, procesado
       FROM precheckin_reserva WHERE codigo = $1`,
      [codigo]
    );
    if (reservaResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'No hay pre check-in registrado para ese código' });
    }
    const reserva = reservaResult.rows[0];

    const personasResult = await precheckinPool.query(
      `SELECT es_titular, nombre, apellido1, apellido2, tipo_documento, numero_documento,
              fecha_nacimiento, nacionalidad
       FROM precheckin_persona WHERE reserva_id = $1
       ORDER BY es_titular DESC, id ASC`,
      [reserva.id]
    );

    const personas = personasResult.rows.map((p) => ({
      esTitular: p.es_titular,
      nombre: p.nombre || '',
      apellido1: p.apellido1 || '',
      apellido2: p.apellido2 || '',
      tipoDocumento: p.tipo_documento || '',
      numeroDocumento: p.numero_documento || '',
      fechaNacimiento: p.fecha_nacimiento,
      nacionalidad: p.nacionalidad || ''
    }));

    res.json({
      ok: true,
      precheckin: {
        codigo: reserva.codigo,
        habitacion: reserva.habitacion,
        fechaEntrada: reserva.fecha_entrada,
        fechaSalida: reserva.fecha_salida,
        pax: reserva.pax,
        email: reserva.email,
        telefono: reserva.telefono,
        horaLlegadaEstimada: reserva.hora_llegada_estimada,
        observaciones: reserva.observaciones,
        idioma: reserva.idioma,
        procesado: reserva.procesado,
        personas
      }
    });
  } catch (e) {
    console.error('[api] Error consultando precheckin por codigo:', e.message);
    res.status(502).json({ ok: false, error: 'No se pudo consultar el pre check-in' });
  }
});

// POST /api/checkin - registra el check-in firmado (firma+PDF SOLO en BD local, nunca en ACI)
router.post('/checkin', async (req, res) => {
  const clientIp = getClientIp(req);
  try {
    const {
      resGuid, resCod, roomCode, checkinDate, checkoutDate, language,
      titular, acompanantes, consentConditions, consentPrivacy, consentImage, consentMarketing,
      signaturePngBase64
    } = req.body;

    if (!titular || !titular.nombre || !titular.apellido1) {
      return res.status(400).json({ ok: false, error: 'Faltan datos del titular' });
    }
    if (!consentConditions || !consentPrivacy) {
      return res.status(400).json({ ok: false, error: 'Las condiciones y la política de privacidad son obligatorias' });
    }
    if (!signaturePngBase64) {
      return res.status(400).json({ ok: false, error: 'Falta la firma' });
    }

    const timestampIso = new Date().toISOString();
    const lang = language === 'en' ? 'en' : 'es';

    const titularMasked = { ...titular, numeroDocumentoMasked: maskDocument(titular.numeroDocumento) };
    delete titularMasked.numeroDocumento;

    const integrityPayload = {
      resGuid, resCod, roomCode, checkinDate, checkoutDate, lang,
      titular, acompanantes: acompanantes || [],
      consentConditions: !!consentConditions,
      consentPrivacy: !!consentPrivacy,
      consentImage: !!consentImage,
      consentMarketing: !!consentMarketing,
      timestampIso, clientIp
    };
    const integrityHash = computeIntegrityHash(integrityPayload);

    const signatureBuffer = Buffer.from(signaturePngBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
    const signatureFileName = `firma_${resCod || resGuid}_${Date.now()}.png`;
    const signaturePath = path.join(PDF_DIR, signatureFileName);
    fs.writeFileSync(signaturePath, signatureBuffer);

    const sessionForPdf = {
      resGuid, resCod, roomCode, checkinDate, checkoutDate, language: lang,
      titular: titularMasked,
      acompanantes: acompanantes || [],
      consentConditions, consentPrivacy, consentImage, consentMarketing
    };

    const pdfPath = await generateCheckinPdf(sessionForPdf, signatureBuffer, integrityHash, timestampIso, clientIp, PDF_DIR);

    const documentNumberEnc = encryptSensitive(titular.numeroDocumento);

    const insertResult = await pool.query(
      `INSERT INTO checkins (
        aci_res_guid, aci_res_cod, aci_hue_guid, room_code, checkin_date, checkout_date, language,
        titular_json, acompanantes_json,
        consent_conditions, consent_privacy, consent_image, consent_marketing,
        document_number_enc, signature_png_path, pdf_path, pdf_hash_sha256, client_ip, signed_at, estado
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'firmado')
      RETURNING id, uuid`,
      [
        resGuid || null, resCod || null, titular.hueGuid || null, roomCode || null,
        checkinDate || null, checkoutDate || null, lang,
        JSON.stringify(titularMasked), JSON.stringify(acompanantes || []),
        !!consentConditions, !!consentPrivacy, !!consentImage, !!consentMarketing,
        documentNumberEnc, signaturePath, pdfPath, integrityHash, clientIp, timestampIso
      ]
    );

    await logAudit('checkin_firmado', {
      id: insertResult.rows[0].id,
      resGuid, resCod, roomCode
    }, clientIp);

    res.json({
      ok: true,
      id: insertResult.rows[0].id,
      uuid: insertResult.rows[0].uuid,
      pdfHash: integrityHash,
      signedAt: timestampIso
    });
  } catch (e) {
    console.error('[api] Error registrando checkin:', e);
    res.status(500).json({ ok: false, error: 'Error interno al registrar el check-in' });
  }
});

// GET /api/checkins - listado (uso interno/recepcion) sin datos cifrados
router.get('/checkins', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, uuid, aci_res_cod, room_code, checkin_date, checkout_date, language,
              titular_json, consent_conditions, consent_privacy, consent_image, consent_marketing,
              pdf_hash_sha256, signed_at, estado
       FROM checkins ORDER BY signed_at DESC LIMIT 100`
    );
    res.json({ ok: true, checkins: result.rows });
  } catch (e) {
    console.error('[api] Error listando checkins:', e.message);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// GET /api/health - salud de la app + estado de conexiones
router.get('/health', async (req, res) => {
  const status = { ok: true, db: false, aci: false, sendMode: process.env.SEND_MODE || 'test' };
  try {
    await pool.query('SELECT 1');
    status.db = true;
  } catch (e) { status.db = false; }
  try {
    await aci.testConnection();
    status.aci = true;
  } catch (e) { status.aci = false; }
  res.json(status);
});

module.exports = router;
