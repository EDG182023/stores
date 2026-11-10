import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useBusiness } from '../lib/BusinessContext.jsx';
import { margin, money, num, toNumber } from '../lib/format.js';
import Modal from '../components/Modal.jsx';
import MovementForm from '../components/MovementForm.jsx';
import { onDataChanged } from '../lib/api.js';
import { uploadImage } from '../lib/images.js';

const EMPTY = {
  name: '', sku: '', category: '', brand: '', barcode: '', description: '', unit_cost: '', sale_price: '', min_stock: '',
  initial_stock: '', image_url: '', weight_kg: '', length_cm: '', width_cm: '', height_cm: '', attributes: {},
};
const ATTRS = [['talle', 'Talle'], ['color', 'Color'], ['material', 'Material']];

export default function Products() {
  const { business, session } = useBusiness();
  const cur = business.currency;
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [editing, setEditing] = useState(null);   // producto o EMPTY
  const [moving, setMoving] = useState(null);     // { type, product }

  const load = useCallback(async () => {
    const { data } = await supabase.from('products').select('*')
      .eq('business_id', business.id).eq('active', true).order('name');
    setProducts(data || []);
  }, [business.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onDataChanged(load), [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) =>
      (!s || p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s) || (p.category || '').toLowerCase().includes(s)
        || (p.brand || '').toLowerCase().includes(s) || (p.barcode || '').includes(s))
      && (!onlyLow || Number(p.stock) <= Number(p.min_stock)));
  }, [products, search, onlyLow]);

  const totals = useMemo(() => filtered.reduce((t, p) => ({
    costo: t.costo + p.stock * p.unit_cost, venta: t.venta + p.stock * p.sale_price,
  }), { costo: 0, venta: 0 }), [filtered]);

  async function remove(p) {
    if (!confirm(`¿Eliminar "${p.name}"? Se ocultará del listado (el historial se conserva).`)) return;
    await supabase.from('products').update({ active: false }).eq('id', p.id);
    load();
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Productos</h1>
          <p className="muted">{products.length} productos · stock a costo {money(totals.costo, cur)} · a precio de venta {money(totals.venta, cur)}</p>
        </div>
        <button className="btn primary" onClick={() => setEditing(EMPTY)}>+ Nuevo producto</button>
      </header>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por nombre, SKU o categoría…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Sólo stock bajo</label>
      </div>

      <div className="card no-pad">
        {filtered.length === 0 ? (
          <p className="empty muted">{products.length ? 'Sin resultados.' : 'Todavía no cargaste productos. ¡Empezá con “Nuevo producto” o desde Telegram con /alta!'}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Producto</th><th className="r">Stock</th><th className="r">Costo</th><th className="r">Precio</th><th className="r">Margen</th><th className="r">Valor stock</th><th /></tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const low = Number(p.stock) <= Number(p.min_stock);
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="prod-cell">
                          {p.image_url ? <img className="thumb" src={p.image_url} alt="" loading="lazy" /> : <div className="thumb empty">📦</div>}
                          <div>
                            <div className="strong">{p.name}</div>
                            <div className="muted small">
                              {[p.sku, p.category, p.brand, ...Object.values(p.attributes || {}),
                                p.weight_kg ? `${num(p.weight_kg)} kg` : null,
                                p.length_cm || p.width_cm || p.height_cm ? `${num(p.length_cm)}×${num(p.width_cm)}×${num(p.height_cm)} cm` : null,
                              ].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="r"><span className={`badge ${low ? 'red' : 'green'}`}>{num(p.stock)}</span></td>
                      <td className="r">{money(p.unit_cost, cur)}</td>
                      <td className="r">{money(p.sale_price, cur)}</td>
                      <td className="r">{margin(p.sale_price, p.unit_cost).toFixed(0)}%</td>
                      <td className="r">{money(p.stock * p.unit_cost, cur)}</td>
                      <td className="actions">
                        <button className="btn small green" onClick={() => setMoving({ type: 'venta', product: p })}>Vender</button>
                        <button className="btn small blue" onClick={() => setMoving({ type: 'compra', product: p })}>Reponer</button>
                        <button className="icon-btn" title="Ajustar stock" onClick={() => setMoving({ type: 'ajuste', product: p })}>±</button>
                        <button className="icon-btn" title="Editar" onClick={() => setEditing(p)}>✎</button>
                        <button className="icon-btn" title="Eliminar" onClick={() => remove(p)}>🗑</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <Modal wide title={editing.id ? 'Editar producto' : 'Nuevo producto'} onClose={() => setEditing(null)}>
          <ProductForm product={editing} business={business} userId={session.user.id}
            onDone={() => { setEditing(null); load(); }} />
        </Modal>
      )}

      {moving && (
        <Modal title={`${{ venta: 'Vender', compra: 'Reponer', ajuste: 'Ajustar' }[moving.type]} · ${moving.product.name}`} onClose={() => setMoving(null)}>
          <MovementForm products={products} initialType={moving.type} initialProductId={moving.product.id} lockType
            onDone={() => { setMoving(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function ProductForm({ product, business, userId, onDone }) {
  const isNew = !product.id;
  const [f, setF] = useState(() => {
    const base = { ...EMPTY, ...product, attributes: { ...(product.attributes || {}) } };
    for (const k of ['weight_kg', 'length_cm', 'width_cm', 'height_cm', 'sku', 'category', 'brand', 'barcode', 'description', 'image_url']) {
      if (base[k] === null || base[k] === undefined) base[k] = '';
    }
    return base;
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setAttr = (k) => (e) => setF({ ...f, attributes: { ...f.attributes, [k]: e.target.value } });

  const cost = toNumber(f.unit_cost);
  const price = toNumber(f.sale_price);
  const optNum = (v) => (v === '' || v === null ? null : toNumber(v));
  const optText = (v) => (String(v || '').trim() || null);

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setError('');
    try {
      const url = await uploadImage(business.id, file, 'prod');
      setF((cur) => ({ ...cur, image_url: url }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const attributes = Object.fromEntries(Object.entries(f.attributes || {}).filter(([, v]) => String(v || '').trim()));
    const row = {
      name: f.name.trim(), sku: optText(f.sku), category: optText(f.category), brand: optText(f.brand),
      barcode: optText(f.barcode), description: optText(f.description), image_url: optText(f.image_url),
      unit_cost: cost, sale_price: price, min_stock: toNumber(f.min_stock),
      weight_kg: optNum(f.weight_kg), length_cm: optNum(f.length_cm), width_cm: optNum(f.width_cm), height_cm: optNum(f.height_cm),
      attributes,
    };
    let res;
    if (isNew) res = await supabase.from('products').insert({ ...row, business_id: business.id }).select().single();
    else res = await supabase.from('products').update(row).eq('id', product.id).select().single();

    if (res.error) {
      setBusy(false);
      return setError(res.error.code === '23505' ? 'Ya existe un producto con ese nombre.'
        : /column/.test(res.error.message) ? 'Falta actualizar la base: corré migration_002 en Supabase.' : res.error.message);
    }
    const initial = toNumber(f.initial_stock);
    if (isNew && initial > 0) {
      const { error: err } = await supabase.from('movements').insert({
        business_id: business.id, product_id: res.data.id, type: 'compra', quantity: initial,
        unit_price: cost, note: 'Stock inicial', source: 'web', created_by: userId,
      });
      if (err) { setBusy(false); return setError(err.message); }
    }
    setBusy(false);
    onDone();
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="photo-field">
        {f.image_url ? <img src={f.image_url} alt="" /> : <div className="photo-empty">📷</div>}
        <div className="photo-actions">
          <label className="btn ghost small">
            {uploading ? 'Subiendo…' : f.image_url ? 'Cambiar foto' : 'Subir foto'}
            <input type="file" accept="image/*" hidden onChange={onPhoto} disabled={uploading} />
          </label>
          {f.image_url && <button type="button" className="btn ghost small" onClick={() => setF({ ...f, image_url: '' })}>Quitar</button>}
        </div>
      </div>

      <label>Nombre<input value={f.name} onChange={set('name')} required autoFocus={isNew} /></label>
      <div className="row">
        <label>Categoría<input value={f.category} onChange={set('category')} /></label>
        <label>Marca<input value={f.brand} onChange={set('brand')} /></label>
      </div>
      <div className="row">
        <label>SKU / código<input value={f.sku} onChange={set('sku')} /></label>
        <label>Código de barras<input value={f.barcode} onChange={set('barcode')} inputMode="numeric" /></label>
      </div>
      <div className="row">
        <label>Costo unitario<input type="number" step="any" min="0" value={f.unit_cost} onChange={set('unit_cost')} required /></label>
        <label>Precio de venta<input type="number" step="any" min="0" value={f.sale_price} onChange={set('sale_price')} required /></label>
      </div>
      <div className="row">
        <label>Stock mínimo (alerta)<input type="number" step="any" min="0" value={f.min_stock} onChange={set('min_stock')} /></label>
        {isNew
          ? <label>Stock inicial<input type="number" step="any" min="0" value={f.initial_stock} onChange={set('initial_stock')} /></label>
          : <label>Stock actual<input value={num(product.stock)} disabled title="Se modifica con compras, ventas o ajustes" /></label>}
      </div>

      <fieldset className="fieldset">
        <legend>Medidas y peso (para envíos y tiendas online)</legend>
        <div className="row four">
          <label>Peso (kg)<input type="number" step="any" min="0" value={f.weight_kg} onChange={set('weight_kg')} /></label>
          <label>Largo (cm)<input type="number" step="any" min="0" value={f.length_cm} onChange={set('length_cm')} /></label>
          <label>Ancho (cm)<input type="number" step="any" min="0" value={f.width_cm} onChange={set('width_cm')} /></label>
          <label>Alto (cm)<input type="number" step="any" min="0" value={f.height_cm} onChange={set('height_cm')} /></label>
        </div>
        <div className="row">
          {ATTRS.map(([k, label]) => (
            <label key={k}>{label}<input value={f.attributes?.[k] || ''} onChange={setAttr(k)} /></label>
          ))}
        </div>
      </fieldset>

      <label>Descripción
        <textarea rows={3} value={f.description} onChange={set('description')} placeholder="Texto para publicar en tu tienda online" />
      </label>

      <div className="summary">
        <span>Margen: <b>{margin(price, cost).toFixed(1)}%</b></span>
        <span>Ganancia por unidad: <b>{money(price - cost, business.currency)}</b></span>
        {isNew && toNumber(f.initial_stock) > 0 && <span>Inversión inicial: <b>{money(toNumber(f.initial_stock) * cost, business.currency)}</b></span>}
      </div>
      {error && <div className="alert">{error}</div>}
      <button className="btn primary" disabled={busy || uploading}>{busy ? 'Guardando…' : 'Guardar'}</button>
    </form>
  );
}
