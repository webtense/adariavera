let currentLang = localStorage.getItem('welcome_lang') || 'es';

const I18N = {
  es: {
    arrivalsTitle: 'Llegadas de hoy',
    refresh: 'Actualizar',
    loading: 'Cargando llegadas de hoy desde ACI…',
    empty: 'No hay llegadas registradas para hoy.',
    error: 'No se ha podido conectar con ACI. Reintenta en unos segundos.',
    room: 'Habitación',
    noRoom: 'Sin asignar',
    guests: 'huésped(es)',
    startCheckin: 'Iniciar check-in'
  },
  en: {
    arrivalsTitle: "Today's arrivals",
    refresh: 'Refresh',
    loading: "Loading today's arrivals from ACI…",
    empty: 'No arrivals registered for today.',
    error: 'Could not connect to ACI. Please try again shortly.',
    room: 'Room',
    noRoom: 'Not assigned',
    guests: 'guest(s)',
    startCheckin: 'Start check-in'
  }
};

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('welcome_lang', lang);
  document.getElementById('lang-es').classList.toggle('active', lang === 'es');
  document.getElementById('lang-en').classList.toggle('active', lang === 'en');
  const t = I18N[lang];
  document.getElementById('subtitle').textContent = t.arrivalsTitle;
  document.getElementById('arrivals-title').textContent = t.arrivalsTitle;
  document.getElementById('refresh-label').textContent = t.refresh;
  loadArrivals();
}

async function loadArrivals() {
  const t = I18N[currentLang];
  const container = document.getElementById('arrivals-container');
  container.innerHTML = `<div class="empty-state">${t.loading}</div>`;
  try {
    const res = await fetch('/api/arrivals');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'error');
    document.getElementById('arrivals-count').textContent = data.count;
    if (data.arrivals.length === 0) {
      container.innerHTML = `<div class="empty-state">${t.empty}</div>`;
      return;
    }
    container.innerHTML = `<div class="arrivals-grid">${data.arrivals.map(a => renderCard(a, t)).join('')}</div>`;
  } catch (e) {
    container.innerHTML = `<div class="error-state">⚠️ ${t.error}</div>`;
    console.error(e);
  }
}

function renderCard(arrival, t) {
  const room = arrival.roomCode || t.noRoom;
  const guestNames = arrival.huespedes.map(h => `${h.nombre} ${h.apellido1}`).join(', ') || '-';
  return `
    <div class="arrival-card" onclick="startCheckin('${arrival.resGuid}')">
      <div class="room">${escapeHtml(room)}</div>
      <div class="res-code">${t.room !== undefined ? '' : ''}Reserva ${escapeHtml(arrival.resCod)}</div>
      <div class="guests">${escapeHtml(guestNames)}</div>
      <div class="guest-count">${arrival.huespedes.length} ${t.guests}</div>
    </div>
  `;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let arrivalsCache = [];

async function startCheckin(resGuid) {
  try {
    const res = await fetch('/api/arrivals');
    const data = await res.json();
    const arrival = data.arrivals.find(a => String(a.resGuid) === String(resGuid));
    if (!arrival) return;
    sessionStorage.setItem('welcome_arrival', JSON.stringify(arrival));
    sessionStorage.setItem('welcome_lang', currentLang);
    window.location.href = '/checkin.html';
  } catch (e) {
    console.error(e);
  }
}

// Init
document.getElementById('lang-' + currentLang).classList.add('active');
setLang(currentLang);
