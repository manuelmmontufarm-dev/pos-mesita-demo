// Bootstrap, hash router, header.
import {
  state,
  subscribe,
  loadApiKey,
  saveApiKey,
  checkConnection,
} from './state.js';
import { h, toast, openModal, closeModal } from './ui.js';
import { renderFloor } from './screens/floor.js';
import { renderPOS } from './screens/pos.js';
import { renderHistorial } from './screens/historial.js';
import { renderMesasConfig } from './screens/mesas-config.js';

const ROUTES = [
  { match: /^#\/mesa\/(.+)$/,   render: (root, m) => renderPOS(root, decodeURIComponent(m[1])) },
  { match: /^#\/mesas$/,        render: (root) => renderFloor(root) },
  { match: /^#\/historial$/,    render: (root) => renderHistorial(root) },
  { match: /^#\/mesas-config$/, render: (root) => renderMesasConfig(root) },
  { match: /^#?\/?$/,           render: () => { location.hash = '#/mesas'; } },
];

async function route() {
  const root = document.getElementById('view-root');
  const hash = location.hash || '#/mesas';
  for (const r of ROUTES) {
    const m = hash.match(r.match);
    if (m) return r.render(root, m);
  }
  location.hash = '#/mesas';
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
  nav.appendChild(navLink('#/mesas', '🍽️ Mesas'));
  nav.appendChild(navLink('#/historial', '🧾 Cuentas cerradas'));
  nav.appendChild(navLink('#/mesas-config', '🪑 Config mesas'));
  head.appendChild(nav);

  head.appendChild(h('div', { class: 'spacer' }));

  const okClass = state.connection === 'ok' ? 'ok' : state.connection === 'bad' ? 'bad' : '';
  const pill = h('button', {
    class: 'key-pill ' + okClass,
    onclick: openSettings,
    title: 'Configurar API key',
  },
    h('span', { class: 'dot' }),
    state.connection === 'ok' ? 'Conectado' : state.connection === 'bad' ? 'Sin conexión' : 'Conectando…',
  );
  head.appendChild(pill);
  head.appendChild(h('a', { class: 'btn btn-ghost btn-sm', href: '/sistema/api/v1/docs', target: '_blank' }, 'API Docs'));
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

async function start() {
  loadApiKey();
  subscribe(paintHeader);
  paintHeader();
  await checkConnection();
  if (state.connection !== 'ok') {
    toast('No se pudo conectar — verifica la API Key en el ícono superior derecho.', 'bad', 5000);
  }
  window.addEventListener('hashchange', () => { paintHeader(); route(); });
  route();
}

start();
