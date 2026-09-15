'use strict';

// test/integration/incidencias.test.js — /api/incidencias (Fase 10).

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

async function ejecutarAuditoriaConEntradaSinSalida(empId, fecha = '2026-09-01') {
  await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'entrada',$2,'manual')`, [empId, `${fecha}T09:00:00`]);
  const res = await agent.post('/api/auditoria/ejecutar').query({ desde: fecha, hasta: fecha });
  return res.body.auditoria_run_id;
}

test.before(async () => { pool = await crearConexionBD(); });
test.beforeEach(async () => { await limpiarBD(pool); agent = await agenteAdmin(app); });
test.after(async () => { await pool.end(); });

test('59. incidencia creada por auditoría está en /api/incidencias', async () => {
  const empId = await crearEmpleado();
  await ejecutarAuditoriaConEntradaSinSalida(empId);
  const res = await agent.get('/api/incidencias');
  assert.equal(res.status, 200);
  assert.ok(res.body.some((i) => i.empleado_id === empId && i.origen === 'auditoria'));
});

test('60. GET /api/incidencias?estado=OPEN filtra por estado', async () => {
  const empId = await crearEmpleado();
  await ejecutarAuditoriaConEntradaSinSalida(empId);
  const res = await agent.get('/api/incidencias').query({ estado: 'OPEN' });
  assert.equal(res.status, 200);
  assert.ok(res.body.length > 0);
  assert.ok(res.body.every((i) => i.estado === 'OPEN'));
});

test('61. PUT /api/incidencias/:id/estado OPEN->IN_PROGRESS -> 200', async () => {
  const empId = await crearEmpleado();
  await ejecutarAuditoriaConEntradaSinSalida(empId);
  const lista = await agent.get('/api/incidencias');
  const id = lista.body[0].id;
  const res = await agent.put(`/api/incidencias/${id}/estado`).send({ estado: 'IN_PROGRESS' });
  assert.equal(res.status, 200);
  assert.equal(res.body.estado, 'IN_PROGRESS');
});

test('62. transición no permitida (IN_PROGRESS->DISMISSED) -> 400', async () => {
  const empId = await crearEmpleado();
  await ejecutarAuditoriaConEntradaSinSalida(empId);
  const lista = await agent.get('/api/incidencias');
  const id = lista.body[0].id;
  await agent.put(`/api/incidencias/${id}/estado`).send({ estado: 'IN_PROGRESS' });
  const res = await agent.put(`/api/incidencias/${id}/estado`).send({ estado: 'DISMISSED' });
  assert.equal(res.status, 400);
});

test('63. al cambiar a RESOLVED, resuelto_en se llena', async () => {
  const empId = await crearEmpleado();
  await ejecutarAuditoriaConEntradaSinSalida(empId);
  const lista = await agent.get('/api/incidencias');
  const id = lista.body[0].id;
  await agent.put(`/api/incidencias/${id}/estado`).send({ estado: 'IN_PROGRESS' });
  const res = await agent.put(`/api/incidencias/${id}/estado`).send({ estado: 'RESOLVED' });
  assert.equal(res.status, 200);
  assert.ok(res.body.resuelto_en);
});

test('64. re-ejecutar auditoría con la misma incidencia -> no duplica ni reabre RESOLVED', async () => {
  const empId = await crearEmpleado();
  const fecha = '2026-09-01';
  await ejecutarAuditoriaConEntradaSinSalida(empId, fecha);
  const lista1 = await agent.get('/api/incidencias');
  const totalAntes = lista1.body.length;
  const id = lista1.body[0].id;
  await agent.put(`/api/incidencias/${id}/estado`).send({ estado: 'IN_PROGRESS' });
  await agent.put(`/api/incidencias/${id}/estado`).send({ estado: 'RESOLVED' });

  // Re-ejecutar auditoría sobre el mismo rango/fichajes: mismo dedupe_key.
  await agent.post('/api/auditoria/ejecutar').query({ desde: fecha, hasta: fecha });

  const lista2 = await agent.get('/api/incidencias');
  assert.equal(lista2.body.length, totalAntes); // no duplica
  const misma = lista2.body.find((i) => i.id === id);
  assert.equal(misma.estado, 'RESOLVED'); // no la reabre
});

test('65. reapertura manual RESOLVED->OPEN -> 200', async () => {
  const empId = await crearEmpleado();
  await ejecutarAuditoriaConEntradaSinSalida(empId);
  const lista = await agent.get('/api/incidencias');
  const id = lista.body[0].id;
  await agent.put(`/api/incidencias/${id}/estado`).send({ estado: 'IN_PROGRESS' });
  await agent.put(`/api/incidencias/${id}/estado`).send({ estado: 'RESOLVED' });
  const res = await agent.put(`/api/incidencias/${id}/estado`).send({ estado: 'OPEN' });
  assert.equal(res.status, 200);
  assert.equal(res.body.estado, 'OPEN');
});
