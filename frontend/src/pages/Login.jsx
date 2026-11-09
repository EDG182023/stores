import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

export default function Login() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ err: true, text: error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : error.message });
    } else if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
      if (error) setMsg({ err: true, text: error.message });
      else if (!data.session) setMsg({ text: 'Te enviamos un email para confirmar la cuenta. Después iniciá sesión.' });
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      setMsg(error ? { err: true, text: error.message } : { text: 'Si el email existe, te llegará un enlace para recuperar la contraseña.' });
    }
    setBusy(false);
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand big"><span>📦</span> StockFácil</div>
        <p className="muted">Stock, ventas y ganancias de tu emprendimiento. Desde la web o Telegram.</p>
        <form onSubmit={submit} className="form">
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
          {mode !== 'reset' && (
            <label>Contraseña
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </label>
          )}
          {msg && <div className={msg.err ? 'alert' : 'notice'}>{msg.text}</div>}
          <button className="btn primary" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Ingresar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
          </button>
        </form>
        <div className="auth-links">
          {mode !== 'login' && <button className="link" onClick={() => setMode('login')}>Ya tengo cuenta</button>}
          {mode !== 'signup' && <button className="link" onClick={() => setMode('signup')}>Crear cuenta nueva</button>}
          {mode === 'login' && <button className="link" onClick={() => setMode('reset')}>Olvidé mi contraseña</button>}
        </div>
      </div>
    </div>
  );
}
