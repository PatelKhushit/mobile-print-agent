const { print } = require('pdf-to-printer');

/**
 * Sends a PDF to a Windows-installed printer by shelling out to the
 * SumatraPDF binary bundled with pdf-to-printer. Resolves once the OS
 * print spooler accepts the job (not once paper physically comes out).
 */
async function printFile(filePath, { printerName, copies = 1, color = false }) {
  await print(filePath, {
    printer: printerName,
    copies,
    monochrome: !color,
    silent: true,
  });
}

module.exports = { printFile };
