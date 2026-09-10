const db=require('better-sqlite3')('data/veraadaria.db');
function addAP(ssid,ip,notas,ubic){
  if(db.prepare('SELECT id FROM wifi_networks WHERE ip_ap=?').get(ip)){ console.log('ya existe',ip); return; }
  db.prepare('INSERT INTO wifi_networks (ssid,tipo,ip_ap,banda,seguridad,usuario,ubicacion,notas,orden,monitor,estado) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(ssid,'Punto de acceso',ip,'2.4GHz + 5GHz','WPA2','admin',ubic,notas,5,1,'desconocido');
  console.log('ANADIDO',ssid,ip);
}
addAP('Cudy AP3000','192.168.1.14','AP WiFi6 Cudy. Admin LuCI http://192.168.1.14/cgi-bin/luci/. Red staff','Red staff (WiFi6)');
