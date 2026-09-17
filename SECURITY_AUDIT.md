# Auditoría de Seguridad — Vera Adaria Monorepo

## Fecha: 17 Septiembre 2026

### Estado: ✅ MITIGADO

**Incidente:** Credenciales expuestas en repositorio público GitHub

### Detalles del Incidente

1. **Tipo de Exposición:** Credenciales root de Proxmox (3802Ver@!) y contraseñas TP-Link (3802Vera!) presentes en:
   - README.md (línea 48)
   - Datos de inventario en seed.js y módulos IT

2. **Visibilidad:** Público en https://github.com/webtense/adariavera.git

3. **Severidad:** CRÍTICA

### Acciones Tomadas

#### Fase 1: Remediación Inicial (17/09/2026 10:55)
- ✅ Removidas credenciales del README.md
- ✅ Actualizado referencia a `.env.bak` (no comiteado)
- ✅ Commit de seguridad creado

#### Fase 2: Limpieza de Historial (17/09/2026 11:30)
- ✅ Instalado `git-filter-repo` v2.47.0
- ✅ Clonado repositorio fresh desde GitHub
- ✅ Ejecutado filtrado para eliminar `3802Ver@!` del historial completo
- ✅ Ejecutado filtrado para eliminar `3802Vera!` del historial completo
- ✅ Force push a main branch completado
- ✅ Repositorio local actualizado con historial limpio
- ✅ Garbage collection ejecutado (`git gc --prune=now`)

### Verificación

```bash
# Búsqueda de residuos de credenciales
git log -p --all | grep -E "(3802Ver|3802Vera)" 
# Resultado: LIMPIO ✅
```

### Próximos Pasos URGENTES

1. **⚠️ CRÍTICO: Rotación de Credenciales**
   - [ ] Cambiar contraseña root de Proxmox (192.168.1.10) inmediatamente
   - [ ] Cambiar contraseña cuenta TP-Link (asanchez/3802Vera!) en todas las cámaras
   - [ ] Auditar logs de acceso en Proxmox y cámaras por actividad sospechosa

2. **⚠️ Verificación de Acceso GitHub**
   - [ ] Rotar token GitHub si se sospecha compromiso
   - [ ] Revisar GitHub Security logs para acceso no autorizado
   - [ ] Habilitar autenticación de dos factores en todas las cuentas

3. **🔒 Medidas Preventivas**
   - [ ] Implementar Secret Scanner en CI/CD (pre-commit hooks)
   - [ ] Auditar todos los repositorios BTR/Personal por exposiciones similares
   - [ ] Crear `.env.example` con placeholders seguros (HECHO)
   - [ ] Documentar política de secretos en CONTRIBUTING.md

### Política de Secretos - NUEVA

**NUNCA commitar:**
- `.env`, `.env.local`, `.env.*.local`
- Contraseñas, claves API, tokens
- Credenciales SSH privadas
- Cualquier archivo que contenga `SECRET`, `PASSWORD`, `KEY`, `TOKEN`, `CREDENTIAL`

**SIEMPRE usar:**
- `.env.example` con placeholders (ya implementado)
- `process.env.VARIABLE_NAME` para acceso
- Git hooks pre-commit para validar (TODO)
- Secret scanning en CI/CD (TODO)

### Referencias

- **Repositorio:** https://github.com/webtense/adariavera.git
- **Rama:** main (force-pushed con historial limpio)
- **Commit de limpieza:** 13ad132
- **Herramienta:** git-filter-repo v2.47.0

---

**Estado de cierre:** 🟡 MITIGADO (verificación de rotación de credenciales pendiente)
