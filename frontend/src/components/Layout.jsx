import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useBusiness } from '../lib/BusinessContext.jsx';
import Assistant from './Assistant.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/productos', label: 'Productos', icon: '📦' },
  { to: '/movimientos', label: 'Movimientos', icon: '🧾' },
  { to: '/configuracion', label: 'Ajustes', icon: '⚙️' },
];

export default function Layout() {
  const { business, session } = useBusiness();
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className={`app${chatOpen ? ' chat-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><span>📦</span> StockFácil</div>
        <div className="biz-name" title={business.name}>{business.name}</div>
        <nav>
          {NAV.slice(0, 3).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="nav-icon">{n.icon}</span><span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
          <button className={`nav-item nav-assistant${chatOpen ? ' active' : ''}`} onClick={() => setChatOpen((o) => !o)}>
            <span className="nav-icon">✨</span><span className="nav-label">Asistente</span>
          </button>
          {NAV.slice(3).map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="nav-icon">{n.icon}</span><span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="muted small ellipsis">{session.user.email}</div>
          <button className="btn ghost small" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>

      {!chatOpen && (
        <button className="fab" onClick={() => setChatOpen(true)} title="Abrir asistente">✨<span>Asistente</span></button>
      )}
      <Assistant open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
