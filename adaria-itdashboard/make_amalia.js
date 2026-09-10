require('./lib/env')();
const bcrypt=require('bcryptjs');const crypto=require('crypto');
const db=require('./lib/db');
const USER='amalia', NOMBRE='Amalia Informática', ROLE='lector', DIAS=365;
let u=db.prepare('SELECT * FROM users WHERE username=?').get(USER);
if(!u){ const h=bcrypt.hashSync(crypto.randomBytes(12).toString('base64url'),12);
  db.prepare('INSERT INTO users (username,nombre,password_hash,role) VALUES (?,?,?,?)').run(USER,NOMBRE,h,ROLE);
  u=db.prepare('SELECT * FROM users WHERE username=?').get(USER); console.log('usuario amalia creado (id '+u.id+', rol '+ROLE+')'); }
else console.log('usuario amalia ya existe (id '+u.id+')');
db.prepare('UPDATE magic_tokens SET revoked=1 WHERE user_id=?').run(u.id);
const token=crypto.randomBytes(32).toString('base64url');
db.prepare("INSERT INTO magic_tokens (token,user_id,expires_at) VALUES (?,?,datetime('now','localtime','+"+DIAS+" days'))").run(token,u.id);
console.log('MAGICTOKEN='+token);
