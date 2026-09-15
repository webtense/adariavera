// Módulo de firma para precheckin — genera PDFs con firma incrustada.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OCEAN_DARK = '#1b5e75';
const CHARCOAL = '#333333';

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('es-ES');
}

/**
 * Genera PDF de precheckin con firma incrustada.
 * @param {object} precheckinData - datos de reserva + persona
 * @param {Buffer} signaturePngBuffer - imagen PNG de firma desde canvas
 * @param {string} clientIp - IP de origen
 * @param {string} outDir - carpeta /storage/pdfs
 * @returns {Promise<{path: string, hash: string}>}
 */
async function generatePrecheckinPdf(precheckinData, signaturePngBuffer, clientIp, outDir) {
  const fileName = `precheckin_${precheckinData.codigo}_${Date.now()}.pdf`;
  const outPath = path.join(outDir, fileName);
  const timestamp = new Date().toISOString();

  // Calcular hash SHA-256 del contenido (datos + firma base64 + timestamp)
  const sigBase64 = signaturePngBuffer.toString('base64');
  const contentHash = crypto.createHash('sha256')
    .update(JSON.stringify(precheckinData) + sigBase64 + timestamp)
    .digest('hex');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(outPath);

    doc.on('error', reject);
    stream.on('error', reject);

    doc.pipe(stream);

    // Encabezado
    doc.rect(0, 0, doc.page.width, 80).fill(OCEAN_DARK);
    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
      .text('Hotel Adaria Vera', 50, 20);
    doc.fontSize(10).font('Helvetica')
      .text('Pre Check-in Online', 50, 50);
    doc.fillColor(CHARCOAL);

    // Datos de reserva
    doc.moveDown(3);
    doc.fontSize(12).font('Helvetica-Bold').text('Datos de Reserva', 50);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Código: ${precheckinData.codigo || '-'}`, 50);
    doc.text(`Entrada: ${fmtDate(precheckinData.fecha_entrada)}`, 50);
    doc.text(`Salida: ${fmtDate(precheckinData.fecha_salida)}`, 50);
    doc.text(`Habitación: ${precheckinData.habitacion || '-'}`, 50);
    doc.text(`Huéspedes: ${precheckinData.pax || '-'}`, 50);

    // Datos del titular
    doc.moveDown(2);
    doc.fontSize(12).font('Helvetica-Bold').text('Titular', 50);
    doc.fontSize(10).font('Helvetica');
    doc.text(`${precheckinData.titular_nombre} ${precheckinData.titular_apellido}`, 50);
    doc.text(`Email: ${precheckinData.email || '-'}`, 50);
    doc.text(`Teléfono: ${precheckinData.telefono || '-'}`, 50);

    // Texto legal de firma
    doc.moveDown(2);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(OCEAN_DARK)
      .text('Declaración de Precisión y Consentimiento', 50);
    doc.fillColor(CHARCOAL).font('Helvetica').fontSize(9);
    doc.text(
      'Declaro que los datos proporcionados son precisos y veraces. ' +
      'Autorizo al hotel a procesar mis datos personales conforme a su política de privacidad. ' +
      'Esta firma constituye firma electrónica con validez legal.',
      50, { width: 512, align: 'left' }
    );

    // Insertar firma
    doc.moveDown(2);
    doc.fontSize(10).font('Helvetica-Bold').text('Firma:', 50);
    if (signaturePngBuffer && signaturePngBuffer.length > 0) {
      doc.image(signaturePngBuffer, 50, doc.y, { width: 150, height: 80 });
      doc.moveDown(5);
    }

    // Pie de página
    doc.fontSize(8).fillColor('#666666').font('Helvetica');
    doc.text(`Fecha/Hora: ${timestamp}`, 50, doc.page.height - 100);
    doc.text(`IP: ${clientIp}`, 50);
    doc.text(`Hash SHA-256: ${contentHash.substring(0, 32)}...`, 50);
    doc.text(
      `Hotel Adaria Vera | Razón Social: Activos Turísticos Vera S.L. B-27667542 | Almería`,
      50,
      { align: 'center' }
    );

    doc.end();

    stream.on('finish', () => {
      resolve({
        path: outPath,
        hash: contentHash,
        filename: fileName,
      });
    });
  });
}

module.exports = { generatePrecheckinPdf };
