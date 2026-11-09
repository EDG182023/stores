import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { supabase } from './lib/supabase.js';
import { BusinessProvider, useBusiness } from './lib/BusinessContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import Movements from './pages/Movements.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="center muted">Cargando…</div>;
  if (!session) return <Login />;

  return (
    <BusinessProvider session={session}>
      <Shell />
    </BusinessProvider>
  );
}

function Shell() {
  const { business, loading } = useBusiness();
  if (loading) return <div className="center muted">Cargando negocio…</div>;
  if (!business) return <Onboarding />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="productos" element={<Products />} />
        <Route path="movimientos" element={<Movements />} />
        <Route path="configuracion" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
