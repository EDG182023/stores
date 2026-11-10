// Operaciones del negocio, compartidas por el bot de Telegram y el asistente IA.
import { supabase } from './supabase.js';
import { likeEscape } from './utils.js';

export class UserError extends Error {}
export const fail = (msg) => { throw new UserError(msg); };

export const PRODUCT_FIELDS = 'id, name, sku, category, brand, barcode, description, unit_cost, sale_price, stock, min_stock, image_url, weight_kg, length_cm, width_cm, height_cm, attributes';

export async function findProduct(businessId, query) {
  const q = (query || '').trim();
  if (!q) fail('Indicá el producto.');
  const base = () => supabase.from('products').select('*')
    .eq('business_id', businessId).eq('active', true);

  let { data } = await base().ilike('name', likeEscape(q)).limit(2);
  if (data?.length === 1) return data[0];
  ({ data } = await base().eq('sku', q).limit(2));
  if (data?.length === 1) return data[0];
  ({ data } = await base().ilike('name', `%${likeEscape(q)}%`).order('name').limit(8));
  if (!data?.length) fail(`No encontré "${q}".`);
  if (data.length > 1) {
    fail(`Hay varios productos con "${q}": ${data.map((p) => p.name).join(', ')}. Indicá cuál.`);
  }
  return data[0];
}

export async function getProduct(businessId, id) {
  const { data, error } = await supabase.from('products').select('*')
    .eq('business_id', businessId).eq('id', id).maybeSingle();
  if (error) fail(error.message);
  if (!data) fail('Producto inexistente');
  return data;
}

export async function searchProducts(businessId, { texto, soloStockBajo } = {}) {
  let q = supabase.from('products').select(PRODUCT_FIELDS)
    .eq('business_id', businessId).eq('active', true).order('name').limit(150);
  if (texto) {
    const t = likeEscape(texto.trim().replace(/[,()]/g, ' '));
    q = q.or(`name.ilike.%${t}%,sku.ilike.%${t}%,category.ilike.%${t}%,brand.ilike.%${t}%,description.ilike.%${t}%,barcode.eq.${t}`);
  }
  const { data, error } = await q;
  if (error) fail(error.message);
  return soloStockBajo ? data.filter((p) => Number(p.stock) <= Number(p.min_stock)) : data;
}

export async function insertMovement(businessId, row, { source, createdBy }) {
  const { data, error } = await supabase.from('movements').insert({
    business_id: businessId, source, created_by: createdBy, ...row,
  }).select().single();
  if (error) fail(error.message);
  return data;
}

/** Mapea campos en castellano (asistente) a columnas */
export function productPatch(input = {}) {
  const map = {
    nombre: 'name', sku: 'sku', categoria: 'category', marca: 'brand', codigo_barras: 'barcode',
    descripcion: 'description', costo: 'unit_cost', precio: 'sale_price', stock_minimo: 'min_stock',
    peso_kg: 'weight_kg', largo_cm: 'length_cm', ancho_cm: 'width_cm', alto_cm: 'height_cm',
    atributos: 'attributes', foto_url: 'image_url',
  };
  const out = {};
  for (const [k, col] of Object.entries(map)) {
    if (input[k] !== undefined && input[k] !== null && input[k] !== '') out[col] = input[k];
  }
  return out;
}

export async function createProduct(businessId, input, ctx) {
  const patch = productPatch(input);
  if (!patch.name) fail('Falta el nombre del producto.');
  const { data: p, error } = await supabase.from('products')
    .insert({ business_id: businessId, unit_cost: 0, sale_price: 0, ...patch })
    .select().single();
  if (error) {
    if (error.code === '23505') fail(`Ya existe un producto llamado "${patch.name}".`);
    fail(error.message);
  }
  const qty = Number(input.cantidad_inicial || 0);
  if (qty > 0) {
    await insertMovement(businessId, {
      type: 'compra', product_id: p.id, quantity: qty, unit_price: p.unit_cost, note: 'Stock inicial',
    }, ctx);
  }
  return getProduct(businessId, p.id);
}

export async function updateProduct(businessId, id, input) {
  await getProduct(businessId, id);
  const patch = productPatch(input);
  if (patch.attributes) {
    const { data: cur } = await supabase.from('products').select('attributes').eq('id', id).single();
    patch.attributes = { ...(cur?.attributes || {}), ...patch.attributes };
  }
  if (!Object.keys(patch).length) fail('No hay cambios para guardar.');
  const { data, error } = await supabase.from('products').update(patch).eq('id', id).select().single();
  if (error) fail(error.code === '23505' ? 'Ya existe otro producto con ese nombre.' : error.message);
  return data;
}

export async function dashboard(businessId, periodo = 'mes', tz) {
  const { data, error } = await supabase.rpc('get_dashboard_period', {
    p_business: businessId, p_period: periodo, p_tz: tz,
  });
  if (error) fail(error.message);
  return data;
}

export async function lastMovements(businessId, n = 10) {
  const { data, error } = await supabase.from('movements')
    .select('id, type, quantity, unit_price, total, note, source, created_at, products(name)')
    .eq('business_id', businessId).order('created_at', { ascending: false }).limit(Math.min(n, 30));
  if (error) fail(error.message);
  return data;
}

export async function deleteMovement(businessId, id) {
  const { data: m } = await supabase.from('movements').select('id')
    .eq('business_id', businessId).eq('id', id).maybeSingle();
  if (!m) fail('Movimiento inexistente');
  const { error } = await supabase.from('movements').delete().eq('id', id);
  if (error) fail(error.message);
}
