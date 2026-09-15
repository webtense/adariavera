'use strict';

// test/unit/auditoria.test.js — lib/auditoria.js (Fase 9), ejecutarChecklistAuditoria().
// Módulo PURO: sin BD.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ejecutarChecklistAuditoria } = require('../../lib/auditoria');

let nextId = 1;
const f = (empleado_id, tipo, ts) => ({ id: nextId++, empleado_id, tipo, ts });

const empleado = (over = {}) => ({ id: 1, nombre: 'Ana', apellidos: 'Gómez', pin_hash: 'x', qr_token: 'y', ...over });

function controlesDe(resultado, codigo) {
  return resultado.controles.filter((c) => c.codigo_control === codigo);
}

test('15. fichajes normales, sin incidencias -> todos los controles GREEN (ninguno RED/AMBER)', () => {
  const fichajes = [
    f(1, 'entrada', '2026-09-01T09:00:00'),
    f(1, 'salida', '2026-09-01T17:00:00'),
  ];
  const r = ejecutarChecklistAuditoria({ fichajes, empleados: [empleado()] });
  assert.equal(r.resumen.red, 0);
  assert.equal(r.resumen.amber, 0);
});

test('16. entrada sin salida -> ENTRADA_SIN_SALIDA = RED', () => {
  const fichajes = [f(1, 'entrada', '2026-09-01T09:00:00')];
  const r = ejecutarChecklistAuditoria({ fichajes, empleados: [empleado()] });
  const cs = controlesDe(r, 'ENTRADA_SIN_SALIDA');
  assert.equal(cs.length, 1);
  assert.equal(cs[0].estado, 'RED');
});

test('17. pausa abierta -> PAUSA_SIN_CIERRE = AMBER', () => {
  const fichajes = [
    f(1, 'entrada', '2026-09-01T09:00:00'),
    f(1, 'pausa_inicio', '2026-09-01T13:00:00'),
    f(1, 'salida', '2026-09-01T17:00:00'),
  ];
  const r = ejecutarChecklistAuditoria({ fichajes, empleados: [empleado()] });
  const cs = controlesDe(r, 'PAUSA_SIN_CIERRE');
  assert.equal(cs.length, 1);
  assert.equal(cs[0].estado, 'AMBER');
});

test('18. jornada > 12h -> JORNADA_EXCESIVA = RED', () => {
  const fichajes = [
    f(1, 'entrada', '2026-09-01T07:00:00'),
    f(1, 'salida', '2026-09-01T20:00:00'), // 13h
  ];
  const r = ejecutarChecklistAuditoria({ fichajes, empleados: [empleado()] });
  const cs = controlesDe(r, 'JORNADA_EXCESIVA');
  assert.equal(cs.length, 1);
  assert.equal(cs[0].estado, 'RED');
});

test('descanso >= umbral -> sin DESCANSO_INSUFICIENTE (control de comparación, no aislado)', () => {
  const fichajes = [
    f(1, 'entrada', '2026-09-01T09:00:00'),
    f(1, 'salida', '2026-09-01T17:00:00'),
    f(1, 'entrada', '2026-09-02T09:00:00'), // 16h de descanso: correcto
    f(1, 'salida', '2026-09-02T17:00:00'),
  ];
  const r = ejecutarChecklistAuditoria({ fichajes, empleados: [empleado()] });
  assert.equal(controlesDe(r, 'DESCANSO_INSUFICIENTE').length, 0);
});

test('19. descanso < 12h entre días -> DESCANSO_INSUFICIENTE = RED', () => {
  const fichajes = [
    f(1, 'entrada', '2026-09-01T09:00:00'),
    f(1, 'salida', '2026-09-01T22:00:00'),
    f(1, 'entrada', '2026-09-02T05:00:00'), // 7h de descanso
    f(1, 'salida', '2026-09-02T13:00:00'),
  ];
  const r = ejecutarChecklistAuditoria({ fichajes, empleados: [empleado()] });
  const cs = controlesDe(r, 'DESCANSO_INSUFICIENTE');
  assert.equal(cs.length, 1);
  assert.equal(cs[0].estado, 'RED');
});

test('20. empleado sin fichajes en el rango -> EMPLEADO_SIN_FICHAJES = AMBER', () => {
  const r = ejecutarChecklistAuditoria({
    fichajes: [],
    empleados: [empleado({ id: 2, nombre: 'Luis', apellidos: 'Ruiz' })],
  });
  const cs = controlesDe(r, 'EMPLEADO_SIN_FICHAJES');
  assert.equal(cs.length, 1);
  assert.equal(cs[0].estado, 'AMBER');
  assert.equal(cs[0].empleado_id, 2);
});

test('21. empleado sin PIN/QR -> EMPLEADO_SIN_IDENTIFICACION = AMBER', () => {
  const r = ejecutarChecklistAuditoria({
    fichajes: [f(1, 'entrada', '2026-09-01T09:00:00'), f(1, 'salida', '2026-09-01T17:00:00')],
    empleados: [empleado({ pin_hash: null, qr_token: null })],
  });
  const cs = controlesDe(r, 'EMPLEADO_SIN_IDENTIFICACION');
  assert.equal(cs.length, 1);
  assert.equal(cs[0].estado, 'AMBER');
});

test('22. secuencia inválida (fichaje huérfano) -> FICHAJES_INCONSISTENTES = RED', () => {
  const fichajes = [f(1, 'pausa_fin', '2026-09-01T13:00:00')]; // pausa_fin sin pausa_inicio previa ni entrada
  const r = ejecutarChecklistAuditoria({ fichajes, empleados: [empleado()] });
  const cs = controlesDe(r, 'FICHAJES_INCONSISTENTES');
  assert.equal(cs.length, 1);
  assert.equal(cs[0].estado, 'RED');
});

test('resumen: total = suma de green+amber+red+unknown', () => {
  const fichajes = [f(1, 'entrada', '2026-09-01T09:00:00')];
  const r = ejecutarChecklistAuditoria({ fichajes, empleados: [empleado()] });
  assert.equal(r.resumen.total, r.controles.length);
  assert.equal(r.resumen.total, r.resumen.green + r.resumen.amber + r.resumen.red + r.resumen.unknown);
});
