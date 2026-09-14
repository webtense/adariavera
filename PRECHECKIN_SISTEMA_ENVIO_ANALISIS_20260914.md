# Análisis Completo — Sistema de Envío Precheckin
**Fecha**: 14/09/2026 | **Versión**: v1.2.0 | **Estado**: Operativo (parcial, SEND_MODE=test)

---

## 🎯 Flujo General

```
Día -7 ← Cron invitación (06:00) ← Lee llegadas ACI ← Envía email con enlace
   ↓
   → Huésped hace click en enlace → Rellena formulario → Sube firma
   ↓
   → POST /api/precheckin → Verifica en ACI → Guarda BD → mail.notify() (confirmación)
   ↓
   → Errores → Cron reintentos (diario) → mail.notify() hasta 3 veces
```

---

## 📧 Componentes

### 1. **mail.js** — Motor de envío (Nodemailer)

**Archivo**: `/opt/adaria-precheckin/mail.js`

**Función**: `async notify({ asunto, cuerpo, destinatario })`

**Características**:
- ✅ Nodemailer real (SMTP configurado)
- ✅ SEND_MODE: `test` (default) o `live`
- ✅ Test mode → redirige TO a `prechkinvera@boitaullresort.com` (buzón de pruebas)
- ✅ Live mode → envía a destinatario real
- ✅ **BCC siempre a `prechkinvera@boitaullresort.com`** (auditoría en ambos modos)
- ✅ Fallback: si SMTP falla → log local `logs/mail.log` (JSON)

**Retorna**: `{ enviado, modo, to, messageId?, error? }`

**Config Requerida**:
```bash
SEND_MODE=test|live                    # Default: test
NOTIFY_EMAIL=recepcion@hotel...       # Email de destino (si no viene en llamada)
SMTP_HOST=...                         # SMTP (ej: smtp.ionos.com)
SMTP_PORT=587                         # Default
SMTP_USER=...                         # Usuario SMTP
SMTP_PASS=...                         # Contraseña SMTP
SMTP_FROM=...                         # Remitente (ej: noreply@hoteladariavera.com)
SMTP_FROM_NAME=Hotel Adaria Vera     # Nombre del remitente (opcional)
```

---

### 2. **Cron de Invitación** — Proactivo

**Archivo**: `/opt/adaria-precheckin/cron_invitacion_precheckin.js`

**Ejecución**: Crontab (sugerido: `0 6 * * * cd /opt/adaria-precheckin && node cron_invitacion_precheckin.js`)

**Qué hace**:
1. Lee llegadas de próximos 7 días desde ACI
2. Filtra por email entregable (descarta OTA proxies)
3. Verifica idempotencia: ya no reinvita si existe fila en `precheckin_envio`
4. Genera token único (crypto.randomBytes 24 bytes)
5. Registra en BD tabla `precheckin_envio` (estado='pendiente_envio' o 'no_entregable')
6. Llama a `mail.notify()` con enlace de invitación

**Enlace Generado**:
```
${PUBLIC_BASE_URL}/?codigo=${codigoReserva}&apellido=${apellidoTitular}&t=${token}
```

**Config Requerida**:
```bash
PRECHECKIN_INVITACION_DIAS=7                               # Default: 7
PUBLIC_BASE_URL=https://precheckin.hoteladariavera.com    # Default
```

**Output**: Log en `logs/cron-invitacion.log` (stats: llegadas, sinEmail, yaInvitadas, noEntregables, enviadas, errores)

---

### 3. **Endpoint de Guardar** — POST /api/precheckin

**Archivo**: `/opt/adaria-precheckin/server.js` (línea 393)

**Flujo**:
1. **Valida**: código/apellido, personas (≥1), firma PNG
2. **Verifica en ACI**: buscarReserva() — confía SOLO en ACI, no en cliente
3. **Genera PDF**: firma.generarPdfPrecheckin() — PNG+PDF con SHA-256 hash
4. **Transacción BD**: INSERT precheckin_reserva (código, apellido, email, personas, PDF path, etc.)
5. **Llama registrarYNotificar()**: INSERT precheckin_notificacion_log + mail.notify()
6. **Retorna**: { ok, status, reservaId, codigo, files, pdfHashSha256 }

**Detalles registrarYNotificar()**:
```javascript
// 1. INSERT log ANTES de enviar (idempotencia por UNIQUE reserva_id,tipo)
INSERT INTO precheckin_notificacion_log (reserva_id, tipo, intentos, estado, ultimo_intento_en)
  ON CONFLICT (reserva_id, tipo) DO UPDATE SET intentos = intentos + 1, estado = 'pendiente'

// 2. Intenta envío
await mail.notify({ asunto, cuerpo })

// 3. UPDATE log con resultado
UPDATE precheckin_notificacion_log SET estado = 'enviado'|'error', motivo = modo|error
```

**Nota**: Error en mail.notify() NO IMPIDE guardar precheckin (ya hizo COMMIT). El cron de reintentos lo recoge.

---

### 4. **Cron de Reintentos** — Automático

**Archivo**: `/opt/adaria-precheckin/cron_precheckin_mejoras.js`

**Ejecución**: Crontab (sugerido: diario o cada 2 horas)

**Qué hace**:
1. Lee `precheckin_notificacion_log` con estado='error'
2. Si intentos < 3: reintentos += 1, estado='pendiente'
3. Llama a mail.notify() nuevamente
4. UPDATE con resultado

**Nota**: Completa la tarea E (Tarea E de FASE 3 — reintentos automáticos).

---

## 🔧 Configuración Actual (14/09/2026)

| Variable | Valor | Estado |
|----------|-------|--------|
| `SEND_MODE` | test | ✅ Por defecto (seguro) |
| `NOTIFY_EMAIL` | vacío | ⚠️ PENDIENTE |
| `SMTP_HOST` | no configurado | ⚠️ PENDIENTE (IONOS) |
| `SMTP_USER` | no configurado | ⚠️ PENDIENTE |
| `SMTP_PASS` | no configurado | ⚠️ PENDIENTE |
| `SMTP_FROM` | no configurado | ⚠️ PENDIENTE |
| `PUBLIC_BASE_URL` | `https://precheckin.hoteladariavera.com` | ✅ OK |
| `PRECHECKIN_INVITACION_DIAS` | 7 | ✅ OK |

---

## 📊 Tablas BD (precheckin_adaria)

### precheckin_reserva
Guarda cada pre check-in rellenado por huésped.
```sql
reserva_id (PK) | codigo | apellido_busqueda | email | telefono | 
habitacion | entrada | salida | personas (1:N) | 
signature_png_path | pdf_path | pdf_hash_sha256 | signed_at
```

### precheckin_notificacion_log
Traza cada intento de envío (invitación, confirmación, reintentos).
```sql
id (PK) | reserva_id | tipo | intentos | estado (pendiente/enviado/error) | 
motivo (test/live/error/sin_smtp/sin_destinatario) | ultimo_intento_en | actualizado_en
UNIQUE: reserva_id, tipo
```

### precheckin_envio
Registra invitaciones proactivas (cron).
```sql
id (PK) | reserva_codigo | email | token | estado (pendiente_envio/no_entregable/rellenado) |
generado_en | abierto_en | rellenado_en | clicked_en
```

### precheckin_persona
Personas de cada pre check-in (1:N con reserva).
```sql
id (PK) | reserva_id (FK) | es_titular | nombre | apellido1 | apellido2 | 
tipo_documento | numero_documento | fecha_nacimiento | nacionalidad
```

---

## 🚀 Cómo Activar (Pasos Recomendados)

### Fase 1: SMTP Real (IONOS)
```bash
# En /opt/adaria-precheckin/.env o systemd env:
SEND_MODE=live
NOTIFY_EMAIL=recepcion@hoteladariavera.com
SMTP_HOST=smtp.ionos.com
SMTP_PORT=587
SMTP_USER=noreply@hoteladariavera.com
SMTP_PASS=<contraseña IONOS>
SMTP_FROM=noreply@hoteladariavera.com
SMTP_FROM_NAME=Hotel Adaria Vera
```

### Fase 2: Crontab (CT111)
```bash
# Login en CT111
ssh root@192.168.1.10
pct exec 111 -- bash

# Editar crontab
crontab -e

# Agregar:
# Invitación proactiva (06:00 cada día)
0 6 * * * cd /opt/adaria-precheckin && node cron_invitacion_precheckin.js >> logs/cron-invitacion.log 2>&1

# Reintentos (03:00 cada día, o cada 2h)
0 3 * * * cd /opt/adaria-precheckin && node cron_precheckin_mejoras.js >> logs/cron-reintentos.log 2>&1

# Verificar:
crontab -l
```

### Fase 3: Verificar
```bash
# Logs en vivo:
tail -f /opt/adaria-precheckin/logs/mail.log          # Envíos
tail -f /opt/adaria-precheckin/logs/cron-invitacion.log
tail -f /opt/adaria-precheckin/logs/cron-reintentos.log

# BD:
psql -U postgres -d precheckin_adaria -c "SELECT * FROM precheckin_notificacion_log ORDER BY actualizado_en DESC LIMIT 10;"
redis-cli DBSIZE  # (Si Redis integrado)
```

---

## ✅ Estado Actual

| Componente | Status | Notas |
|---|---|---|
| **mail.js** | ✅ Listo | Nodemailer, test/live switch, fallback log |
| **cron_invitacion** | ✅ Listo | Genera invitaciones, respeta SEND_MODE |
| **POST /api/precheckin** | ✅ Listo | Guarda + registra + notifica |
| **cron_reintentos** | ✅ Listo | Reintentos hasta 3 veces |
| **Configuración SMTP** | ⚠️ Pendiente | Aguarda credenciales IONOS |
| **Crontab** | ⚠️ Pendiente | Aguarda setup en CT111 |

---

## 🔐 Seguridad

- ✅ **Lectura ACI**: SOLO SELECT, nunca UPDATE/INSERT
- ✅ **Idempotencia**: UNIQUE constraints previenen duplicados
- ✅ **Auditoría**: BCC siempre a buzón de pruebas
- ✅ **Transacciones**: Guardar pre check-in es atómico
- ✅ **Firma digital**: PDF + PNG + hash SHA-256
- ✅ **Tokens**: crypto.randomBytes (24 bytes, 48 hex chars)

---

## 📝 Próximas Sesiones

1. **Configurar IONOS SMTP** (usuario/contraseña reales)
2. **Configurar NOTIFY_EMAIL** (recepción real)
3. **Setup crontab** en CT111 (invitación 06:00, reintentos 03:00)
4. **Prueba end-to-end**: 
   - Reserva ficticia → Cron invita → Huésped rellena → Confirmación enviada
   - Verificar logs + auditoría en `prechkinvera@boitaullresort.com`
5. **Pasar a SEND_MODE=live** cuando usuario autorice

---

**Documentado por**: Claude Haiku 4.5  
**Revisión**: Análisis basado en código v1.2.0 (10/09/2026)
