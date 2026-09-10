"""
Localización y lectura OCR de la banda MRZ de un documento.

Dos decisiones de diseño que conviene no deshacer:

1. **Nada toca el disco.** Se usa el binario `tesseract` por tubería
   (stdin→stdout) en lugar de `pytesseract`, que escribe ficheros temporales.
   La imagen de un DNI vive en memoria y muere ahí.

2. **Se prueban varios preprocesados y gana el que valide los checksums.**
   Como el parser sabe cuándo ha acertado (dígitos de control OACI), no hay que
   adivinar qué binarización va mejor con esta luz: se intentan varias y se
   acepta la primera que cuadre. Sube mucho la tasa de acierto sin rebajar la
   precisión, porque el criterio de aceptación sigue siendo el estándar.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import cv2
import numpy as np

from mrz_parser import Documento, ErrorMRZ, parsear

# Solo los caracteres que una MRZ puede contener. Reduce drásticamente los
# errores de OCR frente a un reconocimiento de texto libre.
ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
def _config_tesseract(psm="6", idioma=None):
    if idioma:
        # Texto impreso normal: hace falta el idioma y SÍ interesa el diccionario
        # (ayuda con nombres de calle y de municipio), y no se limita el alfabeto.
        return ["--oem", "1", "--psm", psm, "-l", idioma]
    return [
        "--oem", "1",            # LSTM
        "--psm", psm,            # 6 = bloque uniforme · 7 = una sola línea
        "-c", f"tessedit_char_whitelist={ALFABETO}",
        "-c", "load_system_dawg=0",   # sin diccionario: la MRZ no son palabras
        "-c", "load_freq_dawg=0",
    ]
ANCHO_TRABAJO = 1400          # px; suficiente para OCR-B sin coste excesivo
TIMEOUT_OCR = 12              # segundos por invocación


class TesseractNoDisponible(RuntimeError):
    pass


@dataclass
class Lectura:
    documento: Documento
    intento: str              # qué variante de preproceso acertó
    intentos: int
    ms: int


def _binario_tesseract() -> str:
    ruta = shutil.which("tesseract")
    if not ruta:
        raise TesseractNoDisponible(
            "no se encuentra el binario 'tesseract' en el PATH "
            "(instalar con: apt-get install -y tesseract-ocr)")
    return ruta


# Tesseract está compilado con OpenMP y por defecto reparte cada reconocimiento
# entre TODOS los núcleos. Lanzar dos instancias a la vez en un contenedor de 4
# hace que se peleen y el tiempo se dispara: en la medición pasó de 200 ms a
# agotar el timeout de 12 s. Con un hilo por proceso el paralelismo real lo da
# lanzar varios procesos, que es lo que hacemos.
ENTORNO_OCR = {"OMP_THREAD_LIMIT": "1", "OMP_NUM_THREADS": "1",
               "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
               "LC_ALL": "C"}


def _ocr(imagen: np.ndarray, psm: str = "6", idioma: str | None = None) -> str:
    """Pasa una imagen por tesseract sin escribir nada en disco."""
    ok, buffer = cv2.imencode(".png", imagen)
    if not ok:
        return ""
    try:
        proceso = subprocess.run(
            [_binario_tesseract(), "stdin", "stdout",
             *_config_tesseract(psm, idioma)],
            input=buffer.tobytes(), capture_output=True, timeout=TIMEOUT_OCR,
            env=ENTORNO_OCR)
    except subprocess.TimeoutExpired:
        return ""
    return proceso.stdout.decode("utf-8", errors="ignore")


# ─── Preproceso ──────────────────────────────────────────────────────────────
def _a_gris(imagen: np.ndarray) -> np.ndarray:
    if imagen.ndim == 3:
        return cv2.cvtColor(imagen, cv2.COLOR_BGR2GRAY)
    return imagen


def _escalar(imagen: np.ndarray, ancho: int = ANCHO_TRABAJO) -> np.ndarray:
    h, w = imagen.shape[:2]
    if w == ancho:
        return imagen
    escala = ancho / float(w)
    interp = cv2.INTER_AREA if escala < 1 else cv2.INTER_CUBIC
    return cv2.resize(imagen, (ancho, max(1, int(h * escala))), interpolation=interp)


def _localizar_banda(gris: np.ndarray) -> np.ndarray | None:
    """
    Aísla la banda MRZ por morfología.

    La MRZ es un bloque de texto muy apaisado, denso y de altura constante: un
    blackhat con kernel ancho la resalta mucho mejor que cualquier detector
    genérico de texto, y no necesita modelo ni entrenamiento.
    """
    h, w = gris.shape[:2]
    suave = cv2.GaussianBlur(gris, (3, 3), 0)

    kernel_rect = cv2.getStructuringElement(cv2.MORPH_RECT, (max(13, w // 60), 5))
    blackhat = cv2.morphologyEx(suave, cv2.MORPH_BLACKHAT, kernel_rect)

    grad = cv2.Sobel(blackhat, cv2.CV_32F, 1, 0, ksize=-1)
    grad = np.absolute(grad)
    minimo, maximo = float(grad.min()), float(grad.max())
    if maximo - minimo < 1e-6:
        return None
    grad = ((grad - minimo) / (maximo - minimo) * 255).astype("uint8")

    grad = cv2.morphologyEx(grad, cv2.MORPH_CLOSE, kernel_rect)
    _, umbral = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    # Cierra los huecos entre las líneas de la MRZ para que salga un solo bloque.
    umbral = cv2.morphologyEx(
        umbral, cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (max(21, w // 40), 21)))
    umbral = cv2.erode(umbral, None, iterations=2)

    contornos, _ = cv2.findContours(umbral, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidatos = []
    for c in contornos:
        x, y, cw, ch = cv2.boundingRect(c)
        if ch < 8 or cw < w * 0.55:
            continue
        proporcion = cw / float(ch)
        # TD3 ronda 8:1 y TD1 unas 4:1. Se acepta un rango amplio.
        if not (3.0 <= proporcion <= 18.0):
            continue
        candidatos.append((y, x, cw, ch))

    if not candidatos:
        return None
    # La MRZ está siempre en la parte baja del documento: el candidato más bajo.
    y, x, cw, ch = max(candidatos, key=lambda t: t[0])
    margen_y, margen_x = int(ch * 0.35), int(cw * 0.02)
    y0, y1 = max(0, y - margen_y), min(h, y + ch + margen_y)
    x0, x1 = max(0, x - margen_x), min(w, x + cw + margen_x)
    return gris[y0:y1, x0:x1]


def _endereza(recorte: np.ndarray) -> np.ndarray:
    """Corrige una inclinación leve, típica de una foto hecha a mano."""
    _, binaria = cv2.threshold(recorte, 0, 255,
                               cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    coords = cv2.findNonZero(binaria)
    if coords is None or len(coords) < 50:
        return recorte
    angulo = cv2.minAreaRect(coords)[-1]
    if angulo > 45:
        angulo -= 90
    if abs(angulo) < 0.5 or abs(angulo) > 15:
        return recorte          # nada que corregir, o giro absurdo
    h, w = recorte.shape[:2]
    matriz = cv2.getRotationMatrix2D((w // 2, h // 2), angulo, 1.0)
    return cv2.warpAffine(recorte, matriz, (w, h),
                          flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _segmentar_lineas(banda: np.ndarray):
    """
    Separa la banda en sus líneas por proyección horizontal de tinta.

    Los valles entre líneas son inequívocos en una MRZ, y aislar cada línea
    permite pasarla por tesseract en modo "una sola línea" (psm 7), que es
    bastante más preciso que tratar el bloque entero: con el bloque se pierden
    caracteres de relleno, y perder un solo carácter desplaza todas las
    posiciones siguientes y hunde los dígitos de control.
    """
    _, binaria = cv2.threshold(banda, 0, 255,
                               cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    perfil = binaria.sum(axis=1) / 255.0
    if perfil.max() < 3:
        return []
    umbral = max(2.0, perfil.max() * 0.12)
    con_tinta = perfil > umbral

    grupos, inicio = [], None
    alto_min = max(5, banda.shape[0] // 12)
    for i, hay in enumerate(con_tinta):
        if hay and inicio is None:
            inicio = i
        elif not hay and inicio is not None:
            if i - inicio >= alto_min:
                grupos.append((inicio, i))
            inicio = None
    if inicio is not None and len(con_tinta) - inicio >= alto_min:
        grupos.append((inicio, len(con_tinta)))
    return grupos


def _ocr_por_lineas(banda: np.ndarray) -> str:
    """OCR de la banda línea a línea, cada una con psm 7 (una sola línea)."""
    grupos = _segmentar_lineas(banda)
    if not (2 <= len(grupos) <= 4):
        return ""
    salida = []
    for y0, y1 in grupos:
        margen = max(3, (y1 - y0) // 5)
        franja = banda[max(0, y0 - margen):min(banda.shape[0], y1 + margen), :]
        if franja.size == 0:
            continue
        # Un carácter de unos 42 px de alto es la zona cómoda de tesseract.
        factor = max(1.0, 42.0 / max(1, franja.shape[0]))
        if factor > 1.0:
            franja = cv2.resize(franja, None, fx=factor, fy=factor,
                                interpolation=cv2.INTER_CUBIC)
        franja = cv2.threshold(franja, 0, 255,
                               cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
        # Un poco de borde blanco: tesseract acierta más si el texto no toca el canto.
        franja = cv2.copyMakeBorder(franja, 12, 12, 20, 20,
                                    cv2.BORDER_CONSTANT, value=255)
        texto = _ocr(franja, psm="7").strip()
        if texto:
            salida.append(texto)
    return "\n".join(salida)


def _recortar_a_tinta(linea: np.ndarray) -> np.ndarray:
    """Ajusta la línea a la extensión horizontal real de sus caracteres."""
    _, binaria = cv2.threshold(linea, 0, 255,
                              cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    columnas = binaria.sum(axis=0)
    con_tinta = np.flatnonzero(columnas > 0)
    if con_tinta.size == 0:
        return linea
    return linea[:, con_tinta[0]:con_tinta[-1] + 1]


def _separar_celdas(linea: np.ndarray, n: int) -> np.ndarray:
    """
    Recompone una línea de MRZ separando sus `n` celdas monoespaciadas.

    Es la clave para que el OCR no se coma caracteres. La MRZ es de paso fijo,
    así que la posición de cada carácter es geometría, no reconocimiento: se
    divide el ancho en `n` celdas iguales y se vuelven a montar con un hueco
    blanco entre ellas. Así tesseract no puede fusionar dos '<' contiguos ni
    perder el dígito pegado a un bloque de relleno — que es exactamente lo que
    hacía fallar los dígitos de control de los pasaportes.
    """
    linea = _recortar_a_tinta(linea)
    h, w = linea.shape[:2]
    if w < n * 3:
        return linea
    ancho_celda = w / float(n)
    hueco = max(6, int(ancho_celda * 0.55))
    celdas = []
    for i in range(n):
        x0 = int(round(i * ancho_celda))
        x1 = int(round((i + 1) * ancho_celda))
        celda = linea[:, x0:max(x1, x0 + 1)]
        celdas.append(celda)
        if i < n - 1:
            celdas.append(np.full((h, hueco), 255, dtype=linea.dtype))
    return np.hstack(celdas)


def _ocr_rejilla(banda: np.ndarray) -> str:
    """
    OCR de la banda aprovechando que la MRZ es monoespaciada.

    Prueba los anchos de línea del estándar (44 en TD3, 36 en TD2, 30 en TD1) y
    devuelve el primero que produzca líneas de la longitud correcta.
    """
    grupos = _segmentar_lineas(banda)
    if not (2 <= len(grupos) <= 4):
        return ""
    # Según cuántas líneas tenga la banda ya se sabe qué formato puede ser.
    candidatos = [30] if len(grupos) >= 3 else [44, 36]

    for n in candidatos:
        lineas = []
        for y0, y1 in grupos:
            margen = max(2, (y1 - y0) // 6)
            franja = banda[max(0, y0 - margen):min(banda.shape[0], y1 + margen), :]
            if franja.size == 0:
                continue
            franja = cv2.threshold(franja, 0, 255,
                                   cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
            separada = _separar_celdas(franja, n)
            factor = max(1.0, 40.0 / max(1, separada.shape[0]))
            if factor > 1.0:
                separada = cv2.resize(separada, None, fx=factor, fy=factor,
                                      interpolation=cv2.INTER_CUBIC)
            separada = cv2.copyMakeBorder(separada, 14, 14, 22, 22,
                                          cv2.BORDER_CONSTANT, value=255)
            texto = _ocr(separada, psm="7")
            # El OCR mete espacios entre celdas: se quitan, la MRZ no los tiene.
            lineas.append(texto.replace(" ", "").strip())
        if not lineas:
            continue
        # Solo se acepta si las longitudes salen como manda el estándar.
        largos = [len(l) for l in lineas if l]
        if largos and all(abs(x - n) <= 1 for x in largos):
            return "\n".join(lineas)
    return ""


def _variantes(recorte: np.ndarray):
    """
    Genera versiones del recorte para que el OCR tenga varias oportunidades.
    Ordenadas de la que más suele funcionar a la que menos.
    """
    alto = recorte.shape[0]
    # La MRZ se lee mejor con caracteres de unos 40 px de alto.
    objetivo = 3.2 if alto < 90 else (2.0 if alto < 160 else 1.0)
    grande = cv2.resize(recorte, None, fx=objetivo, fy=objetivo,
                        interpolation=cv2.INTER_CUBIC) if objetivo != 1.0 else recorte

    yield "otsu", cv2.threshold(grande, 0, 255,
                                cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]

    yield "gris", grande

    yield "adaptativa", cv2.adaptiveThreshold(
        grande, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 12)

    # Contraste local: rescata fotos con sombra en diagonal, el caso típico de
    # un mostrador con luz lateral.
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(grande)
    yield "clahe+otsu", cv2.threshold(clahe, 0, 255,
                                      cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]

    # (Se quitó "otsu+cierre": no ganó ni una vez en las pruebas con documentos
    #  reales ni sintéticos, y cada variante que sobra es un OCR de más.)


# Umbral por debajo del cual la imagen no tiene información suficiente, medido
# con documentos reales: los DNI de 1607 px se leyeron bien y los de 509-678 px
# no, incluso cuando la banda se localizaba a 30 px por carácter. Ampliar no crea
# detalle: si la foto viene recomprimida (WhatsApp, capturas), no hay arreglo
# posible en el preproceso.
ANCHO_MINIMO_RECOMENDADO = 1200


def _consejo(ancho_original: int) -> str:
    if ancho_original < ANCHO_MINIMO_RECOMENDADO:
        return (f"La imagen es pequeña ({ancho_original} px de ancho; conviene "
                f"{ANCHO_MINIMO_RECOMENDADO} o más). Si la foto se ha enviado por "
                f"WhatsApp o es una captura de pantalla, se ha recomprimido y ya "
                f"no tiene detalle suficiente: hacer la foto directamente con la "
                f"cámara.")
    return ("Acercar más el documento, aplanarlo y evitar reflejos.")


# Tiempo máximo por lectura. La interfaz manda un frame cada 850 ms mientras la
# cámara está encendida: si una lectura tarda segundos, las peticiones se apilan y
# la sensación es de bloqueo. Al agotarse se devuelve la mejor lectura conseguida
# (o se declara el fallo), nunca un dato sin validar.
PRESUPUESTO_MS = int(os.environ.get("MRZ_PRESUPUESTO_MS", 2500))


# Proporción a partir de la cual se asume que la imagen recibida ES la banda MRZ
# ya recortada, no el documento entero. Una tarjeta ID-1 tiene ratio 1,59 y la
# página de un pasaporte 1,42; una banda de 2-3 líneas pasa de 4:1. Cuando el
# cliente manda solo la banda no hay que buscarla ni quedarse con la mitad
# inferior: se procesa entera, que es más rápido y más fiable.
RATIO_BANDA = 3.5


def leer(imagen_bytes: bytes, presupuesto_ms: int = PRESUPUESTO_MS) -> Lectura:
    """
    Lee la MRZ de una imagen en memoria.

    Lanza ErrorMRZ si ninguna variante produce una lectura con los dígitos de
    control correctos. Devolver un dato dudoso sería peor que no devolver nada:
    aquí el resultado alimenta el registro de viajeros.

    `presupuesto_ms` acota el tiempo total: se prueban las vías por orden de
    eficacia y se para al agotarse.
    """
    inicio = time.monotonic()
    arreglo = np.frombuffer(imagen_bytes, dtype=np.uint8)
    imagen = cv2.imdecode(arreglo, cv2.IMREAD_COLOR)
    if imagen is None:
        raise ErrorMRZ("el fichero recibido no es una imagen legible")

    ancho_original = imagen.shape[1]
    gris = _escalar(_a_gris(imagen))
    alto = gris.shape[0]
    # Si ya viene recortada la banda, la "región principal" es la imagen entera.
    es_banda = (gris.shape[1] / max(1, alto)) >= RATIO_BANDA

    intentos = 0
    mejor: tuple[Documento, str] | None = None

    def agotado() -> bool:
        return (time.monotonic() - inicio) * 1000 > presupuesto_ms

    # ── Orden de los intentos ────────────────────────────────────────────────
    # Está ordenado por lo que de verdad funcionó con documentos reales, no por
    # lo que parecía más elegante: las lecturas buenas salieron todas de la MITAD
    # INFERIOR con `otsu` o `gris`. La localización morfológica de la banda falló
    # en 11 de 15 fotos y, cuando acertaba, tampoco conseguía leerla; por eso pasa
    # detrás en vez de ir primero. Ese orden equivocado era lo que hacía que una
    # lectura tardase de 3 a 13 segundos: acertaba en el intento 8-16.
    principal = gris if es_banda else gris[int(alto * 0.55):, :]
    nombre_principal = "banda-recortada" if es_banda else "mitad-inferior"
    variantes = list(_variantes(principal))

    # Las dos primeras en PARALELO: son las que ganan en la práctica y no dependen
    # una de otra, así que dos OCR secuenciales pasan a costar uno. Es lo que le
    # ahorra medio tiempo al pasaporte, que acierta con la segunda.
    with ThreadPoolExecutor(max_workers=2) as pool:
        lanzados = {pool.submit(_ocr, img): nombre
                    for nombre, img in variantes[:2]}
        for futuro in as_completed(lanzados):
            intentos += 1
            try:
                texto = futuro.result()
            except Exception:      # noqa: BLE001 — un OCR fallido no aborta el resto
                continue
            if not texto.strip():
                continue
            try:
                documento = parsear(texto)
            except ErrorMRZ:
                continue
            etiqueta = f"{nombre_principal}/{lanzados[futuro]}"
            if documento.valido:
                return Lectura(documento, etiqueta, intentos,
                               int((time.monotonic() - inicio) * 1000))
            if mejor is None or (documento.aceptable and not mejor[0].aceptable):
                mejor = (documento, etiqueta)

    # El resto, secuencial: si se ha llegado aquí la imagen es difícil y ya no
    # interesa gastar núcleos a lo loco.
    for nombre_variante, preparada in variantes[2:]:
        if agotado():
            break
        intentos += 1
        texto = _ocr(preparada)
        if not texto.strip():
            continue
        try:
            documento = parsear(texto)
        except ErrorMRZ:
            continue
        etiqueta = f"{nombre_principal}/{nombre_variante}"
        if documento.valido:
            return Lectura(documento, etiqueta, intentos,
                           int((time.monotonic() - inicio) * 1000))
        if mejor is None or (documento.aceptable and not mejor[0].aceptable):
            mejor = (documento, etiqueta)

    # ── Respaldos, solo si la vía rápida no ha bastado ───────────────────────
    # Con la banda ya recortada, buscarla otra vez o mirar la imagen completa es
    # repetir el mismo trabajo: se prueban solo la rejilla y el modo línea a línea.
    if es_banda and not agotado():
        for etiqueta, hacer_ocr in (("banda-rejilla", _ocr_rejilla),
                                    ("banda-lineas", _ocr_por_lineas)):
            if agotado():
                break
            intentos += 1
            texto = hacer_ocr(gris)
            if not texto.strip():
                continue
            try:
                documento = parsear(texto)
            except ErrorMRZ:
                continue
            if documento.valido:
                return Lectura(documento, etiqueta, intentos,
                               int((time.monotonic() - inicio) * 1000))
            if mejor is None or (documento.aceptable and not mejor[0].aceptable):
                mejor = (documento, etiqueta)

    if not es_banda and not agotado():
        banda = _localizar_banda(gris)
        if banda is not None and banda.size:
            enderezada = _endereza(banda)
            # La rejilla segmenta por geometría (la MRZ es de paso fijo), así que
            # es inmune a que el OCR pierda o fusione caracteres de relleno.
            for etiqueta, hacer_ocr in (("banda-rejilla", _ocr_rejilla),
                                        ("banda-lineas", _ocr_por_lineas)):
                if agotado():
                    break
                intentos += 1
                texto = hacer_ocr(enderezada)
                if not texto.strip():
                    continue
                try:
                    documento = parsear(texto)
                except ErrorMRZ:
                    continue
                if documento.valido:
                    return Lectura(documento, etiqueta, intentos,
                                   int((time.monotonic() - inicio) * 1000))
                if mejor is None or (documento.aceptable and not mejor[0].aceptable):
                    mejor = (documento, etiqueta)

            for nombre_variante, preparada in _variantes(enderezada):
                if agotado():
                    break
                intentos += 1
                texto = _ocr(preparada)
                if not texto.strip():
                    continue
                try:
                    documento = parsear(texto)
                except ErrorMRZ:
                    continue
                etiqueta = f"banda/{nombre_variante}"
                if documento.valido:
                    return Lectura(documento, etiqueta, intentos,
                                   int((time.monotonic() - inicio) * 1000))
                if mejor is None or (documento.aceptable and not mejor[0].aceptable):
                    mejor = (documento, etiqueta)

    # Último recurso: la imagen entera. Rescató un pasaporte cuya banda quedaba
    # por encima de la mitad inferior. No aplica si ya era una banda.
    if not es_banda and not agotado():
        for nombre_variante, preparada in _variantes(gris):
            if agotado():
                break
            intentos += 1
            texto = _ocr(preparada)
            if not texto.strip():
                continue
            try:
                documento = parsear(texto)
            except ErrorMRZ:
                continue
            etiqueta = f"completa/{nombre_variante}"
            if documento.valido:
                return Lectura(documento, etiqueta, intentos,
                               int((time.monotonic() - inicio) * 1000))
            if mejor is None or (documento.aceptable and not mejor[0].aceptable):
                mejor = (documento, etiqueta)

    ms = int((time.monotonic() - inicio) * 1000)
    if mejor is not None:
        documento, etiqueta = mejor
        # Aceptable: los datos han validado uno a uno y solo falla el dígito
        # global. Se devuelve para que se pueda revisar en pantalla, con la
        # confianza rebajada a "media" y su aviso.
        if documento.aceptable:
            return Lectura(documento, etiqueta, intentos, ms)
        fallidos = ", ".join(k for k, v in documento.checks.items() if not v)
        raise ErrorMRZ(
            f"se ha localizado la banda pero la lectura no es fiable "
            f"(no cuadra: {fallidos}). {_consejo(ancho_original)}")
    # No se ha encontrado NADA parseable: lo más frecuente no es una mala foto,
    # sino haber fotografiado la cara que no lleva banda. Se dice primero eso.
    raise ErrorMRZ(
        f"no se ve ninguna banda de códigos. Comprobar que es la cara correcta: "
        f"en el DNI y la TIE está en el REVERSO, y en el pasaporte al pie de la "
        f"página de la foto. {_consejo(ancho_original)} "
        f"({intentos} intentos, {ms} ms)")


def diagnostico() -> dict:
    """Estado de las dependencias, para el endpoint de salud."""
    try:
        ruta = _binario_tesseract()
        version = subprocess.run([ruta, "--version"], capture_output=True,
                                 timeout=5).stdout.decode(errors="ignore")
        version = version.splitlines()[0] if version else "desconocida"
    except Exception as e:            # noqa: BLE001 — el health nunca debe romper
        return {"tesseract": False, "error": str(e), "opencv": cv2.__version__}
    return {"tesseract": True, "version": version, "opencv": cv2.__version__}
