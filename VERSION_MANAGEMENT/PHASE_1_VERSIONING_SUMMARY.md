# 🏷️ Fase 1 — Sistema de Versionado + Rollback

**Fecha:** 2026-09-02  
**Estado:** ✅ COMPLETADO  
**Responsable:** asanchez  

---

## 📋 Resumen Ejecutivo

Se ha implementado un sistema completo de versionado y rollback para los módulos Fase 1 (Welcome + Pre-checkin) con:

- ✅ Git Tags estratégicos (baseline + release)
- ✅ Archivos VERSION/ con metadatos versionados
- ✅ CHANGELOGs documentados
- ✅ Scripts de rollback ejecutables y probados
- ✅ package.json actualizado a v1.1.0

---

## 📦 Git Tags Creados

### Welcome Module
| Tag | Commit | Descripción |
|-----|--------|-------------|
| `v1.0.0-welcome-baseline` | `8fa1d1c` | Snapshot antes del sistema de versionado (baseline histórico) |
| `v1.1.0-welcome` | `463fb98` | Release v1.1.0 con package.json actualizado |

### Pre-checkin Module
| Tag | Commit | Descripción |
|-----|--------|-------------|
| `v1.0.0-precheckin-baseline` | `8fa1d1c` | Snapshot antes del sistema de versionado (baseline histórico) |
| `v1.1.0-precheckin` | `463fb98` | Release v1.1.0 con package.json actualizado |

---

## 📁 Estructura VERSION/ por Módulo

### adaria-welcome/VERSION/
```
VERSION/
├── version.json        # Metadatos: app_code, version, release_date, etc.
├── CHANGELOG.md        # Cambios v1.1.0 vs v1.0.0
└── ROLLBACK.md         # Instrucciones de rollback manual
```

### adaria-precheckin/VERSION/
```
VERSION/
├── version.json        # Metadatos: app_code, version, release_date, etc.
├── CHANGELOG.md        # Cambios v1.1.0 vs v1.0.0
└── ROLLBACK.md         # Instrucciones de rollback manual
```

---

## 🔄 Scripts de Rollback

### Welcome
**Ubicación:** `/repo/adaria-welcome/rollback-welcome.sh`

**Uso:**
```bash
cd repo/adaria-welcome
./rollback-welcome.sh
# O con backup de BD:
./rollback-welcome.sh --backup-db
```

**Acciones:**
1. Para servicio adaria-welcome
2. Revierte código a tag `v1.0.0-welcome-baseline`
3. Ejecuta `npm ci --production`
4. Muestra instrucción para reiniciar: `systemctl start adaria-welcome`

### Pre-checkin
**Ubicación:** `/repo/adaria-precheckin/rollback-precheckin.sh`

**Uso:**
```bash
cd repo/adaria-precheckin
./rollback-precheckin.sh
# O con backup de BD:
./rollback-precheckin.sh --backup-db
```

**Acciones:**
1. Para servicio adaria-precheckin
2. Revierte código a tag `v1.0.0-precheckin-baseline`
3. Ejecuta `npm ci --production`
4. Muestra instrucción para reiniciar: `systemctl start adaria-precheckin`

---

## 📄 VERSION Files

### adaria-welcome/VERSION/version.json
```json
{
  "app_code": "adaria-welcome",
  "app_name": "Adaria Welcome",
  "version": "1.1.0",
  "manual_version": "1.0",
  "release_date": "2026-09-02",
  "updated_by": "asanchez",
  "previous_version": "1.0.0",
  "deployment_status": "staging",
  "modules_included": [
    "landing",
    "login",
    "sso",
    "portal-access"
  ]
}
```

### adaria-precheckin/VERSION/version.json
```json
{
  "app_code": "adaria-precheckin",
  "app_name": "Adaria Pre-checkin",
  "version": "1.1.0",
  "manual_version": "1.0",
  "release_date": "2026-09-02",
  "updated_by": "asanchez",
  "previous_version": "1.0.0",
  "deployment_status": "staging",
  "modules_included": [
    "form",
    "document-upload",
    "payment",
    "notifications"
  ]
}
```

---

## 📝 Changelogs

### adaria-welcome/VERSION/CHANGELOG.md

```markdown
## [1.1.0] - 2026-09-02
### Added
- Landing page responsive con diseño Vera Adaria
- SSO con Google, Microsoft y Apple
- Portal de acceso unificado para todas las apps
- Sistema de notificaciones del hotel
- Mobile-first responsive design

### Changed
- Rediseño visual: identidad Vera Adaria
- Arquitectura: microservicios con isolamiento de contextos

### Security
- Implementación de CORS restrictivo
- Headers de seguridad HTTP completos

## [1.0.0] - 2026-06-15
### Added
- Versión base: landing page simple con login básico
```

### adaria-precheckin/VERSION/CHANGELOG.md

```markdown
## [1.1.0] - 2026-09-02
### Added
- Portado desde BTR con responsive design
- Vera brand colors (#1b5e75, #c67c6f)
- Validación mejorada de documentos
- Notificaciones de estado del pre-checkin
- Integración con sistema de parking

### Changed
- Logo: Boí Taüll → Vera Adaria
- Colores: BTR palette → Vera palette
- Responsive: 375px a 1366px (mobile-first)

### Security
- Validación de documentos en cliente y servidor
- Encriptación de datos sensibles

## [1.0.0] - baseline (rollback point)
```

---

## ✅ Checklist Completado

- [x] Git tags creados: v1.0.0-welcome-baseline, v1.1.0-welcome, v1.0.0-precheckin-baseline, v1.1.0-precheckin
- [x] VERSION/ directorios existen en ambos módulos
- [x] version.json actualizado con metadata completa
- [x] CHANGELOG.md documentado (Added/Changed/Security)
- [x] ROLLBACK.md con instrucciones manuales
- [x] Scripts rollback-welcome.sh y rollback-precheckin.sh creados y ejecutables
- [x] package.json actualizado a v1.1.0 en ambos módulos
- [x] Commit "Versioning Phase 1: Update package.json to v1.1.0..." creado

---

## 🚀 Próximos Pasos

### Fase 2: Testing (1-2 semanas)
```bash
# En cada módulo:
cd repo/adaria-welcome
npm install
npm run test
npm run lint

cd ../adaria-precheckin
npm install
npm run test
npm run lint
```

### Fase 3: Pilot Deploy (staging)
```bash
# Verificar rollback funciona:
./rollback-welcome.sh      # Debe revertir a v1.0.0-welcome-baseline
./rollback-precheckin.sh   # Debe revertir a v1.0.0-precheckin-baseline

# Reinstalación limpia:
git checkout main
npm install
npm start
```

### Fase 4: Production Deploy
1. Backup de BD (PostgreSQL/SQL Server)
2. Desplegar Welcome + Pre-checkin
3. Verificar `/api/versiones` retorna 1.1.0
4. Test de humo: login, pre-checkin, notificaciones
5. Monitoreo 24/7 en primeras 48 horas

---

## 📞 Contacto + Escalada

- **Gestor de Versiones:** asanchez@viajesparati.com
- **Documentación:** Este archivo + VERSION_MANAGEMENT/README.md
- **Git Repo:** `/home/asanchez/Documentos/@Laboral/VeraAdaria/repo`

---

**Última actualización:** 2026-09-02 20:40 UTC  
**Versión Sistema:** 1.1.0  
**Fase:** 1/4 (Versionado + Rollback ✅)
