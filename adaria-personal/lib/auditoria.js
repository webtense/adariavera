'use strict';

// lib/auditoria.js — FASE 9: auditoría legal de control horario (RD 8/2019).
//
// Módulo PURO: sin BD, sin Express, sin efectos secundarios. server.js carga
// los fichajes del rango (raw, ordenados) y los empleados, y llama a
// ejecutarChecklistAuditoria() con esos datos ya en memoria — igual que
// lib/comparativa.js (Fase 7) y lib/jornadas.js (Fase 3).
//
// Regla general del proyecto: NUNCA se inventa un valor. Cuando un control
// no puede evaluarse con los datos disponibles, su estado es 'UNKNOWN', no
// un GREEN optimista ni un RED alarmista sin base.

const CONFIG_AUDITORIA = {
  horaJornadaMaxima: 12, // horas — por encima de esto, RED (posible incumplimiento RD 8/2019)
  horaJornadaAviso: 10, // horas — por encima de esto (y por debajo del máximo), AMBER
  descansoMinimoEntre: 12, // horas de descanso mínimo entre jornadas
  toleranciaDescanso: 0.5, // horas (30 min) de margen antes de marcar RED
};

function toMs(ts) {
  return new Date(ts).getTime();
}

function fechaStr(ts) {
  // YYYY-MM-DD en UTC: suficiente para agrupar por día de forma determinista
  // y estable en el módulo puro (server.js ya maneja la zona horaria real
  // para la presentación; aquí solo se necesita una clave de agrupación).
  return new Date(ts).toISOString().slice(0, 10);
}

function horaStr(ts) {
  return new Date(ts).toISOString().slice(11, 16);
}

function nuevoControl(codigo_control, empleado_id, estado, detalle, fecha_referencia) {
  return { codigo_control, empleado_id: empleado_id ?? null, estado, detalle, fecha_referencia: fecha_referencia ?? null };
}

// Agrupa los fichajes por empleado_id, ya ordenados cronológicamente (el
// llamador debe pasar `fichajes` ordenados por empleado_id, ts, id — igual
// que fichajesParaCalculo() en server.js).
function agruparPorEmpleado(fichajes) {
  const mapa = new Map();
  for (const f of fichajes || []) {
    if (!mapa.has(f.empleado_id)) mapa.set(f.empleado_id, []);
    mapa.get(f.empleado_id).push(f);
  }
  return mapa;
}

// Recorre la máquina de estados (entrada → [pausa_inicio → pausa_fin]* →
// salida) de UN empleado y construye jornadas + detecta inconsistencias.
// Devuelve { jornadas, inconsistencias, pausasSinCierre } donde jornadas es
// un array de { inicio, fin, pausas } (fin puede ser null si quedó abierta).
function recorrerMaquinaEstados(fichajesEmpleado) {
  const jornadas = [];
  const inconsistencias = [];
  const pausasSinCierre = [];
  let actual = null;

  for (const f of fichajesEmpleado) {
    if (f.tipo === 'entrada') {
      if (actual) {
        // Doble entrada sin salida intermedia: se cierra la anterior como
        // incompleta y se reporta como inconsistencia de secuencia.
        inconsistencias.push({ tipo: 'ENTRADA_SIN_SALIDA', fichaje: actual.entradaFichaje, jornada: actual });
        jornadas.push(actual);
      }
      actual = { inicio: f.ts, fin: null, pausas: [], entradaFichaje: f };
    } else if (f.tipo === 'pausa_inicio') {
      if (!actual) {
        inconsistencias.push({ tipo: 'FICHAJE_HUERFANO', fichaje: f });
        continue;
      }
      const abierta = actual.pausas.find((p) => !p.fin);
      if (abierta) continue; // ya había una pausa abierta: se ignora sin inventar
      actual.pausas.push({ inicio: f.ts, fin: null, fichaje: f });
    } else if (f.tipo === 'pausa_fin') {
      if (!actual) {
        inconsistencias.push({ tipo: 'FICHAJE_HUERFANO', fichaje: f });
        continue;
      }
      const abierta = [...actual.pausas].reverse().find((p) => !p.fin);
      if (!abierta) {
        inconsistencias.push({ tipo: 'FICHAJE_HUERFANO', fichaje: f });
        continue;
      }
      abierta.fin = f.ts;
    } else if (f.tipo === 'salida') {
      if (!actual) {
        inconsistencias.push({ tipo: 'FICHAJE_HUERFANO', fichaje: f });
        continue;
      }
      actual.fin = f.ts;
      jornadas.push(actual);
      actual = null;
    } else {
      inconsistencias.push({ tipo: 'TIPO_DESCONOCIDO', fichaje: f });
    }
  }
  if (actual) {
    // Entrada (y quizá pausas) sin salida al final del rango: jornada abierta.
    inconsistencias.push({ tipo: 'ENTRADA_SIN_SALIDA', fichaje: actual.entradaFichaje, jornada: actual });
    jornadas.push(actual);
  }
  for (const j of jornadas) {
    for (const p of j.pausas) {
      if (!p.fin) pausasSinCierre.push({ jornada: j, pausa: p });
    }
  }
  return { jornadas, inconsistencias, pausasSinCierre };
}

// 1. ENTRADA_SIN_SALIDA
function controlEntradaSinSalida(empleadoId, inconsistencias) {
  const controles = [];
  for (const inc of inconsistencias) {
    if (inc.tipo !== 'ENTRADA_SIN_SALIDA') continue;
    controles.push(nuevoControl(
      'ENTRADA_SIN_SALIDA', empleadoId, 'RED',
      `Entrada a las ${horaStr(inc.fichaje.ts)} sin salida registrada`,
      fechaStr(inc.fichaje.ts)
    ));
  }
  return controles;
}

// 2. PAUSA_SIN_CIERRE
function controlPausaSinCierre(empleadoId, pausasSinCierre) {
  return pausasSinCierre.map((ps) => nuevoControl(
    'PAUSA_SIN_CIERRE', empleadoId, 'AMBER',
    `Pausa iniciada a las ${horaStr(ps.pausa.inicio)} sin fin registrado`,
    fechaStr(ps.pausa.inicio)
  ));
}

// 3. JORNADA_EXCESIVA
function controlJornadaExcesiva(empleadoId, jornadas, config) {
  const controles = [];
  for (const j of jornadas) {
    if (!j.fin) continue; // jornada incompleta: ya cubierta por ENTRADA_SIN_SALIDA, no se duplica
    const pausaMs = j.pausas.reduce((acc, p) => (p.fin ? acc + (toMs(p.fin) - toMs(p.inicio)) : acc), 0);
    const horas = (toMs(j.fin) - toMs(j.inicio) - pausaMs) / 3600000;
    if (horas > config.horaJornadaMaxima) {
      controles.push(nuevoControl(
        'JORNADA_EXCESIVA', empleadoId, 'RED',
        `Jornada de ${horas.toFixed(2)} horas (> ${config.horaJornadaMaxima}h máximo)`,
        fechaStr(j.inicio)
      ));
    } else if (horas > config.horaJornadaAviso) {
      controles.push(nuevoControl(
        'JORNADA_EXCESIVA', empleadoId, 'AMBER',
        `Jornada de ${horas.toFixed(2)} horas (> ${config.horaJornadaAviso}h de aviso)`,
        fechaStr(j.inicio)
      ));
    }
  }
  return controles;
}

// 4. DESCANSO_INSUFICIENTE — una entrada por empleado (la primera brecha
// que incumple el umbral encontrada al recorrer las jornadas en orden).
function controlDescansoInsuficiente(empleadoId, jornadas, config) {
  const cerradas = jornadas.filter((j) => j.fin).sort((a, b) => toMs(a.inicio) - toMs(b.inicio));
  const umbralMs = config.descansoMinimoEntre * 3600000;
  const toleranciaMs = config.toleranciaDescanso * 3600000;
  for (let i = 1; i < cerradas.length; i++) {
    const salidaAnterior = cerradas[i - 1].fin;
    const entradaSiguiente = cerradas[i].inicio;
    const descansoMs = toMs(entradaSiguiente) - toMs(salidaAnterior);
    if (descansoMs < umbralMs - toleranciaMs) {
      const horas = descansoMs / 3600000;
      return [nuevoControl(
        'DESCANSO_INSUFICIENTE', empleadoId, 'RED',
        `Descanso de ${horas.toFixed(2)} horas entre ${fechaStr(salidaAnterior)} y ${fechaStr(entradaSiguiente)} (mínimo ${config.descansoMinimoEntre}h)`,
        fechaStr(entradaSiguiente)
      )];
    }
  }
  return [];
}

// 5. FICHAJES_INCONSISTENTES — desviaciones de la máquina de estados
// distintas de ENTRADA_SIN_SALIDA (que ya tiene su propio código): fichajes
// huérfanos o de tipo desconocido en cualquier punto del rango.
function controlFichajesInconsistentes(empleadoId, inconsistencias) {
  const controles = [];
  for (const inc of inconsistencias) {
    if (inc.tipo === 'ENTRADA_SIN_SALIDA') continue; // control propio (código 1)
    const etiqueta = inc.tipo === 'FICHAJE_HUERFANO'
      ? `Fichaje '${inc.fichaje.tipo}' fuera de secuencia (huérfano) a las ${horaStr(inc.fichaje.ts)}`
      : `Fichaje de tipo desconocido ('${inc.fichaje.tipo}') a las ${horaStr(inc.fichaje.ts)}`;
    controles.push(nuevoControl('FICHAJES_INCONSISTENTES', empleadoId, 'RED', etiqueta, fechaStr(inc.fichaje.ts)));
  }
  return controles;
}

// 6. EMPLEADO_SIN_FICHAJES — empleados activos en el rango sin ningún
// fichaje. Una entrada por empleado, sin fecha_referencia (es a nivel de
// período, no de día concreto).
function controlEmpleadoSinFichajes(empleados, empleadoIdsConFichajes) {
  const controles = [];
  for (const emp of empleados || []) {
    if (empleadoIdsConFichajes.has(emp.id)) continue;
    controles.push(nuevoControl(
      'EMPLEADO_SIN_FICHAJES', emp.id, 'AMBER',
      `${emp.apellidos ? `${emp.nombre} ${emp.apellidos}` : `Empleado ${emp.id}`} no registró ningún fichaje en el período`,
      null
    ));
  }
  return controles;
}

// 7. EMPLEADO_SIN_IDENTIFICACION — empleados sin pin_hash ni qr_token.
function controlEmpleadoSinIdentificacion(empleados) {
  const controles = [];
  for (const emp of empleados || []) {
    if (emp.pin_hash == null && emp.qr_token == null) {
      controles.push(nuevoControl(
        'EMPLEADO_SIN_IDENTIFICACION', emp.id, 'AMBER',
        `${emp.apellidos ? `${emp.nombre} ${emp.apellidos}` : `Empleado ${emp.id}`} no tiene PIN ni QR configurados`,
        null
      ));
    }
  }
  return controles;
}

// 8. AUSENCIA_SIN_JUSTIFICAR — TODO: integración futura con la comparativa
// de Fase 7 (lib/comparativa.js). Requeriría pasar turnosPorEmpleadoFecha +
// ausenciasPorEmpleado a esta función, lo cual esta primera versión de la
// auditoría no recibe. Se deja documentado y sin implementar.

/**
 * Ejecuta el checklist de auditoría legal de control horario sobre un rango.
 *
 * @param {object} params
 * @param {Array<{id?: number, empleado_id: number, tipo: 'entrada'|'salida'|'pausa_inicio'|'pausa_fin', ts: string|number|Date}>} params.fichajes
 *   Todos los fichajes del rango (raw), para todos los empleados.
 * @param {Array<{id: number, nombre: string, apellidos: string, pin_hash?: any, qr_token?: any}>} params.empleados
 *   Empleados activos en el rango (o a auditar).
 * @param {string} params.property_id Solo como contexto (no se usa en el cálculo).
 * @param {object} [params.config] Umbrales; por defecto CONFIG_AUDITORIA.
 * @returns {{controles: Array, resumen: {total: number, green: number, amber: number, red: number, unknown: number}}}
 */
function ejecutarChecklistAuditoria(params) {
  const { fichajes, empleados, config } = params || {};
  const cfg = { ...CONFIG_AUDITORIA, ...(config || {}) };

  const porEmpleado = agruparPorEmpleado(fichajes);
  const controles = [];
  const empleadoIdsConFichajes = new Set();

  for (const [empId, lista] of porEmpleado.entries()) {
    empleadoIdsConFichajes.add(empId);
    const { jornadas, inconsistencias, pausasSinCierre } = recorrerMaquinaEstados(lista);

    controles.push(...controlEntradaSinSalida(empId, inconsistencias));
    controles.push(...controlPausaSinCierre(empId, pausasSinCierre));
    controles.push(...controlJornadaExcesiva(empId, jornadas, cfg));
    controles.push(...controlDescansoInsuficiente(empId, jornadas, cfg));
    controles.push(...controlFichajesInconsistentes(empId, inconsistencias));
  }

  controles.push(...controlEmpleadoSinFichajes(empleados, empleadoIdsConFichajes));
  controles.push(...controlEmpleadoSinIdentificacion(empleados));

  // TODO Fase 9.1: AUSENCIA_SIN_JUSTIFICAR consumiendo lib/comparativa.js.

  const resumen = { total: controles.length, green: 0, amber: 0, red: 0, unknown: 0 };
  for (const c of controles) {
    if (c.estado === 'GREEN') resumen.green++;
    else if (c.estado === 'AMBER') resumen.amber++;
    else if (c.estado === 'RED') resumen.red++;
    else resumen.unknown++;
  }

  return { controles, resumen };
}

module.exports = { ejecutarChecklistAuditoria, CONFIG_AUDITORIA };
