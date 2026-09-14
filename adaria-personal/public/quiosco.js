'use strict';

// Adaria Personal — Quiosco de autofichaje (FASE 2).
// Pantalla táctil para tablet de recepción: el empleado se identifica por
// PIN (teclado numérico) o por QR (lector de código de barras/QR conectado
// como teclado: escribe el token y pulsa Enter) y ficha él mismo.
// No hay login de admin aquí; la puerta es la cookie/clave del quiosco,
// ya validada por el servidor antes de servir esta página.
//
// FASE 5 — Motivación: tras confirmar el fichaje se muestra el mensaje del
// día (por departamento) y, si procede, cumpleaños/aniversario de HOY
// (propio o de un/a compañero/a). Si el quiosco queda en reposo (nadie
// fichando) se muestra en bucle una "cartelera" con esos mismos avisos.
// PRIVACIDAD: aquí nunca se pinta edad ni fecha de nacimiento de nadie.

const app = document.getElementById('app');
const BASE = window.BASE_PATH || '';
const PROP = window.__PROPERTY__ || { nombre: 'Gestión de Personal', icono: '👥', colores: {} };

if (PROP.colores) {
  const root = document.documentElement.style;
  if (PROP.colores.primario) root.setProperty('--od', PROP.colores.primario);
  if (PROP.colores.acento_medio) root.setProperty('--om', PROP.colores.acento_medio);
  if (PROP.colores.acento_claro) root.setProperty('--ol', PROP.colores.acento_claro);
  if (PROP.colores.terracota) root.setProperty('--tc', PROP.colores.terracota);
}

let pin = '';
let qrBuffer = '';
let qrTimer = null;
let quitarCapturaQR = null; // cleanup del listener de montarCapturaQR (evita acumularlos)

// ─── FASE 5 — Reposo / cartelera: cuando el teclado lleva un rato sin uso
// se muestra en bucle el mensaje del día + cumpleaños/aniversarios de hoy.
// Cualquier toque o tecla vuelve al teclado. Solo se arma mientras se está
// en la vista de teclado (pin en espera), nunca durante una identificación.
const IDLE_MS = 25000;
const CARTEL_ROTACION_MS = 7000;
let idleTimer = null;
let cartelInterval = null;

function armarIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(mostrarCartelera, IDLE_MS);
}
function pararIdleTimer() {
  clearTimeout(idleTimer);
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(BASE + url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error inesperado');
  return data;
}

function horaBonita(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Lector QR: input invisible siempre enfocado que captura lo que
// escriba un lector de código de barras/QR (se comporta como un teclado
// que teclea el token muy rápido y termina con Enter). No usa cámara. ───
function montarCapturaQR(onToken) {
  let input = document.getElementById('qrCapture');
  if (!input) {
    input = document.createElement('input');
    input.id = 'qrCapture';
    input.autocomplete = 'off';
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.top = '-100px';
    input.style.left = '0';
    document.body.appendChild(input);
  }
  input.value = '';
  const reenfocar = () => { try { input.focus({ preventScroll: true }); } catch (e) {} };
  reenfocar();
  document.addEventListener('click', reenfocar);
  input.oninput = () => {
    clearTimeout(qrTimer);
    qrTimer = setTimeout(() => { input.value = ''; }, 800); // si se corta a medias, se olvida
  };
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      const token = input.value.trim();
      input.value = '';
      if (token.length >= 8) onToken(token);
    }
  };
  return () => { document.removeEventListener('click', reenfocar); };
}

// ─── Vista: teclado numérico ───
function vistaTeclado(mensaje) {
  clearInterval(cartelInterval);
  pin = '';
  app.innerHTML = `
    <div class="k-brand"><span class="ic">${PROP.icono || '👥'}</span>${esc(PROP.nombre)}</div>
    <div class="k-sub">Ficha con tu PIN</div>
    ${mensaje ? `<div class="k-err">${esc(mensaje)}</div>` : ''}
    <div class="k-dots" id="kDots"></div>
    <div class="k-pad">
      <button data-d="1">1</button><button data-d="2">2</button><button data-d="3">3</button>
      <button data-d="4">4</button><button data-d="5">5</button><button data-d="6">6</button>
      <button data-d="7">7</button><button data-d="8">8</button><button data-d="9">9</button>
      <button class="wide borrar" id="kBorrar">⌫</button><button data-d="0">0</button><button class="wide" id="kOk">OK</button>
    </div>
    <div class="k-hint">O pasa tu tarjeta/QR por el lector</div>
  `;
  renderDots();
  document.querySelectorAll('.k-pad button[data-d]').forEach((b) => {
    b.addEventListener('click', () => {
      armarIdleTimer();
      if (pin.length >= 6) return;
      pin += b.dataset.d;
      renderDots();
      if (pin.length >= 4) document.getElementById('kOk').classList.add('wide');
    });
  });
  document.getElementById('kBorrar').addEventListener('click', () => { armarIdleTimer(); pin = pin.slice(0, -1); renderDots(); });
  document.getElementById('kOk').addEventListener('click', () => { pararIdleTimer(); intentarPin(); });

  if (quitarCapturaQR) quitarCapturaQR();
  quitarCapturaQR = montarCapturaQR((token) => { pararIdleTimer(); intentarQR(token); });

  armarIdleTimer(); // en reposo (sin tocar nada) pasa a la cartelera
}

function renderDots() {
  const cont = document.getElementById('kDots');
  if (!cont) return;
  const n = Math.max(pin.length, 4);
  cont.innerHTML = Array.from({ length: n }).map((_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('');
}

async function intentarPin() {
  if (pin.length < 4) return;
  try {
    const emp = await api('POST', '/api/quiosco/identificar', { pin });
    vistaEmpleado(emp, 'quiosco');
  } catch (e) {
    vistaTeclado(e.message);
  }
}

async function intentarQR(token) {
  try {
    const emp = await api('GET', '/api/quiosco/qr/' + encodeURIComponent(token));
    vistaEmpleado(emp, 'qr');
  } catch (e) {
    vistaTeclado(e.message);
  }
}

// ─── Vista: empleado identificado, botones de acción según su estado ───
function vistaEmpleado(emp, origen) {
  app.innerHTML = `
    <div class="k-emp-nombre">${esc(emp.nombre)} ${esc(emp.apellidos)}</div>
    <div class="k-emp-estado">Estado actual: ${esc(emp.estado_texto)}</div>
    <div class="k-acciones" id="kAcciones"></div>
    <button class="k-cancelar" id="kCancelar">No soy yo / Cancelar</button>
  `;
  const cont = document.getElementById('kAcciones');
  if (!emp.acciones.length) {
    cont.innerHTML = '<div class="k-err">No hay ninguna acción disponible ahora mismo</div>';
  } else {
    cont.innerHTML = emp.acciones.map((a) => `<button data-tipo="${a.tipo}" class="${a.tipo === 'salida' ? 'salida' : ''}">${esc(a.texto)}</button>`).join('');
    cont.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => fichar(emp.empleado_id, b.dataset.tipo, origen));
    });
  }
  document.getElementById('kCancelar').addEventListener('click', () => vistaTeclado());
}

async function fichar(empleadoId, tipo, origen) {
  try {
    const r = await api('POST', '/api/quiosco/fichar', { empleado_id: empleadoId, tipo, origen });
    vistaConfirmacion(r);
  } catch (e) {
    vistaTeclado(e.message);
  }
}

const ETIQUETA = { entrada: 'Entrada registrada', salida: 'Salida registrada', pausa_inicio: 'Pausa iniciada', pausa_fin: 'Pausa finalizada' };

// ─── Función saludoPorHora: retorna el saludo según la hora actual ───
function saludoPorHora(nombre) {
  const now = new Date();
  const hora = now.getHours();
  let saludo = '';

  if (hora >= 6 && hora < 14) {
    saludo = `Buenos días, ${esc(nombre)}`;
  } else if (hora >= 14 && hora < 21) {
    saludo = `Buenas tardes, ${esc(nombre)}`;
  } else {
    saludo = `Buenas noches, ${esc(nombre)}`;
  }

  return saludo;
}

// ─── Frases motivacionales aleatorias ───
const FRASES_MOTIVACIONALES = [
  '¡Un nuevo día, nuevas oportunidades!',
  'Tu esfuerzo hoy es tu éxito mañana.',
  '¡Sigue adelante con energía!',
  'Cada fichaje es un paso hacia tus metas.',
  '¡Que tengas un excelente día!',
  'Tu dedicación marca la diferencia.',
  '¡Contagia tu energía al equipo!',
  'Hoy es un buen día para ser extraordinario.'
];

function getMotivacion() {
  return FRASES_MOTIVACIONALES[Math.floor(Math.random() * FRASES_MOTIVACIONALES.length)];
}

function vistaConfirmacion(r) {
  const saludo = saludoPorHora(r.nombre);
  const motivacion = getMotivacion();
  const mot = r.motivacion || {};
  const bloques = [];

  app.innerHTML = `
    <div class="k-confirm-merged">
      <div class="tick">✅</div>
      <div class="tipo">${esc(ETIQUETA[r.tipo] || 'Fichaje registrado')}</div>
      <div class="hora">${horaBonita(r.ts)}</div>
      <div class="saludo">${saludo}</div>
      <div class="motivacion">${motivacion}</div>
      <div class="persona-footer">${esc(r.nombre)} ${esc(r.apellidos)} · ${esc(r.estado_texto)}</div>
    </div>
  `;

  setTimeout(() => vistaTeclado(), 4000);
}

// ─── FASE 5 (DEPRECATED) — Motivación legacy: antes se mostraba después con
// delay. Ahora se integra en vistaConfirmacion. Se deja como comentario para referencia.
// function vistaMotivacion(r) {
//   const mot = r.motivacion || {};
//   const bloques = [];
//   // ... (código anteriormente usado)
// }

// ─── FASE 5 — Pantalla de reposo ("cartelera"): en bucle, sin identificar a
// nadie. Muestra los avisos de hoy (cumpleaños/aniversarios, sin edad) y un
// mensaje motivacional global. Cualquier toque o tecla vuelve al teclado.
// Si no hay nada que mostrar, se queda en el teclado (no fuerza la cartelera).
async function mostrarCartelera() {
  pararIdleTimer();
  let items = [];
  try {
    const data = await api('GET', '/api/quiosco/cartelera');
    items = itemsCartelera(data);
  } catch (e) {
    items = [];
  }
  if (!items.length) { armarIdleTimer(); return; } // nada que contar: seguimos en el teclado

  let idx = 0;
  const pintar = () => {
    const it = items[idx];
    app.innerHTML = `
      <div class="k-cartel">
        <div class="k-cartel-brand"><span class="ic">${PROP.icono || '👥'}</span>${esc(PROP.nombre)}</div>
        <div class="k-cartel-icono">${it.icono}</div>
        <div class="k-cartel-texto">${it.texto}</div>
        <div class="k-cartel-hint">Toca la pantalla o teclea tu PIN para fichar</div>
      </div>
    `;
  };
  pintar();
  clearInterval(cartelInterval);
  cartelInterval = setInterval(() => { idx = (idx + 1) % items.length; pintar(); }, CARTEL_ROTACION_MS);

  const salir = () => { clearInterval(cartelInterval); vistaTeclado(); };
  document.addEventListener('click', salir, { once: true });
  document.addEventListener('keydown', salir, { once: true });
}

function itemsCartelera(data) {
  const items = [];
  (data.avisos || []).forEach((a) => {
    if (a.tipo === 'cumpleanos') {
      items.push({ icono: '🎈', texto: `¡Hoy es el cumpleaños de nuestro/a compañero/a ${esc(a.nombre)}!` });
    } else {
      items.push({ icono: '🏆', texto: `Hoy es el aniversario de ${esc(a.nombre)}: cumple ${a.anios} año${a.anios === 1 ? '' : 's'} en la empresa. ¡Felicidades por sus ${a.anios} año${a.anios === 1 ? '' : 's'}!` });
    }
  });
  if (data.mensaje) items.push({ icono: '💬', texto: esc(data.mensaje) });
  return items;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

vistaTeclado();
