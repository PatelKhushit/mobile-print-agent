/**
 * Shared in-memory status the polling loop writes to and the local
 * dashboard reads from. Resets on agent restart - fine for a trial agent
 * that's expected to run continuously once started.
 */
const state = {
  startedAt: new Date().toISOString(),
  backendConnected: false,
  printers: [], // locally detected + auto-registered printer names
  lastCheck: null,
  lastJobId: null,
  lastPrintStatus: null,
  jobsPrintedToday: 0,
  jobsPrintedDate: null,
};

function bumpJobsPrintedToday() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.jobsPrintedDate !== today) {
    state.jobsPrintedDate = today;
    state.jobsPrintedToday = 0;
  }
  state.jobsPrintedToday += 1;
}

module.exports = { state, bumpJobsPrintedToday };
