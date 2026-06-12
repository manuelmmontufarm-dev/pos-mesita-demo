// Mesas & areas management screen.
import * as api from '../api.js';
import { h, toast, withLoading, confirmDialog, openModal, closeModal } from '../ui.js';

let mesas = [];
let activeArea = 'all';

export async function renderMesasConfig(root) {
  root.innerHTML = '';
  root.classList.remove('full');

  const crumbs = document.getElementById('crumbs');
  if (crumbs) crumbs.innerHTML = '<strong style="color:var(--ink)">Config. mesas</strong>';

  const wrap = h('div', { class: 'mesas-cfg-wrap' });
  root.appendChild(wrap);
  wrap.appendChild(buildSkeleton());

  try {
    await reload();
    paint(wrap);
  } catch (err) {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'center-empty' },
      h('div', { class: 'big' }, '⚠️'),
      h('div', { style: { fontWeight: 700 } }, 'No se pudieron cargar las mesas'),
      h('div', { style: { fontSize: '0.9rem', marginTop: '6px' } }, err.message),
    ));
  }
}

async function reload() {
  const result = await api.listMesas({ result_size: 300 });
  mesas = (result?.results || [])
    .filter((m) => m.activa !== false)
    .sort(compareMesa);

  const areas = getAreas();
  if (activeArea !== 'all' && !areas.some((area) => area.name === activeArea)) activeArea = 'all';
}

function paint(wrap) {
  wrap.innerHTML = '';
  const areas = getAreas();
  const selectedAreas = activeArea === 'all' ? areas : areas.filter((area) => area.name === activeArea);
  const tableCount = mesas.length;
  const capacity = mesas.reduce((sum, mesa) => sum + (Number(mesa.capacidad) || 0), 0);

  wrap.appendChild(h('div', { class: 'management-header' },
    h('div', {},
      h('h1', {}, 'Mesas y areas'),
      h('p', {}, 'Organiza el mapa del restaurante, mueve mesas y ajusta capacidades.'),
    ),
    h('div', { class: 'management-actions' },
      h('button', { class: 'btn btn-outline btn-sm', onclick: () => openBulkAddModal(activeArea === 'all' ? '' : activeArea, wrap) }, '+ Varias mesas'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => openAreaModal(null, wrap) }, '+ Nueva area'),
    ),
  ));

  wrap.appendChild(h('div', { class: 'summary-strip' },
    summaryPill('Areas', String(areas.length)),
    summaryPill('Mesas', String(tableCount)),
    summaryPill('Capacidad', String(capacity)),
  ));

  if (!areas.length) {
    wrap.appendChild(h('div', { class: 'center-empty mesas-empty' },
      h('div', { class: 'big' }, '🪑'),
      h('div', { style: { fontWeight: 800, color: 'var(--ink)' } }, 'Aun no hay mesas'),
      h('div', {}, 'Crea un area y define cuantas mesas quieres iniciar.'),
      h('button', { class: 'btn btn-primary', style: { marginTop: '14px' }, onclick: () => openAreaModal(null, wrap) }, '+ Crear area'),
    ));
    return;
  }

  const layout = h('div', { class: 'mesas-workspace' },
    buildAreaRail(areas, wrap),
    h('div', { class: 'mesas-area-stack' }, selectedAreas.map((area) => buildAreaSection(area, wrap))),
  );
  wrap.appendChild(layout);
}

function buildAreaRail(areas, wrap) {
  const rail = h('aside', { class: 'mesas-area-rail' },
    h('div', { class: 'rail-title' }, 'Areas'),
    areaButton({ name: 'all', label: 'Todas', tables: mesas }, wrap),
  );
  for (const area of areas) rail.appendChild(areaButton(area, wrap));
  return rail;
}

function areaButton(area, wrap) {
  const name = area.name;
  const tables = area.tables || [];
  const capacity = tables.reduce((sum, mesa) => sum + (Number(mesa.capacidad) || 0), 0);
  const label = area.label || name;
  return h('button', {
    class: 'area-nav-btn' + (activeArea === name ? ' active' : ''),
    onclick: () => {
      activeArea = name;
      paint(wrap);
    },
  },
    h('span', { class: 'area-nav-name' }, label),
    h('span', { class: 'area-nav-meta' }, `${tables.length} mesas · cap. ${capacity}`),
  );
}

function buildAreaSection(area, wrap) {
  return h('section', { class: 'mesas-area-section' },
    h('div', { class: 'mesas-area-head' },
      h('div', {},
        h('h2', {}, area.name),
        h('p', {}, `${area.tables.length} mesas · capacidad ${area.capacity}`),
      ),
      h('div', { class: 'management-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openAreaModal(area, wrap) }, 'Renombrar'),
        h('button', { class: 'btn btn-outline btn-sm', onclick: () => openBulkAddModal(area.name, wrap) }, '+ Varias'),
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => openTableModal(null, area.name, wrap) }, '+ Mesa'),
      ),
    ),
    h('div', { class: 'mesas-config-grid' },
      area.tables.map((mesa) => buildMesaTile(mesa, wrap)),
      h('button', { class: 'mesa-add-tile', onclick: () => openTableModal(null, area.name, wrap) },
        h('span', { class: 'mesa-add-plus' }, '+'),
        h('span', {}, 'Agregar mesa'),
      ),
    ),
  );
}

function buildMesaTile(mesa, wrap) {
  return h('div', {
    class: 'mesa-cfg-tile',
    role: 'button',
    tabindex: '0',
    onclick: () => openTableModal(mesa, mesa.ubicacion || 'Sin area', wrap),
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTableModal(mesa, mesa.ubicacion || 'Sin area', wrap);
      }
    },
  },
    h('div', { class: 'mesa-tile-top' },
      h('span', { class: 'mesa-status ' + String(mesa.estado || 'L').toLowerCase() }, statusLabel(mesa.estado)),
      h('span', { class: 'mesa-capacity' }, `Cap. ${mesa.capacidad || 4}`),
    ),
    h('div', { class: 'mesa-tile-name' }, mesa.nombre || 'Mesa'),
    h('div', { class: 'mesa-tile-area' }, mesa.ubicacion || 'Sin area'),
    h('div', { class: 'mesa-tile-actions' },
      h('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: (e) => {
          e.stopPropagation();
          openTableModal(mesa, mesa.ubicacion || 'Sin area', wrap);
        },
      }, 'Editar'),
      h('button', {
        class: 'btn btn-ghost btn-sm danger-hover',
        onclick: async (e) => {
          e.stopPropagation();
          await deleteMesa(mesa, wrap);
        },
      }, 'Eliminar'),
    ),
  );
}

function getAreas() {
  const map = new Map();
  for (const mesa of mesas) {
    const name = mesa.ubicacion || 'Sin area';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(mesa);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
    .map(([name, tables]) => ({
      name,
      tables,
      capacity: tables.reduce((sum, mesa) => sum + (Number(mesa.capacidad) || 0), 0),
    }));
}

function openTableModal(mesa, defaultArea, wrap) {
  const isNew = !mesa;
  const areaNames = getAreas().map((area) => area.name);
  const chosenArea = defaultArea || areaNames[0] || 'Salon';
  const name = field('mesa-name', 'Nombre de la mesa', mesa?.nombre || nextMesaName(chosenArea));
  const capacity = field('mesa-capacity', 'Capacidad', String(mesa?.capacidad || 4), 'number');
  const areaSelect = areaSelectField(chosenArea, areaNames);
  const newArea = h('input', { class: 'input', placeholder: 'O escribe una nueva area' });

  openModal({
    title: isNew ? 'Nueva mesa' : `Editar ${mesa.nombre}`,
    body: h('div', { class: 'settings-grid' },
      name,
      capacity,
      h('div', { class: 'field', style: { gridColumn: '1/-1' } },
        h('label', {}, 'Area'),
        areaSelect,
        newArea,
      ),
    ),
    footer: h('div', { class: 'modal-actions' },
      h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: async (e) => {
        const nombre = inputValue(name);
        if (!nombre) {
          toast('El nombre de la mesa es obligatorio.', 'bad');
          return;
        }
        const data = {
          nombre,
          capacidad: clampNumber(inputValue(capacity), 1, 40, 4),
          ubicacion: newArea.value.trim() || areaSelect.value || null,
        };
        await withLoading(e.currentTarget, async () => {
          try {
            if (isNew) await api.createMesa(data);
            else await api.updateMesa(mesa.id, data);
            closeModal();
            await reload();
            activeArea = data.ubicacion || 'all';
            paint(wrap);
            toast(isNew ? 'Mesa creada' : 'Mesa actualizada', 'ok');
          } catch (err) {
            toast('Error: ' + err.message, 'bad');
          }
        });
      } }, isNew ? 'Crear mesa' : 'Guardar'),
    ),
  });
}

function openBulkAddModal(defaultArea, wrap) {
  const areaNames = getAreas().map((area) => area.name);
  const targetArea = defaultArea || areaNames[0] || 'Salon';
  const areaSelect = areaSelectField(targetArea, areaNames);
  const newArea = h('input', { class: 'input', placeholder: 'O escribe una nueva area' });
  const count = field('bulk-count', 'Cantidad de mesas', '4', 'number');
  const start = field('bulk-start', 'Numero inicial', String(nextMesaNumber(targetArea)), 'number');
  const prefix = field('bulk-prefix', 'Prefijo', 'Mesa');
  const capacity = field('bulk-capacity', 'Capacidad', '4', 'number');

  openModal({
    title: 'Agregar varias mesas',
    body: h('div', { class: 'settings-grid' },
      h('div', { class: 'field', style: { gridColumn: '1/-1' } },
        h('label', {}, 'Area'),
        areaSelect,
        newArea,
      ),
      count,
      start,
      prefix,
      capacity,
    ),
    footer: h('div', { class: 'modal-actions' },
      h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: async (e) => {
        const areaName = newArea.value.trim() || areaSelect.value || 'Salon';
        const total = clampNumber(inputValue(count), 1, 40, 1);
        const first = clampNumber(inputValue(start), 1, 999, 1);
        const label = inputValue(prefix) || 'Mesa';
        const cap = clampNumber(inputValue(capacity), 1, 40, 4);
        await withLoading(e.currentTarget, async () => {
          try {
            for (let i = 0; i < total; i += 1) {
              await api.createMesa({
                nombre: `${label} ${first + i}`,
                ubicacion: areaName,
                capacidad: cap,
              });
            }
            closeModal();
            await reload();
            activeArea = areaName;
            paint(wrap);
            toast(`${total} mesas creadas`, 'ok');
          } catch (err) {
            toast('Error: ' + err.message, 'bad', 5000);
          }
        });
      } }, 'Crear mesas'),
    ),
  });
}

function openAreaModal(area, wrap) {
  const isNew = !area;
  const name = field('area-name', 'Nombre del area', area?.name || '');
  const count = isNew ? field('area-count', 'Mesas iniciales', '4', 'number') : null;
  const capacity = isNew ? field('area-capacity', 'Capacidad por mesa', '4', 'number') : null;

  openModal({
    title: isNew ? 'Nueva area' : `Renombrar ${area.name}`,
    body: h('div', { class: 'settings-grid' }, name, count, capacity),
    footer: h('div', { class: 'modal-actions' },
      h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: async (e) => {
        const areaName = inputValue(name);
        if (!areaName) {
          toast('El nombre del area es obligatorio.', 'bad');
          return;
        }
        await withLoading(e.currentTarget, async () => {
          try {
            if (isNew) {
              const total = clampNumber(inputValue(count), 1, 40, 1);
              const cap = clampNumber(inputValue(capacity), 1, 40, 4);
              for (let i = 1; i <= total; i += 1) {
                await api.createMesa({ nombre: `Mesa ${i}`, ubicacion: areaName, capacidad: cap });
              }
              toast(`Area "${areaName}" creada`, 'ok');
            } else {
              await Promise.all(area.tables.map((mesa) => api.updateMesa(mesa.id, { ubicacion: areaName })));
              toast(`Area renombrada a "${areaName}"`, 'ok');
            }
            closeModal();
            await reload();
            activeArea = areaName;
            paint(wrap);
          } catch (err) {
            toast('Error: ' + err.message, 'bad', 5000);
          }
        });
      } }, isNew ? 'Crear area' : 'Renombrar'),
    ),
  });
}

async function deleteMesa(mesa, wrap) {
  const ok = await confirmDialog({
    title: 'Eliminar mesa',
    message: `Eliminar "${mesa.nombre}" la quitara del mapa del restaurante.`,
    danger: true,
    confirmText: 'Eliminar',
  });
  if (!ok) return;

  try {
    await api.deleteMesa(mesa.id);
    await reload();
    paint(wrap);
    toast('Mesa eliminada', 'ok');
  } catch (err) {
    toast('Error: ' + err.message, 'bad');
  }
}

function field(name, label, value = '', type = 'text') {
  return h('div', { class: 'field' },
    h('label', { for: 'mc-' + name }, label),
    h('input', { class: 'input', id: 'mc-' + name, type, value, min: type === 'number' ? '1' : null }),
  );
}

function areaSelectField(value, areaNames) {
  const select = h('select', { class: 'input' });
  if (!areaNames.length) areaNames = [value || 'Salon'];
  for (const areaName of areaNames) {
    const option = h('option', { value: areaName }, areaName);
    if (areaName === value) option.selected = true;
    select.appendChild(option);
  }
  return select;
}

function inputValue(fieldNode) {
  return fieldNode.querySelector('input').value.trim();
}

function nextMesaName(areaName) {
  return `Mesa ${nextMesaNumber(areaName)}`;
}

function nextMesaNumber(areaName) {
  const nums = mesas
    .filter((mesa) => !areaName || mesa.ubicacion === areaName)
    .map((mesa) => String(mesa.nombre || '').match(/(\d+)$/)?.[1])
    .filter(Boolean)
    .map((n) => parseInt(n, 10));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function clampNumber(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function summaryPill(label, value) {
  return h('div', { class: 'summary-pill' },
    h('span', {}, label),
    h('strong', {}, value),
  );
}

function statusLabel(status) {
  if (status === 'O') return 'Ocupada';
  if (status === 'P') return 'Pagando';
  if (status === 'C') return 'Cerrada';
  return 'Libre';
}

function compareMesa(a, b) {
  const areaCompare = String(a.ubicacion || '').localeCompare(String(b.ubicacion || ''), 'es', { numeric: true });
  if (areaCompare) return areaCompare;
  return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { numeric: true });
}

function buildSkeleton() {
  return h('div', { class: 'mesas-skeleton' },
    h('div', { class: 'skeleton', style: { height: '42px', width: '48%', marginBottom: '18px' } }),
    h('div', { class: 'summary-strip' },
      ...Array.from({ length: 3 }, () => h('div', { class: 'skeleton', style: { height: '64px', borderRadius: '10px' } })),
    ),
    h('div', { class: 'mesas-workspace' },
      h('div', { class: 'mesas-area-rail' },
        ...Array.from({ length: 4 }, () => h('div', { class: 'skeleton', style: { height: '52px', marginBottom: '8px' } })),
      ),
      h('div', { class: 'mesas-area-section' },
        h('div', { class: 'skeleton', style: { height: '36px', marginBottom: '16px' } }),
        h('div', { class: 'mesas-config-grid' },
          ...Array.from({ length: 6 }, () => h('div', { class: 'skeleton', style: { height: '142px' } })),
        ),
      ),
    ),
  );
}
