'use strict';

// test/integration/cuadrante.test.js — endpoints /api/cuadrante + import CSV (Fase 6).

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

test('31. POST /api/cuadrante alta manual -> 201', async () => {
  const empleadoId = await crearEmpleado();
  const turnoId = await crearTurno();
  const res = await agent.post('/api/cuadrante').send({ empleado_id: empleadoId, fecha: '2026-09-01', turno_config_id: turnoId });
  assert.equal(res.status, 201);
  assert.ok(res.body.id);
});

test('32. GET /api/cuadrante?desde=&hasta= devuelve array filtrado', async () => {
  const empleadoId = await crearEmpleado();
  const turnoId = await crearTurno();
  await agent.post('/api/cuadrante').send({ empleado_id: empleadoId, fecha: '2026-09-01', turno_config_id: turnoId });
  await agent.post('/api/cuadrante').send({ empleado_id: empleadoId, fecha: '2026-10-15', turno_config_id: turnoId });
  const res = await agent.get('/api/cuadrante').query({ desde: '2026-09-01', hasta: '2026-09-30' });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].fecha.slice(0, 10), '2026-09-01');
});

test('33. DELETE /api/cuadrante/:id -> borrado físico OK', async () => {
  const empleadoId = await crearEmpleado();
  const turnoId = await crearTurno();
  const creado = await agent.post('/api/cuadrante').send({ empleado_id: empleadoId, fecha: '2026-09-01', turno_config_id: turnoId });
  const res = await agent.delete(`/api/cuadrante/${creado.body.id}`);
  assert.equal(res.status, 200);
  const { rows } = await pool.query('SELECT * FROM cuadrante WHERE id = $1', [creado.body.id]);
  assert.equal(rows.length, 0);
});

test('34. POST /api/cuadrante/import/validar con CSV válido -> {filas_ok, errores:[], hash}', async () => {
  const empleadoId = await crearEmpleado();
  await crearTurno('M1');
  const csv = `empleado_id,fecha,codigo_turno,nota\n${empleadoId},2026-09-01,M1,\n`;
  const res = await agent.post('/api/cuadrante/import/validar').attach('file', Buffer.from(csv), 'cuadrante.csv');
  assert.equal(res.status, 200);
  assert.equal(res.body.filas_ok, 1);
  assert.deepEqual(res.body.errores, []);
  assert.ok(res.body.hash);
});

test('35. import/validar con empleado inexistente -> detecta error', async () => {
  await crearTurno('M1');
  const csv = `empleado_id,fecha,codigo_turno\n999999,2026-09-01,M1\n`;
  const res = await agent.post('/api/cuadrante/import/validar').attach('file', Buffer.from(csv), 'cuadrante.csv');
  assert.equal(res.status, 200);
  assert.equal(res.body.filas_ok, 0);
  assert.equal(res.body.errores.length, 1);
});

test('36. import/validar con turno inexistente -> detecta error', async () => {
  const empleadoId = await crearEmpleado();
  const csv = `empleado_id,fecha,codigo_turno\n${empleadoId},2026-09-01,NO_EXISTE\n`;
  const res = await agent.post('/api/cuadrante/import/validar').attach('file', Buffer.from(csv), 'cuadrante.csv');
  assert.equal(res.status, 200);
  assert.equal(res.body.filas_ok, 0);
  assert.equal(res.body.errores.length, 1);
});

test('37. import/validar con duplicados en el CSV -> detecta error', async () => {
  const empleadoId = await crearEmpleado();
  await crearTurno('M1');
  const csv = `empleado_id,fecha,codigo_turno\n${empleadoId},2026-09-01,M1\n${empleadoId},2026-09-01,M1\n`;
  const res = await agent.post('/api/cuadrante/import/validar').attach('file', Buffer.from(csv), 'cuadrante.csv');
  assert.equal(res.status, 200);
  assert.equal(res.body.filas_ok, 1);
  assert.equal(res.body.duplicados.length, 1);
});

test('38. import/confirmar sin hash previo -> 400', async () => {
  const res = await agent.post('/api/cuadrante/import/confirmar').send({ hash_validacion: 'no-existe' });
  assert.equal(res.status, 400);
});

test('39. import/confirmar con hash correcto, sin errores -> inserta todas las filas', async () => {
  const empleadoId = await crearEmpleado();
  await crearTurno('M1');
  const csv = `empleado_id,fecha,codigo_turno\n${empleadoId},2026-09-01,M1\n`;
  const validado = await agent.post('/api/cuadrante/import/validar').attach('file', Buffer.from(csv), 'cuadrante.csv');
  const res = await agent.post('/api/cuadrante/import/confirmar').send({ hash_validacion: validado.body.hash });
  assert.equal(res.status, 200);
  assert.equal(res.body.filas_aplicadas, 1);
  const { rows } = await pool.query('SELECT * FROM cuadrante WHERE empleado_id = $1', [empleadoId]);
  assert.equal(rows.length, 1);
});

test('40. reimportar el mismo CSV -> idempotente (UPSERT), no duplica', async () => {
  const empleadoId = await crearEmpleado();
  await crearTurno('M1');
  const csv = `empleado_id,fecha,codigo_turno\n${empleadoId},2026-09-01,M1\n`;

  const v1 = await agent.post('/api/cuadrante/import/validar').attach('file', Buffer.from(csv), 'cuadrante.csv');
  await agent.post('/api/cuadrante/import/confirmar').send({ hash_validacion: v1.body.hash });

  const v2 = await agent.post('/api/cuadrante/import/validar').attach('file', Buffer.from(csv), 'cuadrante.csv');
  const res2 = await agent.post('/api/cuadrante/import/confirmar').send({ hash_validacion: v2.body.hash });
  assert.equal(res2.status, 200);

  const { rows } = await pool.query('SELECT * FROM cuadrante WHERE empleado_id = $1', [empleadoId]);
  assert.equal(rows.length, 1); // no duplicado, UPSERT sobre UNIQUE(property_id, empleado_id, fecha)
});
