// Wizard de check-in digital Welcome (Hotel Adaria Vera) — 6 pasos:
// 1) search  2) review  3) guestData  4) consent  5) signature  6) confirmation
let lang = sessionStorage.getItem('welcome_lang') || 'es';
let arrival = null;          // datos de ACI (llegadas de hoy)
let precheckinData = null;   // datos ya enviados por el huesped (precheckin_adaria), si existen
let legalTexts = null;
let signaturePad = null;

const STEPS = ['search', 'review', 'guestData', 'consent', 'signature', 'confirmation'];
let stepIndex = 0;

const T = {
  es: {
    subtitle: 'Revisa tus datos y firma',
    stepLabels: ['Reserva', 'Revisión', 'Datos', 'Condiciones', 'Firma', 'Confirmación'],
    backToList: '← Volver a la lista',
    back: '← Atrás',
    next: 'Continuar →',
    searchTitle: 'Busca tu reserva',
    searchHint: 'Introduce el código de reserva que aparece en tu confirmación.',
    searchCode: 'Código de reserva',
    searchLastName: 'Primer apellido del titular (opcional)',
    searchBtn: 'Buscar reserva',
    searching: 'Buscando…',
    searchNotFound: 'No se ha encontrado ninguna llegada de hoy con ese código.',
    searchError: 'No se ha podido conectar con ACI. Reintenta en unos segundos.',
    reviewTitle: 'Confirma tu reserva',
    stayDetails: 'Datos de la estancia',
    reservation: 'Reserva', room: 'Habitación', notAssigned: 'Sin asignar',
    checkin: 'Entrada', checkout: 'Salida',
    precheckinFound: 'Encontramos un pre check-in enviado antes de tu llegada. Hemos precargado tus datos.',
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
    missingGuestData: 'Rellena al menos nombre y primer apellido del titular',
    errorSubmit: 'No se ha podido guardar el check-in, inténtalo de nuevo'
  },
  en: {
    subtitle: 'Review your details and sign',
    stepLabels: ['Booking', 'Review', 'Details', 'Conditions', 'Signature', 'Confirmation'],
    backToList: '← Back to list',
    back: '← Back',
    next: 'Continue →',
    searchTitle: 'Find your booking',
    searchHint: 'Enter the booking code shown on your confirmation.',
    searchCode: 'Booking code',
    searchLastName: "Main guest's last name (optional)",
    searchBtn: 'Find booking',
    searching: 'Searching…',
    searchNotFound: 'No arrival for today was found with that code.',
    searchError: 'Could not connect to ACI. Please try again shortly.',
    reviewTitle: 'Confirm your booking',
    stayDetails: 'Stay details',
    reservation: 'Reservation', room: 'Room', notAssigned: 'Not assigned',
    checkin: 'Check-in', checkout: 'Check-out',
    precheckinFound: 'We found an online pre check-in you sent before arrival. Your details are prefilled.',
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
    missingGuestData: "Fill in at least the main guest's first and last name",
    errorSubmit: 'Could not save the check-in, please try again'
  },
  fr: {
    subtitle: 'Vérifiez vos données et signez',
    stepLabels: ['Réservation', 'Vérification', 'Données', 'Conditions', 'Signature', 'Confirmation'],
    backToList: '← Retour à la liste',
    back: '← Retour',
    next: 'Continuer →',
    searchTitle: 'Trouvez votre réservation',
    searchHint: 'Saisissez le code de réservation indiqué sur votre confirmation.',
    searchCode: 'Code de réservation',
    searchLastName: 'Nom de famille du titulaire (facultatif)',
    searchBtn: 'Rechercher',
    searching: 'Recherche…',
    searchNotFound: "Aucune arrivée d'aujourd'hui n'a été trouvée avec ce code.",
    searchError: 'Connexion à ACI impossible. Réessayez dans quelques instants.',
    reviewTitle: 'Confirmez votre réservation',
    stayDetails: 'Détails du séjour',
    reservation: 'Réservation', room: 'Chambre', notAssigned: 'Non assignée',
    checkin: 'Arrivée', checkout: 'Départ',
    precheckinFound: 'Nous avons trouvé un pré check-in envoyé avant votre arrivée. Vos données sont préremplies.',
    mainGuest: 'Titulaire', companions: 'Accompagnateurs',
    firstName: 'Prénom', lastName1: 'Nom', lastName2: 'Second nom',
    nationality: 'Nationalité', docType: 'Type de document', docNumber: 'Numéro de document',
    email: 'Email', phone: 'Téléphone',
    docTypes: ['DNI', 'NIE', 'Passeport', 'Autre'],
    signHere: 'Signez dans le cadre',
    clearSignature: 'Effacer la signature',
    confirmSign: 'Confirmer et signer',
    submitting: 'Enregistrement…',
    successTitle: 'Check-in terminé !',
    successBody: 'Merci pour votre signature. Vous pouvez récupérer vos clés à la réception.',
    newCheckin: 'Nouveau check-in',
    missingSignature: 'La signature est manquante',
    missingConsent: "Vous devez accepter les conditions et la politique de confidentialité",
    missingGuestData: 'Renseignez au moins le prénom et le nom du titulaire',
    errorSubmit: "Impossible d'enregistrer le check-in, veuillez réessayer"
  }
};

function fmtDate(d) {
  if (!d) return '-';
  const locales = { es: 'es-ES', en: 'en-GB', fr: 'fr-FR' };
  return new Date(d).toLocaleDateString(locales[lang] || 'es-ES');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function setFormLang(newLang) {
  lang = newLang;
  sessionStorage.setItem('welcome_lang', lang);
  ['es', 'en', 'fr'].forEach((l) => document.getElementById('lang-' + l).classList.toggle('active', lang === l));
  document.getElementById('hdr-subtitle').textContent = T[lang].subtitle;
  await loadLegalTexts();
  renderStep();
}

async function loadLegalTexts() {
  const res = await fetch('/api/legal/' + lang);
  const data = await res.json();
  legalTexts = data.texts;
}

function docTypeOptions(selected) {
  return T[lang].docTypes.map((d) => {
    const val = d.toUpperCase() === 'PASAPORTE' || d.toUpperCase() === 'PASSPORT' || d.toUpperCase() === 'PASSEPORT' ? 'PASAPORTE' : d.toUpperCase();
    const isSelected = selected && selected.toUpperCase() === val ? ' selected' : '';
    return `<option value="${val}"${isSelected}>${d}</option>`;
  }).join('');
}

function stepIndicator() {
  const labels = T[lang].stepLabels;
  return `
    <div class="step-indicator">
      ${labels.map((label, i) => `
        <div class="step-dot ${i === stepIndex ? 'current' : i < stepIndex ? 'done' : ''}">
          <span class="dot-num">${i < stepIndex ? '✓' : i + 1}</span>
          <span class="dot-label">${escapeHtml(label)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function guestFields(prefix, guest, includeContact) {
  const t = T[lang];
  guest = guest || {};
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
        <select id="${prefix}-tipoDocumento">${docTypeOptions(guest.tipoDocumento)}</select>
      </div>
      <div>
        <label>${t.docNumber}</label>
        <input type="text" id="${prefix}-numeroDocumento" value="${escapeHtml(guest.numeroDocumento || '')}">
      </div>
    </div>
    ${includeContact ? `
    <div class="form-row">
      <div>
        <label>${t.email} *</label>
        <input type="email" id="${prefix}-email" value="${escapeHtml(guest.email || '')}">
      </div>
      <div>
        <label>${t.phone}</label>
        <input type="tel" id="${prefix}-telefono" value="${escapeHtml(guest.telefono || '')}">
      </div>
    </div>` : ''}
  `;
}

// ── Paso 1: búsqueda ────────────────────────────────────────────────────
function renderSearch() {
  const t = T[lang];
  const html = `
    ${stepIndicator()}
    <div class="form-card" style="margin-top:16px;">
      <h3>${t.searchTitle}</h3>
      <p style="color:var(--gray);">${t.searchHint}</p>
      <div class="form-row">
        <div>
          <label>${t.searchCode}</label>
          <input type="text" id="search-codigo" placeholder="AV-2026-00123">
        </div>
        <div>
          <label>${t.searchLastName}</label>
          <input type="text" id="search-apellido">
        </div>
      </div>
      <div id="search-error" style="color:var(--error); font-weight:600; margin-bottom:12px;"></div>
      <div class="actions-bar">
        <button class="btn btn-secondary" onclick="window.location.href='/'">${t.backToList}</button>
        <button class="btn btn-primary" id="search-btn" onclick="runSearch()">${t.searchBtn}</button>
      </div>
    </div>
  `;
  document.getElementById('checkin-container').innerHTML = html;
}

async function runSearch() {
  const t = T[lang];
  const errorEl = document.getElementById('search-error');
  const btn = document.getElementById('search-btn');
  const codigo = document.getElementById('search-codigo').value.trim();
  const apellido = document.getElementById('search-apellido').value.trim().toLowerCase();
  errorEl.textContent = '';

  if (!codigo) {
    errorEl.textContent = t.searchCode;
    return;
  }

  btn.disabled = true;
  btn.textContent = t.searching;
  try {
    const res = await fetch('/api/arrivals');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'error');
    const found = data.arrivals.find((a) => {
      const matchCodigo = String(a.resCod || '').trim().toLowerCase() === codigo.toLowerCase();
      if (!matchCodigo) return false;
      if (!apellido) return true;
      return (a.huespedes || []).some((h) => (h.apellido1 || '').toLowerCase() === apellido);
    });
    if (!found) {
      errorEl.textContent = t.searchNotFound;
      btn.disabled = false;
      btn.textContent = t.searchBtn;
      return;
    }
    arrival = found;
    sessionStorage.setItem('welcome_arrival', JSON.stringify(arrival));
    await loadPrecheckin(codigo);
    stepIndex = 1;
    renderStep();
  } catch (e) {
    console.error(e);
    errorEl.textContent = t.searchError;
    btn.disabled = false;
    btn.textContent = t.searchBtn;
  }
}

async function loadPrecheckin(codigo) {
  precheckinData = null;
  try {
    const res = await fetch('/api/precheckin/by-codigo/' + encodeURIComponent(codigo));
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok) precheckinData = data.precheckin;
  } catch (e) {
    console.warn('[checkin] pre check-in no disponible para precarga:', e.message);
  }
}

// Fusiona un huesped de ACI con la persona equivalente del pre check-in
// (por posicion: titular con titular, resto por orden de llegada).
function mergeGuest(aciGuest, precheckinPersona) {
  const merged = { ...(aciGuest || {}) };
  if (precheckinPersona) {
    merged.nombre = merged.nombre || precheckinPersona.nombre;
    merged.apellido1 = merged.apellido1 || precheckinPersona.apellido1;
    merged.apellido2 = merged.apellido2 || precheckinPersona.apellido2;
    merged.nacionalidad = merged.nacionalidad || precheckinPersona.nacionalidad;
    merged.tipoDocumento = merged.tipoDocumento || precheckinPersona.tipoDocumento;
    merged.numeroDocumento = merged.numeroDocumento || precheckinPersona.numeroDocumento;
  }
  return merged;
}

function guestsForForm() {
  const huespedes = (arrival && arrival.huespedes) || [];
  const personas = (precheckinData && precheckinData.personas) || [];
  const titularPersona = personas.find((p) => p.esTitular) || personas[0];
  const acompPersonas = personas.filter((p) => p !== titularPersona);

  const titular = mergeGuest(huespedes[0], titularPersona);
  if (precheckinData) {
    titular.email = titular.email || precheckinData.email;
    titular.telefono = titular.telefono || precheckinData.telefono;
  }
  const acompanantes = huespedes.slice(1).map((h, i) => mergeGuest(h, acompPersonas[i]));
  return { titular, acompanantes };
}

// ── Paso 2: revisión de la reserva ──────────────────────────────────────
function renderReview() {
  const t = T[lang];
  const html = `
    ${stepIndicator()}
    <div class="form-card" style="margin-top:16px;">
      <h3>${t.reviewTitle}</h3>
      <div class="form-row">
        <div><strong>${t.reservation}:</strong> ${escapeHtml(arrival.resCod)}</div>
        <div><strong>${t.room}:</strong> ${escapeHtml(arrival.roomCode || t.notAssigned)}</div>
        <div><strong>${t.checkin}:</strong> ${fmtDate(arrival.checkinDate)}</div>
        <div><strong>${t.checkout}:</strong> ${fmtDate(arrival.checkoutDate)}</div>
      </div>
      ${precheckinData ? `<div class="info-banner">ℹ️ ${t.precheckinFound}</div>` : ''}
    </div>
    <div class="actions-bar">
      <button class="btn btn-secondary" onclick="goBack()">${t.back}</button>
      <button class="btn btn-primary" onclick="goNext()">${t.next}</button>
    </div>
  `;
  document.getElementById('checkin-container').innerHTML = html;
}

// ── Paso 3: datos de los huéspedes ──────────────────────────────────────
function renderGuestData() {
  const t = T[lang];
  const { titular, acompanantes } = guestsForForm();
  const html = `
    ${stepIndicator()}
    <div class="form-card" style="margin-top:16px;">
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
    <div id="guestdata-error" style="color:var(--error); font-weight:600; margin-bottom:12px;"></div>
    <div class="actions-bar">
      <button class="btn btn-secondary" onclick="goBack()">${t.back}</button>
      <button class="btn btn-primary" onclick="validateGuestDataAndNext()">${t.next}</button>
    </div>
  `;
  document.getElementById('checkin-container').innerHTML = html;
}

function validateGuestDataAndNext() {
  const t = T[lang];
  const nombre = document.getElementById('titular-nombre').value.trim();
  const apellido1 = document.getElementById('titular-apellido1').value.trim();
  const errorEl = document.getElementById('guestdata-error');
  if (!nombre || !apellido1) {
    errorEl.textContent = t.missingGuestData;
    return;
  }
  goNext();
}

// ── Paso 4: condiciones y consentimientos ───────────────────────────────
function renderConsent() {
  const t = T[lang];
  const html = `
    ${stepIndicator()}
    <div class="form-card" style="margin-top:16px;">
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
    <div id="consent-error" style="color:var(--error); font-weight:600; margin-bottom:12px;"></div>
    <div class="actions-bar">
      <button class="btn btn-secondary" onclick="goBack()">${t.back}</button>
      <button class="btn btn-primary" onclick="validateConsentAndNext()">${t.next}</button>
    </div>
  `;
  document.getElementById('checkin-container').innerHTML = html;
}

function validateConsentAndNext() {
  const t = T[lang];
  const errorEl = document.getElementById('consent-error');
  const consentConditions = document.getElementById('consent-conditions').checked;
  const consentPrivacy = document.getElementById('consent-privacy').checked;
  if (!consentConditions || !consentPrivacy) {
    errorEl.textContent = t.missingConsent;
    return;
  }
  wizardState.consentConditions = consentConditions;
  wizardState.consentPrivacy = consentPrivacy;
  wizardState.consentImage = document.getElementById('consent-image').checked;
  wizardState.consentMarketing = document.getElementById('consent-marketing').checked;
  goNext();
}

// ── Paso 5: firma ────────────────────────────────────────────────────────
function renderSignature() {
  const t = T[lang];
  const html = `
    ${stepIndicator()}
    <div class="form-card" style="margin-top:16px;">
      <h3>${t.signHere}</h3>
      <canvas id="signature-pad" width="500" height="200"></canvas>
      <div class="signature-actions">
        <button class="btn btn-secondary" onclick="clearSignature()">${t.clearSignature}</button>
      </div>
    </div>
    <div id="submit-error" style="color:var(--error); font-weight:600; margin-bottom:12px;"></div>
    <div class="actions-bar">
      <button class="btn btn-secondary" onclick="goBack()">${t.back}</button>
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
  function end() {
    drawing = false;
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  signaturePad = { canvas, ctx, isEmpty: () => !canvas.dataset.touched };
  canvas.addEventListener('mousedown', () => { canvas.dataset.touched = '1'; });
  canvas.addEventListener('touchstart', () => { canvas.dataset.touched = '1'; });
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

const wizardState = {
  consentConditions: false, consentPrivacy: false, consentImage: false, consentMarketing: false
};

async function submitCheckin() {
  const t = T[lang];
  const errorEl = document.getElementById('submit-error');
  errorEl.textContent = '';

  const canvas = document.getElementById('signature-pad');
  if (!canvas.dataset.touched) {
    errorEl.textContent = t.missingSignature;
    return;
  }
  const signaturePngBase64 = canvas.toDataURL('image/png');

  const { titular: titularForm, acompanantes: acompForm } = guestsForForm();
  const titular = collectGuest('titular');
  titular.email = (document.getElementById('titular-email') || { value: titularForm.email || '' }).value.trim();
  titular.telefono = (document.getElementById('titular-telefono') || { value: titularForm.telefono || '' }).value.trim();
  titular.hueGuid = (arrival.huespedes[0] || {}).hueGuid || null;

  const acompanantes = arrival.huespedes.slice(1).map((_, i) => collectGuest('acomp' + i));

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
        consentConditions: wizardState.consentConditions,
        consentPrivacy: wizardState.consentPrivacy,
        consentImage: wizardState.consentImage,
        consentMarketing: wizardState.consentMarketing,
        signaturePngBase64
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'error');
    stepIndex = STEPS.length - 1;
    renderConfirmation(data);
  } catch (e) {
    console.error(e);
    errorEl.textContent = t.errorSubmit;
    btn.disabled = false;
    btn.textContent = t.confirmSign;
  }
}

// ── Paso 6: confirmación ─────────────────────────────────────────────────
function renderConfirmation(data) {
  const t = T[lang];
  document.getElementById('checkin-container').innerHTML = `
    ${stepIndicator()}
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

// ── Navegación del wizard ────────────────────────────────────────────────
function goNext() {
  if (stepIndex < STEPS.length - 1) stepIndex += 1;
  renderStep();
}

function goBack() {
  if (stepIndex > 0) stepIndex -= 1;
  renderStep();
}

function renderStep() {
  switch (STEPS[stepIndex]) {
    case 'search': return renderSearch();
    case 'review': return renderReview();
    case 'guestData': return renderGuestData();
    case 'consent': return renderConsent();
    case 'signature': return renderSignature();
    case 'confirmation': return renderConfirmation({});
    default: return renderSearch();
  }
}

async function init() {
  document.getElementById('lang-' + lang).classList.add('active');
  document.getElementById('hdr-subtitle').textContent = T[lang].subtitle;
  await loadLegalTexts();

  const raw = sessionStorage.getItem('welcome_arrival');
  if (raw) {
    // Se llega desde la lista de llegadas (index.html): saltar directo a revisión.
    arrival = JSON.parse(raw);
    await loadPrecheckin(arrival.resCod);
    stepIndex = 1;
  } else {
    stepIndex = 0;
  }
  renderStep();
}

init();
