import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import PrintTest from './components/PrintTest';
import Login from './components/Login';
import AdminPanel from './components/AdminPanel';
import Settings from './components/Settings';
import Compatibility from './components/Compatibility';
import ShopDashboard from './components/ShopDashboard';
import CustomerPrintPage from './components/CustomerPrintPage';
import { getToken, getUser, clearToken } from './api';

/** Everything that existed before multi-shop: login + personal print/admin
 * flow, keyed by role. Untouched for 'admin'/'user' roles - only the new
 * 'shop_owner' role branches to a different screen. */
function LegacyApp() {
  const [authed, setAuthed] = useState(!!getToken());
  const [view, setView] = useState('print'); // 'print' | 'admin' | 'settings' | 'compatibility'
  const user = getUser();

  function handleLogout() {
    clearToken();
    setAuthed(false);
    setView('print');
  }

  if (!authed) {
    return <Login onAuthenticated={() => setAuthed(true)} />;
  }

  if (user?.role === 'shop_owner') {
    return <ShopDashboard onBack={handleLogout} />;
  }

  if (view === 'admin') return <AdminPanel onBack={() => setView('print')} />;
  if (view === 'settings') return <Settings onBack={() => setView('print')} />;
  if (view === 'compatibility') return <Compatibility onBack={() => setView('print')} />;

  return (
    <PrintTest
      onLogout={handleLogout}
      isAdmin={user?.role === 'admin'}
      onOpenAdmin={() => setView('admin')}
      onOpenSettings={() => setView('settings')}
      onOpenCompatibility={() => setView('compatibility')}
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          {/* QR landing page - public, no login, one per shop (spec section 7) */}
          <Route path="/print/shop/:shopId" element={<CustomerPrintPage />} />
          <Route path="/*" element={<LegacyApp />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
