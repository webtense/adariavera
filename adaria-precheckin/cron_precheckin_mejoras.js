#!/usr/bin/env node
'use strict';

// Se invoca desde crontab, no desde systemd: a diferencia de server.js (que
// recibe el .env vía EnvironmentFile del unit), aquí hace falta cargarlo a
// mano o las credenciales de PG llegan vacías (SASL: "client password must
// be a string" es la pista de este fallo concreto, visto al probar en vivo).
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); }
catch (e) { /* dotenv no instalado: asumimos que el entorno ya trae las vars */ }

/**
 * Cron de reintentos — FASE 3.
 * Ejecutar: node cron_precheckin_mejoras.js
 * Crontab sugerido (una vez al día, no coincide con la ronda de calderas BTR):
 *   0 9 * * * cd /opt/adaria-precheckin && node cron_precheckin_mejoras.js >> logs/cron.log 2>&1
 *
 * Qué hace (todo dentro de la BD propia precheckin_adaria — nunca toca ACI,
 * esta app es SOLO LECTURA contra el PMS, ver REGLA DE ORO en aci.js):
 *
 * 1. Reintenta las notificaciones de precheckin_notificacion_log en estado
 *    'pendiente' o 'error' con menos de 3 intentos y con el último intento a
 *    más de 24h — 3 intentos en 3 días, igual que btr_gestion_portal. Motivo
 *    diferenciado por fila (gate_desactivado, smtp_no_implementado,
 *    send_mode_test, excepcion...), no un genérico "fallo".
 * 2. Las que llegan a 3 intentos sin éxito pasan a 'agotado': dejan de
 *    reintentarse solas y quedan visibles en el panel de errores para que
 *    recepción decida (normalmente: avisar al huésped por otro canal).
 * 3. Señala reservas con check-in en ≤2 días que nadie ha marcado como
 *    procesadas — no es una notificación fallida, es un aviso operativo, y
 *    se cuenta aparte en el resumen (`proximas_sin_procesar`).
 * 4. Registra un resumen de la ejecución en precheckin_cron_log, para que el
 *    panel de errores pueda mostrar que el cron corre de verdad.
 *
 * Nada de esto envía un correo real hoy: mientras PRECHECKIN_EMAIL_ENABLED
 * esté en false (gate de fábrica), mail.notify() siempre cae a
 * logs/mail-test.log — el reintento deja traza igualmente, solo que con
 * motivo 'gate_desactivado' en vez de 'ok'.
 */

const { pool } = require('./db');
const mail = require('./mail');

const MAX_INTENTOS = 3;
const HORAS_ENTRE_INTENTOS = 24;

async function ejecutar() {
  const inicio = Date.now();
  console.log('[cron-precheckin] Iniciando reintentos automáticos...');

  const stats = { candidatos: 0, reintentados: 0, enviados: 0, errores: 0, agotados: 0, proximasSinProcesar: 0, detalle: [] };

  try {
    // 1) Candidatas a reintento
    const { rows: candidatas } = await pool.query(
      `SELECT n.id, n.reserva_id, n.tipo, n.intentos, r.codigo, r.habitacion,
              r.fecha_entrada, r.fecha_salida, r.email, r.telefono, r.hora_llegada_estimada, r.observaciones
       FROM precheckin_notificacion_log n
       JOIN precheckin_reserva r ON r.id = n.reserva_id
       WHERE n.estado IN ('pendiente','error')
         AND n.intentos < $1
         AND (n.ultimo_intento_en IS NULL OR n.ultimo_intento_en <= now() - ($2 || ' hours')::interval)
       ORDER BY n.ultimo_intento_en ASC NULLS FIRST
       LIMIT 200`,
      [MAX_INTENTOS, HORAS_ENTRE_INTENTOS]
    );
    stats.candidatos = candidatas.length;

    for (const c of candidatas) {
      const nuevoIntento = c.intentos + 1;
      let resultado;
      try {
        resultado = await mail.notify({
          asunto: `[Reintento ${nuevoIntento}/${MAX_INTENTOS}] Pre check-in ${c.codigo} — Adaria Vera`,
          cuerpo: `Reserva ${c.codigo}\nHabitación: ${c.habitacion || '-'}\n` +
            `Entrada: ${c.fecha_entrada || '-'} · Salida: ${c.fecha_salida || '-'}\n` +
            `Contacto: ${c.email || '-'} / ${c.telefono || '-'}\n` +
            `Hora estimada de llegada: ${c.hora_llegada_estimada || 'no indicada'}\n` +
            `Observaciones: ${c.observaciones || '-'}`,
        });
      } catch (err) {
        resultado = { enviado: false, motivo: 'excepcion' };
        console.error(`[cron-precheckin] Excepción notificando reserva ${c.codigo}:`, err.message);
      }

      stats.reintentados++;
      const agotado = !resultado.enviado && nuevoIntento >= MAX_INTENTOS;
      const estado = resultado.enviado ? 'enviado' : (agotado ? 'agotado' : 'error');
      if (resultado.enviado) stats.enviados++;
      else if (agotado) stats.agotados++;
      else stats.errores++;

      await pool.query(
        `UPDATE precheckin_notificacion_log
         SET intentos = $2, estado = $3, motivo = $4, ultimo_intento_en = now()
         WHERE id = $1`,
        [c.id, nuevoIntento, estado, resultado.motivo || null]
      );
      stats.detalle.push({ codigo: c.codigo, tipo: c.tipo, intento: nuevoIntento, estado, motivo: resultado.motivo || null });
    }

    // 2) Reservas con check-in próximo sin procesar (solo se cuentan/avisan,
    //    no se tocan — la decisión operativa es de recepción, no del cron).
    const { rows: proximas } = await pool.query(
      `SELECT codigo FROM precheckin_reserva
       WHERE procesado = false AND fecha_entrada IS NOT NULL
         AND fecha_entrada <= (CURRENT_DATE + INTERVAL '2 days')`
    );
    stats.proximasSinProcesar = proximas.length;

    const duracionMs = Date.now() - inicio;
    await pool.query(
      `INSERT INTO precheckin_cron_log
         (candidatos, reintentados, enviados, errores, agotados, proximas_sin_procesar, duracion_ms, detalle)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [stats.candidatos, stats.reintentados, stats.enviados, stats.errores, stats.agotados,
       stats.proximasSinProcesar, duracionMs, JSON.stringify(stats.detalle)]
    );

    console.log(`[cron-precheckin] Completado en ${duracionMs}ms — candidatos:${stats.candidatos} `
      + `reintentados:${stats.reintentados} enviados:${stats.enviados} errores:${stats.errores} `
      + `agotados:${stats.agotados} proximas_sin_procesar:${stats.proximasSinProcesar}`);
  } catch (err) {
    console.error('[cron-precheckin] Error ejecutando el cron:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

ejecutar();
