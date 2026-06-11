// Mesas & areas management screen
import * as api from '../api.js';
import { h, toast, withLoading, confirmDialog, openModal, closeModal } from '../ui.js';

let mesas = [];

export async function renderMesasConfig(root) {
  root.innerHTML = '';
  root.classList.remove('full');
  const crumbs = document.getElementById('crumbs');
  if (crumbs) crumbs.innerHTML = '<strong style="color:var(--ink)">Config. Mesas</strong>';
  const wrap = h('div', { class: 'mesas-cfg-wrap' });
  root.appendChild(wrap);
  wrap.appendChild(buildSkeleton());
  try { await reload(); } catch (err) {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'center-empty', style: { padding: '60px' } },
      h('div', { class: 'big' }, '⚠️'), h('div', {}, 'Error: ' + err.message)));
    return;
  }
  paint(wrap);
}

async function reload() {
  const result = await api.listMesas({ result_size: 200 });
  mesas = (result?.results || []).filter((m) => m.activa !== false);
}

function paint(wrap) {
  wrap.innerHTML = '';
  const areas = getAreas();
  wrap.appendChild(h('div', { class: 'mesas-cfg-header' },
    h('h2', { style: { margin: 0, fontWeight: 800 } }, 'Distribución de mesas'),
    h('button', { class: 'btn btn-primary btn-sm', onclick: () => openAreaModal(null, wrap) }, '+ Nueva área'),
  ));
  if (!areas.length) {
    wrap.appendChild(h('div', { class: 'center-empty', style: { padding: '60px' } },
      h('div', { class: 'big' }, '🪑'),
      h('div', { style: { fontWeight: 700 } }, 'No hay áreas configuradas'),
    ));
    return;
  }
  for (const area of areas) wrap.appendChild(buildAreaCard(area, wrap));
}

function getAreas() {
  const map = new Map();
  for (const m of mesas) {
    const key = m.ubicacion || 'Sin área';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return Array.from(map.entries()).map(([name, tables]) => ({ name, tables }));
}

function buildAreaCard(area, wrap) {
  return h('div', { class: 'mesas-area-card' },
    h('div', { class: 'mesas-area-header' },
      h('div', { class: 'mesas-area-name' }, area.name),
      h('div', { class: 'mesas-area-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openAreaModal(area, wrap) }, '✏️ Renombrar'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openAddMesaModal(area.name, wrap) }, '+ Mesa'),
      ),
    ),
    h('div', { class: 'mesas-grid' }, ...area.tables.map((m) => buildMesaCard(m, wrap))),
  );
}

function buildMesaCard(mesa, wrap) {
  return h('div', { class: 'mesa-cfg-card' },
    h('div', { class: 'mesa-cfg-icon' }, '🪑'),
    h('div', { class: 'mesa-cfg-name', onclick: () => openMesaModal(mesa, wrap) }, mesa.nombre),
    h('div', { class: 'mesa-cfg-meta' }, `Cap. ${mesa.capacidad || 4}`),
    h('div', { class: 'mesa-cfg-btns' },
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openMesaModal(mesa, wrap) }, '✏️'),
      h('button', { class: 'btn btn-ghost btn-sm danger-hover', onclick: async () => {
        const ok = await confirmDialog({ title: 'Eliminar mesa', message: `¿Eliminar "${mesa.nombre}"?`, danger: true, confirmText: 'Eliminar' });
        if (!ok) return;
        try { await api.deleteMesa(mesa.id); await reload(); paint(wrap); toast('Mesa eliminada', 'ok'); }
        catch (err) { toast('Error: ' + err.message, 'bad'); }
      }}, '🗑️'),
    ),
  );
}

function openMesaModal(mesa, wrap) {
  const areas = getAreas().map((a) => a.name);
  const nInp = fi('mesa-nombre', 'Nombre *', mesa.nombre);
  const cInp = fi('mesa-cap', 'Capacidad', String(mesa.capacidad || 4), 'number');
  const areaEl = h('select', { class: 'input' });
  for (const a of areas) { const o = h('option', { value: a }, a); if (a === mesa.ubicacion) o.selected = true; areaEl.appendChild(o); }
  const newArea = h('input', { class: 'input', placeholder: 'O escribe un área nueva…', style: { marginTop: '6px' } });
  openModal({ title: `Editar: ${mesa.nombre}`,
    body: h('div', { class: 'settings-grid' }, nInp, cInp,
      h('div', { class: 'field', style: { gridColumn: '1/-1' } }, h('label', {}, 'Área'), areaEl, newArea)),
    footer: h('div', { style: { display: 'flex', gap: '8px' } },
      h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: async (e) => {
        const nombre = nInp.querySelector('input').value.trim();
        if (!nombre) { toast('Nombre obligatorio.', 'bad'); return; }
        await withLoading(e.currentTarget, async () => {
          try {
            await api.updateMesa(mesa.id, { nombre, ubicacion: newArea.value.trim() || areaEl.value, capacidad: parseInt(cInp.querySelector('input').value) || 4 });
            closeModal(); await reload(); paint(wrap); toast('Mesa actualizada', 'ok');
          } catch (err) { toast('Error: ' + err.message, 'bad'); }
        });
      }}, 'Guardar'),
    ),
  });
}

function openAddMesaModal(areaName, wrap) {
  const areas = getAreas().map((a) => a.name);
  const n = mesas.filter((m) => m.ubicacion === areaName).length + 1;
  const nInp = fi('new-nombre', 'Nombre', `Mesa ${n}`);
  const cInp = fi('new-cap', 'Capacidad', '4', 'number');
  const areaEl = h('select', { class: 'input' });
  for (const a of areas) { const o = h('option', { value: a }, a); if (a === areaName) o.selected = true; areaEl.appendChild(o); }
  openModal({ title: `Nueva mesa en ${areaName}`,
    body: h('div', { class: 'settings-grid' }, nInp, cInp,
      h('div', { class: 'field', style: { gridColumn: '1/-1' } }, h('label', {}, 'Área'), areaEl)),
    footer: h('div', { style: { display: 'flex', gap: '8px' } },
      h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: async (e) => {
        const nombre = nInp.querySelector('input').value.trim();
        if (!nombre) { toast('Nombre obligatorio.', 'bad'); return; }
        await withLoading(e.currentTarget, async () => {
          try { await api.createMesa({ nombre, ubicacion: areaEl.value, capacidad: parseInt(cInp.querySelector('input').value) || 4 }); closeModal(); await reload(); paint(wrap); toast('Mesa creada', 'ok'); }
          catch (err) { toast('Error: ' + err.message, 'bad'); }
        });
      }}, 'Crear'),
    ),
  });
}

function openAreaModal(area, wrap) {
  const isNew = !area;
  const nInp = fi('area-nombre', 'Nombre del área *', area?.name || '');
  openModal({ title: isNew ? 'Nueva área' : `Renombrar: ${area.name}`,
    body: h('div', { class: 'settings-grid' }, nInp),
    footer: h('div', { style: { display: 'flex', gap: '8px' } },
      h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: async (e) => {
        const nombre = nInp.querySelector('input').value.trim();
        if (!nombre) { toast('Nombre obligatorio.', 'bad'); return; }
        await withLoading(e.currentTarget, async () => {
          try {
            if (isNew) { await api.createMesa({ nombre: 'Mesa 1', ubicacion: nombre, capacidad: 4 }); toast(`Área "${nombre}" creada`, 'ok'); }
            else { await Promise.all(area.tables.map((m) => api.updateMesa(m.id, { ubicacion: nombre }))); toast(`Renombrada a "${nombre}"`, 'ok'); }
            closeModal(); await reload(); paint(wrap);
          } catch (err) { toast('Error: ' + err.message, 'bad'); }
        });
      }}, isNew ? 'Crear' : 'Renombrar'),
    ),
  });
}

function fi(name, label, value = '', type = 'text') {
  return h('div', { class: 'field' }, h('label', { for: 'mc-' + name }, label), h('input', { class: 'input', id: 'mc-' + name, type, value }));
}

function buildSkeleton() {
  return h('div', { style: { padding: '20px' } },
    h('div', { class: 'skeleton', style: { height: '36px', width: '45%', marginBottom: '24px', borderRadius: '10px' } }),
    ...Array.from({ length: 2 }, () =>
      h('div', { class: 'mesas-area-card' },
        h('div', { class: 'skeleton', style: { height: '30px', marginBottom: '16px', borderRadius: '8px' } }),
        h('div', { class: 'mesas-grid' }, ...Array.from({ length: 4 }, () =>
          h('div', { class: 'skeleton', style: { height: '106px', borderRadius: '12px' } }))),
      )
    ),
  );
}
