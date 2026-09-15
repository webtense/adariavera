'use strict';

// lib/incidencias.js — FASE 10: helpers puros de la bandeja de incidencias.
//
// Módulo PURO: sin BD, sin Express. Extraído de server.js (donde vivían
// como funciones locales) para poder testearlo en aislado, mismo criterio
// que lib/comparativa.js / lib/auditoria.js / lib/jornadas.js. server.js
// sigue siendo el único que hace INSERT ... ON CONFLICT (dedupe_key) DO
// NOTHING contra la tabla `incidencia`; aquí solo se calcula la clave y la
// severidad por defecto.

// Clave de deduplicación: misma combinación (propiedad, empleado, fecha,
// origen, tipo) siempre produce la misma clave, para que UNIQUE(dedupe_key)
// + ON CONFLICT DO NOTHING evite duplicar o reabrir una incidencia ya
// tratada al recalcular. empleado_id puede ser null (p.ej. controles de
// auditoría no ligados a un empleado concreto) — se representa como el
// string 'null', nunca lanza.
function calcularDeduperKey(propertyId, empleadoId, fecha, origen, tipo) {
  return `${propertyId}|${empleadoId ?? 'null'}|${fecha}|${origen}|${tipo}`;
}

// Severidad por defecto para incidencias generadas desde la comparativa (Fase 7).
function severidadComparativa(estadoComparativa, minutosRetraso) {
  if (estadoComparativa === 'AUSENCIA' || estadoComparativa === 'INCONSISTENTE') return 'alta';
  if (estadoComparativa === 'RETRASO' && minutosRetraso != null && minutosRetraso <= 15) return 'baja';
  return 'media';
}

// Severidad por defecto para incidencias generadas desde la auditoría (Fase 9).
function severidadAuditoria(estadoAuditoria) {
  if (estadoAuditoria === 'RED') return 'alta';
  if (estadoAuditoria === 'AMBER') return 'media';
  return 'baja'; // UNKNOWN
}

// Estados de la comparativa que NO generan incidencia (todo va bien o ya
// está justificado/no aplica).
const ESTADOS_COMPARATIVA_SIN_INCIDENCIA = new Set(['CORRECTO', 'JUSTIFICADO', 'N/A']);

module.exports = {
  calcularDeduperKey,
  severidadComparativa,
  severidadAuditoria,
  ESTADOS_COMPARATIVA_SIN_INCIDENCIA,
};
