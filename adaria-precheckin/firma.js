'use strict';

// Firma manuscrita del pre check-in — generación de PDF (pdfkit) con la
// firma embebida, texto legal, hash SHA-256 y sello de fecha/IP en el pie.
//
// Almacenamiento en disco, NUNCA en la base de datos: el PNG va a
// storage/firmas/ y el PDF a storage/pdfs/, ambos bajo el directorio del
// módulo (configurable con STORAGE_DIR). La tabla precheckin_reserva solo
// guarda las rutas relativas y el hash (ver migración 003).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, 'storage');
const DIR_FIRMAS = path.join(STORAGE_DIR, 'firmas');
const DIR_PDFS = path.join(STORAGE_DIR, 'pdfs');

for (const d of [DIR_FIRMAS, DIR_PDFS]) {
  fs.mkdirSync(d, { recursive: true });
}

const TEXTO_LEGAL = {
  es: 'Declaro que los datos facilitados en este pre check-in son correctos y autorizo su tratamiento por Hotel Adaria Vera con la finalidad de gestionar mi estancia, de acuerdo con el Reglamento (UE) 2016/679 (RGPD) y la normativa de registro de viajeros (RD 933/2021). La firma que antecede corresponde al titular de la reserva.',
  en: 'I declare that the details provided in this pre check-in are correct and I authorise their processing by Hotel Adaria Vera for the purpose of managing my stay, in accordance with Regulation (EU) 2016/679 (GDPR) and the traveller registration regulations (RD 933/2021). The signature above corresponds to the main guest of the booking.',
  fr: "Je déclare que les informations fournies dans ce pré check-in sont exactes et j'autorise leur traitement par l'Hôtel Adaria Vera aux fins de la gestion de mon séjour, conformément au règlement (UE) 2016/679 (RGPD) et à la réglementation sur l'enregistrement des voyageurs (RD 933/2021). La signature ci-dessus correspond au titulaire de la réservation.",
};

/**
 * Decodifica un data URL "data:image/png;base64,...." (o un base64 pelado) a
 * Buffer. Lanza si no es un PNG reconocible o supera el tamaño máximo.
 */
function decodificarPngBase64(signaturePngBase64) {
  if (!signaturePngBase64 || typeof signaturePngBase64 !== 'string') {
    throw new Error('firma_requerida');
  }
  const m = /^data:image\/png;base64,(.+)$/.exec(signaturePngBase64.trim());
  const b64 = m ? m[1] : signaturePngBase64.trim();
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('firma_invalida');
  // Cabecera PNG: 89 50 4E 47 0D 0A 1A 0A
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(header)) throw new Error('firma_invalida');
  const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — de sobra para un trazo de firma
  if (buf.length > MAX_BYTES) throw new Error('firma_demasiado_grande');
  return buf;
}

/**
 * Dibuja el cuerpo común del documento (cabecera, personas, texto legal,
 * firma) y deja el pie a cargo del llamador, que es quien sabe si ya
 * dispone del hash (segunda pasada) o no (primera pasada, solo para
 * calcularlo).
 */
function dibujarCuerpo(doc, { reserva, personas, png, lang }) {
  doc.fontSize(16).text('Pre check-in — Hotel Adaria Vera', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#666')
    .text(`Reserva: ${reserva.codigo || '-'}   ·   Habitación: ${reserva.habitacion || '-'}`);
  doc.text(`Entrada: ${reserva.entrada || '-'}   ·   Salida: ${reserva.salida || '-'}   ·   Pax: ${reserva.pax || personas.length}`);
  doc.fillColor('#000');
  doc.moveDown();

  doc.fontSize(12).text('Personas registradas', { underline: true });
  doc.moveDown(0.2);
  personas.forEach((p, i) => {
    const linea = `${i + 1}. ${p.nombre} ${p.apellido1} ${p.apellido2 || ''}`.trim() +
      (p.esTitular ? ' (titular)' : '') +
      (p.tipoDocumento ? `  —  ${p.tipoDocumento} ${p.numeroDocumento || ''}` : '');
    doc.fontSize(10).text(linea);
  });
  doc.moveDown();

  doc.fontSize(12).text('Declaración', { underline: true });
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor('#333').text(TEXTO_LEGAL[lang], { align: 'justify' });
  doc.fillColor('#000');
  doc.moveDown();

  doc.fontSize(11).text('Firma:');
  doc.moveDown(0.2);
  doc.image(png, { fit: [220, 90] });
}

/**
 * Genera el buffer completo del PDF. `pie` es el texto de la última línea
 * (fecha/IP, y hash si ya se conoce) — se pasa desde fuera para poder
 * generar una primera pasada sin hash (con la que calcularlo) y una segunda
 * pasada idéntica salvo por esa línea.
 */
function generarBuffer({ reserva, personas, png, lang, pie }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      dibujarCuerpo(doc, { reserva, personas, png, lang });

      doc.fontSize(8).fillColor('#888')
        .text(pie, 50, doc.page.height - 90, { width: doc.page.width - 100 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Genera el PDF del pre check-in (datos de la reserva + personas + firma +
 * texto legal + pie con hash/fecha/IP) y lo guarda en disco junto con el PNG
 * de la firma. Devuelve { signaturePngPath, pdfPath, pdfHashSha256, signedAt }
 * con rutas RELATIVAS a STORAGE_DIR (lo que se guarda en BD).
 */
async function generarPdfPrecheckin({ reserva, personas, signaturePngBase64, idioma, ip }) {
  const png = decodificarPngBase64(signaturePngBase64);
  const lang = TEXTO_LEGAL[idioma] ? idioma : 'es';
  const signedAt = new Date();
  const stamp = signedAt.toISOString().replace(/[:.]/g, '-');
  const base = `${reserva.codigo || 'sin-codigo'}_${stamp}`.replace(/[^a-zA-Z0-9_.-]/g, '_');

  const pngRel = path.join('firmas', `${base}.png`);
  const pdfRel = path.join('pdfs', `${base}.pdf`);
  const pngAbs = path.join(STORAGE_DIR, pngRel);
  const pdfAbs = path.join(STORAGE_DIR, pdfRel);

  fs.writeFileSync(pngAbs, png);

  const piePrevio = `Firmado el ${signedAt.toISOString()} desde IP ${ip || 'desconocida'}`;

  // Primera pasada: el hash de un PDF que contuviese su propio hash no sería
  // verificable (el hash cambiaría al insertarlo), así que se calcula sobre
  // una versión sin hash y luego se estampa esa cifra en una segunda pasada
  // idéntica salvo por el pie — el fichero que queda en disco SÍ lleva el
  // hash impreso, útil para cotejar visualmente una copia impresa.
  const bufferSinHash = await generarBuffer({ reserva, personas, png, lang, pie: piePrevio });
  const hashPrevio = crypto.createHash('sha256').update(bufferSinHash).digest('hex');

  const pieFinal = `${piePrevio}\nHash SHA-256 del documento: ${hashPrevio}`;
  const pdfFinalBuffer = await generarBuffer({ reserva, personas, png, lang, pie: pieFinal });

  fs.writeFileSync(pdfAbs, pdfFinalBuffer);
  const pdfHashSha256 = crypto.createHash('sha256').update(pdfFinalBuffer).digest('hex');

  return {
    signaturePngPath: pngRel,
    pdfPath: pdfRel,
    pdfHashSha256,
    signedAt,
  };
}

module.exports = { generarPdfPrecheckin, decodificarPngBase64, STORAGE_DIR, DIR_FIRMAS, DIR_PDFS };
