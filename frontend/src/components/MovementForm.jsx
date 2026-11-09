import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useBusiness } from '../lib/BusinessContext.jsx';
import { MOVE_TYPES, money, num, toNumber } from '../lib/format.js';

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/**
 * Formulario único para venta / compra / ajuste / gasto / ingreso.
 * products: lista de productos activos
 */
export default function MovementForm({ products, initialType = 'venta', initialProductId = '', onDone, lockType = false }) {
  const { business, session } = useBusiness();
  const [type, setType] = useState(initialType);
  const [productId, setProductId] = useState(initialProductId);
  const [quantity, setQuantity] = useState(initialType === 'ajuste' ? '' : '1');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(nowLocal());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const product = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const isCash = type === 'gasto' || type === 'ingreso';
  const cur = business.currency;

  const defaultPrice = product ? (type === 'venta' ? product.sale_price : product.unit_cost) : 0;
  const unit = price === '' ? Number(defaultPrice) : toNumber(price);
  const q = toNumber(quantity);
  const total = isCash ? toNumber(amount) : type === 'ajuste' ? 0 : q * unit;
  const profit = type === 'venta' && product ? total - q * Number(product.unit_cost) : null;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!isCash && !product) return setError('Elegí un producto.');
    if (isCash && total <= 0) return setError('Ingresá un monto mayor a 0.');
    if (!isCash && q === 0) return setError('La cantidad no puede ser 0.');
    if ((type === 'venta' || type === 'compra') && q < 0) return setError('La cantidad debe ser positiva.');

    setSaving(true);
    const row = {
      business_id: business.id,
      type,
      note: note.trim() || null,
      source: 'web',
      created_by: session.user.id,
      created_at: new Date(date).toISOString(),
    };
    if (isCash) row.total = total;
    else Object.assign(row, { product_id: product.id, quantity: q, unit_price: type === 'ajuste' ? 0 : unit });

    const { error: err } = await supabase.from('movements').insert(row);
    setSaving(false);
    if (err) return setError(err.message);
    onDone?.();
  }

  return (
    <form onSubmit={submit} className="form">
      {!lockType && (
        <div className="segmented">
          {Object.entries(MOVE_TYPES).map(([k, t]) => (
            <button type="button" key={k} className={type === k ? 'on' : ''} onClick={() => { setType(k); setPrice(''); }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      )}

      {!isCash && (
        <label>Producto
          <select value={productId} onChange={(e) => { setProductId(e.target.value); setPrice(''); }} required>
            <option value="">Elegí un producto…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — stock {num(p.stock)}</option>
            ))}
          </select>
        </label>
      )}

      {!isCash ? (
        <div className="row">
          <label>Cantidad{type === 'ajuste' && ' (+ suma / − resta)'}
            <input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </label>
          {type !== 'ajuste' && (
            <label>{type === 'venta' ? 'Precio unitario' : 'Costo unitario'}
              <input type="number" step="any" min="0" value={price} placeholder={String(defaultPrice || 0)}
                onChange={(e) => setPrice(e.target.value)} />
            </label>
          )}
        </div>
      ) : (
        <label>Monto
          <input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </label>
      )}

      <div className="row">
        <label>{isCash ? 'Descripción' : 'Nota (opcional)'}
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={type === 'gasto' ? 'Ej: envío, alquiler, publicidad' : type === 'ajuste' ? 'Ej: rotura, conteo' : ''} />
        </label>
        <label>Fecha
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>

      {type !== 'ajuste' && (
        <div className="summary">
          <span>Total: <b>{money(total, cur)}</b></span>
          {profit !== null && <span className={profit >= 0 ? 'pos' : 'neg'}>Ganancia: {money(profit, cur)}</span>}
          {type === 'venta' && product && q > Number(product.stock) && <span className="neg">Stock insuficiente ({num(product.stock)})</span>}
        </div>
      )}

      {error && <div className="alert">{error}</div>}

      <button className="btn primary" disabled={saving}>
        {saving ? 'Guardando…' : `Registrar ${MOVE_TYPES[type].label.toLowerCase()}`}
      </button>
    </form>
  );
}
