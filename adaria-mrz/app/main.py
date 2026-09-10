"""
btr-mrz — servicio de lectura de MRZ de documentos de identidad.

Escucha solo en 127.0.0.1: el único cliente es el portal de gestión, en la misma
máquina. No se publica al exterior y no necesita autenticación propia (la del
portal ya filtra quién puede llegar hasta aquí).

Garantías de tratamiento de datos, deliberadas:
  · La imagen no se escribe en disco en ningún momento, ni siquiera temporalmente.
  · No se registra en el log ningún dato personal: ni número de documento, ni
    nombre, ni fecha de nacimiento. Solo formato, si validó, y cuánto tardó.
  · No hay ninguna llamada de red saliente. Todo el reconocimiento es local.
"""

from __future__ import annotations

import base64
import logging
import os

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse

from domicilio_reader import leer_domicilio
from mrz_parser import ErrorMRZ
from mrz_reader import TesseractNoDisponible, diagnostico, leer

MAX_BYTES = int(os.environ.get("MRZ_MAX_BYTES", 8 * 1024 * 1024))
VERSION = "1.0.0"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [btr-mrz] %(levelname)s %(message)s",
)
log = logging.getLogger("btr-mrz")

app = FastAPI(title="btr-mrz", version=VERSION, docs_url=None, redoc_url=None)


def _procesar(imagen: bytes) -> JSONResponse:
    """Punto único de proceso: valida tamaño, lee, y responde sin filtrar PII al log."""
    if not imagen:
        raise HTTPException(400, "no se ha recibido ninguna imagen")
    if len(imagen) > MAX_BYTES:
        raise HTTPException(
            413, f"imagen demasiado grande ({len(imagen) // 1024} KB, "
                 f"máximo {MAX_BYTES // 1024} KB)")
    try:
        lectura = leer(imagen)
    except TesseractNoDisponible as e:
        log.error("dependencia ausente: %s", e)
        raise HTTPException(503, str(e)) from e
    except ErrorMRZ as e:
        # Un fallo de lectura es un resultado normal, no un error del servicio:
        # se responde 200 con leido=false para que la UI pueda seguir intentando
        # sin tratarlo como avería.
        log.info("sin lectura válida (%d KB)", len(imagen) // 1024)
        return JSONResponse({"leido": False, "motivo": str(e)})

    documento = lectura.documento
    # Log sin PII: solo metadatos de la lectura.
    log.info("lectura %s formato=%s valido=%s variante=%s intentos=%d %dms",
             documento.tipo, documento.formato, documento.valido,
             lectura.intento, lectura.intentos, lectura.ms)
    return JSONResponse({
        "leido": True,
        "documento": documento.a_dict(),
        "diagnostico": {"variante": lectura.intento,
                        "intentos": lectura.intentos, "ms": lectura.ms},
    })


@app.post("/leer")
async def leer_multipart(imagen: UploadFile = File(...)):
    """Lectura desde formulario multipart (útil para pruebas con curl -F)."""
    return _procesar(await imagen.read())


@app.post("/leer-base64")
async def leer_base64(peticion: Request):
    """
    Lectura desde JSON {"imagen_b64": "..."}.

    Es la vía que usa el portal: encaja con el patrón ya en producción en la
    tablet de housekeeping, que manda la foto como base64 en el cuerpo JSON.
    """
    try:
        cuerpo = await peticion.json()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "el cuerpo no es un JSON válido") from e

    b64 = (cuerpo or {}).get("imagen_b64") or ""
    if "," in b64[:64]:                 # admite el prefijo data:image/jpeg;base64,
        b64 = b64.split(",", 1)[1]
    try:
        imagen = base64.b64decode(b64, validate=False)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "imagen_b64 no es base64 válido") from e
    return _procesar(imagen)


@app.post("/domicilio")
async def leer_domicilio_endpoint(imagen: UploadFile = File(...)):
    """
    Lee el bloque de DOMICILIO del reverso de un DNI español.

    A diferencia de la MRZ, este texto NO tiene dígitos de control: la respuesta
    es siempre una sugerencia por revisar, y así se marca (`verificado: false`).
    Devolver `encontrado: false` es un resultado normal —un pasaporte, la otra
    cara, o el fondo de seguridad tapando el texto—, no un error del servicio.
    """
    datos = await imagen.read()
    if not datos:
        raise HTTPException(400, "no se ha recibido ninguna imagen")
    if len(datos) > MAX_BYTES:
        raise HTTPException(413, "imagen demasiado grande")
    try:
        resultado = leer_domicilio(datos)
    except TesseractNoDisponible as e:
        raise HTTPException(503, str(e)) from e
    if resultado is None:
        log.info("domicilio no localizado (%d KB)", len(datos) // 1024)
        return JSONResponse({"encontrado": False,
                             "motivo": "no se ha encontrado el bloque de domicilio"})
    # Log sin PII: solo cuántas líneas se han aprovechado.
    log.info("domicilio localizado · %d línea(s) · %d KB",
             resultado.lineas, len(datos) // 1024)
    return JSONResponse({"encontrado": True, **resultado.a_dict()})


@app.get("/salud")
async def salud():
    estado = diagnostico()
    # `estado` trae su propia clave "version" (la de tesseract): se renombra para
    # que no pise la versión del servicio.
    version_tesseract = estado.pop("version", None)
    return JSONResponse(
        {"servicio": "btr-mrz", "version": VERSION,
         "ok": estado.get("tesseract", False),
         "version_tesseract": version_tesseract, **estado},
        status_code=200 if estado.get("tesseract") else 503)


@app.get("/formatos")
async def formatos():
    """Qué documentos sabe leer. Útil para la ayuda en pantalla."""
    return {
        "soportados": [
            {"formato": "TD3", "documentos": "Pasaportes de cualquier país (OACI Doc 9303)"},
            {"formato": "TD1", "documentos": "DNI español, TIE, DNI de la UE posterior a 2021"},
            {"formato": "TD2", "documentos": "Documentos de viaje en formato intermedio"},
        ],
        "no_soportados": [
            {"documento": "DNI francés de 1995-2021", "motivo": "MRZ propia ajena al estándar"},
            {"documento": "DNI europeos antiguos en papel", "motivo": "no tienen banda MRZ"},
        ],
        "nota": "Los documentos no soportados se teclean a mano.",
    }
