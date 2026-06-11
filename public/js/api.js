// Thin client over the v1 REST API. All endpoints require Authorization: Token <key>.

const BASE = '/sistema/api/v1';

let apiKey = '';

export const setApiKey = (k) => { apiKey = (k || '').trim(); };
export const getApiKey = () => apiKey;

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Authorization': 'Token ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('session:expired'));
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const health = () => fetch(BASE + '/health/').then((r) => r.ok);

export const listMesas = () => request('/mesa/?result_size=100');
export const getMesa = (id) => request(`/mesa/${id}/`);
export const updateMesa = (id, patch) => request(`/mesa/${id}/`, { method: 'PATCH', body: patch });

export const listProductos = () => request('/producto/?result_size=200');

export const listOrdenes = (params = {}) => {
  const qs = new URLSearchParams({ result_size: '50', ...params }).toString();
  return request('/orden/?' + qs);
};
export const getOrden = (id) => request(`/orden/${id}/`);
export const createOrden = (body) => request('/orden/', { method: 'POST', body });
export const updateOrden = (id, patch) => request(`/orden/${id}/`, { method: 'PATCH', body: patch });
export const addDetalle = (ordenId, body) => request(`/orden/${ordenId}/detalle/`, { method: 'POST', body });
export const removeDetalle = (ordenId, detalleId) =>
  request(`/orden/${ordenId}/detalle/${detalleId}/`, { method: 'DELETE' });
export const totalesOrden = (id) => request(`/orden/${id}/totales/`);

export const createDocumento = (body) => request('/documento/', { method: 'POST', body });
export const listDocumentos = (params = {}) => {
  const qs = new URLSearchParams({ result_size: '100', ...params }).toString();
  return request('/documento/?' + qs);
};
export const getDocumento = (id) => request(`/documento/${id}/`);

// Find or open the active order on a mesa.
export async function getOrCreateOrden(mesa) {
  try {
    const detail = await getMesa(mesa.id);
    if (detail && detail.orden_activa) {
      const ord = detail.orden_activa;
      return ord.detalles ? ord : await getOrden(ord.id);
    }
  } catch (_) { /* fallthrough */ }

  const list = await listOrdenes({ mesa_id: mesa.id, estado: 'A' });
  const existing = (list && list.results || [])[0];
  if (existing) return existing.detalles ? existing : await getOrden(existing.id);

  const created = await createOrden({ mesa_id: mesa.id, descripcion: '', mesero: '' });
  return await getOrden(created.id);
}
export const guestLogin = () => request('/auth/guest', { method: 'POST' });
export const createMesa = (body) => request('/mesa/', { method: 'POST', body });
export const deleteMesa = (id) => request(`/mesa/${id}/`, { method: 'DELETE' });
export const createProducto = (body) => request('/producto/', { method: 'POST', body });
export const updateProducto = (id, body) => request(`/producto/${id}/`, { method: 'PATCH', body });
export const deleteProducto = (id) => request(`/producto/${id}/`, { method: 'DELETE' });
export const listCategorias = () => request('/producto/categoria/');
export const createCategoria = (body) => request('/producto/categoria/', { method: 'POST', body });
export const updateCategoria = (id, body) => request(`/producto/categoria/${id}/`, { method: 'PATCH', body });
export const deleteCategoria = (id) => request(`/producto/categoria/${id}/`, { method: 'DELETE' });
