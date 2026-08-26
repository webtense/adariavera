#!/usr/bin/env node
'use strict';

/**
 * STUB preparado, sin usar — reversión de escritura en ACI.
 *
 * btr_gestion_portal/app/deshacer_escritura_aci.js existe porque esa app SÍ
 * escribe en ACI Dali (lib/aci-write.js, con copia previa de cada fila en
 * doc_aci_backup antes de tocar nada) y necesita poder deshacerlo.
 *
 * adaria-precheckin NO escribe en ACI todavía — hoy es exclusivamente
 * SOLO LECTURA (ver la "REGLA DE ORO" en aci.js y en la cabecera de
 * server.js): lo que rellena el huésped se queda en precheckin_adaria
 * (PostgreSQL propio) y es recepción quien lo traslada a mano a la ficha del
 * PMS. No hay ninguna escritura en ACI que revertir.
 *
 * Este archivo se deja preparado, con el mismo nombre que en BTR, para el
 * día que la Tarea E entregue las tres piezas que hacen falta antes de que
 * "deshacer" tenga sentido aquí:
 *   1. Un conector de escritura verificado contra el esquema real de
 *      AdariaVeraHotel (equivalente a lib/aci-write.js) — hoy no existe.
 *   2. Un usuario SQL de escritura limitada (adaria_rw) — hoy solo existe
 *      adaria_ro (solo lectura). Ver tarea_e_aci_connector_diseno.md:
 *      ⚠️ ese documento de diseño usa nombres de tabla genéricos
 *      (GUEST_RESERVATIONS, GUEST_SIGNATURES...) que NO corresponden al
 *      esquema real verificado en aci.js (Reservas / Huespedes /
 *      Habitaciones, columnas RES_GUID / RES_COD_str / hue_des_str...). No
 *      usar esos nombres al implementar: partir del esquema real de aci.js.
 *   3. Una tabla de copia previa a cada escritura (como doc_aci_backup en
 *      BTR), para poder restaurar fila a fila.
 *
 * Hasta que existan las tres, este script se niega a hacer nada: es
 * intencional, no un error.
 */

console.error(
  '[deshacer_escritura_aci] No implementado: adaria-precheckin no escribe en ACI ' +
  '(REGLA DE ORO: solo SELECT). No hay nada que revertir. Ver el comentario de ' +
  'cabecera de este archivo antes de implementar nada aquí.'
);
process.exit(1);
