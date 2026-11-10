import express from 'express';
import { supabase } from './supabase.js';
import { runAgent, aiEnabled } from './agent.js';
import { transcribe } from './llm.js';

export const api = express.Router();

// CORS: la autenticación es por token Bearer, así que se puede aceptar cualquier origen
api.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Api-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});
api.use(express.json({ limit: '12mb' }));

/** Valida el JWT de Supabase y carga el negocio del usuario */
async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Falta iniciar sesión' });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Sesión vencida, volvé a ingresar' });
  const { data: business } = await supabase.from('businesses').select('id, name, currency')
    .eq('owner_id', data.user.id).order('created_at').limit(1).maybeSingle();
  if (!business) return res.status(404).json({ error: 'Creá tu negocio primero' });
  req.user = data.user;
  req.business = business;
  return next();
}

api.get('/status', (_req, res) => res.json({ ai: aiEnabled() }));

// ---------- Asistente ----------
api.post('/chat', auth, async (req, res) => {
  const { message = '', history = [], image_url: imageUrl } = req.body || {};
  if (!message.trim() && !imageUrl) return res.status(400).json({ error: 'Mensaje vacío' });
  // Sólo se aceptan fotos subidas al Storage del propio negocio
  if (imageUrl && !imageUrl.includes(`/product-images/${req.business.id}/`)) {
    return res.status(400).json({ error: 'Foto no válida' });
  }
  try {
    const out = await runAgent({
      business: req.business, history, message, imageUrl, source: 'asistente', createdBy: req.user.id,
    });
    return res.json(out);
  } catch (e) {
    console.error('[chat]', e);
    const msg = e?.status === 401 || e?.status === 403 ? 'La clave de la IA es inválida (revisá GEMINI_API_KEY en Render).'
      : e?.status === 429 ? 'Se agotó el cupo gratuito de la IA por ahora. Esperá un rato (se renueva por minuto y por día).'
        : 'Error del asistente: ' + (e.message || 'desconocido');
    return res.status(500).json({ error: msg });
  }
});

// ---------- Audio a texto (para navegadores sin dictado) ----------
api.post('/transcribe', auth, async (req, res) => {
  const { audio_base64: b64, mime = 'audio/ogg' } = req.body || {};
  if (!b64) return res.status(400).json({ error: 'Falta el audio' });
  try {
    const text = await transcribe(Buffer.from(b64, 'base64'), mime);
    return res.json({ text });
  } catch (e) {
    console.error('[transcribe]', e.message);
    return res.status(e.status === 429 ? 429 : 500).json({ error: e.message });
  }
});

// ---------- Catálogo público para tiendas online ----------
// GET /api/v1/catalog  con header  X-Api-Key: <clave del negocio>  (o ?key=)
api.get('/v1/catalog', async (req, res) => {
  const key = req.headers['x-api-key'] || req.query.key;
  if (!key) return res.status(401).json({ error: 'Falta X-Api-Key' });
  const { data: b } = await supabase.from('businesses').select('id, name, currency').eq('api_key', String(key)).maybeSingle();
  if (!b) return res.status(401).json({ error: 'API key inválida' });
  let q = supabase.from('products')
    .select('id, name, sku, barcode, category, brand, description, sale_price, stock, image_url, weight_kg, length_cm, width_cm, height_cm, attributes, updated_at')
    .eq('business_id', b.id).eq('active', true).order('name');
  if (req.query.in_stock === 'true') q = q.gt('stock', 0);
  if (req.query.updated_since) q = q.gte('updated_at', String(req.query.updated_since));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({
    business: b.name,
    currency: b.currency,
    count: data.length,
    products: data.map((p) => ({
      id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, category: p.category, brand: p.brand,
      description: p.description, price: Number(p.sale_price), stock: Number(p.stock), image: p.image_url,
      weight_kg: p.weight_kg !== null ? Number(p.weight_kg) : null,
      dimensions_cm: { length: p.length_cm, width: p.width_cm, height: p.height_cm },
      attributes: p.attributes, updated_at: p.updated_at,
    })),
  });
});
