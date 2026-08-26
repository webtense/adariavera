'use strict';

/**
 * Middleware SSO para adaria-personal.
 * Lee la cookie compartida `btr_sso` desde el portal de gestión.
 * Si existe, valida la sesión en Redis (compartida).
 * Si no, mantiene login propio como fallback.
 */

const { createClient } = require('redis');

let redisClient = null;
let connecting = null;

// Configuración SSO — heredada del portal (gestión)
const ssoConfig = {
  redis: {
    url: process.env.SSO_REDIS_URL || 'redis://127.0.0.1:6379/2',
    prefix: process.env.SSO_REDIS_PREFIX || 'btr:sso:',
  },
  cookie: {
    name: process.env.SSO_COOKIE_NAME || 'btr_sso',
  },
  // Roles permitidos y sus restricciones en adaria-personal
  roleMapping: {
    'guest': {
      label: 'Recepción',
      cards: 6, // solo cards estándar
      canViewEmployees: false,
      canViewAudit: false,
      canDeleteRecords: false,
    },
    'admin': {
      label: 'Administrador',
      cards: -1, // todas las cards
      canViewEmployees: true,
      canViewAudit: false, // admins no ven auditoría (solo superadmin)
      canDeleteRecords: false,
    },
    'superadmin': {
      label: 'Super Administrador',
      cards: -1, // todas las cards
      canViewEmployees: true,
      canViewAudit: true,
      canDeleteRecords: true,
    },
    'usuario': {
      label: 'Usuario',
      cards: 3, // cards limitadas
      canViewEmployees: false,
      canViewAudit: false,
      canDeleteRecords: false,
    },
  },
};

async function getRedisClient() {
  if (redisClient && redisClient.isOpen) return redisClient;
  if (!redisClient) {
    redisClient = createClient({
      url: ssoConfig.redis.url,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) =>
          retries > 3 ? new Error('Redis no disponible') : Math.min(retries * 200, 1000),
      },
    });
    redisClient.on('error', (err) =>
      console.warn('[adaria-sso] Redis warning:', err.message)
    );
  }
  if (!redisClient.isOpen) {
    if (!connecting) connecting = redisClient.connect();
    try {
      await connecting;
    } catch (e) {
      try {
        redisClient.destroy && redisClient.destroy();
      } catch (_) {
        /* noop */
      }
      redisClient = null;
      connecting = null;
      throw e;
    }
    connecting = null;
  }
  return redisClient;
}

/**
 * Lee el sid de la cookie `btr_sso`.
 * Soporta tanto cookie-parser como lectura manual de headers.
 */
function readSsoCookie(req) {
  const name = ssoConfig.cookie.name;
  // Con cookie-parser
  if (req.cookies && req.cookies[name]) return req.cookies[name];
  // Manual desde header
  const raw = req.headers && req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/**
 * Lee la sesión SSO desde Redis.
 * Devuelve el objeto usuario o null.
 */
async function readSsoSession(req) {
  try {
    const sid = readSsoCookie(req);
    if (!sid) return null;

    const redis = await getRedisClient();
    const key = `${ssoConfig.redis.prefix}${sid}`;
    const raw = await redis.get(key);

    if (!raw) return null;

    const data = JSON.parse(raw);
    // Validar que el usuario tenga un rol reconocido
    if (!ssoConfig.roleMapping[data.rol]) {
      console.warn(
        `[adaria-sso] Rol desconocido en sesión: ${data.rol}, usuario: ${data.login}`
      );
      return null;
    }
    return {
      ...data,
      ssoSource: 'redis',
      ssoRoleInfo: ssoConfig.roleMapping[data.rol],
    };
  } catch (e) {
    console.warn('[adaria-sso] Error leyendo sesión SSO:', e.message);
    return null;
  }
}

/**
 * Middleware Express que intenta autenticación SSO primero.
 * Si hay cookie `btr_sso` válida, usa esa.
 * Si no, deja pasar sin usuario (las rutas protegidas usarán login local).
 */
function attachSsoUser() {
  return async (req, _res, next) => {
    try {
      req.ssoUser = await readSsoSession(req);
    } catch (e) {
      req.ssoUser = null;
    }
    next();
  };
}

/**
 * Middleware de autorización que combina SSO + local.
 * Precedencia:
 * 1. Si hay sesión local (req.session.user), úsala
 * 2. Si hay sesión SSO (req.ssoUser), úsala
 * 3. Si no, redirecciona a /login
 */
function requireAuth(opts = {}) {
  const loginPath = opts.loginPath || '/login';
  return async (req, res, next) => {
    // Prioridad: sesión local (más fresca que SSO)
    if (req.session && req.session.user) {
      req.user = { ...req.session.user, source: 'local' };
      return next();
    }

    // Fallback: sesión SSO
    if (req.ssoUser) {
      req.user = req.ssoUser;
      return next();
    }

    // No autenticado
    const wantsJson =
      req.path.startsWith('/api') || (req.headers.accept || '').includes('application/json');
    if (wantsJson) return res.status(401).json({ error: 'No autenticado' });
    const next_ = encodeURIComponent(req.originalUrl || req.url || '/');
    return res.redirect(`${loginPath}?next=${next_}`);
  };
}

/**
 * Middleware que requiere rol específico.
 * Soporta: 'admin', 'superadmin', 'guest', etc.
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      const wantsJson =
        req.path.startsWith('/api') || (req.headers.accept || '').includes('application/json');
      if (wantsJson) return res.status(401).json({ error: 'No autenticado' });
      return res.redirect('/login');
    }

    if (req.user.rol !== role && req.user.rol !== 'superadmin') {
      const wantsJson =
        req.path.startsWith('/api') || (req.headers.accept || '').includes('application/json');
      if (wantsJson) {
        return res
          .status(403)
          .json({ error: `Acceso denegado — se requiere rol "${role}"` });
      }
      return res.status(403).send('Acceso denegado');
    }
    next();
  };
}

/**
 * Middleware que requiere rol admin o superior.
 */
function requireAdmin() {
  return (req, res, next) => {
    if (!req.user) {
      const wantsJson =
        req.path.startsWith('/api') || (req.headers.accept || '').includes('application/json');
      if (wantsJson) return res.status(401).json({ error: 'No autenticado' });
      return res.redirect('/login');
    }

    if (req.user.rol !== 'admin' && req.user.rol !== 'superadmin') {
      const wantsJson =
        req.path.startsWith('/api') || (req.headers.accept || '').includes('application/json');
      if (wantsJson) {
        return res.status(403).json({ error: 'Acceso denegado — se requiere rol admin' });
      }
      return res.status(403).send('Acceso denegado');
    }
    next();
  };
}

/**
 * Middleware que requiere rol superadmin.
 */
function requireSuperadmin() {
  return (req, res, next) => {
    if (!req.user) {
      const wantsJson =
        req.path.startsWith('/api') || (req.headers.accept || '').includes('application/json');
      if (wantsJson) return res.status(401).json({ error: 'No autenticado' });
      return res.redirect('/login');
    }

    if (req.user.rol !== 'superadmin') {
      const wantsJson =
        req.path.startsWith('/api') || (req.headers.accept || '').includes('application/json');
      if (wantsJson) {
        return res.status(403).json({ error: 'Acceso denegado — se requiere rol superadmin' });
      }
      return res.status(403).send('Acceso denegado');
    }
    next();
  };
}

module.exports = {
  attachSsoUser,
  requireAuth,
  requireRole,
  requireAdmin,
  requireSuperadmin,
  readSsoSession,
  readSsoCookie,
  roleMapping: ssoConfig.roleMapping,
  config: ssoConfig,
};
