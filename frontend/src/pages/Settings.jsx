import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useBusiness } from '../lib/BusinessContext.jsx';
import { CURRENCIES, dateTime } from '../lib/format.js';
import { API_URL } from '../lib/api.js';

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

      <IntegrationCard business={business} setBusiness={setBusiness} />

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

function IntegrationCard({ business, setBusiness }) {
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState('');
  const endpoint = API_URL ? `${API_URL}/api/v1/catalog` : '(configurá VITE_API_URL)';

  async function regenerate() {
    if (!confirm('¿Generar una clave nueva? Las tiendas que usen la anterior dejarán de funcionar.')) return;
    const { data, error } = await supabase.rpc('regenerate_api_key', { p_business: business.id });
    if (error) return setMsg(error.message);
    setBusiness({ ...business, api_key: data });
    setMsg('Clave regenerada ✓');
  }

  function copy(text) {
    navigator.clipboard?.writeText(text).then(() => { setMsg('Copiado ✓'); setTimeout(() => setMsg(''), 1500); });
  }

  return (
    <div className="card">
      <h3>🔌 Integración con tiendas online</h3>
      <p className="muted">Tu catálogo (nombre, precio, stock, fotos, medidas y peso) disponible para conectar con tu web de ventas, Tiendanube, WooCommerce o Mercado Libre.</p>
      {!business.api_key ? (
        <p className="alert">Falta actualizar la base de datos: corré <code>migration_002_asistente_fotos.sql</code> en Supabase.</p>
      ) : (
        <div className="form">
          <label>Endpoint del catálogo
            <div className="row-inline"><input readOnly value={endpoint} /><button className="btn ghost small" type="button" onClick={() => copy(endpoint)}>Copiar</button></div>
          </label>
          <label>API key (header <code>X-Api-Key</code>)
            <div className="row-inline">
              <input readOnly value={show ? business.api_key : '•'.repeat(24)} />
              <button className="btn ghost small" type="button" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Ver'}</button>
              <button className="btn ghost small" type="button" onClick={() => copy(business.api_key)}>Copiar</button>
            </div>
          </label>
          <div className="row-inline">
            <button className="btn ghost small" type="button" onClick={regenerate}>Regenerar clave</button>
            {API_URL && <a className="btn ghost small" href={`${API_URL}/health`} target="_blank" rel="noreferrer">Diagnóstico del servidor</a>}
            {msg && <span className="pos small">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
