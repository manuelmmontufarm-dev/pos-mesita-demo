import * as api from '../api.js';
import { state, saveSession, updateRestaurantLocal } from '../state.js';
import { h, toast, withLoading } from '../ui.js';

let mode = 'login';

export function renderAuth(root, onAuthenticated) {
  root.classList.remove('full');
  root.innerHTML = '';

  const card = h('section', { class: 'auth-card' },
    h('div', { class: 'auth-brand' },
      h('div', { class: 'brand-mark auth-mark', 'aria-hidden': 'true' }, '🍽️'),
      h('div', {},
        h('h1', {}, mode === 'login' ? 'Entrar a POS Mesita' : 'Crear restaurante'),
        h('p', {}, mode === 'login'
          ? 'Inicia sesion para ver las mesas y cuentas de tu restaurante.'
          : 'Crea la cuenta del dueno y la base de datos aislada del restaurante.'),
      ),
    ),
    h('div', { class: 'auth-tabs' },
      tabButton('login', 'Iniciar sesion', () => { mode = 'login'; renderAuth(root, onAuthenticated); }),
      tabButton('register', 'Crear cuenta', () => { mode = 'register'; renderAuth(root, onAuthenticated); }),
    ),
    mode === 'login' ? loginForm(onAuthenticated) : registerForm(onAuthenticated),
    guestButton(onAuthenticated),
  );

  root.appendChild(h('div', { class: 'auth-page' }, card));
}

export function renderSetup(root, onCompleted) {
  root.classList.remove('full');
  root.innerHTML = '';

  let areas = [
    { name: 'Salon', count: 6 },
    { name: 'Terraza', count: 4 },
  ];

  const seedMenu = h('input', { type: 'checkbox', checked: 'checked' });
  const areasContainer = h('div', { class: 'areas-list' });

  function renderAreas() {
    areasContainer.innerHTML = '';
    areas.forEach((area, index) => {
      const nameInput = h('input', {
        class: 'input',
        value: area.name,
        placeholder: 'Nombre del area',
        oninput: (e) => { areas[index].name = e.target.value; },
      });
      const countInput = h('input', {
        class: 'input',
        type: 'number',
        min: '1',
        max: '40',
        value: String(area.count),
        oninput: (e) => { areas[index].count = parseInt(e.target.value, 10) || 1; },
      });
      areasContainer.appendChild(h('div', { class: 'area-row' },
        h('div', { class: 'area-fields' },
          h('div', { class: 'field', style: { flex: 1 } },
            h('label', {}, 'Area'),
            nameInput,
          ),
          h('div', { class: 'field field-sm' },
            h('label', {}, 'Mesas'),
            countInput,
          ),
        ),
        h('button', {
          class: 'btn btn-ghost btn-sm',
          style: { color: 'var(--bad)', alignSelf: 'flex-end', marginBottom: '2px' },
          title: 'Eliminar area',
          onclick: () => {
            areas.splice(index, 1);
            renderAreas();
          },
        }, 'x'),
      ));
    });
  }
  renderAreas();

  const card = h('section', { class: 'auth-card setup-card' },
    h('div', { class: 'auth-brand' },
      h('div', { class: 'brand-mark auth-mark', 'aria-hidden': 'true' }, '🍽️'),
      h('div', {},
        h('h1', {}, state.restaurant?.name || 'Configurar restaurante'),
        h('p', {}, 'Define tus areas y cuantas mesas tiene cada una.'),
      ),
    ),
    h('div', { style: { marginBottom: '16px' } },
      h('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '10px' },
      },
        h('strong', {}, 'Areas y mesas'),
        h('button', {
          class: 'btn btn-ghost btn-sm',
          onclick: () => {
            areas.push({ name: '', count: 4 });
            renderAreas();
          },
        }, '+ Agregar area'),
      ),
      areasContainer,
    ),
    h('label', { class: 'check-row', style: { marginBottom: '16px' } },
      seedMenu,
      h('span', {}, 'Crear un menu base editable'),
    ),
    h('button', {
      class: 'btn btn-primary btn-lg',
      onclick: async (e) => {
        const validAreas = areas
          .map((area) => ({ name: area.name.trim(), count: Math.max(1, parseInt(area.count, 10) || 1) }))
          .filter((area) => area.name);
        if (!validAreas.length) {
          toast('Agrega al menos un area con nombre y mesas.', 'bad');
          return;
        }
        await withLoading(e.currentTarget, async () => {
          try {
            const restaurant = await api.completeRestaurantSetup({
              areas: validAreas,
              seed_menu: seedMenu.checked,
            });
            updateRestaurantLocal(restaurant);
            toast('Restaurante listo', 'ok');
            onCompleted && onCompleted();
          } catch (err) {
            toast(err.message || 'No se pudo completar el setup', 'bad', 5000);
          }
        });
      },
    }, 'Entrar al POS'),
  );

  root.appendChild(h('div', { class: 'auth-page' }, card));
}

function tabButton(tab, label, onclick) {
  return h('button', {
    class: 'auth-tab' + (mode === tab ? ' active' : ''),
    onclick,
  }, label);
}

function loginForm(onAuthenticated) {
  const email = input('email', 'Email', 'email');
  const password = input('password', 'Contrasena', 'password');
  return h('form', {
    class: 'auth-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      await withLoading(btn, async () => {
        try {
          const session = await api.login({
            email: email.querySelector('input').value,
            password: password.querySelector('input').value,
          });
          saveSession(session);
          toast('Bienvenido', 'ok');
          onAuthenticated && onAuthenticated();
        } catch (err) {
          toast(err.message || 'No se pudo iniciar sesion', 'bad', 5000);
        }
      });
    },
  },
    email,
    password,
    h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Entrar'),
  );
}

function registerForm(onAuthenticated) {
  const ownerName = input('owner_name', 'Nombre del dueno');
  const email = input('email', 'Email del dueno', 'email');
  const password = input('password', 'Contrasena', 'password');
  const restaurantName = input('restaurant_name', 'Nombre del restaurante');
  const legalName = input('legal_name', 'Razon social');
  const ruc = input('ruc', 'RUC');
  const address = input('address', 'Direccion');
  const city = input('city', 'Ciudad');
  const phone = input('phone', 'Telefono');
  const restaurantEmail = input('restaurant_email', 'Email del restaurante', 'email');

  return h('form', {
    class: 'auth-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      await withLoading(btn, async () => {
        try {
          const session = await api.register(values([
            ownerName, email, password, restaurantName, legalName,
            ruc, address, city, phone, restaurantEmail,
          ]));
          saveSession(session);
          toast('Cuenta creada', 'ok');
          onAuthenticated && onAuthenticated();
        } catch (err) {
          toast(err.message || 'No se pudo crear la cuenta', 'bad', 5000);
        }
      });
    },
  },
    h('div', { class: 'auth-grid' },
      ownerName,
      email,
      password,
      restaurantName,
      legalName,
      ruc,
      address,
      city,
      phone,
      restaurantEmail,
    ),
    h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Crear cuenta'),
  );
}

function guestButton(onAuthenticated) {
  return h('div', { class: 'legacy-demo', style: { flexDirection: 'column', gap: '8px' } },
    h('div', { style: { textAlign: 'center', color: 'var(--mute)', fontSize: '0.82rem', margin: '4px 0' } }, 'o'),
    h('button', {
      class: 'btn btn-outline btn-lg',
      style: { width: '100%' },
      onclick: async (e) => {
        await withLoading(e.currentTarget, async () => {
          try {
            const session = await api.guestLogin();
            saveSession(session);
            toast('Entraste al demo', 'ok');
            onAuthenticated && onAuthenticated();
          } catch (err) {
            toast(err.message || 'No se pudo entrar al demo', 'bad', 5000);
          }
        });
      },
    }, '🔍 Continuar como invitado'),
    h('div', { style: { textAlign: 'center', color: 'var(--mute)', fontSize: '0.78rem' } },
      'Acceso al restaurante demo sin registrarte.'),
  );
}

function input(name, label, type = 'text') {
  return h('div', { class: 'field' },
    h('label', { for: name }, label),
    h('input', { class: 'input', id: name, name, type, autocomplete: type === 'password' ? 'new-password' : 'off' }),
  );
}

function values(fields) {
  const data = {};
  for (const field of fields) {
    const inputEl = field.querySelector('input');
    data[inputEl.name] = inputEl.value.trim();
  }
  return data;
}
