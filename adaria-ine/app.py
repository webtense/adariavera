# -*- coding: utf-8 -*-
"""
Hotel Adaria Vera · INE — módulo de generación de la encuesta de
ocupación hotelera (EOH) para el INE, provincia de Almería (04).

Lee datos de solo lectura de ACI (Reservas/ReservaHuespedes/Huespedes/
Naciones/Habitaciones) para pernoctaciones y viajeros por nacionalidad,
combina con campos manuales (días abierto, plazas, personal) y genera
el XML EOH (estructura provisional, ver ine_xml.py).
"""
import os
import datetime

from flask import Flask, render_template, request, jsonify, Response
from dotenv import load_dotenv

load_dotenv()

import aci
import ine_xml

app = Flask(__name__)

APP_VERSION = "1.0.0"

# Nº de orden del establecimiento (identificador para el envío de la
# encuesta EOH al INE). Confirmado por dirección del hotel.
ESTABLECIMIENTO_NUM_ORDEN = os.environ.get("ESTABLECIMIENTO_NUM_ORDEN", "")


def _mes_actual():
    hoy = datetime.date.today()
    return hoy.year, hoy.month


@app.route("/")
def index():
    anio, mes = _mes_actual()
    mes_param = request.args.get("mes")  # formato YYYY-MM
    if mes_param:
        try:
            anio, mes = (int(x) for x in mes_param.split("-"))
        except ValueError:
            pass
    return render_template(
        "index.html",
        version=APP_VERSION,
        anio=anio,
        mes=mes,
        mes_valor=f"{anio:04d}-{mes:02d}",
        num_orden=ESTABLECIMIENTO_NUM_ORDEN,
    )


@app.route("/api/nacionalidades")
def api_nacionalidades():
    mes_param = request.args.get("mes", "")
    try:
        anio, mes = (int(x) for x in mes_param.split("-"))
    except (ValueError, AttributeError):
        return jsonify({"error": "Parámetro 'mes' inválido, formato esperado YYYY-MM"}), 400

    try:
        datos = aci.get_pernoctaciones_por_nacionalidad(anio, mes)
        datos["habitaciones_disponibles_aci"] = aci.get_habitaciones_disponibles()
        return jsonify(datos)
    except Exception as exc:  # noqa: BLE001 - se informa al front, no se escribe nada en ACI
        return jsonify({"error": f"Error consultando ACI: {exc}"}), 502


@app.route("/generar-xml", methods=["POST"])
def generar_xml():
    form = request.form
    mes_param = form.get("mes", "")
    try:
        anio, mes = (int(x) for x in mes_param.split("-"))
    except (ValueError, AttributeError):
        return jsonify({"error": "Parámetro 'mes' inválido"}), 400

    try:
        datos = aci.get_pernoctaciones_por_nacionalidad(anio, mes)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Error consultando ACI: {exc}"}), 502

    manual = {
        "establecimiento_nombre": form.get("establecimiento_nombre", "Hotel Adaria Vera"),
        "establecimiento_num_orden": ESTABLECIMIENTO_NUM_ORDEN,
        "dias_abierto": form.get("dias_abierto", ""),
        "plazas_disponibles": form.get("plazas_disponibles", ""),
        "habitaciones_disponibles": form.get("habitaciones_disponibles", ""),
        "personal_fijo": form.get("personal_fijo", ""),
        "personal_eventual": form.get("personal_eventual", ""),
    }

    xml_bytes = ine_xml.generar_xml_eoh(anio, mes, datos["filas"], manual)
    filename = f"EOH_AdariaVera_{anio:04d}{mes:02d}.xml"
    return Response(
        xml_bytes,
        mimetype="application/xml",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.route("/health")
def health():
    return jsonify({"status": "ok", "version": APP_VERSION})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3092"))
    app.run(host="0.0.0.0", port=port, debug=False)
