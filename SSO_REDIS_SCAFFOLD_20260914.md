# SSO + Redis Scaffold — Sprint Vera Adaria (para ejecutar 15/09/2026)

## 🎯 Objetivo
Compartir sesiones entre 5 módulos (gestion, parking, precheckin, personal, welcome) usando Redis como store. Usuario hace login en gestion → entra a otros módulos sin re-validar.

---

## 📋 PLAN EJECUCIÓN (próxima sesión, ~1-2 horas)

### Fase 1: Preparar Redis en CT111
```bash
# En CT111:
apt update && apt install -y redis-server
systemctl start redis-server
systemctl enable redis-server
redis-cli ping  # debe responder PONG
```

### Fase 2: Crear tabla `sessions` (opcional, puede estar en Redis puro)
```sql
-- En parking_adaria BD (para backup/auditoría):
CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMP NOT NULL DEFAULT (now() + interval '8 hours')
);
CREATE INDEX idx_sessions_expire ON sessions(expire);
```

### Fase 3: Actualizar package.json de todos los módulos
Agregar a cada `adaria-*/package.json`:
```json
"connect-redis": "^7.1.0",
"redis": "^4.6.0"
```

Luego en cada CT:
```bash
cd /opt/adaria-MODULO && npm install
```

### Fase 4: Modificar server.js de los 5 módulos
Ver código base abajo. Cambios clave:
- Importar `redis` + `connectRedis`
- Crear cliente Redis: `const redisClient = redis.createClient({host: '127.0.0.1', port: 6379});`
- Cambiar session({ store: new RedisStore({client: redisClient}) })
- Shared SESSION_SECRET = `'adaria-sso-secret-2026'` (igual en todos)
- Cookie name = `'adaria_session'`

### Fase 5: Deploy y reinicio
```bash
# Para cada módulo:
systemctl restart adaria-MODULO
```

### Fase 6: Verificación
```bash
# Login en gestion, copiar cookie 'adaria_session', probar en parking sin login
curl -b "adaria_session=XXXX" http://192.168.1.81:3091/admin
```

---

## 💾 CÓDIGO BASE — Cambios mínimos por módulo

### Template: session config (igual en todos)
```javascript
const redis = require('redis');
const RedisStore = require('connect-redis').default;

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
    secure: false,  // HTTP local
    maxAge: 1000 * 60 * 60 * 8  // 8h
  }
};

app.use(session(sessionConfig));
```

### Cambios en cada server.js

#### adaria-gestion/server.js (ya tiene session, solo reemplazar store)
- Línea ~121: reemplazar `session({...})` con código de arriba
- Agregar imports de redis + connect-redis

#### adaria-parking/server.js (similar)
- Línea ~34: reemplazar session config
- Middleware requireAuth: si no hay `req.session.user`, redirigir a `/login` (que Parking tiene)

#### adaria-precheckin/server.js (no tiene login tradicional, ver nota)
- Precheckin es sin auth — SALTAR SSO, dejar como está

#### adaria-personal/server.js (tiene /rrhh/quiosco protegida)
- Línea ~47: reemplazar session config
- Middleware requireKiosk ya existe, usar req.session.user si lo hay

#### adaria-welcome/server.js (sin login hoy, tablet pública)
- Welcome es pública — SALTAR SSO por ahora

---

## 🔧 CONFIGURACIÓN REDIS POR MÓDULO

### Conexión compartida en CT111
Todos apuntan a: `redis://127.0.0.1:6379`

### Si Parking está en CT111 y Welcome en CT112
Welcome necesita acceder a Redis en CT111. Cambiar:
```javascript
const redisClient = redis.createClient({
  host: '192.168.1.81',  // IP del Proxmox, Welcome lo ve
  port: 6379
});
```

---

## 📝 PASOS EJECUCIÓN MAÑANA (copiar/pegar)

```bash
# 1. SSH al Proxmox
ssh root@192.168.1.10

# 2. Instalar Redis en CT111
pct exec 111 -- bash -c 'apt update && apt install -y redis-server && systemctl start redis-server && systemctl enable redis-server && redis-cli ping'

# 3. Verificar que Redis responde
pct exec 111 -- redis-cli ping  # PONG

# 4. En el repo local, actualizar package.json de gestion + parking
cd /home/asanchez/Documentos/@Laboral/VeraAdaria/repo
# ... aplicar cambios de código base abajo ...

# 5. npm install en ambos CT
cat adaria-gestion/package.json | sshpass -p '***REMOVED***' ssh root@192.168.1.10 "pct exec 111 -- tee /opt/adaria-gestion/package.json > /dev/null"
sshpass -p '***REMOVED***' ssh root@192.168.1.10 "pct exec 111 -- bash -c 'cd /opt/adaria-gestion && npm install'"

# 6. Deploy de server.js (gestion + parking)
cat adaria-gestion/server.js | sshpass -p '***REMOVED***' ssh root@192.168.1.10 "pct exec 111 -- tee /opt/adaria-gestion/server.js > /dev/null"
cat adaria-parking/server.js | sshpass -p '***REMOVED***' ssh root@192.168.1.10 "pct exec 111 -- tee /opt/adaria-parking/server.js > /dev/null"

# 7. Reiniciar
sshpass -p '***REMOVED***' ssh root@192.168.1.10 "pct exec 111 -- systemctl restart adaria-gestion adaria-parking"

# 8. Verificar
curl http://192.168.1.81:3093/login  # debe cargar login
```

---

## ⚠️ COSAS QUE PUEDEN FALLAR

1. **Redis no arranca** → revisar: `pct exec 111 -- systemctl status redis-server`
2. **npm install falla por dependencias** → ejecutar `npm audit fix` primero
3. **Session no cruza** → verificar que `adaria_session` cookie aparece en ambos navegadores
4. **Welcome en CT112 no accede a Redis en CT111** → firewall entre CT111↔CT112 (abrir puerto 6379)

---

## 📊 ESTADO FINAL ESPERADO

```
✅ Login en gestion → sesión guardada en Redis
✅ Click "Parking" → no pide login (lee sesión de Redis)
✅ Cookie 'adaria_session' visible en ambos
✅ Logout en gestion → sesión se elimina de Redis, próxima vez pide login
```

---

## 🔒 SEGURIDAD

- Redis en localhost (127.0.0.1), sin contraseña (CT111 es red privada)
- SESSION_SECRET fuerte y IGUAL en todos los módulos
- sameSite='lax' previene CSRF
- HTTPOnly cookie (no accesible desde JS)

---

**Creado:** 2026-09-14  
**Para ejecutar:** 2026-09-15  
**Tokens disponibles:** frescos (nueva sesión)
