'use strict';
/**
 * Adaria Parking (Hotel Adaria Vera) — admin.js
 * Gestión de usuarios + auditoría (solo admin)
 * Calcado de btr_parking_siente/app/public/js/admin.js
 */

const $ = id => document.getElementById(id);

// ── Helpers ────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const c = $('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

async function api(method, url, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ── Estado auditoría ───────────────────────────────────────────
const AUD = { offset: 0, limit: 50, total: 0 };

// ── Pestañas admin ─────────────────────────────────────────────
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $('pane-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'auditoria') loadAuditoria(0);
  });
});

// ════════════════════════════════════════════════════════════════
// GESTIÓN DE USUARIOS
// ════════════════════════════════════════════════════════════════

let ME_ID = null; // ID del usuario autenticado actual

async function loadUsuarios() {
  $('tabla-usuarios-container').innerHTML = '<div class="spinner">Cargando…</div>';
  try {
    const rows = await api('GET', '/api/admin/usuarios');
    renderTablaUsuarios(rows);
  } catch (e) {
    $('tabla-usuarios-container').innerHTML = `<div style="color:#c00;padding:20px;">Error: ${e.message}</div>`;
  }
}

function renderTablaUsuarios(rows) {
  if (!rows.length) {
    $('tabla-usuarios-container').innerHTML = '<div style="padding:20px;color:#aaa;">No hay usuarios.</div>';
    return;
  }
  const html = `
    <table class="adm-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Usuario</th>
          <th>Rol</th>
          <th>Estado</th>
          <th>Creado el</th>
          <th>Creado por</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(u => {
          const esMio = u.id === ME_ID;
          return `
          <tr>
            <td>${u.id}</td>
            <td><strong>${u.username}</strong>${esMio ? ' <span style="font-size:.7rem;color:#888;">(tú)</span>' : ''}</td>
            <td><span class="badge badge-${u.rol}">${u.rol}</span></td>
            <td><span class="badge badge-${u.activo ? 'activo' : 'inactivo'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td>${fmtDateTime(u.creado_at)}</td>
            <td>${u.creado_por}</td>
            <td>
              <div class="row-actions">
                <button class="btn-xs info" onclick="abrirResetPassword(${u.id},'${u.username}')">Reset pwd</button>
                ${u.rol === 'admin'
                  ? `<button class="btn-xs warning" onclick="cambiarRol(${u.id},'${u.username}','operador')">→ Operador</button>`
                  : `<button class="btn-xs warning" onclick="cambiarRol(${u.id},'${u.username}','admin')">→ Admin</button>`
                }
                ${u.activo
                  ? `<button class="btn-xs danger" onclick="toggleActivo(${u.id},'${u.username}',false)">Desactivar</button>`
                  : `<button class="btn-xs success" onclick="toggleActivo(${u.id},'${u.username}',true)">Activar</button>`
                }
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  $('tabla-usuarios-container').innerHTML = html;
}

// Crear nuevo usuario
$('form-nuevo-usuario').addEventListener('submit', async e => {
  e.preventDefault();
  const username = $('nu-username').value.trim();
  const password = $('nu-password').value;
  const rol      = $('nu-rol').value;
  try {
    await api('POST', '/api/admin/usuarios', { username, password, rol });
    toast(`Usuario '${username}' creado correctamente`, 'success');
    $('nu-username').value = '';
    $('nu-password').value = '';
    $('nu-rol').value = 'operador';
    await loadUsuarios();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
});

// Activar / Desactivar
async function toggleActivo(id, username, activo) {
  const accion = activo ? 'activar' : 'desactivar';
  if (!confirm(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} al usuario '${username}'?`)) return;
  try {
    await api('PATCH', `/api/admin/usuarios/${id}`, { activo });
    toast(`Usuario '${username}' ${activo ? 'activado' : 'desactivado'}`, 'success');
    await loadUsuarios();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// Cambiar rol
async function cambiarRol(id, username, nuevoRol) {
  if (!confirm(`¿Cambiar el rol de '${username}' a ${nuevoRol}?`)) return;
  try {
    await api('PATCH', `/api/admin/usuarios/${id}`, { rol: nuevoRol });
    toast(`Rol de '${username}' actualizado a ${nuevoRol}`, 'success');
    await loadUsuarios();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// Reset contraseña
function abrirResetPassword(id, username) {
  $('pwd-user-id').value = id;
  $('pwd-username-label').textContent = username;
  $('pwd-nueva').value = '';
  $('pwd-confirmar').value = '';
  $('pwd-modal-overlay').classList.add('visible');
}

$('pwd-cancelar').addEventListener('click', () => {
  $('pwd-modal-overlay').classList.remove('visible');
});

$('pwd-guardar').addEventListener('click', async () => {
  const id       = parseInt($('pwd-user-id').value, 10);
  const password = $('pwd-nueva').value;
  const confirm2 = $('pwd-confirmar').value;
  const username = $('pwd-username-label').textContent;

  if (!password || password.length < 6) {
    toast('La contraseña debe tener al menos 6 caracteres', 'error'); return;
  }
  if (password !== confirm2) {
    toast('Las contraseñas no coinciden', 'error'); return;
  }
  try {
    await api('PATCH', `/api/admin/usuarios/${id}`, { password });
    toast(`Contraseña de '${username}' actualizada`, 'success');
    $('pwd-modal-overlay').classList.remove('visible');
    await loadUsuarios();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
});

// Cerrar modal al pulsar fuera
$('pwd-modal-overlay').addEventListener('click', e => {
  if (e.target === $('pwd-modal-overlay')) $('pwd-modal-overlay').classList.remove('visible');
});

// ════════════════════════════════════════════════════════════════
// AUDITORÍA
// ════════════════════════════════════════════════════════════════

function accionClass(accion) {
  if (!accion) return '';
  if (accion === 'login')       return 'login';
  if (accion === 'logout')      return 'logout';
  if (accion === 'asignar')     return 'asignar';
  if (accion === 'liberar')     return 'liberar';
  if (accion.startsWith('bloquear')) return 'bloquear';
  if (accion === 'desbloquear') return 'desbloquear';
  if (accion === 'cobro')       return 'cobro';
  if (accion.startsWith('usuario')) return 'usuario';
  return '';
}

async function loadAuditoria(offset) {
  AUD.offset = offset || 0;
  $('tabla-audit-container').innerHTML = '<div class="spinner">Cargando…</div>';

  const params = new URLSearchParams();
  const desde   = $('aud-desde').value;
  const hasta   = $('aud-hasta').value;
  const usuario = $('aud-usuario').value.trim();
  const accion  = $('aud-accion').value;

  if (desde)   params.set('desde', desde);
  if (hasta)   params.set('hasta', hasta);
  if (usuario) params.set('usuario', usuario);
  if (accion)  params.set('accion', accion);
  params.set('limit',  AUD.limit);
  params.set('offset', AUD.offset);

  try {
    const data = await api('GET', `/api/admin/auditoria?${params}`);
    AUD.total = data.total;
    renderTablaAudit(data.rows);
    actualizarPaginacionAudit();
    $('aud-info').textContent = `${data.total} registro${data.total !== 1 ? 's' : ''} encontrado${data.total !== 1 ? 's' : ''} — mostrando ${AUD.offset + 1}–${Math.min(AUD.offset + AUD.limit, AUD.total)}`;
  } catch (e) {
    $('tabla-audit-container').innerHTML = `<div style="color:#c00;padding:20px;">Error: ${e.message}</div>`;
  }
}

function renderTablaAudit(rows) {
  if (!rows.length) {
    $('tabla-audit-container').innerHTML = '<div style="padding:20px;color:#aaa;">Sin registros para el filtro aplicado.</div>';
    return;
  }
  const html = `
    <table class="adm-table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Usuario</th>
          <th>Acción</th>
          <th>Plaza</th>
          <th>Ocupación</th>
          <th>IP</th>
          <th>Detalle</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td style="white-space:nowrap;">${fmtDateTime(r.creado_at)}</td>
            <td><strong>${r.usuario}</strong></td>
            <td><span class="accion-badge ${accionClass(r.accion)}">${r.accion}</span></td>
            <td>${r.plaza_id != null ? `P-${String(r.plaza_id).padStart(2,'0')}` : '—'}</td>
            <td>${r.ocupacion_id != null ? r.ocupacion_id : '—'}</td>
            <td style="font-size:.78rem;color:var(--texto-suave);">${r.ip || '—'}</td>
            <td style="font-size:.78rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;">
              ${r.detalle ? JSON.stringify(r.detalle) : '—'}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  $('tabla-audit-container').innerHTML = html;
}

function actualizarPaginacionAudit() {
  const pag = $('aud-paginacion');
  if (AUD.total <= AUD.limit) { pag.style.display = 'none'; return; }
  pag.style.display = 'flex';
  $('aud-prev').disabled = AUD.offset === 0;
  $('aud-next').disabled = AUD.offset + AUD.limit >= AUD.total;
  const pagActual = Math.floor(AUD.offset / AUD.limit) + 1;
  const pagTotal  = Math.ceil(AUD.total / AUD.limit);
  $('aud-page-info').textContent = `Página ${pagActual} de ${pagTotal}`;
}

$('btn-aud-filtrar').addEventListener('click', () => loadAuditoria(0));

$('aud-prev').addEventListener('click', () => {
  if (AUD.offset > 0) loadAuditoria(Math.max(0, AUD.offset - AUD.limit));
});
$('aud-next').addEventListener('click', () => {
  if (AUD.offset + AUD.limit < AUD.total) loadAuditoria(AUD.offset + AUD.limit);
});

// ── Logout ─────────────────────────────────────────────────────
$('btn-logout').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  window.location.href = '/login.html';
});

// ── Init ───────────────────────────────────────────────────────
(async function init() {
  try {
    const me = await api('GET', '/api/me');
    if (me.rol !== 'admin') {
      window.location.href = '/';
      return;
    }
    ME_ID = me.id;
    $('user-label').textContent = me.username + ' (admin)';
  } catch {
    window.location.href = '/login.html';
    return;
  }

  // Fechas auditoría por defecto: últimos 7 días
  const hoy   = new Date();
  const hace7 = new Date(hoy - 7 * 86400000);
  $('aud-hasta').value = hoy.toISOString().slice(0, 10);
  $('aud-desde').value = hace7.toISOString().slice(0, 10);

  await loadUsuarios();
})();
