'use strict';

// test/integration/regresion.test.js — checklist de lo existente (Fases 1-6),
// para garantizar que las Fases 7-10 no han roto nada.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { crearConexionBD, limpiarBD, agenteAdmin, ADMIN_USER, ADMIN_PASSWORD } = require('../setup');
const { app } = require('../../server');
const request = require('supertest');

let pool;
let agent;

async function crearEmpleado(over = {}) {
  const { rows } = await pool.query(
    `INSERT INTO empleado(property_id, nombre, apellidos, fecha_alta, coste_hora)
     VALUES ('vera',$1,$2,'2026-01-01',$3) RETURNING id`,
    [over.nombre || 'Ana', over.apellidos || 'Gómez', over.coste_hora ?? null]
  );
  return rows[0].id;
}

test.before(async () => { pool = await crearConexionBD(); });
test.beforeEach(async () => { await limpiarBD(pool); agent = await agenteAdmin(app); });
test.after(async () => { await pool.end(); });

test('66. login local (bcrypt) -> sesión válida', async () => {
  const fresh = request.agent(app);
  const res = await fresh.post('/login').type('form').send({ u: ADMIN_USER, p: ADMIN_PASSWORD });
  assert.equal(res.status, 302);
  assert.ok(!(res.headers.location || '').includes('?e=1'));
  const propiedad = await fresh.get('/api/property');
  assert.equal(propiedad.status, 200); // la cookie de sesión autentica la siguiente petición
});

test('67. GET /api/empleados sigue funcionando', async () => {
  await crearEmpleado();
  const res = await agent.get('/api/empleados');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.empleados || res.body));
});

test('68. quiosco PIN (identificar + fichar entrada) -> fichaje creado con origen quiosco', async () => {
  const empId = await crearEmpleado();
  const bcrypt = require('bcryptjs');
  const pin = '1234';
  const pinLookup = require('crypto').createHmac('sha256', process.env.SESSION_SECRET).update(`vera:${pin}`).digest('hex');
  await pool.query('UPDATE empleado SET pin_hash = $1, pin_lookup = $2 WHERE id = $3', [bcrypt.hashSync(pin, 4), pinLookup, empId]);

  const kiosco = request.agent(app);
  const identificar = await kiosco.post('/api/quiosco/identificar').set('x-kiosk-key', process.env.KIOSK_KEY).send({ pin });
  assert.equal(identificar.status, 200);

  const fichar = await kiosco.post('/api/quiosco/fichar').set('x-kiosk-key', process.env.KIOSK_KEY).send({ empleado_id: empId, tipo: 'entrada' });
  assert.equal(fichar.status, 201);

  const { rows } = await pool.query(`SELECT origen FROM fichaje WHERE empleado_id = $1`, [empId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].origen, 'quiosco');
});

test('69. quiosco QR -> fichaje creado', async () => {
  const empId = await crearEmpleado();
  const qrToken = 'token-de-prueba-123';
  await pool.query('UPDATE empleado SET qr_token = $1 WHERE id = $2', [qrToken, empId]);

  const kiosco = request.agent(app);
  const leerQr = await kiosco.get(`/api/quiosco/qr/${qrToken}`).set('x-kiosk-key', process.env.KIOSK_KEY);
  assert.equal(leerQr.status, 200);

  const fichar = await kiosco.post('/api/quiosco/fichar').set('x-kiosk-key', process.env.KIOSK_KEY).send({ empleado_id: empId, tipo: 'entrada', origen: 'qr' });
  assert.equal(fichar.status, 201);
  const { rows } = await pool.query(`SELECT origen FROM fichaje WHERE empleado_id = $1`, [empId]);
  assert.equal(rows[0].origen, 'qr');
});

test('70. GET /api/informes/pdf genera PDF con hash en export_log', async () => {
  const empId = await crearEmpleado({ coste_hora: 12 });
  await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'entrada','2026-09-01T09:00:00','manual'),('vera',$1,'salida','2026-09-01T17:00:00','manual')`, [empId]);
  const res = await agent.get('/api/informes/pdf').query({ desde: '2026-09-01', hasta: '2026-09-01' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  const { rows } = await pool.query(`SELECT * FROM export_log WHERE formato LIKE 'informe%' ORDER BY id DESC LIMIT 1`);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].hash);
});

test('71. SEND_MODE=test -> no envía SMTP real, loguea en mail-test.log', async () => {
  assert.equal(process.env.SEND_MODE, 'test');
  const empId = await crearEmpleado({ coste_hora: 12 });
  await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'entrada','2026-09-01T09:00:00','manual'),('vera',$1,'salida','2026-09-01T17:00:00','manual')`, [empId]);
  const antes = fs.existsSync(path.join(__dirname, '..', '..', 'logs', 'mail-test.log'))
    ? fs.statSync(path.join(__dirname, '..', '..', 'logs', 'mail-test.log')).size
    : 0;
  const res = await agent.post('/api/informes/enviar').send({ desde: '2026-09-01', hasta: '2026-09-01' });
  assert.equal(res.status, 200);
  const logPath = path.join(__dirname, '..', '..', 'logs', 'mail-test.log');
  assert.ok(fs.existsSync(logPath));
  const despues = fs.statSync(logPath).size;
  assert.ok(despues > antes); // se añadió una entrada nueva, no se llamó a nodemailer real
});

test('72. coste_hora=null en informe -> "(coste pendiente)", no inventado', async () => {
  const empId = await crearEmpleado({ coste_hora: null });
  await pool.query(`INSERT INTO fichaje(property_id, empleado_id, tipo, ts, origen) VALUES ('vera',$1,'entrada','2026-09-01T09:00:00','manual'),('vera',$1,'salida','2026-09-01T17:00:00','manual')`, [empId]);
  const res = await agent.get('/api/informes').query({ desde: '2026-09-01', hasta: '2026-09-01' });
  assert.equal(res.status, 200);
  const filas = res.body.empleados || res.body;
  const fila = filas.find((f) => f.id === empId || f.empleado_id === empId);
  assert.equal(fila.coste_hora, null);
  assert.equal(fila.coste_pendiente, true);
  assert.equal(fila.coste_periodo, null); // nunca se asume 0
});

test('73. init.sql aplicado 2 veces seguidas contra BD limpia -> 0 errores (idempotencia total)', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'init.sql'), 'utf8');
  await assert.doesNotReject(pool.query(sql));
  await assert.doesNotReject(pool.query(sql));
});
