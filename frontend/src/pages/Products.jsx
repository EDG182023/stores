import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useBusiness } from '../lib/BusinessContext.jsx';
import { margin, money, num, toNumber } from '../lib/format.js';
import Modal from '../components/Modal.jsx';
import MovementForm from '../components/MovementForm.jsx';

const EMPTY = { name: '', sku: '', category: '', unit_cost: '', sale_price: '', min_stock: '', initial_stock: '' };

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

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) =>
      (!s || p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s) || (p.category || '').toLowerCase().includes(s))
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
                        <div className="strong">{p.name}</div>
                        <div className="muted small">{[p.sku, p.category].filter(Boolean).join(' · ')}</div>
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
        <Modal title={editing.id ? 'Editar producto' : 'Nuevo producto'} onClose={() => setEditing(null)}>
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
  const [f, setF] = useState({ ...EMPTY, ...product });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const cost = toNumber(f.unit_cost);
  const price = toNumber(f.sale_price);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const row = {
      name: f.name.trim(), sku: f.sku?.trim() || null, category: f.category?.trim() || null,
      unit_cost: cost, sale_price: price, min_stock: toNumber(f.min_stock),
    };
    let res;
    if (isNew) res = await supabase.from('products').insert({ ...row, business_id: business.id }).select().single();
    else res = await supabase.from('products').update(row).eq('id', product.id).select().single();

    if (res.error) {
      setBusy(false);
      return setError(res.error.code === '23505' ? 'Ya existe un producto con ese nombre.' : res.error.message);
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
      <label>Nombre<input value={f.name} onChange={set('name')} required autoFocus /></label>
      <div className="row">
        <label>SKU / código<input value={f.sku || ''} onChange={set('sku')} /></label>
        <label>Categoría<input value={f.category || ''} onChange={set('category')} /></label>
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
      <div className="summary">
        <span>Margen: <b>{margin(price, cost).toFixed(1)}%</b></span>
        <span>Ganancia por unidad: <b>{money(price - cost, business.currency)}</b></span>
        {isNew && toNumber(f.initial_stock) > 0 && <span>Inversión inicial: <b>{money(toNumber(f.initial_stock) * cost, business.currency)}</b></span>}
      </div>
      {error && <div className="alert">{error}</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
    </form>
  );
}
