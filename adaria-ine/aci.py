# -*- coding: utf-8 -*-
"""
Acceso de SOLO LECTURA al PMS ACI Dali (SQL Server / ACIGRUP) para el
Hotel Adaria Vera, usado por el módulo INE (encuesta EOH).

NUNCA se ejecuta ninguna escritura contra ACI desde este módulo. Todas las
consultas son SELECT sobre las tablas: Reservas, ReservaHuespedes,
Huespedes, Naciones y Habitaciones.
"""
import os
import calendar
from datetime import date

import pymssql

ACI_HOST = os.environ.get("ACI_HOST", "192.168.1.34")
ACI_PORT = int(os.environ.get("ACI_PORT", "1433"))
ACI_USER = os.environ.get("ACI_USER", "adaria_ro")
ACI_PASSWORD = os.environ.get("ACI_PASSWORD", "")
ACI_DATABASE = os.environ.get("ACI_DATABASE", "AdariaVeraHotel")


def get_connection():
    """Abre una conexión de solo lectura a ACI. El usuario adaria_ro no
    tiene permisos de escritura en el PMS, pero además esta capa nunca
    ejecuta INSERT/UPDATE/DELETE."""
    return pymssql.connect(
        server=ACI_HOST,
        port=ACI_PORT,
        user=ACI_USER,
        password=ACI_PASSWORD,
        database=ACI_DATABASE,
        login_timeout=10,
        timeout=30,
        as_dict=True,
    )


def month_bounds(anio: int, mes: int):
    """Devuelve (primer_dia, primer_dia_mes_siguiente) como date."""
    primer_dia = date(anio, mes, 1)
    ultimo_dia_num = calendar.monthrange(anio, mes)[1]
    if mes == 12:
        siguiente = date(anio + 1, 1, 1)
    else:
        siguiente = date(anio, mes + 1, 1)
    return primer_dia, siguiente, ultimo_dia_num


def get_habitaciones_disponibles():
    """Nº de habitaciones no obsoletas dadas de alta en ACI (referencia
    para el campo manual 'habitaciones disponibles')."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) AS n FROM Habitaciones "
            "WHERE HAB_OBSOLETA = 0 OR HAB_OBSOLETA IS NULL"
        )
        row = cur.fetchone()
        return int(row["n"]) if row else 0
    finally:
        conn.close()


# Pernoctaciones = suma de noches de cada huésped dentro del mes seleccionado
# (solape de [res_ent_dat, res_sal_dat) con [primer_dia, primer_dia_mes_siguiente)).
# Viajeros = huéspedes cuya fecha de ENTRADA cae dentro del mes seleccionado.
#
# ReservaHuespedes no está sistemáticamente poblada: para reservas sin fila
# en ReservaHuespedes se usa como único huésped el HUE_GUID titular de
# Reservas (comprobado: cuando ReservaHuespedes SÍ tiene filas, el titular
# ya está incluido entre ellas, así que no hay doble conteo).
_QUERY_NACIONALIDADES = """
WITH Guests AS (
    SELECT rh.RES_GUID, rh.HUE_GUID FROM ReservaHuespedes rh
    UNION
    SELECT r.RES_GUID, r.HUE_GUID FROM Reservas r
    WHERE NOT EXISTS (SELECT 1 FROM ReservaHuespedes rh2 WHERE rh2.RES_GUID = r.RES_GUID)
)
SELECT
    ISNULL(n.nac_des_str, 'SIN DETERMINAR') AS pais,
    n.nac_abr_str AS codigo,
    COUNT(CASE WHEN r.res_ent_dat >= %(ms)s AND r.res_ent_dat < %(me)s THEN 1 END) AS viajeros,
    SUM(CASE WHEN r.res_sal_dat > %(ms)s AND r.res_ent_dat < %(me)s
        THEN DATEDIFF(day,
               CASE WHEN r.res_ent_dat > %(ms)s THEN r.res_ent_dat ELSE %(ms)s END,
               CASE WHEN r.res_sal_dat < %(me)s THEN r.res_sal_dat ELSE %(me)s END)
        ELSE 0 END) AS pernoctaciones
FROM Guests g
JOIN Reservas r ON r.RES_GUID = g.RES_GUID
JOIN Huespedes h ON h.HUE_GUID = g.HUE_GUID
LEFT JOIN Naciones n ON n.NAC_GUID = h.NAC_GUID
WHERE r.res_anu_bln = 0
GROUP BY n.nac_des_str, n.nac_abr_str
HAVING COUNT(CASE WHEN r.res_ent_dat >= %(ms)s AND r.res_ent_dat < %(me)s THEN 1 END) > 0
    OR SUM(CASE WHEN r.res_sal_dat > %(ms)s AND r.res_ent_dat < %(me)s
        THEN DATEDIFF(day,
               CASE WHEN r.res_ent_dat > %(ms)s THEN r.res_ent_dat ELSE %(ms)s END,
               CASE WHEN r.res_sal_dat < %(me)s THEN r.res_sal_dat ELSE %(me)s END)
        ELSE 0 END) > 0
ORDER BY pernoctaciones DESC, viajeros DESC
"""


def get_pernoctaciones_por_nacionalidad(anio: int, mes: int):
    """Devuelve lista de dicts {pais, codigo, viajeros, pernoctaciones}
    para el mes indicado, y los totales agregados."""
    primer_dia, siguiente, _ = month_bounds(anio, mes)
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(_QUERY_NACIONALIDADES, {"ms": primer_dia, "me": siguiente})
        filas = cur.fetchall()
    finally:
        conn.close()

    resultado = []
    total_viajeros = 0
    total_pernoctaciones = 0
    for f in filas:
        viajeros = int(f["viajeros"] or 0)
        pernoctaciones = int(f["pernoctaciones"] or 0)
        total_viajeros += viajeros
        total_pernoctaciones += pernoctaciones
        resultado.append({
            "pais": f["pais"],
            "codigo": (f["codigo"] or "").strip(),
            "viajeros": viajeros,
            "pernoctaciones": pernoctaciones,
        })
    return {
        "filas": resultado,
        "total_viajeros": total_viajeros,
        "total_pernoctaciones": total_pernoctaciones,
    }
