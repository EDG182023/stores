import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

/**
 * Detecta si la clave cargada es la correcta (secreta / service_role).
 * Error muy común: pegar la publishable/anon. Con esa clave la seguridad (RLS)
 * oculta todos los datos y el bot dice "código inválido" aunque exista.
 */
export function keyDiagnostics() {
  const key = SUPABASE_SERVICE_ROLE_KEY.trim();
  const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || 'desconocido';
  let tipo = 'desconocida';
  if (key.startsWith('sb_secret_')) tipo = 'secret';
  else if (key.startsWith('sb_publishable_')) tipo = 'publishable';
  else if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
      tipo = payload.role === 'service_role' ? 'service_role' : `jwt:${payload.role}`;
      if (payload.ref && payload.ref !== projectRef) tipo += ` (de otro proyecto: ${payload.ref})`;
    } catch { /* ignorar */ }
  }
  const ok = tipo === 'secret' || tipo === 'service_role';
  return {
    ok,
    proyecto: projectRef,
    tipo_clave: tipo,
    mensaje: ok ? 'Clave correcta'
      : 'SUPABASE_SERVICE_ROLE_KEY no es la clave secreta. En Supabase > Project Settings > API Keys copiá la "secret" (sb_secret_...) o la "service_role" y pegala en Render.',
  };
}

const diag = keyDiagnostics();
if (!diag.ok) console.error('⚠️  ' + diag.mensaje, diag);

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.trim(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const IMAGES_BUCKET = 'product-images';

/** Sube un archivo a Storage y devuelve la URL pública */
export async function uploadImage(businessId, buffer, contentType = 'image/jpeg', prefix = 'img') {
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const path = `${businessId}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(IMAGES_BUCKET).upload(path, buffer, { contentType, upsert: false });
  if (error) throw new Error('No se pudo guardar la foto: ' + error.message);
  return supabase.storage.from(IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}
