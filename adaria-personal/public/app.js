'use strict';

// BASE: prefijo público del despliegue (p.ej. "/rrhh"), inyectado por el
// servidor en index.html como window.BASE_PATH. Vacío en despliegues sin
// subpath (comportamiento idéntico al de antes).
const BASE = window.BASE_PATH || '';

const app = document.getElementById('app');
let DEPARTAMENTOS = [];

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, opts);
  if (res.status === 401) { window.location = BASE + '/login'; throw new Error('No autenticado'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error inesperado');
  return data;
}

function tabs(active) {
  return `<div class="tabs">
    <button class="${active === 'empleados' ? 'on' : ''}" onclick="location.hash='#/empleados'">👤 Empleados</button>
    <button class="${active === 'departamentos' ? 'on' : ''}" onclick="location.hash='#/departamentos'">🏷️ Departamentos</button>
    <button class="${active === 'fichajes' ? 'on' : ''}" onclick="location.hash='#/fichajes'">🕒 Fichajes</button>
    <button class="${active === 'turnos' ? 'on' : ''}" onclick="location.hash='#/turnos'">🗓️ Turnos</button>
    <button class="${active === 'cuadrantes' ? 'on' : ''}" onclick="location.hash='#/cuadrantes'">🧩 Cuadrantes</button>
    <button class="${active === 'comparativa' ? 'on' : ''}" onclick="location.hash='#/comparativa'">🔍 Comparativa</button>
    <button class="${active === 'inspeccion' ? 'on' : ''}" onclick="location.hash='#/inspeccion'">📋 Inspección de Trabajo</button>
    <button class="${active === 'informes' ? 'on' : ''}" onclick="location.hash='#/informes'">📊 Informes</button>
    <button class="${active === 'motivacion' ? 'on' : ''}" onclick="location.hash='#/motivacion'">🎉 Motivación</button>
    <button class="${active === 'vacaciones' ? 'on' : ''}" onclick="location.hash='#/vacaciones'">🏖️ Vacaciones</button>
    <button class="${active === 'auditoria' ? 'on' : ''}" onclick="location.hash='#/auditoria'">✅ Auditoría</button>
    <button class="${active === 'incidencias' ? 'on' : ''}" onclick="location.hash='#/incidencias'">🚨 Incidencias</button>
    <button class="${active === 'quiosco' ? 'on' : ''}" onclick="location.hash='#/quiosco'">🔑 Quiosco</button>
  </div>`;
}

async function cargarDepartamentos() {
  DEPARTAMENTOS = await api('GET', '/api/departamentos');
  return DEPARTAMENTOS;
}

function opcionesDepartamento(seleccionado) {
  return '<option value="">— Sin departamento —</option>' + DEPARTAMENTOS.map(
    (d) => `<option value="${d.id}" ${String(d.id) === String(seleccionado) ? 'selected' : ''}>${esc(d.nombre)}</option>`
  ).join('');
}

// ─── Vista: listado de empleados ───
async function vistaEmpleados() {
  app.innerHTML = `<h1>Empleados</h1><p class="muted">Ficha completa por empleado: datos, puesto, departamento y documentos.</p>
    ${tabs('empleados')}
    <div class="box">
      <div class="toolbar">
        <input type="text" id="fq" placeholder="Buscar por nombre, apellidos o DNI/NIE...">
        <select id="fdep"><option value="">Todos los departamentos</option></select>
        <select id="factivo">
          <option value="">Activos e inactivos</option>
          <option value="true" selected>Solo activos</option>
          <option value="false">Solo de baja</option>
        </select>
        <button class="btn" onclick="location.hash='#/empleados/nuevo'">➕ Nuevo empleado</button>
      </div>
      <div id="tablaEmpleados" class="empty">Cargando…</div>
    </div>`;

  await cargarDepartamentos();
  const fdep = document.getElementById('fdep');
  fdep.innerHTML += DEPARTAMENTOS.map((d) => `<option value="${d.id}">${esc(d.nombre)}</option>`).join('');

  const recargar = () => listarEmpleados();
  document.getElementById('fq').addEventListener('input', debounce(recargar, 300));
  fdep.addEventListener('change', recargar);
  document.getElementById('factivo').addEventListener('change', recargar);
  recargar();
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function listarEmpleados() {
  const q = document.getElementById('fq').value.trim();
  const dep = document.getElementById('fdep').value;
  const activo = document.getElementById('factivo').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (dep) params.set('departamento_id', dep);
  if (activo) params.set('activo', activo);
  const cont = document.getElementById('tablaEmpleados');
  try {
    const rows = await api('GET', '/api/empleados?' + params.toString());
    if (!rows.length) { cont.innerHTML = '<div class="empty">Sin resultados</div>'; return; }
    cont.innerHTML = `<table><tr><th>Nombre</th><th>Puesto</th><th>Departamento</th><th>Alta</th><th>Estado</th></tr>
      ${rows.map((r) => `<tr class="row" onclick="location.hash='#/empleados/${r.id}'">
        <td><b>${esc(r.apellidos)}, ${esc(r.nombre)}</b></td>
        <td>${esc(r.puesto || '—')}</td>
        <td>${esc(r.departamento_nombre || '—')}</td>
        <td>${esc(r.fecha_alta || '—')}</td>
        <td>${r.activo ? '<span class="pill ok">Activo</span>' : '<span class="pill baja">Baja</span>'}</td>
      </tr>`).join('')}</table>`;
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

// ─── Vista: formulario de empleado (alta / edición / ficha) ───
function formularioEmpleado(e) {
  e = e || {};
  return `
    <div class="grid2">
      <div><label>Nombre *</label><input id="f_nombre" value="${esc(e.nombre)}"></div>
      <div><label>Apellidos *</label><input id="f_apellidos" value="${esc(e.apellidos)}"></div>
    </div>
    <div class="grid2">
      <div><label>DNI / NIE</label><input id="f_dni" value="${esc(e.dni_nie)}"></div>
      <div><label>Fecha de nacimiento</label><input id="f_nacimiento" type="date" value="${e.fecha_nacimiento ? e.fecha_nacimiento.slice(0,10) : ''}"></div>
    </div>
    <div class="grid2">
      <div><label>Teléfono</label><input id="f_telefono" value="${esc(e.telefono)}"></div>
      <div><label>Email</label><input id="f_email" type="email" value="${esc(e.email)}"></div>
    </div>
    <div class="grid2">
      <div><label>Puesto</label><input id="f_puesto" value="${esc(e.puesto)}"></div>
      <div><label>Departamento</label><select id="f_departamento">${opcionesDepartamento(e.departamento_id)}</select></div>
    </div>
    <div class="grid2">
      <div><label>Fecha de alta *</label><input id="f_alta" type="date" value="${e.fecha_alta ? e.fecha_alta.slice(0,10) : ''}"></div>
      <div><label>Coste por hora (€)</label><input id="f_coste" type="number" step="0.01" min="0" placeholder="Sin definir = coste pendiente en Informes" value="${e.coste_hora != null ? e.coste_hora : ''}"></div>
    </div>
    <label>Notas</label><textarea id="f_notas">${esc(e.notas)}</textarea>
  `;
}

function leerFormularioEmpleado() {
  return {
    nombre: document.getElementById('f_nombre').value.trim(),
    apellidos: document.getElementById('f_apellidos').value.trim(),
    dni_nie: document.getElementById('f_dni').value.trim(),
    fecha_nacimiento: document.getElementById('f_nacimiento').value,
    telefono: document.getElementById('f_telefono').value.trim(),
    email: document.getElementById('f_email').value.trim(),
    puesto: document.getElementById('f_puesto').value.trim(),
    departamento_id: document.getElementById('f_departamento').value,
    fecha_alta: document.getElementById('f_alta').value,
    coste_hora: document.getElementById('f_coste').value.trim(),
    notas: document.getElementById('f_notas').value.trim(),
  };
}

async function vistaNuevoEmpleado() {
  await cargarDepartamentos();
  app.innerHTML = `<h1>Nuevo empleado</h1>${tabs('empleados')}
    <div class="box">${formularioEmpleado({})}
      <div id="msg"></div>
      <div class="actions">
        <button class="btn" id="btnGuardar">Guardar</button>
        <button class="btn sec" onclick="location.hash='#/empleados'">Cancelar</button>
      </div>
    </div>`;
  document.getElementById('btnGuardar').addEventListener('click', async () => {
    const msg = document.getElementById('msg');
    try {
      const d = leerFormularioEmpleado();
      const r = await api('POST', '/api/empleados', d);
      location.hash = '#/empleados/' + r.id;
    } catch (e) {
      msg.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  });
}

async function vistaFichaEmpleado(id) {
  app.innerHTML = `<div class="empty">Cargando…</div>`;
  await cargarDepartamentos();
  let e;
  try {
    e = await api('GET', '/api/empleados/' + id);
  } catch (err) {
    app.innerHTML = `${tabs('empleados')}<div class="err">${esc(err.message)}</div>`;
    return;
  }
  app.innerHTML = `<h1>${esc(e.nombre)} ${esc(e.apellidos)} ${e.activo ? '<span class="pill ok">Activo</span>' : '<span class="pill baja">Baja</span>'}</h1>
    ${tabs('empleados')}
    <div class="box">${formularioEmpleado(e)}
      <div id="msg"></div>
      <div class="actions">
        <button class="btn" id="btnGuardar">Guardar cambios</button>
        ${e.activo ? '<button class="btn d" id="btnBaja">Dar de baja</button>' : ''}
        <button class="btn sec" onclick="location.hash='#/empleados'">Volver al listado</button>
      </div>
    </div>
    <div class="box">
      <h2>📎 Documentos</h2>
      <ul class="docs-list" id="listaDocs">${renderDocs(e.documentos)}</ul>
      <form id="formDoc" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">
        <select id="docTipo" style="width:150px">
          <option value="contrato">Contrato</option>
          <option value="dni">DNI</option>
          <option value="titulacion">Titulación</option>
          <option value="otro">Otro</option>
        </select>
        <input type="file" id="docFile" accept=".pdf,.jpg,.jpeg,.png" style="width:auto;flex:1;min-width:180px">
        <button class="btn sm" type="submit">Subir documento</button>
      </form>
      <div id="msgDoc"></div>
    </div>
    <div class="box">
      <h2>🔐 Autofichaje (quiosco)</h2>
      <p class="muted">PIN y QR para que ${esc(e.nombre)} pueda fichar en el quiosco de recepción.</p>
      <label>PIN (4-6 dígitos)</label>
      <form id="formPin" class="pin-form">
        <input id="pinInput" type="text" inputmode="numeric" maxlength="6" placeholder="Ej. 4821" value="">
        <button class="btn sm" type="submit">${e.tiene_pin ? 'Cambiar PIN' : 'Asignar PIN'}</button>
        ${e.tiene_pin ? '<button class="btn sm d" type="button" id="btnQuitarPin">Quitar PIN</button>' : ''}
        <small class="hint">${e.tiene_pin ? 'Ya tiene un PIN asignado (no se muestra, solo se guarda su hash).' : 'Sin PIN asignado todavía.'}</small>
      </form>
      <div id="msgPin"></div>
      <label style="margin-top:18px">Código QR</label>
      <div class="qr-box" id="qrBox">
        <div class="empty">Cargando…</div>
      </div>
      <div class="actions">
        <button class="btn sm sec" id="btnRegenQr">${e.qr_token ? 'Regenerar QR' : 'Generar QR'}</button>
      </div>
      <div id="msgQr"></div>
    </div>`;

  document.getElementById('btnGuardar').addEventListener('click', async () => {
    const msg = document.getElementById('msg');
    try {
      const d = leerFormularioEmpleado();
      await api('PUT', '/api/empleados/' + id, d);
      msg.innerHTML = '<div class="ok-msg">Guardado correctamente</div>';
    } catch (err) {
      msg.innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  });

  const btnBaja = document.getElementById('btnBaja');
  if (btnBaja) {
    btnBaja.addEventListener('click', async () => {
      if (!confirm('¿Dar de baja a ' + e.nombre + ' ' + e.apellidos + '?')) return;
      try {
        await api('POST', '/api/empleados/' + id + '/baja', {});
        location.hash = '#/empleados';
      } catch (err) {
        document.getElementById('msg').innerHTML = `<div class="err">${esc(err.message)}</div>`;
      }
    });
  }

  document.getElementById('formDoc').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msgDoc = document.getElementById('msgDoc');
    const file = document.getElementById('docFile').files[0];
    if (!file) { msgDoc.innerHTML = '<div class="err">Selecciona un fichero</div>'; return; }
    const fd = new FormData();
    fd.append('documento', file);
    fd.append('tipo', document.getElementById('docTipo').value);
    try {
      await api('POST', '/api/empleados/' + id + '/documentos', fd);
      vistaFichaEmpleado(id);
    } catch (err) {
      msgDoc.innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  });

  // ─── PIN / QR (FASE 2) ───
  document.getElementById('formPin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msgPin = document.getElementById('msgPin');
    const pin = document.getElementById('pinInput').value.trim();
    try {
      await api('POST', '/api/empleados/' + id + '/pin', { pin });
      msgPin.innerHTML = '<div class="ok-msg">PIN guardado correctamente</div>';
      vistaFichaEmpleado(id);
    } catch (err) {
      msgPin.innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  });
  const btnQuitarPin = document.getElementById('btnQuitarPin');
  if (btnQuitarPin) {
    btnQuitarPin.addEventListener('click', async () => {
      if (!confirm('¿Quitar el PIN de este empleado?')) return;
      try {
        await api('DELETE', '/api/empleados/' + id + '/pin');
        vistaFichaEmpleado(id);
      } catch (err) {
        document.getElementById('msgPin').innerHTML = `<div class="err">${esc(err.message)}</div>`;
      }
    });
  }

  await cargarQr(id, !!e.qr_token);
  document.getElementById('btnRegenQr').addEventListener('click', async () => {
    try {
      await api('POST', '/api/empleados/' + id + '/qr/regenerar');
      await cargarQr(id, true);
    } catch (err) {
      document.getElementById('msgQr').innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  });
}

async function cargarQr(id, tiene) {
  const box = document.getElementById('qrBox');
  if (!tiene) { box.innerHTML = '<div class="empty">Sin QR asignado todavía</div>'; return; }
  try {
    const r = await api('GET', '/api/empleados/' + id + '/qr');
    box.innerHTML = `<img src="${r.imagen}" alt="QR del empleado">
      <div><small class="hint">Imprime este QR y dáselo al empleado para fichar sin PIN.</small>
      <div class="actions"><a class="btn sm sec" href="${r.imagen}" download="qr-empleado-${id}.png">Descargar</a></div></div>`;
  } catch (err) {
    box.innerHTML = `<div class="err">${esc(err.message)}</div>`;
  }
}

function renderDocs(docs) {
  if (!docs || !docs.length) return '<div class="empty">Sin documentos</div>';
  return docs.map((d) => `<li>
    <span>📄 ${esc(d.nombre_fichero)} <small style="color:#999">(${esc(d.tipo)})</small></span>
    <span>
      <a class="btn sm sec" href="${BASE}/api/documentos/${d.id}/descargar">Descargar</a>
      <button class="btn sm d" onclick="borrarDocumento(${d.id})">Borrar</button>
    </span>
  </li>`).join('');
}

window.borrarDocumento = async function (docId) {
  if (!confirm('¿Borrar este documento?')) return;
  try {
    await api('DELETE', '/api/documentos/' + docId);
    location.reload();
  } catch (e) {
    alert(e.message);
  }
};

// ─── Vista: departamentos ───
async function vistaDepartamentos() {
  app.innerHTML = `<h1>Departamentos</h1><p class="muted">Ejemplo inicial: Recepción, Pisos, Mantenimiento. Puedes editarlos.</p>
    ${tabs('departamentos')}
    <div class="box">
      <div id="listaDep" class="empty">Cargando…</div>
      <form id="formNuevoDep" style="display:flex;gap:8px;margin-top:14px">
        <input type="text" id="nuevoDepNombre" placeholder="Nombre del nuevo departamento" style="flex:1">
        <button class="btn sm" type="submit">Añadir</button>
      </form>
      <div id="msgDep"></div>
    </div>`;
  await renderListaDepartamentos();
  document.getElementById('formNuevoDep').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = document.getElementById('nuevoDepNombre');
    const msg = document.getElementById('msgDep');
    try {
      await api('POST', '/api/departamentos', { nombre: input.value.trim() });
      input.value = '';
      await renderListaDepartamentos();
    } catch (e) {
      msg.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  });
}

async function renderListaDepartamentos() {
  const cont = document.getElementById('listaDep');
  await cargarDepartamentos();
  if (!DEPARTAMENTOS.length) { cont.innerHTML = '<div class="empty">Sin departamentos todavía</div>'; return; }
  cont.innerHTML = `<table><tr><th>Nombre</th><th></th></tr>
    ${DEPARTAMENTOS.map((d) => `<tr>
      <td><input value="${esc(d.nombre)}" id="dep_${d.id}" style="max-width:260px"></td>
      <td style="display:flex;gap:6px">
        <button class="btn sm" onclick="guardarDepartamento(${d.id})">Guardar</button>
        <button class="btn sm d" onclick="borrarDepartamento(${d.id})">Borrar</button>
      </td>
    </tr>`).join('')}</table>`;
}

window.guardarDepartamento = async function (id) {
  const nombre = document.getElementById('dep_' + id).value.trim();
  try {
    await api('PUT', '/api/departamentos/' + id, { nombre });
    await renderListaDepartamentos();
  } catch (e) {
    document.getElementById('msgDep').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
};

window.borrarDepartamento = async function (id) {
  if (!confirm('¿Borrar este departamento?')) return;
  try {
    await api('DELETE', '/api/departamentos/' + id);
    await renderListaDepartamentos();
  } catch (e) {
    document.getElementById('msgDep').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
};

// ─── Vista: fichajes (hoy / rango / por empleado + corrección manual) ───
async function vistaFichajes() {
  await cargarDepartamentos();
  app.innerHTML = `<h1>Fichajes</h1><p class="muted">Fichajes del quiosco (PIN/QR) y correcciones manuales. Registro de jornada (RD 8/2019).</p>
    ${tabs('fichajes')}
    <div class="box">
      <div class="toolbar">
        <select id="ffEmpleado"><option value="">Todos los empleados</option></select>
        <input type="date" id="ffDesde">
        <input type="date" id="ffHasta">
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin:0"><input type="checkbox" id="ffHoy" style="width:auto" checked> Solo hoy</label>
        <button class="btn sm" id="btnFiltrar">Filtrar</button>
        <button class="btn sm sec" id="btnNuevoFichaje">➕ Fichaje manual</button>
      </div>
      <div id="tablaFichajes" class="empty">Cargando…</div>
    </div>
    <div class="box" id="boxNuevoFichaje" style="display:none">
      <h2>Nuevo fichaje manual</h2>
      <div class="grid2">
        <div><label>Empleado</label><select id="nfEmpleado"></select></div>
        <div><label>Tipo</label><select id="nfTipo">
          <option value="entrada">Entrada</option><option value="salida">Salida</option>
          <option value="pausa_inicio">Iniciar pausa</option><option value="pausa_fin">Fin de pausa</option>
        </select></div>
      </div>
      <div class="grid2">
        <div><label>Fecha y hora</label><input type="datetime-local" id="nfTs"></div>
        <div><label>Nota</label><input type="text" id="nfNota" placeholder="Motivo de la corrección"></div>
      </div>
      <div id="msgNf"></div>
      <div class="actions">
        <button class="btn" id="btnGuardarNf">Guardar</button>
        <button class="btn sec" id="btnCancelarNf">Cancelar</button>
      </div>
    </div>`;

  const empleados = await api('GET', '/api/empleados?activo=true');
  const opcionesEmp = empleados.map((e2) => `<option value="${e2.id}">${esc(e2.apellidos)}, ${esc(e2.nombre)}</option>`).join('');
  document.getElementById('ffEmpleado').innerHTML += opcionesEmp;
  document.getElementById('nfEmpleado').innerHTML = '<option value="">— Selecciona —</option>' + opcionesEmp;

  const cargar = () => listarFichajes();
  document.getElementById('btnFiltrar').addEventListener('click', cargar);
  document.getElementById('ffHoy').addEventListener('change', () => {
    const solo = document.getElementById('ffHoy').checked;
    document.getElementById('ffDesde').disabled = solo;
    document.getElementById('ffHasta').disabled = solo;
    cargar();
  });
  document.getElementById('ffDesde').disabled = true;
  document.getElementById('ffHasta').disabled = true;

  document.getElementById('btnNuevoFichaje').addEventListener('click', () => {
    document.getElementById('boxNuevoFichaje').style.display = 'block';
  });
  document.getElementById('btnCancelarNf').addEventListener('click', () => {
    document.getElementById('boxNuevoFichaje').style.display = 'none';
  });
  document.getElementById('btnGuardarNf').addEventListener('click', async () => {
    const msg = document.getElementById('msgNf');
    try {
      const empleado_id = document.getElementById('nfEmpleado').value;
      const tipo = document.getElementById('nfTipo').value;
      const tsLocal = document.getElementById('nfTs').value;
      const nota = document.getElementById('nfNota').value.trim();
      if (!empleado_id || !tsLocal) { msg.innerHTML = '<div class="err">Empleado y fecha/hora son obligatorios</div>'; return; }
      await api('POST', '/api/fichajes', { empleado_id, tipo, ts: new Date(tsLocal).toISOString(), nota });
      document.getElementById('boxNuevoFichaje').style.display = 'none';
      cargar();
    } catch (err) {
      msg.innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  });

  cargar();
}

async function listarFichajes() {
  const cont = document.getElementById('tablaFichajes');
  const params = new URLSearchParams();
  const empleadoId = document.getElementById('ffEmpleado').value;
  const soloHoy = document.getElementById('ffHoy').checked;
  if (empleadoId) params.set('empleado_id', empleadoId);
  if (soloHoy) {
    params.set('hoy', 'true');
  } else {
    const desde = document.getElementById('ffDesde').value;
    const hasta = document.getElementById('ffHasta').value;
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
  }
  try {
    const rows = await api('GET', '/api/fichajes?' + params.toString());
    if (!rows.length) { cont.innerHTML = '<div class="empty">Sin fichajes en este filtro</div>'; return; }
    cont.innerHTML = `<table><tr><th>Fecha/hora</th><th>Empleado</th><th>Tipo</th><th>Origen</th><th>Nota</th><th></th></tr>
      ${rows.map((r) => `<tr>
        <td>${new Date(r.ts).toLocaleString('es-ES')}</td>
        <td>${esc(r.apellidos)}, ${esc(r.nombre)}</td>
        <td>${esc(ETIQUETA_TIPO[r.tipo] || r.tipo)}</td>
        <td><span class="pill ${r.origen === 'manual' ? 'baja' : 'ok'}">${esc(r.origen)}${r.creado_por ? ' · ' + esc(r.creado_por) : ''}</span></td>
        <td>${esc(r.nota || '—')}</td>
        <td><button class="btn sm d" onclick="borrarFichaje(${r.id})">Borrar</button></td>
      </tr>`).join('')}</table>`;
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

const ETIQUETA_TIPO = { entrada: 'Entrada', salida: 'Salida', pausa_inicio: 'Iniciar pausa', pausa_fin: 'Fin de pausa' };

window.borrarFichaje = async function (fichajeId) {
  if (!confirm('¿Borrar este fichaje?')) return;
  try {
    await api('DELETE', '/api/fichajes/' + fichajeId);
    listarFichajes();
  } catch (e) {
    alert(e.message);
  }
};

// ─── Vista: Inspección de Trabajo (FASE 3 — registro de jornada legal) ───
async function vistaInspeccion() {
  const empleados = await api('GET', '/api/empleados'); // todos (activos y de baja): histórico inspeccionable
  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const hoyStr = hoy.toISOString().slice(0, 10);

  app.innerHTML = `<h1>Inspección de Trabajo</h1>
    <p class="muted">Registro de jornada legal (RD 8/2019): entrada, salida, pausas y horas efectivas por empleado y día, calculado a partir de los fichajes. Los turnos que cruzan la medianoche se derivan de la secuencia cronológica de fichajes, no del día natural. Los días con fichajes incompletos (p.ej. entrada sin salida) se marcan como incidencia y nunca se inventan horas.</p>
    ${tabs('inspeccion')}
    <div class="box">
      <div class="toolbar">
        <select id="inEmpleado"><option value="">Todos los empleados</option></select>
        <input type="date" id="inDesde" value="${primerDiaMes}">
        <input type="date" id="inHasta" value="${hoyStr}">
        <button class="btn sm" id="btnConsultar">Consultar</button>
        <a class="btn sm sec" id="btnPdf" href="#">📄 Exportar PDF (empleado)</a>
        <a class="btn sm sec" id="btnCsv" href="#">🧾 Exportar CSV</a>
      </div>
      <div id="resInspeccion" class="empty">Elige un periodo y pulsa «Consultar».</div>
    </div>
    <div class="box">
      <h2>🗄️ Retención y trazabilidad</h2>
      <p class="muted">Los fichajes son la fuente del registro legal de jornada y se conservan un mínimo de <b>4 años</b> (RD 8/2019). Esta versión no borra fichajes automáticamente; cualquier limpieza de datos con más de 4 años requerirá una decisión explícita futura. Cada exportación (PDF/CSV) queda registrada abajo con quién la generó y su sello de integridad (SHA-256, garantía de integridad del contenido — no es firma electrónica cualificada).</p>
      <div id="exportLog" class="empty">Cargando…</div>
    </div>`;

  const opcionesEmp = empleados.map((e) => `<option value="${e.id}">${esc(e.apellidos)}, ${esc(e.nombre)}${e.activo ? '' : ' (baja)'}</option>`).join('');
  document.getElementById('inEmpleado').innerHTML += opcionesEmp;

  function actualizarEnlaces() {
    const emp = document.getElementById('inEmpleado').value;
    const desde = document.getElementById('inDesde').value;
    const hasta = document.getElementById('inHasta').value;
    const qsCsv = new URLSearchParams({ desde, hasta });
    if (emp) qsCsv.set('empleado_id', emp);
    document.getElementById('btnCsv').href = BASE + '/api/inspeccion/csv?' + qsCsv.toString();
    const btnPdf = document.getElementById('btnPdf');
    btnPdf.onclick = null;
    if (emp) {
      btnPdf.href = BASE + '/api/inspeccion/pdf?' + new URLSearchParams({ desde, hasta, empleado_id: emp }).toString();
    } else {
      btnPdf.href = '#';
      btnPdf.onclick = (ev) => { ev.preventDefault(); alert('Elige un empleado concreto para exportar a PDF'); };
    }
  }
  ['inEmpleado', 'inDesde', 'inHasta'].forEach((id) => document.getElementById(id).addEventListener('change', actualizarEnlaces));
  actualizarEnlaces();

  document.getElementById('btnConsultar').addEventListener('click', consultarInspeccion);
  await consultarInspeccion();
  await cargarExportLog();
}

async function consultarInspeccion() {
  const cont = document.getElementById('resInspeccion');
  cont.innerHTML = '<div class="empty">Calculando…</div>';
  const emp = document.getElementById('inEmpleado').value;
  const desde = document.getElementById('inDesde').value;
  const hasta = document.getElementById('inHasta').value;
  const params = new URLSearchParams({ desde, hasta });
  if (emp) params.set('empleado_id', emp);
  try {
    const data = await api('GET', '/api/inspeccion?' + params.toString());
    if (!data.empleados.length) { cont.innerHTML = '<div class="empty">Sin empleados</div>'; return; }
    cont.innerHTML = data.empleados.map((s) => `
      <h2 style="margin-top:18px">${esc(s.empleado.apellidos)}, ${esc(s.empleado.nombre)}</h2>
      ${!s.registros.length ? '<div class="empty">Sin fichajes en este periodo</div>' : `<table><tr>
        <th>Fecha</th><th>Entrada</th><th>Salida</th><th>Pausa (min)</th><th>Horas</th><th>Incidencia</th></tr>
        ${s.registros.map((r) => `<tr>
          <td>${esc(r.fecha)}${r.cruza_medianoche ? ' 🌙' : ''}</td>
          <td>${esc(r.entrada_hora || '—')}</td>
          <td>${esc(r.salida_hora || '—')}</td>
          <td>${r.pausa_min}</td>
          <td>${r.horas_trabajadas != null ? r.horas_trabajadas.toFixed(2) : '—'}</td>
          <td>${r.incidencias.length ? `<span class="pill baja">${esc(r.incidencias.join('; '))}</span>` : '—'}</td>
        </tr>`).join('')}
      </table>`}
      <p class="muted" style="margin-top:8px"><b>Total periodo:</b> ${s.totales.dias} día(s) registrados · ${s.totales.horas_totales.toFixed(2)} h totales · ${s.totales.dias_con_incidencia} día(s) con incidencia</p>
    `).join('<hr style="border:none;border-top:1px solid #eef3f5;margin:18px 0">');
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

async function cargarExportLog() {
  const cont = document.getElementById('exportLog');
  try {
    const rows = await api('GET', '/api/export_log');
    if (!rows.length) { cont.innerHTML = '<div class="empty">Todavía no se ha generado ninguna exportación</div>'; return; }
    cont.innerHTML = `<table><tr><th>Fecha</th><th>Generado por</th><th>Empleado</th><th>Periodo</th><th>Formato</th><th>Sello (SHA-256)</th></tr>
      ${rows.map((r) => `<tr>
        <td>${new Date(r.ts).toLocaleString('es-ES')}</td>
        <td>${esc(r.generado_por)}</td>
        <td>${r.empleado_id ? esc(r.apellidos) + ', ' + esc(r.nombre) : 'Todos'}</td>
        <td>${esc(r.desde)} a ${esc(r.hasta)}</td>
        <td>${esc(r.formato.toUpperCase())}</td>
        <td><code style="font-size:11px">${esc(r.hash.slice(0, 16))}…</code></td>
      </tr>`).join('')}</table>`;
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

// ─── Vista: Informes (FASE 4 — horas, coste, "días sin fichaje", comparativa) ───
async function vistaInformes() {
  await cargarDepartamentos();
  const empleados = await api('GET', '/api/empleados'); // activos y de baja: histórico
  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const hoyStr = hoy.toISOString().slice(0, 10);

  app.innerHTML = `<h1>Informes</h1>
    <p class="muted">Horas, coste y comparativa por empleado, departamento y propiedad, calculados a partir de los mismos fichajes que la Inspección de Trabajo. "Días sin fichaje" es un indicador honesto (no una ausencia justificada/injustificada): no hay cuadrantes/turnos previstos todavía, así que no se compara contra ningún horario teórico.</p>
    ${tabs('informes')}
    <div class="box">
      <div class="toolbar">
        <select id="ifDepartamento"><option value="">Todos los departamentos</option></select>
        <select id="ifEmpleado"><option value="">Todos los empleados</option></select>
        <input type="date" id="ifDesde" value="${primerDiaMes}">
        <input type="date" id="ifHasta" value="${hoyStr}">
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin:0"><input type="checkbox" id="ifComparar" style="width:auto"> Comparar con periodo anterior</label>
        <button class="btn sm" id="btnConsultarInforme">Consultar</button>
      </div>
      <div class="toolbar">
        <a class="btn sm sec" id="btnInformePdf" href="#">📄 Exportar PDF</a>
        <a class="btn sm sec" id="btnInformeCsv" href="#">🧾 Exportar CSV</a>
        <button class="btn sm sec" id="btnEnviarCorreo">✉️ Enviar por correo</button>
      </div>
      <div id="msgInforme"></div>
      <div id="resInforme" class="empty">Elige un periodo y pulsa «Consultar».</div>
    </div>`;

  const opcionesDep = DEPARTAMENTOS.map((d) => `<option value="${d.id}">${esc(d.nombre)}</option>`).join('');
  document.getElementById('ifDepartamento').innerHTML += opcionesDep;
  const opcionesEmp = empleados.map((e) => `<option value="${e.id}">${esc(e.apellidos)}, ${esc(e.nombre)}${e.activo ? '' : ' (baja)'}</option>`).join('');
  document.getElementById('ifEmpleado').innerHTML += opcionesEmp;

  function paramsInforme() {
    const params = new URLSearchParams({
      desde: document.getElementById('ifDesde').value,
      hasta: document.getElementById('ifHasta').value,
    });
    const dep = document.getElementById('ifDepartamento').value;
    const emp = document.getElementById('ifEmpleado').value;
    if (dep) params.set('departamento_id', dep);
    if (emp) params.set('empleado_id', emp);
    return params;
  }

  function actualizarEnlaces() {
    const params = paramsInforme();
    if (document.getElementById('ifComparar').checked) params.set('comparar', 'true');
    document.getElementById('btnInformePdf').href = BASE + '/api/informes/pdf?' + params.toString();
    document.getElementById('btnInformeCsv').href = BASE + '/api/informes/csv?' + params.toString();
  }
  ['ifDepartamento', 'ifEmpleado', 'ifDesde', 'ifHasta', 'ifComparar'].forEach((id) =>
    document.getElementById(id).addEventListener('change', actualizarEnlaces));
  actualizarEnlaces();

  document.getElementById('btnConsultarInforme').addEventListener('click', consultarInforme);
  document.getElementById('btnEnviarCorreo').addEventListener('click', async () => {
    const msg = document.getElementById('msgInforme');
    if (!confirm('¿Enviar este informe por correo? En modo test no se envía nada real, solo se registra.')) return;
    const params = paramsInforme();
    try {
      const body = { desde: document.getElementById('ifDesde').value, hasta: document.getElementById('ifHasta').value };
      const dep = document.getElementById('ifDepartamento').value;
      const emp = document.getElementById('ifEmpleado').value;
      if (dep) body.departamento_id = dep;
      if (emp) body.empleado_id = emp;
      const r = await api('POST', '/api/informes/enviar', body);
      msg.innerHTML = r.modo === 'test'
        ? `<div class="ok-msg">Modo test: NO se ha enviado ningún correo real. Registrado en logs/mail-test.log (destinatario: ${esc(r.destinatario)}).</div>`
        : `<div class="ok-msg">Correo enviado a ${esc(r.destinatario)}.</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  });

  await consultarInforme();
}

function barra(valor, max, color) {
  const pct = max > 0 ? Math.max(2, Math.round((valor / max) * 100)) : 0;
  return `<div style="background:#eef3f5;border-radius:6px;overflow:hidden;height:14px;width:100%">
    <div style="background:${color || 'var(--om)'};height:100%;width:${pct}%"></div>
  </div>`;
}

async function consultarInforme() {
  const cont = document.getElementById('resInforme');
  cont.innerHTML = '<div class="empty">Calculando…</div>';
  document.getElementById('msgInforme').innerHTML = '';
  const params = new URLSearchParams({
    desde: document.getElementById('ifDesde').value,
    hasta: document.getElementById('ifHasta').value,
  });
  const dep = document.getElementById('ifDepartamento').value;
  const emp = document.getElementById('ifEmpleado').value;
  if (dep) params.set('departamento_id', dep);
  if (emp) params.set('empleado_id', emp);
  if (document.getElementById('ifComparar').checked) params.set('comparar', 'true');

  try {
    const inf = await api('GET', '/api/informes?' + params.toString());
    const t = inf.totales;
    const maxHorasDep = Math.max(0, ...inf.departamentos.map((d) => d.horas_totales));

    const costeTotalTxt = t.coste_pendiente_empleados.length
      ? `${t.coste_periodo.toFixed(2)} € <span class="pill baja">excluye coste pendiente de ${t.coste_pendiente_empleados.length}</span>`
      : `${t.coste_periodo.toFixed(2)} €`;

    cont.innerHTML = `
      <div class="grid2" style="margin-bottom:10px">
        <div class="box" style="margin:0"><b>${t.horas_totales.toFixed(2)} h</b><br><small class="hint">Horas totales del periodo</small></div>
        <div class="box" style="margin:0"><b>${t.horas_media.toFixed(2)} h</b><br><small class="hint">Media por jornada trabajada</small></div>
        <div class="box" style="margin:0"><b>${t.dias_trabajados}</b><br><small class="hint">Días trabajados (jornadas)</small></div>
        <div class="box" style="margin:0"><b>${t.dias_con_incidencia}</b><br><small class="hint">Jornadas con incidencia</small></div>
        <div class="box" style="margin:0"><b>${t.dias_sin_fichaje}</b><br><small class="hint">Días sin fichaje (empleados activos)</small></div>
        <div class="box" style="margin:0"><b>${costeTotalTxt}</b><br><small class="hint">Coste del periodo</small></div>
      </div>
      <p class="muted" style="font-size:11px">ℹ️ ${esc(t.nota_dias_sin_fichaje)}</p>
      ${t.coste_pendiente_empleados.length ? `<p class="muted" style="font-size:11px">ℹ️ ${esc(t.nota_coste)} Pendientes: ${esc(t.coste_pendiente_empleados.join(', '))}.</p>` : ''}

      ${inf.comparativa ? `
        <div class="box" style="background:#f5fafc">
          <h2 style="margin-top:0">Comparativa con el periodo anterior</h2>
          <p>Periodo anterior (${esc(inf.comparativa.periodo_anterior.desde)} a ${esc(inf.comparativa.periodo_anterior.hasta)}): <b>${inf.comparativa.periodo_anterior.horas_totales.toFixed(2)} h</b>.
          Variación: <b>${inf.comparativa.variacion_horas >= 0 ? '+' : ''}${inf.comparativa.variacion_horas.toFixed(2)} h</b>
          ${inf.comparativa.variacion_pct != null ? `(${inf.comparativa.variacion_pct >= 0 ? '+' : ''}${inf.comparativa.variacion_pct.toFixed(1)}%)` : ''}</p>
        </div>` : ''}

      <h2>Por departamento</h2>
      ${!inf.departamentos.length ? '<div class="empty">Sin datos</div>' : `<table><tr>
        <th>Departamento</th><th>Horas</th><th></th><th>Días</th><th>Incid.</th><th>S/fichaje</th><th>Coste</th></tr>
        ${inf.departamentos.map((d) => `<tr>
          <td>${esc(d.departamento_nombre)}</td>
          <td>${d.horas_totales.toFixed(2)}</td>
          <td style="width:120px">${barra(d.horas_totales, maxHorasDep)}</td>
          <td>${d.dias_trabajados}</td>
          <td>${d.dias_con_incidencia}</td>
          <td>${d.dias_sin_fichaje}</td>
          <td>${d.coste_periodo.toFixed(2)} €${d.coste_pendiente_empleados.length ? ' *' : ''}</td>
        </tr>`).join('')}
      </table><p class="muted" style="font-size:11px">* Excluye empleados con coste/hora pendiente en ese departamento.</p>`}

      <h2>Por empleado</h2>
      ${!inf.empleados.length ? '<div class="empty">Sin empleados</div>' : `<table><tr>
        <th>Empleado</th><th>Departamento</th><th>Horas</th><th>Media</th><th>Días</th><th>Incid.</th><th>S/fichaje</th><th>Coste</th></tr>
        ${inf.empleados.map((e) => `<tr>
          <td>${esc(e.apellidos)}, ${esc(e.nombre)}${e.activo ? '' : ' <span class="pill baja">baja</span>'}</td>
          <td>${esc(e.departamento_nombre)}</td>
          <td>${e.horas_totales.toFixed(2)}</td>
          <td>${e.horas_media.toFixed(2)}</td>
          <td>${e.dias_trabajados}</td>
          <td>${e.dias_con_incidencia}</td>
          <td>${e.dias_sin_fichaje != null ? e.dias_sin_fichaje : '—'}</td>
          <td>${e.coste_periodo != null ? e.coste_periodo.toFixed(2) + ' €' : '<span class="pill baja">(coste pendiente)</span>'}</td>
        </tr>`).join('')}
      </table>`}
    `;
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

// ─── Vista: Motivación (FASE 5 — mensajes del día + cumples/aniversarios) ───
// Mensajes motivacionales: CRUD por departamento (o "global" = todos). Vista
// de cumpleaños y aniversarios del mes: apoyo para RRHH/recepción, calculada
// en caliente a partir de fecha_nacimiento/fecha_alta (nunca inventada).
async function vistaMotivacion() {
  await cargarDepartamentos();
  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

  app.innerHTML = `<h1>Motivación</h1>
    <p class="muted">Todo lo de aquí se muestra en el <b>quiosco de fichaje</b>: el mensaje del día (rotación automática, por departamento o global) y, si procede, cumpleaños/aniversario de antigüedad de quien ficha o de un/a compañero/a. En el quiosco nunca se muestra la edad ni la fecha de nacimiento de nadie.</p>
    ${tabs('motivacion')}
    <div class="box">
      <h2>💬 Mensajes motivacionales</h2>
      <p class="muted">Si el departamento del empleado no tiene mensajes propios <b>activos</b>, se usan los "Global" (sin departamento). La rotación por el día del año es automática, no hay que elegir cuál toca hoy.</p>
      <div class="toolbar">
        <select id="mmDepartamento"><option value="">Todos (global + por departamento)</option></select>
        <button class="btn" id="btnNuevoMensaje">➕ Nuevo mensaje</button>
      </div>
      <div class="box" id="boxNuevoMensaje" style="display:none;background:#f5fafc" data-edit-id="">
        <div class="grid2">
          <div><label>Departamento</label><select id="nmDepartamento"><option value="">— Global (todos) —</option></select></div>
          <div><label>Activo</label><select id="nmActivo"><option value="true" selected>Sí</option><option value="false">No</option></select></div>
        </div>
        <label>Texto del mensaje</label><textarea id="nmTexto" placeholder="Mensaje motivacional que verá el empleado al fichar…"></textarea>
        <div id="msgNm"></div>
        <div class="actions">
          <button class="btn" id="btnGuardarMensaje">Guardar</button>
          <button class="btn sec" id="btnCancelarMensaje">Cancelar</button>
        </div>
      </div>
      <div id="listaMensajes" class="empty">Cargando…</div>
    </div>
    <div class="box">
      <h2>🎂 Cumpleaños y aniversarios del mes</h2>
      <p class="muted">Vista para tener a la vista los cumpleaños y aniversarios de antigüedad del mes (sin edad, solo el día). Solo empleados activos.</p>
      <div class="toolbar">
        <input type="month" id="mesMotivacion" value="${mesActual}">
        <button class="btn sm" id="btnConsultarMes">Consultar</button>
      </div>
      <div id="resMes" class="empty">Cargando…</div>
    </div>`;

  const opcionesDep = DEPARTAMENTOS.map((d) => `<option value="${d.id}">${esc(d.nombre)}</option>`).join('');
  document.getElementById('mmDepartamento').innerHTML += opcionesDep;
  document.getElementById('nmDepartamento').innerHTML += opcionesDep;

  document.getElementById('mmDepartamento').addEventListener('change', listarMensajes);

  document.getElementById('btnNuevoMensaje').addEventListener('click', () => {
    const box = document.getElementById('boxNuevoMensaje');
    box.dataset.editId = '';
    document.getElementById('nmDepartamento').value = '';
    document.getElementById('nmActivo').value = 'true';
    document.getElementById('nmTexto').value = '';
    document.getElementById('msgNm').innerHTML = '';
    box.style.display = 'block';
  });
  document.getElementById('btnCancelarMensaje').addEventListener('click', () => {
    document.getElementById('boxNuevoMensaje').style.display = 'none';
  });
  document.getElementById('btnGuardarMensaje').addEventListener('click', guardarMensaje);
  document.getElementById('btnConsultarMes').addEventListener('click', consultarMesMotivacion);

  await listarMensajes();
  await consultarMesMotivacion();
}

async function listarMensajes() {
  const cont = document.getElementById('listaMensajes');
  const dep = document.getElementById('mmDepartamento').value;
  const params = new URLSearchParams();
  if (dep) params.set('departamento_id', dep);
  try {
    const rows = await api('GET', '/api/mensajes-motivacionales?' + params.toString());
    window.__MENSAJES_MOTIVACIONALES__ = rows;
    if (!rows.length) { cont.innerHTML = '<div class="empty">Sin mensajes en este filtro</div>'; return; }
    cont.innerHTML = `<table><tr><th>Departamento</th><th>Texto</th><th>Estado</th><th></th></tr>
      ${rows.map((r) => `<tr>
        <td>${r.departamento_id ? esc(r.departamento_nombre) : '<span class="pill baja">Global</span>'}</td>
        <td>${esc(r.texto)}</td>
        <td>${r.activo ? '<span class="pill ok">Activo</span>' : '<span class="pill baja">Inactivo</span>'}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn sm sec" onclick="editarMensajeMotivacional(${r.id})">Editar</button>
          <button class="btn sm" onclick="toggleMensajeMotivacional(${r.id})">${r.activo ? 'Desactivar' : 'Activar'}</button>
          <button class="btn sm d" onclick="borrarMensajeMotivacional(${r.id})">Borrar</button>
        </td>
      </tr>`).join('')}</table>`;
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

async function guardarMensaje() {
  const msg = document.getElementById('msgNm');
  const box = document.getElementById('boxNuevoMensaje');
  const editId = box.dataset.editId;
  const body = {
    departamento_id: document.getElementById('nmDepartamento').value || null,
    texto: document.getElementById('nmTexto').value.trim(),
    activo: document.getElementById('nmActivo').value === 'true',
  };
  try {
    if (editId) {
      await api('PUT', '/api/mensajes-motivacionales/' + editId, body);
    } else {
      await api('POST', '/api/mensajes-motivacionales', body);
    }
    box.style.display = 'none';
    await listarMensajes();
  } catch (e) {
    msg.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

window.editarMensajeMotivacional = function (id) {
  const row = (window.__MENSAJES_MOTIVACIONALES__ || []).find((r) => r.id === id);
  if (!row) return;
  const box = document.getElementById('boxNuevoMensaje');
  box.dataset.editId = id;
  document.getElementById('nmDepartamento').value = row.departamento_id || '';
  document.getElementById('nmActivo').value = row.activo ? 'true' : 'false';
  document.getElementById('nmTexto').value = row.texto;
  document.getElementById('msgNm').innerHTML = '';
  box.style.display = 'block';
};

window.toggleMensajeMotivacional = async function (id) {
  const row = (window.__MENSAJES_MOTIVACIONALES__ || []).find((r) => r.id === id);
  if (!row) return;
  try {
    await api('PUT', '/api/mensajes-motivacionales/' + id, {
      departamento_id: row.departamento_id, texto: row.texto, activo: !row.activo,
    });
    await listarMensajes();
  } catch (e) {
    alert(e.message);
  }
};

window.borrarMensajeMotivacional = async function (id) {
  if (!confirm('¿Borrar este mensaje motivacional?')) return;
  try {
    await api('DELETE', '/api/mensajes-motivacionales/' + id);
    await listarMensajes();
  } catch (e) {
    alert(e.message);
  }
};

async function consultarMesMotivacion() {
  const cont = document.getElementById('resMes');
  cont.innerHTML = '<div class="empty">Calculando…</div>';
  const mes = document.getElementById('mesMotivacion').value;
  try {
    const data = await api('GET', '/api/motivacion/mes?' + new URLSearchParams({ mes }).toString());
    const filas = [
      ...data.cumpleanos.map((e) => ({ dia: e.dia, html: `🎂 ${esc(e.apellidos)}, ${esc(e.nombre)} — cumpleaños` })),
      ...data.aniversarios.map((e) => ({ dia: e.dia, html: `🏆 ${esc(e.apellidos)}, ${esc(e.nombre)} — ${e.anios} año${e.anios === 1 ? '' : 's'} en la empresa` })),
    ].sort((a, b) => a.dia.localeCompare(b.dia));
    if (!filas.length) { cont.innerHTML = '<div class="empty">Sin cumpleaños ni aniversarios este mes</div>'; return; }
    cont.innerHTML = `<table><tr><th>Día</th><th>Evento</th></tr>
      ${filas.map((f) => `<tr><td>${esc(f.dia)}</td><td>${f.html}</td></tr>`).join('')}</table>`;
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

// ─── Vista: Turnos (definiciones de turno) ───
async function vistaTurnos() {
  app.innerHTML = `<h1>Turnos</h1><p class="muted">Catálogo de turnos (horario tipo) usado por Cuadrantes y Comparativa.</p>
    ${tabs('turnos')}
    <div class="box">
      <div class="toolbar">
        <button class="btn" id="btnNuevoTurno">➕ Crear turno</button>
      </div>
      <div class="box" id="boxTurno" style="display:none;background:#f5fafc" data-edit-id=""></div>
      <div id="listaTurnos" class="empty">Cargando…</div>
    </div>`;

  document.getElementById('btnNuevoTurno').addEventListener('click', () => abrirFormularioTurno({}));

  await listarTurnos();
}

function formularioTurno(t) {
  t = t || {};
  return `
    <div class="grid2">
      <div><label>Código *</label><input id="t_codigo" value="${esc(t.codigo)}"></div>
      <div><label>Nombre *</label><input id="t_nombre" value="${esc(t.nombre)}"></div>
    </div>
    <div class="grid2">
      <div><label>Tipo</label><select id="t_tipo">
        <option value="trabajo" ${t.tipo === 'trabajo' || !t.tipo ? 'selected' : ''}>Trabajo</option>
        <option value="libre" ${t.tipo === 'libre' ? 'selected' : ''}>Libre</option>
        <option value="vacaciones" ${t.tipo === 'vacaciones' ? 'selected' : ''}>Vacaciones</option>
        <option value="baja" ${t.tipo === 'baja' ? 'selected' : ''}>Baja</option>
        <option value="otros" ${t.tipo === 'otros' ? 'selected' : ''}>Otros</option>
      </select></div>
      <div><label>Duración (min)</label><input id="t_duracion" type="number" min="0" value="${t.duracion_prevista_min != null ? t.duracion_prevista_min : ''}"></div>
    </div>
    <div class="grid2">
      <div><label>Entrada</label><input id="t_entrada" type="time" value="${esc(t.hora_entrada)}"></div>
      <div><label>Salida</label><input id="t_salida" type="time" value="${esc(t.hora_salida)}"></div>
    </div>
    <div class="grid2">
      <div><label>Tolerancia entrada (min)</label><input id="t_tolE" type="number" min="0" value="${t.tolerancia_entrada_min != null ? t.tolerancia_entrada_min : 0}"></div>
      <div><label>Tolerancia salida (min)</label><input id="t_tolS" type="number" min="0" value="${t.tolerancia_salida_min != null ? t.tolerancia_salida_min : 0}"></div>
    </div>
    <div class="grid2">
      <div><label>Nocturno</label><select id="t_nocturno">
        <option value="false" ${!t.turno_nocturno ? 'selected' : ''}>No</option>
        <option value="true" ${t.turno_nocturno ? 'selected' : ''}>Sí</option>
      </select></div>
      <div><label>Activo</label><select id="t_activo">
        <option value="true" ${t.activo !== false ? 'selected' : ''}>Sí</option>
        <option value="false" ${t.activo === false ? 'selected' : ''}>No</option>
      </select></div>
    </div>`;
}

function leerFormularioTurno() {
  return {
    codigo: document.getElementById('t_codigo').value.trim(),
    nombre: document.getElementById('t_nombre').value.trim(),
    tipo: document.getElementById('t_tipo').value,
    hora_entrada: document.getElementById('t_entrada').value,
    hora_salida: document.getElementById('t_salida').value,
    duracion_prevista_min: document.getElementById('t_duracion').value || null,
    turno_nocturno: document.getElementById('t_nocturno').value === 'true',
    tolerancia_entrada_min: document.getElementById('t_tolE').value || 0,
    tolerancia_salida_min: document.getElementById('t_tolS').value || 0,
    activo: document.getElementById('t_activo').value === 'true',
  };
}

function abrirFormularioTurno(t) {
  const box = document.getElementById('boxTurno');
  box.dataset.editId = t.id || '';
  box.innerHTML = formularioTurno(t) + `<div id="msgTurno"></div>
    <div class="actions">
      <button class="btn" id="btnGuardarTurno">Guardar</button>
      <button class="btn sec" id="btnCancelarTurno">Cancelar</button>
    </div>`;
  document.getElementById('btnGuardarTurno').addEventListener('click', guardarTurno);
  document.getElementById('btnCancelarTurno').addEventListener('click', () => { box.style.display = 'none'; });
  box.style.display = 'block';
}

async function guardarTurno() {
  const box = document.getElementById('boxTurno');
  const msg = document.getElementById('msgTurno');
  const editId = box.dataset.editId;
  try {
    const d = leerFormularioTurno();
    if (editId) {
      await api('PUT', '/api/turnos/' + editId, d);
    } else {
      await api('POST', '/api/turnos', d);
    }
    box.style.display = 'none';
    await listarTurnos();
  } catch (e) {
    msg.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

async function listarTurnos() {
  const cont = document.getElementById('listaTurnos');
  try {
    const rows = await api('GET', '/api/turnos');
    window.__TURNOS__ = rows;
    if (!rows.length) { cont.innerHTML = '<div class="empty">Sin turnos todavía</div>'; return; }
    cont.innerHTML = `<table><tr>
      <th>Código</th><th>Nombre</th><th>Tipo</th><th>Entrada</th><th>Salida</th><th>Duración</th><th>Nocturno</th><th>Tol. E/S</th><th>Activo</th><th></th></tr>
      ${rows.map((t) => `<tr>
        <td><b>${esc(t.codigo)}</b></td>
        <td>${esc(t.nombre)}</td>
        <td>${esc(t.tipo)}</td>
        <td>${esc(t.hora_entrada || '—')}</td>
        <td>${esc(t.hora_salida || '—')}</td>
        <td>${t.duracion_prevista_min != null ? t.duracion_prevista_min + ' min' : '—'}</td>
        <td>${t.turno_nocturno ? '🌙 Sí' : 'No'}</td>
        <td>${t.tolerancia_entrada_min || 0} / ${t.tolerancia_salida_min || 0}</td>
        <td>${t.activo ? '<span class="pill ok">Activo</span>' : '<span class="pill baja">Inactivo</span>'}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn sm sec" onclick="editarTurno(${t.id})">Editar</button>
          ${t.activo ? `<button class="btn sm d" onclick="desactivarTurno(${t.id})">Desactivar</button>` : ''}
        </td>
      </tr>`).join('')}</table>`;
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

window.editarTurno = function (id) {
  const row = (window.__TURNOS__ || []).find((r) => r.id === id);
  if (!row) return;
  abrirFormularioTurno(row);
};

window.desactivarTurno = async function (id) {
  if (!confirm('¿Desactivar este turno? (no se elimina, solo queda inactivo)')) return;
  const row = (window.__TURNOS__ || []).find((r) => r.id === id);
  if (!row) return;
  try {
    // El PUT exige el turno completo (nombre y tipo son obligatorios); solo cambiamos activo.
    await api('PUT', '/api/turnos/' + id, {
      nombre: row.nombre, tipo: row.tipo, hora_entrada: row.hora_entrada, hora_salida: row.hora_salida,
      duracion_prevista_min: row.duracion_prevista_min, turno_nocturno: row.turno_nocturno,
      tolerancia_entrada_min: row.tolerancia_entrada_min, tolerancia_salida_min: row.tolerancia_salida_min,
      activo: false,
    });
    await listarTurnos();
  } catch (e) {
    alert(e.message);
  }
};

// ─── Vista: Cuadrantes (planificación por día/empleado + import CSV) ───
async function vistaCuadrantes() {
  await cargarDepartamentos();
  const empleados = await api('GET', '/api/empleados?activo=true');
  const turnos = await api('GET', '/api/turnos?activo=true').catch(() => []);
  window.__TURNOS_ACTIVOS__ = turnos.filter((t) => t.activo !== false);
  window.__EMPLEADOS_CUADRANTE__ = empleados;

  app.innerHTML = `<h1>Cuadrantes</h1><p class="muted">Planificación de turnos por empleado y día. Fuente para la Comparativa.</p>
    ${tabs('cuadrantes')}
    <div class="box">
      <div class="toolbar">
        <select id="cqEmpleado"><option value="">Todos los empleados</option></select>
        <input type="date" id="cqDesde">
        <input type="date" id="cqHasta">
        <button class="btn sm" id="btnFiltrarCq">Filtrar</button>
        <button class="btn sm sec" id="btnNuevoCq">➕ Crear</button>
        <button class="btn sm sec" id="btnImportarCq">📁 Importar CSV</button>
      </div>
      <div id="tablaCuadrantes" class="empty">Cargando…</div>
    </div>
    <div class="box" id="boxNuevoCq" style="display:none">
      <h2>Nuevo cuadrante</h2>
      <div class="grid2">
        <div><label>Empleado</label><select id="ncEmpleado"></select></div>
        <div><label>Fecha</label><input type="date" id="ncFecha"></div>
      </div>
      <div class="grid2">
        <div><label>Turno</label><select id="ncTurno"></select></div>
        <div><label>Nota</label><input type="text" id="ncNota"></div>
      </div>
      <div id="msgNc"></div>
      <div class="actions">
        <button class="btn" id="btnGuardarNc">Guardar</button>
        <button class="btn sec" id="btnCancelarNc">Cancelar</button>
      </div>
    </div>
    <div class="box" id="boxImportCq" style="display:none">
      <h2>Importar CSV de cuadrante</h2>
      <p class="muted">Cabecera esperada: <code>empleado_id, fecha, codigo_turno, nota</code></p>
      <input type="file" id="csvCq" accept=".csv">
      <div class="actions">
        <button class="btn sm" id="btnValidarCq">Validar</button>
        <button class="btn sm sec" id="btnCancelarImportCq">Cancelar</button>
      </div>
      <div id="resValidacionCq"></div>
    </div>`;

  const opcionesEmp = empleados.map((e) => `<option value="${e.id}">${esc(e.apellidos)}, ${esc(e.nombre)}</option>`).join('');
  document.getElementById('cqEmpleado').innerHTML += opcionesEmp;
  document.getElementById('ncEmpleado').innerHTML = '<option value="">— Selecciona —</option>' + opcionesEmp;
  const opcionesTurno = window.__TURNOS_ACTIVOS__.map((t) => `<option value="${t.id}">${esc(t.codigo)} — ${esc(t.nombre)}</option>`).join('');
  document.getElementById('ncTurno').innerHTML = '<option value="">— Selecciona —</option>' + opcionesTurno;

  const cargar = () => listarCuadrantes();
  document.getElementById('btnFiltrarCq').addEventListener('click', cargar);

  document.getElementById('btnNuevoCq').addEventListener('click', () => {
    document.getElementById('ncEmpleado').disabled = false;
    document.getElementById('ncFecha').disabled = false;
    document.getElementById('ncEmpleado').value = '';
    document.getElementById('ncFecha').value = '';
    document.getElementById('ncTurno').value = '';
    document.getElementById('ncNota').value = '';
    document.getElementById('msgNc').innerHTML = '';
    document.getElementById('btnGuardarNc').onclick = null;
    document.getElementById('boxNuevoCq').style.display = 'block';
    document.getElementById('boxImportCq').style.display = 'none';
  });
  document.getElementById('btnCancelarNc').addEventListener('click', () => {
    document.getElementById('boxNuevoCq').style.display = 'none';
  });
  document.getElementById('btnGuardarNc').addEventListener('click', async () => {
    if (document.getElementById('btnGuardarNc').onclick) return; // en modo edición, editarCuadrante gestiona el click
    const msg = document.getElementById('msgNc');
    try {
      const empleado_id = document.getElementById('ncEmpleado').value;
      const fecha = document.getElementById('ncFecha').value;
      const turno_config_id = document.getElementById('ncTurno').value;
      const nota = document.getElementById('ncNota').value.trim();
      if (!empleado_id || !fecha || !turno_config_id) { msg.innerHTML = '<div class="err">Empleado, fecha y turno son obligatorios</div>'; return; }
      await api('POST', '/api/cuadrante', { empleado_id, fecha, turno_config_id, nota });
      document.getElementById('boxNuevoCq').style.display = 'none';
      cargar();
    } catch (err) {
      msg.innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  });

  document.getElementById('btnImportarCq').addEventListener('click', () => {
    document.getElementById('boxImportCq').style.display = 'block';
    document.getElementById('boxNuevoCq').style.display = 'none';
    document.getElementById('resValidacionCq').innerHTML = '';
  });
  document.getElementById('btnCancelarImportCq').addEventListener('click', () => {
    document.getElementById('boxImportCq').style.display = 'none';
  });
  document.getElementById('btnValidarCq').addEventListener('click', validarImportCuadrante);

  cargar();
}

async function listarCuadrantes() {
  const cont = document.getElementById('tablaCuadrantes');
  const params = new URLSearchParams();
  const emp = document.getElementById('cqEmpleado').value;
  const desde = document.getElementById('cqDesde').value;
  const hasta = document.getElementById('cqHasta').value;
  if (emp) params.set('empleado_id', emp);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  try {
    const rows = await api('GET', '/api/cuadrante?' + params.toString());
    window.__CUADRANTES__ = rows;
    if (!rows.length) { cont.innerHTML = '<div class="empty">Sin cuadrantes en este filtro</div>'; return; }
    cont.innerHTML = `<table><tr><th>Empleado</th><th>Fecha</th><th>Turno</th><th>Nota</th><th></th></tr>
      ${rows.map((r) => `<tr>
        <td>${esc(r.apellidos)}, ${esc(r.nombre)}</td>
        <td>${esc(r.fecha)}</td>
        <td>${esc(r.turno_codigo || '—')}</td>
        <td>${esc(r.nota || '—')}</td>
        <td style="display:flex;gap:6px">
          <button class="btn sm sec" onclick="editarCuadrante(${r.id})">Editar</button>
          <button class="btn sm d" onclick="borrarCuadrante(${r.id})">Eliminar</button>
        </td>
      </tr>`).join('')}</table>`;
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

window.editarCuadrante = function (id) {
  const row = (window.__CUADRANTES__ || []).find((r) => r.id === id);
  if (!row) return;
  document.getElementById('boxNuevoCq').style.display = 'block';
  document.getElementById('boxImportCq').style.display = 'none';
  document.getElementById('ncEmpleado').value = row.empleado_id;
  document.getElementById('ncFecha').value = row.fecha;
  document.getElementById('ncEmpleado').disabled = true;
  document.getElementById('ncFecha').disabled = true;
  document.getElementById('ncTurno').value = row.turno_config_id || '';
  document.getElementById('ncNota').value = row.nota || '';
  const btn = document.getElementById('btnGuardarNc');
  btn.onclick = async () => {
    const msg = document.getElementById('msgNc');
    try {
      await api('PUT', '/api/cuadrante/' + id, {
        turno_config_id: document.getElementById('ncTurno').value,
        nota: document.getElementById('ncNota').value.trim(),
      });
      document.getElementById('boxNuevoCq').style.display = 'none';
      btn.onclick = null;
      await listarCuadrantes();
    } catch (err) {
      msg.innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  };
};

window.borrarCuadrante = async function (id) {
  if (!confirm('¿Eliminar este cuadrante?')) return;
  try {
    await api('DELETE', '/api/cuadrante/' + id);
    await listarCuadrantes();
  } catch (e) {
    alert(e.message);
  }
};

async function validarImportCuadrante() {
  const cont = document.getElementById('resValidacionCq');
  const file = document.getElementById('csvCq').files[0];
  if (!file) { cont.innerHTML = '<div class="err">Selecciona un fichero CSV</div>'; return; }
  cont.innerHTML = '<div class="empty">Validando…</div>';
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await api('POST', '/api/cuadrante/import/validar', fd);
    window.__IMPORT_CQ__ = r;
    const errores = [...(r.errores || []), ...(r.duplicados || [])];
    let html = `<p style="margin-top:10px"><b>${r.filas_ok}</b> fila(s) válidas · <b>${errores.length}</b> error(es)</p>`;
    if (errores.length) {
      html += `<table class="import-errores"><tr><th>Fila</th><th>Motivo</th></tr>
        ${errores.map((e) => `<tr><td>${esc(e.fila)}</td><td>${esc(e.motivo)}</td></tr>`).join('')}</table>
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin-top:10px">
          <input type="checkbox" id="chkSoloValidas" style="width:auto"> Aplicar solo filas válidas
        </label>`;
    }
    html += `<div class="actions">
      <button class="btn" id="btnConfirmarImportCq" ${errores.length ? 'disabled' : ''}>Confirmar importación</button>
    </div>
    <div id="msgConfirmCq"></div>`;
    cont.innerHTML = html;
    if (errores.length) {
      const chk = document.getElementById('chkSoloValidas');
      const btn = document.getElementById('btnConfirmarImportCq');
      chk.addEventListener('change', () => { btn.disabled = !chk.checked; });
    }
    document.getElementById('btnConfirmarImportCq').addEventListener('click', confirmarImportCuadrante);
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

async function confirmarImportCuadrante() {
  const msg = document.getElementById('msgConfirmCq');
  const r = window.__IMPORT_CQ__;
  if (!r) return;
  const errores = [...(r.errores || []), ...(r.duplicados || [])];
  const chk = document.getElementById('chkSoloValidas');
  try {
    const res = await api('POST', '/api/cuadrante/import/confirmar', {
      hash_validacion: r.hash,
      aplica_solo_filas_validas: errores.length ? !!(chk && chk.checked) : false,
    });
    msg.innerHTML = `<div class="ok-msg">${res.filas_aplicadas} fila(s) importadas</div>`;
    document.getElementById('boxImportCq').style.display = 'none';
    await listarCuadrantes();
  } catch (e) {
    msg.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

// ─── Vista: Comparativa (previsto vs real) ───
function pillEstadoComparativa(estado) {
  const map = {
    CORRECTO: 'ok', RETRASO: 'warn', SALIDA_ANTICIPADA: 'warn',
    AUSENCIA: 'err', INCOMPLETO: 'err', INCONSISTENTE: 'err', HORAS_EXTRA: 'info',
  };
  const iconos = { CORRECTO: '✓ ' };
  const clase = map[estado] || 'baja';
  return `<span class="pill ${clase}">${esc(iconos[estado] || '')}${esc(estado || '—')}</span>`;
}

function pillSource(source) {
  if (source === 'PLAN_B') return '<span class="pill est">⚠️ PLAN_B (estimado)</span>';
  if (source === 'SCHEDULE') return '<span class="pill ok">SCHEDULE</span>';
  return '<span class="pill baja">N/A</span>';
}

async function vistaComparativa() {
  await cargarDepartamentos();
  const empleados = await api('GET', '/api/empleados');
  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const hoyStr = hoy.toISOString().slice(0, 10);

  app.innerHTML = `<h1>Comparativa</h1><p class="muted">Turno previsto (cuadrante) frente a lo realmente fichado.</p>
    ${tabs('comparativa')}
    <div class="box">
      <div class="toolbar">
        <a class="btn sm sec" id="btnCmpPdf" href="#">📄 Exportar PDF</a>
        <a class="btn sm sec" id="btnCmpCsv" href="#">🧾 Exportar CSV</a>
      </div>
      <div class="toolbar">
        <select id="cmEmpleado"><option value="">Todos los empleados</option></select>
        <select id="cmDepartamento"><option value="">Todos los departamentos</option></select>
        <input type="date" id="cmDesde" value="${primerDiaMes}">
        <input type="date" id="cmHasta" value="${hoyStr}">
        <select id="cmEstado"><option value="">Todos los estados</option>
          <option>CORRECTO</option><option>RETRASO</option><option>SALIDA_ANTICIPADA</option>
          <option>AUSENCIA</option><option>INCOMPLETO</option><option>INCONSISTENTE</option><option>HORAS_EXTRA</option>
        </select>
        <select id="cmSource"><option value="">Todo origen</option>
          <option value="SCHEDULE">SCHEDULE</option><option value="PLAN_B">PLAN_B</option><option value="N/A">N/A</option>
        </select>
        <button class="btn sm" id="btnFiltrarCmp">Filtrar</button>
      </div>
      <div id="tablaComparativa" class="empty">Cargando…</div>
    </div>`;

  const opcionesEmp = empleados.map((e) => `<option value="${e.id}">${esc(e.apellidos)}, ${esc(e.nombre)}</option>`).join('');
  document.getElementById('cmEmpleado').innerHTML += opcionesEmp;
  document.getElementById('cmDepartamento').innerHTML += DEPARTAMENTOS.map((d) => `<option value="${d.id}">${esc(d.nombre)}</option>`).join('');

  function paramsCmp() {
    const params = new URLSearchParams();
    const emp = document.getElementById('cmEmpleado').value;
    const dep = document.getElementById('cmDepartamento').value;
    const desde = document.getElementById('cmDesde').value;
    const hasta = document.getElementById('cmHasta').value;
    const estado = document.getElementById('cmEstado').value;
    const source = document.getElementById('cmSource').value;
    if (emp) params.set('empleado_id', emp);
    if (dep) params.set('departamento_id', dep);
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    if (estado) params.set('estado', estado);
    if (source) params.set('source', source);
    return params;
  }

  function actualizarEnlacesCmp() {
    const p = paramsCmp();
    document.getElementById('btnCmpPdf').href = BASE + '/api/comparativa/export?formato=pdf&' + p.toString();
    document.getElementById('btnCmpCsv').href = BASE + '/api/comparativa/export?formato=csv&' + p.toString();
  }
  ['cmEmpleado', 'cmDepartamento', 'cmDesde', 'cmHasta', 'cmEstado', 'cmSource'].forEach((id) =>
    document.getElementById(id).addEventListener('change', actualizarEnlacesCmp));
  actualizarEnlacesCmp();

  const cargar = async () => {
    actualizarEnlacesCmp();
    const cont = document.getElementById('tablaComparativa');
    cont.innerHTML = '<div class="empty">Cargando…</div>';
    try {
      const data = await api('GET', '/api/comparativa?' + paramsCmp().toString());
      const source = document.getElementById('cmSource').value;
      const rows = (data.resultados || []).filter((r) => !source || r.source === source);
      if (!rows.length) { cont.innerHTML = '<div class="empty">Sin resultados</div>'; return; }
      cont.innerHTML = `<table><tr>
        <th>Empleado</th><th>Fecha</th><th>Turno</th><th>Estado</th><th>Source</th><th>H. esperadas</th><th>H. trabajadas</th><th>Detalle</th></tr>
        ${rows.map((r) => `<tr>
          <td>${esc(r.apellidos)}, ${esc(r.nombre)}</td>
          <td>${esc(r.fecha)}</td>
          <td>${esc(r.turno_codigo || '—')}</td>
          <td>${pillEstadoComparativa(r.estado)}</td>
          <td>${pillSource(r.source)}</td>
          <td>${r.horas_esperadas != null ? r.horas_esperadas.toFixed(2) : '—'}</td>
          <td>${r.horas_trabajadas != null ? r.horas_trabajadas.toFixed(2) : '—'}</td>
          <td>${esc(r.detalle || '—')}</td>
        </tr>`).join('')}</table>`;
    } catch (e) {
      cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  };
  document.getElementById('btnFiltrarCmp').addEventListener('click', cargar);
  await cargar();
}

// ─── Vista: Vacaciones / Ausencias ───
async function vistaVacaciones() {
  const empleados = await api('GET', '/api/empleados?activo=true');
  app.innerHTML = `<h1>Vacaciones</h1><p class="muted">Solicitudes de ausencia (vacaciones, baja, otros) y su aprobación.</p>
    ${tabs('vacaciones')}
    <div class="box">
      <div class="toolbar">
        <select id="vqEmpleado"><option value="">Todos los empleados</option></select>
        <select id="vqEstado"><option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option><option value="aprobada">Aprobada</option>
          <option value="rechazada">Rechazada</option><option value="cancelada">Cancelada</option>
        </select>
        <input type="date" id="vqDesde">
        <input type="date" id="vqHasta">
        <button class="btn sm" id="btnFiltrarVq">Filtrar</button>
        <button class="btn sm sec" id="btnNuevaSolicitud">➕ Solicitar</button>
      </div>
      <div id="tablaVacaciones" class="empty">Cargando…</div>
    </div>
    <div class="box" id="boxNuevaSolicitud" style="display:none">
      <h2>Nueva solicitud</h2>
      <div class="grid2">
        <div><label>Empleado</label><select id="vsEmpleado"></select></div>
        <div><label>Tipo</label><select id="vsTipo">
          <option value="vacaciones">Vacaciones</option><option value="baja">Baja</option><option value="otros">Otros</option>
        </select></div>
      </div>
      <div class="grid2">
        <div><label>Desde</label><input type="date" id="vsDesde"></div>
        <div><label>Hasta</label><input type="date" id="vsHasta"></div>
      </div>
      <div class="grid2">
        <div><label>Días</label><input type="number" min="0" step="0.5" id="vsDias"></div>
        <div><label>Observaciones</label><input type="text" id="vsObs"></div>
      </div>
      <div id="msgVs"></div>
      <div class="actions">
        <button class="btn" id="btnGuardarVs">Solicitar</button>
        <button class="btn sec" id="btnCancelarVs">Cancelar</button>
      </div>
    </div>
    <div class="modal-bg" id="modalRechazo">
      <div class="modal-box">
        <h2>Rechazar solicitud</h2>
        <label>Notas</label><textarea id="rechazoNotas" placeholder="Motivo del rechazo"></textarea>
        <div id="msgRechazo"></div>
        <div class="actions">
          <button class="btn d" id="btnConfirmarRechazo">Rechazar</button>
          <button class="btn sec" id="btnCancelarRechazo">Cancelar</button>
        </div>
      </div>
    </div>`;

  const opcionesEmp = empleados.map((e) => `<option value="${e.id}">${esc(e.apellidos)}, ${esc(e.nombre)}</option>`).join('');
  document.getElementById('vqEmpleado').innerHTML += opcionesEmp;
  document.getElementById('vsEmpleado').innerHTML = '<option value="">— Selecciona —</option>' + opcionesEmp;

  const cargar = () => listarVacaciones();
  document.getElementById('btnFiltrarVq').addEventListener('click', cargar);
  document.getElementById('btnNuevaSolicitud').addEventListener('click', () => {
    document.getElementById('boxNuevaSolicitud').style.display = 'block';
  });
  document.getElementById('btnCancelarVs').addEventListener('click', () => {
    document.getElementById('boxNuevaSolicitud').style.display = 'none';
  });
  document.getElementById('btnGuardarVs').addEventListener('click', async () => {
    const msg = document.getElementById('msgVs');
    try {
      const body = {
        empleado_id: document.getElementById('vsEmpleado').value,
        tipo: document.getElementById('vsTipo').value,
        fecha_inicio: document.getElementById('vsDesde').value,
        fecha_fin: document.getElementById('vsHasta').value,
        dias: document.getElementById('vsDias').value || null,
        observaciones: document.getElementById('vsObs').value.trim(),
      };
      if (!body.empleado_id || !body.fecha_inicio || !body.fecha_fin || !(Number(body.dias) > 0)) {
        msg.innerHTML = '<div class="err">Empleado, desde, hasta y días (mayor que 0) son obligatorios</div>'; return;
      }
      await api('POST', '/api/ausencias', body);
      document.getElementById('boxNuevaSolicitud').style.display = 'none';
      cargar();
    } catch (err) {
      msg.innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  });
  document.getElementById('btnCancelarRechazo').addEventListener('click', () => {
    document.getElementById('modalRechazo').classList.remove('on');
  });

  cargar();
}

function pillEstadoVacacion(estado) {
  const map = { pendiente: 'warn', aprobada: 'ok', rechazada: 'err', cancelada: 'baja' };
  return `<span class="pill ${map[estado] || 'baja'}">${esc(estado)}</span>`;
}

async function listarVacaciones() {
  const cont = document.getElementById('tablaVacaciones');
  const params = new URLSearchParams();
  const emp = document.getElementById('vqEmpleado').value;
  const estado = document.getElementById('vqEstado').value;
  const desde = document.getElementById('vqDesde').value;
  const hasta = document.getElementById('vqHasta').value;
  if (emp) params.set('empleado_id', emp);
  if (estado) params.set('estado', estado);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  try {
    const rows = await api('GET', '/api/ausencias?' + params.toString());
    window.__VACACIONES__ = rows;
    if (!rows.length) { cont.innerHTML = '<div class="empty">Sin solicitudes en este filtro</div>'; return; }
    cont.innerHTML = `<table><tr>
      <th>Empleado</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th>Días</th><th>Estado</th><th>Aprobador</th><th>Acciones</th></tr>
      ${rows.map((r) => `<tr>
        <td>${esc(r.apellidos)}, ${esc(r.nombre)}</td>
        <td>${esc(r.tipo)}</td>
        <td>${esc(r.fecha_inicio)}</td>
        <td>${esc(r.fecha_fin)}</td>
        <td>${r.dias != null ? r.dias : '—'}</td>
        <td>${pillEstadoVacacion(r.estado)}</td>
        <td>${esc(r.aprobador || '—')}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">${accionesVacacion(r)}</td>
      </tr>`).join('')}</table>`;
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

function accionesVacacion(r) {
  if (r.estado === 'pendiente') {
    return `<button class="btn sm" onclick="aprobarVacacion(${r.id})">Aprobar</button>
      <button class="btn sm d" onclick="abrirRechazoVacacion(${r.id})">Rechazar</button>
      <button class="btn sm d" onclick="borrarVacacion(${r.id})">Eliminar</button>`;
  }
  if (r.estado === 'aprobada') {
    return `<button class="btn sm sec" onclick="cancelarVacacion(${r.id})">Cancelar</button>`;
  }
  return '<span class="hint">Solo lectura</span>';
}

window.aprobarVacacion = async function (id) {
  if (!confirm('¿Aprobar esta solicitud?')) return;
  try {
    await api('PUT', '/api/ausencias/' + id + '/aprobar', {});
    await listarVacaciones();
  } catch (e) {
    alert(e.message);
  }
};

window.abrirRechazoVacacion = function (id) {
  const modal = document.getElementById('modalRechazo');
  document.getElementById('rechazoNotas').value = '';
  document.getElementById('msgRechazo').innerHTML = '';
  modal.classList.add('on');
  document.getElementById('btnConfirmarRechazo').onclick = async () => {
    const msg = document.getElementById('msgRechazo');
    try {
      const observaciones_rechazo = document.getElementById('rechazoNotas').value.trim();
      if (!observaciones_rechazo) { msg.innerHTML = '<div class="err">El motivo del rechazo es obligatorio</div>'; return; }
      await api('PUT', '/api/ausencias/' + id + '/rechazar', { observaciones_rechazo });
      modal.classList.remove('on');
      await listarVacaciones();
    } catch (e) {
      msg.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  };
};

window.cancelarVacacion = async function (id) {
  if (!confirm('¿Cancelar esta solicitud aprobada?')) return;
  try {
    await api('PUT', '/api/ausencias/' + id + '/cancelar', {});
    await listarVacaciones();
  } catch (e) {
    alert(e.message);
  }
};

window.borrarVacacion = async function (id) {
  if (!confirm('¿Eliminar esta solicitud pendiente?')) return;
  try {
    await api('DELETE', '/api/ausencias/' + id);
    await listarVacaciones();
  } catch (e) {
    alert(e.message);
  }
};

// ─── Vista: Auditoría ───
function pillResultadoAuditoria(v) {
  const map = { GREEN: 'ok', AMBER: 'warn', RED: 'err', UNKNOWN: 'baja' };
  return `<span class="pill ${map[v] || 'baja'}">${esc(v || 'UNKNOWN')}</span>`;
}

// El resumen que devuelve /api/auditoria/runs es {total, green, amber, red, unknown};
// se reduce a un único resultado global (RED domina sobre AMBER, luego GREEN, luego UNKNOWN).
function resumenGlobalAuditoria(resumen) {
  if (!resumen) return 'UNKNOWN';
  if (resumen.red > 0) return 'RED';
  if (resumen.amber > 0) return 'AMBER';
  if (resumen.green > 0) return 'GREEN';
  return 'UNKNOWN';
}

async function vistaAuditoria() {
  app.innerHTML = `<h1>Auditoría</h1><p class="muted">Ejecuciones de auditoría de fichajes/cuadrantes y sus controles por empleado.</p>
    ${tabs('auditoria')}
    <div class="box">
      <div class="toolbar">
        <button class="btn" id="btnEjecutarAuditoria">▶️ Ejecutar auditoría</button>
      </div>
    </div>
    <div class="modal-bg" id="modalAuditoria">
      <div class="modal-box">
        <h2>Ejecutar auditoría</h2>
        <div class="grid2">
          <div><label>Desde</label><input type="date" id="auDesde"></div>
          <div><label>Hasta</label><input type="date" id="auHasta"></div>
        </div>
        <div id="msgAuditoria"></div>
        <div class="actions">
          <button class="btn" id="btnConfirmarAuditoria">Ejecutar</button>
          <button class="btn sec" id="btnCancelarAuditoria">Cancelar</button>
        </div>
      </div>
    </div>
    <div class="box">
      <h2>Histórico de ejecuciones</h2>
      <div id="listaRunsAuditoria" class="empty">Cargando…</div>
    </div>`;

  document.getElementById('btnEjecutarAuditoria').addEventListener('click', () => {
    document.getElementById('msgAuditoria').innerHTML = '';
    document.getElementById('modalAuditoria').classList.add('on');
  });
  document.getElementById('btnCancelarAuditoria').addEventListener('click', () => {
    document.getElementById('modalAuditoria').classList.remove('on');
  });
  document.getElementById('btnConfirmarAuditoria').addEventListener('click', async () => {
    const msg = document.getElementById('msgAuditoria');
    try {
      const desde = document.getElementById('auDesde').value;
      const hasta = document.getElementById('auHasta').value;
      if (!desde || !hasta) { msg.innerHTML = '<div class="err">Desde y hasta son obligatorios</div>'; return; }
      await api('POST', '/api/auditoria/ejecutar?' + new URLSearchParams({ desde, hasta }).toString());
      document.getElementById('modalAuditoria').classList.remove('on');
      await listarRunsAuditoria();
    } catch (e) {
      msg.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  });

  await listarRunsAuditoria();
}

async function listarRunsAuditoria() {
  const cont = document.getElementById('listaRunsAuditoria');
  try {
    const runs = await api('GET', '/api/auditoria/runs');
    if (!runs.length) { cont.innerHTML = '<div class="empty">Todavía no se ha ejecutado ninguna auditoría</div>'; return; }
    cont.innerHTML = runs.map((r) => `<details class="run" id="run_${r.id}">
      <summary>${new Date(r.ts).toLocaleString('es-ES')} · ${esc(r.desde)} a ${esc(r.hasta)} · ${esc(r.ejecutado_por || '—')} · ${pillResultadoAuditoria(resumenGlobalAuditoria(r.resumen))}
        <small class="hint" style="display:inline;margin-left:8px">(${r.resumen ? r.resumen.total : 0} controles: ${r.resumen ? r.resumen.green : 0} verde · ${r.resumen ? r.resumen.amber : 0} ámbar · ${r.resumen ? r.resumen.red : 0} rojo)</small>
      </summary>
      <div class="actions" style="margin-top:10px">
        <a class="btn sm sec" href="${BASE}/api/auditoria/runs/${r.id}/export?formato=pdf">📄 Exportar PDF</a>
        <a class="btn sm sec" href="${BASE}/api/auditoria/runs/${r.id}/export?formato=csv">🧾 Exportar CSV</a>
      </div>
      <div id="detalleRun_${r.id}" class="empty" style="margin-top:10px">Sin cargar todavía</div>
    </details>`).join('');
    runs.forEach((r) => {
      document.getElementById('run_' + r.id).addEventListener('toggle', async (ev) => {
        if (!ev.target.open) return;
        const det = document.getElementById('detalleRun_' + r.id);
        if (det.dataset.loaded) return;
        det.innerHTML = '<div class="empty">Cargando…</div>';
        try {
          const detalle = await api('GET', '/api/auditoria/runs/' + r.id);
          const controles = detalle.controles || [];
          det.innerHTML = !controles.length ? '<div class="empty">Sin controles</div>' : `<table><tr>
            <th>Código control</th><th>Empleado</th><th>Estado</th><th>Detalle</th></tr>
            ${controles.map((c) => `<tr>
              <td>${esc(c.codigo_control)}</td>
              <td>${esc(c.apellidos ? c.apellidos + ', ' + c.nombre : '—')}</td>
              <td>${pillResultadoAuditoria(c.estado)}</td>
              <td>${esc(c.detalle || '—')}</td>
            </tr>`).join('')}</table>`;
          det.dataset.loaded = '1';
        } catch (e) {
          det.innerHTML = `<div class="err">${esc(e.message)}</div>`;
        }
      });
    });
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

// ─── Vista: Incidencias ───
// Debe coincidir exactamente con TRANSICIONES_INCIDENCIA del servidor (server.js).
const TRANSICIONES_INCIDENCIA = {
  OPEN: ['IN_PROGRESS', 'DISMISSED'],
  IN_PROGRESS: ['RESOLVED', 'OPEN'],
  RESOLVED: ['OPEN'],
  DISMISSED: ['OPEN'],
};

function pillSeveridad(sev) {
  const map = { alta: 'err', media: 'warn', baja: 'info' };
  return `<span class="pill ${map[sev] || 'baja'}">${esc(sev)}</span>`;
}

function pillEstadoIncidencia(estado) {
  const map = { OPEN: 'warn', IN_PROGRESS: 'info', RESOLVED: 'ok', DISMISSED: 'baja' };
  return `<span class="pill ${map[estado] || 'baja'}">${esc(estado)}</span>`;
}

async function vistaIncidencias() {
  const empleados = await api('GET', '/api/empleados');
  app.innerHTML = `<h1>Incidencias</h1><p class="muted">Incidencias detectadas (manuales o generadas desde auditoría) y su seguimiento.</p>
    ${tabs('incidencias')}
    <div class="box">
      <div class="toolbar">
        <select id="icEmpleado"><option value="">Todos los empleados</option></select>
        <select id="icEstado"><option value="">Todos los estados</option>
          <option value="OPEN">OPEN</option><option value="IN_PROGRESS">IN_PROGRESS</option>
          <option value="RESOLVED">RESOLVED</option><option value="DISMISSED">DISMISSED</option>
        </select>
        <select id="icSeveridad"><option value="">Toda severidad</option>
          <option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
        </select>
        <select id="icOrigen"><option value="">Todo origen</option>
          <option value="auditoria">Auditoría</option><option value="manual">Manual</option>
        </select>
        <input type="date" id="icDesde">
        <input type="date" id="icHasta">
        <button class="btn sm" id="btnFiltrarIc">Filtrar</button>
        <button class="btn sm sec" id="btnGenerarIc">⚙️ Generar desde auditoría</button>
      </div>
      <div id="tablaIncidencias" class="empty">Cargando…</div>
    </div>
    <div class="modal-bg" id="modalGenerarIc">
      <div class="modal-box">
        <h2>Generar incidencias desde auditoría</h2>
        <label>Ejecución de auditoría</label>
        <select id="genRunId"><option value="">Cargando…</option></select>
        <div id="msgGenerarIc"></div>
        <div class="actions">
          <button class="btn" id="btnConfirmarGenerarIc">Generar</button>
          <button class="btn sec" id="btnCancelarGenerarIc">Cancelar</button>
        </div>
      </div>
    </div>
    <div class="modal-bg" id="modalEstadoIc">
      <div class="modal-box">
        <h2>Cambiar estado</h2>
        <select id="nuevoEstadoIc"></select>
        <label>Notas</label><textarea id="notasEstadoIc" placeholder="Motivo del cambio"></textarea>
        <div id="msgEstadoIc"></div>
        <div class="actions">
          <button class="btn" id="btnConfirmarEstadoIc">Guardar</button>
          <button class="btn sec" id="btnCancelarEstadoIc">Cancelar</button>
        </div>
      </div>
    </div>`;

  const opcionesEmp = empleados.map((e) => `<option value="${e.id}">${esc(e.apellidos)}, ${esc(e.nombre)}</option>`).join('');
  document.getElementById('icEmpleado').innerHTML += opcionesEmp;

  const cargar = () => listarIncidencias();
  document.getElementById('btnFiltrarIc').addEventListener('click', cargar);

  document.getElementById('btnGenerarIc').addEventListener('click', async () => {
    document.getElementById('msgGenerarIc').innerHTML = '';
    const sel = document.getElementById('genRunId');
    sel.innerHTML = '<option value="">Cargando…</option>';
    document.getElementById('modalGenerarIc').classList.add('on');
    try {
      const runs = await api('GET', '/api/auditoria/runs');
      if (!runs.length) { sel.innerHTML = '<option value="">Sin ejecuciones de auditoría</option>'; return; }
      sel.innerHTML = runs.map((r) => `<option value="${r.id}">${esc(r.desde)} a ${esc(r.hasta)} — ${new Date(r.ts).toLocaleString('es-ES')}</option>`).join('');
    } catch (e) {
      sel.innerHTML = `<option value="">Error: ${esc(e.message)}</option>`;
    }
  });
  document.getElementById('btnCancelarGenerarIc').addEventListener('click', () => {
    document.getElementById('modalGenerarIc').classList.remove('on');
  });
  document.getElementById('btnConfirmarGenerarIc').addEventListener('click', async () => {
    const msg = document.getElementById('msgGenerarIc');
    const runId = document.getElementById('genRunId').value;
    if (!runId) { msg.innerHTML = '<div class="err">Selecciona una ejecución</div>'; return; }
    try {
      const r = await api('POST', '/api/incidencias/generar?origen=auditoria&auditoria_run_id=' + runId);
      msg.innerHTML = `<div class="ok-msg">${r.creadas} incidencia(s) nueva(s) generadas (${r.duplicadas} ya existían)</div>`;
      await cargar();
    } catch (e) {
      msg.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  });
  document.getElementById('btnCancelarEstadoIc').addEventListener('click', () => {
    document.getElementById('modalEstadoIc').classList.remove('on');
  });

  cargar();
}

async function listarIncidencias() {
  const cont = document.getElementById('tablaIncidencias');
  const params = new URLSearchParams();
  const emp = document.getElementById('icEmpleado').value;
  const estado = document.getElementById('icEstado').value;
  const sev = document.getElementById('icSeveridad').value;
  const origen = document.getElementById('icOrigen').value;
  const desde = document.getElementById('icDesde').value;
  const hasta = document.getElementById('icHasta').value;
  if (emp) params.set('empleado_id', emp);
  if (estado) params.set('estado', estado);
  if (sev) params.set('severidad', sev);
  if (origen) params.set('origen', origen);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  try {
    const rows = await api('GET', '/api/incidencias?' + params.toString());
    if (!rows.length) { cont.innerHTML = '<div class="empty">Sin incidencias en este filtro</div>'; return; }
    cont.innerHTML = `<table><tr>
      <th>Empleado</th><th>Fecha</th><th>Tipo</th><th>Severidad</th><th>Estado</th><th>Origen</th><th>Acciones</th></tr>
      ${rows.map((r) => `<tr>
        <td>${esc(r.apellidos ? r.apellidos + ', ' + r.nombre : '—')}</td>
        <td>${esc(r.fecha)}</td>
        <td>${esc(r.tipo)}</td>
        <td>${pillSeveridad(r.severidad)}</td>
        <td>${pillEstadoIncidencia(r.estado)}</td>
        <td>${esc(r.origen)}</td>
        <td><button class="btn sm sec" onclick="cambiarEstadoIncidencia(${r.id}, '${esc(r.estado)}')">Cambiar estado</button></td>
      </tr>`).join('')}</table>`;
  } catch (e) {
    cont.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

window.cambiarEstadoIncidencia = function (id, estadoActual) {
  const permitidos = TRANSICIONES_INCIDENCIA[estadoActual] || [];
  const sel = document.getElementById('nuevoEstadoIc');
  sel.innerHTML = permitidos.length
    ? permitidos.map((e) => `<option value="${e}">${e}</option>`).join('')
    : '<option value="">Sin transiciones disponibles</option>';
  document.getElementById('notasEstadoIc').value = '';
  document.getElementById('msgEstadoIc').innerHTML = '';
  document.getElementById('modalEstadoIc').classList.add('on');
  document.getElementById('btnConfirmarEstadoIc').onclick = async () => {
    const msg = document.getElementById('msgEstadoIc');
    const nuevo = sel.value;
    if (!nuevo) { msg.innerHTML = '<div class="err">No hay un estado válido que elegir</div>'; return; }
    try {
      const notas = document.getElementById('notasEstadoIc').value.trim();
      await api('PUT', '/api/incidencias/' + id + '/estado', { estado: nuevo, notas });
      document.getElementById('modalEstadoIc').classList.remove('on');
      await listarIncidencias();
    } catch (e) {
      msg.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  };
};

// ─── Router ───
async function router() {
  const hash = location.hash || '#/empleados';
  const partes = hash.replace('#/', '').split('/');
  try {
    if (partes[0] === 'departamentos') return await vistaDepartamentos();
    if (partes[0] === 'fichajes') return await vistaFichajes();
    if (partes[0] === 'turnos') return await vistaTurnos();
    if (partes[0] === 'cuadrantes') return await vistaCuadrantes();
    if (partes[0] === 'comparativa') return await vistaComparativa();
    if (partes[0] === 'inspeccion') return await vistaInspeccion();
    if (partes[0] === 'informes') return await vistaInformes();
    if (partes[0] === 'motivacion') return await vistaMotivacion();
    if (partes[0] === 'vacaciones') return await vistaVacaciones();
    if (partes[0] === 'auditoria') return await vistaAuditoria();
    if (partes[0] === 'incidencias') return await vistaIncidencias();
    if (partes[0] === 'quiosco') return await vistaQuiosco();
    if (partes[0] === 'empleados' && partes[1] === 'nuevo') return await vistaNuevoEmpleado();
    if (partes[0] === 'empleados' && partes[1]) return await vistaFichaEmpleado(partes[1]);
    return await vistaEmpleados();
  } catch (e) {
    app.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

// ─── Vista: Quiosco — generar enlace de autorización ───
async function vistaQuiosco() {
  app.innerHTML = `<h1>Quiosco de Fichaje</h1><p class="muted">Generar enlace para configurar un dispositivo como quiosco de fichaje.</p>
    ${tabs('quiosco')}
    <div class="box">
      <h3>🔑 Generar Enlace de Autorización</h3>
      <p>Haz clic en el botón para generar un enlace que puedas compartir con alguien que vaya a configurar una tablet o dispositivo como quiosco de fichaje.</p>
      <button class="btn" id="btnGenerarQuiosco" onclick="generarEnlaceQuiosco()">📋 Generar Enlace</button>
      <div id="resultadoQuiosco"></div>
    </div>`;
}

async function generarEnlaceQuiosco() {
  const btn = document.getElementById('btnGenerarQuiosco');
  const res = document.getElementById('resultadoQuiosco');
  btn.disabled = true;
  btn.textContent = '⏳ Generando...';
  try {
    const data = await api('POST', '/api/admin/kiosk-link');
    res.innerHTML = `<div class="ok" style="margin-top: 16px; padding: 12px; border-radius: 8px; background: #e8f8ef; border-left: 4px solid #27ae60;">
      <b>✅ Enlace generado</b><br><br>
      <div style="background: #fff; padding: 12px; border-radius: 6px; font-family: monospace; word-break: break-all; margin-bottom: 12px; font-size: 12px;">
        ${esc(data.link)}
      </div>
      <button class="btn" onclick="copiarAlPortapapeles('${data.link.replace(/'/g, '\\'')}')" style="background: #27ae60;">📋 Copiar enlace</button>
      <p style="margin-top: 12px; font-size: 12px; color: #555;">${esc(data.info)}</p>
    </div>`;
  } catch (e) {
    res.innerHTML = `<div class="err" style="margin-top: 16px;">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '📋 Generar Enlace';
  }
}

function copiarAlPortapapeles(texto) {
  navigator.clipboard.writeText(texto).then(() => {
    alert('✅ Enlace copiado al portapapeles');
  }).catch(() => {
    alert('❌ No se pudo copiar. Copia manualmente: ' + texto);
  });
}

window.addEventListener('hashchange', router);

(async function init() {
  try {
    const prop = await api('GET', '/api/property');
    document.getElementById('topIcon').textContent = prop.branding.icono_emoji || '👥';
    document.getElementById('topTitle').textContent = 'Personal · ' + prop.nombre;
    document.title = 'Personal · ' + prop.nombre;
    const c = prop.branding.colores || {};
    const root = document.documentElement.style;
    if (c.primario) root.setProperty('--od', c.primario);
    if (c.acento_medio) root.setProperty('--om', c.acento_medio);
    if (c.acento_claro) root.setProperty('--ol', c.acento_claro);
    if (c.terracota) root.setProperty('--tc', c.terracota);
  } catch (e) { /* si falla, se queda con el branding por defecto */ }
  router();
})();
