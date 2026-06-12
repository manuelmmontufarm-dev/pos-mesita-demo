// In-memory app state with localStorage-backed API key.
import * as api from './api.js';
import { RESTAURANT_INFO } from './format.js';

const KEY_STORAGE = 'pos-mesita-api-key';
const SESSION_STORAGE = 'pos-mesita-session';
const DEFAULT_KEY = '';

export const state = {
  apiKey: '',
  sessionToken: '',
  user: null,
  restaurant: null,
  role: null,
  connection: 'idle', // 'idle' | 'ok' | 'bad' | 'checking'
  mesas: [],
  productos: [],
  categorias: [],
  current: { mesa: null, orden: null, totales: null },
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const notify = () => listeners.forEach((fn) => fn(state));

export function loadApiKey() {
  const k = localStorage.getItem(KEY_STORAGE) || DEFAULT_KEY;
  state.apiKey = k;
  api.setApiKey(k);
  return k;
}

export function loadAuth() {
  loadApiKey();
  const raw = localStorage.getItem(SESSION_STORAGE);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (session?.token) {
      saveSession(session, { notifyChange: false });
      return session;
    }
  } catch (_) {
    localStorage.removeItem(SESSION_STORAGE);
  }
  return null;
}

export function saveApiKey(k) {
  state.apiKey = (k || '').trim();
  localStorage.setItem(KEY_STORAGE, state.apiKey);
  api.setApiKey(state.apiKey);
  notify();
}

export function saveSession(session, opts = {}) {
  state.sessionToken = session?.token || '';
  state.user = session?.user || state.user || null;
  state.restaurant = session?.restaurant || state.restaurant || null;
  state.role = session?.role || state.role || null;
  api.setSessionToken(state.sessionToken);
  if (session?.token) localStorage.setItem(SESSION_STORAGE, JSON.stringify(session));
  applyRestaurantInfo(state.restaurant);
  if (opts.notifyChange !== false) notify();
}

export function setAuthContext(auth, opts = {}) {
  state.user = auth?.user || null;
  state.restaurant = auth?.restaurant || null;
  state.role = auth?.role || null;
  applyRestaurantInfo(state.restaurant);
  if (opts.notifyChange !== false) notify();
}

export function clearSession() {
  state.sessionToken = '';
  state.user = null;
  state.restaurant = null;
  state.role = null;
  localStorage.removeItem(SESSION_STORAGE);
  api.setSessionToken('');
  notify();
}

export async function refreshAuth() {
  if (!state.sessionToken) return null;
  const auth = await api.me();
  setAuthContext(auth, { notifyChange: false });
  const saved = JSON.parse(localStorage.getItem(SESSION_STORAGE) || '{}');
  localStorage.setItem(SESSION_STORAGE, JSON.stringify({
    ...saved,
    user: auth.user,
    restaurant: auth.restaurant,
    role: auth.role,
  }));
  return auth;
}

export async function checkConnection() {
  state.connection = 'checking';
  notify();
  try { await api.listMesas(); state.connection = 'ok'; }
  catch (_) { state.connection = 'bad'; }
  notify();
}

export async function loadFloor() {
  await loadRestaurantSettings();
  const [m, p] = await Promise.all([api.listMesas(), api.listProductos()]);
  state.mesas = (m && m.results) || [];
  state.productos = (p && p.results) || [];
  const seen = new Map();
  for (const prod of state.productos) {
    const id = prod.categoria_id || prod.categoriaId || 'sin-categoria';
    const nombre = (prod.categoria && prod.categoria.nombre) || prod.categoria_nombre || labelFromId(id);
    if (!seen.has(id)) seen.set(id, { id, nombre });
  }
  state.categorias = [...seen.values()];
  notify();
}

export async function loadRestaurantSettings() {
  if (!state.sessionToken && !state.apiKey) return null;
  try {
    const restaurant = await api.getRestaurantSettings();
    state.restaurant = restaurant;
    applyRestaurantInfo(restaurant);
    notify();
    return restaurant;
  } catch (_) {
    return state.restaurant;
  }
}

export function updateRestaurantLocal(restaurant) {
  state.restaurant = restaurant;
  applyRestaurantInfo(restaurant);
  notify();
}

function labelFromId(id) {
  if (!id) return 'Otros';
  return id.replace(/^cat-/, '').replace(/^\w/, (c) => c.toUpperCase());
}

export async function openMesa(mesaId) {
  const mesa = state.mesas.find((m) => m.id === mesaId);
  if (!mesa) throw new Error('Mesa no encontrada');
  state.current.mesa = mesa;
  state.current.orden = await api.getOrCreateOrden(mesa);
  await refreshTotales();
  if (mesa.estado === 'L') {
    try { await api.updateMesa(mesa.id, { estado: 'O' }); mesa.estado = 'O'; } catch (_) {}
  }
  notify();
}

export async function refreshOrden() {
  if (!state.current.orden) return;
  state.current.orden = await api.getOrden(state.current.orden.id);
  await refreshTotales();
  notify();
}

export async function refreshTotales() {
  if (!state.current.orden) { state.current.totales = null; return; }
  try { state.current.totales = await api.totalesOrden(state.current.orden.id); }
  catch (_) { state.current.totales = null; }
}

export function getCurrentTotal() {
  const t = state.current.totales;
  return t ? Number(t.total || 0) : 0;
}

export function clearCurrent() {
  state.current = { mesa: null, orden: null, totales: null };
  // Do NOT notify() — callers that clear are usually leaving the screen
  // and a notification here would re-trigger stale subscribers.
}

function applyRestaurantInfo(restaurant) {
  if (!restaurant) return;
  RESTAURANT_INFO.razonSocial = restaurant.legal_name || restaurant.name || RESTAURANT_INFO.razonSocial;
  RESTAURANT_INFO.nombreComercial = restaurant.name || restaurant.legal_name || RESTAURANT_INFO.nombreComercial || RESTAURANT_INFO.razonSocial;
  RESTAURANT_INFO.ruc = restaurant.ruc || RESTAURANT_INFO.ruc;
  RESTAURANT_INFO.direccion = [restaurant.address, restaurant.city].filter(Boolean).join(', ') || RESTAURANT_INFO.direccion;
  RESTAURANT_INFO.telefono = restaurant.phone || RESTAURANT_INFO.telefono;
  RESTAURANT_INFO.email = restaurant.email || RESTAURANT_INFO.email;
}
