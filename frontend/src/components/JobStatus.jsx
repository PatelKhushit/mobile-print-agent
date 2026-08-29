import { useEffect, useRef, useState } from 'react';
import { cancelPrintJob, getPrintJob } from '../api';

const CANCELLABLE_STATES = ['queued', 'assigned', 'downloading'];

const STEPS = [
  { key: 'queued', label: 'Job Created' },
  { key: 'assigned', label: 'Printer Connected' },
  { key: 'downloading', label: 'Document Downloaded' },
  { key: 'printing', label: 'Printing' },
  { key: 'completed', label: 'Print Completed' },
];

const STEP_INDEX = { queued: 0, assigned: 1, downloading: 2, printing: 3, completed: 4 };

export default function JobStatus({ jobId, onReset }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await getPrintJob(jobId);
        if (cancelled) return;
        setJob(data);
        setError('');
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
          return; // stop polling, terminal state
        }
        timerRef.current = setTimeout(poll, 2000);
      } catch (err) {
        if (cancelled) return;
        setError('Lost connection to backend while checking status.');
        timerRef.current = setTimeout(poll, 3000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [jobId]);

  const isFailed = job && (job.status === 'failed' || job.status === 'cancelled');
  const isCompleted = job && job.status === 'completed';
  const currentIndex = job && !isFailed ? STEP_INDEX[job.status] : -1;
  const canCancel = job && CANCELLABLE_STATES.includes(job.status);

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelPrintJob(jobId);
      setJob((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not cancel this job.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="status-card">
      <div className="status-header">
        <span className="label">Job ID</span>
        <span className="job-id">{jobId}</span>
      </div>

      {isFailed ? (
        <div className="result failed">
          <div className="result-icon">✕</div>
          <div className="result-title">{job.status === 'cancelled' ? 'PRINT CANCELLED' : 'PRINT FAILED'}</div>
          {job.status !== 'cancelled' && <div className="result-detail">{job.error || 'Printer may be offline.'}</div>}
        </div>
      ) : isCompleted ? (
        <div className="result success">
          <div className="result-icon">✓</div>
          <div className="result-title">PRINT COMPLETED</div>
        </div>
      ) : (
        <ul className="steps">
          {STEPS.map((step, i) => (
            <li key={step.key} className={i <= currentIndex ? 'done' : i === currentIndex + 1 ? 'active' : ''}>
              <span className="dot" />
              {step.label}
            </li>
          ))}
        </ul>
      )}

      {error && <div className="hint error">{error}</div>}
      {!isFailed && !isCompleted && <div className="hint">Waiting for PC...</div>}

      {canCancel && (
        <button className="link-btn" onClick={handleCancel} disabled={cancelling}>
          {cancelling ? 'Cancelling...' : 'Cancel print'}
        </button>
      )}

      <button className="link-btn" onClick={onReset}>
        ← New test print
      </button>
    </div>
  );
}
