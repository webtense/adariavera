#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let content = fs.readFileSync(serverPath, 'utf8');

// Rutas que necesitan protección: reemplazar
// app.get('/api/property', (req, res) => {
// CON
// app.get('/api/property', ensureAuth, (req, res) => {

const routesToProtect = [
  "/api/property",
  "/api/departamentos",
  "/api/empleados",
  "/api/fichajes",
  "/api/inspeccion",
  "/api/informes",
  "/api/export_log",
  "/api/mensajes-motivacionales"
];

let changeCount = 0;

for (const route of routesToProtect) {
  // Pattern: app.get('/api/property', (req, res) => {
  const pattern = new RegExp(
    `app\\.get\\('${route.replace(/\//g, '\\/')}(?:\\/:\\w+)?'\\s*,\\s*\\(req,\\s*res\\)\\s*=>\\s*\\{`,
    'g'
  );

  if (pattern.test(content)) {
    content = content.replace(
      pattern,
      `app.get('${route.replace(/'/g, "\\'")}', ensureAuth, (req, res) => {`
    );
    changeCount++;
    console.log(`✓ Protegida: ${route}`);
  }
}

// Lo mismo para POST
for (const route of routesToProtect) {
  const pattern = new RegExp(
    `app\\.post\\('${route.replace(/\//g, '\\/')}(?:\\/:\\w+)?'\\s*,\\s*\\(req,\\s*res\\)\\s*=>\\s*\\{`,
    'g'
  );

  if (pattern.test(content)) {
    content = content.replace(
      pattern,
      `app.post('${route.replace(/'/g, "\\'")}', ensureAuth, (req, res) => {`
    );
    changeCount++;
  }
}

// DELETE también
for (const route of routesToProtect) {
  const pattern = new RegExp(
    `app\\.delete\\('${route.replace(/\//g, '\\/')}(?:\\/:\\w+)?'\\s*,\\s*\\(req,\\s*res\\)\\s*=>\\s*\\{`,
    'g'
  );

  if (pattern.test(content)) {
    content = content.replace(
      pattern,
      `app.delete('${route.replace(/'/g, "\\'")}', ensureAuth, (req, res) => {`
    );
    changeCount++;
  }
}

fs.writeFileSync(serverPath, content, 'utf8');
console.log(`✓ ${changeCount} rutas protegidas con ensureAuth`);
