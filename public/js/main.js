// Bootstrap, hash router, header.
import * as api from './api.js';
import {
  state,
  subscribe,
  loadAuth,
  saveApiKey,
  checkConnection,
  refreshAuth,
  clearSession,
  loadRestaurantSettings,
  updateRestaurantLocal,
} from './state.js';
import { h, toast, openModal, closeModal } from './ui.js';
import { renderAuth, renderSetup } from './screens/auth.js';
import { renderFloor } from './screens/floor.js';
import { renderPOS } from './screens/pos.js';
import { renderHistorial } from './screens/historial.js';
import { renderMenu } from './screens/menu.js';
import { renderMesasConfig } from './screens/mesas-config.js';

const ROUTES = [
  { match: /^#\/mesa\/(.+)$/,    render: (root, m) => renderPOS(root, decodeURIComponent(m[1])) },
  { match: /^#\/mesas$/,         render: (root) => renderFloor(root) },
  { match: /^#\/historial$/,     render: (root) => renderHistorial(root) },
  { match: /^#\/menu$/,          render: (root) => renderMenu(root) },
  { match: /^#\/mesas-config$/,  render: (root) => renderMesasConfig(root) },
  { match: /^#?\/?$/,            render: () => { location.hash = '#/mesas'; } },
];

async function route() {
  const root = document.getElementById('view-root');
  if (needsAuth()) return renderAuth(root, onAuthenticated);
  if (needsSetup()) return renderSetup(root, () => {
    location.hash = '#/mesas';
    route();
  });

  const hash = location.hash || '#/mesas';
  for (const r of ROUTES) {
    const m = hash.match(r.match);
    if (m) return r.render(root, m);
  }
  location.hash = '#/mesas';
}

function needsAuth() {
  return !state.sessionToken && state.connection !== 'ok';
}

function needsSetup() {
  return state.sessionToken && state.restaurant && state.restaurant.setup_completed === false;
}

async function onAuthenticated() {
  await checkConnection();
  if (state.sessionToken) {
    try { await loadRestaurantSettings(); } catch (_) {}
  }
  if (!location.hash || location.hash === '#/') location.hash = '#/mesas';
  route();
}

function paintHeader() {
  const head = document.getElementById('app-header');
  head.innerHTML = '';
  head.appendChild(h('div', { class: 'brand' },
    h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, '🍽️'),
    h('div', {},
      h('div', {}, 'POS Mesita'),
      h('div', { id: 'crumbs', class: 'crumbs' }, ''),
    ),
  ));

  const nav = h('nav', { style: { display: 'flex', gap: '6px', marginLeft: '16px' } });
  if (!needsAuth() && !needsSetup()) {
    nav.appendChild(navLink('#/mesas',        '🍽️ Mesas'));
    nav.appendChild(navLink('#/historial',    '🧾 Cuentas cerradas'));
    nav.appendChild(navLink('#/mesas-config', '🪑 Config mesas'));
    nav.appendChild(navLink('#/menu',         '📋 Menú'));
    head.appendChild(nav);
  }

  head.appendChild(h('div', { class: 'spacer' }));

  const okClass = state.connection === 'ok' ? 'ok' : state.connection === 'bad' ? 'bad' : '';
  const pill = h('button', {
    class: 'key-pill ' + okClass,
    onclick: openSettings,
    title: state.sessionToken ? 'Configurar restaurante' : 'Configurar API key',
  },
    h('span', { class: 'dot' }),
    state.sessionToken
      ? (state.restaurant?.name || 'Restaurante')
      : (state.connection === 'ok' ? 'Conectado' : state.connection === 'bad' ? 'Sin conexión' : 'Conectando…'),
  );
  head.appendChild(pill);

  if (state.sessionToken) {
    head.appendChild(h('button', { class: 'btn btn-ghost btn-sm', onclick: handleLogout }, 'Salir'));
  } else {
    head.appendChild(h('a', { class: 'btn btn-ghost btn-sm', href: '/sistema/api/v1/docs', target: '_blank' }, 'API Docs'));
  }
}

function navLink(hash, label) {
  const active = (location.hash || '#/mesas').startsWith(hash);
  return h('a', {
    href: hash,
    class: 'btn ' + (active ? 'btn-primary' : 'btn-ghost') + ' btn-sm',
    style: { textDecoration: 'none' },
  }, label);
}

function openSettings() {
  if (state.sessionToken) return openRestaurantSettings();

  const current = state.apiKey;
  const input = h('input', { class: 'input', value: current, placeholder: 'API Key' });
  openModal({
    title: 'Configuración',
    body: h('div', {},
      h('div', { class: 'field' },
        h('label', {}, 'API Key'),
        input,
        h('div', { class: 'hint' }, 'Se usa para autenticar todas las peticiones.'),
      ),
    ),
    footer: h('div', { style: { display: 'flex', gap: '8px' } },
      h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        saveApiKey(input.value);
        await checkConnection();
        closeModal();
        toast(state.connection === 'ok' ? 'Conexión verificada' : 'No se pudo conectar', state.connection === 'ok' ? 'ok' : 'bad');
        route();
      }}, 'Guardar'),
    ),
  });
  setTimeout(() => input.focus(), 50);
}

function openRestaurantSettings() {
  const r = state.restaurant || {};
  const name           = settingInput('name',          'Nombre comercial',    r.name || '');
  const legalName      = settingInput('legal_name',    'Razón social',        r.legal_name || '');
  const ruc            = settingInput('ruc',           'RUC',                 r.ruc || '');
  const address        = settingInput('address',       'Dirección',           r.address || '');
  const city           = settingInput('city',          'Ciudad',              r.city || '');
  const phone          = settingInput('phone',         'Teléfono',            r.phone || '');
  const email          = settingInput('email',         'Email',               r.email || '', 'email');
  const serviceToggle  = h('input', { type: 'checkbox', checked: r.service_charge_enabled === false ? null : 'checked' });

  openModal({
    title: 'Configuración del restaurante',
    body: h('div', {},
      h('div', { class: 'settings-grid' }, name, legalName, ruc, address, city, phone, email),
      h('label', { class: 'toggle-row setting-toggle' },
        h('div', {},
          h('div', { class: 'tt' }, 'Incluir 10% servicio'),
          h('div', { class: 'ts' }, 'Afecta totales, cobro y prefactura.'),
        ),
        h('span', { class: 'switch' }, serviceToggle, h('span', { class: 'slider' })),
      ),
    ),
    footer: h('div', { style: { display: 'flex', gap: '8px' } },
      h('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: async (e) => {
        await withSettingsLoading(e.currentTarget, async () => {
          try {
            const updated = await api.updateRestaurantSettings({
              name:                    inputValue(name),
              legal_name:              inputValue(legalName),
              ruc:                     inputValue(ruc),
              address:                 inputValue(address),
              city:                    inputValue(city),
              phone:                   inputValue(phone),
              email:                   inputValue(email),
              service_charge_enabled:  serviceToggle.checked,
            });
            updateRestaurantLocal(updated);
            closeModal();
            toast('Configuración guardada', 'ok');
            route();
          } catch (err) {
            toast(err.message || 'No se pudo guardar', 'bad', 5000);
          }
        });
      }}, 'Guardar'),
    ),
  });
}

function settingInput(name, label, value, type = 'text') {
  return h('div', { class: 'field' },
    h('label', { for: 'set-' + name }, label),
    h('input', { class: 'input', id: 'set-' + name, name, type, value }),
  );
}
function inputValue(field) { return field.querySelector('input').value.trim(); }

async function withSettingsLoading(btn, fn) {
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Guardando...';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = original; }
}

async function handleLogout() {
  try { await api.logout(); } catch (_) {}
  clearSession();
  location.hash = '';
  route();
}

// Global 401 handler — any expired/revoked session redirects to login
window.addEventListener('session:expired', () => {
  clearSession();
  location.hash = '#/';
  route();
});

async function start() {
  loadAuth();
  subscribe(paintHeader);
  paintHeader();
  if (state.sessionToken) {
    try { await refreshAuth(); } catch (_) { clearSession(); }
  }
  await checkConnection();
  if (state.connection === 'ok') await loadRestaurantSettings();
  window.addEventListener('hashchange', () => { paintHeader(); route(); });
  route();
}

start();
