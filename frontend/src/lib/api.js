import { supabase } from './supabase.js';

export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** Llama al backend (Render) con la sesión del usuario */
export async function apiPost(path, body, { timeoutMs = 90000 } = {}) {
  if (!API_URL) throw new Error('Falta configurar VITE_API_URL (URL del backend en Render).');
  const { data } = await supabase.auth.getSession();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('El servidor tardó demasiado. Si estuvo inactivo puede estar "despertando": probá de nuevo.');
    if (e instanceof TypeError) throw new Error('No se pudo conectar con el servidor. Puede estar despertando (plan gratis de Render): esperá unos segundos y reintentá.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Avisa a las páginas que los datos cambiaron (por el asistente) */
export const notifyDataChanged = () => window.dispatchEvent(new Event('stockfacil:changed'));
export function onDataChanged(cb) {
  window.addEventListener('stockfacil:changed', cb);
  return () => window.removeEventListener('stockfacil:changed', cb);
}
