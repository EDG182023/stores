import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useBusiness } from '../lib/BusinessContext.jsx';
import { CURRENCIES } from '../lib/format.js';

export default function Onboarding() {
  const { session, setBusiness } = useBusiness();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('ARS');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const { data, error: err } = await supabase.from('businesses')
      .insert({ owner_id: session.user.id, name: name.trim(), currency })
      .select().single();
    setBusy(false);
    if (err) return setError(err.message);
    setBusiness(data);
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand big"><span>🏪</span> Tu negocio</div>
        <p className="muted">Contanos cómo se llama tu emprendimiento para empezar.</p>
        <form className="form" onSubmit={submit}>
          <label>Nombre del negocio
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ej: Velas Aurora" autoFocus />
          </label>
          <label>Moneda
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          {error && <div className="alert">{error}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'Creando…' : 'Empezar'}</button>
        </form>
        <button className="link" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
      </div>
    </div>
  );
}
