// Thin client over the v1 REST API.

const BASE = '/sistema/api/v1';

let apiKey = '';
let sessionToken = '';

export const setApiKey = (k) => { apiKey = (k || '').trim(); };
export const getApiKey = () => apiKey;
export const setSessionToken = (token) => { sessionToken = (token || '').trim(); };
export const getSessionToken = () => sessionToken;

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers.Authorization = 'Bearer ' + sessionToken;
  else headers.Authorization = 'Token ' + apiKey;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const health = () => fetch(BASE + '/health/').then((r) => r.ok);

export const login = (body) => request('/auth/login', { method: 'POST', body });
export const register = (body) => request('/auth/register', { method: 'POST', body });
export const guestLogin = () => request('/auth/guest', { method: 'POST' });
export const logout = () => request('/auth/logout', { method: 'POST' });
export const me = () => request('/auth/me');

export const getRestaurantSettings = () => request('/restaurant/settings');
export const updateRestaurantSettings = (body) => request('/restaurant/settings', { method: 'PATCH', body });
export const completeRestaurantSetup = (body) => request('/restaurant/setup', { method: 'POST', body });

export const listMesas = (params = {}) => {
  const qs = new URLSearchParams({ result_size: '100', ...params }).toString();
  return request('/mesa/?' + qs);
};
export const getMesa = (id) => request(`/mesa/${id}/`);
export const createMesa = (body) => request('/mesa/', { method: 'POST', body });
export const updateMesa = (id, patch) => request(`/mesa/${id}/`, { method: 'PATCH', body: patch });
export const deleteMesa = (id) => request(`/mesa/${id}/`, { method: 'DELETE' });

export const listProductos = (params = {}) => {
  const qs = new URLSearchParams({ result_size: '200', ...params }).toString();
  return request('/producto/?' + qs);
};
export const createProducto = (body) => request('/producto/', { method: 'POST', body });
export const updateProducto = (id, patch) => request(`/producto/${id}/`, { method: 'PATCH', body: patch });
export const deleteProducto = (id) => request(`/producto/${id}/`, { method: 'DELETE' });
export const listCategorias = () => request('/producto/categoria/');
export const createCategoria = (body) => request('/producto/categoria/', { method: 'POST', body });
export const updateCategoria = (id, patch) => request(`/producto/categoria/${id}/`, { method: 'PATCH', body: patch });
export const deleteCategoria = (id) => request(`/producto/categoria/${id}/`, { method: 'DELETE' });

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
