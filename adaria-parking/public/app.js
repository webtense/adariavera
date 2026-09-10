'use strict';

const tablero = document.getElementById('tablero');
const overlay = document.getElementById('overlay');
const modalContenido = document.getElementById('modal-contenido');
const overlayTarifa = document.getElementById('overlay-tarifa');

let tarifaActual = 10;
let plazasCache = [];

function euros(n) {
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Opciones de método de pago — calcado de btr_parking_siente/public/index.html
// (pestañas "Asignar" y "Cobro"): efectivo, tarjeta, cargo a cuenta, bonificado.
const METODOS_PAGO = [
  { v: '', l: '— Seleccionar —' },
  { v: 'efectivo', l: 'Efectivo' },
  { v: 'tarjeta', l: 'Tarjeta' },
  { v: 'cuenta', l: 'Cargo a cuenta' },
  { v: 'bonificado', l: 'Bonificado' },
];
function opcionesMetodoPago(seleccionado) {
  return METODOS_PAGO.map(
    (m) => `<option value="${m.v}" ${m.v === (seleccionado || '') ? 'selected' : ''}>${m.l}</option>`
  ).join('');
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
function mananaISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function irALogin() {
  window.location.href = '/login.html?next=' + encodeURIComponent(window.location.pathname);
}

async function cargarAjustes() {
  const r = await fetch('/api/ajustes');
  if (r.status === 401) return irALogin();
  const data = await r.json();
  tarifaActual = data.tarifaDiaEur;
  document.getElementById('tarifa-texto').textContent = `Tarifa: ${tarifaActual} €/día`;
  document.getElementById('input-tarifa').value = tarifaActual;
}

async function cargarPlazas() {
  const r = await fetch('/api/plazas');
  if (r.status === 401) return irALogin();
  const data = await r.json();
  plazasCache = data.plazas;
  renderTablero(data.plazas);
}

function renderTablero(plazas) {
  tablero.innerHTML = '';
  let libres = 0, ocupadas = 0, bloqueadas = 0;
  plazas.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = `plaza ${p.estado}`;
    btn.innerHTML = `<span>${p.numero}</span>` + (p.estado === 'ocupada' && p.asignacion.habitacion ? `<span class="hab">${p.asignacion.habitacion}</span>` : '');
    btn.addEventListener('click', () => abrirModalPlaza(p));
    tablero.appendChild(btn);
    if (p.estado === 'libre') libres++;
    else if (p.estado === 'bloqueada') bloqueadas++;
    else ocupadas++;
  });
  document.getElementById('num-libres').textContent = libres;
  document.getElementById('num-ocupadas').textContent = ocupadas;
  document.getElementById('num-bloqueadas').textContent = bloqueadas;
}

// Plazas libres disponibles como destino de un "mover" (excluye la propia origen).
function plazasLibres(excluirNumero) {
  return plazasCache.filter((p) => p.estado === 'libre' && p.numero !== excluirNumero);
}

function cerrarModal() {
  overlay.classList.remove('abierto');
  modalContenido.innerHTML = '';
}

function abrirModalPlaza(plaza) {
  if (plaza.estado === 'libre') {
    renderFormularioAsignar(plaza);
  } else if (plaza.estado === 'bloqueada') {
    renderDetalleBloqueada(plaza);
  } else {
    renderDetalleOcupada(plaza);
  }
  overlay.classList.add('abierto');
}

function renderFormularioAsignar(plaza) {
  modalContenido.innerHTML = `
    <h2>Asignar plaza ${plaza.numero}</h2>
    <div class="plaza-sub">Plaza libre</div>

    <div class="campo">
      <label>Nº de habitación</label>
      <div class="fila-inline">
        <input type="text" id="f-habitacion" placeholder="p.ej. 105">
        <button class="btn-buscar-aci" id="btn-buscar-aci">Buscar en ACI</button>
      </div>
      <p class="aviso" id="aviso-aci"></p>
    </div>

    <div class="campo">
      <label>Huésped</label>
      <input type="text" id="f-huesped" placeholder="Nombre del huésped">
    </div>

    <div class="campo fila-inline">
      <div>
        <label>Fecha entrada</label>
        <input type="date" id="f-entrada" value="${hoyISO()}">
      </div>
      <div>
        <label>Fecha salida</label>
        <input type="date" id="f-salida" value="${mananaISO()}">
      </div>
    </div>

    <div class="campo">
      <label>Notas (opcional)</label>
      <input type="text" id="f-notas" placeholder="Matrícula, observaciones...">
    </div>

    <div class="cobro-bloque">
      <div class="campo fila-inline">
        <div>
          <label>Tarifa/noche (€)</label>
          <input type="number" id="f-tarifa" min="0" step="0.5" value="${tarifaActual}">
        </div>
        <div>
          <label>Importe total (€)</label>
          <input type="number" id="f-importe-input" min="0" step="0.5">
        </div>
      </div>
      <div class="campo fila-inline">
        <div>
          <label>Método de pago</label>
          <select id="f-metodo">${opcionesMetodoPago('')}</select>
        </div>
        <div style="display:flex;align-items:flex-end;padding-bottom:9px;">
          <label style="display:flex;align-items:center;gap:6px;margin:0;font-size:0.85rem;">
            <input type="checkbox" id="f-pagado" style="width:auto;"> Pagado en este momento
          </label>
        </div>
      </div>
      <div class="importe-preview">
        <span>Importe (<span id="f-noches">1</span> noche(s) x <span id="f-tarifa-texto">${tarifaActual}</span> €)</span>
        <span class="valor" id="f-importe">${euros(tarifaActual)}</span>
      </div>
    </div>

    <div class="acciones-modal">
      <button class="btn secundario" id="btn-cancelar-asignar">Cancelar</button>
      <button class="btn primario" id="btn-confirmar-asignar">Asignar plaza</button>
    </div>
    <button class="enlace-secundario" id="btn-ir-bloquear">Bloquear esta plaza (obras, reservada, etc.)</button>
  `;

  document.getElementById('btn-ir-bloquear').addEventListener('click', () => renderFormularioBloquear(plaza));

  let origenAsignacion = 'manual';

  // Recalcula el importe: tarifa × noches. Plaza bonificada → importe 0 y
  // campo bloqueado (calcado de btr_parking_siente recalcImporteAsignar()).
  const actualizarImporte = () => {
    const ent = document.getElementById('f-entrada').value;
    const sal = document.getElementById('f-salida').value;
    const tarifaInput = document.getElementById('f-tarifa');
    const importeInput = document.getElementById('f-importe-input');
    const bonif = document.getElementById('f-metodo').value.toLowerCase() === 'bonificado';
    document.getElementById('f-tarifa-texto').textContent = tarifaInput.value || tarifaActual;
    if (bonif) {
      importeInput.value = '0.00';
      importeInput.readOnly = true;
      importeInput.parentElement.classList.add('deshabilitado');
      document.getElementById('f-importe').textContent = euros(0);
      return;
    }
    importeInput.readOnly = false;
    importeInput.parentElement.classList.remove('deshabilitado');
    if (!ent || !sal) return;
    const noches = Math.max(1, Math.round((new Date(sal) - new Date(ent)) / 86400000));
    const tarifa = parseFloat(tarifaInput.value) || tarifaActual;
    const total = noches * tarifa;
    document.getElementById('f-noches').textContent = noches;
    document.getElementById('f-importe').textContent = euros(total);
    importeInput.value = total.toFixed(2);
  };

  document.getElementById('f-entrada').addEventListener('change', actualizarImporte);
  document.getElementById('f-salida').addEventListener('change', actualizarImporte);
  document.getElementById('f-tarifa').addEventListener('input', actualizarImporte);
  document.getElementById('f-metodo').addEventListener('change', actualizarImporte);
  actualizarImporte();

  document.getElementById('btn-buscar-aci').addEventListener('click', async () => {
    const hab = document.getElementById('f-habitacion').value.trim();
    const aviso = document.getElementById('aviso-aci');
    if (!hab) { aviso.textContent = 'Introduce un número de habitación.'; aviso.className = 'aviso'; return; }
    aviso.textContent = 'Buscando en ACI...';
    aviso.className = 'aviso';
    try {
      const r = await fetch(`/api/aci/habitacion/${encodeURIComponent(hab)}`);
      const data = await r.json();
      if (data.encontrado) {
        document.getElementById('f-huesped').value = data.huesped || '';
        if (data.fechaEntrada) document.getElementById('f-entrada').value = data.fechaEntrada;
        if (data.fechaSalida) document.getElementById('f-salida').value = data.fechaSalida;
        aviso.textContent = `Encontrado en ACI: reserva ${data.reserva || ''}`;
        aviso.className = 'aviso ok';
        origenAsignacion = 'aci';
        actualizarImporte();
      } else {
        aviso.textContent = data.avisoAci || 'No se ha encontrado una reserva activa para esa habitación. Introduce los datos a mano.';
        aviso.className = 'aviso';
        origenAsignacion = 'manual';
      }
    } catch (e) {
      aviso.textContent = 'No se ha podido consultar ACI. Introduce los datos a mano.';
      aviso.className = 'aviso';
      origenAsignacion = 'manual';
    }
  });

  document.getElementById('btn-cancelar-asignar').addEventListener('click', cerrarModal);

  document.getElementById('btn-confirmar-asignar').addEventListener('click', async () => {
    const habitacion = document.getElementById('f-habitacion').value.trim();
    const huespedNombre = document.getElementById('f-huesped').value.trim();
    const fechaEntrada = document.getElementById('f-entrada').value;
    const fechaSalida = document.getElementById('f-salida').value;
    const notas = document.getElementById('f-notas').value.trim();
    const tarifaDia = parseFloat(document.getElementById('f-tarifa').value) || undefined;
    const importeTotal = document.getElementById('f-importe-input').value !== ''
      ? parseFloat(document.getElementById('f-importe-input').value) : undefined;
    const metodoPago = document.getElementById('f-metodo').value || undefined;
    const cobrado = document.getElementById('f-pagado').checked;

    if (!fechaEntrada || !fechaSalida) {
      alert('Indica las fechas de entrada y salida.');
      return;
    }

    const r = await fetch(`/api/plazas/${plaza.numero}/asignar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        habitacion, huespedNombre, fechaEntrada, fechaSalida, notas, origen: origenAsignacion,
        tarifaDia, importeTotal, metodoPago, cobrado,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error || 'No se ha podido asignar la plaza.');
      return;
    }
    cerrarModal();
    cargarPlazas();
  });
}

function renderFormularioBloquear(plaza) {
  modalContenido.innerHTML = `
    <h2>Bloquear plaza ${plaza.numero}</h2>
    <div class="plaza-sub">La plaza queda fuera de servicio hasta que se desbloquee</div>

    <div class="campo">
      <label>Motivo</label>
      <input type="text" id="f-motivo" placeholder="p.ej. obras, reservada dirección...">
    </div>

    <div class="acciones-modal">
      <button class="btn secundario" id="btn-cancelar-bloquear">Cancelar</button>
      <button class="btn peligro" id="btn-confirmar-bloquear">Bloquear plaza</button>
    </div>
  `;

  document.getElementById('btn-cancelar-bloquear').addEventListener('click', () => renderFormularioAsignar(plaza));

  document.getElementById('btn-confirmar-bloquear').addEventListener('click', async () => {
    const motivo = document.getElementById('f-motivo').value.trim();
    if (!motivo) { alert('Indica el motivo del bloqueo.'); return; }
    const r = await fetch(`/api/plazas/${plaza.numero}/bloquear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error || 'No se ha podido bloquear la plaza.');
      return;
    }
    cerrarModal();
    cargarPlazas();
  });
}

function renderDetalleBloqueada(plaza) {
  modalContenido.innerHTML = `
    <h2>Plaza ${plaza.numero}</h2>
    <div class="plaza-sub">Bloqueada</div>

    <div class="detalle-fila"><span>Motivo</span><span>${plaza.bloqueo && plaza.bloqueo.motivo ? plaza.bloqueo.motivo : '—'}</span></div>

    <div class="acciones-modal">
      <button class="btn primario" id="btn-desbloquear">Desbloquear plaza</button>
    </div>
  `;

  document.getElementById('btn-desbloquear').addEventListener('click', async () => {
    if (!confirm(`¿Desbloquear la plaza ${plaza.numero}?`)) return;
    const r = await fetch(`/api/plazas/${plaza.numero}/desbloquear`, { method: 'POST' });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error || 'No se ha podido desbloquear la plaza.');
      return;
    }
    cerrarModal();
    cargarPlazas();
  });
}

function etiquetaMetodoPago(v) {
  const m = METODOS_PAGO.find((x) => x.v === (v || ''));
  return m && m.v ? m.l : '—';
}

// Bloque de cobro reutilizado en dos sitios: el detalle de una plaza ocupada
// y el histórico (donde la asignación puede estar YA LIBERADA/cerrada). Por
// eso NO depende de que la plaza siga ocupada — solo del id de la asignación.
function bloqueEdicionCobro(a) {
  return `
    <div class="cobro-bloque" id="cobro-bloque-${a.id}">
      <div class="detalle-fila"><span>Tarifa aplicada</span><span>${euros(a.tarifaDia)}/día</span></div>
      <div class="detalle-fila"><span>Importe total</span><span id="cobro-importe-vista-${a.id}">${euros(a.importeTotal)}</span></div>
      <div class="detalle-fila ${a.cobrado ? 'cobrado-si' : 'cobrado-no'}" id="cobro-estado-vista-${a.id}">
        <span>Cobrado</span><span>${a.cobrado ? 'Sí' : 'No'}</span>
      </div>
      <div class="detalle-fila"><span>Método de pago</span><span id="cobro-metodo-vista-${a.id}">${etiquetaMetodoPago(a.metodoPago)}</span></div>

      <button class="enlace-secundario" id="ec-toggle-${a.id}" type="button">Editar cobro</button>

      <div id="ec-form-${a.id}" style="display:none;">
        <div class="campo fila-inline">
          <div>
            <label>Tarifa/noche (€)</label>
            <input type="number" id="ec-tarifa-${a.id}" min="0" step="0.5" value="${a.tarifaDia}">
          </div>
          <div>
            <label>Importe total (€)</label>
            <input type="number" id="ec-importe-${a.id}" min="0" step="0.5" value="${a.importeTotal}">
          </div>
        </div>
        <div class="campo fila-inline">
          <div>
            <label>Método de pago</label>
            <select id="ec-metodo-${a.id}">${opcionesMetodoPago(a.metodoPago)}</select>
          </div>
          <div style="display:flex;align-items:flex-end;padding-bottom:9px;">
            <label style="display:flex;align-items:center;gap:6px;margin:0;font-size:0.85rem;">
              <input type="checkbox" id="ec-pagado-${a.id}" ${a.cobrado ? 'checked' : ''} style="width:auto;"> Pagado
            </label>
          </div>
        </div>
        <div class="acciones-modal">
          <button class="btn secundario" id="ec-cancelar-${a.id}" type="button">Cancelar</button>
          <button class="btn primario" id="ec-guardar-${a.id}" type="button">Guardar cobro</button>
        </div>
      </div>
    </div>
  `;
}

// Engancha los listeners del bloque de cobro. `onSaved` se llama tras un PATCH
// correcto (para refrescar el tablero o el histórico según desde dónde se abrió).
function activarBloqueEdicionCobro(a, onSaved) {
  const toggle = document.getElementById(`ec-toggle-${a.id}`);
  const form = document.getElementById(`ec-form-${a.id}`);
  if (!toggle || !form) return;

  const tarifaInput = document.getElementById(`ec-tarifa-${a.id}`);
  const importeInput = document.getElementById(`ec-importe-${a.id}`);
  const metodoSelect = document.getElementById(`ec-metodo-${a.id}`);

  // Bonificado → importe 0 y bloqueado (mismo criterio que al asignar).
  const recalcBonificado = () => {
    const bonif = metodoSelect.value.toLowerCase() === 'bonificado';
    if (bonif) {
      importeInput.value = '0.00';
      importeInput.readOnly = true;
      importeInput.parentElement.classList.add('deshabilitado');
    } else {
      importeInput.readOnly = false;
      importeInput.parentElement.classList.remove('deshabilitado');
    }
  };
  metodoSelect.addEventListener('change', recalcBonificado);
  recalcBonificado();

  toggle.addEventListener('click', () => {
    form.style.display = form.style.display === 'none' ? '' : 'none';
  });

  document.getElementById(`ec-cancelar-${a.id}`).addEventListener('click', () => {
    form.style.display = 'none';
  });

  document.getElementById(`ec-guardar-${a.id}`).addEventListener('click', async () => {
    const body = {
      tarifaDia: tarifaInput.value !== '' ? parseFloat(tarifaInput.value) : undefined,
      importeTotal: importeInput.value !== '' ? parseFloat(importeInput.value) : undefined,
      metodoPago: metodoSelect.value || undefined,
      cobrado: document.getElementById(`ec-pagado-${a.id}`).checked,
    };
    const r = await fetch(`/api/asignaciones/${a.id}/cobro`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error || 'No se ha podido guardar el cobro.');
      return;
    }
    const actualizado = await r.json();
    // Refresco in-situ del bloque (además de recargar plazas/histórico detrás).
    document.getElementById(`cobro-importe-vista-${a.id}`).textContent = euros(actualizado.importe_total);
    const estadoVista = document.getElementById(`cobro-estado-vista-${a.id}`);
    estadoVista.classList.toggle('cobrado-si', actualizado.cobrado);
    estadoVista.classList.toggle('cobrado-no', !actualizado.cobrado);
    estadoVista.querySelector('span:last-child').textContent = actualizado.cobrado ? 'Sí' : 'No';
    document.getElementById(`cobro-metodo-vista-${a.id}`).textContent = etiquetaMetodoPago(actualizado.metodo_pago);
    form.style.display = 'none';
    if (typeof onSaved === 'function') onSaved(actualizado);
  });
}

function renderDetalleOcupada(plaza) {
  const a = plaza.asignacion;
  const libres = plazasLibres(plaza.numero);
  modalContenido.innerHTML = `
    <h2>Plaza ${plaza.numero}</h2>
    <div class="plaza-sub">Ocupada</div>

    <div class="detalle-fila"><span>Habitación</span><span>${a.habitacion || '—'}</span></div>
    <div class="detalle-fila"><span>Huésped</span><span>${a.huespedNombre || '—'}</span></div>
    <div class="detalle-fila"><span>Entrada</span><span>${a.fechaEntrada}</span></div>
    <div class="detalle-fila"><span>Salida</span><span>${a.fechaSalida}</span></div>
    <div class="detalle-fila"><span>Noches</span><span>${a.noches}</span></div>
    ${a.notas ? `<div class="detalle-fila"><span>Notas</span><span>${a.notas}</span></div>` : ''}

    ${bloqueEdicionCobro(a)}

    <div class="campo" id="mover-campo" style="display:none; margin-top:14px;">
      <label>Mover a la plaza</label>
      <select id="f-mover-destino">
        <option value="">— Elegir plaza libre —</option>
        ${libres.map((p) => `<option value="${p.numero}">${p.numero}</option>`).join('')}
      </select>
    </div>

    <div class="acciones-modal">
      <button class="btn secundario" id="btn-mover">Mover</button>
      <button class="btn peligro" id="btn-liberar">Liberar plaza</button>
    </div>
    <div class="acciones-modal" id="mover-acciones" style="display:none;">
      <button class="btn secundario" id="btn-cancelar-mover">Cancelar</button>
      <button class="btn primario" id="btn-confirmar-mover">Confirmar mover</button>
    </div>
  `;

  activarBloqueEdicionCobro(a, () => { cargarPlazas(); });

  document.getElementById('btn-liberar').addEventListener('click', async () => {
    if (!confirm(`¿Liberar la plaza ${plaza.numero}?`)) return;
    const r = await fetch(`/api/plazas/${plaza.numero}/liberar`, { method: 'POST' });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error || 'No se ha podido liberar la plaza.');
      return;
    }
    cerrarModal();
    cargarPlazas();
  });

  document.getElementById('btn-mover').addEventListener('click', () => {
    if (libres.length === 0) { alert('No hay plazas libres a las que mover esta ocupación.'); return; }
    document.getElementById('mover-campo').style.display = '';
    document.getElementById('mover-acciones').style.display = '';
  });
  document.getElementById('btn-cancelar-mover').addEventListener('click', () => {
    document.getElementById('mover-campo').style.display = 'none';
    document.getElementById('mover-acciones').style.display = 'none';
  });
  document.getElementById('btn-confirmar-mover').addEventListener('click', async () => {
    const destinoNumero = parseInt(document.getElementById('f-mover-destino').value, 10);
    if (!destinoNumero) { alert('Elige una plaza de destino.'); return; }
    const r = await fetch(`/api/plazas/${plaza.numero}/mover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinoNumero }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error || 'No se ha podido mover la plaza.');
      return;
    }
    cerrarModal();
    cargarPlazas();
  });
}

// ── Recaudación + histórico (filtro por fecha de entrada) ──────
// Calcado de btr_parking_siente/public/js/app.js loadRecaudacion()/loadListado().
function normalizarAsignacion(row) {
  return {
    id: row.id,
    plazaNumero: row.plaza_numero,
    estado: row.estado,
    habitacion: row.habitacion,
    huespedNombre: row.huesped_nombre,
    fechaEntrada: row.fecha_entrada,
    fechaSalida: row.fecha_salida,
    noches: row.noches,
    tarifaDia: Number(row.tarifa_dia),
    importeTotal: Number(row.importe_total),
    cobrado: row.cobrado,
    metodoPago: row.metodo_pago,
    notas: row.notas,
  };
}

function rangoFiltro() {
  return {
    desde: document.getElementById('recaud-desde').value,
    hasta: document.getElementById('recaud-hasta').value,
  };
}

async function cargarRecaudacion() {
  const { desde, hasta } = rangoFiltro();
  let url = '/api/recaudacion';
  if (desde || hasta) url += `?desde=${desde || ''}&hasta=${hasta || ''}`;
  const cont = document.getElementById('recaud-resumen');
  try {
    const r = await fetch(url);
    if (r.status === 401) return irALogin();
    const d = await r.json();
    const filas = [
      { l: 'Estancias en rango', v: d.total_estancias, cls: '' },
      { l: 'Total facturado', v: euros(d.total_importe), cls: '' },
      { l: 'Cobrado', v: euros(d.cobrado), cls: 'verde' },
      { l: 'Pendiente de cobro', v: euros(d.pendiente), cls: 'naranja' },
    ];
    cont.innerHTML = filas.map((f) => `
      <div class="recaud-fila ${f.cls}"><span class="rl">${f.l}</span><span class="rv">${f.v}</span></div>
    `).join('');
  } catch (e) {
    cont.innerHTML = `<div class="recaud-fila"><span class="rl">Error al calcular recaudación</span></div>`;
  }
}

async function cargarHistorico() {
  const { desde, hasta } = rangoFiltro();
  let url = '/api/asignaciones';
  if (desde || hasta) url += `?desde=${desde || ''}&hasta=${hasta || ''}`;
  const cont = document.getElementById('historico-lista');
  try {
    const r = await fetch(url);
    if (r.status === 401) return irALogin();
    const asignaciones = (await r.json())
      .filter((x) => x.estado !== 'bloqueada')
      .map(normalizarAsignacion);
    if (!asignaciones.length) {
      cont.innerHTML = '<div class="historico-vacio">Sin registros en el periodo</div>';
      return;
    }
    cont.innerHTML = asignaciones.map((a) => `
        <div class="historico-item" data-asig-id="${a.id}">
          <div class="hi-principal">
            <span class="hi-nombre">${a.huespedNombre || '—'} <span class="hi-estado ${a.estado}">${a.estado}</span></span>
            <span class="hi-sub">Plaza ${a.plazaNumero} · Hab. ${a.habitacion || '—'} · ${a.fechaEntrada} → ${a.fechaSalida}</span>
          </div>
          <div class="hi-cobro">
            <span>${euros(a.importeTotal)}</span>
            <span class="${a.cobrado ? 'hi-pagado' : 'hi-pendiente'}">${a.cobrado ? '✓ Pagado' : '⏳ Pendiente'}</span>
          </div>
        </div>
      `).join('');
    cont.querySelectorAll('.historico-item').forEach((el) => {
      const asig = asignaciones.find((x) => String(x.id) === el.dataset.asigId);
      el.addEventListener('click', () => renderEditarCobroHistorico(asig));
    });
  } catch (e) {
    cont.innerHTML = `<div class="historico-vacio">Error: ${e.message}</div>`;
  }
}

// Edición de cobro desde el histórico: funciona igual esté la plaza ocupada,
// liberada o bloqueada — es la vía para corregir un cobro YA CERRADO
// (check-out ya hecho) sin depender de que la plaza siga ocupada.
function renderEditarCobroHistorico(a) {
  modalContenido.innerHTML = `
    <h2>Cobro — Plaza ${a.plazaNumero}</h2>
    <div class="plaza-sub">${a.huespedNombre || '—'} · ${a.fechaEntrada} → ${a.fechaSalida} · estado: ${a.estado}</div>
    ${bloqueEdicionCobro(a)}
    <div class="acciones-modal">
      <button class="btn secundario" id="btn-cerrar-edicion-historico">Cerrar</button>
    </div>
  `;
  activarBloqueEdicionCobro(a, () => { cargarRecaudacion(); cargarHistorico(); cargarPlazas(); });
  document.getElementById('btn-cerrar-edicion-historico').addEventListener('click', cerrarModal);
  overlay.classList.add('abierto');
}

document.getElementById('btn-filtrar-recaudacion').addEventListener('click', () => {
  cargarRecaudacion();
  cargarHistorico();
});

document.getElementById('btn-cerrar').addEventListener('click', cerrarModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrarModal(); });

document.getElementById('btn-editar-tarifa').addEventListener('click', () => {
  overlayTarifa.classList.add('abierto');
});
document.getElementById('btn-cerrar-tarifa').addEventListener('click', () => {
  overlayTarifa.classList.remove('abierto');
});
overlayTarifa.addEventListener('click', (e) => { if (e.target === overlayTarifa) overlayTarifa.classList.remove('abierto'); });

document.getElementById('btn-guardar-tarifa').addEventListener('click', async () => {
  const valor = parseFloat(document.getElementById('input-tarifa').value);
  if (!valor || valor <= 0) { alert('Introduce una tarifa válida.'); return; }
  const r = await fetch('/api/ajustes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tarifaDiaEur: valor }),
  });
  if (r.ok) {
    await cargarAjustes();
    overlayTarifa.classList.remove('abierto');
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

document.getElementById('btn-admin').addEventListener('click', () => {
  window.location.href = '/admin.html';
});

async function cargarMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) return irALogin();
  const me = await r.json();
  document.getElementById('user-label').textContent = me.username + (me.rol === 'admin' ? ' (admin)' : '');
  if (me.rol === 'admin') document.getElementById('btn-admin').style.display = '';
}

cargarMe();
cargarAjustes();
cargarPlazas();
cargarRecaudacion();
cargarHistorico();
setInterval(cargarPlazas, 30000);
