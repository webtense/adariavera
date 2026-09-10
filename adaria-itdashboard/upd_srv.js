const db=require('better-sqlite3')('/opt/veraadaria-it/data/veraadaria.db');
const notas='Servidor PRINCIPAL ACI Dali. Terminal Server. Instancia SQL ACIGRUP (SQL Server 2022, MSSQL17): BDs AdariaVeraHotel + AdariaVeraDali. SQL TCP 1433 habilitado 11/08. Acceso remoto -> AnyDesk ID 260 695 116 (pwd 6nw282zu, poner unattended fija) | Supremo ID 1 562 975 065. Usuario admin creado: asanchez.';
const r=db.prepare("UPDATE servers SET nombre=?, rol=?, ip=?, so=?, usuario=?, notas=? WHERE id=2")
  .run('Servidor ACI / Terminal Server (principal)','SQL Server ACIGRUP + ACI + Terminal Server','192.168.1.34','Windows Server 2022','Administrador / asanchez',notas);
console.log('filas actualizadas:', r.changes);
console.log(db.prepare('SELECT id,nombre,ip,so FROM servers WHERE id=2').get());
