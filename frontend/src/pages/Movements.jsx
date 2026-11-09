import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useBusiness } from '../lib/BusinessContext.jsx';
import { MOVE_TYPES, dateTime, money, num } from '../lib/format.js';
import Modal from '../components/Modal.jsx';
import MovementForm from '../components/MovementForm.jsx';

export default function Movements() {
  const { business } = useBusiness();
  const cur = business.currency;
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('todos');
  const [open, setOpen] = useState(null); // tipo inicial
  const [limit, setLimit] = useState(100);

  const load = useCallback(async () => {
    let q = supabase.from('movements')
      .select('*, products(name)')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (filter !== 'todos') q = q.eq('type', filter);
    const [{ data: m }, { data: p }] = await Promise.all([
      q,
      supabase.from('products').select('*').eq('business_id', business.id).eq('active', true).order('name'),
    ]);
    setRows(m || []);
    setProducts(p || []);
  }, [business.id, filter, limit]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => rows.reduce((t, r) => {
    const sign = MOVE_TYPES[r.type].cash;
    if (sign > 0) t.in += Number(r.total);
    if (sign < 0) t.out += Number(r.total);
    return t;
  }, { in: 0, out: 0 }), [rows]);

  async function remove(r) {
    if (!confirm('¿Eliminar este movimiento? El stock se revierte automáticamente.')) return;
    const { error } = await supabase.from('movements').delete().eq('id', r.id);
    if (error) alert(error.message);
    load();
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Movimientos</h1>
          <p className="muted">Entradas {money(totals.in, cur)} · Salidas {money(totals.out, cur)} (de lo listado)</p>
        </div>
        <div className="btn-group">
          <button className="btn green" onClick={() => setOpen('venta')}>+ Venta</button>
          <button className="btn blue" onClick={() => setOpen('compra')}>+ Compra</button>
          <button className="btn red" onClick={() => setOpen('gasto')}>+ Gasto</button>
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented">
          {['todos', ...Object.keys(MOVE_TYPES)].map((k) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {k === 'todos' ? 'Todos' : `${MOVE_TYPES[k].icon} ${MOVE_TYPES[k].label}`}
            </button>
          ))}
        </div>
      </div>

      <div className="card no-pad">
        {rows.length === 0 ? <p className="empty muted">No hay movimientos.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th className="r">Cant.</th><th className="r">Unitario</th><th className="r">Total</th><th>Origen</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const t = MOVE_TYPES[r.type];
                  return (
                    <tr key={r.id}>
                      <td className="nowrap">{dateTime(r.created_at)}</td>
                      <td><span className={`badge ${t.cls}`}>{t.icon} {t.label}</span></td>
                      <td>
                        <div className="strong">{r.products?.name || r.note || '—'}</div>
                        {r.products && r.note && <div className="muted small">{r.note}</div>}
                      </td>
                      <td className="r">{r.product_id ? num(r.quantity) : ''}</td>
                      <td className="r">{r.unit_price > 0 ? money(r.unit_price, cur) : ''}</td>
                      <td className={`r strong ${t.cash > 0 ? 'pos' : t.cash < 0 ? 'neg' : ''}`}>
                        {t.cash === 0 ? '' : `${t.cash > 0 ? '+' : '−'} ${money(r.total, cur)}`}
                      </td>
                      <td title={r.source}>{r.source === 'telegram' ? '📱' : '🌐'}</td>
                      <td><button className="icon-btn" title="Eliminar" onClick={() => remove(r)}>🗑</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {rows.length >= limit && <button className="btn ghost" onClick={() => setLimit(limit + 100)}>Ver más</button>}

      {open && (
        <Modal title="Registrar movimiento" onClose={() => setOpen(null)}>
          <MovementForm products={products} initialType={open} onDone={() => { setOpen(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}
