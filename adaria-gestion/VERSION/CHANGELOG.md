# Changelog — Adaria Gestión (portal)

Todas las versiones notables de esta app se documentan en este archivo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [1.1.0] - 2026-08-26
### Added
- Sistema de versión unificado FASE 1: `VERSION/version.json` + `CHANGELOG.md` propios de la app.
- Compatibilidad con el endpoint `/api/versiones` de adaria-gestion, que agrega la versión y el changelog de todas las apps del ecosistema Adaria para mostrarlos en la card "Changelog" del portal.
- **FASE 4 — Escáner DNI/MRZ, MODO PRUEBA (sin escritura en ACI).** Módulo nuevo, clonado de
  `btr_mrz` + `btr-gestion-portal/documentos.js` (BTR, en producción desde el 06/08/2026), desplegado
  con todos los interruptores de escritura apagados:
  - Microservicio `adaria-mrz` (CT .81, `127.0.0.1:3103`, solo localhost) — lectura de MRZ local,
    sin salida a internet, sin guardar la imagen en disco.
  - `documentos.js` + `lib/aci-write.js` portados a `adaria-gestion` con `DOC_DRY_RUN=true` fijo y
    `DOC_HOTELES_ESCRITURA` vacío: cualquier intento de guardar se rechaza (doble salvaguarda, ver
    `VeraAdaria_memory/sql_aci_doc_rw_bloqueador.md`).
  - Card "Escáner DNI" → "Disponible (modo prueba)", visible solo para `asanchez`, `olga` y `francesc`.
  - `deshacer_escritura_aci.js` preparado en el servidor, sin usar (no hay nada que deshacer: no se
    escribe nada).
  - Manual `escaner-dni.html` reescrito con las limitaciones reales del piloto (resolución mínima,
    pasaporte sin validar con muestras reales, modo prueba, reversión manual).

### Notes
- Arranque de versión unificado en 1.1.0 para las 11 apps del ecosistema Adaria (gestion, welcome, precheckin, personal, parking, ine, guest, estadisticas, escaner, manuales, it).
- El Escáner DNI en modo prueba usa la misma versión de app (1.1.0): no es un release aparte.
