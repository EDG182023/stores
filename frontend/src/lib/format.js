export function money(n, currency = 'ARS') {
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 2 })
      .format(Number(n || 0));
  } catch {
    return `$ ${Number(n || 0).toFixed(2)}`;
  }
}

export function compactMoney(n, currency = 'ARS') {
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })
      .format(Number(n || 0));
  } catch {
    return money(n, currency);
  }
}

export const num = (n) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(Number(n || 0));

export const dateTime = (d) => new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

export const shortDate = (d) => {
  const [, m, day] = String(d).split('-');
  return `${day}/${m}`;
};

export const margin = (price, cost) => (Number(price) > 0 ? ((price - cost) / price) * 100 : 0);

/** Convierte lo que escribe el usuario ("1.500,50") a número */
export function toNumber(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  return Number(String(v).replace(',', '.')) || 0;
}

export const MOVE_TYPES = {
  venta:   { label: 'Venta',   icon: '🟢', cls: 'green',  cash: +1 },
  compra:  { label: 'Compra',  icon: '🔵', cls: 'blue',   cash: -1 },
  gasto:   { label: 'Gasto',   icon: '🔴', cls: 'red',    cash: -1 },
  ingreso: { label: 'Ingreso', icon: '🟡', cls: 'yellow', cash: +1 },
  ajuste:  { label: 'Ajuste',  icon: '⚙️', cls: 'gray',   cash: 0 },
};

export const CURRENCIES = ['ARS', 'USD', 'UYU', 'CLP', 'MXN', 'COP', 'PEN', 'BOB', 'PYG', 'EUR'];
