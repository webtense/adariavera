#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Leer server.js
const serverPath = path.join(__dirname, 'server.js');
let content = fs.readFileSync(serverPath, 'utf8');

// CAMBIO 1: Añadir importación de sso-middleware después de const bcrypt = ...
const bcryptLine = "const bcrypt = require('bcryptjs');";
if (content.includes(bcryptLine) && !content.includes("const ssoMiddleware = require('./sso-middleware');")) {
  content = content.replace(
    bcryptLine,
    bcryptLine + "\nconst ssoMiddleware = require('./sso-middleware');"
  );
  console.log('✓ sso-middleware importado');
}

// CAMBIO 2: Añadir middleware SSO después de app.use(session({...}));
// Buscar la línea que cierra app.use(session
const sessionPattern = /app\.use\(session\(\{[\s\S]*?\}\)\);/;
if (sessionPattern.test(content)) {
  content = content.replace(
    sessionPattern,
    (match) => match + "\n// Middleware SSO: intenta leer cookie btr_sso desde portal\napp.use(ssoMiddleware.attachSsoUser());"
  );
  console.log('✓ Middleware SSO attachSsoUser añadido');
}

// CAMBIO 3: Modificar ruta POST /login para aceptar SSO
const loginPostPattern = /app\.post\('\/login',[\s]*\(req, res\) => \{[\s\S]*?res\.redirect\(BASE_PATH \+ '\/login\?e=1'\);[\s]*\}\);/;
const newLoginPost = `app.post('/login', (req, res) => {
  const u = (req.body.u || '').trim().toLowerCase();
  const p = req.body.p || '';

  // Si hay sesión SSO válida, redireccionar (ya está autenticado)
  if (req.ssoUser) {
    return res.redirect(BASE_PATH + '/');
  }

  // Validar contra login local (fallback)
  if (u && ADMIN_USER && u === ADMIN_USER && ADMIN_PASSWORD_HASH && bcrypt.compareSync(p, ADMIN_PASSWORD_HASH)) {
    req.session.user = { login: u, rol: 'superadmin', source: 'local' };
    return res.redirect(BASE_PATH + '/');
  }

  res.redirect(BASE_PATH + '/login?e=1');
});`;

if (content.match(loginPostPattern)) {
  content = content.replace(loginPostPattern, newLoginPost);
  console.log('✓ Ruta POST /login actualizada para soportar SSO');
}

// CAMBIO 4: Añadir funciones de autorización antes de app.get('/health', ...)
const healthRoute = "app.get('/health'";
if (content.includes(healthRoute) && !content.includes('function ensureAuth(')) {
  const authFunctions = `
// Middleware de autorización que combina SSO + local
function ensureAuth(req, res, next) {
  req.user = req.session.user || req.ssoUser;
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

function ensureAdmin(req, res, next) {
  ensureAuth(req, res, () => {
    const userRol = req.user.rol || (req.user.source === 'local' ? 'superadmin' : 'usuario');
    if (userRol !== 'admin' && userRol !== 'superadmin') {
      return res.status(403).json({ error: 'Acceso denegado — se requiere rol admin' });
    }
    next();
  });
}

function ensureSuperadmin(req, res, next) {
  ensureAuth(req, res, () => {
    const userRol = req.user.rol || (req.user.source === 'local' ? 'superadmin' : 'usuario');
    if (userRol !== 'superadmin') {
      return res.status(403).json({ error: 'Acceso denegado — se requiere rol superadmin' });
    }
    next();
  });
}

`;
  content = content.replace(
    healthRoute,
    authFunctions + "// ─── Salud (pública, sin auth, para systemd/monitorización) ───\n" + healthRoute
  );
  console.log('✓ Funciones de autorización añadidas');
}

// Escribir el archivo actualizado
fs.writeFileSync(serverPath, content, 'utf8');
console.log('✓ server.js actualizado exitosamente');
console.log('Siguiente: npm install && systemctl restart adaria-personal');
