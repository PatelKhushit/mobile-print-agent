const readline = require('readline');
const printer = require('./printer');
const { savePrinterName } = require('./config');

async function main() {
  console.log('Detecting installed Windows printers...\n');
  let printers;
  try {
    printers = await printer.listPrinters();
  } catch (err) {
    console.error('Failed to list printers:', err.message);
    process.exit(1);
  }

  if (!printers.length) {
    console.error('No printers were found on this PC. Install a printer driver and try again.');
    process.exit(1);
  }

  console.log('Installed Printers\n');
  printers.forEach((name, i) => console.log(`${i + 1}. ${name}`));
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`Select a printer [1-${printers.length}]: `, (answer) => {
    const index = parseInt(answer, 10) - 1;
    rl.close();
    if (Number.isNaN(index) || index < 0 || index >= printers.length) {
      console.error('Invalid selection.');
      process.exit(1);
    }
    const chosen = printers[index];
    savePrinterName(chosen);
    console.log(`\nSaved PRINTER_NAME=${chosen} to .env`);
  });
}

main();
