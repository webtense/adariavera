'use strict';

// test/unit/comparativa.test.js — lib/comparativa.js (Fase 7).
// Módulo PURO: sin BD, sin Express. Datos simulados en memoria.

const test = require('node:test');
const assert = require('node:assert/strict');
const { compararJornada, compararRango, ESTADOS } = require('../../lib/comparativa');

const FECHA = '2026-09-01';

const turno = (over = {}) => ({
  tipo: 'trabajo',
  hora_entrada: '09:00:00',
  hora_salida: '17:00:00',
  duracion_prevista_min: 480,
  tolerancia_entrada_min: 10,
  tolerancia_salida_min: 10,
  turno_nocturno: false,
  ...over,
});

const fich = (tipo, hhmm, fecha = FECHA) => ({ tipo, ts: `${fecha}T${hhmm}:00` });

const planB = (over = {}) => ({ activo: true, horasEsperadas: 8, toleranciaMin: 10, ...over });

test('1. fichaje dentro de tolerancia -> CORRECTO, source SCHEDULE', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: turno(),
    fichajesDelDia: [fich('entrada', '09:05'), fich('salida', '17:03')],
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.CORRECTO);
  assert.equal(r.source, 'SCHEDULE');
});

test('2. entrada 20 min tarde (tolerancia 10) -> RETRASO, minutos_retraso=20', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: turno(),
    fichajesDelDia: [fich('entrada', '09:20'), fich('salida', '17:00')],
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.RETRASO);
  assert.equal(r.minutos_retraso, 20);
  assert.equal(r.source, 'SCHEDULE');
});

test('3. salida 15 min antes (tolerancia 10) -> SALIDA_ANTICIPADA, minutos_anticipada=15', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: turno(),
    fichajesDelDia: [fich('entrada', '09:00'), fich('salida', '16:45')],
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.SALIDA_ANTICIPADA);
  assert.equal(r.minutos_anticipada, 15);
});

test('4. horas trabajadas > turno + tolerancia -> HORAS_EXTRA', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: turno(),
    fichajesDelDia: [fich('entrada', '09:00'), fich('salida', '18:00')], // 9h vs 8h previstas
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.HORAS_EXTRA);
});

test('5. turno de trabajo sin fichaje, sin ausencia aprobada -> AUSENCIA', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: turno(),
    fichajesDelDia: [],
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.AUSENCIA);
  assert.equal(r.source, 'SCHEDULE');
});

test('6. turno sin fichaje pero con ausencia aprobada cubriendo la fecha -> JUSTIFICADO (nunca AUSENCIA)', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: turno(),
    fichajesDelDia: [],
    ausenciaAprobada: { estado: 'aprobada', desde: '2026-08-30', hasta: '2026-09-05', tipo: 'vacaciones' },
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.JUSTIFICADO);
  assert.notEqual(r.estado, ESTADOS.AUSENCIA);
});

test('7. entrada sin salida -> INCOMPLETO, horas_trabajadas=null', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: turno(),
    fichajesDelDia: [fich('entrada', '09:00')],
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.INCOMPLETO);
  assert.equal(r.horas_trabajadas, null);
});

test('8. secuencia inválida (dos entradas seguidas) -> INCONSISTENTE', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: turno(),
    fichajesDelDia: [fich('entrada', '09:00'), fich('entrada', '09:30'), fich('salida', '17:00')],
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.INCONSISTENTE);
});

test('9. sin cuadrante, sin ausencia, Plan B activo, horas ~8±10min -> CORRECTO, source PLAN_B, minutos_retraso=null (UNKNOWN, nunca inventado)', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: null,
    fichajesDelDia: [fich('entrada', '09:00'), fich('salida', '17:05')], // 8h05
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.CORRECTO);
  assert.equal(r.source, 'PLAN_B');
  assert.equal(r.minutos_retraso, null);
  assert.equal(r.minutos_anticipada, null);
});

test('10. sin cuadrante, sin ausencia, Plan B activo, horas 5h -> HORAS_INSUFICIENTES, source PLAN_B', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: null,
    fichajesDelDia: [fich('entrada', '09:00'), fich('salida', '14:00')], // 5h
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.HORAS_INSUFICIENTES);
  assert.equal(r.source, 'PLAN_B');
});

test('11. sin cuadrante, sin ausencia, Plan B desactivado -> CUADRANTE_AUSENTE... o FICHAJE_SIN_CUADRANTE si hay fichaje', () => {
  // Sin fichaje: nada que evaluar.
  const rSinFichaje = compararJornada({
    fecha: FECHA,
    turno: null,
    fichajesDelDia: [],
    ausenciaAprobada: null,
    planB: planB({ activo: false }),
  });
  assert.equal(rSinFichaje.estado, ESTADOS.CUADRANTE_AUSENTE);
  assert.equal(rSinFichaje.source, 'N/A');

  // Con fichaje pero Plan B off: se registra que hubo trabajo pero no se evalúa.
  const rConFichaje = compararJornada({
    fecha: FECHA,
    turno: null,
    fichajesDelDia: [fich('entrada', '09:00'), fich('salida', '17:00')],
    ausenciaAprobada: null,
    planB: planB({ activo: false }),
  });
  assert.equal(rConFichaje.estado, ESTADOS.FICHAJE_SIN_CUADRANTE);
  assert.equal(rConFichaje.source, 'N/A');
});

test('12. turno tipo "libre" sin fichaje -> no sale como AUSENCIA', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: turno({ tipo: 'libre' }),
    fichajesDelDia: [],
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.notEqual(r.estado, ESTADOS.AUSENCIA);
  assert.equal(r.estado, ESTADOS.N_A);
});

test('13. turno nocturno (entrada D 22:00, salida D+1 06:00) -> una sola jornada correcta', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: turno({
      hora_entrada: '22:00:00', hora_salida: '06:00:00', turno_nocturno: true,
      duracion_prevista_min: 480,
    }),
    fichajesDelDia: [
      fich('entrada', '22:02', FECHA),
      fich('salida', '06:01', '2026-09-02'),
    ],
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.CORRECTO);
  assert.equal(r.horas_trabajadas > 7.9 && r.horas_trabajadas < 8.1, true);
});

test('14. Plan B activo, horas exactamente 8h -> CORRECTO', () => {
  const r = compararJornada({
    fecha: FECHA,
    turno: null,
    fichajesDelDia: [fich('entrada', '09:00'), fich('salida', '17:00')], // exactamente 8h
    ausenciaAprobada: null,
    planB: planB(),
  });
  assert.equal(r.estado, ESTADOS.CORRECTO);
});

test('compararRango: orquesta compararJornada() por empleado x fecha', () => {
  const empleados = [{ id: 1, nombre: 'Ana', apellidos: 'Gómez' }];
  const fechas = [FECHA];
  const turnosPorEmpleadoFecha = new Map([[`1|${FECHA}`, turno()]]);
  const fichajesPorEmpleadoFecha = new Map([[`1|${FECHA}`, [fich('entrada', '09:00'), fich('salida', '17:00')]]]);
  const filas = compararRango({
    fechas, empleados, turnosPorEmpleadoFecha, fichajesPorEmpleadoFecha,
    ausenciasPorEmpleado: new Map(), planB: planB(),
  });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].empleado_id, 1);
  assert.equal(filas[0].estado, ESTADOS.CORRECTO);
});
