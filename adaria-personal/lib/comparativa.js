'use strict';

// lib/comparativa.js — FASE 7: comparativa fichaje vs cuadrante + Plan B.
//
// Módulo PURO: sin BD, sin Express, sin req/res, sin efectos secundarios.
// server.js carga los datos (turno_config, cuadrante, fichaje, ausencia
// aprobada, config de Plan B) y llama a compararRango()/compararJornada()
// con esos datos ya en memoria. Esto lo hace completamente testeable sin
// levantar Postgres.
//
// Regla general (igual que el resto del proyecto): NUNCA se inventa un
// valor. minutos_retraso/minutos_anticipada/horas_esperadas/horas_trabajadas
// son `null` cuando no se pueden calcular con lo que hay — nunca 0.

const { construirJornadas } = require('./jornadas');

const ESTADOS = {
  CORRECTO: 'CORRECTO',
  RETRASO: 'RETRASO',
  SALIDA_ANTICIPADA: 'SALIDA_ANTICIPADA',
  HORAS_EXTRA: 'HORAS_EXTRA',
  HORAS_INSUFICIENTES: 'HORAS_INSUFICIENTES',
  AUSENCIA: 'AUSENCIA',
  INCOMPLETO: 'INCOMPLETO',
  INCONSISTENTE: 'INCONSISTENTE',
  FICHAJE_SIN_CUADRANTE: 'FICHAJE_SIN_CUADRANTE',
  CUADRANTE_SIN_FICHAJE: 'CUADRANTE_SIN_FICHAJE',
  JUSTIFICADO: 'JUSTIFICADO',
  UNKNOWN: 'UNKNOWN',
  CUADRANTE_AUSENTE: 'CUADRANTE_AUSENTE',
  N_A: 'N/A',
};

function toFechaStr(fecha) {
  if (fecha instanceof Date) return fecha.toLocaleDateString('en-CA');
  return String(fecha);
}

// Convierte una hora TIME ('HH:MM' o 'HH:MM:SS') de turno_config + una fecha
// (YYYY-MM-DD) en un timestamp comparable (ms). No usa zona horaria del
// servidor: asume que `fecha` y `horaStr` ya están en la hora local de la
// propiedad, igual que hace horaEnZona/fechaEnZona en server.js con los
// fichajes reales (comparación a igualdad de representación).
function combinarFechaHora(fechaStr, horaStr) {
  if (!horaStr) return null;
  const hhmm = horaStr.slice(0, 5);
  return new Date(`${fechaStr}T${hhmm}:00`).getTime();
}

function minutosEntre(msA, msB) {
  return Math.round((msA - msB) / 60000);
}

function ausenciaCubreFecha(ausencia, fechaStr) {
  if (!ausencia) return false;
  if (ausencia.estado !== 'aprobada') return false;
  const desde = ausencia.desde || ausencia.fecha_desde;
  const hasta = ausencia.hasta || ausencia.fecha_hasta || desde;
  if (!desde) return false;
  return fechaStr >= toFechaStr(desde) && fechaStr <= toFechaStr(hasta);
}

/**
 * Compara la jornada REAL (fichajes) de UN empleado en UNA fecha contra lo
 * PREVISTO (cuadrante) o, si no hay cuadrante, contra el Plan B.
 *
 * @param {object} params
 * @param {Date|string} params.fecha
 * @param {object|null} params.turno Fila de turno_config, o null si no hay cuadrante.
 * @param {Array<{tipo:string, ts:string|number|Date}>} params.fichajesDelDia Ordenado cronológicamente.
 * @param {object|null} params.ausenciaAprobada Fila de ausencia_justificada (estado='aprobada') que cubre la fecha, o null.
 * @param {{activo:boolean, horasEsperadas:number, toleranciaMin:number}} params.planB
 * @returns {object} resultado normalizado (ver cabecera del módulo/plan Fase 7)
 */
function compararJornada(params) {
  const { fecha, turno, ausenciaAprobada, planB } = params;
  const fichajesDelDia = params.fichajesDelDia || [];
  const fechaStr = toFechaStr(fecha);

  const base = {
    fecha: fechaStr,
    estado: ESTADOS.UNKNOWN,
    source: 'N/A',
    minutos_retraso: null,
    minutos_anticipada: null,
    horas_esperadas: null,
    horas_trabajadas: null,
    detalle: '',
  };

  // 1) Ausencia aprobada que cubre la fecha: manda siempre sobre cuadrante y Plan B.
  if (ausenciaCubreFecha(ausenciaAprobada, fechaStr)) {
    return {
      ...base,
      estado: ESTADOS.JUSTIFICADO,
      source: 'SCHEDULE',
      horas_esperadas: null,
      horas_trabajadas: null,
      detalle: `Ausencia justificada y aprobada (${ausenciaAprobada.tipo || 'sin tipo'}).`,
    };
  }

  // 6) Turno previsto pero no de tipo 'trabajo' (libre, vacaciones, baja, otros):
  //    no se audita como ausencia.
  if (turno && turno.tipo && turno.tipo !== 'trabajo') {
    return {
      ...base,
      estado: ESTADOS.N_A,
      source: 'SCHEDULE',
      detalle: `Turno previsto de tipo "${turno.tipo}": no se audita como jornada de trabajo.`,
    };
  }

  // 2) Turno de trabajo previsto.
  if (turno && turno.tipo === 'trabajo') {
    // 4) Sin fichajes ese día: ausencia (había turno previsto, no hay registro).
    if (fichajesDelDia.length === 0) {
      const horasEsperadas = turno.duracion_prevista_min != null ? Math.round((turno.duracion_prevista_min / 60) * 100) / 100 : null;
      return {
        ...base,
        estado: ESTADOS.AUSENCIA,
        source: 'SCHEDULE',
        horas_esperadas: horasEsperadas,
        horas_trabajadas: null,
        detalle: 'Turno previsto en el cuadrante pero sin ningún fichaje ese día.',
      };
    }

    const jornada = construirJornadas(fichajesDelDia, turno);

    if (jornada.inconsistente) {
      return {
        ...base,
        estado: ESTADOS.INCONSISTENTE,
        source: 'SCHEDULE',
        horas_esperadas: turno.duracion_prevista_min != null ? Math.round((turno.duracion_prevista_min / 60) * 100) / 100 : null,
        horas_trabajadas: null,
        detalle: `Secuencia de fichajes inconsistente: ${jornada.incidencias.join('; ') || 'ver fichajes del día'}.`,
      };
    }

    if (jornada.incompleta) {
      return {
        ...base,
        estado: ESTADOS.INCOMPLETO,
        source: 'SCHEDULE',
        horas_esperadas: turno.duracion_prevista_min != null ? Math.round((turno.duracion_prevista_min / 60) * 100) / 100 : null,
        horas_trabajadas: null,
        detalle: 'Fichaje incompleto (entrada sin salida, o pausa abierta).',
      };
    }

    const horasEsperadas = turno.duracion_prevista_min != null ? Math.round((turno.duracion_prevista_min / 60) * 100) / 100 : null;
    const toleranciaEntrada = turno.tolerancia_entrada_min || 0;
    const toleranciaSalida = turno.tolerancia_salida_min || 0;

    const entradaPrevistaMs = combinarFechaHora(fechaStr, turno.hora_entrada);
    const salidaPrevistaMs = combinarFechaHora(fechaStr, turno.hora_salida);

    let minutosRetraso = null;
    let minutosAnticipada = null;
    let estado = ESTADOS.CORRECTO;
    const detalles = [];

    if (entradaPrevistaMs != null && jornada.entrada != null) {
      const diffEntrada = minutosEntre(new Date(jornada.entrada).getTime(), entradaPrevistaMs);
      if (diffEntrada > toleranciaEntrada) {
        minutosRetraso = diffEntrada;
        estado = ESTADOS.RETRASO;
        detalles.push(`Entrada con ${diffEntrada} min de retraso (tolerancia ${toleranciaEntrada} min).`);
      }
    }

    // Turno nocturno: la hora de salida prevista corresponde al día siguiente
    // (cruza medianoche). Si turno.nocturno (o hora_salida < hora_entrada),
    // la salida prevista se desplaza +1 día para comparar correctamente.
    const esNocturno = turno.turno_nocturno === true || turno.nocturno === true ||
      (turno.hora_entrada && turno.hora_salida && turno.hora_salida < turno.hora_entrada);
    let salidaPrevistaAjustadaMs = salidaPrevistaMs;
    if (esNocturno && salidaPrevistaMs != null) {
      salidaPrevistaAjustadaMs = salidaPrevistaMs + 24 * 3600000;
    }

    if (salidaPrevistaAjustadaMs != null && jornada.salida != null) {
      const diffSalida = minutosEntre(salidaPrevistaAjustadaMs, new Date(jornada.salida).getTime());
      if (diffSalida > toleranciaSalida) {
        minutosAnticipada = diffSalida;
        if (estado === ESTADOS.CORRECTO) estado = ESTADOS.SALIDA_ANTICIPADA;
        detalles.push(`Salida ${diffSalida} min antes de lo previsto (tolerancia ${toleranciaSalida} min).`);
      }
    }

    if (horasEsperadas != null && jornada.horas != null) {
      const excesoHoras = jornada.horas - horasEsperadas;
      if (excesoHoras > 0.25 && estado === ESTADOS.CORRECTO) {
        estado = ESTADOS.HORAS_EXTRA;
        detalles.push(`${excesoHoras.toFixed(2)} h por encima de lo previsto.`);
      }
    }

    if (detalles.length === 0) detalles.push('Jornada dentro de lo previsto.');

    return {
      ...base,
      estado,
      source: 'SCHEDULE',
      minutos_retraso: minutosRetraso,
      minutos_anticipada: minutosAnticipada,
      horas_esperadas: horasEsperadas,
      horas_trabajadas: jornada.horas,
      detalle: detalles.join(' '),
    };
  }

  // 3) Sin cuadrante (turno === null) pero HAY fichajes ese día.
  if (!turno && fichajesDelDia.length > 0) {
    const jornada = construirJornadas(fichajesDelDia, null);

    if (planB && planB.activo) {
      if (jornada.inconsistente) {
        return {
          ...base,
          estado: ESTADOS.INCONSISTENTE,
          source: 'PLAN_B',
          detalle: `Secuencia de fichajes inconsistente: ${jornada.incidencias.join('; ') || 'ver fichajes del día'}.`,
        };
      }
      if (jornada.incompleta) {
        return {
          ...base,
          estado: ESTADOS.INCOMPLETO,
          source: 'PLAN_B',
          horas_esperadas: planB.horasEsperadas != null ? planB.horasEsperadas : null,
          detalle: 'Fichaje incompleto (entrada sin salida, o pausa abierta).',
        };
      }

      const horasEsperadas = planB.horasEsperadas;
      const toleranciaHoras = (planB.toleranciaMin || 0) / 60;
      let estado = ESTADOS.CORRECTO;
      let detalle = 'Sin cuadrante: duración dentro de la tolerancia de Plan B.';
      if (jornada.horas != null && horasEsperadas != null) {
        const diffHoras = jornada.horas - horasEsperadas;
        if (diffHoras < -toleranciaHoras) {
          estado = ESTADOS.HORAS_INSUFICIENTES;
          detalle = `Sin cuadrante: ${Math.abs(diffHoras).toFixed(2)} h por debajo de la jornada estándar de Plan B (${horasEsperadas} h).`;
        } else if (diffHoras > toleranciaHoras) {
          estado = ESTADOS.HORAS_EXTRA;
          detalle = `Sin cuadrante: ${diffHoras.toFixed(2)} h por encima de la jornada estándar de Plan B (${horasEsperadas} h).`;
        }
      }

      return {
        ...base,
        estado,
        source: 'PLAN_B',
        minutos_retraso: null,
        minutos_anticipada: null,
        horas_esperadas: horasEsperadas != null ? horasEsperadas : null,
        horas_trabajadas: jornada.horas,
        detalle,
      };
    }

    // Plan B inactivo: hay trabajo pero no estaba previsto, sin evaluación.
    return {
      ...base,
      estado: ESTADOS.FICHAJE_SIN_CUADRANTE,
      source: 'N/A',
      horas_trabajadas: jornada.horas,
      detalle: 'Fichaje sin cuadrante asignado y Plan B desactivado: no se evalúa.',
    };
  }

  // 5) Sin cuadrante, sin fichajes, sin ausencia aprobada.
  if (!turno && fichajesDelDia.length === 0) {
    return {
      ...base,
      estado: ESTADOS.CUADRANTE_AUSENTE,
      source: 'N/A',
      detalle: 'No hay cuadrante ni fichaje ese día: nada que evaluar.',
    };
  }

  // No debería llegar aquí, pero por seguridad nunca se inventa un estado.
  return base;
}

/**
 * Orquesta compararJornada() por empleado × fecha en un rango.
 *
 * @param {object} params
 * @param {Array<Date|string>} params.fechas
 * @param {Map<string, object>} params.turnosPorEmpleadoFecha Clave `${empleado_id}|${fecha}` → fila turno_config (con datos ya unidos desde cuadrante), o ausente/null si no hay.
 * @param {Map<string, Array>} params.fichajesPorEmpleadoFecha Clave `${empleado_id}|${fecha}` → array de fichajes.
 * @param {Map<number, Array>} params.ausenciasPorEmpleado empleado_id → array de ausencias aprobadas.
 * @param {Array<{id:number, nombre:string, apellidos:string}>} params.empleados
 * @param {{activo:boolean, horasEsperadas:number, toleranciaMin:number}} params.planB
 * @returns {Array<object>} plano: [{empleado_id, nombre, apellidos, ...compararJornada()}, ...]
 */
function compararRango(params) {
  const { fechas, empleados, planB } = params;
  const turnosPorEmpleadoFecha = params.turnosPorEmpleadoFecha || new Map();
  const fichajesPorEmpleadoFecha = params.fichajesPorEmpleadoFecha || new Map();
  const ausenciasPorEmpleado = params.ausenciasPorEmpleado || new Map();

  const clave = (empId, fechaStr) => `${empId}|${fechaStr}`;

  const resultado = [];
  for (const emp of empleados || []) {
    const ausencias = ausenciasPorEmpleado.get(emp.id) || [];
    for (const fecha of fechas || []) {
      const fechaStr = toFechaStr(fecha);
      const k = clave(emp.id, fechaStr);
      const turno = turnosPorEmpleadoFecha.get(k) || null;
      const fichajesDelDia = fichajesPorEmpleadoFecha.get(k) || [];
      const ausenciaAprobada = ausencias.find((a) => ausenciaCubreFecha(a, fechaStr)) || null;

      const r = compararJornada({
        fecha: fechaStr,
        turno,
        fichajesDelDia,
        ausenciaAprobada,
        planB,
      });

      resultado.push({
        empleado_id: emp.id,
        nombre: emp.nombre,
        apellidos: emp.apellidos,
        ...r,
      });
    }
  }
  return resultado;
}

module.exports = { compararJornada, compararRango, ESTADOS };
