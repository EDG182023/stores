// Utilidades de parseo y formato (sin dependencias, testeables)

/** Texto del mensaje sin el comando: "/venta@MiBot remera | 2" -> "remera | 2" */
export function commandArgs(text = '') {
  return text.replace(/^\/\w+(@\w+)?\s*/, '').trim();
}

/** Separa argumentos por | o ; */
export function splitArgs(text = '') {
  if (!text.trim()) return [];
  return text.split(/[|;]/).map((s) => s.trim());
}

/**
 * Convierte números escritos a la argentina o internacional:
 * "1.500" -> 1500 · "1.500,50" -> 1500.5 · "1500.5" -> 1500.5 · "$ 2,5" -> 2.5 · "+3" -> 3 · "-2" -> -2
 * Devuelve NaN si no es un número.
 */
export function parseNumber(input) {
  if (input === undefined || input === null) return NaN;
  let s = String(input).trim().replace(/[$\s]/g, '').replace(/^\+/, '');
  if (!s) return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // el último separador es el decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(',', '.'); // en Argentina la coma es decimal
  } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // 1.500 = mil quinientos
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export function money(n, currency = 'ARS') {
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(Number(n || 0));
  } catch {
    return `$ ${Number(n || 0).toFixed(2)}`;
  }
}

export function qty(n) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(Number(n || 0));
}

/** Escapa texto para parse_mode HTML de Telegram */
export function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapa comodines de LIKE */
export function likeEscape(s = '') {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

export function dateTime(d, tz = 'America/Argentina/Buenos_Aires') {
  return new Date(d).toLocaleString('es-AR', {
    timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
