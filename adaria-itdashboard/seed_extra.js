'use strict';
// Seed de Servidores, Switches y Directorio de teléfonos. Marca cámaras para monitorización. Idempotente.
require('./lib/env')();
const db = require('./lib/db');
const { encrypt } = require('./lib/crypto');

// ---------- SERVIDORES ----------
const SRV = [
  ['Proxmox Host (hipervisor)', 'Virtualización', '192.168.1.10', 'root', '***REMOVED***', 'Proxmox VE', 'SSD boot + HDD 1TB (Frigate) + HDD 1TB (Backups). Web :8006. Operativo.'],
  ['Servidor Windows', 'SQL Server + Backups', '', 'Server25 (Administrador)', '', 'Windows Server 2019/2022', 'RDP solo por VPN. Usuarios User1/2/3 = Adaria2026.'],
  ['Frigate NVR', 'Grabación CCTV', '', 'admin', '***REMOVED***', 'LXC en Proxmox', 'Grabación 24/7, 6 cámaras, 1TB, retención 30-45 días.'],
];
const sExists = db.prepare('SELECT id FROM servers WHERE nombre = ?');
const sIns = db.prepare(`INSERT INTO servers (nombre,rol,ip,usuario,password_enc,so,notas,orden) VALUES (?,?,?,?,?,?,?,?)`);
let ns = 0; SRV.forEach((s, i) => { if (sExists.get(s[0])) return; sIns.run(s[0], s[1], s[2], s[3], s[4] ? encrypt(s[4]) : '', s[5], s[6], i); ns++; });
console.log(`✔ Servidores: ${ns} añadidos`);

// ---------- SWITCHES ----------
const SW = [
  ['Switch GS308EP #1', 'Netgear GS308EP', '192.168.1.201', '6V665C5WA2AE1', '8', 'PoE Plus', 'admin', 'CPD'],
  ['Switch GS308EP #2', 'Netgear GS308EP', '192.168.1.202', '6V665C5AA1965', '8', 'PoE Plus', 'admin', 'CPD'],
  ['Switch GS308EP #3', 'Netgear GS308EP', '192.168.1.203', '6V665C5MA2318', '8', 'PoE Plus', 'admin', 'CPD'],
  ['Switch GS724TPv3', 'Netgear GS724TPv3', '192.168.1.204', '7NN259DHD039C', '24', 'Smart PoE Plus', 'admin', 'CPD'],
  ['Switch JGS516PE #1', 'Netgear JGS516PE', '192.168.1.205', '3KJ2415F00241', '16', 'ProSAFE PoE', 'admin', 'CPD'],
  ['Switch JGS516PE #2', 'Netgear JGS516PE', '192.168.1.206', '3KJ241540019F', '16', 'ProSAFE PoE', 'admin', 'CPD'],
  ['Switch GS724TPv2', 'Netgear GS724TPv2', '192.168.1.207', '50XD1856001DE', '24', 'Smart PoE Plus', 'admin', 'CPD'],
];
const swExists = db.prepare('SELECT id FROM switches WHERE nombre = ?');
const swIns = db.prepare(`INSERT INTO switches (nombre,modelo,ip,serie,puertos,poe,usuario,ubicacion,orden) VALUES (?,?,?,?,?,?,?,?,?)`);
let nsw = 0; SW.forEach((s, i) => { if (swExists.get(s[0])) return; swIns.run(...s, i); nsw++; });
console.log(`✔ Switches: ${nsw} añadidos`);

// ---------- DIRECTORIO DE TELÉFONOS ----------
const CON = [
  ['Personal — Dirección', 'Olga (Directora)', '687868668', ''],
  ['Personal — Mantenimiento', 'Alexander', '650425758', 'Jefe Mantenimiento'],
  ['Personal — Recepción', 'Sergio', '661655544', ''],
  ['Personal — Recepción', 'Isa', '626095523', ''],
  ['Personal — Recepción', 'Lidia', '671958113', ''],
  ['Personal — Recepción', 'Pedro', '647283015', ''],
  ['Personal — Pisos', 'Otilia', '642048491', ''],
  ['Personal — Pisos', 'Clara', '642807347', ''],
  ['Personal — Pisos', 'Viviana', '686135213', ''],
  ['Personal — Pisos', 'Conchi', '606963967', ''],
  ['Personal — Cocina', 'Fran (Jefe)', '671935649', ''],
  ['Personal — Cocina', 'Fátima', '632153917', ''],
  ['Personal — Cocina', 'Marco', '652329535', ''],
  ['Personal — Cocina', 'María', '630834935', ''],
  ['Personal — Cocina', 'Bryan', '664045331', ''],
  ['Personal — Cocina', 'Jhon', '604461446', ''],
  ['Personal — Cocina', 'Alassane', '633888611', ''],
  ['Personal — Cocina', 'Wendy', '642259446', ''],
  ['Personal — Bar', 'Laura (Maître)', '697629669', ''],
  ['Personal — Bar', 'Antonia', '692981949', ''],
  ['Personal — Bar', 'Isabel', '637107924', ''],
  ['Personal — Bar', 'Sheyla', '642376420', ''],
  ['Personal — Bar', 'Alba', '722620458', ''],
  ['Servicios TI', 'Amalia Informática', '630381776', 'Soporte IT'],
  ['Servicios TI', 'Canon Impresora', '950391014', 'Emergencias 637897165 / Urgencias 687042426'],
  ['Servicios TI', 'Juan Carlos Infordmasa', '949226648', ''],
  ['Servicios TI', 'Rafa Indalim', '617364002', ''],
  ['Software hotelero', 'ONITI Llaves (9-18h)', '843686900', ''],
  ['Telecom', 'Aliasis (Centralita)', '914794610', ''],
  ['Telecom', 'IONOS (Hosting)', '911360000', ''],
  ['Telecom', 'Siteminder Soporte (9-19h)', '932201590', ''],
  ['Mantenimiento / Reparaciones', 'Manusa (Puerta Hotel)', '935915700', ''],
  ['Mantenimiento / Reparaciones', 'Cerrajero 24 Horas', '622686877', ''],
  ['Mantenimiento / Reparaciones', 'Alejandro Ascensor Orona', '638093059', ''],
  ['Bancos', 'Ibercaja Soporte', '902115533', ''],
  ['Bancos', 'Sabadell Vera', '950617063', ''],
  ['Bancos', 'Santander', '915123123', ''],
  ['Agencias / Reservas', 'Buscounchollo (Producto)', '977253472', 'Reservas 902575890'],
  ['Agencias / Reservas', 'Weekendesk', '930492974', ''],
  ['Agencias / Reservas', 'Olympia', '661496821', ''],
  ['Agencias / Reservas', 'Traveltool', '674761582', 'Admin 928925896'],
  ['Agencias / Reservas', 'Europlayas', '610101043', 'Reservas 916400500'],
  ['Agencias / Reservas', 'Guest Incoming', '661569293', ''],
  ['Agencias / Reservas', 'Jumbonline', '618853917', ''],
  ['Agencias / Reservas', 'Paraty', '952230887', ''],
  ['Agencias / Reservas', 'Sidetours', '952922650', ''],
  ['Agencias / Reservas', 'Tour10', '952173730', '699262453'],
  ['Agencias / Reservas', 'W2M', '663839570', ''],
  ['Suministros / Proveedores', 'Enrique Carnicerías Huercalenses', '687472901', ''],
  ['Suministros / Proveedores', 'Floristería Garrucha', '950460901', ''],
  ['Suministros / Proveedores', 'Surpan (Panadería)', '950453606', ''],
  ['Suministros / Proveedores', 'Juan Segura (Comercial)', '610771130', ''],
  ['Suministros / Proveedores', 'Dimoba', '950223603', 'Antonio 610750011'],
  ['Suministros / Proveedores', 'Mediterránea', '950304564', 'Fernando 666667422'],
  ['Suministros / Proveedores', 'Jobufer', '968337717', ''],
  ['Suministros / Proveedores', 'Manoli Frutas Mardel', '687559275', ''],
  ['Suministros / Proveedores', 'Pablo Cordero Heineken', '627805122', ''],
  ['Suministros / Proveedores', 'Danone (Yolanda)', '931222728', 'Facturas 902153040'],
  ['Suministros / Proveedores', 'Marcelo Marube', '661752074', ''],
  ['Transporte / Ocio', 'Radiotaxi', '950392100', 'Particular 5 plazas 629088568'],
  ['Transporte / Ocio', 'Barco Fondo Cristal', '662604456', ''],
  ['Transporte / Ocio', 'Parque Acuático Vera', '950467337', ''],
  ['Transporte / Ocio', 'Fort Bravo', '610098184', ''],
  ['Transporte / Ocio', 'Arturo Tren', '615214789', ''],
  ['Sanidad / Farmacias', 'Centro Médico Garrucha', '950451571', ''],
  ['Sanidad / Farmacias', 'Centro Médico Vera', '950451524', ''],
  ['Sanidad / Farmacias', 'Farmacia Consum', '950467591', ''],
  ['Otros servicios', 'Rocío Lavandería Elis', '952717156', ''],
  ['Otros servicios', 'Borja Gestoría', '982550552', ''],
  ['Otros servicios', 'Andrés Hogar Hotel', '670523054', ''],
  ['Otros servicios', 'Nuria Contabilidad', '683261893', ''],
  ['Otros servicios', 'Aqua Service', '961824810', ''],
];
const cExists = db.prepare('SELECT id FROM contacts WHERE nombre = ? AND telefono = ?');
const cIns = db.prepare(`INSERT INTO contacts (categoria,nombre,telefono,notas,orden) VALUES (?,?,?,?,?)`);
let ncon = 0; CON.forEach((c, i) => { if (cExists.get(c[1], c[2])) return; cIns.run(c[0], c[1], c[2], c[3], i); ncon++; });
console.log(`✔ Contactos: ${ncon} añadidos (catálogo ${CON.length})`);

// ---------- marcar cámaras para monitorización por ping ----------
const upd = db.prepare("UPDATE cameras SET monitor = 1 WHERE ip <> ''").run();
console.log(`✔ Cámaras marcadas para monitor: ${upd.changes}`);
console.log('Seed extra completado.');
