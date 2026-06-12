// Cuentas Cerradas / Historial de Ventas screen.
import * as api from '../api.js';
import { h, openModal, closeModal } from '../ui.js';
import { money } from '../format.js';

const TIPO_LABEL = { FAC: 'Factura', PRE: 'Pre-factura' };

let allDocs = [];
let filter = { q: '', tipo: 'ALL', fecha: 'ALL' };

export async function renderHistorial(root) {
  root.innerHTML = '';
  root.classList.remove('full');

  const crumbs = document.getElementById('crumbs');
  if (crumbs) crumbs.textContent = 'Cuentas cerradas / Historial';

  root.appendChild(buildHeader());
  root.appendChild(skeletonRows());

  try {
    allDocs = await loadAllDocumentos();
  } catch (err) {
    root.innerHTML = '';
    root.appendChild(buildHeader());
    root.appendChild(h('div', { class: 'center-empty' },
      h('div', { class: 'big' }, '⚠️'),
      h('div', { style: { fontWeight: 700 } }, 'No se pudo cargar el historial'),
      h('div', { style: { fontSize: '0.9rem', marginTop: '6px' } }, err.message),
    ));
    return;
  }

  paint(root);
}

function paint(root) {
  root.innerHTML = '';
  root.appendChild(buildHeader());

  const filtered = applyFilter(allDocs);
  const grouped = groupByFecha(filtered);

  if (!filtered.length) {
    root.appendChild(h('div', { class: 'center-empty' },
      h('div', { class: 'big' }, '🧾'),
      h('div', { style: { fontWeight: 700, color: 'var(--ink)' } }, allDocs.length ? 'Ningún resultado' : 'Aún no hay ventas registradas'),
      h('div', { style: { fontSize: '0.9rem', marginTop: '6px' } }, allDocs.length ? 'Ajusta los filtros para ver más.' : 'Cierra una mesa cobrándola y aparecerá aquí.'),
      h('a', { class: 'btn btn-primary', style: { marginTop: '14px' }, href: '#/mesas' }, 'Ir a mesas'),
    ));
    return;
  }

  for (const group of grouped) {
    root.appendChild(buildDateSummary(group));
    root.appendChild(buildDocsTable(group.docs));
  }
}

async function loadAllDocumentos() {
  const pageSize = 100;
  const docs = [];
  let page = 1;
  let total = Infinity;

  while (docs.length < total) {
    const res = await api.listDocumentos({ result_size: String(pageSize), result_page: String(page) });
    const results = (res && res.results) || [];
    total = Number(res && res.count);
    if (!Number.isFinite(total)) total = docs.length + results.length;
    docs.push(...results);
    if (results.length < pageSize || !results.length) break;
    page += 1;
  }

  return docs;
}

function applyFilter(docs) {
  const q = filter.q.trim().toLowerCase();
  return docs.filter((d) => {
    if (filter.tipo !== 'ALL' && (d.tipo_documento || d.tipoDocumento) !== filter.tipo) return false;
    if (filter.fecha !== 'ALL' && docDate(d) !== filter.fecha) return false;
    if (!q) return true;
    const blob = [
      clienteNombre(d),
      clienteId(d),
      d.orden && d.orden.mesa && d.orden.mesa.nombre,
      d.descripcion, d.id,
    ].join(' ').toLowerCase();
    return blob.includes(q);
  });
}

function groupByFecha(docs) {
  const byDate = new Map();
  for (const d of docs) {
    const fecha = docDate(d);
    if (!byDate.has(fecha)) byDate.set(fecha, []);
    byDate.get(fecha).push(d);
  }
  return [...byDate.entries()].map(([fecha, groupDocs]) => ({
    fecha,
    docs: groupDocs,
    total: groupDocs.reduce((sum, d) => sum + (Number(d.total) || 0), 0),
  }));
}

function buildDateSummary(group) {
  return h('div', { class: 'history-date-summary' },
    h('div', {},
      h('div', { class: 'date' }, group.fecha),
      h('div', { class: 'meta' }, `${group.docs.length} cuenta${group.docs.length === 1 ? '' : 's'} cerrada${group.docs.length === 1 ? '' : 's'}`),
    ),
    h('div', { class: 'total' }, money(group.total)),
  );
}

function buildDocsTable(docs) {
  const table = h('table', { class: 'history-table' });
  table.appendChild(h('thead', {},
    h('tr', {},
      h('th', {}, 'Hora'),
      h('th', {}, 'Tipo'),
      h('th', {}, 'Cliente'),
      h('th', {}, 'Mesa / Orden'),
      h('th', {}, 'Pagos'),
      h('th', { class: 'tright' }, 'Total'),
      h('th', {}, ''),
    ),
  ));
  const tb = h('tbody', {});
  for (const d of docs) {
    tb.appendChild(h('tr', { class: 'row-link', onclick: () => openDocDetail(d) },
      h('td', {}, docTime(d)),
      h('td', {}, h('span', { class: 'pill ' + (d.tipo_documento || d.tipoDocumento || 'FAC') },
        TIPO_LABEL[d.tipo_documento || d.tipoDocumento] || d.tipo_documento || d.tipoDocumento)),
      h('td', {}, clienteNombre(d)),
      h('td', {}, (d.orden && d.orden.mesa && d.orden.mesa.nombre) || ((d.orden_id || d.ordenId || '').toString().slice(0, 8) || '—')),
      h('td', {}, buildCobrosCell(d)),
      h('td', { class: 'tright', style: { fontWeight: 700 } }, money(d.total)),
      h('td', {},
        h('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); openDocDetail(d); } }, 'Ver'),
      ),
    ));
  }
  table.appendChild(tb);
  return table;
}

function buildCobrosCell(d) {
  const cobros = d.cobros || [];
  if (!cobros.length) return h('span', { style: { color: 'var(--mute)' } }, '—');
  const wrap = h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } });
  for (const c of cobros) {
    const m = c.forma_cobro || c.formaCobro;
    wrap.appendChild(h('span', { class: 'row-method', style: { fontSize: '0.74rem' } },
      iconForMethod(m) + ' ' + money(c.monto)));
  }
  return wrap;
}

function iconForMethod(m) {
  return ({ EF: '💵', TC: '💳', TR: '🏦' })[m] || '💲';
}

function buildHeader() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', gap: '12px', flexWrap: 'wrap' } },
    h('div', {},
      h('h2', { style: { margin: 0, fontSize: '1.4rem', fontWeight: 800 } }, 'Cuentas cerradas'),
      h('div', { style: { color: 'var(--mute)', fontSize: '0.9rem', marginTop: '2px' } }, 'Historial de ventas y facturas emitidas.'),
    ),
    h('a', { class: 'btn btn-ghost btn-sm', href: '#/mesas' }, '← Volver a mesas'),
  ));

  const tb = h('div', { class: 'history-toolbar' });
  tb.appendChild(h('div', { class: 'grow' },
    h('span', { class: 'icon' }, '🔍'),
    h('input', {
      class: 'input', placeholder: 'Buscar por cliente, RUC, mesa, descripción…',
      value: filter.q,
      oninput: (e) => { filter.q = e.target.value; paint(document.getElementById('view-root')); restoreFocus('hist-search'); },
      id: 'hist-search',
    }),
  ));

  tb.appendChild(h('select', { class: 'select', style: { maxWidth: '180px' },
    onchange: (e) => { filter.tipo = e.target.value; paint(document.getElementById('view-root')); },
  },
    h('option', { value: 'ALL', selected: filter.tipo === 'ALL' ? 'selected' : null }, 'Todos los tipos'),
    h('option', { value: 'FAC', selected: filter.tipo === 'FAC' ? 'selected' : null }, 'Solo facturas'),
    h('option', { value: 'PRE', selected: filter.tipo === 'PRE' ? 'selected' : null }, 'Solo pre-facturas'),
  ));

  const fechas = uniqueFechas(allDocs);
  tb.appendChild(h('select', { class: 'select', style: { maxWidth: '180px' },
    onchange: (e) => { filter.fecha = e.target.value; paint(document.getElementById('view-root')); },
  },
    h('option', { value: 'ALL', selected: filter.fecha === 'ALL' ? 'selected' : null }, 'Todas las fechas'),
    ...fechas.map((fecha) => h('option', { value: fecha, selected: filter.fecha === fecha ? 'selected' : null }, fecha)),
  ));
  wrap.appendChild(tb);
  return wrap;
}

function uniqueFechas(docs) {
  return [...new Set(docs.map(docDate))];
}

function docDate(d) {
  return d.fecha_emision || d.fechaEmision || formatDate(d.created_at || d.createdAt) || 'Sin fecha';
}

function docTime(d) {
  const raw = d.created_at || d.createdAt || d.updated_at || d.updatedAt;
  if (!raw) return '—';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(raw) {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function clienteNombre(d) {
  return d.cliente?.razon_social || d.cliente_razon_social || d.clienteRazonSocial || 'CONSUMIDOR FINAL';
}

function clienteId(d) {
  return d.cliente?.ruc || d.cliente?.cedula || d.cliente_ruc || d.clienteRuc || d.cliente_cedula || d.clienteCedula || '';
}

function restoreFocus(id) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 0);
}

function skeletonRows() {
  const wrap = h('div', {});
  for (let i = 0; i < 4; i++) wrap.appendChild(h('div', { class: 'skeleton', style: { height: '52px', marginBottom: '8px' } }));
  return wrap;
}

async function openDocDetail(d) {
  let full = d;
  try { full = await api.getDocumento(d.id); } catch (_) { /* use list copy */ }
  const cobros = full.cobros || [];

  const body = h('div', {});
  body.appendChild(h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '12px' } },
    h('div', {}, h('div', { style: { color: 'var(--mute)', fontSize: '0.78rem' } }, 'Documento'),
      h('div', { style: { fontWeight: 700 } }, (full.tipo_documento || full.tipoDocumento || '—') + ' #' + String(full.id || '').slice(0, 8))),
    h('div', { style: { textAlign: 'right' } }, h('div', { style: { color: 'var(--mute)', fontSize: '0.78rem' } }, 'Fecha'),
      h('div', { style: { fontWeight: 700 } }, full.fecha_emision || full.fechaEmision || '—')),
  ));

  body.appendChild(h('div', { class: 'card card-pad', style: { marginBottom: '12px' } },
    h('div', { style: { fontSize: '0.78rem', color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' } }, 'Cliente'),
    h('div', { style: { fontWeight: 700 } }, clienteNombre(full)),
    h('div', { style: { color: 'var(--mute)', fontSize: '0.86rem' } },
      clienteId(full) +
      (full.cliente?.email || full.cliente_email || full.clienteEmail ? ' · ' + (full.cliente?.email || full.cliente_email || full.clienteEmail) : '')),
  ));

  body.appendChild(h('div', { class: 'totals', style: { borderRadius: '10px', border: '1px solid var(--line)' } },
    h('div', { class: 'row' }, h('span', {}, 'Subtotal'), h('span', {}, money((Number(full.subtotal_0) || 0) + (Number(full.subtotal_15) || 0)))),
    h('div', { class: 'row' }, h('span', {}, 'IVA 15%'), h('span', {}, money(full.iva))),
    h('div', { class: 'row' }, h('span', {}, 'Servicio 10%'), h('span', {}, money(full.servicio))),
    h('div', { class: 'row total' }, h('span', {}, 'Total'), h('span', {}, money(full.total))),
  ));

  if (cobros.length) {
    body.appendChild(h('div', { style: { fontSize: '0.78rem', color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '14px 0 6px' } }, 'Métodos de pago'));
    const t = h('table', { class: 'pay-table' });
    t.appendChild(h('thead', {}, h('tr', {}, h('th', {}, 'Método'), h('th', {}, 'Detalle'), h('th', { class: 'tright' }, 'Monto'))));
    const tb = h('tbody', {});
    for (const c of cobros) {
      tb.appendChild(h('tr', {},
        h('td', {}, h('span', { class: 'row-method' }, iconForMethod(c.forma_cobro || c.formaCobro) + ' ' + (c.forma_cobro || c.formaCobro))),
        h('td', {}, c.detalle || c.procesador || '—'),
        h('td', { class: 'tright', style: { fontWeight: 700 } }, money(c.monto)),
      ));
    }
    t.appendChild(tb);
    body.appendChild(t);
  }

  const footer = h('div', { style: { display: 'flex', gap: '8px' } },
    h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cerrar'),
    h('button', { class: 'btn btn-outline', onclick: () => printDoc(full) }, '🖨️ Reimprimir'),
  );
  openModal({ title: 'Detalle de venta', body, footer, size: 'lg' });
}

function printDoc(full) {
  const region = h('div', { class: 'print-only', id: 'temp-print' });
  region.appendChild(h('h1', {}, '🍽️ POS Mesita — ' + (full.tipo_documento || full.tipoDocumento || 'Documento')));
  region.appendChild(h('div', {}, 'Fecha: ' + (full.fecha_emision || full.fechaEmision || '—')));
  region.appendChild(h('div', {}, 'Documento: #' + String(full.id || '').slice(0, 8)));
  region.appendChild(h('div', {}, 'Cliente: ' + clienteNombre(full)));
  region.appendChild(h('div', { style: { marginTop: '14px', textAlign: 'right' } },
    h('div', {}, 'Subtotal: ' + money((Number(full.subtotal_0) || 0) + (Number(full.subtotal_15) || 0))),
    h('div', {}, 'IVA 15%: ' + money(full.iva)),
    h('div', {}, 'Servicio 10%: ' + money(full.servicio)),
    h('div', { style: { fontWeight: 700, fontSize: '1.05rem', marginTop: '6px' } }, 'Total: ' + money(full.total)),
  ));
  document.body.appendChild(region);
  window.print();
  setTimeout(() => region.remove(), 500);
}
