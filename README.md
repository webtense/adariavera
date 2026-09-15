# Vera Adaria — Infraestructura IT y Portales

Monorepo con todos los componentes del proyecto Vera Adaria: infraestructura IT (Proxmox, Frigate NVR, Tailscale), portales y dashboards.

## Estructura del Proyecto

```
webtense/adariavera/
├── adaria-personal/          Next.js principal (Vera dashboard, estadísticas)
├── adaria-gestion/           Portal de gestión para staff
├── adaria-welcome/           Check-in (integración ACI/Dali)
├── adaria-precheckin/        Pre-check-in online
├── adaria-parking/           Gestión de parking + cargadores EV
├── adaria-itdashboard/       Dashboard de infraestructura IT
├── adaria-guest/             Portal PWA para huéspedes
├── adaria-holding/           Configuración de grupo hotelero
├── adaria-ine/               Generador de informes INE
├── adaria-manuales/          Sistema de manuales en Markdown
├── adaria-mrz/               Reconocimiento OCR MRZ en DNI
├── adaria-estadisticas/      Módulo de estadísticas agregadas
├── vera-frigate/             Vigilancia video con Frigate NVR
├── vera-monitoring/          Monitorización de infraestructura
└── README.md
```

## Instalación y Desarrollo

### Requisitos
- Node.js 18+
- npm/yarn
- Acceso a servidores Vera Adaria (Proxmox 192.168.1.10)

### Setup Local

Cada módulo tiene su propio `package.json`. Para desarrollar:

```bash
cd adaria-personal
npm install
npm run dev
```

## Credenciales y Configuración

Las credenciales se encuentran en archivos `.env` locales (no comiteados).

Servidores principales:
- **Proxmox**: 192.168.1.10:8006 (root/***REMOVED***)
- **Frigate NVR**: CT/VM pendiente de crear
- **Tailscale**: Pendiente instalación en host Proxmox

## Componentes Principales

### Portales
- **Personal**: Dashboard central de Vera Adaria
- **Gestion**: Interfaz de gestión para staff
- **Welcome**: Check-in automático con integración PMS
- **Precheckin**: Pre-check-in online D-7
- **Guest**: Portal PWA con QR por habitación
- **Parking**: Gestión visual de parking + cargadores EV

### Infraestructura
- **Proxmox**: Host virtualización (KVM/LXC)
- **Frigate**: NVR para grabación de cámaras RTSP
- **Tailscale**: VPN de confianza cero
- **Monitoring**: Alertas y dashboards de uptime

### Integraciones
- **ACI/Dali**: Sistema PMS de reservas (SQL Server)
- **MRZ**: Escáner automático de documentos de identidad

## Versioning

Cada módulo mantiene su propia versión en `package.json`. El sistema de versiones sigue Semantic Versioning.

## Historial de Implementación

- **Fases 6-10** (Sept 2026): Turnos, Cuadrantes, Auditoría, Incidencias
- **Fase 5**: RedisStore SSO compartido
- **Fase 4**: Endpoints de quiosco
- **Fases 1-3**: Estructura base portales + integraciones

Ver `PRECHECKIN_SISTEMA_ENVIO_ANALISIS_20260914.md` y `SSO_REDIS_SCAFFOLD_20260914.md` para detalles técnicos.

## Licencia

Propiedad de Vera Adaria (2026)

## Contacto

Soporte IT: adariait@boitaullresort.com
