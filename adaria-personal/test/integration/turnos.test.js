'use strict';

// test/integration/turnos.test.js — endpoints /api/turnos (Fase 6).
// Requiere Postgres real en PGHOST/PGPORT (BD personal_adaria_test, creada y
// migrada por test/setup.js) y Redis en 127.0.0.1:6379 (sesión de admin).

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearConexionBD, limpiarBD, agenteAdmin } = require('../setup');
const { app } = require('../../server');

let pool;
let agent;

test.before(async () => {
  pool = await crearConexionBD();
});

test.beforeEach(async () => {
  await limpiarBD(pool);
  agent = await agenteAdmin(app);
});

test.after(async () => {
  await pool.end();
});

test('26. POST /api/turnos crear turno válido -> 201, respuesta con id', async () => {
  const res = await agent.post('/api/turnos').send({
    codigo: 'M1', nombre: 'Mañana', tipo: 'trabajo',
    hora_entrada: '09:00', hora_salida: '17:00', duracion_prevista_min: 480,
    tolerancia_entrada_min: 10, tolerancia_salida_min: 10,
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.id);
});

test('27. GET /api/turnos devuelve array, incluye el creado', async () => {
  await agent.post('/api/turnos').send({ codigo: 'M1', nombre: 'Mañana', tipo: 'trabajo' });
  const res = await agent.get('/api/turnos');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.some((t) => t.codigo === 'M1'));
});

test('28. PUT /api/turnos/:id (activo=false) -> soft-delete, no borra físico', async () => {
  const creado = await agent.post('/api/turnos').send({ codigo: 'M1', nombre: 'Mañana', tipo: 'trabajo' });
  const id = creado.body.id;
  const res = await agent.put(`/api/turnos/${id}`).send({ nombre: 'Mañana', tipo: 'trabajo', activo: false });
  assert.equal(res.status, 200);
  const { rows } = await pool.query('SELECT activo FROM turno_config WHERE id = $1', [id]);
  assert.equal(rows.length, 1); // sigue existiendo
  assert.equal(rows[0].activo, false);
});

test('29. POST /api/turnos con tipo inválido -> 400', async () => {
  const res = await agent.post('/api/turnos').send({ codigo: 'X1', nombre: 'Raro', tipo: 'no-es-un-tipo' });
  assert.equal(res.status, 400);
});

test('30. POST /api/turnos con codigo duplicado -> 409', async () => {
  await agent.post('/api/turnos').send({ codigo: 'M1', nombre: 'Mañana', tipo: 'trabajo' });
  const res = await agent.post('/api/turnos').send({ codigo: 'M1', nombre: 'Mañana bis', tipo: 'trabajo' });
  assert.equal(res.status, 409);
});
