// Cobro modal: tabbed multi-payment (Efectivo / Tarjeta / Transferencia / Otros) with
// live Total/Saldo/Vuelto, removable payment rows, factura electrónica form, gated Aceptar.
import * as api from '../api.js';
import { h, openModal, closeModal, toast, withLoading } from '../ui.js';
import { money, todayDDMMYYYY, isCedula, isRuc, isEmail, PAYMENT_METHODS, CARD_PROCESSORS, FACTURA_AUTO_THRESHOLD, RESTAURANT_INFO, formatDateTime } from '../format.js';

const TAB_ICONS = { EF: '💵', TC: '💳', TR: '🏦' };

const CONSUMIDOR_FINAL = {
  cedula: '9999999999', ruc: '9999999999001',
  razon_social: 'CONSUMIDOR FINAL', tipo: 'N',
  email: '', telefonos: '', direccion: 'Ecuador', es_extranjero: false,
};

let ctx; // module-scoped so render() helpers can reach it

export function openCobroModal({ mesa, orden, totales, onSuccess }) {
  const total = Number(totales?.total || 0);
  const facturaForced = total >= FACTURA_AUTO_THRESHOLD;
  ctx = {
    mesa, orden, totales,
    total,
    payments: [],
    activeTab: 'EF',
    facturaOn: facturaForced,
    facturaForced,
    cliente: { tipo: 'N', razon_social: '', cedula: '', ruc: '', email: '', telefonos: '', direccion: '' },
    onSuccess,
  };
  render();
}

// ---- Derived totals ----
function getHanded() { return ctx.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0); }
function getTip()    { return ctx.payments.reduce((s, p) => s + (Number(p.tip) || 0), 0); }
function getSaldo()  { return Math.max(0, round2(ctx.total - getHanded())); }
function getVuelto() { return Math.max(0, round2(getHanded() - ctx.total)); }
function round2(n)   { return Math.round((Number(n) || 0) * 100) / 100; }

// ---- Main render ----
function render() {
  const body = h('div', {});
  body.appendChild(buildSummary());
  body.appendChild(buildTabs());
  body.appendChild(buildTabContent());
  body.appendChild(buildPaymentsTable());
  body.appendChild(buildFacturaToggle());
  if (ctx.facturaOn) body.appendChild(buildClienteForm());

  const saldo = getSaldo();
  const footer = h('div', { style: { display: 'flex', gap: '8px' } },
    h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
    h('button', {
      class: 'btn btn-success btn-lg', id: 'aceptar-btn',
      disabled: saldo > 0 ? 'disabled' : null,
      onclick: (e) => onAceptar(e.currentTarget),
    }, saldo > 0 ? `Falta ${money(saldo)}` : '✓ Aceptar'),
  );

  openModal({ title: `Cobrar — ${ctx.mesa?.nombre || ''}`, body, footer, size: 'lg' });
}

// ---- Summary (Total / Saldo / Vuelto) ----
function buildSummary() {
  const saldo = getSaldo();
  const vuelto = getVuelto();
  return h('div', { class: 'cobro-summary' },
    h('div', { class: 'box' },
      h('div', { class: 'lbl' }, 'Total'),
      h('div', { class: 'val' }, money(ctx.total)),
    ),
    h('div', { class: 'box saldo' + (saldo === 0 ? ' zero' : '') },
      h('div', { class: 'lbl' }, saldo === 0 ? 'Cubierto' : 'Saldo pendiente'),
      h('div', { class: 'val' }, saldo === 0 ? '✓ $0.00' : money(saldo)),
    ),
    h('div', { class: 'box vuelto' },
      h('div', { class: 'lbl' }, 'Vuelto'),
      h('div', { class: 'val' }, money(vuelto)),
    ),
  );
}

// ---- Method tabs ----
function buildTabs() {
  const wrap = h('div', { class: 'method-tabs' });
  for (const m of PAYMENT_METHODS) {
    wrap.appendChild(h('button', {
      class: 'method-tab' + (ctx.activeTab === m.code ? ' active' : ''),
      onclick: () => { ctx.activeTab = m.code; render(); },
    },
      h('span', { class: 'mt-icon' }, TAB_ICONS[m.code] || '💲'),
      h('span', {}, m.label),
    ));
  }
  return wrap;
}

// ---- Tab content ----
function buildTabContent() {
  if (ctx.activeTab === 'EF') return buildEfectivoTab();
  if (ctx.activeTab === 'TC') return buildTarjetaTab();
  return buildTransferTab();
}

function buildEfectivoTab() {
  const wrap = h('div', {});
  const saldo = getSaldo();

  // Quick amount buttons. Useful real-world denominations + exact-saldo + common rounding.
  const quick = h('div', { class: 'quick-row' });
  const exact = round2(saldo);
  const candidates = [
    { label: 'Exacto', amount: exact },
    { label: 'Redondeo', amount: Math.ceil(exact) },
    { label: '$5',  amount: 5 },
    { label: '$10', amount: 10 },
    { label: '$20', amount: 20 },
    { label: '$50', amount: 50 },
    { label: '$100', amount: 100 },
  ];
  for (const c of candidates) {
    if (c.amount <= 0) continue;
    quick.appendChild(h('button', {
      class: 'quick-btn',
      onclick: () => addPayment({ method: 'EF', amount: c.amount, detalle: 'Efectivo' }),
    },
      h('div', { class: 'qb-label' }, c.label),
      h('div', { class: 'qb-amount' }, money(c.amount)),
    ));
  }
  wrap.appendChild(quick);

  // Manual entry
  const amt = h('input', { class: 'input', type: 'number', step: '0.01', min: '0', placeholder: '0.00', id: 'ef-manual' });
  wrap.appendChild(h('div', { class: 'add-row one-col' },
    h('div', { class: 'field' },
      h('label', {}, 'Monto manual'),
      amt,
    ),
    h('button', {
      class: 'btn btn-primary', style: { alignSelf: 'end', height: '42px' },
      onclick: () => {
        const v = round2(amt.value);
        if (v <= 0) return toast('Ingresa un monto mayor a 0', 'bad');
        addPayment({ method: 'EF', amount: v, detalle: 'Efectivo' });
      },
    }, '+ Agregar pago'),
  ));
  return wrap;
}

function buildTarjetaTab() {
  const wrap = h('div', {});
  const proc = h('select', { class: 'select', id: 'tc-proc' });
  for (const p of CARD_PROCESSORS) proc.appendChild(h('option', { value: p.code }, p.label));
  const amt = h('input', { class: 'input', type: 'number', step: '0.01', min: '0', placeholder: '0.00', id: 'tc-amt', value: round2(getSaldo()) || '' });
  const tip = h('input', { class: 'input', type: 'number', step: '0.01', min: '0', placeholder: '0.00', id: 'tc-tip' });

  wrap.appendChild(h('div', { class: 'add-row three-col' },
    h('div', { class: 'field' }, h('label', {}, 'Procesador'), proc),
    h('div', { class: 'field' }, h('label', { class: 'required' }, 'Monto'), amt),
    h('div', { class: 'field' }, h('label', {}, 'Propina'), tip),
    h('button', {
      class: 'btn btn-primary', style: { alignSelf: 'end', height: '42px' },
      onclick: () => {
        const v = round2(amt.value);
        const t = round2(tip.value);
        if (v <= 0) return toast('Ingresa un monto válido', 'bad');
        const procLabel = CARD_PROCESSORS.find((p) => p.code === proc.value)?.label || 'Tarjeta';
        addPayment({ method: 'TC', amount: v, tip: t, processor: proc.value, detalle: procLabel });
      },
    }, '+ Agregar pago'),
  ));
  return wrap;
}

function buildTransferTab() {
  const wrap = h('div', {});
  const ref = h('input', { class: 'input', placeholder: 'Banco / N° referencia', id: 'tr-ref' });
  const amt = h('input', { class: 'input', type: 'number', step: '0.01', min: '0', placeholder: '0.00', id: 'tr-amt', value: round2(getSaldo()) || '' });
  wrap.appendChild(h('div', { class: 'add-row' },
    h('div', { class: 'field' }, h('label', {}, 'Banco / Referencia'), ref),
    h('div', { class: 'field' }, h('label', { class: 'required' }, 'Monto'), amt),
    h('button', {
      class: 'btn btn-primary', style: { alignSelf: 'end', height: '42px' },
      onclick: () => {
        const v = round2(amt.value);
        if (v <= 0) return toast('Ingresa un monto válido', 'bad');
        addPayment({ method: 'TR', amount: v, detalle: ref.value.trim() || 'Transferencia' });
      },
    }, '+ Agregar pago'),
  ));
  return wrap;
}

// ---- Payment rows table ----
function buildPaymentsTable() {
  if (!ctx.payments.length) {
    return h('div', { class: 'empty-pay' }, 'Aún no hay pagos registrados. Agrega uno con los controles de arriba.');
  }
  const table = h('table', { class: 'pay-table' });
  table.appendChild(h('thead', {},
    h('tr', {},
      h('th', {}, 'Método'),
      h('th', {}, 'Detalle'),
      h('th', { class: 'tright' }, 'Propina'),
      h('th', { class: 'tright' }, 'Monto'),
      h('th', {}, ''),
    ),
  ));
  const tb = h('tbody', {});
  for (const p of ctx.payments) {
    const methodLbl = PAYMENT_METHODS.find((m) => m.code === p.method)?.label || p.method;
    tb.appendChild(h('tr', {},
      h('td', {}, h('span', { class: 'row-method' }, (TAB_ICONS[p.method] || '') + ' ' + methodLbl)),
      h('td', {}, p.detalle || '—'),
      h('td', { class: 'tright' }, p.tip ? money(p.tip) : '—'),
      h('td', { class: 'tright', style: { fontWeight: 700 } }, money(p.amount)),
      h('td', {},
        h('button', { class: 'x-btn', title: 'Quitar', onclick: () => removePayment(p.id) }, '✕'),
      ),
    ));
  }
  table.appendChild(tb);
  return table;
}

function addPayment(p) {
  ctx.payments.push({ id: 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), ...p });
  render();
}
function removePayment(id) {
  ctx.payments = ctx.payments.filter((p) => p.id !== id);
  render();
}

// ---- Factura type chips (Consumidor Final vs Factura Electrónica) ----
function buildFacturaToggle() {
  const autoFE = ctx.total >= FACTURA_AUTO_THRESHOLD;
  const subtitle = autoFE && ctx.facturaOn
    ? `Preseleccionado por monto ≥ ${money(FACTURA_AUTO_THRESHOLD)}. Puedes cambiarlo si el cliente lo prefiere.`
    : (ctx.facturaOn
      ? 'Se emitirá factura electrónica con datos del cliente.'
      : 'Nota de venta para CONSUMIDOR FINAL. No requiere datos del cliente.');

  const chip = (active, label, sub, onClick) => h('button', {
    class: 'btn ' + (active ? 'btn-primary' : 'btn-outline'),
    style: {
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
      padding: '12px 14px', textAlign: 'left', minHeight: '64px',
    },
    onclick: onClick,
  },
    h('span', { style: { fontWeight: 700 } }, label),
    h('span', { style: { fontSize: '0.78rem', opacity: 0.85, marginTop: '2px' } }, sub),
  );

  return h('div', { style: { marginTop: '18px' } },
    h('div', { style: { fontSize: '0.85rem', fontWeight: 700, marginBottom: '8px', color: 'var(--ink-2)' } }, 'Tipo de comprobante'),
    h('div', { style: { display: 'flex', gap: '10px' } },
      chip(!ctx.facturaOn, 'Consumidor Final', 'Sin datos del cliente',
        () => { ctx.facturaOn = false; render(); }),
      chip(ctx.facturaOn, 'Factura Electrónica', 'Requiere cédula/RUC y email',
        () => { ctx.facturaOn = true; render(); }),
    ),
    h('div', { style: { fontSize: '0.78rem', color: 'var(--mute)', marginTop: '6px' } }, subtitle),
  );
}

function buildClienteForm() {
  const c = ctx.cliente;
  const wrap = h('div', { class: 'card card-pad', style: { background: 'var(--brand-50)', borderColor: '#fed7aa' } });
  wrap.appendChild(h('div', { style: { fontSize: '0.85rem', fontWeight: 700, marginBottom: '10px', color: 'var(--brand-600)' } }, 'Datos del cliente'));

  const tipoRow = h('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } });
  tipoRow.appendChild(tipoChip('N', 'Persona Natural (Cédula)'));
  tipoRow.appendChild(tipoChip('J', 'Persona Jurídica (RUC)'));
  wrap.appendChild(tipoRow);

  const grid = h('div', { class: 'fgrid' });
  grid.appendChild(field({
    label: c.tipo === 'J' ? 'Razón Social' : 'Nombre Completo', required: true, full: true,
    inputId: 'c-rs', value: c.razon_social, oninput: (e) => { c.razon_social = e.target.value; },
  }));
  if (c.tipo === 'N') {
    grid.appendChild(field({
      label: 'Cédula (10 dígitos)', required: true,
      inputId: 'c-ced', value: c.cedula, type: 'text', maxlength: '10',
      oninput: (e) => { c.cedula = e.target.value.replace(/\D/g, '').slice(0, 10); e.target.value = c.cedula; },
    }));
  } else {
    grid.appendChild(field({
      label: 'RUC (13 dígitos)', required: true,
      inputId: 'c-ruc', value: c.ruc, type: 'text', maxlength: '13',
      oninput: (e) => { c.ruc = e.target.value.replace(/\D/g, '').slice(0, 13); e.target.value = c.ruc; },
    }));
  }
  grid.appendChild(field({ label: 'Email', required: true, inputId: 'c-email', value: c.email, type: 'email', oninput: (e) => { c.email = e.target.value; } }));
  grid.appendChild(field({ label: 'Teléfono', hint: 'opcional', inputId: 'c-tel', value: c.telefonos, type: 'tel', oninput: (e) => { c.telefonos = e.target.value; } }));
  grid.appendChild(field({ label: 'Dirección', required: true, full: true, inputId: 'c-dir', value: c.direccion, oninput: (e) => { c.direccion = e.target.value; } }));
  wrap.appendChild(grid);
  return wrap;
}

function tipoChip(code, label) {
  const active = ctx.cliente.tipo === code;
  return h('button', {
    class: 'btn ' + (active ? 'btn-primary' : 'btn-outline') + ' btn-sm',
    style: { flex: 1 },
    onclick: () => { ctx.cliente.tipo = code; render(); },
  }, label);
}

function field({ label, required, full, hint, inputId, ...inputProps }) {
  const wrap = h('div', { class: 'field' + (full ? ' full' : '') });
  wrap.appendChild(h('label', { class: required ? 'required' : '', for: inputId }, label));
  wrap.appendChild(h('input', Object.assign({ class: 'input', id: inputId, autocomplete: 'off' }, inputProps)));
  if (hint) wrap.appendChild(h('div', { class: 'hint' }, hint));
  wrap.appendChild(h('div', { class: 'err', id: inputId + '-err', style: { display: 'none' } }));
  return wrap;
}

// ---- Validation + finalize ----
function validateClient() {
  if (!ctx.facturaOn) return {};
  const errors = {};
  const c = ctx.cliente;
  if (!c.razon_social.trim()) errors['c-rs'] = 'Requerido.';
  if (c.tipo === 'N' && !isCedula(c.cedula)) errors['c-ced'] = 'Cédula debe tener 10 dígitos.';
  if (c.tipo === 'J' && !isRuc(c.ruc)) errors['c-ruc'] = 'RUC debe tener 13 dígitos.';
  if (!isEmail(c.email)) errors['c-email'] = 'Email inválido.';
  if (!c.direccion.trim()) errors['c-dir'] = 'Requerido.';
  return errors;
}

function showErrors(errors) {
  ['c-rs', 'c-ced', 'c-ruc', 'c-email', 'c-dir'].forEach((id) => {
    const inp = document.getElementById(id);
    const err = document.getElementById(id + '-err');
    if (inp) inp.classList.toggle('error', !!errors[id]);
    if (err) { if (errors[id]) { err.textContent = errors[id]; err.style.display = 'block'; } else { err.style.display = 'none'; } }
  });
}

async function onAceptar(btn) {
  if (getSaldo() > 0) return;
  const errors = validateClient();
  showErrors(errors);
  if (Object.keys(errors).length) return toast('Revisa los datos del cliente', 'bad');

  await withLoading(btn, async () => {
    try {
      const cliente = ctx.facturaOn ? buildCliente() : { ...CONSUMIDOR_FINAL };
      const t = ctx.totales || {};
      const cobros = ctx.payments.map((p) => ({
        forma_cobro: p.method === 'OT' ? 'EF' : p.method,
        monto: round2(p.amount),
        ...(p.tip ? { propina: round2(p.tip) } : {}),
        ...(p.processor ? { procesador: p.processor } : {}),
        ...(p.detalle ? { detalle: p.detalle } : {}),
      }));
      const totalTip = getTip();
      const body = {
        fecha_emision: todayDDMMYYYY(),
        tipo_documento: 'FAC',
        tipo_registro: 'CLI',
        estado: 'C',
        electronico: !!ctx.facturaOn,
        descripcion: `Cobro ${ctx.mesa?.nombre || ''} (${cobros.length} pago${cobros.length === 1 ? '' : 's'})`,
        subtotal_0: Number(t.subtotal_0 || 0),
        subtotal_15: Number(t.subtotal_15 || 0),
        iva: Number(t.iva || 0),
        servicio: Number(t.servicio || 0),
        total: Number(t.total || ctx.total),
        ...(totalTip > 0 ? { propina: totalTip } : {}),
        orden_id: ctx.orden?.id,
        cliente, detalles: [], cobros,
      };
      const doc = await api.createDocumento(body);
      closeModal();
      showSuccess(doc);
      ctx.onSuccess && ctx.onSuccess(doc);
    } catch (err) {
      toast('Error al crear factura: ' + err.message, 'bad', 5000);
    }
  });
}

function buildCliente() {
  const c = ctx.cliente;
  return {
    cedula: c.tipo === 'N' ? c.cedula : '',
    ruc: c.tipo === 'J' ? c.ruc : (c.cedula ? c.cedula + '001' : ''),
    razon_social: c.razon_social.trim().toUpperCase(),
    tipo: c.tipo, email: c.email.trim(), telefonos: c.telefonos.trim(),
    direccion: c.direccion.trim(), es_extranjero: false,
  };
}

function showSuccess(doc) {
  // Mount a professional factura print region while the modal is open.
  installFacturaPrintRegion(doc);

  const body = h('div', { style: { textAlign: 'center', padding: '20px 0' } },
    h('div', { style: { fontSize: '3rem', lineHeight: 1, color: 'var(--ok)' } }, '✓'),
    h('h2', { style: { margin: '10px 0 4px', fontSize: '1.3rem' } }, 'Pago registrado'),
    h('p', { style: { color: 'var(--mute)', margin: 0 } }, `Factura ${doc.id ? '#' + String(doc.id).slice(0, 8) : ''} creada para ${ctx.mesa?.nombre || ''}`),
    h('div', { style: { marginTop: '12px', display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' } },
      ctx.payments.map((p) => h('span', { class: 'row-method', style: { fontSize: '0.78rem' } },
        (PAYMENT_METHODS.find((m) => m.code === p.method)?.label || p.method) + ' ' + money(p.amount)
      )),
    ),
    (doc.autorizacion_sri || doc.autorizacionSRI) ? h('div', { style: { marginTop: '14px', fontSize: '0.8rem', color: 'var(--mute)' } },
      'Autorización SRI: ', h('span', { style: { fontFamily: 'monospace' } }, String(doc.autorizacion_sri || doc.autorizacionSRI))) : null,
  );
  const clienteEmail = ctx.facturaOn ? (ctx.cliente.email || '').trim() : '';
  const footerButtons = [
    h('button', { class: 'btn btn-outline', onclick: () => window.print() }, 'Imprimir factura'),
  ];
  if (ctx.facturaOn && clienteEmail) {
    // STUB: backend email endpoint is not wired yet. Replace this with a real
    // POST /api/documentos/:id/email once the SRI mail flow is implemented.
    footerButtons.push(h('button', {
      class: 'btn btn-outline',
      onclick: () => toast('Enviado a ' + clienteEmail, 'ok'),
    }, '📧 Enviar al correo del cliente'));
  }
  footerButtons.push(h('button', { class: 'btn btn-primary', onclick: () => closeModal() }, 'Listo'));

  openModal({
    title: 'Cobro completado', body,
    footer: h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, ...footerButtons),
  });
}

function installFacturaPrintRegion(doc) {
  const existing = document.getElementById('factura-print');
  if (existing) existing.remove();

  const cliente = ctx.facturaOn ? buildCliente() : { razon_social: 'CONSUMIDOR FINAL', cedula: '9999999999', email: '', direccion: 'Ecuador', tipo: 'N' };
  const t = ctx.totales || {};
  const auth = doc.autorizacion_sri || doc.autorizacionSRI;
  const wrap = h('div', { class: 'print-only', id: 'factura-print' });

  // Header: restaurant identity, single block
  wrap.appendChild(h('div', { style: { textAlign: 'center', marginBottom: '8px' } },
    h('div', { style: { fontWeight: 800, fontSize: '1.25rem', letterSpacing: '0.05em' } }, RESTAURANT_INFO.razonSocial),
    h('div', { style: { fontSize: '0.78rem', color: '#444' } }, RESTAURANT_INFO.direccion),
    h('div', { style: { fontSize: '0.78rem', color: '#444' } }, 'Tel. ' + RESTAURANT_INFO.telefono + ' · R.U.C. ' + RESTAURANT_INFO.ruc),
  ));

  // Document type stamp
  wrap.appendChild(h('div', {
    style: { border: '2px solid #000', padding: '8px', margin: '10px 0', textAlign: 'center', fontWeight: 800, fontSize: '0.95rem', letterSpacing: '0.1em' },
  }, ctx.facturaOn ? 'FACTURA ELECTRÓNICA' : 'NOTA DE VENTA — CONSUMIDOR FINAL'));

  // Meta: two-column compact grid
  const metaRow = (label, value) => h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '2px 0' } },
    h('span', { style: { color: '#444' } }, label),
    h('span', { style: { fontWeight: 700 } }, value),
  );
  wrap.appendChild(h('div', { style: { marginBottom: '10px', borderBottom: '1px dashed #000', paddingBottom: '6px' } },
    metaRow('Documento', '#' + String(doc.id || '').slice(0, 12)),
    metaRow('Fecha', doc.fecha_emision || doc.fechaEmision || todayDDMMYYYY()),
    metaRow('Hora', formatDateTime()),
    metaRow('Mesa', ctx.mesa?.nombre || '—'),
    auth ? metaRow('Aut. SRI', String(auth).slice(0, 20)) : null,
  ));

  // Cliente — only render the rich block for facturas; CF gets a one-liner
  if (ctx.facturaOn) {
    wrap.appendChild(h('div', { style: { padding: '8px 0', fontSize: '0.85rem', marginBottom: '10px', borderBottom: '1px dashed #000' } },
      h('div', { style: { fontWeight: 700, marginBottom: '4px' } }, 'Cliente'),
      h('div', {}, cliente.razon_social),
      h('div', { style: { color: '#444' } }, (cliente.tipo === 'J' ? 'RUC: ' : 'C.I.: ') + (cliente.tipo === 'J' ? cliente.ruc : cliente.cedula)),
      cliente.email ? h('div', { style: { color: '#444' } }, cliente.email) : null,
      cliente.direccion ? h('div', { style: { color: '#444' } }, cliente.direccion) : null,
    ));
  } else {
    wrap.appendChild(h('div', { style: { padding: '6px 0', fontSize: '0.85rem', marginBottom: '10px', borderBottom: '1px dashed #000', textAlign: 'center', fontStyle: 'italic' } },
      'CONSUMIDOR FINAL',
    ));
  }

  // Items
  const detalles = ctx.orden?.detalles || [];
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
        h('span', {}, 'Subtotal IVA 0%'), h('span', {}, money(Number(t.subtotal_0) || 0))),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
        h('span', {}, 'Subtotal IVA 15%'), h('span', {}, money(Number(t.subtotal_15) || 0))),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
        h('span', {}, 'IVA 15%'), h('span', {}, money(t.iva))),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
        h('span', {}, 'Servicio 10%'), h('span', {}, money(t.servicio))),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #000', fontWeight: 800, fontSize: '1.05rem', marginTop: '4px' } },
        h('span', {}, 'TOTAL'), h('span', {}, money(t.total))),
    ),
  ));

  // Payment breakdown
  wrap.appendChild(h('div', { style: { marginTop: '14px', borderTop: '1px dashed #000', paddingTop: '8px' } },
    h('div', { style: { fontWeight: 700, marginBottom: '4px' } }, 'Forma de pago'),
    ...ctx.payments.map((p) => h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' } },
      h('span', {}, (PAYMENT_METHODS.find((m) => m.code === p.method)?.label || p.method) +
        (p.detalle ? ` — ${p.detalle}` : '') +
        (p.tip ? ` (propina ${money(p.tip)})` : '')),
      h('span', {}, money(p.amount)),
    )),
  ));

  wrap.appendChild(h('div', { style: { marginTop: '18px', textAlign: 'center', fontSize: '0.78rem', borderTop: '1px dashed #000', paddingTop: '8px' } },
    'Documento generado electrónicamente.',
    h('br'),
    'Gracias por su preferencia.',
  ));

  document.body.appendChild(wrap);
}
