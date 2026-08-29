/**
 * Builds a minimal, correctly-offset single-page PDF from scratch (no
 * dependency needed). Used as the default "generated test PDF" the mobile
 * page can send when the user hasn't picked their own file.
 */
function buildTestPdf(title) {
  const header = '%PDF-1.4\n';

  const streamText =
    `BT /F1 20 Tf 72 700 Td (${(title || 'Mobile Print System - Test Page').replace(/[()\\]/g, '')}) Tj ET\n` +
    `BT /F1 12 Tf 72 670 Td (Generated ${new Date().toISOString()}) Tj ET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(streamText, 'utf8')} >>\nstream\n${streamText}\nendstream`,
  ];

  let body = '';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(header + body, 'utf8'));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(header + body, 'utf8');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  });

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, 'utf8');
}

module.exports = { buildTestPdf };
