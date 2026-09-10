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

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
function mananaISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function cargarAjustes() {
  const r = await fetch('/api/ajustes');
  const data = await r.json();
  tarifaActual = data.tarifaDiaEur;
  document.getElementById('tarifa-texto').textContent = `Tarifa: ${tarifaActual} €/día`;
  document.getElementById('input-tarifa').value = tarifaActual;
}

async function cargarPlazas() {
  const r = await fetch('/api/plazas');
  const data = await r.json();
  plazasCache = data.plazas;
  renderTablero(data.plazas);
}

function renderTablero(plazas) {
  tablero.innerHTML = '';
  let libres = 0, ocupadas = 0;
  plazas.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = `plaza ${p.estado}`;
    btn.innerHTML = `<span>${p.numero}</span>` + (p.estado === 'ocupada' && p.asignacion.habitacion ? `<span class="hab">${p.asignacion.habitacion}</span>` : '');
    btn.addEventListener('click', () => abrirModalPlaza(p));
    tablero.appendChild(btn);
    if (p.estado === 'libre') libres++; else ocupadas++;
  });
  document.getElementById('num-libres').textContent = libres;
  document.getElementById('num-ocupadas').textContent = ocupadas;
}

function cerrarModal() {
  overlay.classList.remove('abierto');
  modalContenido.innerHTML = '';
}

function abrirModalPlaza(plaza) {
  if (plaza.estado === 'libre') {
    renderFormularioAsignar(plaza);
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

    <div class="importe-preview">
      <span>Importe (<span id="f-noches">1</span> noche(s) x ${tarifaActual} €)</span>
      <span class="valor" id="f-importe">${euros(tarifaActual)}</span>
    </div>

    <div class="acciones-modal">
      <button class="btn secundario" id="btn-cancelar-asignar">Cancelar</button>
      <button class="btn primario" id="btn-confirmar-asignar">Asignar plaza</button>
    </div>
  `;

  let origenAsignacion = 'manual';

  const actualizarImporte = () => {
    const ent = document.getElementById('f-entrada').value;
    const sal = document.getElementById('f-salida').value;
    if (!ent || !sal) return;
    const noches = Math.max(1, Math.round((new Date(sal) - new Date(ent)) / 86400000));
    document.getElementById('f-noches').textContent = noches;
    document.getElementById('f-importe').textContent = euros(noches * tarifaActual);
  };

  document.getElementById('f-entrada').addEventListener('change', actualizarImporte);
  document.getElementById('f-salida').addEventListener('change', actualizarImporte);
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

    if (!fechaEntrada || !fechaSalida) {
      alert('Indica las fechas de entrada y salida.');
      return;
    }

    const r = await fetch(`/api/plazas/${plaza.numero}/asignar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ habitacion, huespedNombre, fechaEntrada, fechaSalida, notas, origen: origenAsignacion }),
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

function renderDetalleOcupada(plaza) {
  const a = plaza.asignacion;
  modalContenido.innerHTML = `
    <h2>Plaza ${plaza.numero}</h2>
    <div class="plaza-sub">Ocupada</div>

    <div class="detalle-fila"><span>Habitación</span><span>${a.habitacion || '—'}</span></div>
    <div class="detalle-fila"><span>Huésped</span><span>${a.huespedNombre || '—'}</span></div>
    <div class="detalle-fila"><span>Entrada</span><span>${a.fechaEntrada}</span></div>
    <div class="detalle-fila"><span>Salida</span><span>${a.fechaSalida}</span></div>
    <div class="detalle-fila"><span>Noches</span><span>${a.noches}</span></div>
    <div class="detalle-fila"><span>Tarifa aplicada</span><span>${euros(a.tarifaDia)}/día</span></div>
    <div class="detalle-fila"><span>Importe total</span><span>${euros(a.importeTotal)}</span></div>
    <div class="detalle-fila ${a.cobrado ? 'cobrado-si' : 'cobrado-no'}">
      <span>Cobrado</span><span>${a.cobrado ? 'Sí' : 'No'}</span>
    </div>
    ${a.notas ? `<div class="detalle-fila"><span>Notas</span><span>${a.notas}</span></div>` : ''}

    <div class="acciones-modal">
      ${!a.cobrado ? `<button class="btn secundario" id="btn-marcar-cobrado">Marcar cobrado</button>` : ''}
      <button class="btn peligro" id="btn-liberar">Liberar plaza</button>
    </div>
  `;

  const btnCobrado = document.getElementById('btn-marcar-cobrado');
  if (btnCobrado) {
    btnCobrado.addEventListener('click', async () => {
      await fetch(`/api/asignaciones/${a.id}/cobrar`, { method: 'POST' });
      cerrarModal();
      cargarPlazas();
    });
  }

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
}

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

cargarAjustes();
cargarPlazas();
setInterval(cargarPlazas, 30000);
