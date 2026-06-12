// POS order screen: menu (left) + precuenta sidebar (right).
import * as api from '../api.js';
import { state, subscribe, openMesa, refreshOrden, loadFloor, clearCurrent } from '../state.js';
import { h, icon, toast, withLoading, confirmDialog, openModal, closeModal } from '../ui.js';
import { money, productIcon, RESTAURANT_INFO, formatDateTime } from '../format.js';
import { openCobroModal } from './cobro.js';
import { getDiners, setDiners } from '../diners.js';

let activeCategory = 'all';
let searchTerm = '';
let unsub = null;
let hashListener = null;

function cleanup() {
  if (unsub) { unsub(); unsub = null; }
  if (hashListener) { window.removeEventListener('hashchange', hashListener); hashListener = null; }
  clearCurrent();
}

export async function renderPOS(root, mesaId) {
  root.innerHTML = '';
  root.classList.add('full');
  cleanup();

  // When the user navigates away from this screen, tear down the subscription
  // so floor.js / historial.js renders aren't overwritten by stale POS paints.
  hashListener = () => {
    if (!location.hash.match(/^#\/mesa\//)) cleanup();
  };
  window.addEventListener('hashchange', hashListener);

  root.appendChild(skeletonScreen());

  try {
    if (!state.mesas.length || !state.productos.length) await loadFloor();
    await openMesa(mesaId);
  } catch (err) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'center-empty' },
      h('div', { class: 'big' }, '⚠️'),
      h('div', { style: { fontWeight: 700 } }, 'No se pudo abrir la mesa'),
      h('div', { style: { fontSize: '0.9rem', marginTop: '6px' } }, err.message),
      h('button', { class: 'btn btn-outline', style: { marginTop: '14px' }, onclick: () => { location.hash = '#/mesas'; } }, 'Volver a mesas'),
    ));
    return;
  }

  paint(root);
  unsub = subscribe(() => paint(root));
}

// Modal: pick party size and persist to Orden.comensales (server-side).
// No auto-prompt — tables start with 0 diners until the user explicitly sets one.
function openDinersModal({ initial = 0, canCancel = true } = {}) {
  const orden = state.current.orden;
  if (!orden?.id) return;
  let value = Math.max(0, Math.min(20, Number(initial) || 0));

  const display = h('div', {
    style: { fontSize: '3rem', fontWeight: 800, textAlign: 'center', margin: '12px 0', color: 'var(--brand-600)' },
  }, String(value));

  const setVal = (n) => {
    value = Math.max(1, Math.min(20, n));
    display.textContent = String(value);
  };

  const pad = h('div', {
    style: {
      display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', margin: '6px 0 4px',
    },
  });
  for (let i = 1; i <= 20; i++) {
    pad.appendChild(h('button', {
      class: 'btn btn-outline',
      style: { padding: '10px 0', fontWeight: 700 },
      onclick: () => setVal(i),
    }, String(i)));
  }

  const stepRow = h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '8px' } },
    h('button', { class: 'btn btn-ghost', onclick: () => setVal(value - 1) }, '−'),
    h('button', { class: 'btn btn-ghost', onclick: () => setVal(value + 1) }, '+'),
  );

  const body = h('div', {},
    h('div', { style: { textAlign: 'center', color: 'var(--mute)', fontSize: '0.92rem' } }, 'Selecciona el número de comensales'),
    display,
    stepRow,
    pad,
  );

  const footer = h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
    canCancel ? h('button', { class: 'btn btn-ghost', onclick: () => closeModal() }, 'Cancelar') : null,
    h('button', {
      class: 'btn btn-primary',
      onclick: async (e) => {
        const btn = e.currentTarget;
        try {
          await withLoading(btn, () => setDiners(orden.id, value));
          closeModal();
          await refreshOrden();
          toast(value > 0 ? `${value} persona${value === 1 ? '' : 's'}` : 'Sin comensales', 'ok', 1500);
        } catch (err) {
          toast('Error al guardar: ' + err.message, 'bad');
        }
      },
    }, 'Confirmar'),
  );

  openModal({ title: '¿Cuántas personas?', body, footer });
}

function paint(root) {
  if (!state.current.mesa) return;
  root.innerHTML = '';

  const crumbs = document.getElementById('crumbs');
  if (crumbs) crumbs.innerHTML = `<a href="#/mesas" style="color:inherit;text-decoration:none">Mesas</a> &nbsp;›&nbsp; <strong style="color:var(--ink)">${state.current.mesa.nombre}</strong>`;

  // Big, obvious return-to-mesas bar above the POS grid.
  root.appendChild(h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '10px 18px', background: '#fff', borderBottom: '1px solid var(--line)',
    },
  },
    h('a', {
      href: '#/mesas',
      class: 'btn btn-outline',
      style: { textDecoration: 'none', fontWeight: 700 },
    }, '← Volver a Mesas'),
    h('div', { style: { color: 'var(--mute)', fontSize: '0.88rem' } },
      `Editando orden de ${state.current.mesa.nombre} · los cambios se guardan automáticamente`),
  ));

  const grid = h('div', { class: 'pos' });
  grid.appendChild(buildMenuPane());
  grid.appendChild(buildSidebar());
  root.appendChild(grid);

  root.appendChild(buildPrintRegion());
}

// ---------- Menu pane ----------
function buildMenuPane() {
  const pane = h('div', { class: 'pos-menu' });

  const search = h('div', { class: 'search-bar' },
    iconWrap('search', 'icon'),
    h('input', {
      class: 'input', placeholder: 'Buscar plato…', value: searchTerm,
      oninput: (e) => { searchTerm = e.target.value; paintProductGrid(); },
      autocomplete: 'off',
    })
  );
  pane.appendChild(search);

  const tabs = h('div', { class: 'cat-tabs' });
  tabs.appendChild(catTab('all', 'Todo'));
  for (const c of state.categorias) tabs.appendChild(catTab(c.id, c.nombre));
  pane.appendChild(tabs);

  const grid = h('div', { class: 'prod-grid', id: 'prod-grid' });
  pane.appendChild(grid);
  paintProductGrid(grid);
  return pane;
}

function catTab(id, label) {
  return h('button', {
    class: 'cat-tab' + (activeCategory === id ? ' active' : ''),
    onclick: () => { activeCategory = id; paintTabs(); paintProductGrid(); },
  }, label);
}

function paintTabs() {
  const tabs = document.querySelectorAll('.cat-tab');
  tabs.forEach((el, i) => {
    const id = i === 0 ? 'all' : state.categorias[i - 1]?.id;
    el.classList.toggle('active', id === activeCategory);
  });
}

function paintProductGrid(grid) {
  grid = grid || document.getElementById('prod-grid');
  if (!grid) return;
  grid.innerHTML = '';
  let items = state.productos;
  if (activeCategory !== 'all') {
    items = items.filter((p) => (p.categoria_id || p.categoriaId) === activeCategory);
  }
  if (searchTerm.trim()) {
    const q = searchTerm.toLowerCase().trim();
    items = items.filter((p) => (p.nombre || '').toLowerCase().includes(q) || (p.descripcion || '').toLowerCase().includes(q));
  }
  if (!items.length) {
    grid.appendChild(h('div', { class: 'center-empty', style: { gridColumn: '1/-1' } },
      h('div', { class: 'big' }, '🔍'),
      h('div', {}, 'No hay productos con esos criterios.'),
    ));
    return;
  }
  for (const p of items) grid.appendChild(buildProductCard(p));
}

function buildProductCard(p) {
  return h('button', { class: 'prod-card', onclick: (e) => quickAdd(p, e.currentTarget) },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      h('span', { style: { fontSize: '1.5rem', lineHeight: 1 } }, productIcon(p)),
      h('div', { class: 'pname', style: { flex: 1 } }, p.nombre || 'Sin nombre'),
    ),
    h('div', { class: 'pdesc' }, p.descripcion || ''),
    h('div', { class: 'pprice' }, money(p.precio)),
  );
}

async function quickAdd(prod, btn) {
  if (!state.current.orden) return;
  await withLoading(btn, async () => {
    try {
      await api.addDetalle(state.current.orden.id, {
        producto_id: prod.id,
        nombre: prod.nombre,
        cantidad: 1,
        precio: Number(prod.precio),
        porcentaje_iva: 15,
      });
      await refreshOrden();
      toast(`Añadido: ${prod.nombre}`, 'ok', 1800);
    } catch (err) { toast('Error: ' + err.message, 'bad'); }
  });
}

// ---------- Sidebar / precuenta ----------
function buildSidebar() {
  const side = h('aside', { class: 'pos-sidebar' });
  const orden = state.current.orden || {};
  const detalles = orden.detalles || [];

  const diners = getDiners(orden);
  side.appendChild(h('div', { class: 'precuenta-head' },
    h('div', {},
      h('div', { class: 'ptable' }, state.current.mesa?.nombre || 'Mesa'),
      h('div', { class: 'ptag' }, `${detalles.length} ítem${detalles.length === 1 ? '' : 's'} · Orden #${(orden.id || '').slice(0, 8)}`),
      h('div', {
        style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '0.85rem', color: 'var(--ink-2)' },
      },
        h('span', {}, diners > 0 ? `👥 ${diners} persona${diners === 1 ? '' : 's'}` : '👥 Sin comensales'),
        h('button', {
          class: 'btn btn-ghost btn-sm',
          style: { padding: '2px 6px', minHeight: 'auto', fontSize: '0.8rem' },
          title: diners > 0 ? 'Editar número de personas' : 'Agregar comensales',
          onclick: () => openDinersModal({ initial: diners, canCancel: true }),
        }, diners > 0 ? '✏️' : '+'),
      ),
    ),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { location.hash = '#/mesas'; } }, iconWrap('back', null, 14), 'Mesas'),
  ));

  const list = h('div', { class: 'precuenta-items' });
  if (!detalles.length) {
    list.appendChild(h('div', { class: 'precuenta-empty' },
      h('div', { class: 'big' }, '🍽️'),
      h('div', { style: { fontWeight: 700, color: 'var(--ink-2)' } }, 'Precuenta vacía'),
      h('div', {}, 'Toca un producto del menú para agregarlo.'),
    ));
  } else {
    for (const d of detalles) list.appendChild(buildLineItem(d));
  }
  side.appendChild(list);

  side.appendChild(buildTotals());
  side.appendChild(buildActionBar(detalles.length > 0));
  return side;
}

// 4 large action buttons: Anular · Guardar · Precuenta · Pagar
// Anular is always enabled — clears the table and returns to mesas.
function buildActionBar(hasItems) {
  const bar = h('div', { class: 'action-bar four' });
  bar.appendChild(actBtn('🚫', 'Anular',    'danger',   handleCancelOrder,      false));
  bar.appendChild(actBtn('💾', 'Guardar',   '',         handleGuardar,          false));
  bar.appendChild(actBtn('📄', 'Precuenta', '',         handlePrintPrecuenta,   !hasItems));
  bar.appendChild(actBtn('💵', 'Pagar',     'success',  handleCobrar,           !hasItems));
  return bar;
}

function actBtn(emoji, label, variant, onClick, disabled) {
  return h('button', {
    class: 'action-btn ' + variant,
    onclick: onClick,
    disabled: disabled ? 'disabled' : null,
  },
    h('div', { class: 'ab-icon' }, emoji),
    h('div', {}, label),
  );
}

async function handleGuardar() {
  // All edits are already persisted on the fly (each add/qty/remove hits the API).
  // This button just confirms it and goes back to mesas.
  toast('Orden guardada en la mesa', 'ok');
  location.hash = '#/mesas';
}

function buildLineItem(d) {
  const name = String(d.nombre || '');
  const noteMatch = name.match(/^(.*?)\s+—\s+(.+)$/);
  const baseName = noteMatch ? noteMatch[1] : name;
  const note = noteMatch ? noteMatch[2] : '';
  const cant = Number(d.cantidad) || 0;
  const precio = Number(d.precio) || 0;
  const lineTotal = cant * precio;

  return h('div', { class: 'line-item' },
    h('div', {},
      h('div', { class: 'lname' }, baseName),
      note ? h('div', { class: 'lnote' }, '“' + note + '”') : null,
      h('div', { class: 'lqty' },
        h('button', { class: 'qbtn', onclick: () => changeQty(d, cant - 1), 'aria-label': 'Disminuir' }, '−'),
        h('span', { class: 'qval' }, String(cant)),
        h('button', { class: 'qbtn', onclick: () => changeQty(d, cant + 1), 'aria-label': 'Aumentar' }, '+'),
        h('span', { style: { color: 'var(--mute)', fontSize: '0.78rem', marginLeft: '8px' } }, `× ${money(precio)}`),
      ),
    ),
    h('div', {},
      h('div', { class: 'lprice' }, money(lineTotal)),
      h('div', { class: 'lactions' },
        h('button', { class: 'iconbtn notebtn', onclick: () => editNote(d), title: 'Nota' }, icon('note', 16)),
        h('button', { class: 'iconbtn', onclick: () => removeLine(d), title: 'Eliminar' }, icon('trash', 16)),
      ),
    ),
  );
}

async function changeQty(d, newQty) {
  if (newQty < 1) return removeLine(d);
  const orden = state.current.orden;
  try {
    await api.removeDetalle(orden.id, d.id);
    await api.addDetalle(orden.id, {
      producto_id: d.producto_id || d.productoId,
      nombre: d.nombre,
      cantidad: newQty,
      precio: Number(d.precio),
      porcentaje_iva: d.porcentaje_iva || d.porcentajeIva || 15,
    });
    await refreshOrden();
  } catch (err) { toast('Error: ' + err.message, 'bad'); }
}

async function removeLine(d) {
  const ok = await confirmDialog({
    title: 'Quitar ítem',
    message: `¿Quitar "${d.nombre}" de la precuenta?`,
    danger: true, confirmText: 'Quitar',
  });
  if (!ok) return;
  try {
    await api.removeDetalle(state.current.orden.id, d.id);
    await refreshOrden();
    toast('Ítem eliminado', 'ok');
  } catch (err) { toast('Error: ' + err.message, 'bad'); }
}

function editNote(d) {
  const name = String(d.nombre || '');
  const noteMatch = name.match(/^(.*?)\s+—\s+(.+)$/);
  const baseName = noteMatch ? noteMatch[1] : name;
  const currentNote = noteMatch ? noteMatch[2] : '';

  const input = h('input', { class: 'input', value: currentNote, placeholder: 'sin cebolla, extra salsa, etc.' });
  openModal({
    title: `Nota para "${baseName}"`,
    body: h('div', { class: 'field' },
      h('label', {}, 'Nota'),
      input,
      h('div', { class: 'hint' }, 'La nota se guarda junto al nombre del ítem.'),
    ),
    footer: h('div', { style: { display: 'flex', gap: '8px' } },
      h('button', { class: 'btn btn-ghost', onclick: () => closeModal() }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        const newNote = input.value.trim();
        const newName = newNote ? `${baseName} — ${newNote}` : baseName;
        try {
          await api.removeDetalle(state.current.orden.id, d.id);
          await api.addDetalle(state.current.orden.id, {
            producto_id: d.producto_id || d.productoId,
            nombre: newName,
            cantidad: Number(d.cantidad),
            precio: Number(d.precio),
            porcentaje_iva: d.porcentaje_iva || d.porcentajeIva || 15,
          });
          await refreshOrden();
          closeModal();
          toast('Nota guardada', 'ok');
        } catch (err) { toast('Error: ' + err.message, 'bad'); }
      } }, 'Guardar'),
    ),
  });
  setTimeout(() => input.focus(), 50);
}

function buildTotals() {
  const t = state.current.totales || { subtotal_15: 0, subtotal_0: 0, iva: 0, servicio: 0, total: 0 };
  const serviceEnabled = t.service_enabled !== false;
  return h('div', { class: 'totals' },
    h('div', { class: 'row' }, h('span', {}, 'Subtotal'), h('span', {}, money((Number(t.subtotal_0) || 0) + (Number(t.subtotal_15) || 0)))),
    h('div', { class: 'row' }, h('span', {}, 'IVA 15%'), h('span', {}, money(t.iva))),
    serviceEnabled ? h('div', { class: 'row' }, h('span', {}, serviceLabel(t)), h('span', {}, money(t.servicio))) : null,
    h('div', { class: 'row total' }, h('span', {}, 'Total'), h('span', {}, money(t.total))),
  );
}

async function handleCancelOrder() {
  const ok = await confirmDialog({
    title: 'Cancelar orden',
    message: '¿Cancelar la orden y vaciar la precuenta? Esta acción no se puede deshacer.',
    danger: true, confirmText: 'Sí, cancelar',
  });
  if (!ok) return;
  try {
    await api.updateOrden(state.current.orden.id, { estado: 'X' });
    if (state.current.mesa) {
      try { await api.updateMesa(state.current.mesa.id, { estado: 'L' }); } catch (_) {}
    }
    toast('Orden cancelada', 'ok');
    location.hash = '#/mesas';
  } catch (err) { toast('Error: ' + err.message, 'bad'); }
}

function handlePrintPrecuenta() { window.print(); }

function handleCobrar() {
  openCobroModal({
    mesa: state.current.mesa,
    orden: state.current.orden,
    totales: state.current.totales,
    onSuccess: async () => {
      try {
        await api.updateOrden(state.current.orden.id, { estado: 'C' });
        await api.updateMesa(state.current.mesa.id, { estado: 'L' });
      } catch (_) { /* best effort */ }
      toast('¡Pago registrado! Mesa liberada.', 'ok');
      location.hash = '#/mesas';
    },
  });
}

// ---------- Print region (professional precuenta) ----------
function buildPrintRegion() {
  const orden = state.current.orden || {};
  const detalles = orden.detalles || [];
  const t = state.current.totales || {};
  const diners = getDiners(orden);
  const now = new Date();
  const fecha = now.toLocaleDateString('es-EC');
  const hora = now.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });

  const wrap = h('div', { class: 'print-only' });

  // Restaurant header — cleaner, centered
  wrap.appendChild(h('div', { style: { textAlign: 'center', marginBottom: '10px' } },
    h('div', { style: { fontWeight: 800, fontSize: '1.25rem', letterSpacing: '0.02em' } }, RESTAURANT_INFO.nombreComercial || RESTAURANT_INFO.razonSocial),
    RESTAURANT_INFO.nombreComercial && RESTAURANT_INFO.razonSocial !== RESTAURANT_INFO.nombreComercial
      ? h('div', { style: { fontSize: '0.82rem', fontWeight: 700 } }, RESTAURANT_INFO.razonSocial)
      : null,
    h('div', { style: { fontSize: '0.8rem', color: '#444' } }, RESTAURANT_INFO.direccion),
    h('div', { style: { fontSize: '0.8rem', color: '#444' } }, 'Tel. ' + RESTAURANT_INFO.telefono + ' · R.U.C. ' + RESTAURANT_INFO.ruc),
  ));

  // Prominent boxed stamp — no fiscal value
  wrap.appendChild(h('div', {
    style: {
      border: '2px solid #000', padding: '10px', margin: '12px 0', textAlign: 'center',
      fontWeight: 800, letterSpacing: '0.08em', fontSize: '0.95rem', lineHeight: 1.3,
    },
  },
    h('div', {}, 'PRECUENTA'),
    h('div', { style: { fontSize: '0.78rem', fontWeight: 700, marginTop: '2px' } }, 'SIN VALIDEZ TRIBUTARIA'),
  ));

  // Meta grid: mesa, personas, fecha, hora, mesero
  const metaRow = (label, value) => h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '2px 0' } },
    h('span', { style: { color: '#444' } }, label),
    h('span', { style: { fontWeight: 700 } }, value),
  );
  wrap.appendChild(h('div', { style: { marginBottom: '10px', borderBottom: '1px dashed #000', paddingBottom: '8px' } },
    metaRow('Mesa', state.current.mesa?.nombre || '—'),
    metaRow('Personas', diners > 0 ? String(diners) : '—'),
    metaRow('Fecha', fecha),
    metaRow('Hora', hora),
    orden.mesero ? metaRow('Mesero', String(orden.mesero)) : null,
    metaRow('Orden', '#' + (orden.id || '').slice(0, 8)),
  ));

  // Items
  const table = h('table', {});
  table.appendChild(h('thead', {},
    h('tr', {},
      h('th', {}, 'Cant'),
      h('th', {}, 'Descripción'),
      h('th', { class: 'tright' }, 'P. Unit.'),
      h('th', { class: 'tright' }, 'Total'),
    ),
  ));
  const tb = h('tbody', {});
  for (const d of detalles) {
    tb.appendChild(h('tr', {},
      h('td', {}, String(d.cantidad)),
      h('td', {}, d.nombre),
      h('td', { class: 'tright' }, money(d.precio)),
      h('td', { class: 'tright' }, money(Number(d.cantidad) * Number(d.precio))),
    ));
  }
  table.appendChild(tb);
  wrap.appendChild(table);

  // Totals
  wrap.appendChild(h('div', { style: { marginTop: '14px', display: 'flex', justifyContent: 'flex-end' } },
    h('div', { style: { minWidth: '260px' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
        h('span', {}, 'Subtotal'), h('span', {}, money((Number(t.subtotal_0) || 0) + (Number(t.subtotal_15) || 0)))),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
        h('span', {}, 'IVA 15%'), h('span', {}, money(t.iva))),
      t.service_enabled === false ? null : h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
        h('span', {}, serviceLabel(t)), h('span', {}, money(t.servicio))),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #000', fontWeight: 800, fontSize: '1.1rem', marginTop: '4px' } },
        h('span', {}, 'TOTAL'), h('span', {}, money(t.total))),
    ),
  ));

  // Footer disclaimer
  wrap.appendChild(h('div', {
    style: { marginTop: '20px', fontSize: '0.78rem', textAlign: 'center', borderTop: '1px dashed #000', paddingTop: '10px', lineHeight: 1.5 },
  },
    'Esta precuenta NO cierra la mesa. Puede seguir agregando o modificando productos.',
    h('br'),
    'Solicite su factura al momento de pagar.',
  ));
  return wrap;
}

function serviceLabel(t) {
  const pct = Math.round(Number(t.service_rate ?? 0.10) * 100);
  return `Servicio ${pct}%`;
}

function iconWrap(name, cls, size) {
  const w = h('span', { class: cls || '', style: { display: 'inline-flex', alignItems: 'center' } });
  w.appendChild(icon(name, size || 18));
  return w;
}

function skeletonScreen() {
  return h('div', { class: 'pos' },
    h('div', { class: 'pos-menu' },
      h('div', { class: 'skeleton', style: { height: '40px', marginBottom: '14px' } }),
      h('div', { class: 'prod-grid' },
        ...Array.from({ length: 8 }, () => h('div', { class: 'skeleton', style: { height: '100px' } })),
      ),
    ),
    h('div', { class: 'pos-sidebar' },
      h('div', { style: { padding: '20px' } },
        h('div', { class: 'skeleton', style: { height: '24px', width: '50%' } }),
        h('div', { class: 'skeleton', style: { height: '12px', width: '70%', marginTop: '12px' } }),
      ),
    ),
  );
}
