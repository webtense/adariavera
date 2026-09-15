'use strict';

// test/integration/auditoria.test.js — /api/auditoria/* (Fase 9).

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

test.before(async () => { pool = await crearConexionBD(); });
test.beforeEach(async () => { await limpiarBD(pool); agent = await agenteAdmin(app); });
test.after(async () => { await pool.end(); });

test('54. POST /api/auditoria/ejecutar crea auditoria_run y auditoria_control', async () => {
  const empId = await crearEmpleado();
  await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'entrada','2026-09-01T09:00:00','manual')`, [empId]);
  // sin salida -> ENTRADA_SIN_SALIDA (RED)

  const res = await agent.post('/api/auditoria/ejecutar').query({ desde: '2026-09-01', hasta: '2026-09-01' });
  assert.equal(res.status, 200);
  assert.ok(res.body.auditoria_run_id);

  const run = await pool.query('SELECT * FROM auditoria_run WHERE id = $1', [res.body.auditoria_run_id]);
  assert.equal(run.rows.length, 1);
  const controles = await pool.query('SELECT * FROM auditoria_control WHERE auditoria_run_id = $1', [res.body.auditoria_run_id]);
  assert.ok(controles.rows.length > 0);
});

test('55. la auditoría crea incidencias automáticamente (generarIncidenciasDesdeAuditoria)', async () => {
  const empId = await crearEmpleado();
  await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'entrada','2026-09-01T09:00:00','manual')`, [empId]);

  await agent.post('/api/auditoria/ejecutar').query({ desde: '2026-09-01', hasta: '2026-09-01' });
  const { rows } = await pool.query(`SELECT * FROM incidencia WHERE origen = 'auditoria' AND empleado_id = $1`, [empId]);
  assert.ok(rows.length > 0);
});

test('56. GET /api/auditoria/runs devuelve histórico', async () => {
  const empId = await crearEmpleado();
  await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'entrada','2026-09-01T09:00:00','manual'),('vera',$1,'salida','2026-09-01T17:00:00','manual')`, [empId]);
  await agent.post('/api/auditoria/ejecutar').query({ desde: '2026-09-01', hasta: '2026-09-01' });

  const res = await agent.get('/api/auditoria/runs');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length >= 1);
});

test('57. GET /api/auditoria/runs/:id devuelve detalle de controles', async () => {
  const empId = await crearEmpleado();
  await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'entrada','2026-09-01T09:00:00','manual')`, [empId]);
  const ejecutado = await agent.post('/api/auditoria/ejecutar').query({ desde: '2026-09-01', hasta: '2026-09-01' });

  const res = await agent.get(`/api/auditoria/runs/${ejecutado.body.auditoria_run_id}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.controles || res.body.id);
});

test('58. GET /api/auditoria/runs/:id/export?formato=pdf -> 200, registra en export_log', async () => {
  const empId = await crearEmpleado();
  await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'entrada','2026-09-01T09:00:00','manual'),('vera',$1,'salida','2026-09-01T17:00:00','manual')`, [empId]);
  const ejecutado = await agent.post('/api/auditoria/ejecutar').query({ desde: '2026-09-01', hasta: '2026-09-01' });

  const res = await agent.get(`/api/auditoria/runs/${ejecutado.body.auditoria_run_id}/export`).query({ formato: 'pdf' });
  assert.equal(res.status, 200);
  const { rows } = await pool.query(`SELECT * FROM export_log WHERE formato LIKE 'auditoria%' ORDER BY id DESC LIMIT 1`);
  assert.equal(rows.length, 1);
});
