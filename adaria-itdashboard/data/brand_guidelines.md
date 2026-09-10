# 🏨 Hotel Adaria Vera - Guía de Estilos Completa

**Versión:** 1.0  
**Fecha:** 2026-06-11  
**Proyecto:** VeraAdaria  
**Dirección del Proyecto:** `/home/asanchez/Documentos/@Laboral/VeraAdaria`

---

## 📋 Tabla de Contenidos

1. [Visión y Propósito](#visión-y-propósito)
2. [Paleta de Colores](#paleta-de-colores)
3. [Tipografía](#tipografía)
4. [Espaciado y Medidas](#espaciado-y-medidas)
5. [Componentes Principales](#componentes-principales)
6. [Casos de Uso](#casos-de-uso)
7. [Guía de Responsive Design](#guía-de-responsive-design)
8. [Accesibilidad](#accesibilidad)

---

## 🎯 Visión y Propósito

**Hotel Adaria Vera** es un hotel beachfront ubicado en Vera (Almería, España). La identidad visual debe reflejar:

- **Calidez**: Bienvenida cálida y acogedora
- **Naturaleza marina**: Conexión con el entorno costero
- **Modernidad**: Diseño limpio y contemporáneo
- **Elegancia**: Sutileza sin ser excesivo
- **Accesibilidad**: Clara y fácil de navegar

---

## 🎨 Paleta de Colores

### Colores Neutrales
```
Blanco              #ffffff   — Fondo principal, claridad
Off-White           #f8f9fa   — Fondos suaves, alternancia
Light Gray          #e8e9eb   — Bordes, separadores
Gray                #a0a2a5   — Texto secundario
Dark Gray           #6b6e72   — Texto terciario
Charcoal            #333333   — Texto principal
Negro               #000000   — Máximo contraste
```

### Colores Primarios - Identidad Marina
```
Azul Marino Profundo #1b5e75  — CTAs principales, encabezados
Azul Océano Medio    #2d8aa3  — Hover states, acentos
Azul Océano Claro    #5ba8c7  — Enlaces, elementos secundarios
Azul Océano Pálido   #d4e9f3  — Fondos suaves, accesibilidad
```

### Colores Secundarios - Naturaleza y Calidez
```
Arena Dorada         #d4b8a3  — Elementos naturales
Terracota            #c67c6f  — Fachada hotel, acentos cálidos
Óxido/Marrón Cálido  #a65c52  — Hover states, énfasis
Verde Oceánico       #4a9b8e  — Naturaleza, sostenibilidad
Salvia               #7a9b8f  — Fondos alternativos
Verde Hoja           #6b8c7a  — Elementos naturales
```

### Colores de Acento
```
Coral Vivo           #ff6b5b  — Alertas, CTAs urgentes
Naranja Cálido       #ff8c4a  — Ofertas especiales
Oro Suave            #d4a574  — Premiumness
Amarillo Suave       #ffeaa7  — Acentos, destaque
```

### Colores Funcionales
```
Verde Éxito          #27ae60  — Confirmaciones, éxito
Naranja Alerta       #f39c12  — Advertencias
Rojo Error           #e74c3c  — Errores, atención
Azul Info            #3498db  — Información
```

### Combinaciones Recomendadas

| Contexto | Color Principal | Color Hover | Fondo |
|----------|-----------------|------------|-------|
| CTA Primaria | #1b5e75 | #2d8aa3 | #ffffff |
| Ofertas | #c67c6f | #a65c52 | #f8f9fa |
| Enlaces | #1b5e75 | #5ba8c7 | #ffffff |
| Success | #27ae60 | #1e8449 | #ffffff |
| Warning | #f39c12 | #d68910 | #fff8e7 |
| Error | #e74c3c | #c0392b | #fadbd8 |

---

## 🔤 Tipografía

### Familias de Fuentes

```css
Primaria:    'Helvetica Neue', Helvetica, Arial, sans-serif
Secundaria:  'Georgia', serif (para citas, especial)
Headings:    'Segoe UI', Tahoma, sans-serif
Monoespaciada: 'Courier New', monospace (código, datos)
```

### Escala Tipográfica

| Uso | Tamaño | Peso | Línea | Ejemplo |
|-----|--------|------|------|---------|
| H1 - Títulos principales | 60px (3.75rem) | Bold (700) | 1.2 | Bienvenido a Hotel Adaria |
| H2 - Secciones | 36px (2.25rem) | Bold (700) | 1.2 | Nuestras Habitaciones |
| H3 - Subsecciones | 30px (1.875rem) | Bold (700) | 1.2 | Suite Marina |
| H4 - Subheadings | 24px (1.5rem) | Bold (700) | 1.3 | Servicios Incluidos |
| H5 - Labels | 20px (1.25rem) | Semibold (600) | 1.4 | Especificaciones |
| H6 - Small titles | 18px (1.125rem) | Semibold (600) | 1.4 | Nota importante |
| Párrafos | 16px (1rem) | Normal (400) | 1.5 | Texto cuerpo estándar |
| Small/Secondary | 14px (0.875rem) | Normal (400) | 1.5 | Texto secundario |
| Extra Small | 12px (0.75rem) | Normal (400) | 1.4 | Metadata, labels |

### Pesos Disponibles

```
Light           300  — Raramente usado
Normal          400  — Texto cuerpo, párrafos
Medium          500  — Énfasis suave
Semibold        600  — Labels, destacados
Bold            700  — Encabezados principales
Extrabold       800  — Muy raramente usado
```

### Alturas de Línea

```
Tight      1.2   — Para títulos (máximo contraste)
Normal     1.5   — Para párrafos (legibilidad estándar)
Relaxed    1.75  — Para textos largos (mejor scanning)
Loose      2.0   — Para bloques de texto especial
```

### Recomendaciones de Párrafos

- **Longitud máxima:** 80 caracteres (ideal para lectura)
- **Espaciado inter-párrafo:** 16px (1 rem)
- **Espaciado inter-línea:** 1.5-1.75 para párrafos largos
- **Contraste mínimo WCAG AA:** 4.5:1 para texto normal, 3:1 para texto grande

---

## 📐 Espaciado y Medidas

### Escala de Espaciado (basada en 8px)

```
xs    4px   0.25rem    — Espacios muy pequeños
sm    8px   0.5rem     — Espacios pequeños
md    16px  1rem       — Espaciado estándar
lg    24px  1.5rem     — Espaciado generoso
xl    32px  2rem       — Espacios grandes
2xl   48px  3rem       — Espacios muy grandes
3xl   64px  4rem       — Espacios extragrandes
4xl   80px  5rem       — Espacios máximos
```

### Bordes y Radios

```
none    0px
sm      4px   — Bordes suaves para inputs
md      8px   — Bordes estándar para tarjetas
lg      12px  — Bordes más redondeados
xl      16px  — Bordes muy redondeados
2xl     24px  — Bordes extremadamente redondeados
full    9999px — Completamente redondo (círculos, pills)
```

### Estructura de Contenedor

```
Ancho máximo:  1400px
Padding lateral: 16px (mobile) → 32px (desktop)
Margen entre secciones: 64px-80px
Margen entre componentes: 24px-32px
```

### Tamaño de Imágenes Recomendado

```
Hero banner:        1400x600px (16:9 aspect ratio)
Card image:         400x300px (4:3 aspect ratio)
Thumbnail:          200x200px (1:1 aspect ratio)
Logo:               max-height: 60px
Avatar/Profile:     100x100px (1:1 aspect ratio)
```

---

## 🧩 Componentes Principales

### 1. Botones

#### Botón Primario (CTA Principal)
```
Fondo:      #1b5e75 (Azul Marino)
Texto:      #ffffff (Blanco)
Padding:    8px 24px (sm/md)
Borde:      2px solid #1b5e75
Radius:     12px
Fuente:     Semibold, 16px
Hover:      Bg: #2d8aa3, Shadow: lg, Transform: translateY(-2px)
Estado:     Active: box-shadow md, Transform: translateY(0)
```

**Uso:** Reservar, Acciones principales, CTAs urgentes

#### Botón Secundario
```
Fondo:      transparent
Texto:      #1b5e75
Borde:      2px solid #1b5e75
Padding:    8px 24px
Hover:      Bg: #d4e9f3, Color: #1b5e75
```

**Uso:** Acciones alternativas, enlaces destacados

#### Botón Acento (Ofertas)
```
Fondo:      #c67c6f (Terracota)
Texto:      #ffffff
Padding:    8px 24px
Hover:      Bg: #a65c52, Shadow: lg
```

**Uso:** Promociones, descuentos, ofertas especiales

#### Variantes
- **Small (.btn-sm):** 4px 16px
- **Large (.btn-lg):** 16px 32px, min-height: 50px
- **Block (.btn-block):** width: 100%

---

### 2. Tarjetas (Cards)

#### Estructura Base
```
Fondo:       #ffffff
Borde:       ninguno
Sombra:      0 4px 6px rgba(0,0,0,0.1)
Radius:      12px
Padding:     24px
Hover:       Sombra: xl, Transform: translateY(-4px)
Transición:  300ms cubic-bezier(0.4, 0, 0.2, 1)
```

#### Secciones Internas
```
.card-header
  Padding:        24px
  Borde inferior: 1px solid #e8e9eb
  Bg:             #f8f9fa

.card-body
  Padding:        24px

.card-footer
  Padding:        24px
  Borde superior: 1px solid #e8e9eb
  Bg:             #f8f9fa
```

#### Tarjeta de Servicio
```
Padding:    32px
Alineación: Centro
Icono:      48px, Color: #1b5e75, Margin-bottom: 24px
Título:     Color: #1b5e75, H3
Descripción: Color: #6b6e72, 14px
```

#### Tarjeta de Testimonio
```
Padding:         24px
Borde-izquierda: 4px solid #c67c6f
Bg:              #f8f9fa
Rating:          Color: #ff8c4a (⭐ estrellas)
Texto:           Itálica, 14px, altura-línea: 1.75
Autor:           Semibold, Color: #1b5e75
```

---

### 3. Formularios

#### Campos de Entrada
```
Padding:        8px 16px
Fuente:         16px, Helvetica
Borde:          1px solid #e8e9eb
Radius:         8px
Bg:             #ffffff
Transición:     300ms all
Focus:
  Borde:        #1b5e75
  Box-shadow:   0 0 0 3px rgba(27, 94, 117, 0.1)
  Outline:      none
```

#### Labels
```
Display:        block
Margin-bottom:  8px
Fuente:         Semibold, 14px
Color:          #333333
```

#### Checkboxes y Radios
```
Margin-right:   8px
Cursor:         pointer
Label styling:  Display flex, align-items center
```

#### Textarea
```
Width:          100%
Min-height:     120px
Resize:         vertical
Padding:        8px 16px
```

---

### 4. Header y Navegación

#### Header
```
Bg:             #ffffff
Sombra:         sm (0 1px 2px rgba(0,0,0,0.05))
Posición:       sticky
Top:            0
Z-index:        1020
Padding:        16px 24px
```

#### Navegación
```
Display:        flex
Gap:            32px
Fuente:         Medium, 16px
Color:          #333333
```

#### Links de Navegación
```
Color:          #333333
Transición:     300ms color
Decoración:     underline effect con ::after (width: 0)
Hover:
  Color:        #1b5e75
  ::after:      width: 100%
```

#### Logo
```
Max-height:     60px
Width:          auto
```

---

### 5. Hero Section

#### Estructura
```
Posición:       relative
Bg:             linear-gradient(135deg, #1b5e75, #2d8aa3)
Color:          #ffffff
Padding:        80px 24px
Text-align:     center
Overflow:       hidden
```

#### Patrón de Fondo
```
SVG wave pattern con opacity: 0.5
Posición:       absolute, top: 0
Z-index:        0 (debajo del contenido)
```

#### Contenido
```
Position:       relative
Z-index:        1
Max-width:      800px
Margin:         0 auto
```

#### Títulos
```
Color:          #ffffff
Font-size:      H1 (48px-60px)
Margin-bottom:  24px
Letter-spacing: -0.02em
```

#### Párrafos
```
Font-size:      18px-20px
Margin-bottom:  32px
Line-height:    1.75
```

---

### 6. Secciones

#### Estructura General
```
Padding:        64px 24px
Max-width:      1400px
Margin:         0 auto
```

#### Sección Alternada
```
Background-color: #f8f9fa
```

#### Título de Sección
```
Text-align:     center
Color:          #1b5e75
Font-size:      H2 (36px)
Margin-bottom:  48px
```

#### Subtitle
```
Text-align:     center
Color:          #a0a2a5
Font-size:      18px
Margin-top:     16px
```

---

### 7. Footer

#### Estructura
```
Bg:             #333333
Color:          #e8e9eb
Padding:        64px 24px 24px
Margin-top:     64px
```

#### Contenido
```
Display:        grid
Grid-columns:   repeat(auto-fit, minmax(250px, 1fr))
Gap:            48px
Max-width:      1400px
Margin:         0 auto
```

#### Secciones
```
.footer-section h4
  Color:        #ffffff
  Margin-bottom: 16px

.footer-list
  List-style:   none

.footer-list li
  Margin-bottom: 8px
```

#### Links
```
Color:          #e8e9eb
Hover:          Color: #5ba8c7
Transición:     300ms color
```

#### Bottom
```
Border-top:     1px solid #6b6e72
Padding-top:    32px
Text-align:     center
Font-size:      12px
Color:          #a0a2a5
```

#### Social Links
```
Display:        flex
Gap:            16px
Margin-top:     16px

.social-links a
  Display:      inline-flex
  Width:        40px
  Height:       40px
  Align-items:  center
  Justify-content: center
  Bg:           #6b6e72
  Border-radius: 9999px
  Hover:        Bg: #1b5e75, Transform: translateY(-2px)
```

---

## 🎯 Casos de Uso

### Página de Inicio
```
- Hero con carrusel de imágenes
- Sección de "Bienvenida" con descripción
- Grid de servicios (3 columnas)
- Testimonios (carrusel o grid)
- Banner de ofertas
- CTA a reserva
- Newsletter signup
```

### Página de Habitaciones
```
- Filtros (tipo, precio, servicios)
- Grid de tarjetas (3-4 columnas)
- Cada tarjeta con:
  - Imagen
  - Nombre habitación
  - Descripción
  - Características (iconos)
  - Precio
  - Botón "Ver disponibilidad"
```

### Formulario de Reserva
```
- Campos organizados: fechas, adultos/niños/bebés
- Inputs con clear labeling
- Dropdowns para selecciones
- Checkboxes para servicios adicionales
- CTA primaria para reservar
- Enlace secundario para políticas
```

### Página de Contacto
```
- Información de contacto (teléfono, email)
- Formulario de contacto
- Mapa de ubicación
- Horarios
- Información de acceso
```

---

## 📱 Guía de Responsive Design

### Breakpoints

```
Mobile:    < 768px
Tablet:    768px - 1024px
Desktop:   1024px - 1400px
Large:     > 1400px
```

### Comportamientos Responsivos

#### Mobile (< 768px)
- Navegación hamburguesa o apilada
- Tipografía: H1 48px, H2 24px
- Grid 1 columna
- Padding: 16px
- Botones: width: 100%
- Imágenes: max-width: 100%

#### Tablet (768px - 1024px)
- Navegación horizontal si cabe
- Tipografía: H1 48px, H2 30px
- Grid 2 columnas
- Padding: 24px
- Botones: inline-block

#### Desktop (1024px+)
- Navegación completa horizontal
- Tipografía: H1 60px, H2 36px
- Grid 3-4 columnas según componente
- Padding: 32px
- Máximo ancho: 1400px

### Media Queries Implementadas

```css
@media (min-width: 768px) { }  /* Tablets */
@media (min-width: 1024px) { } /* Desktop */
@media (min-width: 1400px) { } /* Large screens */
@media (prefers-reduced-motion: reduce) { } /* Accesibilidad */
@media print { } /* Impresión */
```

---

## ♿ Accesibilidad

### Principios WCAG 2.1 AA

#### Contraste
- Texto normal: mínimo 4.5:1
- Texto grande (>18px): mínimo 3:1
- Componentes: mínimo 3:1

#### Navegación por Teclado
```css
:focus-visible {
  outline: 2px solid #1b5e75;
  outline-offset: 2px;
}
```

#### Reducción de Movimiento
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

#### Semántica HTML
- Usar `<header>`, `<nav>`, `<main>`, `<footer>`
- Jerarquía de headings correcta (H1, H2, H3...)
- Labels asociados a inputs
- Alt text en imágenes

#### Colores
- No usar color como único indicador
- Suficiente contraste entre fondo y texto
- Verificar con herramientas de daltonismo

---

## 🔧 Utilidades CSS

### Espaciado Rápido
```css
.mt-sm, .mt-md, .mt-lg, .mt-xl, .mt-2xl  /* margin-top */
.mb-sm, .mb-md, .mb-lg, .mb-xl, .mb-2xl  /* margin-bottom */
.px-sm, .px-md, .px-lg                    /* padding horizontal */
.py-sm, .py-md, .py-lg                    /* padding vertical */
```

### Texto
```css
.text-center, .text-left, .text-right
.text-white, .text-dark, .text-muted
.text-primary, .text-success, .text-warning, .text-error
.font-light, .font-normal, .font-semibold, .font-bold
.text-xs, .text-sm, .text-base, .text-lg, .text-xl
```

### Visibilidad
```css
.hidden     /* display: none */
.visible    /* display: block */
```

---

## 🎬 Animaciones

### Transiciones Estándar
```
Fast:    150ms
Base:    300ms (por defecto)
Slow:    500ms
Timing:  cubic-bezier(0.4, 0, 0.2, 1)
```

### Efectos Disponibles

#### Fade In
```css
.fade-in {
  animation: fadeIn 500ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

#### Hover Buttons
```css
.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 20px 25px rgba(0, 0, 0, 0.1);
}
```

---

## 📊 Guía de Sombras

```
sm:    0 1px 2px rgba(0, 0, 0, 0.05)         /* Sutil */
md:    0 4px 6px rgba(0, 0, 0, 0.1)          /* Estándar */
lg:    0 10px 15px rgba(0, 0, 0, 0.1)        /* Prominente */
xl:    0 20px 25px rgba(0, 0, 0, 0.1)        /* Hover */
2xl:   0 25px 50px rgba(0, 0, 0, 0.15)       /* Máximo */
```

---

## 📝 Notas Finales

- **Mantener coherencia:** Seguir esta guía en todos los proyectos de VeraAdaria
- **Flexibilidad:** Las directrices permiten creatividad dentro de los límites
- **Accesibilidad primero:** Siempre verificar contraste y navegación
- **Mobile-first:** Diseñar para mobile, luego escalar
- **Testear:** Verificar en navegadores reales y dispositivos

---

**Última actualización:** 2026-06-11  
**Responsable:** Andrés Sánchez  
**Contacto:** asanchez@viajesparati.com
