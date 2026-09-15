'use strict';

// test/unit/deduplicacion.test.js — calcularDeduperKey() (Fase 10).
// Módulo PURO: lib/incidencias.js, sin BD ni Express (extraído de server.js
// para poder testearlo sin levantar Redis/Postgres).

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularDeduperKey } = require('../../lib/incidencias');

test('23. calcularDeduperKey(prop, emp, fecha, origen, tipo) devuelve un string determinista', () => {
  const k = calcularDeduperKey('vera', 12, '2026-09-01', 'comparativa', 'RETRASO');
  assert.equal(typeof k, 'string');
  assert.equal(k, 'vera|12|2026-09-01|comparativa|RETRASO');
});

test('24. dos llamadas con los mismos parámetros -> mismo hash (idempotencia)', () => {
  const a = calcularDeduperKey('vera', 12, '2026-09-01', 'comparativa', 'RETRASO');
  const b = calcularDeduperKey('vera', 12, '2026-09-01', 'comparativa', 'RETRASO');
  assert.equal(a, b);
});

test('25. NULL en empleado_id -> string "null" en la clave (no error)', () => {
  const k = calcularDeduperKey('vera', null, '2026-09-01', 'auditoria', 'AUDIT_EMPLEADO_SIN_FICHAJES');
  assert.doesNotThrow(() => k);
  assert.equal(k, 'vera|null|2026-09-01|auditoria|AUDIT_EMPLEADO_SIN_FICHAJES');
  assert.match(k, /\|null\|/);
});

test('claves distintas para inputs distintos (no colisiona)', () => {
  const a = calcularDeduperKey('vera', 12, '2026-09-01', 'comparativa', 'RETRASO');
  const b = calcularDeduperKey('vera', 13, '2026-09-01', 'comparativa', 'RETRASO');
  assert.notEqual(a, b);
});
