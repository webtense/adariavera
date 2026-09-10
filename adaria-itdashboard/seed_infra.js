'use strict';
// Siembra de los apartados Cámaras, WiFi, Copias de seguridad. Idempotente por (tabla + clave natural).
require('./lib/env')();
const db = require('./lib/db');
const { encrypt } = require('./lib/crypto');

// ---------- CÁMARAS (6x Tapo C210) ----------
// Fuente: CREDENCIALES_MAESTRO.txt §4 (IPs LAN + admin/admin) + bitwarden (cuenta TP-Link asanchez/***REMOVED***)
const CAMS = [
  ['CAM-001', 'TP-Link Tapo C210', '50.50.0.131', 'admin', 'admin', 'Entrada principal', 'PoE. Cuenta cloud TP-Link: asanchez / ***REMOVED***. Grabación en Frigate.'],
  ['CAM-002', 'TP-Link Tapo C210', '50.50.0.135', 'admin', 'admin', 'Recepción', 'PoE. Cuenta cloud TP-Link: asanchez / ***REMOVED***. Grabación en Frigate.'],
  ['CAM-003', 'TP-Link Tapo C210', '50.50.0.138', 'admin', 'admin', 'Área común', 'PoE. Cuenta cloud TP-Link: asanchez / ***REMOVED***. Grabación en Frigate.'],
  ['CAM-004', 'TP-Link Tapo C210', '50.50.0.146', 'admin', 'admin', 'Pasillo administrativo', 'PoE. Cuenta cloud TP-Link: asanchez / ***REMOVED***. Grabación en Frigate.'],
  ['CAM-005', 'TP-Link Tapo C210', '50.50.0.150', 'admin', 'admin', 'Área de servicio', 'PoE. Cuenta cloud TP-Link: asanchez / ***REMOVED***. Grabación en Frigate.'],
  ['CAM-006', 'TP-Link Tapo C210', '50.50.0.151', 'admin', 'admin', 'Almacén / Seguridad', 'PoE. Cuenta cloud TP-Link: asanchez / ***REMOVED***. Grabación en Frigate.'],
];
const camExists = db.prepare('SELECT id FROM cameras WHERE nombre = ?');
const camIns = db.prepare(`INSERT INTO cameras (nombre,modelo,ip,usuario,password_enc,ubicacion,notas,orden) VALUES (?,?,?,?,?,?,?,?)`);
let nc = 0;
CAMS.forEach((c, i) => { if (camExists.get(c[0])) return; camIns.run(c[0], c[1], c[2], c[3], encrypt(c[4]), c[5], c[6], i); nc++; });
console.log(`✔ Cámaras: ${nc} añadidas (catálogo ${CAMS.length})`);

// ---------- WiFi ----------
// [ssid, tipo, ip_ap, banda, seguridad, usuario, password, ubicacion, notas, monitor]
const WIFI = [
  ['HOTEL ADARIA', 'Clientes', '', '2.4GHz + 5GHz', 'WPA2', '', 'hoteladariavera', 'Todo el hotel', 'Red de huéspedes', 0],
  ['Oficina Adaria', 'Oficina/Staff', '', '2.4GHz + 5GHz', 'WPA2', '', '2026guerrerosadaria7', 'Zona administrativa', 'Red interna del personal', 0],
  ['AP Planta 1 (hardware)', 'Punto de acceso', '50.50.0.11', '2.4GHz + 5GHz', 'WPA2', 'admin', '***REMOVED***', 'Planta 1 (zona 1)', 'Access Point físico. Admin web por IP. Monitorizado por ping.', 1],
];
const wExists = db.prepare('SELECT id FROM wifi_networks WHERE ssid = ?');
const wIns = db.prepare(`INSERT INTO wifi_networks (ssid,tipo,ip_ap,banda,seguridad,usuario,password_enc,ubicacion,notas,orden,monitor) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
let nw = 0;
WIFI.forEach((w, i) => { if (wExists.get(w[0])) return; wIns.run(w[0], w[1], w[2], w[3], w[4], w[5], w[6] ? encrypt(w[6]) : '', w[7], w[8], i, w[9]); nw++; });
console.log(`✔ WiFi: ${nw} añadidas (catálogo ${WIFI.length})`);

// ---------- COPIAS DE SEGURIDAD: trabajos ----------
// [nombre, origen, destino, tipo, frecuencia, hora, retencion, responsable, estado, notas]
const JOBS = [
  ['Base de datos PMS (ACI Dali)', 'Servidor Windows — BD hotelera (reservas, facturación, almacén)', 'Local D:\\Backup + copia a Google Drive', 'FULL + DIFF', 'Diaria', '03:00', 'FULL semanal (4 sem) · DIFF diaria (7 días) · LOG opcional', 'IT / Andrés', 'Operativo', 'Script CopiasSQL_v7.bat. Alerta por WhatsApp/email si falla.'],
  ['Grabación de cámaras (Frigate NVR)', '6 cámaras Tapo C210 (CCTV)', 'Disco local 1TB en LXC Proxmox', 'Continua (vídeo)', 'Continua 24/7', '—', '30-45 días (FIFO, se sobrescribe lo más antiguo)', 'IT / Mantenimiento', 'Operativo', 'Retención limitada por capacidad del disco de 1TB.'],
  ['Documentación y credenciales (KeePass)', 'HotelAdariaVera.kdbx + bitwarden_import.json', 'Google Drive (carpeta IT del hotel)', 'Manual', 'Bajo demanda', '—', 'Histórico de versiones en Drive', 'IT / Andrés', 'Operativo', 'Fuente maestra de contraseñas. Mantener sincronizado con este panel.'],
  ['Máquinas virtuales Proxmox', 'VMs y LXC del hipervisor del hotel (192.168.1.10)', 'NAS virtualizado en Proxmox (HDD 1TB #2)', 'Imagen completa (vzdump)', 'Pendiente de configurar', '—', 'Rotación FULL/DIFF/LOG (a definir)', 'IT / Andrés', '⏳ Pendiente', 'Requiere levantar el NAS virtualizado y programar el cron (≈1 h). Pendiente de autorización.'],
  ['Configuración de red (switches / Mikrotik)', 'Configs de switches Netgear y Mikrotik Gateway', 'Export manual a Google Drive', 'Export config', 'Tras cada cambio', '—', 'Última versión + histórico', 'IT', 'Recomendado', 'Exportar backup de config tras cualquier cambio de red.'],
];
const jExists = db.prepare('SELECT id FROM backup_jobs WHERE nombre = ?');
const jIns = db.prepare(`INSERT INTO backup_jobs (nombre,origen,destino,tipo,frecuencia,hora,retencion,responsable,estado,notas,orden) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
let nj = 0;
JOBS.forEach((j, i) => { if (jExists.get(j[0])) return; jIns.run(...j, i); nj++; });
console.log(`✔ Trabajos de backup: ${nj} añadidos (catálogo ${JOBS.length})`);

// ---------- COPIAS DE SEGURIDAD: documento de política (markdown) ----------
const DOC = `
## Estrategia de copias de seguridad — Hotel Adaria Vera

Política orientada a la **regla 3-2-1**: al menos **3 copias** de los datos críticos, en **2 soportes distintos**, con **1 copia fuera del sitio** (Google Drive).

### 1. ¿Qué se respalda y por qué
- **Datos del PMS (ACI Dali):** reservas, check-in/out, facturación y almacén. Es el dato más crítico del hotel: su pérdida pararía la operativa y la facturación.
- **Grabaciones CCTV (Frigate):** 6 cámaras grabando 24/7; valor legal y de seguridad. Retención limitada por disco.
- **Credenciales y documentación (KeePass + este panel):** acceso a toda la infraestructura.
- **Máquinas virtuales (Proxmox):** permite restaurar servidores completos ante un fallo de hardware.
- **Configuración de red:** switches y gateway, para reponer la red rápidamente.

### 2. Dónde se guarda
- **Local:** \`D:\\Backup\` en el servidor Windows (rápido para restaurar) y disco de 1TB del Proxmox para Frigate.
- **Fuera del sitio:** Google Drive del hotel (protege ante incendio, robo o fallo total del servidor).

### 3. Frecuencia y retención
- **PMS:** copia **diaria a las 03:00** (FULL semanal + DIFF diaria). Retención 4 semanas de FULL y 7 días de DIFF.
- **CCTV:** continua, retención **30-45 días** en FIFO (se sobrescribe lo más antiguo).
- **VMs Proxmox:** *pendiente* de programar (NAS virtualizado).

### 4. Verificación y alertas
- Cada copia del PMS genera un registro; **si una copia falla, se envía alerta por WhatsApp y email**.
- **Prueba de restauración recomendada cada trimestre**: restaurar una copia en un entorno aislado y comprobar que los datos son íntegros. Una copia que no se ha probado **no cuenta como copia válida**.

### 5. Procedimiento de restauración (resumen)
1. **PMS:** localizar el último FULL + DIFF en \`D:\\Backup\` (o Drive si el servidor no arranca) → restaurar con la herramienta SQL → validar reservas del día.
2. **VM completa:** desde Proxmox → restaurar imagen vzdump → arrancar y comprobar servicios.
3. **CCTV:** las grabaciones no se restauran (FIFO); exportar manualmente los clips relevantes antes de que caduquen.
4. **Credenciales:** abrir el \`.kdbx\` desde Google Drive con la contraseña maestra.

### 6. Estado actual y mejoras pendientes
- ⏳ **NAS virtualizado en Proxmox** + rotación FULL/DIFF/LOG de las VMs (≈1 h, pendiente de autorización).
- ⏳ **Alertas automáticas** de fallo de backup (WhatsApp + email) — validar que disparan.
- 🔁 **Ampliar disco de Frigate** si se quiere más de 45 días de CCTV.
- 🧪 **Calendario de pruebas de restauración** trimestral.
`;
db.prepare('INSERT INTO settings (clave,valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor')
  .run('backup_doc', DOC.trim());
console.log('✔ Política de copias de seguridad guardada.');
console.log('Seed infra completado.');
