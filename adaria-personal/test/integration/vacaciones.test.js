'use strict';

// test/integration/vacaciones.test.js — /api/ausencias (Fase 8) + integración con comparativa (Fase 7).

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
    `INSERT INTO turno_config(property_id, codigo, nombre, tipo, hora_entrada, hora_salida, duracion_prevista_min)
     VALUES ('vera',$1,'Mañana','trabajo','09:00','17:00',480) RETURNING id`,
    [codigo]
  );
  return rows[0].id;
}

test.before(async () => { pool = await crearConexionBD(); });
test.beforeEach(async () => { await limpiarBD(pool); agent = await agenteAdmin(app); });
test.after(async () => { await pool.end(); });

test('47. POST /api/ausencias crear solicitud -> estado pendiente', async () => {
  const empId = await crearEmpleado();
  const res = await agent.post('/api/ausencias').send({
    empleado_id: empId, tipo: 'vacaciones', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-05', dias: 5,
  });
  assert.equal(res.status, 201);
  const { rows } = await pool.query('SELECT estado FROM ausencia_justificada WHERE id = $1', [res.body.id]);
  assert.equal(rows[0].estado, 'pendiente');
});

test('48. PUT /api/ausencias/:id/aprobar -> estado aprobada, fecha_aprobacion se llena', async () => {
  const empId = await crearEmpleado();
  const creado = await agent.post('/api/ausencias').send({
    empleado_id: empId, tipo: 'vacaciones', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-05', dias: 5,
  });
  const res = await agent.put(`/api/ausencias/${creado.body.id}/aprobar`).send({});
  assert.equal(res.status, 200);
  const { rows } = await pool.query('SELECT estado, fecha_aprobacion FROM ausencia_justificada WHERE id = $1', [creado.body.id]);
  assert.equal(rows[0].estado, 'aprobada');
  assert.ok(rows[0].fecha_aprobacion);
});

test('49. PUT /api/ausencias/:id/rechazar sin observaciones_rechazo -> 400', async () => {
  const empId = await crearEmpleado();
  const creado = await agent.post('/api/ausencias').send({
    empleado_id: empId, tipo: 'vacaciones', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-05', dias: 5,
  });
  const res = await agent.put(`/api/ausencias/${creado.body.id}/rechazar`).send({});
  assert.equal(res.status, 400);
});

test('50. PUT /api/ausencias/:id/rechazar con observaciones -> estado rechazada', async () => {
  const empId = await crearEmpleado();
  const creado = await agent.post('/api/ausencias').send({
    empleado_id: empId, tipo: 'vacaciones', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-05', dias: 5,
  });
  const res = await agent.put(`/api/ausencias/${creado.body.id}/rechazar`).send({ observaciones_rechazo: 'No hay cobertura ese día' });
  assert.equal(res.status, 200);
  const { rows } = await pool.query('SELECT estado FROM ausencia_justificada WHERE id = $1', [creado.body.id]);
  assert.equal(rows[0].estado, 'rechazada');
});

test('51. PUT /api/ausencias/:id/cancelar solo desde aprobada -> 200; desde pendiente -> 400', async () => {
  const empId = await crearEmpleado();
  const creado = await agent.post('/api/ausencias').send({
    empleado_id: empId, tipo: 'vacaciones', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-05', dias: 5,
  });
  const resPendiente = await agent.put(`/api/ausencias/${creado.body.id}/cancelar`);
  assert.equal(resPendiente.status, 400);

  await agent.put(`/api/ausencias/${creado.body.id}/aprobar`).send({});
  const resAprobada = await agent.put(`/api/ausencias/${creado.body.id}/cancelar`);
  assert.equal(resAprobada.status, 200);
});

test('52. DELETE /api/ausencias/:id solo si pendiente -> 200; si aprobada -> 400', async () => {
  const empId = await crearEmpleado();
  const creadoPend = await agent.post('/api/ausencias').send({
    empleado_id: empId, tipo: 'vacaciones', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-05', dias: 5,
  });
  const resPend = await agent.delete(`/api/ausencias/${creadoPend.body.id}`);
  assert.equal(resPend.status, 200);

  const creadoAprob = await agent.post('/api/ausencias').send({
    empleado_id: empId, tipo: 'vacaciones', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-05', dias: 5,
  });
  await agent.put(`/api/ausencias/${creadoAprob.body.id}/aprobar`).send({});
  const resAprob = await agent.delete(`/api/ausencias/${creadoAprob.body.id}`);
  assert.equal(resAprob.status, 400);
});

test('53. comparativa con ausencia aprobada cubriendo fecha -> JUSTIFICADO, no AUSENCIA', async () => {
  const empId = await crearEmpleado();
  const turnoId = await crearTurno();
  await pool.query(
    `INSERT INTO cuadrante(property_id, empleado_id, fecha, turno_config_id, creado_por, origen) VALUES ('vera',$1,'2026-09-01',$2,'test','manual')`,
    [empId, turnoId]
  );
  const creado = await agent.post('/api/ausencias').send({
    empleado_id: empId, tipo: 'vacaciones', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-01', dias: 1,
  });
  await agent.put(`/api/ausencias/${creado.body.id}/aprobar`).send({});

  const res = await agent.get('/api/comparativa').query({ desde: '2026-09-01', hasta: '2026-09-01' });
  const fila = res.body.resultados.find((r) => r.empleado_id === empId);
  assert.equal(fila.estado, 'JUSTIFICADO');
  assert.notEqual(fila.estado, 'AUSENCIA');
});
