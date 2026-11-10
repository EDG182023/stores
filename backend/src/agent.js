// Asistente IA del negocio: entiende lenguaje natural, fotos y ejecuta acciones con herramientas.
import Anthropic from '@anthropic-ai/sdk';
import {
  UserError, searchProducts, getProduct, createProduct, updateProduct, insertMovement,
  dashboard, lastMovements, deleteMovement,
} from './actions.js';

const MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
const TZ = process.env.TZ_NEGOCIO || 'America/Argentina/Buenos_Aires';
const MAX_STEPS = 10;

let client = null;
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
const ai = () => (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

const n = (desc) => ({ type: 'number', description: desc });
const s = (desc) => ({ type: 'string', description: desc });

const PRODUCT_PROPS = {
  nombre: s('Nombre del producto'),
  costo: n('Costo unitario de compra'),
  precio: n('Precio de venta unitario'),
  stock_minimo: n('Stock mínimo para alertas'),
  sku: s('Código interno / SKU'),
  categoria: s('Categoría (ej: Remeras, Velas)'),
  marca: s('Marca'),
  codigo_barras: s('Código de barras EAN/UPC'),
  descripcion: s('Descripción comercial para publicar en tiendas online'),
  peso_kg: n('Peso en kilogramos'),
  largo_cm: n('Largo en cm'),
  ancho_cm: n('Ancho en cm'),
  alto_cm: n('Alto en cm'),
  atributos: { type: 'object', description: 'Atributos libres: {"talle":"M","color":"negro","material":"algodón"}', additionalProperties: { type: 'string' } },
  usar_foto_adjunta: { type: 'boolean', description: 'true para guardar como foto del producto la imagen que adjuntó el usuario en este mensaje' },
};

const TOOLS = [
  {
    name: 'buscar_productos',
    description: 'Busca productos del catálogo por texto (nombre, SKU, categoría, marca, descripción). Sin texto devuelve todo el catálogo. Usalo SIEMPRE antes de vender, reponer o editar para obtener el producto_id.',
    input_schema: { type: 'object', properties: { texto: s('Texto a buscar (opcional)'), solo_stock_bajo: { type: 'boolean' } } },
  },
  {
    name: 'ver_fotos_productos',
    description: 'Muestra las fotos de hasta 4 productos para compararlas visualmente con la foto que mandó el usuario. Usalo para identificar qué producto es.',
    input_schema: { type: 'object', properties: { producto_ids: { type: 'array', items: { type: 'string' }, maxItems: 4 } }, required: ['producto_ids'] },
  },
  {
    name: 'crear_producto',
    description: 'Da de alta un producto nuevo. Si hay cantidad_inicial se registra como compra (inversión) al costo indicado.',
    input_schema: { type: 'object', properties: { ...PRODUCT_PROPS, cantidad_inicial: n('Stock inicial') }, required: ['nombre'] },
  },
  {
    name: 'actualizar_producto',
    description: 'Modifica datos de un producto: precio, costo, medidas, peso, descripción, atributos, foto. NO cambia el stock (para eso usar registrar_movimiento).',
    input_schema: { type: 'object', properties: { producto_id: s('id del producto'), ...PRODUCT_PROPS }, required: ['producto_id'] },
  },
  {
    name: 'registrar_movimiento',
    description: 'Registra una venta, una compra (reposición de stock / inversión) o un ajuste de stock (+/-, por rotura, conteo, etc.). Si no se indica precio se usa el cargado en el producto.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['venta', 'compra', 'ajuste'] },
        producto_id: s('id del producto'),
        cantidad: n('Cantidad (en ajuste puede ser negativa)'),
        precio_unitario: n('Precio de venta (venta) o costo unitario (compra). Opcional.'),
        nota: s('Nota opcional (cliente, medio de pago, motivo del ajuste)'),
      },
      required: ['tipo', 'producto_id', 'cantidad'],
    },
  },
  {
    name: 'registrar_caja',
    description: 'Registra un gasto del negocio (envíos, alquiler, publicidad, insumos no inventariables) o un ingreso de dinero que no es venta (aporte, préstamo).',
    input_schema: {
      type: 'object',
      properties: { tipo: { type: 'string', enum: ['gasto', 'ingreso'] }, monto: n('Monto'), descripcion: s('Concepto') },
      required: ['tipo', 'monto', 'descripcion'],
    },
  },
  {
    name: 'resumen_negocio',
    description: 'Métricas del negocio: ventas, ganancia bruta y neta, margen, gastos, invertido, entradas/salidas, balance de caja, valor del stock, más vendidos, stock bajo.',
    input_schema: { type: 'object', properties: { periodo: { type: 'string', enum: ['hoy', 'semana', 'mes', 'anio'] } }, required: ['periodo'] },
  },
  {
    name: 'ultimos_movimientos',
    description: 'Lista los últimos movimientos (con su id) para consultar o para deshacer uno.',
    input_schema: { type: 'object', properties: { cantidad: n('Cuántos (máx 30)') } },
  },
  {
    name: 'eliminar_movimiento',
    description: 'Elimina (deshace) un movimiento por id; el stock se revierte solo. Pedí confirmación al usuario antes, salvo que lo haya pedido explícitamente.',
    input_schema: { type: 'object', properties: { movimiento_id: s('id') }, required: ['movimiento_id'] },
  },
];

function systemPrompt(business) {
  const hoy = new Date().toLocaleString('es-AR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' });
  return `Sos el asistente de gestión de "${business.name}", un emprendimiento que usa StockFácil. Moneda: ${business.currency}. Ahora: ${hoy}.

Tu trabajo: ejecutar lo que el dueño pide (cargar productos, ventas, compras, gastos, ajustes, editar fichas) y responder preguntas sobre el negocio usando las herramientas. Nunca inventes datos: consultá con las herramientas.

Reglas:
- Hablá en español rioplatense, breve y claro. Montos con formato $ 12.500. Usá **negrita** para lo importante; listas cortas si ayudan.
- Si el pedido es claro (ej. "vendí 2 remeras negras"), buscá el producto y ejecutá directamente. Después confirmá lo hecho con los números (total, ganancia, stock restante).
- Si hay ambigüedad real (varios productos posibles, falta un dato imprescindible como el precio de un producto nuevo), preguntá antes de ejecutar. Hacé una sola pregunta concreta.
- El usuario puede dictar por voz: interpretá errores de transcripción con sentido común ("bendí" = vendí).
- Nunca cambies stock con actualizar_producto: usá registrar_movimiento.
- "Compré/repuse/me llegaron" = compra. "Vendí" = venta. "Se rompió/perdí/conté" = ajuste. "Pagué envío/alquiler/publicidad" = gasto.

Fotos:
- Si el usuario adjunta una foto, primero describí para vos qué es (tipo de prenda/artículo, color, material, detalles). Buscá candidatos con buscar_productos (por categoría/color/nombre) y, si tienen foto, compará con ver_fotos_productos.
- Si identificás el producto con seguridad, decí cuál es y ejecutá la acción pedida (ej. "vendí esto" → venta). Si no pidió nada, decí qué producto es, su stock y precio, y ofrecé acciones (vender, reponer, actualizar foto).
- Si no coincide con ninguno o hay dudas, decílo y ofrecé darlo de alta: proponé nombre, categoría, color, material, descripción comercial y atributos que se vean en la foto. Las medidas y el peso NO se adivinan: preguntalos o dejalos vacíos (salvo que se lean en una etiqueta o el usuario los diga). Para crear necesitás al menos costo y precio: pedilos.
- Al crear o actualizar a partir de una foto, usá usar_foto_adjunta=true para guardarla como foto del producto.
- Si la foto es una etiqueta, factura o lista de precios, leé los datos y usalos.`;
}

function toolResultText(obj) {
  return JSON.stringify(obj, (_k, v) => (v === null ? undefined : v));
}

async function runTool(name, input, ctx) {
  const { business, imageUrl } = ctx;
  const bid = business.id;
  const withPhoto = (inp) => (inp.usar_foto_adjunta && imageUrl ? { ...inp, foto_url: imageUrl } : inp);
  const movCtx = { source: ctx.source, createdBy: ctx.createdBy };

  switch (name) {
    case 'buscar_productos': {
      const list = await searchProducts(bid, { texto: input.texto, soloStockBajo: input.solo_stock_bajo });
      return {
        text: toolResultText({
          total: list.length,
          productos: list.map((p) => ({
            id: p.id, nombre: p.name, sku: p.sku, categoria: p.category, marca: p.brand,
            stock: Number(p.stock), stock_minimo: Number(p.min_stock), costo: Number(p.unit_cost), precio: Number(p.sale_price),
            peso_kg: p.weight_kg, medidas_cm: p.length_cm || p.width_cm || p.height_cm ? [p.length_cm, p.width_cm, p.height_cm] : undefined,
            atributos: Object.keys(p.attributes || {}).length ? p.attributes : undefined,
            descripcion: p.description ? p.description.slice(0, 140) : undefined,
            tiene_foto: Boolean(p.image_url),
          })),
        }),
      };
    }
    case 'ver_fotos_productos': {
      const blocks = [];
      for (const id of (input.producto_ids || []).slice(0, 4)) {
        const p = await getProduct(bid, id).catch(() => null);
        if (!p) continue;
        blocks.push({ type: 'text', text: `Producto ${p.name} (id ${p.id})${p.image_url ? ':' : ': sin foto'}` });
        if (p.image_url) blocks.push({ type: 'image', source: { type: 'url', url: p.image_url } });
      }
      return { content: blocks.length ? blocks : [{ type: 'text', text: 'Sin productos' }] };
    }
    case 'crear_producto': {
      const p = await createProduct(bid, withPhoto(input), movCtx);
      ctx.changed = true;
      return { text: toolResultText({ ok: true, producto: { id: p.id, nombre: p.name, stock: Number(p.stock), costo: Number(p.unit_cost), precio: Number(p.sale_price), foto: Boolean(p.image_url) } }) };
    }
    case 'actualizar_producto': {
      const { producto_id: id, ...rest } = input;
      const p = await updateProduct(bid, id, withPhoto(rest));
      ctx.changed = true;
      return { text: toolResultText({ ok: true, producto: { id: p.id, nombre: p.name, costo: Number(p.unit_cost), precio: Number(p.sale_price), foto: Boolean(p.image_url) } }) };
    }
    case 'registrar_movimiento': {
      const p = await getProduct(bid, input.producto_id);
      const m = await insertMovement(bid, {
        type: input.tipo, product_id: p.id, quantity: input.cantidad,
        unit_price: input.tipo === 'ajuste' ? 0 : Number(input.precio_unitario || 0), note: input.nota || null,
      }, movCtx);
      const np = await getProduct(bid, p.id);
      ctx.changed = true;
      return {
        text: toolResultText({
          ok: true, movimiento_id: m.id, tipo: m.type, producto: p.name, cantidad: Number(m.quantity),
          precio_unitario: Number(m.unit_price), total: Number(m.total),
          ganancia: m.type === 'venta' ? Number(m.total) - Number(m.quantity) * Number(m.unit_cost) : undefined,
          stock_actual: Number(np.stock), stock_bajo: Number(np.stock) <= Number(np.min_stock),
        }),
      };
    }
    case 'registrar_caja': {
      const m = await insertMovement(bid, { type: input.tipo, total: input.monto, note: input.descripcion }, movCtx);
      ctx.changed = true;
      return { text: toolResultText({ ok: true, movimiento_id: m.id, tipo: m.type, monto: Number(m.total) }) };
    }
    case 'resumen_negocio': {
      const d = await dashboard(bid, input.periodo, TZ);
      return { text: toolResultText({ periodo: input.periodo, kpis: d.kpis, stock: d.stock, historico: d.historico, top: d.top, bajo_stock: d.bajo_stock }) };
    }
    case 'ultimos_movimientos': {
      const list = await lastMovements(bid, input.cantidad || 10);
      return {
        text: toolResultText(list.map((m) => ({
          id: m.id, tipo: m.type, producto: m.products?.name, cantidad: Number(m.quantity), total: Number(m.total),
          nota: m.note, origen: m.source, fecha: new Date(m.created_at).toLocaleString('es-AR', { timeZone: TZ }),
        }))),
      };
    }
    case 'eliminar_movimiento': {
      await deleteMovement(bid, input.movimiento_id);
      ctx.changed = true;
      return { text: toolResultText({ ok: true }) };
    }
    default:
      return { text: `Herramienta desconocida: ${name}`, isError: true };
  }
}

/**
 * Corre el asistente.
 * @param history [{role:'user'|'assistant', content:string}] mensajes previos (sólo texto)
 * @param message texto del usuario
 * @param imageUrl URL pública de una foto adjunta (opcional)
 */
export async function runAgent({ business, history = [], message, imageUrl, source = 'asistente', createdBy }) {
  if (!aiEnabled()) {
    return { reply: 'El asistente todavía no está activado: falta configurar ANTHROPIC_API_KEY en el servidor.', changed: false };
  }
  const ctx = { business, imageUrl, source, createdBy, changed: false, actions: [] };

  const userContent = [];
  if (imageUrl) userContent.push({ type: 'image', source: { type: 'url', url: imageUrl } });
  userContent.push({ type: 'text', text: message?.trim() || (imageUrl ? '¿Qué producto es este?' : 'Hola') });

  const messages = [
    ...history.slice(-12).filter((m) => m?.content).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) })),
    { role: 'user', content: userContent },
  ];
  // La API exige que el primer mensaje sea del usuario y que alternen
  while (messages.length && messages[0].role !== 'user') messages.shift();
  const merged = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      const toArr = (c) => (typeof c === 'string' ? [{ type: 'text', text: c }] : c);
      last.content = [...toArr(last.content), ...toArr(m.content)];
    } else merged.push({ ...m });
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await ai().messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt(business),
      tools: TOOLS,
      messages: merged,
    });
    merged.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      const reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { reply: reply || 'Listo.', changed: ctx.changed, actions: ctx.actions };
    }

    const results = [];
    for (const block of res.content.filter((b) => b.type === 'tool_use')) {
      let out;
      try {
        out = await runTool(block.name, block.input || {}, ctx);
        ctx.actions.push(block.name);
      } catch (e) {
        if (!(e instanceof UserError)) console.error('[agente]', block.name, e);
        out = { text: `Error: ${e.message}`, isError: true };
      }
      results.push({
        type: 'tool_result', tool_use_id: block.id,
        content: out.content || out.text, ...(out.isError ? { is_error: true } : {}),
      });
    }
    merged.push({ role: 'user', content: results });
  }
  return { reply: 'Hice varias operaciones pero no llegué a terminar. ¿Me repetís qué falta?', changed: ctx.changed, actions: ctx.actions };
}
