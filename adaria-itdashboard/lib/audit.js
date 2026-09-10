'use strict';
const db = require('./db');

const stmt = db.prepare(
  `INSERT INTO audit_log (username, accion, detalle, ip, user_agent) VALUES (?, ?, ?, ?, ?)`
);

function log(req, accion, detalle = '') {
  try {
    const username = (req && req.session && req.session.user && req.session.user.username) || (req && req._loginUser) || null;
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() : '';
    const ua = req ? (req.headers['user-agent'] || '').slice(0, 250) : '';
    stmt.run(username, accion, String(detalle).slice(0, 500), ip, ua);
  } catch (e) {
    console.error('audit error', e.message);
  }
}

module.exports = { log };
