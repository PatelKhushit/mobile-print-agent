export default function Compatibility({ onBack }) {
  return (
    <div className="card admin-card">
      <h1>PRINTER COMPATIBILITY</h1>

      <p className="compat-intro">
        This system connects to printers two real ways. There is no generic "works with everything" mode -
        if a printer doesn't match one of these, it will not appear as printable, rather than silently
        pretending to work.
      </p>

      <h2 className="compat-heading">✓ Supported</h2>
      <ul className="compat-list">
        <li>
          <strong>Any printer with a Windows driver installed</strong> on the PC running the Print Agent -
          USB, Bluetooth, network-shared, or virtual. Brand doesn't matter (Canon, HP, Epson, Brother,
          Zebra/POS label printers, etc.) because the agent goes through the printer's own Windows driver,
          not a brand-specific SDK. This also covers Bluetooth printers: once paired in Windows and
          installed as a normal Windows printer, they're indistinguishable from a USB printer to the agent.
          Detected automatically from the list of installed Windows printers.
        </li>
        <li>
          <strong>Real network printers speaking IPP or IPPS</strong> (the standard Internet Printing
          Protocol used by most modern network/business printers and print servers). These are
          auto-discovered on the local network via mDNS/DNS-SD (<code>_ipp._tcp</code> /{' '}
          <code>_ipps._tcp</code>) - no manual IP entry, no driver install on the agent PC. The agent talks
          IPP directly to the printer.
        </li>
      </ul>

      <h2 className="compat-heading">✕ Not supported</h2>
      <ul className="compat-list">
        <li>
          Printers that only accept a vendor's proprietary cloud-print API rather than standard IPP/IPPS.
        </li>
        <li>
          Printers with neither a Windows driver nor IPP/IPPS support (e.g. very old parallel/serial-only
          devices, or receipt printers that only speak raw ESC/POS over a custom, non-IPP protocol with no
          Windows driver available).
        </li>
      </ul>

      <h2 className="compat-heading">How each printer's real capabilities are shown</h2>
      <p className="compat-intro">
        Color, duplex (double-sided), and paper size options in the print screen are read live from the
        printer itself (Windows driver capabilities, or the printer's own IPP attributes) - not assumed. If
        a printer doesn't report an option, it isn't offered.
      </p>

      <h2 className="compat-heading">Printer not showing up?</h2>
      <ul className="compat-list">
        <li>Windows printer: install its driver on the PC running the Print Agent, then wait ~30s for the next auto-scan.</li>
        <li>Network printer: confirm it's on the same network as the Print Agent PC and has IPP enabled (most business/office network printers do by default).</li>
      </ul>

      <button className="link-btn" onClick={onBack}>
        ← Back
      </button>
    </div>
  );
}
