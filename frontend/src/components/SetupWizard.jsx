import { useState } from 'react';

/**
 * Guided first-time setup (spec section 44) - one linear checklist instead
 * of the shop owner having to piece together "install the agent", "pair
 * it", "wait for a printer to show up", and "get the QR" from separate
 * parts of the dashboard. Purely presentational: every signal it shows
 * (agent connected, printer detected) comes from data ShopDashboard is
 * already polling, so there's nothing here that can drift out of sync with
 * the real state.
 */
export default function SetupWizard({
  agents,
  printers,
  qrDataUrl,
  shopId,
  pairing,
  pairingBusy,
  secondsLeft,
  onGeneratePairingCode,
  onTestPrint,
  testPrintMsg,
}) {
  const [testPrintClicked, setTestPrintClicked] = useState(false);

  const hasAgent = agents.length > 0;
  const agentOnline = agents.some((a) => a.status === 'online');
  const hasPrinter = printers.length > 0;
  const onlinePrinter = printers.find((p) => p.status === 'online') || printers[0];

  const steps = [
    {
      key: 'agent',
      label: 'Install & connect the Print Agent',
      done: hasAgent,
      detail:
        'On the shop PC: download the Print Agent from the project repository, run it, and enter the pairing code below when asked.',
    },
    {
      key: 'online',
      label: 'Print Agent is online',
      done: agentOnline,
      detail: 'Once running, the agent connects to the cloud automatically - this updates within a few seconds.',
    },
    {
      key: 'printer',
      label: 'A printer is detected',
      done: hasPrinter,
      detail: 'Every printer Windows already recognizes on that PC is picked up automatically - nothing to select manually.',
    },
    {
      key: 'test',
      label: 'Run a test print',
      done: testPrintClicked,
      detail: 'Confirms the whole path (cloud → agent → Windows → printer) actually works before customers rely on it.',
    },
    {
      key: 'qr',
      label: 'Download & display the shop QR',
      done: hasAgent && hasPrinter,
      detail: 'Print it and place it where customers can scan it. Customers never need your Wi-Fi.',
    },
  ];

  const activeIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="setup-wizard">
      <ol className="wizard-steps">
        {steps.map((step, i) => (
          <li key={step.key} className={step.done ? 'done' : i === activeIndex ? 'active' : ''}>
            <div className="wizard-step-header">
              <span className="wizard-step-dot">{step.done ? '✓' : i + 1}</span>
              <span className="wizard-step-label">{step.label}</span>
            </div>
            {i === activeIndex && <div className="wizard-step-detail">{step.detail}</div>}

            {step.key === 'agent' && i === activeIndex && (
              <div className="wizard-step-action">
                {pairing ? (
                  <div className="pairing-code-box">
                    <div className="pairing-code">{pairing.pairingCode}</div>
                    <small>
                      Enter this in the Print Agent. Expires in {Math.floor(secondsLeft / 60)}:
                      {String(secondsLeft % 60).padStart(2, '0')}.
                    </small>
                  </div>
                ) : (
                  <button className="link-btn" onClick={onGeneratePairingCode} disabled={pairingBusy}>
                    {pairingBusy ? 'Generating...' : 'Generate pairing code'}
                  </button>
                )}
              </div>
            )}

            {step.key === 'test' && i === activeIndex && hasPrinter && (
              <div className="wizard-step-action">
                <button
                  className="link-btn"
                  onClick={() => {
                    setTestPrintClicked(true);
                    onTestPrint(onlinePrinter);
                  }}
                >
                  Send test print to {onlinePrinter.name}
                </button>
                {testPrintMsg && <div className="hint">{testPrintMsg}</div>}
              </div>
            )}

            {step.key === 'qr' && i === activeIndex && qrDataUrl && (
              <div className="wizard-step-action">
                <img src={qrDataUrl} alt="Shop QR code" style={{ width: 160, height: 160 }} />
                <div>
                  <a className="link-btn" href={qrDataUrl} download={`${shopId}-qr.png`}>
                    Download QR
                  </a>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      {activeIndex === -1 && <div className="hint">Setup complete - your shop is ready for customers.</div>}
    </div>
  );
}
