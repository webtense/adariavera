# -*- coding: utf-8 -*-
"""
Generación del XML de la Encuesta de Ocupación Hotelera (EOH) del INE
para el Hotel Adaria Vera (provincia de Almería, código 04).

*** VALIDACIÓN XSD PENDIENTE ***
No se dispone del XSD oficial de la encuesta EOH del INE en este despliegue.
La estructura de este XML se ha construido siguiendo los campos conocidos
del cuestionario EOH (identificación del establecimiento, periodo, grado
de ocupación, personal empleado y viajeros/pernoctaciones por país de
residencia), pero NO ha sido validada contra el esquema oficial. Antes de
usar este fichero para un envío real al INE, hay que:
  1. Obtener el XSD/formato oficial vigente de la encuesta EOH (IRIA / INE).
  2. Adaptar nombres de elementos, atributos y orden si difieren.
  3. Validar el XML generado contra ese XSD.
"""
from xml.etree import ElementTree as ET
from xml.dom import minidom

PROVINCIA_CODIGO = "04"
PROVINCIA_NOMBRE = "Almería"
CATEGORIA_ESTABLECIMIENTO = "4 estrellas"
TIPO_ENCUESTA = "EOH"  # Encuesta de Ocupación Hotelera (no EOAP)


def generar_xml_eoh(anio, mes, nacionalidades, manual):
    """
    nacionalidades: lista de dicts {pais, codigo, viajeros, pernoctaciones}
    manual: dict con campos introducidos a mano en el formulario:
        establecimiento_nombre, dias_abierto, plazas_disponibles,
        habitaciones_disponibles, personal_fijo, personal_eventual
    """
    root = ET.Element("EncuestaEOH", {
        "version": "PROVISIONAL-PENDIENTE-VALIDACION-XSD",
        "generadoPor": "adaria-ine v1.0.0",
    })

    cabecera = ET.SubElement(root, "Cabecera")
    provincia = ET.SubElement(cabecera, "Provincia", {"codigo": PROVINCIA_CODIGO})
    provincia.text = PROVINCIA_NOMBRE

    establecimiento = ET.SubElement(cabecera, "Establecimiento")
    ET.SubElement(establecimiento, "Nombre").text = manual.get(
        "establecimiento_nombre", "Hotel Adaria Vera"
    )
    ET.SubElement(establecimiento, "NumeroOrden").text = manual.get(
        "establecimiento_num_orden", ""
    )
    ET.SubElement(establecimiento, "Categoria").text = CATEGORIA_ESTABLECIMIENTO
    ET.SubElement(establecimiento, "TipoEncuesta").text = TIPO_ENCUESTA

    ET.SubElement(cabecera, "Periodo", {
        "anio": str(anio),
        "mes": f"{mes:02d}",
    })

    ocupacion = ET.SubElement(root, "GradoOcupacion")
    ET.SubElement(ocupacion, "DiasAbiertoMes").text = str(manual.get("dias_abierto", ""))
    ET.SubElement(ocupacion, "PlazasDisponibles").text = str(manual.get("plazas_disponibles", ""))
    ET.SubElement(ocupacion, "HabitacionesDisponibles").text = str(manual.get("habitaciones_disponibles", ""))

    personal = ET.SubElement(root, "PersonalEmpleado")
    ET.SubElement(personal, "Fijo").text = str(manual.get("personal_fijo", ""))
    ET.SubElement(personal, "Eventual").text = str(manual.get("personal_eventual", ""))
    try:
        total_personal = int(manual.get("personal_fijo") or 0) + int(manual.get("personal_eventual") or 0)
    except (TypeError, ValueError):
        total_personal = ""
    ET.SubElement(personal, "Total").text = str(total_personal)

    viajeros_perno = ET.SubElement(root, "ViajerosYPernoctaciones")
    total_viajeros = 0
    total_pernoctaciones = 0
    for fila in nacionalidades:
        residencia = ET.SubElement(viajeros_perno, "Residencia", {
            "pais": fila["pais"],
            "codigo": fila.get("codigo") or "",
        })
        ET.SubElement(residencia, "Viajeros").text = str(fila["viajeros"])
        ET.SubElement(residencia, "Pernoctaciones").text = str(fila["pernoctaciones"])
        total_viajeros += fila["viajeros"]
        total_pernoctaciones += fila["pernoctaciones"]

    totales = ET.SubElement(root, "Totales")
    ET.SubElement(totales, "ViajerosTotal").text = str(total_viajeros)
    ET.SubElement(totales, "PernoctacionesTotal").text = str(total_pernoctaciones)

    rough_string = ET.tostring(root, encoding="utf-8")
    pretty = minidom.parseString(rough_string).toprettyxml(indent="  ", encoding="UTF-8")

    comentario = (
        b"<!-- ESTRUCTURA PROVISIONAL: no se dispone del XSD oficial de la "
        b"encuesta EOH del INE en este despliegue. Este XML sigue los campos "
        b"conocidos del cuestionario pero NO ha sido validado contra el "
        b"esquema oficial. Validar antes de usar para un envio real. -->\n"
    )
    # Insertar el comentario justo despues de la declaracion XML.
    lines = pretty.split(b"\n", 1)
    return lines[0] + b"\n" + comentario + lines[1]
