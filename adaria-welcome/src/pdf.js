// Generacion del PDF de check-in firmado. Se guarda SOLO en la BD local + carpeta
// /opt/adaria-welcome/storage/pdfs — nunca se escribe en ACI.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { getLegalTexts, RAZON_SOCIAL, CIF, DOM_HOTEL, CONTACTO, REGISTRO } = require('./legal');

const OCEAN_DARK = '#1b5e75';
const OCEAN_MEDIUM = '#2d8aa3';
const TERRACOTA = '#c67c6f';
const CHARCOAL = '#333333';

function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('es-ES');
}

/**
 * Genera el PDF de check-in y lo escribe en disco.
 * @param {object} session - datos del check-in ya validados
 * @param {Buffer} signaturePngBuffer - imagen PNG de la firma (canvas)
 * @param {string} integrityHash - SHA-256 calculado sobre el payload (antes de renderizar)
 * @param {string} timestampIso - fecha/hora ISO de la firma
 * @param {string} clientIp - IP de origen de la firma
 * @param {string} outDir - carpeta destino
 * @returns {Promise<string>} ruta absoluta del PDF generado
 */
function generateCheckinPdf(session, signaturePngBuffer, integrityHash, timestampIso, clientIp, outDir) {
  const lang = session.language === 'en' ? 'en' : 'es';
  const t = getLegalTexts(lang);
  const fileName = `checkin_${session.resCod || session.resGuid}_${Date.now()}.pdf`;
  const outPath = path.join(outDir, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    // --- Cabecera ---
    doc.rect(0, 0, doc.page.width, 90).fill(OCEAN_DARK);
    doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold')
      .text('Hotel Adaria Vera', 50, 30);
    doc.fontSize(11).font('Helvetica')
      .text(lang === 'en' ? 'Digital Check-in' : 'Check-in Digital', 50, 58);
    doc.fillColor(CHARCOAL);

    doc.moveDown(4);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(OCEAN_DARK)
      .text(lang === 'en' ? 'Stay details' : 'Datos de la estancia', 50, 110);
    doc.fillColor(CHARCOAL).fontSize(10).font('Helvetica');

    const infoY = 132;
    doc.text(`${lang === 'en' ? 'Reservation' : 'Reserva'}: ${session.resCod || session.resGuid}`, 50, infoY);
    doc.text(`${lang === 'en' ? 'Room' : 'Habitación'}: ${session.roomCode || (lang === 'en' ? 'Not assigned' : 'Sin asignar')}`, 300, infoY);
    doc.text(`Check-in: ${fmtDate(session.checkinDate)}`, 50, infoY + 16);
    doc.text(`Check-out: ${fmtDate(session.checkoutDate)}`, 300, infoY + 16);

    // --- Titular ---
    let y = infoY + 45;
    doc.fontSize(14).font('Helvetica-Bold').fillColor(OCEAN_DARK)
      .text(lang === 'en' ? 'Main guest' : 'Titular', 50, y);
    y += 22;
    doc.fillColor(CHARCOAL).fontSize(10).font('Helvetica');
    const tit = session.titular;
    doc.text(`${lang === 'en' ? 'Name' : 'Nombre'}: ${tit.nombre} ${tit.apellido1} ${tit.apellido2 || ''}`.trim(), 50, y);
    y += 16;
    doc.text(`${lang === 'en' ? 'Document' : 'Documento'}: ${tit.tipoDocumento || '-'} ${tit.numeroDocumentoMasked || ''}`, 50, y);
    doc.text(`${lang === 'en' ? 'Nationality' : 'Nacionalidad'}: ${tit.nacionalidad || '-'}`, 300, y);
    y += 16;
    doc.text(`Email: ${tit.email || '-'}`, 50, y);
    doc.text(`${lang === 'en' ? 'Phone' : 'Teléfono'}: ${tit.telefono || '-'}`, 300, y);

    // --- Acompañantes ---
    if (session.acompanantes && session.acompanantes.length > 0) {
      y += 34;
      doc.fontSize(14).font('Helvetica-Bold').fillColor(OCEAN_DARK)
        .text(lang === 'en' ? 'Companions' : 'Acompañantes', 50, y);
      y += 20;
      doc.fillColor(CHARCOAL).fontSize(10).font('Helvetica');
      session.acompanantes.forEach((a, i) => {
        doc.text(`${i + 1}. ${a.nombre} ${a.apellido1} ${a.apellido2 || ''} — ${a.nacionalidad || '-'}`.trim(), 50, y);
        y += 15;
      });
    }

    // --- Textos legales ---
    y += 20;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(OCEAN_DARK).text(t.tituloCondiciones, 50, y);
    y = doc.y + 4;
    doc.fontSize(9).font('Helvetica').fillColor(CHARCOAL).text(t.condiciones, 50, y, { width: 495, align: 'justify' });
    y = doc.y + 12;

    doc.fontSize(12).font('Helvetica-Bold').fillColor(OCEAN_DARK).text(t.tituloPrivacidad, 50, y);
    y = doc.y + 4;
    doc.fontSize(9).font('Helvetica').fillColor(CHARCOAL).text(t.privacidad, 50, y, { width: 495, align: 'justify' });
    y = doc.y + 12;

    const checkMark = (val) => (val ? '[X]' : '[ ]');
    doc.fontSize(9).font('Helvetica-Bold').fillColor(CHARCOAL)
      .text(`${checkMark(session.consentConditions)} ${t.tituloCondiciones} ${t.consentimientoObligatorio}`, 50, y);
    y = doc.y + 4;
    doc.text(`${checkMark(session.consentPrivacy)} ${t.tituloPrivacidad} ${t.consentimientoObligatorio}`, 50, y);
    y = doc.y + 4;
    doc.text(`${checkMark(session.consentImage)} ${t.tituloImagen} ${t.consentimientoOpcional}`, 50, y);
    y = doc.y + 4;
    doc.text(`${checkMark(session.consentMarketing)} ${t.tituloMarketing} ${t.consentimientoOpcional}`, 50, y);

    // Salto de pagina si hace falta antes de firma
    if (y > 650) {
      doc.addPage();
      y = 50;
    } else {
      y = doc.y + 20;
    }

    doc.fontSize(10).font('Helvetica-Oblique').fillColor(CHARCOAL).text(t.firmaDeclaracion, 50, y, { width: 495 });
    y = doc.y + 10;

    // --- Firma ---
    doc.fontSize(11).font('Helvetica-Bold').fillColor(OCEAN_DARK)
      .text(lang === 'en' ? 'Signature:' : 'Firma:', 50, y);
    y += 18;
    if (signaturePngBuffer) {
      try {
        doc.image(signaturePngBuffer, 50, y, { width: 220, height: 90, fit: [220, 90] });
      } catch (e) {
        doc.fontSize(9).fillColor('red').text('(error al insertar imagen de firma)', 50, y);
      }
    }
    doc.rect(50, y, 220, 90).strokeColor(TERRACOTA).lineWidth(1).stroke();
    y += 100;

    // --- Sello de integridad ---
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#cccccc').stroke();
    y += 10;
    doc.fontSize(8).font('Courier').fillColor('#555555');
    doc.text(`${lang === 'en' ? 'Digital signature timestamp' : 'Fecha/hora de la firma'}: ${timestampIso}`, 50, y);
    y = doc.y + 2;
    doc.text(`${lang === 'en' ? 'Source IP' : 'IP de origen'}: ${clientIp}`, 50, y);
    y = doc.y + 2;
    doc.text(`SHA-256: ${integrityHash}`, 50, y, { width: 495 });

    // --- Pie legal ---
    const bottomY = doc.page.height - 70;
    doc.fontSize(7.5).font('Helvetica').fillColor('#777777')
      .text(`${RAZON_SOCIAL} · CIF ${CIF} · ${DOM_HOTEL} · ${CONTACTO} · ${REGISTRO}`, 50, bottomY, {
        width: 495,
        align: 'center'
      });
    doc.text(`Hotel Adaria Vera · Check-in · v${process.env.APP_VERSION || '1.0.0'}`, 50, bottomY + 12, {
      width: 495,
      align: 'center'
    });

    doc.end();
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

module.exports = { generateCheckinPdf };
