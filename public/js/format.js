// Formatting, parsing, and validators.

export const money = (n) =>
  '$' + (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const todayDDMMYYYY = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const isCedula = (v) => /^\d{10}$/.test(String(v || '').trim());
export const isRuc = (v) => /^\d{13}$/.test(String(v || '').trim());
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

export const ESTADO_MESA = { L: 'Desocupada', O: 'Ocupada', P: 'Lista para cobrar', C: 'Cerrada recientemente' };
export const ESTADO_ORDEN = { A: 'Abierta', C: 'Cerrada', X: 'Cancelada' };

export const PAYMENT_METHODS = [
  { code: 'EF', label: 'Efectivo',       desc: 'Pago en efectivo' },
  { code: 'TC', label: 'Tarjeta',        desc: 'Crédito o débito' },
  { code: 'TR', label: 'Transferencia',  desc: 'Transferencia bancaria' },
];

// Card processors used in Ecuador.
export const CARD_PROCESSORS = [
  { code: 'DATAFAST', label: 'Datafast' },
  { code: 'MEDIANET', label: 'Medianet' },
  { code: 'KUSHKI',   label: 'Kushki' },
  { code: 'MESITAQR', label: 'MesitaQR' },
  { code: 'PAYPHONE', label: 'PayPhone' },
  { code: 'EASYPAY',  label: 'Easy Pay' },
  { code: 'OTRO',     label: 'Otro' },
];

// Factura electrónica is mandatory in Ecuador above this amount (configurable).
export const FACTURA_AUTO_THRESHOLD = 50;

// Restaurant header used in printed precuentas and facturas.
// Edit these to match the real restaurant once data is available from the backend /config endpoint.
export const RESTAURANT_INFO = {
  nombreComercial: 'POS Mesita',
  razonSocial: 'DEMO RESTAURANTE S.A.',
  ruc:         '0900000001001',
  direccion:   'Av. 9 de Octubre 123, Guayaquil — Ecuador',
  telefono:    '+593 2 222-3344',
  email:       'ventas@demo-restaurante.ec',
};

export const formatDateTime = (d) => {
  d = d || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Category emoji map for product cards — improves the visual when there are no product photos.
export const CATEGORY_ICON = {
  'cat-entradas': '🥗',
  'cat-platos':   '🍽️',
  'cat-bebidas':  '🥤',
  'cat-postres':  '🍰',
};
export const productIcon = (prod) => {
  const cid = prod?.categoria_id || prod?.categoriaId || '';
  if (CATEGORY_ICON[cid]) return CATEGORY_ICON[cid];
  const n = (prod?.nombre || '').toLowerCase();
  if (/ceviche|pescado|camar/.test(n)) return '🐟';
  if (/cerveza|gaseosa|agua|jugo/.test(n)) return '🥤';
  if (/helado|postre|torta/.test(n)) return '🍰';
  return '🍽️';
};
