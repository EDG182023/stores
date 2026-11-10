import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '../lib/supabase.js';
import { useBusiness } from '../lib/BusinessContext.jsx';
import { compactMoney, money, num, shortDate } from '../lib/format.js';
import Kpi from '../components/Kpi.jsx';
import { onDataChanged } from '../lib/api.js';

const PERIODS = [
  { k: 'hoy', label: 'Hoy' },
  { k: '7d', label: '7 días' },
  { k: '30d', label: '30 días' },
  { k: 'mes', label: 'Este mes' },
  { k: 'anio', label: 'Este año' },
];

function range(k) {
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(sod); to.setDate(to.getDate() + 1);
  const from = new Date(sod);
  if (k === '7d') from.setDate(from.getDate() - 6);
  if (k === '30d') from.setDate(from.getDate() - 29);
  if (k === 'mes') from.setDate(1);
  if (k === 'anio') { from.setMonth(0); from.setDate(1); }
  return { from, to };
}

const C = { ventas: '#22c55e', ganancia: '#6366f1', entradas: '#22c55e', salidas: '#ef4444' };

export default function Dashboard() {
  const { business } = useBusiness();
  const cur = business.currency;
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { from, to } = range(period);
    const { data: d, error: err } = await supabase.rpc('get_dashboard', {
      p_business: business.id,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (err) setError(err.message); else { setError(''); setData(d); }
  }, [business.id, period]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onDataChanged(load), [load]);

  // Refresco en vivo cuando entra un movimiento (p. ej. desde Telegram)
  useEffect(() => {
    const ch = supabase.channel('dash-movements')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements', filter: `business_id=eq.${business.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [business.id, load]);

  const fmtAxis = (v) => compactMoney(v, cur);
  const tip = (v) => money(v, cur);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Cómo viene {business.name}</p>
        </div>
        <div className="segmented">
          {PERIODS.map((p) => (
            <button key={p.k} className={period === p.k ? 'on' : ''} onClick={() => setPeriod(p.k)}>{p.label}</button>
          ))}
        </div>
      </header>

      {error && <div className="alert">{error}</div>}
      {!data ? <div className="muted">Cargando…</div> : (
        <>
          <section className="kpis">
            <Kpi label="Ventas" value={money(data.kpis.ventas, cur)}
              hint={`${data.kpis.cantidad_ventas} ventas · ${num(data.kpis.unidades_vendidas)} u · ticket ${money(data.kpis.ticket_promedio, cur)}`} tone="green" />
            <Kpi label="Ganancia bruta" value={money(data.kpis.ganancia_bruta, cur)} hint={`Margen ${data.kpis.margen}% · costo ${money(data.kpis.costo_ventas, cur)}`} />
            <Kpi label="Gastos" value={money(data.kpis.gastos, cur)} tone="red" hint="Envíos, alquiler, publicidad…" />
            <Kpi label="Ganancia neta" value={money(data.kpis.ganancia_neta, cur)}
              tone={data.kpis.ganancia_neta >= 0 ? 'indigo' : 'red'} hint="Bruta + otros ingresos − gastos" />
          </section>

          <section className="kpis">
            <Kpi label="Invertido en mercadería" value={money(data.kpis.compras, cur)} tone="blue" hint="Compras del período" />
            <Kpi label="Entradas de dinero" value={money(data.kpis.entradas, cur)} hint="Ventas + otros ingresos" />
            <Kpi label="Salidas de dinero" value={money(data.kpis.salidas, cur)} hint="Compras + gastos" />
            <Kpi label="Balance de caja" value={money(data.kpis.balance_caja, cur)} tone={data.kpis.balance_caja >= 0 ? 'green' : 'red'} hint="Entradas − salidas" />
          </section>

          <div className="grid-2">
            <div className="card">
              <h3>Ventas y ganancia</h3>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data.serie} margin={{ left: 0, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.ventas} stopOpacity={0.35} /><stop offset="100%" stopColor={C.ventas} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.ganancia} stopOpacity={0.35} /><stop offset="100%" stopColor={C.ganancia} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="fecha" tickFormatter={shortDate} tick={{ fontSize: 12, fill: 'var(--muted)' }} minTickGap={16} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 12, fill: 'var(--muted)' }} width={70} />
                  <Tooltip formatter={tip} labelFormatter={shortDate} contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }} />
                  <Legend />
                  <Area type="monotone" dataKey="ventas" name="Ventas" stroke={C.ventas} fill="url(#gv)" strokeWidth={2} />
                  <Area type="monotone" dataKey="ganancia" name="Ganancia" stroke={C.ganancia} fill="url(#gg)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <h3>Entradas vs salidas</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.serie} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="fecha" tickFormatter={shortDate} tick={{ fontSize: 12, fill: 'var(--muted)' }} minTickGap={16} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 12, fill: 'var(--muted)' }} width={70} />
                  <Tooltip formatter={tip} labelFormatter={shortDate} contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="entradas" name="Entradas" fill={C.entradas} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="salidas" name="Salidas" fill={C.salidas} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid-3">
            <div className="card">
              <h3>📦 Capital en stock</h3>
              <dl className="stats">
                <div><dt>Valor a costo</dt><dd>{money(data.stock.valor_costo, cur)}</dd></div>
                <div><dt>Valor a precio de venta</dt><dd>{money(data.stock.valor_venta, cur)}</dd></div>
                <div><dt>Ganancia potencial</dt><dd className="pos">{money(data.stock.ganancia_potencial, cur)}</dd></div>
                <div><dt>Productos · unidades</dt><dd>{data.stock.productos} · {num(data.stock.unidades)}</dd></div>
              </dl>
              <h4 className="muted small">Histórico total</h4>
              <dl className="stats">
                <div><dt>Invertido</dt><dd>{money(data.historico.invertido_total, cur)}</dd></div>
                <div><dt>Vendido</dt><dd>{money(data.historico.ventas_total, cur)}</dd></div>
                <div><dt>Ganancia neta</dt><dd className={data.historico.ganancia_total >= 0 ? 'pos' : 'neg'}>{money(data.historico.ganancia_total, cur)}</dd></div>
              </dl>
            </div>

            <div className="card">
              <h3>🏆 Más vendidos</h3>
              {data.top.length === 0 ? <p className="muted">Sin ventas en el período.</p> : (
                <table className="table compact">
                  <thead><tr><th>Producto</th><th className="r">U</th><th className="r">Ventas</th><th className="r">Gan.</th></tr></thead>
                  <tbody>
                    {data.top.map((t) => (
                      <tr key={t.id}><td>{t.nombre}</td><td className="r">{num(t.unidades)}</td><td className="r">{money(t.ventas, cur)}</td><td className="r pos">{money(t.ganancia, cur)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h3>⚠️ Stock bajo</h3>
              {data.bajo_stock.length === 0 ? <p className="muted">Todo en orden 👌</p> : (
                <ul className="list">
                  {data.bajo_stock.map((p) => (
                    <li key={p.id}><span>{p.nombre}</span><span className="badge red">{num(p.stock)} / mín {num(p.min_stock)}</span></li>
                  ))}
                </ul>
              )}
              <Link className="btn ghost small" to="/productos">Ir a productos →</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
