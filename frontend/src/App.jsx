import { useState } from 'react';
import PrintTest from './components/PrintTest';
import Login from './components/Login';
import AdminPanel from './components/AdminPanel';
import Settings from './components/Settings';
import { getToken, getUser, clearToken } from './api';

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [view, setView] = useState('print'); // 'print' | 'admin' | 'settings'
  const user = getUser();

  function handleLogout() {
    clearToken();
    setAuthed(false);
    setView('print');
  }

  if (!authed) {
    return (
      <div className="app">
        <Login onAuthenticated={() => setAuthed(true)} />
      </div>
    );
  }

  return (
    <div className="app">
      {view === 'admin' ? (
        <AdminPanel onBack={() => setView('print')} />
      ) : view === 'settings' ? (
        <Settings onBack={() => setView('print')} />
      ) : (
        <PrintTest
          onLogout={handleLogout}
          isAdmin={user?.role === 'admin'}
          onOpenAdmin={() => setView('admin')}
          onOpenSettings={() => setView('settings')}
        />
      )}
    </div>
  );
}
