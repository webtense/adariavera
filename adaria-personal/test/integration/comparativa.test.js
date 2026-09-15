'use strict';

// test/integration/comparativa.test.js — /api/comparativa + /api/comparativa/export (Fase 7).

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearConexionBD, limpiarBD, agenteAdmin } = require('../setup');
const { app } = require('../../server');

let pool;
let agent;

async function crearEmpleado(nombre = 'Ana', apellidos = 'Gómez') {
  const { rows } = await pool.query(
    `INSERT INTO empleado(property_id, nombre, apellidos, fecha_alta) VALUES ('vera',$1,$2,'2026-01-01') RETURNING id`,
    [nombre, apellidos]
  );
  return rows[0].id;
}
async function crearTurno(codigo = 'M1') {
  const { rows } = await pool.query(
    `INSERT INTO turno_config(property_id, codigo, nombre, tipo, hora_entrada, hora_salida, duracion_prevista_min, tolerancia_entrada_min, tolerancia_salida_min)
     VALUES ('vera',$1,'Mañana','trabajo','09:00','17:00',480,10,10) RETURNING id`,
    [codigo]
  );
  return rows[0].id;
}
async function asignarCuadrante(empleadoId, fecha, turnoId) {
  await pool.query(
    `INSERT INTO cuadrante(property_id, empleado_id, fecha, turno_config_id, creado_por, origen) VALUES ('vera',$1,$2,$3,'test','manual')`,
    [empleadoId, fecha, turnoId]
  );
}
async function ficharEntradaSalida(empleadoId, fecha, hEntrada, hSalida) {
  await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'entrada',$2,'manual')`, [empleadoId, `${fecha}T${hEntrada}:00`]);
  if (hSalida) {
    await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'salida',$2,'manual')`, [empleadoId, `${fecha}T${hSalida}:00`]);
  }
}

test.before(async () => { pool = await crearConexionBD(); });
test.beforeEach(async () => { await limpiarBD(pool); agent = await agenteAdmin(app); });
test.after(async () => { await pool.end(); });

test('41. comparativa de un día: turno + fichaje correcto -> CORRECTO', async () => {
  const empId = await crearEmpleado();
  const turnoId = await crearTurno();
  await asignarCuadrante(empId, '2026-09-01', turnoId);
  await ficharEntradaSalida(empId, '2026-09-01', '09:00', '17:00');
  const res = await agent.get('/api/comparativa').query({ desde: '2026-09-01', hasta: '2026-09-01' });
  assert.equal(res.status, 200);
  const fila = res.body.resultados.find((r) => r.empleado_id === empId);
  assert.equal(fila.estado, 'CORRECTO');
});

test('42. comparativa: ausencia sin justificar -> AUSENCIA', async () => {
  const empId = await crearEmpleado();
  const turnoId = await crearTurno();
  await asignarCuadrante(empId, '2026-09-01', turnoId);
  const res = await agent.get('/api/comparativa').query({ desde: '2026-09-01', hasta: '2026-09-01' });
  const fila = res.body.resultados.find((r) => r.empleado_id === empId);
  assert.equal(fila.estado, 'AUSENCIA');
});

test('43. comparativa: retraso -> RETRASO', async () => {
  const empId = await crearEmpleado();
  const turnoId = await crearTurno();
  await asignarCuadrante(empId, '2026-09-01', turnoId);
  await ficharEntradaSalida(empId, '2026-09-01', '09:25', '17:00');
  const res = await agent.get('/api/comparativa').query({ desde: '2026-09-01', hasta: '2026-09-01' });
  const fila = res.body.resultados.find((r) => r.empleado_id === empId);
  assert.equal(fila.estado, 'RETRASO');
});

test('44. GET /api/comparativa?desde&hasta devuelve resultados con source badge', async () => {
  const empId = await crearEmpleado();
  const turnoId = await crearTurno();
  await asignarCuadrante(empId, '2026-09-01', turnoId);
  await ficharEntradaSalida(empId, '2026-09-01', '09:00', '17:00');
  const res = await agent.get('/api/comparativa').query({ desde: '2026-09-01', hasta: '2026-09-01' });
  assert.equal(res.status, 200);
  const fila = res.body.resultados.find((r) => r.empleado_id === empId);
  assert.equal(fila.source, 'SCHEDULE');
  assert.ok('plan_b' in res.body);
});

test('45. comparativa con ausencia aprobada cubriendo la fecha -> JUSTIFICADO', async () => {
  const empId = await crearEmpleado();
  const turnoId = await crearTurno();
  await asignarCuadrante(empId, '2026-09-01', turnoId);
  await pool.query(
    `INSERT INTO ausencia_justificada(property_id, empleado_id, tipo, fecha_inicio, fecha_fin, dias, estado, solicitado_por, aprobado_por, fecha_aprobacion)
     VALUES ('vera',$1,'vacaciones','2026-08-30','2026-09-05',5,'aprobada','test','test',now())`,
    [empId]
  );
  const res = await agent.get('/api/comparativa').query({ desde: '2026-09-01', hasta: '2026-09-01' });
  const fila = res.body.resultados.find((r) => r.empleado_id === empId);
  assert.equal(fila.estado, 'JUSTIFICADO');
});

test('46. GET /api/comparativa/export?formato=pdf -> 200, registra en export_log con hash', async () => {
  const empId = await crearEmpleado();
  const turnoId = await crearTurno();
  await asignarCuadrante(empId, '2026-09-01', turnoId);
  await ficharEntradaSalida(empId, '2026-09-01', '09:00', '17:00');
  const res = await agent.get('/api/comparativa/export').query({ desde: '2026-09-01', hasta: '2026-09-01', formato: 'pdf' });
  assert.equal(res.status, 200);
  const { rows } = await pool.query(`SELECT * FROM export_log WHERE formato LIKE 'comparativa%' ORDER BY id DESC LIMIT 1`);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].hash);
});
