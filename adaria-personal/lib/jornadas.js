'use strict';

// lib/jornadas.js — construcción de UNA jornada a partir de los fichajes de
// un día (o de un turno que cruza medianoche) y su turno previsto.
//
// Módulo PURO: sin BD, sin Express, sin efectos secundarios. Extraído del
// mismo criterio que ya usa server.js (Fase 3, calcularInspeccion) para
// construir jornadas a partir de fichajes en orden cronológico: una jornada
// empieza en 'entrada' y termina en la 'salida' correspondiente, con las
// pausas ('pausa_inicio'/'pausa_fin') intercaladas descontadas. Nunca se
// inventa un valor: fichajes huérfanos o incoherentes se ignoran para el
// cálculo de horas pero se dejan constancia como incidencia.
//
// A diferencia del construirJornadas(fichajesEmpleado) de server.js (que
// recorre TODOS los fichajes de un empleado en un rango y devuelve varias
// jornadas), esta función recibe los fichajes YA acotados a un día concreto
// (o a un turno nocturno concreto) y devuelve el resultado de ESA única
// jornada — pensado para lib/comparativa.js.

/**
 * @param {Array<{tipo: 'entrada'|'salida'|'pausa_inicio'|'pausa_fin', ts: string|number|Date}>} fichajesDelDia
 *   Fichajes de un día (o turno), ordenados cronológicamente.
 * @param {object|null} turnoInfo Fila de turno_config (o null). No se usa
 *   para el cálculo de horas (eso depende solo de los fichajes reales), solo
 *   se acepta por firma para que el llamador pueda pasar contexto futuro.
 * @returns {{horas: number|null, incidencias: string[], entrada: string|number|Date|null, salida: string|number|Date|null, pausa_min: number, incompleta: boolean, inconsistente: boolean}}
 */
function construirJornadas(fichajesDelDia, turnoInfo) {
  void turnoInfo; // reservado para uso futuro; el cálculo de horas es agnóstico al turno
  const incidencias = [];
  let inconsistente = false;
  let entrada = null;
  let salida = null;
  const pausas = [];

  for (const f of fichajesDelDia || []) {
    if (f.tipo === 'entrada') {
      if (entrada != null) {
        inconsistente = true;
        incidencias.push('Doble entrada sin salida intermedia');
        continue;
      }
      entrada = f.ts;
    } else if (f.tipo === 'pausa_inicio') {
      if (entrada == null) {
        inconsistente = true;
        incidencias.push('Pausa sin entrada previa (fichaje huérfano)');
        continue;
      }
      if (pausas.some((p) => !p.fin)) continue; // ya había una pausa abierta: se ignora sin inventar
      pausas.push({ inicio: f.ts, fin: null });
    } else if (f.tipo === 'pausa_fin') {
      const abierta = [...pausas].reverse().find((p) => !p.fin);
      if (!abierta) {
        inconsistente = true;
        incidencias.push('Fin de pausa sin inicio previo (fichaje huérfano)');
        continue;
      }
      abierta.fin = f.ts;
    } else if (f.tipo === 'salida') {
      if (entrada == null) {
        inconsistente = true;
        incidencias.push('Salida sin entrada previa (fichaje huérfano)');
        continue;
      }
      if (salida != null) {
        inconsistente = true;
        incidencias.push('Doble salida para la misma entrada');
        continue;
      }
      const abierta = pausas.find((p) => !p.fin);
      if (abierta) {
        abierta.fin = f.ts;
        incidencias.push('Pausa sin cierre explícito (descontada hasta la salida)');
      }
      salida = f.ts;
    }
  }

  const pausaMin = pausas.reduce(
    (acc, p) => (p.fin ? acc + (new Date(p.fin).getTime() - new Date(p.inicio).getTime()) / 60000 : acc),
    0
  );

  const incompleta = entrada != null && salida == null;
  if (incompleta) incidencias.push('Entrada sin salida registrada (jornada incompleta)');

  let horas = null;
  if (entrada != null && salida != null && !inconsistente) {
    horas = Math.round(((new Date(salida).getTime() - new Date(entrada).getTime()) / 3600000 - pausaMin / 60) * 100) / 100;
  }

  return {
    horas,
    incidencias,
    entrada,
    salida,
    pausa_min: Math.round(pausaMin),
    incompleta,
    inconsistente,
  };
}

module.exports = { construirJornadas };
