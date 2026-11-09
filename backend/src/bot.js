import { Telegraf } from 'telegraf';
import { supabase } from './supabase.js';
import {
  commandArgs, splitArgs, parseNumber, money, qty, esc, likeEscape, dateTime,
} from './utils.js';

const TZ = process.env.TZ_NEGOCIO || 'America/Argentina/Buenos_Aires';
const FRONTEND_URL = process.env.FRONTEND_URL || '';

export const HELP = `<b>📦 StockFácil — comandos</b>

<b>Productos y stock</b>
/alta Nombre | cantidad | costo | precio [| stock mín]
   <i>ej: /alta Remera negra | 10 | 5000 | 9500 | 3</i>
/compra Producto | cantidad [| costo unitario]
   <i>reponer stock (inversión)</i>
/venta Producto | cantidad [| precio unitario]
/ajuste Producto | +/-cantidad [| motivo]
/precio Producto | precio venta [| costo]
/stock [búsqueda] — ver stock
/bajo — productos con stock bajo

<b>Caja</b>
/gasto monto | descripción
/ingreso monto | descripción

<b>Datos del negocio</b>
/resumen [hoy|semana|mes|anio]
/ultimos — últimos movimientos
/deshacer — borra tu último movimiento
/negocio — info del negocio

Separá los datos con <code>|</code> o <code>;</code>. Los números aceptan 1.500,50 o 1500.5`;

const COMMANDS = [
  ['alta', 'Dar de alta un producto'],
  ['venta', 'Registrar una venta'],
  ['compra', 'Reponer stock'],
  ['gasto', 'Registrar un gasto'],
  ['ingreso', 'Registrar otro ingreso'],
  ['ajuste', 'Ajustar stock'],
  ['precio', 'Cambiar precio'],
  ['stock', 'Ver stock'],
  ['bajo', 'Stock bajo'],
  ['resumen', 'Resumen del negocio'],
  ['ultimos', 'Últimos movimientos'],
  ['deshacer', 'Deshacer último movimiento'],
  ['negocio', 'Info del negocio'],
  ['ayuda', 'Ver comandos'],
];

const ICON = { venta: '🟢', compra: '🔵', ajuste: '⚙️', gasto: '🔴', ingreso: '🟡' };

const html = (ctx, text, extra = {}) =>
  ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

class UserError extends Error {}
const fail = (msg) => { throw new UserError(msg); };

function num(value, label, { allowZero = true, allowNegative = false } = {}) {
  const n = parseNumber(value);
  if (Number.isNaN(n)) fail(`"${value}" no es un número válido para ${label}.`);
  if (!allowNegative && n < 0) fail(`${label} no puede ser negativo.`);
  if (!allowZero && n === 0) fail(`${label} debe ser mayor a 0.`);
  return n;
}

async function findProduct(businessId, query) {
  const q = (query || '').trim();
  if (!q) fail('Indicá el producto.');
  const base = () => supabase.from('products').select('*')
    .eq('business_id', businessId).eq('active', true);

  // 1) nombre exacto (sin mayúsculas)  2) SKU exacto  3) contiene
  let { data } = await base().ilike('name', likeEscape(q)).limit(2);
  if (data?.length === 1) return data[0];
  ({ data } = await base().eq('sku', q).limit(2));
  if (data?.length === 1) return data[0];
  ({ data } = await base().ilike('name', `%${likeEscape(q)}%`).order('name').limit(8));
  if (!data?.length) fail(`No encontré "${q}". Mirá /stock o dalo de alta con /alta.`);
  if (data.length > 1) {
    fail(`Hay varios productos con "${q}":\n` + data.map((p) => `• ${p.name}`).join('\n') +
      '\nEscribí el nombre más completo.');
  }
  return data[0];
}

async function insertMovement(ctx, business, row) {
  const { data, error } = await supabase.from('movements').insert({
    business_id: business.id,
    source: 'telegram',
    created_by: String(ctx.chat.id),
    ...row,
  }).select().single();
  if (error) fail(error.message);
  return data;
}

async function getProduct(id) {
  const { data } = await supabase.from('products').select('*').eq('id', id).single();
  return data;
}

function lowStockWarn(p) {
  return Number(p.stock) <= Number(p.min_stock)
    ? `\n⚠️ <b>Stock bajo</b> (mínimo ${qty(p.min_stock)})` : '';
}

export function createBot(token) {
  if (!token) {
    console.error('Falta TELEGRAM_BOT_TOKEN');
    process.exit(1);
  }
  const bot = new Telegraf(token);

  // Carga el negocio vinculado a este chat
  bot.use(async (ctx, next) => {
    if (ctx.chat) {
      const { data } = await supabase
        .from('telegram_links')
        .select('business_id, businesses(id, name, currency)')
        .eq('chat_id', ctx.chat.id)
        .maybeSingle();
      ctx.state.business = data?.businesses || null;
    }
    return next();
  });

  // Envoltorio: exige vínculo y maneja errores
  const cmd = (name, handler) => bot.command(name, async (ctx) => {
    const business = ctx.state.business;
    if (!business) {
      return html(ctx, '🔗 Este chat no está vinculado a ningún negocio.\n\n' +
        'Entrá al panel web → <b>Configuración</b> → <b>Vincular Telegram</b> y enviá aquí ' +
        '<code>/vincular CODIGO</code>.' + (FRONTEND_URL ? `\n\n${esc(FRONTEND_URL)}` : ''));
    }
    try {
      await handler(ctx, business, commandArgs(ctx.message.text));
    } catch (e) {
      if (!(e instanceof UserError)) console.error(`[/${name}]`, e);
      await html(ctx, '⚠️ ' + esc(e.message || 'Error inesperado'));
    }
  });

  // ---------- Vinculación ----------
  async function linkChat(ctx, rawCode) {
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) return html(ctx, 'Usá: <code>/vincular CODIGO</code>');
    const { data: lc } = await supabase.from('link_codes').select('*').eq('code', code).maybeSingle();
    if (!lc || new Date(lc.expires_at) < new Date()) {
      return ctx.reply('❌ Código inválido o vencido. Generá uno nuevo desde el panel web.');
    }
    const { error } = await supabase.from('telegram_links').upsert({
      chat_id: ctx.chat.id,
      business_id: lc.business_id,
      username: ctx.from?.username || null,
      first_name: ctx.from?.first_name || null,
    });
    if (error) {
      console.error(error);
      return ctx.reply('⚠️ No se pudo vincular. Probá de nuevo.');
    }
    await supabase.from('link_codes').delete().eq('code', code);
    const { data: b } = await supabase.from('businesses').select('name').eq('id', lc.business_id).single();
    return html(ctx, `✅ Chat vinculado a <b>${esc(b?.name)}</b>.\n\n${HELP}`);
  }

  bot.start(async (ctx) => {
    const payload = commandArgs(ctx.message.text);
    if (payload) return linkChat(ctx, payload);
    if (ctx.state.business) {
      return html(ctx, `👋 Hola! Estás en <b>${esc(ctx.state.business.name)}</b>.\n\n${HELP}`);
    }
    return html(ctx, '👋 <b>Bienvenido a StockFácil</b>\n\nGestioná el stock y las ventas de tu ' +
      'emprendimiento desde Telegram.\n\nPara empezar, creá tu cuenta en el panel web, andá a ' +
      '<b>Configuración → Vincular Telegram</b> y enviá aquí <code>/vincular CODIGO</code>.' +
      (FRONTEND_URL ? `\n\n${esc(FRONTEND_URL)}` : ''));
  });

  bot.command('vincular', (ctx) => linkChat(ctx, commandArgs(ctx.message.text)));
  bot.command(['ayuda', 'help'], (ctx) => html(ctx, HELP));

  // ---------- Productos ----------
  cmd('alta', async (ctx, b, args) => {
    const [name, c = '0', costo = '0', precio = '0', min = '0'] = splitArgs(args);
    if (!name) {
      return html(ctx, 'Usá: <code>/alta Nombre | cantidad | costo | precio | stock mín</code>\n' +
        '<i>ej: /alta Taza cerámica | 12 | 2500 | 6000 | 4</i>');
    }
    const cantidad = num(c, 'la cantidad');
    const unitCost = num(costo, 'el costo');
    const salePrice = num(precio, 'el precio');
    const minStock = num(min, 'el stock mínimo');

    const { data: p, error } = await supabase.from('products').insert({
      business_id: b.id, name, unit_cost: unitCost, sale_price: salePrice, min_stock: minStock,
    }).select().single();
    if (error) {
      if (error.code === '23505') fail(`Ya existe "${name}". Usá /compra para sumar stock.`);
      fail(error.message);
    }
    if (cantidad > 0) {
      await insertMovement(ctx, b, {
        type: 'compra', product_id: p.id, quantity: cantidad, unit_price: unitCost, note: 'Alta de producto',
      });
    }
    const margen = salePrice > 0 ? ((salePrice - unitCost) / salePrice) * 100 : 0;
    return html(ctx, `✅ <b>${esc(p.name)}</b> dado de alta\n` +
      `Stock: ${qty(cantidad)} u\nCosto: ${money(unitCost, b.currency)} · Precio: ${money(salePrice, b.currency)}\n` +
      `Margen: ${margen.toFixed(1)}%` +
      (cantidad > 0 ? `\nInvertido: ${money(cantidad * unitCost, b.currency)}` : ''));
  });

  cmd('compra', async (ctx, b, args) => {
    const [prod, c, costo] = splitArgs(args);
    if (!prod || !c) return html(ctx, 'Usá: <code>/compra Producto | cantidad | costo unitario</code>');
    const p = await findProduct(b.id, prod);
    const m = await insertMovement(ctx, b, {
      type: 'compra', product_id: p.id,
      quantity: num(c, 'la cantidad', { allowZero: false }),
      unit_price: costo ? num(costo, 'el costo') : 0,
    });
    const np = await getProduct(p.id);
    return html(ctx, `🔵 <b>Compra registrada</b>\n${qty(m.quantity)} × ${esc(p.name)} a ${money(m.unit_price, b.currency)}\n` +
      `Total invertido: <b>${money(m.total, b.currency)}</b>\nStock actual: ${qty(np.stock)} u · ` +
      `Costo prom.: ${money(np.unit_cost, b.currency)}`);
  });

  cmd('venta', async (ctx, b, args) => {
    const [prod, c = '1', precio] = splitArgs(args);
    if (!prod) return html(ctx, 'Usá: <code>/venta Producto | cantidad | precio</code>\n<i>ej: /venta Remera negra | 2</i>');
    const p = await findProduct(b.id, prod);
    const m = await insertMovement(ctx, b, {
      type: 'venta', product_id: p.id,
      quantity: num(c, 'la cantidad', { allowZero: false }),
      unit_price: precio ? num(precio, 'el precio') : 0,
    });
    const np = await getProduct(p.id);
    const ganancia = Number(m.total) - Number(m.quantity) * Number(m.unit_cost);
    return html(ctx, `🟢 <b>Venta registrada</b>\n${qty(m.quantity)} × ${esc(p.name)} a ${money(m.unit_price, b.currency)}\n` +
      `Total: <b>${money(m.total, b.currency)}</b> · Ganancia: ${money(ganancia, b.currency)}\n` +
      `Stock restante: ${qty(np.stock)} u${lowStockWarn(np)}`);
  });

  cmd('ajuste', async (ctx, b, args) => {
    const [prod, c, motivo] = splitArgs(args);
    if (!prod || !c) return html(ctx, 'Usá: <code>/ajuste Producto | -2 | rotura</code>');
    const p = await findProduct(b.id, prod);
    await insertMovement(ctx, b, {
      type: 'ajuste', product_id: p.id,
      quantity: num(c, 'la cantidad', { allowZero: false, allowNegative: true }),
      note: motivo || null,
    });
    const np = await getProduct(p.id);
    return html(ctx, `⚙️ Ajuste aplicado a <b>${esc(p.name)}</b>. Stock: ${qty(np.stock)} u${lowStockWarn(np)}`);
  });

  cmd('precio', async (ctx, b, args) => {
    const [prod, precio, costo] = splitArgs(args);
    if (!prod || !precio) return html(ctx, 'Usá: <code>/precio Producto | precio venta | costo</code>');
    const p = await findProduct(b.id, prod);
    const upd = { sale_price: num(precio, 'el precio') };
    if (costo) upd.unit_cost = num(costo, 'el costo');
    const { data: np, error } = await supabase.from('products').update(upd).eq('id', p.id).select().single();
    if (error) fail(error.message);
    const margen = np.sale_price > 0 ? ((np.sale_price - np.unit_cost) / np.sale_price) * 100 : 0;
    return html(ctx, `💲 <b>${esc(np.name)}</b>\nPrecio: ${money(np.sale_price, b.currency)} · ` +
      `Costo: ${money(np.unit_cost, b.currency)} · Margen: ${margen.toFixed(1)}%`);
  });

  cmd('stock', async (ctx, b, args) => {
    let q = supabase.from('products').select('name, stock, min_stock, sale_price, unit_cost')
      .eq('business_id', b.id).eq('active', true).order('name').limit(60);
    if (args) q = q.ilike('name', `%${likeEscape(args)}%`);
    const { data, error } = await q;
    if (error) fail(error.message);
    if (!data.length) return ctx.reply(args ? `Sin resultados para "${args}".` : 'Todavía no hay productos. Usá /alta.');
    const valor = data.reduce((s, p) => s + p.stock * p.unit_cost, 0);
    const lines = data.map((p) => `${Number(p.stock) <= Number(p.min_stock) ? '⚠️' : '•'} ${esc(p.name)} — <b>${qty(p.stock)}</b> u · ${money(p.sale_price, b.currency)}`);
    return html(ctx, `<b>📦 Stock${args ? ` "${esc(args)}"` : ''}</b> (${data.length})\n\n${lines.join('\n')}\n\n` +
      `Valor a costo: <b>${money(valor, b.currency)}</b>`);
  });

  cmd('bajo', async (ctx, b) => {
    const { data, error } = await supabase.rpc('get_dashboard_period', { p_business: b.id, p_period: 'hoy', p_tz: TZ });
    if (error) fail(error.message);
    const list = data.bajo_stock;
    if (!list.length) return ctx.reply('✅ Ningún producto está por debajo del stock mínimo.');
    return html(ctx, '<b>⚠️ Stock bajo</b>\n\n' + list.map((p) =>
      `• ${esc(p.nombre)} — ${qty(p.stock)} u (mín. ${qty(p.min_stock)})`).join('\n'));
  });

  // ---------- Caja ----------
  const cash = (type) => async (ctx, b, args) => {
    let [monto, desc] = splitArgs(args);
    if (monto && desc === undefined) {
      // permite "/gasto 5000 envío a cliente"
      const m = monto.match(/^(\S+)\s*(.*)$/);
      monto = m[1]; desc = m[2];
    }
    if (!monto) return html(ctx, `Usá: <code>/${type} monto | descripción</code>`);
    const total = num(monto, 'el monto', { allowZero: false });
    await insertMovement(ctx, b, { type, total, note: desc || null });
    return html(ctx, `${ICON[type]} ${type === 'gasto' ? 'Gasto' : 'Ingreso'} registrado: <b>${money(total, b.currency)}</b>` +
      (desc ? `\n${esc(desc)}` : ''));
  };
  cmd('gasto', cash('gasto'));
  cmd('ingreso', cash('ingreso'));

  // ---------- Datos ----------
  cmd('resumen', async (ctx, b, args) => {
    const period = (args || 'mes').toLowerCase().replace('año', 'anio');
    const names = { hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes', anio: 'Este año' };
    if (!names[period]) return html(ctx, 'Usá: <code>/resumen hoy|semana|mes|anio</code>');
    const { data, error } = await supabase.rpc('get_dashboard_period', { p_business: b.id, p_period: period, p_tz: TZ });
    if (error) fail(error.message);
    const k = data.kpis; const s = data.stock; const h = data.historico; const c = b.currency;
    const top = data.top.slice(0, 3).map((t, i) => `${i + 1}. ${esc(t.nombre)} — ${qty(t.unidades)} u · ${money(t.ventas, c)}`).join('\n');
    return html(ctx, `<b>📊 ${esc(b.name)} · ${names[period]}</b>

💰 Ventas: <b>${money(k.ventas, c)}</b> (${k.cantidad_ventas} ventas · ${qty(k.unidades_vendidas)} u)
📈 Ganancia bruta: ${money(k.ganancia_bruta, c)} · margen ${k.margen}%
🔴 Gastos: ${money(k.gastos, c)}
✅ <b>Ganancia neta: ${money(k.ganancia_neta, c)}</b>

🔵 Invertido en mercadería: ${money(k.compras, c)}
⬆️ Entradas: ${money(k.entradas, c)} · ⬇️ Salidas: ${money(k.salidas, c)}
💵 Balance de caja: <b>${money(k.balance_caja, c)}</b>

📦 Stock valorizado: ${money(s.valor_costo, c)} (a precio de venta ${money(s.valor_venta, c)})
⚠️ Productos con stock bajo: ${data.bajo_stock.length}
${top ? `\n<b>🏆 Más vendidos</b>\n${top}\n` : ''}
<i>Histórico: invertido ${money(h.invertido_total, c)} · ganancia ${money(h.ganancia_total, c)}</i>` +
      (FRONTEND_URL ? `\n\n📊 Dashboard completo: ${esc(FRONTEND_URL)}` : ''));
  });

  cmd('ultimos', async (ctx, b) => {
    const { data, error } = await supabase.from('movements')
      .select('type, quantity, total, note, created_at, products(name)')
      .eq('business_id', b.id).order('created_at', { ascending: false }).limit(10);
    if (error) fail(error.message);
    if (!data.length) return ctx.reply('Todavía no hay movimientos.');
    return html(ctx, '<b>🧾 Últimos movimientos</b>\n\n' + data.map((m) => {
      const what = m.products ? `${qty(m.quantity)} × ${esc(m.products.name)}` : esc(m.note || '');
      return `${ICON[m.type]} ${dateTime(m.created_at, TZ)} · ${m.type} · ${what}${m.type !== 'ajuste' ? ` · ${money(m.total, b.currency)}` : ''}`;
    }).join('\n'));
  });

  cmd('deshacer', async (ctx, b) => {
    const { data: m } = await supabase.from('movements')
      .select('id, type, quantity, total, note, products(name)')
      .eq('business_id', b.id).eq('created_by', String(ctx.chat.id))
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!m) return ctx.reply('No hay movimientos tuyos para deshacer.');
    const { error } = await supabase.from('movements').delete().eq('id', m.id);
    if (error) fail(error.message);
    const what = m.products ? `${qty(m.quantity)} × ${esc(m.products.name)}` : esc(m.note || '');
    return html(ctx, `↩️ Deshecho: ${ICON[m.type]} ${m.type} ${what} (${money(m.total, b.currency)})`);
  });

  cmd('negocio', async (ctx, b) => {
    const { count } = await supabase.from('telegram_links').select('*', { count: 'exact', head: true }).eq('business_id', b.id);
    return html(ctx, `🏪 <b>${esc(b.name)}</b>\nMoneda: ${b.currency}\nChats vinculados: ${count}` +
      (FRONTEND_URL ? `\nPanel: ${esc(FRONTEND_URL)}` : ''));
  });

  // Mensajes sueltos
  bot.on('text', (ctx) => {
    if (ctx.message.text.startsWith('/')) return ctx.reply('Comando desconocido. Mirá /ayuda');
    return ctx.reply('Usá un comando, por ejemplo /venta Remera | 1 — o /ayuda para ver todos.');
  });

  bot.catch((err, ctx) => {
    console.error('Error del bot', err);
    ctx.reply?.('⚠️ Ocurrió un error inesperado.').catch(() => {});
  });

  bot.registerCommands = () => bot.telegram.setMyCommands(
    COMMANDS.map(([command, description]) => ({ command, description })),
  );

  return bot;
}
