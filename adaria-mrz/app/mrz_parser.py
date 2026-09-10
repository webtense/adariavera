"""
Parser y validador de MRZ (Machine Readable Zone) según OACI Doc 9303.

Sin dependencias externas: es Python puro y se puede probar sin tesseract ni
OpenCV. La lógica de dígitos de control vive aquí, y es la razón por la que este
sistema puede afirmar que una lectura es correcta en vez de suponerlo.

Formatos soportados:
  · TD3 — pasaportes (2 líneas × 44). Todos los pasaportes en vigor del mundo.
  · TD1 — DNI español, TIE, DNI de la UE post-2021 (3 líneas × 30).
  · TD2 — documentos de viaje en formato intermedio (2 líneas × 36).

Deliberadamente NO soportado: la CNI francesa de 1995-2021, que usa una MRZ
propia de 2×36 ajena al Doc 9303. Se detecta y se rechaza con un motivo claro
para que recepción teclee, en vez de arriesgar una lectura inventada.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field, asdict
from datetime import date

# ─── Alfabeto y pesos ────────────────────────────────────────────────────────
RELLENO = "<"
PESOS = (7, 3, 1)

# Correcciones de OCR: caracteres que tesseract confunde en la fuente OCR-B.
# Solo se aplican en campos donde el tipo es conocido (dígitos o letras), nunca
# a ciegas sobre toda la línea.
CONFUSIONES_A_DIGITO = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1",
                        "Z": "2", "S": "5", "B": "8", "G": "6"}
CONFUSIONES_A_LETRA = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G"}

# Códigos de nacionalidad propios de OACI que no son ISO 3166-1 alfa-3.
# Sin esta tabla, un pasaporte alemán ("D<<") o británico de ultramar no casaría
# contra el catálogo Naciones del PMS.
EXCEPCIONES_NACIONALIDAD = {
    "D": "DEU",           # Alemania usa "D" en sus pasaportes
    "GBD": "GBR",         # British Overseas Territories citizen
    "GBN": "GBR",         # British National (Overseas)
    "GBO": "GBR",         # British Overseas citizen
    "GBP": "GBR",         # British Protected person
    "GBS": "GBR",         # British Subject
    "EUE": "EUE",         # Unión Europea (documentos de institución)
    "UNO": "UNO", "UNA": "UNO", "UNK": "UNO",   # Naciones Unidas
    "XXA": "XXA",         # apátrida (Convenio 1954)
    "XXB": "XXB",         # refugiado (Convenio 1951)
    "XXC": "XXC",         # refugiado, otro
    "XXX": "XXX",         # nacionalidad indeterminada
    "XOM": "XOM", "XCO": "XCO", "XEC": "XEC",   # organizaciones
}

# Tipo de documento → código de TiposDocumento del PMS (TPD_COD_str, estable
# entre hoteles; el TPD_GUID NO lo es y se resuelve por BD en tiempo de ejecución).
TIPO_A_COD_PMS = {
    "PASAPORTE": "P",
    "DNI": "D",
    "TIE": "N",              # Permiso de residencia español
    "DNI_UE": "I",           # Carta de identidad de otro país
    "RES_UE": "X",           # Permiso de residencia UE
    "DESCONOCIDO": None,
}

LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE"


class ErrorMRZ(Exception):
    """La MRZ no se pudo interpretar. El mensaje explica por qué."""


# ─── Utilidades de bajo nivel ────────────────────────────────────────────────
def _valor(caracter: str) -> int:
    """Valor de un carácter para el cálculo del dígito de control."""
    if caracter == RELLENO:
        return 0
    if caracter.isdigit():
        return int(caracter)
    if "A" <= caracter <= "Z":
        return ord(caracter) - ord("A") + 10
    raise ErrorMRZ(f"carácter no válido en MRZ: {caracter!r}")


def digito_control(campo: str) -> int:
    """Dígito de control OACI: suma ponderada 7-3-1 en módulo 10."""
    return sum(_valor(c) * PESOS[i % 3] for i, c in enumerate(campo)) % 10


def _verificar(campo: str, esperado: str) -> bool:
    """True si `esperado` es el dígito de control correcto de `campo`."""
    if not esperado.isdigit():
        return False
    try:
        return digito_control(campo) == int(esperado)
    except ErrorMRZ:
        return False


def _normalizar_linea(linea: str) -> str:
    """Limpia una línea leída por OCR sin alterar su contenido semántico."""
    linea = unicodedata.normalize("NFKD", linea).upper()
    # El OCR suele leer los '<' como '«', 'K', '(' o espacios en bloque.
    linea = linea.replace("«", "<<").replace("‹", "<").replace("≤", "<")
    # Espacios y guiones no existen en una MRZ: son ruido de segmentación.
    linea = re.sub(r"[ \t\-_—–]", "", linea)
    # Cualquier resto no representable pasa a relleno.
    return re.sub(r"[^A-Z0-9<]", "<", linea)


def _a_digitos(campo: str) -> str:
    """Fuerza a dígitos un campo que el estándar define como numérico."""
    return "".join(CONFUSIONES_A_DIGITO.get(c, c) for c in campo)


def _a_letras(campo: str) -> str:
    """Fuerza a letras un campo que el estándar define como alfabético."""
    return "".join(CONFUSIONES_A_LETRA.get(c, c) for c in campo)


# ─── Normalización por posiciones ────────────────────────────────────────────
#
# Esto es lo que hace que el OCR sea utilizable. El Doc 9303 fija el tipo de cada
# posición de cada línea: aquí es un dígito, allí una letra. Aplicando ese
# conocimiento ANTES de comprobar los dígitos de control, las confusiones típicas
# del OCR (O↔0, I↔1, S↔5, D↔0) se corrigen solas en los campos donde el tipo es
# conocido.
#
# Es importante hacerlo antes: si se calcula el checksum sobre el texto crudo y
# se normaliza después, el check queda marcado como fallido para siempre aunque
# el dato ya esté bien. (Ese era exactamente el fallo que hundía la lectura de
# los DNI españoles al 10%, por los tres ceros seguidos de 'BAA000589'.)
#
# Tipos: 'D' dígitos · 'L' letras · 'A' alfanumérico, se deja igual
#        'S' sexo (M/F/<) · '<' relleno

def _tramo(texto: str, tipo: str) -> str:
    if tipo == "D":
        return _a_digitos(texto)
    if tipo == "L":
        return _a_letras(texto)
    if tipo == "S":
        c = texto.upper()
        return c if c in ("M", "F", RELLENO) else ("F" if c in ("P", "E") else RELLENO)
    if tipo == "<":
        # En zona de relleno, los caracteres que el OCR confunde con '<' lo son.
        return "".join(RELLENO if c in "KC(«X" else c for c in texto)
    return texto


def _normalizar_posiciones(linea: str, especificacion) -> str:
    """
    Aplica el tipo esperado a cada tramo de una línea de MRZ.
    `especificacion` es una lista de (inicio, fin, tipo).
    """
    salida = list(linea)
    for inicio, fin, tipo in especificacion:
        if inicio >= len(linea):
            continue
        tramo = _tramo(linea[inicio:fin], tipo)
        for i, c in enumerate(tramo):
            if inicio + i < len(salida):
                salida[inicio + i] = c
    return "".join(salida)


def _fecha(yymmdd: str, futuro: bool) -> date | None:
    """
    Convierte YYMMDD a fecha resolviendo el siglo, que la MRZ no codifica.

    `futuro=True` para caducidades (siempre de este siglo o el próximo);
    `futuro=False` para fechas de nacimiento (si sale futura, es del siglo XX).
    """
    yymmdd = _a_digitos(yymmdd)
    if not re.fullmatch(r"\d{6}", yymmdd):
        return None
    aa, mm, dd = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:6])
    if not (1 <= mm <= 12 and 1 <= dd <= 31):
        return None
    hoy = date.today()
    siglo = hoy.year // 100 * 100
    try:
        candidata = date(siglo + aa, mm, dd)
    except ValueError:
        return None
    if futuro:
        # Caducidades: se asume el siglo en curso. Un documento ya caducado es
        # perfectamente escaneable (y conviene avisar de ello), así que NO se
        # empuja al futuro; solo se corrige lo imposible: una caducidad a más de
        # 30 años vista pertenece en realidad al siglo anterior.
        if candidata.year > hoy.year + 30:
            candidata = candidata.replace(year=candidata.year - 100)
    else:
        # Un nacimiento en el futuro pertenece al siglo pasado.
        if candidata > hoy:
            candidata = candidata.replace(year=candidata.year - 100)
    return candidata


# Caracteres que el OCR confunde con el relleno '<' de la MRZ. En la OCR-B real
# son bien distintos, pero con mala luz o poca resolución se cruzan.
POSIBLE_RELLENO = set("KCX<(«")


def _recortar_relleno(texto: str) -> tuple[str, bool]:
    """
    Quita del final una cola de relleno que el OCR haya leído como letras.

    Hace falta porque **el campo de nombre es el único de la MRZ que ningún
    dígito de control protege**: un error ahí pasa la validación sin más. Se
    recorta solo una cola larga y homogénea (≥4 caracteres iguales), tolerando
    hasta 2 caracteres sueltos por detrás.

    Es deliberadamente conservador: un nombre real que acabe en K o C
    ("PATRICK", "MARC") no se toca, porque su cola no llega a 4 repeticiones.
    Devuelve (texto, se_ha_recortado) para poder avisar de que la lectura del
    nombre es dudosa.
    """
    if not texto:
        return texto, False

    # Se permite descartar hasta 2 caracteres finales sospechosos sueltos, que
    # suelen ser el último trozo de relleno mal segmentado.
    for descartables in (0, 1, 2):
        cuerpo = texto[:-descartables] if descartables else texto
        if len(cuerpo) < 5 or cuerpo[-1] not in POSIBLE_RELLENO:
            continue
        if descartables and any(c not in POSIBLE_RELLENO for c in texto[-descartables:]):
            continue
        caracter = cuerpo[-1]
        largo = len(cuerpo) - len(cuerpo.rstrip(caracter))
        if largo >= 4:
            return cuerpo[:-largo].rstrip(" "), True
    return texto, False


def _nombres(campo: str) -> tuple[str, str, bool, bool]:
    """
    Separa el campo de identidad en (apellidos, nombres, truncado, dudoso).

    La MRZ usa 'APELLIDOS<<NOMBRES', '<' como espacio y rellena con '<'.
    `truncado` avisa de que el campo iba lleno y el nombre real puede ser más
    largo — importante para no sobrescribir en el PMS un nombre completo con
    una versión recortada. `dudoso` avisa de que hubo que limpiar relleno mal
    leído, señal de que el campo merece una mirada.
    """
    truncado = not campo.endswith(RELLENO)
    partes = campo.split("<<", 1)
    limpia = lambda s: " ".join(p for p in s.split("<") if p).strip()

    apellidos, dudoso_a = _recortar_relleno(limpia(partes[0]))
    nombres, dudoso_n = _recortar_relleno(limpia(partes[1]) if len(partes) > 1 else "")
    return apellidos, nombres, truncado, (dudoso_a or dudoso_n)


def _nacionalidad(codigo: str) -> str | None:
    """Traduce el código de la MRZ a ISO-A3, aplicando las excepciones OACI."""
    codigo = _a_letras(codigo).replace(RELLENO, "").strip()
    if not codigo:
        return None
    return EXCEPCIONES_NACIONALIDAD.get(codigo, codigo if len(codigo) == 3 else None)


def _sexo(caracter: str) -> str | None:
    """M / F, o None si el documento no lo especifica."""
    c = caracter.upper()
    if c in ("M", "F"):
        return c
    if c == "0":        # OCR frecuente de 'D' en algunos documentos antiguos
        return None
    return None         # '<' o 'X' = no especificado


def _corregir_soporte_espanol(soporte: str, dc: str) -> tuple[str, bool]:
    """
    Corrige el número de soporte de un DNI español usando su formato conocido:
    3 letras + 6 dígitos (p. ej. BAA000589).

    Hace falta porque **el dígito de control no siempre detecta el error**. Caso
    real observado: leer `BAAOO0589` en vez de `BAA000589` valida igual, porque
    el valor de 'O' es 24 y 24×7 + 24×3 = 240, múltiplo de 10 — la confusión
    O↔0 en dos posiciones con pesos 7 y 3 consecutivos es invisible al checksum.

    Solo se acepta la corrección si el resultado encaja en el formato Y sigue
    cuadrando el dígito de control. Devuelve (soporte, se_ha_corregido).
    """
    if re.fullmatch(r"[A-Z]{3}\d{6}", soporte):
        return soporte, False
    if len(soporte) != 9:
        return soporte, False
    candidato = _a_letras(soporte[:3]) + _a_digitos(soporte[3:])
    if (re.fullmatch(r"[A-Z]{3}\d{6}", candidato)
            and candidato != soporte and _verificar(candidato, dc)):
        return candidato, True
    return soporte, False


def letra_dni_correcta(numero: str) -> bool | None:
    """
    Valida la letra de un DNI o NIE español por módulo 23.

    Es una comprobación *independiente* de los checksums de la MRZ: si ambas
    coinciden, la confianza en el número es muy alta. Devuelve None si el
    número no tiene forma de DNI/NIE (p. ej. un pasaporte extranjero).
    """
    numero = numero.upper().replace("-", "").replace(" ", "")
    m = re.fullmatch(r"([XYZ]?)(\d{7,8})([A-Z])", numero)
    if not m:
        return None
    prefijo, digitos, letra = m.groups()
    base = {"": "", "X": "0", "Y": "1", "Z": "2"}[prefijo] + digitos
    return LETRAS_DNI[int(base) % 23] == letra


# ─── Resultado ───────────────────────────────────────────────────────────────
@dataclass
class Documento:
    """Resultado de una lectura de MRZ."""
    formato: str                       # TD1 | TD2 | TD3
    tipo: str                          # PASAPORTE | DNI | TIE | DNI_UE | ...
    cod_tipo_pms: str | None           # TPD_COD_str a usar en ACI
    numero: str                        # el que va a hue_nif_str
    numero_soporte: str | None         # IDESP del DNI español → hue_nso_str
    apellidos: str
    nombres: str
    nombre_truncado: bool
    nombre_dudoso: bool                # el OCR confundió el relleno: revisar
    sexo: str | None
    fecha_nacimiento: date | None
    fecha_caducidad: date | None
    nacionalidad: str | None           # ISO-A3
    pais_emisor: str | None            # ISO-A3
    checks: dict = field(default_factory=dict)
    avisos: list = field(default_factory=list)

    @property
    def valido(self) -> bool:
        """
        True solo si TODOS los dígitos de control presentes cuadran.
        Es el criterio que permite guardar sin que nadie revise cifra a cifra.
        """
        return bool(self.checks) and all(self.checks.values())

    @property
    def aceptable(self) -> bool:
        """
        Todos los dígitos de control de CAMPO cuadran, aunque falle el compuesto.

        El compuesto es una redundancia: cubre exactamente los mismos datos que
        ya validan sus checksums individuales. Si falla solo él, lo más probable
        es que el carácter mal leído sea el propio dígito compuesto, no un dato.
        Se permite seguir, pero nunca se marca como `valido` y se avisa: la
        decisión de guardar sigue siendo de quien lo revisa en pantalla.
        """
        de_campo = {k: v for k, v in self.checks.items() if k != "compuesto"}
        return bool(de_campo) and all(de_campo.values())

    @property
    def confianza(self) -> str:
        if self.valido:
            return "alta"
        if self.aceptable:
            return "media"
        return "baja"

    def a_dict(self) -> dict:
        d = asdict(self)
        for campo in ("fecha_nacimiento", "fecha_caducidad"):
            d[campo] = d[campo].isoformat() if d[campo] else None
        d["valido"] = self.valido
        d["aceptable"] = self.aceptable
        d["confianza"] = self.confianza
        return d


# ─── Detección de formato ────────────────────────────────────────────────────
def _lineas_candidatas(texto: str) -> list[str]:
    """Extrae de un texto OCR las líneas que parecen pertenecer a una MRZ."""
    brutas = [_normalizar_linea(l) for l in texto.splitlines()]
    return [l for l in brutas if len(l) >= 25 and l.count(RELLENO) >= 2]


def _ajustar(linea: str, largo: int) -> str:
    """Recorta o rellena una línea a su longitud nominal."""
    return linea[:largo] if len(linea) >= largo else linea.ljust(largo, RELLENO)


def _es_cni_francesa(lineas: list[str]) -> bool:
    """
    La CNI francesa 1995-2021: 2×36 empezando por 'IDFRA' pero con el número
    de documento en la línea 2, no en la 1. No es Doc 9303.
    """
    return (len(lineas) == 2 and len(lineas[0]) >= 34
            and lineas[0].startswith("IDFRA")
            and not re.match(r"^ID[A-Z<]{3}[A-Z0-9<]{9}\d", lineas[0]))


# ─── Parsers por formato ─────────────────────────────────────────────────────
ESPEC_TD3_L1 = [(0, 2, "L"), (2, 5, "L"), (5, 44, "L")]
ESPEC_TD3_L2 = [(0, 9, "A"), (9, 10, "D"), (10, 13, "L"), (13, 19, "D"), (19, 20, "D"),
                (20, 21, "S"), (21, 27, "D"), (27, 28, "D"), (28, 42, "A"),
                (42, 43, "D"), (43, 44, "D")]


def _parse_td3(l1: str, l2: str) -> Documento:
    """Pasaporte: 2 líneas × 44."""
    l1, l2 = _ajustar(l1, 44), _ajustar(l2, 44)
    l1 = _normalizar_posiciones(l1, ESPEC_TD3_L1)
    l2 = _normalizar_posiciones(l2, ESPEC_TD3_L2)

    numero = l2[0:9]
    dc_numero = l2[9]
    nacionalidad = l2[10:13]
    f_nac, dc_nac = l2[13:19], l2[19]
    sexo = l2[20]
    f_cad, dc_cad = l2[21:27], l2[27]
    opcional, dc_opcional = l2[28:42], l2[42]
    dc_compuesto = l2[43]

    # El compuesto cubre número+dc, nacimiento+dc, caducidad+dc y opcional+dc.
    base_compuesta = l2[0:10] + l2[13:20] + l2[21:43]

    checks = {
        "numero": _verificar(numero, dc_numero),
        "nacimiento": _verificar(f_nac, dc_nac),
        "caducidad": _verificar(f_cad, dc_cad),
        "compuesto": _verificar(base_compuesta, dc_compuesto),
    }
    # El dígito del campo opcional solo se valida si el campo se usa.
    if opcional.replace(RELLENO, ""):
        checks["opcional"] = _verificar(opcional, dc_opcional)

    apellidos, nombres, truncado, dudoso = _nombres(l1[5:44])
    avisos = []
    if not l1.startswith("P"):
        avisos.append(f"la primera línea no empieza por 'P' (leído {l1[0]!r})")

    return Documento(
        formato="TD3", tipo="PASAPORTE", cod_tipo_pms=TIPO_A_COD_PMS["PASAPORTE"],
        numero=numero.replace(RELLENO, ""), numero_soporte=None,
        apellidos=apellidos, nombres=nombres, nombre_truncado=truncado,
        nombre_dudoso=dudoso,
        sexo=_sexo(sexo),
        fecha_nacimiento=_fecha(f_nac, futuro=False),
        fecha_caducidad=_fecha(f_cad, futuro=True),
        nacionalidad=_nacionalidad(nacionalidad),
        pais_emisor=_nacionalidad(l1[2:5]),
        checks=checks, avisos=avisos,
    )


ESPEC_TD1_L1 = [(0, 2, "L"), (2, 5, "L"), (5, 14, "A"), (14, 15, "D"), (15, 30, "A")]
ESPEC_TD1_L2 = [(0, 6, "D"), (6, 7, "D"), (7, 8, "S"), (8, 14, "D"), (14, 15, "D"),
                (15, 18, "L"), (18, 29, "A"), (29, 30, "D")]
ESPEC_TD1_L3 = [(0, 30, "L")]


def _parse_td1(l1: str, l2: str, l3: str) -> Documento:
    """DNI español, TIE y DNI de la UE: 3 líneas × 30."""
    l1, l2, l3 = _ajustar(l1, 30), _ajustar(l2, 30), _ajustar(l3, 30)
    # Se normaliza por posiciones ANTES de comprobar nada: los dígitos de control
    # tienen que calcularse sobre el texto ya corregido por tipo.
    l1 = _normalizar_posiciones(l1, ESPEC_TD1_L1)
    l2 = _normalizar_posiciones(l2, ESPEC_TD1_L2)
    l3 = _normalizar_posiciones(l3, ESPEC_TD1_L3)

    pais = l1[2:5]
    pais_iso = _nacionalidad(pais)
    avisos = []

    # El documento de un DNI/TIE español es el nº de SOPORTE, con formato fijo
    # (3 letras + 6 dígitos). Corregirlo aquí, antes del checksum, es lo que
    # rescata los soportes con ceros seguidos tipo 'BAA000589'.
    numero = l1[5:14]
    dc_numero = l1[14]
    if pais_iso == "ESP":
        candidato_sop = _a_letras(numero[:3]) + _a_digitos(numero[3:])
        if re.fullmatch(r"[A-Z]{3}\d{6}", candidato_sop) and candidato_sop != numero:
            if _verificar(candidato_sop, dc_numero):
                numero = candidato_sop
                l1 = l1[:5] + numero + l1[14:]
                avisos.append("el número de soporte se ha corregido por su formato "
                              "(el OCR confundió letras y dígitos)")

    # El campo opcional de un DNI español lleva el número de DNI: 8 dígitos + letra.
    opcional1 = l1[15:30]
    if pais_iso == "ESP":
        crudo = opcional1.replace(RELLENO, "").strip()
        if len(crudo) == 9:
            arreglado = _a_digitos(crudo[:8]) + _a_letras(crudo[8])
            if re.fullmatch(r"\d{8}[A-Z]", arreglado) and arreglado != crudo:
                opcional1 = arreglado.ljust(15, RELLENO)
                l1 = l1[:15] + opcional1

    f_nac, dc_nac = l2[0:6], l2[6]
    sexo = l2[7]
    f_cad, dc_cad = l2[8:14], l2[14]
    nacionalidad = l2[15:18]
    dc_compuesto = l2[29]

    base_compuesta = l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29]

    checks = {
        "numero": _verificar(numero, dc_numero),
        "nacimiento": _verificar(f_nac, dc_nac),
        "caducidad": _verificar(f_cad, dc_cad),
        "compuesto": _verificar(base_compuesta, dc_compuesto),
    }

    apellidos, nombres, truncado, dudoso = _nombres(l3)

    # ── Caso español: el número de la MRZ es el nº de SOPORTE, y el DNI/NIE
    # real viaja en el campo opcional. Los dos interesan y van a columnas
    # distintas del PMS (hue_nso_str y hue_nif_str).
    soporte = None
    numero_final = numero.replace(RELLENO, "")
    tipo = "DNI_UE"

    if pais_iso == "ESP":
        candidato = opcional1.replace(RELLENO, "").strip()
        # Un DNI son 8 dígitos + letra; un NIE, X/Y/Z + 7 dígitos + letra.
        if re.fullmatch(r"[XYZ]?\d{7,8}[A-Z]", candidato):
            soporte = numero_final
            numero_final = candidato
            tipo = "TIE" if candidato[0] in "XYZ" else "DNI"
            ok_letra = letra_dni_correcta(candidato)
            if ok_letra is False:
                checks["letra_dni"] = False
                avisos.append("la letra del DNI/NIE no cuadra con el número")
            elif ok_letra:
                checks["letra_dni"] = True
        else:
            tipo = "DNI"
            # El soporte NO se usa como número de documento: son cosas distintas
            # y confundirlos mete un dato falso en la ficha.
            soporte = numero_final
            numero_final = ""
            avisos.append(
                "no se ha podido leer el número de DNI (el campo opcional de la "
                "MRZ no era legible). Sí se ha leído el número de soporte "
                f"'{soporte}': teclea el DNI a mano")

    return Documento(
        formato="TD1", tipo=tipo, cod_tipo_pms=TIPO_A_COD_PMS.get(tipo),
        numero=numero_final, numero_soporte=soporte,
        apellidos=apellidos, nombres=nombres, nombre_truncado=truncado,
        nombre_dudoso=dudoso,
        sexo=_sexo(sexo),
        fecha_nacimiento=_fecha(f_nac, futuro=False),
        fecha_caducidad=_fecha(f_cad, futuro=True),
        nacionalidad=_nacionalidad(nacionalidad), pais_emisor=pais_iso,
        checks=checks, avisos=avisos,
    )


ESPEC_TD2_L1 = [(0, 2, "L"), (2, 5, "L"), (5, 36, "L")]
ESPEC_TD2_L2 = [(0, 9, "A"), (9, 10, "D"), (10, 13, "L"), (13, 19, "D"), (19, 20, "D"),
                (20, 21, "S"), (21, 27, "D"), (27, 28, "D"), (28, 35, "A"), (35, 36, "D")]


def _parse_td2(l1: str, l2: str) -> Documento:
    """Formato intermedio: 2 líneas × 36."""
    l1, l2 = _ajustar(l1, 36), _ajustar(l2, 36)
    l1 = _normalizar_posiciones(l1, ESPEC_TD2_L1)
    l2 = _normalizar_posiciones(l2, ESPEC_TD2_L2)

    numero, dc_numero = l2[0:9], l2[9]
    nacionalidad = l2[10:13]
    f_nac, dc_nac = l2[13:19], l2[19]
    sexo = l2[20]
    f_cad, dc_cad = l2[21:27], l2[27]
    dc_compuesto = l2[35]

    base_compuesta = l2[0:10] + l2[13:20] + l2[21:35]
    checks = {
        "numero": _verificar(numero, dc_numero),
        "nacimiento": _verificar(f_nac, dc_nac),
        "caducidad": _verificar(f_cad, dc_cad),
        "compuesto": _verificar(base_compuesta, dc_compuesto),
    }

    apellidos, nombres, truncado, dudoso = _nombres(l1[5:36])
    tipo = "PASAPORTE" if l1.startswith("P") else "DNI_UE"
    return Documento(
        formato="TD2", tipo=tipo, cod_tipo_pms=TIPO_A_COD_PMS.get(tipo),
        numero=numero.replace(RELLENO, ""), numero_soporte=None,
        apellidos=apellidos, nombres=nombres, nombre_truncado=truncado,
        nombre_dudoso=dudoso,
        sexo=_sexo(sexo),
        fecha_nacimiento=_fecha(f_nac, futuro=False),
        fecha_caducidad=_fecha(f_cad, futuro=True),
        nacionalidad=_nacionalidad(nacionalidad), pais_emisor=_nacionalidad(l1[2:5]),
        checks=checks, avisos=[],
    )


# ─── Punto de entrada ────────────────────────────────────────────────────────
def parsear(texto: str) -> Documento:
    """
    Interpreta el texto OCR de una MRZ y devuelve el documento leído.

    Lanza ErrorMRZ si no encuentra una MRZ reconocible: es la respuesta correcta
    a una foto borrosa o a un documento sin banda legible. Nunca devuelve datos
    a medias haciéndolos pasar por buenos.
    """
    lineas = _lineas_candidatas(texto)
    if not lineas:
        raise ErrorMRZ("no se ha encontrado ninguna banda MRZ en la imagen")

    if _es_cni_francesa(lineas):
        raise ErrorMRZ(
            "documento de identidad francés anterior a 2021: usa un formato "
            "propio no reconocido por el estándar. Teclear los datos a mano")

    # TD1: tres líneas de 30. Se prueba primero porque es el DNI español.
    de30 = [l for l in lineas if 28 <= len(l) <= 32]
    if len(de30) >= 3:
        return _avisos_finales(_parse_td1(de30[-3], de30[-2], de30[-1]))

    # TD3: dos líneas de 44 (pasaportes).
    de44 = [l for l in lineas if len(l) >= 42]
    if len(de44) >= 2:
        return _avisos_finales(_parse_td3(de44[-2], de44[-1]))

    # TD2: dos líneas de 36.
    de36 = [l for l in lineas if 34 <= len(l) <= 38]
    if len(de36) >= 2:
        return _avisos_finales(_parse_td2(de36[-2], de36[-1]))

    raise ErrorMRZ(
        f"banda MRZ incompleta: se han detectado {len(lineas)} línea(s) de "
        f"longitud {[len(l) for l in lineas]}, y no encajan en TD1, TD2 ni TD3")


def _avisos_finales(d: Documento) -> Documento:
    """
    Avisos que no dependen del formato y que a recepción le interesan aunque la
    lectura sea perfecta. Un documento caducado se lee igual de bien, pero no
    sirve para viajar: mejor que salte en pantalla.
    """
    if d.fecha_caducidad and d.fecha_caducidad < date.today():
        d.avisos.append(
            f"el documento está caducado desde el "
            f"{d.fecha_caducidad.strftime('%d/%m/%Y')}")
    if d.nombre_truncado:
        d.avisos.append(
            "el nombre ocupa todo el campo de la MRZ y puede estar recortado: "
            "revisarlo contra el documento")
    if d.aceptable and not d.valido:
        d.avisos.append(
            "todos los datos cuadran con su dígito de control, pero el dígito "
            "de comprobación global no: repasa el número antes de guardar")
    if d.nombre_dudoso:
        # Importante: ningún dígito de control cubre el campo de nombre, así que
        # `valido` no dice nada sobre él. Este aviso es la única señal.
        d.avisos.append(
            "el nombre se ha leído con dificultad (relleno confundido con "
            "letras): comprobarlo contra el documento")
    return d


# ─── Generador, solo para pruebas ────────────────────────────────────────────
def componer_td3(numero: str, pais: str, nacionalidad: str, apellidos: str,
                 nombres: str, nacimiento: str, sexo: str, caducidad: str,
                 opcional: str = "") -> tuple[str, str]:
    """Construye una MRZ TD3 válida. Se usa en los tests de ida y vuelta."""
    identidad = f"{apellidos}<<{nombres}".replace(" ", "<").ljust(39, RELLENO)[:39]
    l1 = f"P<{pais.ljust(3, RELLENO)[:3]}{identidad}"
    num = numero.ljust(9, RELLENO)[:9]
    opc = opcional.ljust(14, RELLENO)[:14]
    nac = nacionalidad.ljust(3, RELLENO)[:3]
    cuerpo = (f"{num}{digito_control(num)}{nac}"
              f"{nacimiento}{digito_control(nacimiento)}{sexo}"
              f"{caducidad}{digito_control(caducidad)}{opc}{digito_control(opc)}")
    return l1, cuerpo + str(digito_control(cuerpo[0:10] + cuerpo[13:20] + cuerpo[21:43]))


def componer_td2(numero: str, pais: str, nacionalidad: str, apellidos: str,
                 nombres: str, nacimiento: str, sexo: str,
                 caducidad: str) -> tuple[str, str]:
    """Construye una MRZ TD2 válida (2 líneas × 36)."""
    identidad = f"{apellidos}<<{nombres}".replace(" ", "<").ljust(31, RELLENO)[:31]
    l1 = f"I<{pais.ljust(3, RELLENO)[:3]}{identidad}"
    num = numero.ljust(9, RELLENO)[:9]
    cuerpo = (f"{num}{digito_control(num)}{nacionalidad.ljust(3, RELLENO)[:3]}"
              f"{nacimiento}{digito_control(nacimiento)}{sexo}"
              f"{caducidad}{digito_control(caducidad)}")
    cuerpo = cuerpo.ljust(35, RELLENO)[:35]
    return l1, cuerpo + str(digito_control(cuerpo[0:10] + cuerpo[13:20] + cuerpo[21:35]))


def componer_td1(soporte: str, pais: str, nacionalidad: str, apellidos: str,
                 nombres: str, nacimiento: str, sexo: str, caducidad: str,
                 opcional1: str = "") -> tuple[str, str, str]:
    """Construye una MRZ TD1 válida (DNI español si pais='ESP')."""
    sop = soporte.ljust(9, RELLENO)[:9]
    opc1 = opcional1.ljust(15, RELLENO)[:15]
    l1 = f"ID{pais.ljust(3, RELLENO)[:3]}{sop}{digito_control(sop)}{opc1}"
    medio = (f"{nacimiento}{digito_control(nacimiento)}{sexo}"
             f"{caducidad}{digito_control(caducidad)}"
             f"{nacionalidad.ljust(3, RELLENO)[:3]}")
    medio = medio.ljust(29, RELLENO)[:29]
    base = l1[5:30] + medio[0:7] + medio[8:15] + medio[18:29]
    l2 = medio + str(digito_control(base))
    l3 = f"{apellidos}<<{nombres}".replace(" ", "<").ljust(30, RELLENO)[:30]
    return l1, l2, l3
