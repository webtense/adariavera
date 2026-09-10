"""
Lectura del bloque de DOMICILIO del reverso del DNI español.

Esto es distinto de la MRZ y conviene tenerlo claro: **este texto no lleva
dígitos de control**. La MRZ se autovalida y por eso su lectura puede darse por
buena; aquí no hay nada que comprobar, así que el resultado es SIEMPRE una
sugerencia que alguien tiene que revisar. Va en un módulo aparte para que esa
diferencia quede explícita en la arquitectura y no se mezcle con `mrz_reader`.

Estructura del reverso de un DNI español (formato tarjeta):

    DOMICILIO
    C. ALFONSO VIII 00010        ← vía y número
    BAÑOS DE LA ENCINA           ← municipio
    JAÉN                         ← provincia
    LUGAR DE NACIMIENTO
    LAS PALMAS DE GRAN CANARIA
    LAS PALMAS
    HIJO/A DE
    JOSE SERGIO / MARIA DEL PILAR
    [banda MRZ]

Las etiquetas pueden venir en bilingüe según la comunidad donde se expidió
(DOMICILIO/DOMICILI, LUGAR DE NACIMIENTO/LLOC DE NAIXEMENT…), así que se buscan
por raíz y no por texto exacto.

Lo que el DNI español NO trae: el **código postal**. No está impreso en ninguna
de las dos caras. Se deduce del municipio contra el histórico de ACI, o se teclea.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, asdict

import cv2
import numpy as np

from mrz_reader import _a_gris, _ocr

# Raíces de las etiquetas impresas, tolerando las variantes bilingües
# (castellano, catalán, euskera, gallego, valenciano).
ETIQUETA_DOMICILIO = ("DOMICIL", "HELBIDE", "ADRESSE")
ETIQUETA_FIN = ("NACIMIENT", "NAIXEMENT", "NACEMENT", "JAIOTZ", "NAISSANCE",
                "HIJO", "HIJA", "FILL", "FILLO", "SEME", "ALABA",
                "EQUIPO", "EQUIP", "IDESP")

# Palabras que delatan que la línea es una etiqueta y no un dato.
SON_ETIQUETA = ETIQUETA_DOMICILIO + ETIQUETA_FIN + (
    "APELLIDO", "COGNOM", "NOMBRE", "SEXO", "NACIONALIDAD", "VALIDEZ",
    "SOPORTE", "DOCUMENTO NACIONAL", "IDENTIDAD", "PROVINCIA", "PAIS",
    "LUGAR", "LLOC", "DNI", "ESPANA", "REINO",
)


@dataclass
class Domicilio:
    domicilio: str | None      # vía y número
    poblacion: str | None      # municipio
    provincia: str | None
    lineas: int                # cuántas líneas se aprovecharon
    # Nunca es True: este texto no tiene forma de verificarse. Se deja explícito
    # para que ningún consumidor lo confunda con un dato validado como la MRZ.
    verificado: bool = False

    def a_dict(self) -> dict:
        return asdict(self)


def _sin_tildes(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t)
                   if unicodedata.category(c) != "Mn")


def _es_etiqueta(linea: str) -> bool:
    u = _sin_tildes(linea).upper()
    return any(e in u for e in SON_ETIQUETA)


def _limpiar(linea: str) -> str:
    """Normaliza una línea de dato sin alterar su contenido."""
    t = re.sub(r"\s+", " ", linea).strip(" .,:;|/\\-_")
    # El OCR mete a veces caracteres de adorno del fondo de seguridad.
    t = re.sub(r"[^\w\sÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑÇºª.,/'-]", "", t, flags=re.UNICODE)
    return re.sub(r"\s+", " ", t).strip()


def _variantes_texto(gris: np.ndarray):
    """
    Preprocesados para texto impreso normal (no OCR-B).

    El reverso del DNI tiene un fondo de seguridad con guilloches y microtexto
    que compite con las letras: el contraste local (CLAHE) es lo que más ayuda,
    bastante más que un umbral global.
    """
    alto = gris.shape[0]
    factor = max(1.0, 1500.0 / max(1, gris.shape[1]))
    if factor > 1.0:
        gris = cv2.resize(gris, None, fx=factor, fy=factor,
                          interpolation=cv2.INTER_CUBIC)

    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gris)
    yield "clahe", clahe
    yield "clahe+otsu", cv2.threshold(clahe, 0, 255,
                                      cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    yield "adaptativa", cv2.adaptiveThreshold(
        clahe, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 35, 15)
    yield "gris", gris


def _extraer(texto: str) -> Domicilio | None:
    """
    Localiza el bloque que sigue a la etiqueta DOMICILIO.

    Se corta en la siguiente etiqueta conocida (lugar de nacimiento, filiación…)
    para no arrastrar datos que no son la dirección.
    """
    lineas = [_limpiar(l) for l in texto.splitlines()]
    lineas = [l for l in lineas if len(l) >= 3]

    inicio = None
    for i, l in enumerate(lineas):
        u = _sin_tildes(l).upper()
        if any(e in u for e in ETIQUETA_DOMICILIO):
            inicio = i + 1
            break
    if inicio is None:
        return None

    bloque = []
    for l in lineas[inicio:]:
        u = _sin_tildes(l).upper()
        if any(e in u for e in ETIQUETA_FIN):
            break
        if _es_etiqueta(l):
            continue
        # La banda MRZ empieza a aparecer: se corta.
        if l.count("<") >= 2 or re.match(r"^ID[A-Z]{3}", u):
            break
        bloque.append(l)
        if len(bloque) >= 3:
            break

    if not bloque:
        return None
    return Domicilio(
        domicilio=bloque[0] if len(bloque) >= 1 else None,
        poblacion=bloque[1] if len(bloque) >= 2 else None,
        provincia=bloque[2] if len(bloque) >= 3 else None,
        lineas=len(bloque),
    )


def leer_domicilio(imagen_bytes: bytes) -> Domicilio | None:
    """
    Intenta leer el domicilio del reverso de un DNI español.

    Devuelve None si no encuentra el bloque, que es un resultado perfectamente
    normal: puede ser un pasaporte, la cara equivocada, o el fondo de seguridad
    tapando el texto. Nunca inventa: si no lo ve, no lo devuelve.
    """
    arreglo = np.frombuffer(imagen_bytes, dtype=np.uint8)
    imagen = cv2.imdecode(arreglo, cv2.IMREAD_COLOR)
    if imagen is None:
        return None

    gris = _a_gris(imagen)
    # El domicilio va en la parte de ARRIBA del reverso; la MRZ ocupa el pie.
    # (Se probó anclar el recorte a la banda MRZ para descontar los márgenes de
    #  la foto: empeoró el resultado, así que se mantiene el recorte proporcional.)
    alto = gris.shape[0]
    arriba = gris[: int(alto * 0.72), :]

    mejor = None
    for _, preparada in _variantes_texto(arriba):
        # `spa+cat` porque las etiquetas vienen en bilingüe según la comunidad.
        texto = _ocr(preparada, psm="4", idioma="spa+cat")
        encontrado = _extraer(texto)
        if encontrado is None:
            continue
        # Se prefiere la lectura que rellene más líneas: con las tres, la
        # dirección queda completa (vía, municipio y provincia).
        if mejor is None or encontrado.lineas > mejor.lineas:
            mejor = encontrado
        if mejor.lineas >= 3:
            break
    return mejor
