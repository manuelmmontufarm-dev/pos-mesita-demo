import * as api from '../api.js';
import { state, saveSession, updateRestaurantLocal, saveApiKey, checkConnection } from '../state.js';
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
      tabButton('login', 'Sign in', () => { mode = 'login'; renderAuth(root, onAuthenticated); }),
      tabButton('register', 'Crear cuenta', () => { mode = 'register'; renderAuth(root, onAuthenticated); }),
    ),
    mode === 'login' ? loginForm(onAuthenticated) : registerForm(onAuthenticated),
    legacyDemoButton(onAuthenticated),
  );

  root.appendChild(h('div', { class: 'auth-page' }, card));
}

export function renderSetup(root, onCompleted) {
  root.classList.remove('full');
  root.innerHTML = '';

  const mesaCount = h('input', { class: 'input', type: 'number', min: '1', max: '80', value: '10' });
  const seedMenu = h('input', { type: 'checkbox', checked: 'checked' });

  const card = h('section', { class: 'auth-card setup-card' },
    h('div', { class: 'auth-brand' },
      h('div', { class: 'brand-mark auth-mark', 'aria-hidden': 'true' }, '🍽️'),
      h('div', {},
        h('h1', {}, state.restaurant?.name || 'Configurar restaurante'),
        h('p', {}, 'Prepara las mesas iniciales y un menu base para empezar a vender.'),
      ),
    ),
    h('div', { class: 'field' },
      h('label', {}, 'Numero de mesas iniciales'),
      mesaCount,
    ),
    h('label', { class: 'check-row' },
      seedMenu,
      h('span', {}, 'Crear un menu base editable'),
    ),
    h('button', {
      class: 'btn btn-primary btn-lg',
      onclick: async (e) => {
        await withLoading(e.currentTarget, async () => {
          try {
            const restaurant = await api.completeRestaurantSetup({
              mesa_count: Number(mesaCount.value || 10),
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

function legacyDemoButton(onAuthenticated) {
  return h('div', { class: 'legacy-demo' },
    h('button', {
      class: 'btn btn-ghost',
      onclick: async (e) => {
        await withLoading(e.currentTarget, async () => {
          if (!state.apiKey) {
            toast('Primero configura una API key desde el modo demo.', 'bad');
            return;
          }
          saveApiKey(state.apiKey);
          await checkConnection();
          if (state.connection === 'ok') {
            toast('Entraste al Demo Restaurant', 'ok');
            onAuthenticated && onAuthenticated();
          } else {
            toast('No se pudo entrar al demo con API key', 'bad');
          }
        });
      },
    }, 'Usar API key guardada'),
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
