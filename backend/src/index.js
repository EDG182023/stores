import 'dotenv/config';
import express from 'express';
import { createBot } from './bot.js';
import { api } from './api.js';
import { keyDiagnostics, supabase } from './supabase.js';
import { aiDescription } from './llm.js';

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
// Telegram sólo acepta A-Z a-z 0-9 _ - en el secret_token
const SECRET = (process.env.WEBHOOK_SECRET || 'stockfacil').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200);

const bot = createBot(process.env.TELEGRAM_BOT_TOKEN);
const app = express();

app.get('/', (_req, res) => res.send('StockFácil API ✅'));

// Diagnóstico: abrí /health en el navegador para ver si algo está mal configurado
app.get('/health', async (_req, res) => {
  const supa = keyDiagnostics();
  let db = 'ok';
  const { error } = await supabase.from('businesses').select('id', { head: true, count: 'exact' });
  if (error) db = `error: ${error.message}`;
  let storage = 'ok';
  const { error: se } = await supabase.storage.getBucket('product-images');
  if (se) storage = `falta el bucket product-images (corré migration_002 en Supabase): ${se.message}`;
  res.json({
    ok: supa.ok && db === 'ok',
    mode: PUBLIC_URL ? 'webhook' : 'polling',
    supabase: { ...supa, db, storage },
    ia: aiDescription() ? `activa (${aiDescription()})` : 'falta GEMINI_API_KEY (gratis en aistudio.google.com)',
    ts: new Date().toISOString(),
  });
});

app.use('/api', api);

async function main() {
  if (PUBLIC_URL) {
    const path = `/telegram/${SECRET}`;
    app.use(await bot.createWebhook({ domain: PUBLIC_URL, path, secret_token: SECRET }));
    console.log(`Webhook configurado en ${PUBLIC_URL}/telegram/***`);
  } else {
    bot.launch({ dropPendingUpdates: true });
    console.log('Bot en modo polling (local)');
  }
  await bot.registerCommands().catch((e) => console.warn('setMyCommands:', e.message));
  app.listen(PORT, () => console.log(`Servidor escuchando en :${PORT}`));
}

main().catch((e) => {
  console.error('No se pudo iniciar', e);
  process.exit(1);
});

const shutdown = (sig) => {
  try { bot.stop(sig); } catch { /* en modo webhook no hay polling que detener */ }
  process.exit(0);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
