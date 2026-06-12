// Menu management screen — CRUD for products and categories
import * as api from '../api.js';
import { h, toast, withLoading, confirmDialog, openModal, closeModal } from '../ui.js';
import { money, productIcon } from '../format.js';

let activeCategory = null; // null = all
let categorias = [];
let productos = [];

export async function renderMenu(root) {
  root.innerHTML = '';
  root.classList.remove('full');

  const crumbs = document.getElementById('crumbs');
  if (crumbs) crumbs.innerHTML = '<strong style="color:var(--ink)">Menú</strong>';

  const layout = h('div', { class: 'menu-mgmt' });
  root.appendChild(layout);
  layout.appendChild(skeletonMenu());

  try {
    await loadData();
  } catch (err) {
    layout.innerHTML = '';
    layout.appendChild(h('div', { class: 'center-empty' },
      h('div', { class: 'big' }, '⚠️'),
      h('div', {}, 'Error al cargar: ' + err.message),
    ));
    return;
  }

  paint(layout);
}

async function loadData() {
  const [cats, prods] = await Promise.all([api.listCategorias(), api.listProductos()]);
  categorias = Array.isArray(cats) ? cats : (cats?.results || []);
  productos = prods?.results || [];
}

function paint(layout) {
  layout.innerHTML = '';

  // ── Sidebar ──────────────────────────────────────────────────────────────
  const sidebar = h('div', { class: 'menu-sidebar' });
  sidebar.appendChild(h('div', { class: 'menu-sidebar-head' }, 'CATEGORÍAS'));

  sidebar.appendChild(h('button', {
    class: 'cat-sidebar-btn' + (activeCategory === null ? ' active' : ''),
    onclick: () => { activeCategory = null; paint(layout); },
  }, '🍽️ Todas'));

  for (const cat of categorias) {
    const btn = h('div', { class: 'cat-sidebar-btn-wrap' },
      h('button', {
        class: 'cat-sidebar-btn' + (activeCategory === cat.id ? ' active' : ''),
        style: { flex: 1 },
        onclick: () => { activeCategory = cat.id; paint(layout); },
      }, cat.nombre),
      h('button', {
        class: 'cat-edit-btn',
        title: 'Editar categoría',
        onclick: (e) => { e.stopPropagation(); openEditCatModal(cat, layout); },
      }, '✏️'),
    );
    sidebar.appendChild(btn);
  }

  sidebar.appendChild(h('button', {
    class: 'btn btn-ghost btn-sm',
    style: { margin: '10px 4px 0', width: 'calc(100% - 8px)' },
    onclick: () => openEditCatModal(null, layout),
  }, '+ Nueva categoría'));

  // ── Products panel ────────────────────────────────────────────────────────
  const panel = h('div', { class: 'menu-panel' });
  const catName = activeCategory === null
    ? 'Todos los productos'
    : (categorias.find((c) => c.id === activeCategory)?.nombre || 'Categoría');

  panel.appendChild(h('div', { class: 'menu-panel-head' },
    h('h2', { style: { margin: 0, fontWeight: 800 } }, catName),
    h('button', {
      class: 'btn btn-primary btn-sm',
      onclick: () => openEditProductoModal(null, layout),
    }, '+ Nuevo producto'),
  ));

  const filtered = activeCategory === null
    ? productos
    : productos.filter((p) => (p.categoria_id || p.categoriaId) === activeCategory);

  if (filtered.length === 0) {
    panel.appendChild(h('div', { class: 'center-empty', style: { padding: '60px 20px' } },
      h('div', { class: 'big' }, '🍳'),
      h('div', { style: { fontWeight: 700 } }, 'No hay productos aquí'),
      h('div', { style: { fontSize: '0.9rem', marginTop: '6px' } }, 'Usa el botón "+ Nuevo producto" para agregar.'),
    ));
  } else {
    const list = h('div', { class: 'prod-mgmt-list' });
    for (const p of filtered) list.appendChild(buildProductRow(p, layout));
    panel.appendChild(list);
  }

  layout.appendChild(sidebar);
  layout.appendChild(panel);
}

function buildProductRow(p, layout) {
  const catLabel = p.categoria
    ? p.categoria.nombre
    : (categorias.find((c) => c.id === (p.categoria_id || p.categoriaId))?.nombre || '—');

  return h('div', { class: 'prod-mgmt-row' + (p.disponible ? '' : ' unavailable') },
    h('div', { class: 'prow-icon' }, productIcon(p)),
    h('div', { class: 'prow-info' },
      h('div', { class: 'prow-name' }, p.nombre),
      h('div', { class: 'prow-meta' },
        catLabel + (p.descripcion ? ' · ' + p.descripcion : ''),
      ),
    ),
    h('div', { class: 'prow-price' }, money(p.precio)),
    h('div', { class: 'prow-actions' },
      h('button', {
        class: 'btn btn-ghost btn-sm',
        title: p.disponible ? 'Desactivar' : 'Activar',
        onclick: async (e) => {
          await withLoading(e.currentTarget, async () => {
            try {
              await api.updateProducto(p.id, { disponible: !p.disponible });
              await loadData(); paint(layout);
            } catch (err) { toast('Error: ' + err.message, 'bad'); }
          });
        },
      }, p.disponible ? '✅' : '⭕'),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        title: 'Editar',
        onclick: () => openEditProductoModal(p, layout),
      }, '✏️'),
      h('button', {
        class: 'btn btn-ghost btn-sm danger-hover',
        title: 'Eliminar',
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Eliminar producto',
            message: `¿Eliminar "${p.nombre}"? Las órdenes existentes no se verán afectadas.`,
            danger: true, confirmText: 'Eliminar',
          });
          if (!ok) return;
          try {
            await api.deleteProducto(p.id);
            await loadData(); paint(layout);
            toast('Producto eliminado', 'ok');
          } catch (err) { toast('Error: ' + err.message, 'bad'); }
        },
      }, '🗑️'),
    ),
  );
}

function openEditProductoModal(prod, layout) {
  const isNew = !prod;
  const nombreInp = fi('nombre', 'Nombre *', prod?.nombre || '');
  const precioInp = fi('precio', 'Precio *', prod?.precio ? String(prod.precio) : '', 'number');
  const descInp = fi('descripcion', 'Descripción', prod?.descripcion || '');
  const codigoInp = fi('codigo', 'Código', prod?.codigo || '');

  const catSel = h('select', { class: 'input' });
  catSel.appendChild(h('option', { value: '' }, '— Sin categoría —'));
  for (const cat of categorias) {
    const opt = h('option', { value: cat.id }, cat.nombre);
    if ((prod?.categoria_id || prod?.categoriaId) === cat.id) opt.selected = true;
    catSel.appendChild(opt);
  }

  const ivaSel = h('select', { class: 'input' });
  for (const v of [0, 5, 15]) {
    const opt = h('option', { value: String(v) }, `IVA ${v}%`);
    if ((prod?.porcentaje_iva ?? prod?.porcentajeIva ?? 15) === v) opt.selected = true;
    ivaSel.appendChild(opt);
  }

  const dispChk = h('input', { type: 'checkbox' });
  if (prod?.disponible !== false) dispChk.checked = true;

  const body = h('div', { class: 'settings-grid' },
    nombreInp, precioInp, descInp, codigoInp,
    h('div', { class: 'field' }, h('label', {}, 'Categoría'), catSel),
    h('div', { class: 'field' }, h('label', {}, 'IVA'), ivaSel),
    h('label', { class: 'check-row', style: { gridColumn: '1/-1' } },
      dispChk, h('span', {}, 'Disponible en órdenes'),
    ),
  );

  const footer = h('div', { style: { display: 'flex', gap: '8px' } },
    h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
    h('button', { class: 'btn btn-primary', onclick: async (e) => {
      const nombreVal = nombreInp.querySelector('input').value.trim();
      const precioVal = parseFloat(precioInp.querySelector('input').value);
      if (!nombreVal) { toast('El nombre es obligatorio.', 'bad'); return; }
      if (isNaN(precioVal) || precioVal < 0) { toast('Precio inválido.', 'bad'); return; }
      const data = {
        nombre: nombreVal, precio: precioVal,
        descripcion: descInp.querySelector('input').value.trim() || null,
        codigo: codigoInp.querySelector('input').value.trim() || null,
        categoria_id: catSel.value || null,
        porcentaje_iva: parseInt(ivaSel.value, 10),
        disponible: dispChk.checked,
      };
      await withLoading(e.currentTarget, async () => {
        try {
          if (isNew) { await api.createProducto(data); toast('Producto creado', 'ok'); }
          else { await api.updateProducto(prod.id, data); toast('Producto actualizado', 'ok'); }
          closeModal();
          await loadData(); paint(layout);
        } catch (err) { toast('Error: ' + err.message, 'bad'); }
      });
    }}, isNew ? 'Crear' : 'Guardar'),
  );

  openModal({ title: isNew ? 'Nuevo producto' : `Editar: ${prod.nombre}`, body, footer });
}

function openEditCatModal(cat, layout) {
  const isNew = !cat;
  const nombreInp = fi('cat-nombre', 'Nombre *', cat?.nombre || '');
  const ordenInp = fi('cat-orden', 'Orden', cat?.orden !== undefined ? String(cat.orden) : '0', 'number');

  const body = h('div', { class: 'settings-grid' }, nombreInp, ordenInp);

  const footer = h('div', { style: { display: 'flex', gap: '8px' } },
    h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
    isNew ? null : h('button', {
      class: 'btn btn-ghost',
      style: { color: 'var(--bad)', marginRight: 'auto' },
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Eliminar categoría',
          message: `¿Eliminar "${cat.nombre}"? Los productos quedarán sin categoría.`,
          danger: true, confirmText: 'Eliminar',
        });
        if (!ok) return;
        try {
          await api.deleteCategoria(cat.id);
          closeModal();
          activeCategory = null;
          await loadData(); paint(layout);
          toast('Categoría eliminada', 'ok');
        } catch (err) { toast('Error: ' + err.message, 'bad'); }
      },
    }, '🗑️ Eliminar'),
    h('button', { class: 'btn btn-primary', onclick: async (e) => {
      const nombreVal = nombreInp.querySelector('input').value.trim();
      if (!nombreVal) { toast('El nombre es obligatorio.', 'bad'); return; }
      const data = { nombre: nombreVal, orden: parseInt(ordenInp.querySelector('input').value, 10) || 0 };
      await withLoading(e.currentTarget, async () => {
        try {
          if (isNew) { await api.createCategoria(data); toast('Categoría creada', 'ok'); }
          else { await api.updateCategoria(cat.id, data); toast('Categoría actualizada', 'ok'); }
          closeModal();
          await loadData(); paint(layout);
        } catch (err) { toast('Error: ' + err.message, 'bad'); }
      });
    }}, isNew ? 'Crear' : 'Guardar'),
  );

  openModal({ title: isNew ? 'Nueva categoría' : `Editar: ${cat.nombre}`, body, footer });
}

function fi(name, label, value = '', type = 'text') {
  return h('div', { class: 'field' },
    h('label', { for: 'menu-' + name }, label),
    h('input', { class: 'input', id: 'menu-' + name, type, value }),
  );
}

function skeletonMenu() {
  return h('div', { class: 'menu-mgmt' },
    h('div', { class: 'menu-sidebar' },
      ...Array.from({ length: 5 }, () =>
        h('div', { class: 'skeleton', style: { height: '36px', marginBottom: '8px', borderRadius: '10px' } }),
      ),
    ),
    h('div', { class: 'menu-panel' },
      h('div', { class: 'skeleton', style: { height: '38px', marginBottom: '20px', width: '50%' } }),
      ...Array.from({ length: 6 }, () =>
        h('div', { class: 'skeleton', style: { height: '62px', marginBottom: '8px', borderRadius: '10px' } }),
      ),
    ),
  );
}
