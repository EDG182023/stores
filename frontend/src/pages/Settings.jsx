import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useBusiness } from '../lib/BusinessContext.jsx';
import { CURRENCIES, dateTime } from '../lib/format.js';

const BOT = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = crypto.getRandomValues(new Uint32Array(8));
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

export default function Settings() {
  const { business, setBusiness } = useBusiness();
  const [name, setName] = useState(business.name);
  const [currency, setCurrency] = useState(business.currency);
  const [saved, setSaved] = useState('');
  const [code, setCode] = useState(null);
  const [links, setLinks] = useState([]);
  const [error, setError] = useState('');

  const loadLinks = useCallback(async () => {
    const { data } = await supabase.from('telegram_links').select('*').eq('business_id', business.id).order('created_at');
    setLinks(data || []);
  }, [business.id]);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  // Mientras hay un código activo, revisa si ya se vinculó
  useEffect(() => {
    if (!code) return undefined;
    const t = setInterval(loadLinks, 4000);
    return () => clearInterval(t);
  }, [code, loadLinks]);

  async function saveBusiness(e) {
    e.preventDefault();
    const { data, error: err } = await supabase.from('businesses')
      .update({ name: name.trim(), currency }).eq('id', business.id).select().single();
    if (err) return setError(err.message);
    setBusiness(data);
    setSaved('Guardado ✓');
    setTimeout(() => setSaved(''), 2000);
  }

  async function generateCode() {
    setError('');
    const c = randomCode();
    const { data, error: err } = await supabase.from('link_codes').insert({ code: c, business_id: business.id }).select().single();
    if (err) return setError(err.message);
    setCode(data);
  }

  async function unlink(l) {
    if (!confirm('¿Desvincular este chat de Telegram?')) return;
    await supabase.from('telegram_links').delete().eq('chat_id', l.chat_id);
    loadLinks();
  }

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Configuración</h1></div>
        <button className="btn ghost small" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
      </header>

      <div className="grid-2">
        <div className="card">
          <h3>🏪 Negocio</h3>
          <form className="form" onSubmit={saveBusiness}>
            <label>Nombre<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Moneda
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <div className="row-inline">
              <button className="btn primary">Guardar</button>
              {saved && <span className="pos">{saved}</span>}
            </div>
          </form>
        </div>

        <div className="card">
          <h3>📱 Vincular Telegram</h3>
          <p className="muted">Cargá stock, ventas y gastos desde Telegram. Podés vincular varios chats (vos, tu socio, un grupo).</p>

          {code ? (
            <div className="code-box">
              <div className="muted small">Tu código (vence {dateTime(code.expires_at)})</div>
              <div className="code">{code.code}</div>
              {BOT ? (
                <a className="btn primary" href={`https://t.me/${BOT}?start=${code.code}`} target="_blank" rel="noreferrer">
                  Abrir @{BOT} y vincular
                </a>
              ) : null}
              <p className="small muted">O enviale al bot: <code>/vincular {code.code}</code></p>
            </div>
          ) : (
            <button className="btn primary" onClick={generateCode}>Generar código de vinculación</button>
          )}
          {error && <div className="alert">{error}</div>}

          <h4>Chats vinculados</h4>
          {links.length === 0 ? <p className="muted small">Ninguno todavía.</p> : (
            <ul className="list">
              {links.map((l) => (
                <li key={l.chat_id}>
                  <span>{l.first_name || 'Chat'} {l.username && <span className="muted">@{l.username}</span>}</span>
                  <button className="btn ghost small" onClick={() => unlink(l)}>Desvincular</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <h3>💬 Comandos del bot</h3>
        <div className="cmd-grid">
          <div><code>/alta Remera | 10 | 5000 | 9500 | 3</code><span>Nombre | cantidad | costo | precio | stock mín.</span></div>
          <div><code>/venta Remera | 2</code><span>Usa el precio cargado (o agregá | precio)</span></div>
          <div><code>/compra Remera | 20 | 4800</code><span>Reponer stock (actualiza costo promedio)</span></div>
          <div><code>/gasto 3500 | envío Andreani</code><span>Gastos del negocio</span></div>
          <div><code>/ajuste Remera | -1 | fallada</code><span>Corregir stock</span></div>
          <div><code>/resumen hoy</code><span>hoy · semana · mes · anio</span></div>
          <div><code>/stock</code> <code>/bajo</code><span>Stock actual y alertas</span></div>
          <div><code>/deshacer</code><span>Borra tu último movimiento</span></div>
        </div>
      </div>
    </div>
  );
}
