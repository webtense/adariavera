'use strict';
// Siembra inicial: usuario admin + catálogo de credenciales de infraestructura (cifradas).
// Idempotente: no duplica credenciales con misma (categoria, nombre); crea el admin solo si no existe.
require('./lib/env')();
const bcrypt = require('bcryptjs');
const db = require('./lib/db');
const { encrypt } = require('./lib/crypto');

// ---- Usuario admin inicial ----
const ADMIN_USER = process.env.SEED_ADMIN_USER || 'asanchez';
const ADMIN_PASS = process.env.SEED_ADMIN_PASS || '3802Mario!';
const ADMIN_NOMBRE = 'Andrés Sánchez';

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USER);
if (!existing) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 12);
  db.prepare('INSERT INTO users (username, nombre, password_hash, role) VALUES (?,?,?,?)')
    .run(ADMIN_USER, ADMIN_NOMBRE, hash, 'admin');
  console.log(`✔ Admin creado: ${ADMIN_USER}`);
} else {
  console.log(`· Admin ${ADMIN_USER} ya existe (no se toca)`);
}

// ---- Catálogo de credenciales ----
// [categoria, nombre, usuario, password, url, notas]
const CREDS = [
  // 1. Infraestructura IT
  ['Infraestructura IT', 'Proxmox Host (Virtualización)', 'root', '***REMOVED***', 'https://192.168.1.10:8006', 'Hypervisor. SSD boot + 2x HDD 1TB (Frigate / Backups). Estado: operativo'],
  ['Infraestructura IT', 'Servidor Windows — Administrador', 'Server25', '', '', 'SQL Server + Backups. RDP solo por VPN tras 16/06/2026'],
  ['Infraestructura IT', 'Servidor Windows — User1/2/3', 'User1 / User2 / User3', 'Adaria2026', '', 'Usuarios estándar del servidor Windows'],
  ['Infraestructura IT', 'Frigate NVR (LXC Proxmox)', 'admin', '***REMOVED***', '', 'Grabación 24/7, 6 cámaras, 1TB, 30-45 días retención'],
  ['Infraestructura IT', 'Mikrotik Gateway', 'admin', '***REMOVED***', '', 'Router principal: NAT, DHCP, VoIP, O2/Movistar'],
  ['Infraestructura IT', 'Switches Netgear (7 uds.)', 'admin', '', '', 'GS308EP x3, GS724TPv3, JGS516PE x2, GS724TPv2. Acceso web admin'],

  // 2. Redes WiFi
  ['Redes WiFi', 'WiFi Clientes — HOTEL ADARIA', 'SSID: HOTEL ADARIA', 'hoteladariavera', '', 'WPA2, 2.4+5GHz, todo el hotel'],
  ['Redes WiFi', 'WiFi Oficina — Oficina Adaria', 'SSID: Oficina Adaria', '2026guerrerosadaria7', '', 'WPA2, 2.4+5GHz, zona administrativa'],
  ['Redes WiFi', 'WiFi AP Planta 1', 'admin', '***REMOVED***', '', 'Access Point WiFi planta 1 (zona 1) — IP 50.50.0.11'],

  // 3. Cámaras CCTV
  ['Cámaras CCTV', 'Tapo C210 (cuenta TP-Link)', 'asanchez', '***REMOVED***', '', 'Cámaras 50.50.0.21-26: Recepción, Piscina, Parking, Acceso, Zona común, Almacén'],
  ['Cámaras CCTV', 'Sistema CCTV local (6x Tapo C210)', 'admin', 'admin', '', 'CAM-001..006 (50.50.0.131/135/138/146/150/151)'],

  // 4. Aplicaciones internas
  ['Aplicaciones internas', 'ACI Hotel PMS', 'AdminAci', '***REMOVED***', '', 'Property Management System: reservas, check-in/out, facturación'],
  ['Aplicaciones internas', 'ONITI (hacer llaves)', 'N/A', '5555', '', 'Alternativa: 1111. Soporte 843686900'],
  ['Aplicaciones internas', 'Caldera (control HVAC)', 'manten', 'manten2014', '', 'Sistema HVAC central — control temperatura/calefacción'],
  ['Aplicaciones internas', 'Impresora Canon', 'Administrador', '1234567', '', 'Soporte 950391014 / emergencias 637897165 / 687042426'],
  ['Aplicaciones internas', 'Cajas fuertes blancas', 'Código', '404000', '', 'Apertura caja fuerte bloqueada'],
  ['Aplicaciones internas', 'Cajas fuertes negras', 'Código', '307077', '', 'Apertura caja fuerte bloqueada'],

  // 5. Correo corporativo (IONOS)
  ['Correo corporativo', 'Dirección — direccion@hoteladariavera.com', 'direccion@hoteladariavera.com', 'AdV3r@2024*', '', 'IONOS imap.ionos.es:993 SSL / smtp.ionos.es:465 SSL. Olga'],
  ['Correo corporativo', 'Jefe Recepción — jeferepcion@', 'jeferepcion@hoteladariavera.com', 'AdV3r@2024*', '', 'Sergio'],
  ['Correo corporativo', 'Recepción — recepcion@', 'recepcion@hoteladariavera.com', 'AdV3r@2024*', '', 'Recepción general'],
  ['Correo corporativo', 'Información — info@', 'info@hoteladariavera.com', 'HotelAdaria16*', '', 'Info general'],

  // 6. Plataformas y extranet
  ['Plataformas / Extranet', 'Google (cuenta hotel)', 'adariavera@gmail.com', 'Adminadaria1', 'https://drive.google.com', 'Drive, Gmail, Analytics'],
  ['Plataformas / Extranet', 'Booking.com', '1068333', 'Adaria202125', 'https://account.booking.com', 'Reservas. Tel 935454700'],
  ['Plataformas / Extranet', 'SiteMinder', 'recepcion@hoteladariavera.com', 'Hoteladaria20212350011221', 'https://authx.siteminder.com/login', 'Gestión canales. Soporte 932201590'],
  ['Plataformas / Extranet', 'Weekendesk', 'ADARIAVERA', 'VERA2014', 'https://partners.weekendesk.com', 'Agremiador'],
  ['Plataformas / Extranet', 'TeamViewer', 'hoteladariavera@hotmail.com', 'Sergio351150292', '', 'Soporte remoto PC despacho'],
  ['Plataformas / Extranet', 'TripAdvisor', 'adariavera@gmail.com', 'Vera2014', 'https://www.tripadvisor.es', 'Reviews'],
  ['Plataformas / Extranet', 'Facebook', 'recepcion@hoteladariavera.com', 'AdariaVera2014', '', 'Redes sociales'],
  ['Plataformas / Extranet', 'W2M', 'Adaria Hotel', 'Adaria2022', 'https://www.w2m.travel', 'Agremiador'],
  ['Plataformas / Extranet', 'Dropbox', 'recepcion@hoteladariavera.com', 'Vera2024#', 'https://www.dropbox.com', 'Documentación'],
  ['Plataformas / Extranet', 'Paraty (web oficial)', 'Web Paraty', 'adaria2020', 'https://admin-hotel.appspot.com', ''],
  ['Plataformas / Extranet', 'Traveltool', 'direccion@hoteladariavera.com', 'adaria2022', 'https://bancohoteles.traveltino.com', 'Gestión reservas'],
  ['Plataformas / Extranet', 'CNTravel', 'P011274', '462318', 'https://cntravel.es', 'Agremiador'],
  ['Plataformas / Extranet', 'Voxel Traveltino', 'info@hoteladariavera.com', 'Adariavera2023', '', 'PC 2 despacho'],
  ['Plataformas / Extranet', 'Voxel Jumbo (Bavel)', 'jeferecepcion@hoteladariavera.com', 'Adaria2024', '', 'Partner Portal'],
  ['Plataformas / Extranet', 'Sidetours', 'h62368', '918b6d713e', 'https://facturasproveedor.sidetours.com', 'Pagos'],
  ['Plataformas / Extranet', 'Ola120 (Turitop)', 'ag06ag2022@gmail.com', 'Verano2022', 'https://www.turitop.com', 'Turismo'],
  ['Plataformas / Extranet', 'EDP (energía)', '03141661E', 'B19135375b*', 'https://www.edpenergia.es', ''],
  ['Plataformas / Extranet', 'Codeur / Aqualia (agua)', 'B87372041', 'HOtelvERA20', 'https://codeur.aqualia.es', ''],
  ['Plataformas / Extranet', 'Coca-Cola (myccep)', 'direccion@hoteladariavera.com', 'Hoteladariavera2023-', 'https://eur.myccep.com', ''],
  ['Plataformas / Extranet', 'Ángel Linares (proveedor)', 'jeferepcion@hoteladariavera.com', 'HoTELADARIAVERA2024', 'https://clientes.angellinares.es', ''],
  ['Plataformas / Extranet', 'SGAE', 'B87372041', 'Hoteladariavera2022', 'https://clientesenlinea.sgae.es', 'Derechos de autor'],
  ['Plataformas / Extranet', 'Disofic', '692914', '6929144AA', 'https://www.disofic.es', ''],
  ['Plataformas / Extranet', 'Lidl', 'direccion@hoteladariavera.com', 'Hoteladariavera2024*', 'https://facturaonline.lidl.es', ''],
  ['Plataformas / Extranet', 'Facturación (Millenium-soft, programa anterior)', 'direccion@hoteladariavera.com', 'Hoteladariavera2024', 'https://www.millenium-soft.es', ''],
  ['Plataformas / Extranet', 'Mercadona', 'info@hoteladariavera.com', 'Vera2014', 'https://www.portalcliente.mercadona.es', ''],
  ['Plataformas / Extranet', 'Quicesa', 'jeferecepcion@hoteladariavera.com', 'HoTELADARIAVERA20244', 'https://quicesa.com', ''],
  ['Plataformas / Extranet', 'Account Live (Microsoft)', '—', 'VeraAdariaHotel2023', 'https://account.live.com', ''],
  ['Plataformas / Extranet', 'Würth', 'direccion@hoteladariavera.com', 'hoteladariavera2022', '', 'Proveedor industrial'],
  ['Plataformas / Extranet', 'Danone', 'ESB87372041', 'Adaria1717', '', 'Lácteos'],
  ['Plataformas / Extranet', 'Lyreco', 'direccion@hoteladariavera.com', 'Hoteladariavera2026', 'https://www.lyreco.es', 'Suministros oficina'],
  ['Plataformas / Extranet', 'Quantum', 'direccion@hoteladariavera.com', 'hoteladariavera2026', 'https://extranet.quantumccs.com', ''],
];

const insert = db.prepare(`INSERT INTO credentials (categoria, nombre, usuario, password_enc, url, notas, orden)
  VALUES (?,?,?,?,?,?,?)`);
const exists = db.prepare('SELECT id FROM credentials WHERE categoria = ? AND nombre = ?');

let added = 0, skipped = 0;
CREDS.forEach((c, i) => {
  const [categoria, nombre, usuario, password, url, notas] = c;
  if (exists.get(categoria, nombre)) { skipped++; return; }
  insert.run(categoria, nombre, usuario || '', password ? encrypt(password) : '', url || '', notas || '', i);
  added++;
});
console.log(`✔ Credenciales: ${added} añadidas, ${skipped} ya existían (total catálogo: ${CREDS.length})`);
console.log('Seed completado.');
