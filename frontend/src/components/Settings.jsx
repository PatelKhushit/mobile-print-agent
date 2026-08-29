import { useState } from 'react';
import { changePassword, getUser } from '../api';

export default function Settings({ onBack }) {
  const user = getUser();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setStatus('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setStatus('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1>SETTINGS</h1>

      <div className="field">
        <span>Signed in as</span>
        <div className="status-line" style={{ marginTop: 0 }}>
          {user?.email || '-'}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <label className="field">
          <span>Current password</span>
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>

        {error && <div className="hint error">{error}</div>}
        {status && <div className="hint">{status}</div>}

        <button className="primary-btn" type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'CHANGE PASSWORD'}
        </button>
      </form>

      <button className="link-btn" onClick={onBack}>
        ← Back
      </button>
    </div>
  );
}
