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
    <button class="${active === 'inspeccion' ? 'on' : ''}" onclick="location.hash='#/inspeccion'">📋 Inspección de Trabajo</button>
    <button class="${active === 'informes' ? 'on' : ''}" onclick="location.hash='#/informes'">📊 Informes</button>
    <button class="${active === 'motivacion' ? 'on' : ''}" onclick="location.hash='#/motivacion'">🎉 Motivación</button>
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

// ─── Router ───
async function router() {
  const hash = location.hash || '#/empleados';
  const partes = hash.replace('#/', '').split('/');
  try {
    if (partes[0] === 'departamentos') return await vistaDepartamentos();
    if (partes[0] === 'fichajes') return await vistaFichajes();
    if (partes[0] === 'inspeccion') return await vistaInspeccion();
    if (partes[0] === 'informes') return await vistaInformes();
    if (partes[0] === 'motivacion') return await vistaMotivacion();
    if (partes[0] === 'empleados' && partes[1] === 'nuevo') return await vistaNuevoEmpleado();
    if (partes[0] === 'empleados' && partes[1]) return await vistaFichaEmpleado(partes[1]);
    return await vistaEmpleados();
  } catch (e) {
    app.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
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
