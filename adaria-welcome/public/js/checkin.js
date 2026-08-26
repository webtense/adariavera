let lang = sessionStorage.getItem('welcome_lang') || 'es';
let arrival = null;
let legalTexts = null;
let signaturePad = null;

const T = {
  es: {
    subtitle: 'Revisa tus datos y firma',
    backToList: '← Volver a la lista',
    stayDetails: 'Datos de la estancia',
    reservation: 'Reserva', room: 'Habitación', notAssigned: 'Sin asignar',
    checkin: 'Entrada', checkout: 'Salida',
    mainGuest: 'Titular', companions: 'Acompañantes',
    firstName: 'Nombre', lastName1: 'Primer apellido', lastName2: 'Segundo apellido',
    nationality: 'Nacionalidad', docType: 'Tipo de documento', docNumber: 'Número de documento',
    email: 'Email', phone: 'Teléfono',
    docTypes: ['DNI', 'NIE', 'Pasaporte', 'Otro'],
    signHere: 'Firma en el recuadro',
    clearSignature: 'Borrar firma',
    confirmSign: 'Confirmar y firmar',
    submitting: 'Guardando…',
    successTitle: '¡Check-in completado!',
    successBody: 'Gracias por tu firma. Ya puedes recoger las llaves en recepción.',
    newCheckin: 'Nuevo check-in',
    missingSignature: 'Falta la firma',
    missingConsent: 'Debes aceptar las condiciones y la política de privacidad',
    errorSubmit: 'No se ha podido guardar el check-in, inténtalo de nuevo'
  },
  en: {
    subtitle: 'Review your details and sign',
    backToList: '← Back to list',
    stayDetails: 'Stay details',
    reservation: 'Reservation', room: 'Room', notAssigned: 'Not assigned',
    checkin: 'Check-in', checkout: 'Check-out',
    mainGuest: 'Main guest', companions: 'Companions',
    firstName: 'First name', lastName1: 'Last name', lastName2: 'Second last name',
    nationality: 'Nationality', docType: 'Document type', docNumber: 'Document number',
    email: 'Email', phone: 'Phone',
    docTypes: ['DNI', 'NIE', 'Passport', 'Other'],
    signHere: 'Sign in the box',
    clearSignature: 'Clear signature',
    confirmSign: 'Confirm and sign',
    submitting: 'Saving…',
    successTitle: 'Check-in completed!',
    successBody: 'Thank you for signing. You can now pick up your keys at reception.',
    newCheckin: 'New check-in',
    missingSignature: 'Signature is missing',
    missingConsent: 'You must accept the conditions and the privacy policy',
    errorSubmit: 'Could not save the check-in, please try again'
  }
};

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function setFormLang(newLang) {
  lang = newLang;
  sessionStorage.setItem('welcome_lang', lang);
  document.getElementById('lang-es').classList.toggle('active', lang === 'es');
  document.getElementById('lang-en').classList.toggle('active', lang === 'en');
  document.getElementById('hdr-subtitle').textContent = T[lang].subtitle;
  await loadLegalTexts();
  render();
}

async function loadLegalTexts() {
  const res = await fetch('/api/legal/' + lang);
  const data = await res.json();
  legalTexts = data.texts;
}

function docTypeOptions() {
  return T[lang].docTypes.map(d => `<option value="${d}">${d}</option>`).join('');
}

function guestFields(prefix, guest, includeContact) {
  const t = T[lang];
  return `
    <div class="form-row">
      <div>
        <label>${t.firstName}</label>
        <input type="text" id="${prefix}-nombre" value="${escapeHtml(guest.nombre)}">
      </div>
      <div>
        <label>${t.lastName1}</label>
        <input type="text" id="${prefix}-apellido1" value="${escapeHtml(guest.apellido1)}">
      </div>
      <div>
        <label>${t.lastName2}</label>
        <input type="text" id="${prefix}-apellido2" value="${escapeHtml(guest.apellido2 || '')}">
      </div>
    </div>
    <div class="form-row">
      <div>
        <label>${t.nationality}</label>
        <input type="text" id="${prefix}-nacionalidad" value="${escapeHtml(guest.nacionalidad || '')}">
      </div>
      <div>
        <label>${t.docType}</label>
        <select id="${prefix}-tipoDocumento">${docTypeOptions()}</select>
      </div>
      <div>
        <label>${t.docNumber}</label>
        <input type="text" id="${prefix}-numeroDocumento" value="">
      </div>
    </div>
    ${includeContact ? `
    <div class="form-row">
      <div>
        <label>${t.email} *</label>
        <input type="email" id="${prefix}-email" value="">
      </div>
      <div>
        <label>${t.phone}</label>
        <input type="tel" id="${prefix}-telefono" value="">
      </div>
    </div>` : ''}
  `;
}

function render() {
  if (!arrival) return;
  const t = T[lang];
  const titular = arrival.huespedes[0] || { nombre: '', apellido1: '', apellido2: '', nacionalidad: '' };
  const acompanantes = arrival.huespedes.slice(1);

  const html = `
    <button class="btn btn-secondary" onclick="window.location.href='/'">${t.backToList}</button>

    <div class="form-card" style="margin-top:16px;">
      <h3>${t.stayDetails}</h3>
      <div class="form-row">
        <div><strong>${t.reservation}:</strong> ${escapeHtml(arrival.resCod)}</div>
        <div><strong>${t.room}:</strong> ${escapeHtml(arrival.roomCode || t.notAssigned)}</div>
        <div><strong>${t.checkin}:</strong> ${fmtDate(arrival.checkinDate)}</div>
        <div><strong>${t.checkout}:</strong> ${fmtDate(arrival.checkoutDate)}</div>
      </div>
    </div>

    <div class="form-card">
      <h3>${t.mainGuest}</h3>
      <div id="titular-fields">${guestFields('titular', titular, true)}</div>
    </div>

    ${acompanantes.length > 0 ? `
    <div class="form-card">
      <h3>${t.companions}</h3>
      <div id="acompanantes-fields">
        ${acompanantes.map((a, i) => `<div class="companion-block">${guestFields('acomp' + i, a, false)}</div>`).join('')}
      </div>
    </div>` : ''}

    <div class="form-card">
      <h3>${legalTexts.tituloCondiciones}</h3>
      <div class="legal-block">${escapeHtml(legalTexts.condiciones)}</div>
      <h3>${legalTexts.tituloPrivacidad}</h3>
      <div class="legal-block">${escapeHtml(legalTexts.privacidad)}</div>

      <div class="consent-row">
        <input type="checkbox" id="consent-conditions">
        <label for="consent-conditions" style="margin:0;">${legalTexts.tituloCondiciones} <span class="required-tag">${legalTexts.consentimientoObligatorio}</span></label>
      </div>
      <div class="consent-row">
        <input type="checkbox" id="consent-privacy">
        <label for="consent-privacy" style="margin:0;">${legalTexts.tituloPrivacidad} <span class="required-tag">${legalTexts.consentimientoObligatorio}</span></label>
      </div>
      <div class="consent-row">
        <input type="checkbox" id="consent-image">
        <label for="consent-image" style="margin:0;">${legalTexts.tituloImagen} <span class="optional-tag">${legalTexts.consentimientoOpcional}</span></label>
      </div>
      <div class="consent-row">
        <input type="checkbox" id="consent-marketing">
        <label for="consent-marketing" style="margin:0;">${legalTexts.tituloMarketing} <span class="optional-tag">${legalTexts.consentimientoOpcional}</span></label>
      </div>
    </div>

    <div class="form-card">
      <h3>${t.signHere}</h3>
      <canvas id="signature-pad" width="500" height="200"></canvas>
      <div class="signature-actions">
        <button class="btn btn-secondary" onclick="clearSignature()">${t.clearSignature}</button>
      </div>
    </div>

    <div id="submit-error" style="color:var(--error); font-weight:600; margin-bottom:12px;"></div>

    <div class="actions-bar">
      <div></div>
      <button class="btn btn-primary" id="submit-btn" onclick="submitCheckin()">${t.confirmSign}</button>
    </div>
  `;
  document.getElementById('checkin-container').innerHTML = html;
  initSignaturePad();
}

function initSignaturePad() {
  const canvas = document.getElementById('signature-pad');
  const ctx = canvas.getContext('2d');
  // Ajustar resolucion real al tamaño mostrado (evita firma borrosa/desalineada)
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1b5e75';

  let drawing = false;
  let last = null;

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - r.left, y: point.clientY - r.top };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    last = pos(e);
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  }
  function end(e) {
    drawing = false;
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  signaturePad = { canvas, ctx, isEmpty: () => !canvas.dataset.touched, };
  canvas.addEventListener('mousedown', () => canvas.dataset.touched = '1');
  canvas.addEventListener('touchstart', () => canvas.dataset.touched = '1');
}

function clearSignature() {
  const canvas = document.getElementById('signature-pad');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  delete canvas.dataset.touched;
}

function collectGuest(prefix) {
  const val = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };
  return {
    nombre: val(`${prefix}-nombre`),
    apellido1: val(`${prefix}-apellido1`),
    apellido2: val(`${prefix}-apellido2`),
    nacionalidad: val(`${prefix}-nacionalidad`),
    tipoDocumento: val(`${prefix}-tipoDocumento`),
    numeroDocumento: val(`${prefix}-numeroDocumento`)
  };
}

async function submitCheckin() {
  const t = T[lang];
  const errorEl = document.getElementById('submit-error');
  errorEl.textContent = '';

  const titular = collectGuest('titular');
  titular.email = document.getElementById('titular-email').value.trim();
  titular.telefono = document.getElementById('titular-telefono').value.trim();
  titular.hueGuid = (arrival.huespedes[0] || {}).hueGuid || null;

  const acompanantes = arrival.huespedes.slice(1).map((_, i) => collectGuest('acomp' + i));

  const consentConditions = document.getElementById('consent-conditions').checked;
  const consentPrivacy = document.getElementById('consent-privacy').checked;
  const consentImage = document.getElementById('consent-image').checked;
  const consentMarketing = document.getElementById('consent-marketing').checked;

  if (!consentConditions || !consentPrivacy) {
    errorEl.textContent = t.missingConsent;
    return;
  }

  const canvas = document.getElementById('signature-pad');
  if (!canvas.dataset.touched) {
    errorEl.textContent = t.missingSignature;
    return;
  }
  const signaturePngBase64 = canvas.toDataURL('image/png');

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = t.submitting;

  try {
    const res = await fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resGuid: arrival.resGuid,
        resCod: arrival.resCod,
        roomCode: arrival.roomCode,
        checkinDate: arrival.checkinDate,
        checkoutDate: arrival.checkoutDate,
        language: lang,
        titular,
        acompanantes,
        consentConditions, consentPrivacy, consentImage, consentMarketing,
        signaturePngBase64
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'error');
    renderSuccess(data);
  } catch (e) {
    console.error(e);
    errorEl.textContent = t.errorSubmit;
    btn.disabled = false;
    btn.textContent = t.confirmSign;
  }
}

function renderSuccess(data) {
  const t = T[lang];
  document.getElementById('checkin-container').innerHTML = `
    <div class="success-screen">
      <div class="checkmark">✓</div>
      <h2>${t.successTitle}</h2>
      <p>${t.successBody}</p>
      <div class="hash-tag">SHA-256: ${data.pdfHash}</div>
      <div class="hash-tag">${data.signedAt}</div>
      <button class="btn btn-primary" style="margin-top:24px;" onclick="window.location.href='/'">${t.newCheckin}</button>
    </div>
  `;
}

async function init() {
  const raw = sessionStorage.getItem('welcome_arrival');
  if (!raw) {
    window.location.href = '/';
    return;
  }
  arrival = JSON.parse(raw);
  document.getElementById('lang-' + lang).classList.add('active');
  document.getElementById('hdr-subtitle').textContent = T[lang].subtitle;
  await loadLegalTexts();
  render();
}

init();
