// Adaria Gestión — portal launcher v1.1.0-doc (base v1.2.0)
// Login único + cards + gestión de usuarios (superadmin) + auditoría (superadmin) + Gestor de QR. Branding Vera.
// FASE 4 (26/08/2026): módulo Escáner DNI/MRZ en MODO PRUEBA (documentos.js + lib/aci-write.js clonados de
// btr-gestion-portal, DOC_DRY_RUN=true fijo, sin escritura en ACI). Ver VeraAdaria_memory/tarea_fase4_escaner_dni.md.
// Modelo de 3 roles: guest (recepción, cards operativas básicas) < admin (todas las cards operativas) < superadmin (todo + /usuarios + /auditoria).
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { Pool } = require('pg');
const redis = require('redis');
const RedisStore = require('connect-redis').default;

const PORT = process.env.PORT || 3093;
const SECRET = process.env.SESSION_SECRET || 'cambia-esto';
const USERS_FILE = path.join(__dirname, 'users.json');
const AUDIT_FILE = path.join(__dirname, 'audit.jsonl');

// ─── Gestor de QR: conexión de SOLO LECTURA (opcional) a la BD del módulo
// Personal (personal_adaria), únicamente para los carnets de fichaje. Si no
// está configurada en .env, esa sección se desactiva sola sin romper nada.
const QRP_PROPERTY_ID = process.env.QR_PERSONAL_PROPERTY_ID || '';
const qrPersonalPool = process.env.QR_PERSONAL_PGUSER ? new Pool({
  host: process.env.QR_PERSONAL_PGHOST || '127.0.0.1',
  port: parseInt(process.env.QR_PERSONAL_PGPORT || '5432', 10),
  user: process.env.QR_PERSONAL_PGUSER,
  password: process.env.QR_PERSONAL_PGPASSWORD,
  database: process.env.QR_PERSONAL_PGDATABASE || 'personal_adaria',
  max: 2,
  idleTimeoutMillis: 30000,
}) : null;

// ─── FASE 4 (26/08/2026) — Escáner DNI/MRZ, MODO PRUEBA: pool propio para
// documentos.js (copia previa de fila, catálogo CP, log de lecturas). Si no
// está configurado en .env, register() de documentos.js no se llama y la
// card queda oculta — no rompe el arranque del portal.
const docPool = process.env.DOC_PGUSER ? new Pool({
  host: process.env.DOC_PGHOST || '127.0.0.1',
  port: parseInt(process.env.DOC_PGPORT || '5432', 10),
  user: process.env.DOC_PGUSER,
  password: process.env.DOC_PGPASSWORD,
  database: process.env.DOC_PGDATABASE || 'adaria_documentos',
  max: 3,
  idleTimeoutMillis: 30000,
}) : null;

let USERS = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
const saveUsers = () => fs.writeFileSync(USERS_FILE, JSON.stringify(USERS, null, 2));

function audit(event, req, extra={}) {
  const rec = { ts: new Date().toISOString(), event,
    actor: (req.session && req.session.user && req.session.user.login) || (extra.actor||'-'),
    ip: (req.headers['x-forwarded-for']||req.ip||'').split(',')[0].trim(), ...extra };
  try { fs.appendFileSync(AUDIT_FILE, JSON.stringify(rec)+'\n'); } catch(e){}
}

// admin:true => oculta la card al rol 'guest' (solo visible para admin/superadmin).
// Las cards operativas de recepción (sin admin:true) son visibles para los 3 roles.
const CARDS = [
  { key:'welcome', nombre:'Welcome Check-in', icono:'🛎️', url:'https://welcome.hoteladariavera.com', ready:true },
  { key:'parking', nombre:'Parking', icono:'🅿️', url:'https://parking.hoteladariavera.com', ready:true },
  { key:'ine', nombre:'INE', icono:'📊', url:'https://ine.hoteladariavera.com', ready:true, admin:true,
    estadoTexto:'BETA', estadoClase:'test' },
  { key:'guest', nombre:'Guest Portal', icono:'📱', url:'https://guest.hoteladariavera.com', ready:true },
  { key:'estadisticas', nombre:'Estadísticas', icono:'📈', url:'https://estadisticas.hoteladariavera.com', ready:true },
  // FASE 4 (26/08/2026): modo prueba, sin escritura en ACI (DOC_DRY_RUN=true
  // fijo en .env, DOC_HOTELES_ESCRITURA vacío). Visible SOLO para estas tres
  // cuentas, no para todo admin/superadmin (por eso `usuarios` y no `admin`).
  { key:'escaner', nombre:'Escáner DNI', icono:'🪪', url:'/documentos.html', ready:true,
    estadoTexto:'Disponible (modo prueba)', estadoClase:'test',
    usuarios:['asanchez','olga','francesc'] },
  { key:'precheckin', nombre:'Pre check-in', icono:'📝', url:'https://precheckin.hoteladariavera.com/', ready:true },
  { key:'manuales', nombre:'Manuales', icono:'📚', url:'/manuales/', ready:true },
  { key:'it', nombre:'Dashboard IT', icono:'🖥️', url:'https://it.hoteladariavera.com', ready:true, admin:true },
  { key:'personal', nombre:'Personal', icono:'👥', url:'/rrhh/', ready:true, admin:true },
  { key:'kiosco', nombre:'Kiosco de Fichaje', icono:'⌚', url:'/rrhh/quiosco', ready:true,
    estadoTexto:'Disponible', estadoClase:'ok' },
  { key:'qr', nombre:'Gestor de QR', icono:'🔳', url:'/qr', ready:true },
];

// ─── Versión de cada módulo, mostrada en su card (10/09/2026: sin esto,
// una card puede seguir apuntando a una versión vieja sin que nadie lo note
// desde el portal — ya pasó con parking). Se consulta en caliente al propio
// módulo (mismo puerto interno que usa el ProxyPass del edge) y se cachea;
// si un módulo no responde a tiempo, la card se queda sin badge de versión
// en vez de romper el portal.
const MODULE_VERSION_SOURCES = {
  welcome: 'http://192.168.1.82:3000/api/version',
  parking: 'http://127.0.0.1:3091/api/version',
  ine: 'http://127.0.0.1:3092/health',
  guest: 'http://127.0.0.1:3500/api/version',
  estadisticas: 'http://127.0.0.1:3101/api/version',
  precheckin: 'http://127.0.0.1:3095/api/version',
  manuales: 'http://127.0.0.1:3102/VERSION/version.json',
  personal: 'http://127.0.0.1:3096/api/version',
  it: 'http://192.168.1.113:3000/api/version',
};
let moduleVersions = {};
async function refreshModuleVersions(){
  await Promise.all(Object.entries(MODULE_VERSION_SOURCES).map(async ([key,url])=>{
    try{
      const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),2500);
      const r=await fetch(url,{signal:ctrl.signal}); clearTimeout(t);
      if(!r.ok) return;
      const j=await r.json();
      if(j&&j.version) moduleVersions[key]=j.version;
    }catch(e){ /* se queda con el último valor cacheado, si lo había */ }
  }));
}
refreshModuleVersions();
setInterval(refreshModuleVersions,60000);

// Roles: guest (recepción, mínimo) < admin (todas las cards, sin auditoría/usuarios) < superadmin (todo).
const ROLE_RANK = { guest:0, admin:1, superadmin:2 };
const isSuperadmin = u => !!u && u.role === 'superadmin';
const isAtLeastAdmin = u => !!u && ROLE_RANK[u.role] >= ROLE_RANK.admin;

const redisClient = redis.createClient({
  host: '127.0.0.1',
  port: 6379,
  legacyMode: false
});
redisClient.connect().catch(e => console.error('[Redis]', e.message));

const sessionConfig = {
  store: new RedisStore({ client: redisClient }),
  secret: 'adaria-sso-secret-2026',
  name: 'adaria_session',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 8
  }
};

const app = express();
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended:false }));
app.use(session(sessionConfig));

// Ficheros estáticos (solo lo que necesita el Escáner DNI: documentos.html +
// favicon/manifest). El resto del portal se sirve renderizado desde aquí.
app.use(express.static(path.join(__dirname, 'public')));

// Puente de sesión → req.user para documentos.js (clonado de btr-gestion-
// portal, que espera `req.user = { login, rol }`). Nunca se concede
// `rol:'admin'` aquí a propósito: dentro de documentos.js eso saltaría
// cualquier restricción de DOC_USERS, y el acceso al escáner en modo prueba
// debe decidirse SOLO por esa lista (asanchez, olga, francesc), no por ser
// admin/superadmin del portal (mvidal es admin y no debe entrar).
app.use((req,res,next)=>{
  if (req.session && req.session.user) {
    req.user = { login: req.session.user.login, rol: 'user' };
  }
  next();
});

const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const layout = (title, body, user, path0='') => `<!DOCTYPE html><html lang="es"><head><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌊</text></svg>"><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Hotel Adaria Vera</title><style>
:root{--od:#1b5e75;--om:#2d8aa3;--ol:#5ba8c7;--tc:#c67c6f;--off:#f8f9fa;--ch:#333}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:var(--ch);background:var(--off)}
.top{background:linear-gradient(135deg,var(--od),var(--om));color:#fff;padding:14px 24px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.top .b{font-size:17px;font-weight:700}.top .b span{font-size:21px;margin-right:6px}
.top nav{display:flex;gap:14px;margin-left:8px}.top nav a{color:#fff;text-decoration:none;font-size:14px;opacity:.85;padding-bottom:2px}
.top nav a.active{opacity:1;border-bottom:2px solid #fff}.top .r{margin-left:auto;font-size:13px}.top .r a{color:#fff;margin-left:12px;opacity:.85;text-decoration:none}
.wrap{max-width:1100px;margin:0 auto;padding:26px 24px}h1{color:var(--od);font-size:22px;margin-bottom:4px}.muted{color:#888;font-size:14px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
.card{background:#fff;border-radius:14px;box-shadow:0 4px 10px rgba(0,0,0,.07);padding:22px;text-decoration:none;color:var(--ch);transition:.15s;border:1px solid #eef3f5;display:block}
.card:hover{transform:translateY(-3px);box-shadow:0 12px 22px rgba(0,0,0,.12)}.card .ic{font-size:34px}.card .nm{font-weight:700;color:var(--od);margin-top:10px;font-size:16px}
.card .st{font-size:11px;margin-top:8px;display:inline-block;padding:2px 9px;border-radius:999px}.st.ok{background:#e8f8ef;color:#27ae60}.st.soon{background:#fef5e7;color:#b9770e}.st.test{background:#eaf6ff;color:#1b5e75}.card.soon{opacity:.72}
.card .ver{font-size:10px;margin-left:6px;color:#999;font-weight:600}
.top .b-wrap{display:flex;flex-direction:column;line-height:1.25}
.top .b-wrap #adaria-header-version{font-size:11px;font-weight:400;opacity:.75}
.foot{color:#999;font-size:12px;text-align:center;margin-top:36px;padding:18px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.06);font-size:14px}
th{background:var(--od);color:#fff;text-align:left;padding:9px 12px;font-size:13px}td{border-bottom:1px solid #eee;padding:9px 12px}
.btn{background:var(--od);color:#fff;border:none;border-radius:8px;padding:7px 13px;font-size:13px;cursor:pointer}.btn:hover{background:var(--om)}
.btn.d{background:#e74c3c}.btn.s{background:var(--tc)}
input,select{padding:8px 11px;border:1px solid #cfdde3;border-radius:8px;font-size:14px}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600}.pill.a{background:#eaf6ff;color:var(--od)}.pill.u{background:#f0f0f0;color:#666}
.box{background:#fff;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.06);padding:18px;margin-bottom:20px}
.login{max-width:380px;margin:8vh auto;background:#fff;border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.18);padding:38px 34px}
.login .bar{height:5px;background:linear-gradient(90deg,var(--ol),var(--tc));border-radius:16px 16px 0 0;margin:-38px -34px 26px}
.login h2{color:var(--od);text-align:center;margin-bottom:4px}.login .s{text-align:center;color:var(--om);font-size:13px;margin-bottom:22px;font-weight:600}
.login label{font-size:13px;font-weight:600;color:#555;display:block;margin:12px 0 5px}.login input{width:100%}
.login button{width:100%;margin-top:20px;background:var(--od);color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:600;cursor:pointer}
.err{background:#fdecea;color:#c0392b;padding:9px 12px;border-radius:8px;font-size:13px;margin-top:14px;text-align:center}
.ok{background:#e8f8ef;color:#1e8449;padding:9px 12px;border-radius:8px;font-size:13px;margin-bottom:14px}

</style></head><body>${user?topbar(user,path0):''}${body}<div class="foot">Hotel Adaria Vera · Módulo Gestión <span id="adaria-footer-version"></span></div><script src="/version-badge.js"></script></body></html>`;

function topbar(u, p){
  const sup = u.role==='superadmin';
  const link=(href,txt)=>`<a href="${href}" class="${p===href?'active':''}">${txt}</a>`;
  const pillCls = sup?'a':'u';
  return `<div class="top"><div class="b-wrap"><div class="b"><span>🌊</span>Hotel Adaria Vera · Gestión</div><div id="adaria-header-version"></div></div>
   <nav>${link('/','Inicio')}${link('/qr','QR')}${link('/changelog','Changelog')}${sup?link('/usuarios','Usuarios')+link('/auditoria','Auditoría'):''}</nav>
   <div class="r">👤 ${esc(u.nombre)} <span class="pill ${pillCls}">${esc(u.role||'guest')}</span><a href="/logout">Salir</a></div></div>`;
}

function requireAuth(req,res,next){ if(req.session&&req.session.user) return next(); res.redirect('/login'); }
function requireSuperadmin(req,res,next){ if(req.session&&req.session.user&&isSuperadmin(req.session.user)) return next(); res.status(403).send('403 - Acceso restringido a superadmin'); }
function requireAtLeastAdmin(req,res,next){ if(req.session&&req.session.user&&isAtLeastAdmin(req.session.user)) return next(); res.status(403).send('403 - Acceso restringido a admin/superadmin'); }

app.get('/login',(req,res)=>{
  if(req.session.user) return res.redirect('/');
  const err = req.query.e ? '<div class="err">Usuario o contraseña incorrectos</div>' : '';
  res.send(layout('Acceso',`<div class="login"><div class="bar"></div><h2>🌊 Hotel Adaria Vera</h2><div class="s">Portal de gestión</div>
   <form method="post" action="/login"><label>Usuario</label><input name="u" autofocus autocomplete="username">
   <label>Contraseña</label><input name="p" type="password" autocomplete="current-password"><button>Entrar</button>${err}</form></div>`));
});
app.post('/login',(req,res)=>{
  const u=(req.body.u||'').trim().toLowerCase(), p=(req.body.p||'').trim(); const rec=USERS[u];
  if(rec && bcrypt.compareSync(p, rec.hash)){
    req.session.user={ login:u, nombre:rec.nombre||u, role:rec.role||'guest' };
    audit('LOGIN_OK', req, {target:u}); return res.redirect('/');
  }
  audit('LOGIN_FAIL', req, {target:u}); res.redirect('/login?e=1');
});
app.get('/logout',(req,res)=>{ audit('LOGOUT',req); req.session.destroy(()=>res.redirect('/login')); });

app.get('/',requireAuth,(req,res)=>{
  const atLeastAdmin=isAtLeastAdmin(req.session.user);
  const loginActual=(req.session.user.login||'').toLowerCase();
  const cards=CARDS
    .filter(c=>!c.admin||atLeastAdmin)
    // `usuarios`: allowlist por cuenta, independiente del rol (p.ej. el
    // Escáner DNI en modo prueba: mvidal es admin pero no está en la lista).
    .filter(c=>!c.usuarios||c.usuarios.includes(loginActual))
    .map(c=>{
    const st=c.ready?`<span class="st ${c.estadoClase||'ok'}">${esc(c.estadoTexto||'Disponible')}</span>`:'<span class="st soon">En preparación</span>';
    const ver=moduleVersions[c.key]?`<span class="ver">v${esc(moduleVersions[c.key])}</span>`:'';
    const href=c.ready&&c.url!=='#'?c.url:'#'; const tgt=c.ready&&c.url!=='#'?' target="_blank"':'';
    return `<a class="card ${c.ready?'':'soon'}" href="${href}"${tgt}><div class="ic">${c.icono}</div><div class="nm">${esc(c.nombre)}</div><div>${st}${ver}</div></a>`;
  }).join('');
  res.send(layout('Gestión',`<div class="wrap"><h1>Panel de gestión</h1><p class="muted">Accesos a los módulos operativos del hotel.</p><div class="grid">${cards}</div></div>`, req.session.user, '/'));
});

// ─── Gestión de usuarios (solo superadmin) ───
app.get('/usuarios',requireAuth,requireSuperadmin,(req,res)=>{
  const msg = req.query.ok ? `<div class="ok">${esc(req.query.ok)}</div>` : '';
  const pillCls = r => r==='superadmin'?'a':'u';
  const rows=Object.entries(USERS).map(([login,u])=>`<tr><td><b>${esc(login)}</b></td><td>${esc(u.nombre||'')}</td>
    <td><span class="pill ${pillCls(u.role)}">${esc(u.role||'guest')}</span></td>
    <td>
      <form method="post" action="/usuarios/${esc(login)}/password" style="display:inline-flex;gap:6px">
        <input name="p" placeholder="nueva clave" style="width:130px"><button class="btn s">Reset</button></form>
      ${login!==req.session.user.login?`<form method="post" action="/usuarios/${esc(login)}/borrar" style="display:inline" onsubmit="return confirm('¿Borrar ${esc(login)}?')"><button class="btn d">Borrar</button></form>`:''}
    </td></tr>`).join('');
  res.send(layout('Usuarios',`<div class="wrap"><h1>Usuarios y accesos</h1><p class="muted">Alta, baja, reset de contraseña y rol. Todo queda auditado.</p>
   <table><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Acciones</th></tr>${rows}</table>
   <div class="box" style="margin-top:20px"><h3 style="color:var(--od);margin-bottom:12px">➕ Nuevo usuario</h3>
    <form method="post" action="/usuarios/crear" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
     <input name="login" placeholder="usuario" required><input name="nombre" placeholder="nombre">
     <select name="role"><option value="guest">guest</option><option value="admin">admin</option><option value="superadmin">superadmin</option></select>
     <input name="p" placeholder="contraseña" required><button class="btn">Crear</button></form></div>
   ${msg}</div>`, req.session.user, '/usuarios'));
});
app.post('/usuarios/crear',requireAuth,requireSuperadmin,(req,res)=>{
  const login=(req.body.login||'').trim().toLowerCase(); const p=(req.body.p||'').trim();
  if(!login||!p||USERS[login]) return res.redirect('/usuarios?ok=Error: usuario vacío o ya existe');
  const role=['guest','admin','superadmin'].includes(req.body.role)?req.body.role:'guest';
  USERS[login]={hash:bcrypt.hashSync(p,10),nombre:req.body.nombre||login,role};
  saveUsers(); audit('USER_CREATE',req,{target:login,role:USERS[login].role});
  res.redirect('/usuarios?ok=Usuario '+login+' creado');
});
app.post('/usuarios/:login/password',requireAuth,requireSuperadmin,(req,res)=>{
  const login=req.params.login.toLowerCase(); const p=(req.body.p||'').trim();
  if(USERS[login]&&p){ USERS[login].hash=bcrypt.hashSync(p,10); saveUsers(); audit('USER_PASSWORD',req,{target:login}); }
  res.redirect('/usuarios?ok=Contraseña actualizada: '+login);
});
app.post('/usuarios/:login/borrar',requireAuth,requireSuperadmin,(req,res)=>{
  const login=req.params.login.toLowerCase();
  if(login!==req.session.user.login && USERS[login]){ delete USERS[login]; saveUsers(); audit('USER_DELETE',req,{target:login}); }
  res.redirect('/usuarios?ok=Usuario borrado: '+login);
});

// ─── Changelog (histórico de versiones del portal) ───
app.get('/changelog',requireAuth,(req,res)=>{
  const CHANGELOG_FILE = path.join(__dirname,'VERSION','changelog.json');
  let data={app_name:'Adaria Gestión (portal)',entries:[]};
  try{ data=JSON.parse(fs.readFileSync(CHANGELOG_FILE,'utf8')); }catch(e){}
  const rows=(data.entries||[]).map(e=>`<tr>
    <td><span class="pill a">v${esc(e.version||'')}</span></td>
    <td>${esc(e.fecha||'')}</td>
    <td><b>${esc(e.titulo||'')}</b></td>
    <td>${esc(e.descripcion||'')}</td>
    <td><code style="font-size:12px;color:#888">${esc((e.sha||'').slice(0,7))}</code></td>
  </tr>`).join('');
  res.send(layout('Changelog',`<div class="wrap"><h1>Historial de versiones</h1>
   <p class="muted">${esc(data.app_name||'')} · versión actual v${esc(data.current_version||'')}</p>
   <table><tr><th>Versión</th><th>Fecha</th><th>Título</th><th>Descripción</th><th>SHA</th></tr>${rows||'<tr><td colspan="5" class="muted">Sin entradas todavía.</td></tr>'}</table>
   </div>`, req.session.user, '/changelog'));
});

// ─── Auditoría (solo superadmin) ───
app.get('/auditoria',requireAuth,requireSuperadmin,(req,res)=>{
  let lines=[]; try{ lines=fs.readFileSync(AUDIT_FILE,'utf8').trim().split('\n').filter(Boolean); }catch(e){}
  const last=lines.slice(-300).reverse().map(l=>{ let r; try{r=JSON.parse(l)}catch(e){return ''}
    const ev=r.event||''; const col=ev==='LOGIN_FAIL'?'#c0392b':(ev.startsWith('USER_')?'#b9770e':'#1e8449');
    return `<tr><td style="white-space:nowrap">${esc((r.ts||'').replace('T',' ').slice(0,19))}</td>
      <td><b style="color:${col}">${esc(ev)}</b></td><td>${esc(r.actor||'-')}</td><td>${esc(r.target||'')}</td><td>${esc(r.ip||'')}</td></tr>`;
  }).join('');
  res.send(layout('Auditoría',`<div class="wrap"><h1>Auditoría de accesos</h1><p class="muted">Últimos 300 eventos (inicios de sesión, fallos y cambios de usuarios).</p>
   <table><tr><th>Fecha/hora (UTC)</th><th>Evento</th><th>Autor</th><th>Objetivo</th><th>IP</th></tr>${last||'<tr><td colspan=5>Sin eventos</td></tr>'}</table></div>`, req.session.user, '/auditoria'));
});


// ─── Gestor de QR (general del portal) ─────────────────────────────────
// Todo se genera en local con la librería `qrcode` (sin CDN ni servicios
// externos). /qr es accesible a los 3 roles (presets, texto/URL libre,
// WiFi e impresión son útiles también para recepción); la sección de
// carnets de empleado (fichaje) queda restringida a admin/superadmin.
const QR_MAX_DATA_LEN = 2000;
function clampInt(v, min, max, dflt){ const n=parseInt(v,10); if(!Number.isFinite(n)) return dflt; return Math.min(max, Math.max(min, n)); }

const QR_PRESETS = [
  { key:'guest', label:'Guest Portal', url:'https://guest.hoteladariavera.com' },
  { key:'precheckin', label:'Pre check-in', url:'https://precheckin.hoteladariavera.com' },
  { key:'welcome', label:'Welcome', url:'https://welcome.hoteladariavera.com' },
];

function qrPageBody(user){
  const atLeastAdmin = isAtLeastAdmin(user);

  const presetCards = QR_PRESETS.map(p=>{
    const src = '/qr/png?data=' + encodeURIComponent(p.url) + '&size=220';
    const dl = '/qr/png?data=' + encodeURIComponent(p.url) + '&size=800';
    return '<div class="qrcard">'
      + '<img src="' + esc(src) + '" alt="QR ' + esc(p.label) + '" width="150" height="150">'
      + '<div class="qrlabel">' + esc(p.label) + '</div>'
      + '<div class="qrmuted">' + esc(p.url) + '</div>'
      + '<div class="qractions">'
      + '<a class="btn" download="qr-' + esc(p.key) + '.png" href="' + esc(dl) + '">Descargar PNG</a>'
      + '<button type="button" class="btn s" data-tray-src="' + esc(dl) + '" data-tray-label="' + esc(p.label) + '">Añadir a impresión</button>'
      + '</div></div>';
  }).join('');

  const empleadosSection = !atLeastAdmin ? '' : (
    '<div class="box"><h3 style="color:var(--od);margin-bottom:6px">🪪 Carnets de empleado (fichaje)</h3>'
    + '<p class="qrmuted" style="margin-bottom:12px">QR de fichaje de cada empleado, leído desde el módulo Personal. Si un empleado no tiene QR asignado, asígnalo primero en su ficha del módulo Personal.</p>'
    + '<input id="qrEmpBuscar" placeholder="Buscar empleado…" style="width:100%;max-width:320px;margin-bottom:12px">'
    + '<div id="qrEmpMsg" class="qrmuted"></div>'
    + '<table id="qrEmpTabla" style="display:none"><tr><th>Empleado</th><th>Departamento</th><th>QR</th></tr><tbody id="qrEmpBody"></tbody></table>'
    + '</div>'
  );

  const clientScript = buildQrClientScript(atLeastAdmin);

  return '<div class="wrap">'
  + '<h1>Gestor de QR</h1>'
  + '<p class="muted">Generación local de códigos QR para el hotel: accesos, WiFi, carteles e impresión.</p>'

  + '<div class="box"><h3 style="color:var(--od);margin-bottom:12px">⭐ Presets del hotel</h3>'
  + '<div class="qrgrid">' + presetCards + '</div></div>'

  + '<div class="box"><h3 style="color:var(--od);margin-bottom:12px">🔗 URL o texto libre</h3>'
  + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">'
  + '<input id="qrFreeInput" placeholder="https://… o cualquier texto" style="flex:1;min-width:240px">'
  + '<input id="qrFreeSize" type="number" value="300" min="100" max="1000" style="width:90px" title="Tamaño px">'
  + '<button type="button" id="qrFreeBtn" class="btn">Generar</button>'
  + '</div><div id="qrFreeResult" style="margin-top:14px"></div></div>'

  + '<div class="box"><h3 style="color:var(--od);margin-bottom:12px">📶 WiFi</h3>'
  + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">'
  + '<input id="qrWifiSsid" placeholder="Nombre de red (SSID)" style="min-width:200px">'
  + '<select id="qrWifiTipo"><option value="WPA">WPA / WPA2</option><option value="nopass">Abierta (sin contraseña)</option></select>'
  + '<input id="qrWifiPass" placeholder="Contraseña" type="text" style="min-width:180px">'
  + '<button type="button" id="qrWifiBtn" class="btn">Generar</button>'
  + '</div><p class="qrmuted" style="margin-top:8px">El propio operador introduce el SSID y la clave del WiFi de huéspedes. No se guarda nada aquí.</p>'
  + '<div id="qrWifiResult" style="margin-top:14px"></div></div>'

  + empleadosSection

  + '<div class="box"><h3 style="color:var(--od);margin-bottom:6px">🖨️ Vista de impresión</h3>'
  + '<p class="qrmuted" style="margin-bottom:12px">Añade QR con el botón "Añadir a impresión" de cualquier sección y luego imprime la hoja con todos.</p>'
  + '<div id="qrTrayEmpty" class="qrmuted">Todavía no has añadido ningún QR a la bandeja de impresión.</div>'
  + '<div id="qrTrayList" class="qrgrid"></div>'
  + '<div style="margin-top:14px;display:flex;gap:10px">'
  + '<button type="button" id="qrPrintBtn" class="btn">Imprimir bandeja</button>'
  + '<button type="button" id="qrClearBtn" class="btn d">Vaciar bandeja</button>'
  + '</div></div>'

  + '<div id="qrPrintSheet"></div>'
  + '</div>'

  + '<style>'
  + '.qrgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}'
  + '.qrcard{background:#fbfdfe;border:1px solid #eef3f5;border-radius:12px;padding:14px;text-align:center}'
  + '.qrcard img{background:#fff;padding:6px;border-radius:8px;border:1px solid #eef3f5}'
  + '.qrlabel{font-weight:700;color:var(--od);margin-top:8px;font-size:14px;word-break:break-word}'
  + '.qrmuted{color:#888;font-size:12px;word-break:break-all}'
  + '.qractions{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:10px}'
  + '.qractions .btn{font-size:12px;padding:6px 10px;text-decoration:none;display:inline-block}'
  + '#qrPrintSheet{display:none}'
  + '@media print{'
  + 'body *{visibility:hidden}'
  + '#qrPrintSheet,#qrPrintSheet *{visibility:visible}'
  + '#qrPrintSheet{display:block !important;position:absolute;left:0;top:0;width:100%;padding:20px}'
  + '.qrsheetgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}'
  + '.qrsheetitem{text-align:center;page-break-inside:avoid;margin-bottom:20px}'
  + '.qrsheetitem img{width:100%;max-width:220px}'
  + '.qrsheetitem div{margin-top:6px;font-size:13px;font-weight:600}'
  + '}'
  + '</style>'

  + '<script>' + clientScript + '</script>';
}

// Todo el JS de cliente construye el DOM con createElement/textContent
// (nunca innerHTML con datos de usuario) para evitar cualquier inyección
// a partir de SSID de WiFi, texto libre o nombres de empleados.
function buildQrClientScript(atLeastAdmin){
  let js = `
(function(){
  var QR_TRAY = [];

  function qrAddTray(src, label){ QR_TRAY.push({src:src, label:label}); qrRenderTray(); }
  function qrQuitarTray(i){ QR_TRAY.splice(i,1); qrRenderTray(); }
  function qrVaciarBandeja(){ QR_TRAY = []; qrRenderTray(); }

  function qrRenderTray(){
    var list = document.getElementById('qrTrayList');
    var empty = document.getElementById('qrTrayEmpty');
    list.innerHTML = '';
    if(QR_TRAY.length === 0){ empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    QR_TRAY.forEach(function(it, i){
      var card = document.createElement('div'); card.className = 'qrcard';
      var img = document.createElement('img'); img.src = it.src; img.width = 150; img.height = 150;
      var lbl = document.createElement('div'); lbl.className = 'qrlabel'; lbl.textContent = it.label;
      var actions = document.createElement('div'); actions.className = 'qractions';
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn d'; btn.textContent = 'Quitar';
      btn.addEventListener('click', function(){ qrQuitarTray(i); });
      actions.appendChild(btn);
      card.appendChild(img); card.appendChild(lbl); card.appendChild(actions);
      list.appendChild(card);
    });
  }

  function qrImprimirBandeja(){
    if(QR_TRAY.length === 0){ alert('La bandeja de impresión está vacía. Añade algún QR primero.'); return; }
    var sheet = document.getElementById('qrPrintSheet');
    sheet.innerHTML = '';
    var grid = document.createElement('div'); grid.className = 'qrsheetgrid';
    QR_TRAY.forEach(function(it){
      var item = document.createElement('div'); item.className = 'qrsheetitem';
      var img = document.createElement('img'); img.src = it.src;
      var lbl = document.createElement('div'); lbl.textContent = it.label;
      item.appendChild(img); item.appendChild(lbl);
      grid.appendChild(item);
    });
    sheet.appendChild(grid);
    window.print();
  }

  // Delegación: cualquier botón "Añadir a impresión" ya presente en el HTML
  // servido (presets) usa data-tray-src / data-tray-label.
  document.addEventListener('click', function(ev){
    var t = ev.target.closest('[data-tray-src]');
    if(t) qrAddTray(t.getAttribute('data-tray-src'), t.getAttribute('data-tray-label'));
  });

  function qrCard(src, label, sub, downloadHref, downloadName){
    var card = document.createElement('div'); card.className = 'qrcard'; card.style.display = 'inline-block';
    var img = document.createElement('img'); img.src = src; img.width = 180; img.height = 180;
    var lbl = document.createElement('div'); lbl.className = 'qrlabel'; lbl.textContent = label;
    card.appendChild(img); card.appendChild(lbl);
    if(sub){ var subEl = document.createElement('div'); subEl.className = 'qrmuted'; subEl.style.maxWidth = '220px'; subEl.textContent = sub; card.appendChild(subEl); }
    var actions = document.createElement('div'); actions.className = 'qractions';
    var a = document.createElement('a'); a.className = 'btn'; a.href = downloadHref; a.download = downloadName; a.textContent = 'Descargar PNG';
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn s'; b.textContent = 'Añadir a impresión';
    b.addEventListener('click', function(){ qrAddTray(downloadHref, label); });
    actions.appendChild(a); actions.appendChild(b);
    card.appendChild(actions);
    return card;
  }

  function qrGenerarLibre(){
    var v = document.getElementById('qrFreeInput').value.trim();
    var size = document.getElementById('qrFreeSize').value || 300;
    var box = document.getElementById('qrFreeResult');
    box.innerHTML = '';
    if(!v) return;
    var src = '/qr/png?data=' + encodeURIComponent(v) + '&size=' + size;
    var dl = '/qr/png?data=' + encodeURIComponent(v) + '&size=800';
    box.appendChild(qrCard(src, v.length > 40 ? v.slice(0,40) + '…' : v, v, dl, 'qr.png'));
  }

  function qrWifiEscape(s){ return String(s || '').replace(/([\\\\;,:])/g, '\\\\$1'); }

  function qrGenerarWifi(){
    var ssid = document.getElementById('qrWifiSsid').value.trim();
    var tipo = document.getElementById('qrWifiTipo').value;
    var pass = document.getElementById('qrWifiPass').value;
    var box = document.getElementById('qrWifiResult');
    box.innerHTML = '';
    if(!ssid){ alert('Indica el nombre de la red (SSID)'); return; }
    var p = (tipo === 'nopass') ? '' : qrWifiEscape(pass);
    var wifiStr = 'WIFI:S:' + qrWifiEscape(ssid) + ';T:' + tipo + ';P:' + p + ';;';
    var src = '/qr/png?data=' + encodeURIComponent(wifiStr) + '&size=300';
    var dl = '/qr/png?data=' + encodeURIComponent(wifiStr) + '&size=800';
    box.appendChild(qrCard(src, 'WiFi: ' + ssid, null, dl, 'qr-wifi.png'));
  }

  document.getElementById('qrFreeBtn').addEventListener('click', qrGenerarLibre);
  document.getElementById('qrWifiBtn').addEventListener('click', qrGenerarWifi);
  document.getElementById('qrPrintBtn').addEventListener('click', qrImprimirBandeja);
  document.getElementById('qrClearBtn').addEventListener('click', qrVaciarBandeja);
`;

  if (atLeastAdmin) {
    js += `
  function qrFiltrarEmpleados(){
    var q = document.getElementById('qrEmpBuscar').value.toLowerCase();
    var rows = document.querySelectorAll('#qrEmpBody tr');
    rows.forEach(function(row){
      var txt = row.getAttribute('data-nombre') || '';
      row.style.display = txt.indexOf(q) === -1 ? 'none' : '';
    });
  }
  document.getElementById('qrEmpBuscar').addEventListener('input', qrFiltrarEmpleados);

  function qrEmpToggle(id, nombreCompleto, cell){
    if(cell.getAttribute('data-loaded') === '1'){
      cell.style.display = cell.style.display === 'none' ? 'block' : 'none';
      return;
    }
    cell.innerHTML = '';
    var src = '/qr/empleados/' + id + '/png?size=200';
    var dl = '/qr/empleados/' + id + '/png?size=800';
    var img = document.createElement('img'); img.width = 120; img.height = 120; img.src = src;
    img.addEventListener('error', function(){
      cell.innerHTML = '';
      var span = document.createElement('span'); span.textContent = 'Sin QR asignado (ver módulo Personal)';
      cell.appendChild(span);
    });
    cell.appendChild(img);
    var actions = document.createElement('div'); actions.className = 'qractions';
    var a = document.createElement('a'); a.className = 'btn'; a.href = dl; a.download = 'qr-empleado-' + id + '.png'; a.textContent = 'Descargar';
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn s'; b.textContent = 'Añadir a impresión';
    b.addEventListener('click', function(){ qrAddTray(dl, nombreCompleto); });
    actions.appendChild(a); actions.appendChild(b);
    cell.appendChild(actions);
    cell.setAttribute('data-loaded', '1');
  }

  fetch('/qr/empleados/list').then(function(r){ return r.json(); }).then(function(data){
    var msg = document.getElementById('qrEmpMsg');
    var tabla = document.getElementById('qrEmpTabla');
    if(!data.ok){ msg.textContent = data.error || 'No se pudo cargar la lista de empleados.'; return; }
    if(!data.empleados.length){ msg.textContent = 'No hay empleados activos registrados en el módulo Personal.'; return; }
    msg.textContent = '';
    tabla.style.display = 'table';
    var body = document.getElementById('qrEmpBody');
    data.empleados.forEach(function(e){
      var nombreCompleto = (e.nombre || '') + ' ' + (e.apellidos || '');
      var tr = document.createElement('tr'); tr.setAttribute('data-nombre', nombreCompleto.toLowerCase());
      var tdNombre = document.createElement('td'); tdNombre.textContent = nombreCompleto;
      var tdDepto = document.createElement('td'); tdDepto.textContent = e.departamento || '-';
      var tdQr = document.createElement('td');
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn'; btn.textContent = 'Generar QR';
      var cell = document.createElement('div'); cell.style.marginTop = '8px';
      btn.addEventListener('click', function(){ qrEmpToggle(e.id, nombreCompleto, cell); });
      tdQr.appendChild(btn); tdQr.appendChild(cell);
      tr.appendChild(tdNombre); tr.appendChild(tdDepto); tr.appendChild(tdQr);
      body.appendChild(tr);
    });
  }).catch(function(){
    document.getElementById('qrEmpMsg').textContent = 'No se pudo cargar la lista de empleados.';
  });
`;
  }

  js += `
})();
`;
  return js;
}

app.get('/qr', requireAuth, (req,res)=>{
  res.send(layout('Gestor de QR', qrPageBody(req.session.user), req.session.user, '/qr'));
});

app.get('/qr/png', requireAuth, async (req,res)=>{
  const data = req.query.data;
  if(!data || typeof data !== 'string' || !data.trim()) return res.status(400).send('Falta el parámetro data');
  if(data.length > QR_MAX_DATA_LEN) return res.status(400).send('Contenido demasiado largo para un QR');
  const size = clampInt(req.query.size, 100, 1000, 300);
  try {
    const buf = await QRCode.toBuffer(data, { type:'png', width:size, margin:1 });
    res.set('Content-Type','image/png'); res.set('Cache-Control','no-store'); res.send(buf);
  } catch(e){ res.status(500).send('Error generando QR'); }
});

app.get('/qr/svg', requireAuth, async (req,res)=>{
  const data = req.query.data;
  if(!data || typeof data !== 'string' || !data.trim()) return res.status(400).send('Falta el parámetro data');
  if(data.length > QR_MAX_DATA_LEN) return res.status(400).send('Contenido demasiado largo para un QR');
  const size = clampInt(req.query.size, 100, 1000, 300);
  try {
    const svg = await QRCode.toString(data, { type:'svg', width:size, margin:1 });
    res.set('Content-Type','image/svg+xml'); res.set('Cache-Control','no-store'); res.send(svg);
  } catch(e){ res.status(500).send('Error generando QR'); }
});

// ─── Carnets de empleado (fichaje) — solo admin/superadmin. Lectura directa
// (SELECT) de personal_adaria; el qr_token nunca viaja en el JSON, solo se
// usa en el servidor para pintar el PNG. ───
app.get('/qr/empleados/list', requireAuth, requireAtLeastAdmin, async (req,res)=>{
  if(!qrPersonalPool) return res.json({ ok:false, error:'Integración con el módulo Personal no configurada en este portal.' });
  try {
    const { rows } = await qrPersonalPool.query(
      `SELECT e.id, e.nombre, e.apellidos, d.nombre AS departamento
       FROM empleado e LEFT JOIN departamento d ON d.id = e.departamento_id
       WHERE e.property_id = $1 AND e.activo = true
       ORDER BY e.apellidos, e.nombre`, [QRP_PROPERTY_ID]);
    res.json({ ok:true, empleados: rows });
  } catch(e){
    console.error('qr/empleados/list', e.message);
    res.status(502).json({ ok:false, error:'No se pudo consultar el módulo Personal.' });
  }
});

app.get('/qr/empleados/:id/png', requireAuth, requireAtLeastAdmin, async (req,res)=>{
  if(!qrPersonalPool) return res.status(501).send('Integración con el módulo Personal no configurada');
  const id = parseInt(req.params.id,10);
  if(!Number.isFinite(id)) return res.status(400).send('id inválido');
  try {
    const { rows } = await qrPersonalPool.query(
      'SELECT qr_token FROM empleado WHERE id=$1 AND property_id=$2', [id, QRP_PROPERTY_ID]);
    if(!rows.length || !rows[0].qr_token) return res.status(404).send('Este empleado no tiene QR de fichaje asignado (asígnalo en el módulo Personal)');
    const size = clampInt(req.query.size, 100, 1000, 300);
    const buf = await QRCode.toBuffer(rows[0].qr_token, { type:'png', width:size, margin:1 });
    res.set('Content-Type','image/png'); res.set('Cache-Control','no-store'); res.send(buf);
    audit('QR_EMPLEADO_PNG', req, { target:String(id) });
  } catch(e){
    console.error('qr/empleados/:id/png', e.message);
    res.status(502).send('No se pudo consultar el módulo Personal');
  }
});


// ─── Escáner DNI/MRZ — FASE 4 (26/08/2026), MODO PRUEBA ────────────────────
// Clonado de btr-gestion-portal/documentos.js + lib/aci-write.js, sin tocar
// su lógica: las salvaguardas (DOC_DRY_RUN, copia previa, GRANT por columna)
// son las mismas que llevan en producción en BTR desde el 06/08/2026. Lo que
// cambia aquí es la configuración: DOC_DRY_RUN=true fijo y
// DOC_HOTELES_ESCRITURA vacío en .env, así que aci-write.js nunca ejecuta un
// UPDATE real pase lo que pase en el código. Ver
// VeraAdaria_memory/sql_aci_doc_rw_bloqueador.md para qué falta para
// activarlo de verdad (usuario de escritura, pendiente de Hotansa).
if (docPool) {
  const documentos = require('./documentos');
  documentos.register(app, { pgPool: docPool, requireAuth, auditLog: audit });
  documentos.ensureSchema(docPool).catch((e) =>
    console.error('[escaner-dni] ensureSchema falló:', e.message));
} else {
  console.warn('[escaner-dni] DOC_PGUSER no configurado en .env: módulo documentos.js NO registrado.');
}

app.get('/api/version',(req,res)=>res.json({version:require('./package.json').version}));

app.get('/health',(req,res)=>res.json({ok:true,app:'adaria-gestion',v:'1.2.0'}));
app.listen(PORT,'0.0.0.0',()=>console.log('Adaria Gestión v1.2.0 en :'+PORT));
