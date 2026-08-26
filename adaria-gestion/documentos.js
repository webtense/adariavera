'use strict';

// ─── Módulo: Escáner de documentos de identidad ───────────────────────────────
//
// Recepción escanea el DNI o el pasaporte con el móvil, se lee la banda MRZ en
// local (microservicio btr-mrz en 127.0.0.1:3095, sin salida a internet) y los
// datos completan la ficha del huésped en ACI Dali.
//
// El problema que resuelve: en el PMS, entre el 46% y el 69% de las fichas no
// tienen número de documento, y el 100% no tienen pasaporte. En las reservas
// vigentes hay 25.939 personas declaradas frente a 3.808 fichas de acompañante.
// Ver BTR_Proyectos/btr_mrz/FASE0_DESCUBRIMIENTO_ACI.md.
//
// Reparto de responsabilidades:
//   · lectura de ACI  → pool propio con `welcome_ro` (solo SELECT, DENY escritura)
//   · escritura en ACI→ `lib/aci-write.js`, ÚNICA ruta, usuario con GRANT por columna
//   · OCR             → btr-mrz, que no guarda la imagen ni sale a la red
//
// Uso:  require('./documentos').register(app, { pgPool, requireAuth, auditLog });

const express = require('express');
const sql = require('mssql');
const aciWrite = require('./lib/aci-write');

const MRZ_URL = process.env.MRZ_URL || 'http://127.0.0.1:3095';

// Mismo mapa que en aci-write: la BD del Siente se llama "Augusta", y [AS] es
// palabra reservada de T-SQL.
const HOTELES = [
  { key: 'siente',  db: 'Augusta', label: 'Siente Boí' },
  { key: 'romanic', db: 'HR',      label: 'Romànic'    },
  { key: 'taull',   db: 'HT',      label: 'Taüll'      },
  { key: 'solana',  db: 'AS',      label: 'Solana'     },
];
const DB_DE_HOTEL = Object.fromEntries(HOTELES.map((h) => [h.key, h.db]));

// Quién puede usar el módulo. Los admin del SSO siempre pueden.
// `recepcion` estaba en el default y NO existe como cuenta (ni en el SSO ni en
// Odoo): era un literal huérfano que, combinado con el antiguo fallback abierto de
// `hotelesPermitidos`, habría dado los cuatro hoteles a quien la creara. Se retira.
// `solana` sí falta: tiene la card asignada desde el 09/08 y recibía 403 al entrar.
const DOC_USERS = (process.env.DOC_USERS
  || 'siente,romanic,taull,solana,spa.sienteboi')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Qué hoteles ve cada cuenta de recepción. Romànic gestiona también Solana,
// igual que en el resto del portal.
const HOTELES_DE_USUARIO = {
  siente:  ['siente'],
  romanic: ['romanic', 'solana'],
  taull:   ['taull'],
  solana:  ['solana'],
  // `spa.sienteboi` ve la card del escáner y opera en el Siente.
  'spa.sienteboi': ['siente'],
};

// IMPORTANTE al dar de alta una cuenta nueva: añadirla AQUÍ además de a DOC_USERS.
// Desde el 10/08/2026 el mapa es la única fuente de verdad y lo que no está en él
// no ve ningún hotel.

// Edad a partir de la cual el registro de viajeros es obligatorio (RD 933/2021).
const EDAD_REGISTRO = 14;

// ─── Pool de LECTURA (welcome_ro) ────────────────────────────────────────────
// Propio del módulo, para no interferir con el de lib/aci.js. welcome_ro tiene
// SELECT en las 4 BD, así que basta un pool y se consulta con prefijo [BD].dbo.
const cfgLectura = {
  server:   process.env.ACI_HOST || '172.16.1.87',
  port:     parseInt(process.env.ACI_PORT || '1433', 10),
  user:     process.env.ACI_USER || 'welcome_ro',
  password: process.env.ACI_PASSWORD || '',
  database: process.env.ACI_DB || 'Augusta',
  options: { encrypt: false, trustServerCertificate: true,
             connectTimeout: 5000, requestTimeout: 20000 },
  pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
};
let poolLectura = null;
function getLectura() {
  if (!poolLectura) {
    poolLectura = sql.connect(cfgLectura).catch((e) => { poolLectura = null; throw e; });
  }
  return poolLectura;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function loginCorto(req) {
  return ((req.user && req.user.login) || '').toLowerCase().split('@')[0];
}
function esAdmin(req) {
  return !!req.user && req.user.rol === 'admin';
}
function puedeUsar(req) {
  if (!req.user) return false;
  return esAdmin(req) || DOC_USERS.includes(loginCorto(req));
}
function hotelesPermitidos(req) {
  if (esAdmin(req)) return HOTELES.map((h) => h.key);
  // Sin entrada en el mapa NO se concede nada. Antes el fallback devolvía los
  // CUATRO hoteles, así que cualquier cuenta añadida a DOC_USERS sin tocar este
  // mapa habría obtenido acceso a las cuatro bases del PMS sin que nada avisara —
  // justo lo contrario de la separación por hotel que el portal exige por RGPD.
  // Que un usuario nuevo no vea nada se detecta el primer día; que lo vea todo,
  // puede no detectarse nunca.
  return HOTELES_DE_USUARIO[loginCorto(req)] || [];
}
/**
 * Comprueba que la persona sobre la que se va a escribir pertenece DE VERDAD a la
 * reserva indicada, y que esa reserva es del hotel y no está anulada.
 *
 * Antes no se comprobaba: `hueGuid` y `racGuid` llegaban del cuerpo de la petición y
 * se pasaban tal cual a la capa de escritura, que filtra solo por clave primaria. El
 * alcance real no era la reserva que se estaba atendiendo, sino la tabla `HuespedK`
 * completa del hotel — cientos de miles de fichas históricas. Con `forzar` se podía
 * sobrescribir la identidad de cualquiera de ellas, y devolviendo los conflictos se
 * podía leer el documento y el domicilio reales de cualquier ficha.
 *
 * El GRANT por columna del usuario SQL limita QUÉ columnas, no QUÉ filas: esta
 * comprobación es la única que ata la escritura a la reserva atendida.
 *
 * Devuelve `{ ok: true, hueGuid }` con el hueGuid REAL de la reserva (el del cliente
 * se usa solo para contrastar, nunca como fuente), o `{ ok: false, motivo }`.
 */
async function validarPertenencia(hotel, { resGuid, hueGuid, racGuid, alta }) {
  const res = parseInt(resGuid, 10);
  if (!Number.isInteger(res) || res <= 0) {
    return { ok: false, motivo: 'falta la reserva (resGuid) a la que pertenece la persona' };
  }
  const db = dbDe(hotel);
  const pool = await getLectura();

  const rr = await pool.request().input('res', sql.Int, res).query(`
    SELECT TOP 1 r.RES_GUID AS resGuid, r.HUE_GUID AS hueGuid
    FROM [${db}].dbo.Reservas r
    WHERE r.RES_GUID = @res AND r.res_anu_bln = 0`);
  if (!rr.recordset.length) {
    return { ok: false, motivo: 'la reserva no existe en este hotel, o está anulada' };
  }
  const reserva = rr.recordset[0];

  // Acompañante existente: la fila tiene que estar en ESTA reserva.
  if (racGuid !== null && racGuid !== undefined) {
    const rac = parseInt(racGuid, 10);
    const ra = await pool.request()
      .input('res', sql.Int, res).input('rac', sql.Int, rac).query(`
        SELECT TOP 1 RAC_GUID FROM [${db}].dbo.ReservaAcompanantes
        WHERE RES_GUID = @res AND RAC_GUID = @rac`);
    if (!ra.recordset.length) {
      return { ok: false, motivo: 'ese acompañante no pertenece a la reserva indicada' };
    }
    return { ok: true, resGuid: res };
  }

  // Alta de acompañante: basta que la reserva sea válida (el cupo lo valida aciWrite).
  if (alta === true) return { ok: true, resGuid: res };

  // Titular: el hueGuid se toma de la RESERVA, no del cliente. Si el cliente manda
  // uno distinto se rechaza en vez de corregirlo en silencio: significa que la
  // pantalla está desincronizada o que alguien está probando otra ficha.
  const hue = parseInt(hueGuid, 10);
  if (!Number.isInteger(hue) || hue <= 0) {
    return { ok: false, motivo: 'falta la persona (hueGuid)' };
  }
  if (reserva.hueGuid !== hue) {
    return { ok: false,
             motivo: 'la ficha indicada no es la del titular de esa reserva' };
  }
  return { ok: true, resGuid: res, hueGuid: reserva.hueGuid };
}

/**
 * Hoteles de una cuenta de recepción, para que otros módulos usen EL MISMO mapa.
 *
 * Se expone una función y no el objeto para que nadie pueda mutarlo desde fuera, y
 * para que exista una sola fuente de verdad: dos mapas equivalentes en dos módulos
 * acaban desincronizándose y uno de los dos se queda abierto.
 */
function hotelesDeLogin(login) {
  return (HOTELES_DE_USUARIO[String(login || '').trim().toLowerCase()] || []).slice();
}

// El nombre de BD SIEMPRE sale de este allow-list, nunca de la petición.
function dbDe(hotelKey) {
  const db = DB_DE_HOTEL[String(hotelKey || '').trim().toLowerCase()];
  if (!db) throw new Error('hotel no válido');
  return db;
}
function limpiar(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}
function tieneDoc(v) {
  return limpiar(v) !== '';
}
function edadDe(fecha, edadInt) {
  // La fecha de nacimiento manda: es un dato, no una estimación.
  const porFecha = aciWrite.edadDesde(fecha);
  if (porFecha !== null) return porFecha;

  // `hue_eda_int` a 0 NO significa "recién nacido": es el valor por defecto de
  // las fichas sin informar. Tomarlo por bueno marcaba a adultos como menores de
  // 14 y los sacaba de la lista de pendientes, que es justo lo contrario de lo
  // que interesa. Solo se acepta una edad positiva.
  if (edadInt !== null && edadInt !== undefined && edadInt !== '') {
    const n = parseInt(edadInt, 10);
    if (!Number.isNaN(n) && n > 0 && n <= 120) return n;
  }
  return null;   // edad desconocida → se tratará como pendiente, no como menor
}
// Estado de una persona para la lista: qué le falta y si le aplica.
function estadoPersona({ documento, fechaNac, edadInt }) {
  const edad = edadDe(fechaNac, edadInt);
  if (tieneDoc(documento)) return { estado: 'ok', edad };
  // Los menores de 14 no requieren registro individual: marcarlos como
  // pendientes llenaría la lista de falsos avisos y recepción dejaría de mirarla.
  if (edad !== null && edad < EDAD_REGISTRO) return { estado: 'no_aplica', edad };
  if (edad === null) return { estado: 'pendiente', edad, edadDesconocida: true };
  return { estado: 'pendiente', edad };
}

// ─── Esquema ─────────────────────────────────────────────────────────────────
async function ensureSchema(pgPool) {
  // Copia previa de cada fila de ACI antes de modificarla. Es lo que permite
  // deshacer una escritura concreta sin restaurar la base entera.
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS doc_aci_backup (
      id           BIGSERIAL PRIMARY KEY,
      hotel        VARCHAR(20) NOT NULL,
      tabla        VARCHAR(40) NOT NULL,
      clave        JSONB       NOT NULL,
      fila_previa  JSONB,                  -- NULL = la fila no existía (alta)
      usuario      VARCHAR(80),
      creado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query(
    `CREATE INDEX IF NOT EXISTS idx_doc_backup_clave ON doc_aci_backup (hotel, tabla, creado_at DESC);`);

  // Registro de escaneos. Sin datos personales en claro: del documento solo se
  // guarda un hash, suficiente para contar y detectar repeticiones.
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS doc_escaneo (
      id            BIGSERIAL PRIMARY KEY,
      hotel         VARCHAR(20) NOT NULL,
      res_guid      INTEGER,
      hue_guid      INTEGER,
      rac_guid      INTEGER,
      formato       VARCHAR(10),            -- TD1 | TD2 | TD3
      tipo          VARCHAR(20),            -- DNI | PASAPORTE | TIE ...
      doc_hash      VARCHAR(64),            -- SHA-256, nunca el número en claro
      valido        BOOLEAN,
      confianza     VARCHAR(10),
      escrito       BOOLEAN     NOT NULL DEFAULT FALSE,
      simulado      BOOLEAN     NOT NULL DEFAULT FALSE,
      ms            INTEGER,
      usuario       VARCHAR(80),
      creado_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query(
    `CREATE INDEX IF NOT EXISTS idx_doc_escaneo_fecha ON doc_escaneo (creado_at DESC);`);

  // Código postal → población. El DNI español NO imprime el código postal, así
  // que hay que teclearlo; pero con 5 dígitos se puede autocompletar población y
  // provincia. La tabla se construye con el histórico del propio ACI (2.790 CP
  // distintos sobre 30.795 fichas), de modo que los nombres de municipio son
  // exactamente los que ya usa la casa y no se crean duplicados.
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS doc_cp_poblacion (
      cp          VARCHAR(5)  PRIMARY KEY,
      poblacion   VARCHAR(50),                     -- del histórico; NULL si no consta
      provincia   VARCHAR(50),                     -- oficial, por los 2 primeros dígitos
      apariciones INTEGER     NOT NULL DEFAULT 0,
      dominancia  SMALLINT    NOT NULL DEFAULT 0,  -- % del CP que apunta a esa población
      oficial     BOOLEAN     NOT NULL DEFAULT FALSE, -- consta en INEMunicipios
      creado_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Migración idempotente para instalaciones anteriores.
  await pgPool.query(
    `ALTER TABLE doc_cp_poblacion ADD COLUMN IF NOT EXISTS oficial BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pgPool.query(
    `ALTER TABLE doc_cp_poblacion ALTER COLUMN poblacion DROP NOT NULL;`).catch(() => {});
  console.log(`[documentos] Esquema listo · dry-run=${aciWrite.DRY_RUN} · alta-acompanantes=${aciWrite.PERMITIR_ALTA}`);
}

// ─── Consultas de lectura a ACI ──────────────────────────────────────────────

// Entradas de una fecha, con el estado de documentación de cada reserva. Es la
// pantalla de arranque: en el mostrador la reserva casi siempre es una de hoy.
function qEntradas(db) {
  return `
    SELECT TOP 200
      r.RES_GUID                       AS resGuid,
      LTRIM(RTRIM(r.RES_COD_str))      AS codigo,
      LTRIM(RTRIM(hab.hab_cod_str))    AS habitacion,
      r.HUE_GUID                       AS hueGuid,
      LTRIM(RTRIM(ISNULL(h.hue_des_str,''))) AS nombre,
      LTRIM(RTRIM(ISNULL(h.hue_co1_str,''))) AS apellido1,
      LTRIM(RTRIM(ISNULL(h.hue_co2_str,''))) AS apellido2,
      (ISNULL(r.res_spe_adu_int,0) + ISNULL(r.res_spe_nin_int,0)
       + ISNULL(r.res_spe_cun_int,0)) AS pax,
      LTRIM(RTRIM(ISNULL(ag.age_nom_str,''))) AS canal,
      k.hue_nif_str                    AS docTitular,
      k.hue_dni_fna_dat                AS fnacTitular,
      k.hue_eda_int                    AS edadTitular,
      (SELECT COUNT(*) FROM [${db}].dbo.ReservaAcompanantes ra
        WHERE ra.RES_GUID = r.RES_GUID)                                AS acompFilas,
      (SELECT COUNT(*) FROM [${db}].dbo.ReservaAcompanantes ra
        WHERE ra.RES_GUID = r.RES_GUID
          AND LTRIM(RTRIM(ISNULL(ra.rac_nif_str,''))) <> '')           AS acompConDoc
    FROM [${db}].dbo.Reservas r
      LEFT JOIN [${db}].dbo.Huespedes    h   ON h.HUE_GUID   = r.HUE_GUID
      LEFT JOIN [${db}].dbo.HuespedK     k   ON k.HUE_GUID   = r.HUE_GUID
      LEFT JOIN [${db}].dbo.Habitaciones hab ON hab.HAB_GUID = r.HAB_GUID
      LEFT JOIN [${db}].dbo.Agencias     ag  ON ag.AGE_GUID  = r.AGE_GUID
    WHERE r.res_anu_bln = 0
      AND CAST(r.res_ent_dat AS DATE) = @fecha
    ORDER BY hab.hab_cod_str`;
}

// Búsqueda por código de reserva o apellido, entre las reservas vigentes.
function qBuscar(db) {
  return `
    SELECT TOP 25
      r.RES_GUID AS resGuid, LTRIM(RTRIM(r.RES_COD_str)) AS codigo,
      LTRIM(RTRIM(hab.hab_cod_str)) AS habitacion, r.HUE_GUID AS hueGuid,
      LTRIM(RTRIM(ISNULL(h.hue_des_str,''))) AS nombre,
      LTRIM(RTRIM(ISNULL(h.hue_co1_str,''))) AS apellido1,
      LTRIM(RTRIM(ISNULL(h.hue_co2_str,''))) AS apellido2,
      (ISNULL(r.res_spe_adu_int,0) + ISNULL(r.res_spe_nin_int,0)
       + ISNULL(r.res_spe_cun_int,0)) AS pax,
      CONVERT(varchar(10), r.res_ent_dat, 23) AS entrada,
      CONVERT(varchar(10), r.res_sal_dat, 23) AS salida,
      LTRIM(RTRIM(ISNULL(ag.age_nom_str,''))) AS canal
    FROM [${db}].dbo.Reservas r
      LEFT JOIN [${db}].dbo.Huespedes    h   ON h.HUE_GUID   = r.HUE_GUID
      LEFT JOIN [${db}].dbo.Habitaciones hab ON hab.HAB_GUID = r.HAB_GUID
      LEFT JOIN [${db}].dbo.Agencias     ag  ON ag.AGE_GUID  = r.AGE_GUID
    WHERE r.res_anu_bln = 0
      AND r.res_sal_dat >= CAST(GETDATE() AS DATE)
      AND (
        (@codigo <> '' AND LTRIM(RTRIM(r.RES_COD_str)) = @codigo)
        OR (@ape <> '' AND (UPPER(ISNULL(h.hue_co1_str,'')) LIKE @apeLike
                        OR UPPER(ISNULL(h.hue_des_str,'')) LIKE @apeLike))
        OR (@hab <> '' AND LTRIM(RTRIM(hab.hab_cod_str)) = @hab)
      )
    ORDER BY r.res_ent_dat`;
}

// Titular de una reserva, con lo que ya tiene en la ficha.
function qTitular(db) {
  return `
    SELECT
      r.RES_GUID AS resGuid, r.HUE_GUID AS hueGuid,
      LTRIM(RTRIM(r.RES_COD_str)) AS codigo,
      LTRIM(RTRIM(hab.hab_cod_str)) AS habitacion,
      CONVERT(varchar(10), r.res_ent_dat, 23) AS entrada,
      CONVERT(varchar(10), r.res_sal_dat, 23) AS salida,
      (ISNULL(r.res_spe_adu_int,0) + ISNULL(r.res_spe_nin_int,0)
       + ISNULL(r.res_spe_cun_int,0)) AS pax,
      ISNULL(r.res_spe_adu_int,0) AS adultos,
      (ISNULL(r.res_spe_nin_int,0) + ISNULL(r.res_spe_cun_int,0)) AS ninos,
      LTRIM(RTRIM(ISNULL(ag.age_nom_str,''))) AS canal,
      LTRIM(RTRIM(ISNULL(h.hue_des_str,''))) AS nombre,
      LTRIM(RTRIM(ISNULL(h.hue_co1_str,''))) AS apellido1,
      LTRIM(RTRIM(ISNULL(h.hue_co2_str,''))) AS apellido2,
      k.hue_nif_str AS documento, k.hue_dni_fna_dat AS fechaNacimiento,
      k.hue_sex_bln AS sexo, k.hue_eda_int AS edad, k.TPD_GUID AS tpdGuid,
      k.hue_cp_str AS cp, k.hue_pob_str AS poblacion,
      k.hue_prv_str AS provincia, k.hue_dom_str AS domicilio,
      LTRIM(RTRIM(ISNULL(td.tpd_des_str,''))) AS tipoDoc,
      LTRIM(RTRIM(ISNULL(na.nac_des_str,''))) AS nacionalidadDoc
    FROM [${db}].dbo.Reservas r
      LEFT JOIN [${db}].dbo.Huespedes      h   ON h.HUE_GUID   = r.HUE_GUID
      LEFT JOIN [${db}].dbo.HuespedK       k   ON k.HUE_GUID   = r.HUE_GUID
      LEFT JOIN [${db}].dbo.Habitaciones   hab ON hab.HAB_GUID = r.HAB_GUID
      LEFT JOIN [${db}].dbo.Agencias       ag  ON ag.AGE_GUID  = r.AGE_GUID
      LEFT JOIN [${db}].dbo.TiposDocumento td  ON td.TPD_GUID  = k.TPD_GUID
      LEFT JOIN [${db}].dbo.Naciones       na  ON na.NAC_GUID  = k.NAC_DOC_GUID
    WHERE r.RES_GUID = @res`;
}

function qAcompanantes(db) {
  return `
    SELECT
      ra.RAC_GUID AS racGuid,
      LTRIM(RTRIM(ISNULL(ra.rac_nom_str,''))) AS nombre,
      LTRIM(RTRIM(ISNULL(ra.rac_co1_str,''))) AS apellido1,
      LTRIM(RTRIM(ISNULL(ra.rac_co2_str,''))) AS apellido2,
      ra.rac_nif_str AS documento, ra.rac_fna_dat AS fechaNacimiento,
      ra.rac_sex_bln AS sexo, ra.rac_eda_int AS edad,
      LTRIM(RTRIM(ISNULL(td.tpd_des_str,''))) AS tipoDoc
    FROM [${db}].dbo.ReservaAcompanantes ra
      LEFT JOIN [${db}].dbo.TiposDocumento td ON td.TPD_GUID = ra.TPD_GUID
    WHERE ra.RES_GUID = @res
    ORDER BY ra.RAC_GUID`;
}

// Extrae de ACI los pares código postal → población más frecuentes. Se queda con
// la población dominante de cada CP y guarda el porcentaje, para poder avisar
// cuando la sugerencia es dudosa (un CP de una gran ciudad puede repartirse).
function qCodigosPostales(db) {
  return `
    WITH pares AS (
      SELECT LTRIM(RTRIM(k.hue_cp_str))          AS cp,
             UPPER(LTRIM(RTRIM(k.hue_pob_str)))  AS poblacion,
             UPPER(LTRIM(RTRIM(ISNULL(k.hue_prv_str,'')))) AS provincia,
             COUNT(*) AS veces
      FROM [${db}].dbo.HuespedK k
      WHERE LEN(LTRIM(RTRIM(ISNULL(k.hue_cp_str,'')))) = 5
        AND LTRIM(RTRIM(k.hue_cp_str)) NOT LIKE '%[^0-9]%'
        AND LEN(LTRIM(RTRIM(ISNULL(k.hue_pob_str,'')))) >= 3
      GROUP BY LTRIM(RTRIM(k.hue_cp_str)), UPPER(LTRIM(RTRIM(k.hue_pob_str))),
               UPPER(LTRIM(RTRIM(ISNULL(k.hue_prv_str,''))))
    ), ranking AS (
      SELECT cp, poblacion, provincia, veces,
             SUM(veces) OVER (PARTITION BY cp) AS total,
             ROW_NUMBER() OVER (PARTITION BY cp ORDER BY veces DESC) AS pos
      FROM pares
    )
    SELECT cp, poblacion, NULLIF(provincia,'') AS provincia, veces, total
    FROM ranking WHERE pos = 1`;
}

// Catálogo OFICIAL de códigos postales que ACI ya tiene: `INEMunicipios` mapea
// código postal → código de municipio del INE (10.683 CP, de 01001 a 52006), y la
// provincia se obtiene de los dos primeros dígitos contra la tabla `Provincias`.
//
// Ojo con los nombres de las columnas, que engañan: `mun_cod_str` es el CÓDIGO
// POSTAL y `mun_cp_str` el código de municipio del INE. `mun_dc_str` no es una
// descripción sino un dígito de control, y la tabla `Poblaciones` está vacía: los
// nombres de municipio no están aquí, siguen viniendo del histórico.
function qCodigosPostalesOficiales(db) {
  return `
    SELECT DISTINCT m.mun_cod_str AS cp, pr.prv_des_str AS provincia
    FROM [${db}].dbo.INEMunicipios m
    LEFT JOIN [${db}].dbo.Provincias pr
           ON pr.PRV_COD_str = LEFT(m.mun_cod_str, 2)
    WHERE LEN(LTRIM(RTRIM(ISNULL(m.mun_cod_str,'')))) = 5
      AND m.mun_cod_str NOT LIKE '%[^0-9]%'`;
}

// ─── Validación de un municipio contra el catálogo de ACI ────────────────────
//
// Es lo que hace utilizable la lectura del domicilio. Ese texto del DNI no tiene
// dígitos de control, así que por sí solo no se puede dar por bueno; pero el
// municipio SÍ se puede contrastar con los 5.182 códigos postales extraídos del
// histórico de ACI. Si lo que ha leído el OCR no casa con ningún municipio real,
// se descarta; si casa, se sustituye por el nombre canónico de la casa y encima
// se obtiene el código postal, que el DNI no imprime.
//
// El efecto práctico: una lectura basura ('pes', 'AESPSESPBIJIZ1O') se cae sola,
// y una parcial ('HOSPITALET DE') se completa.

function distancia(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const fila = [i];
    for (let j = 1; j <= n; j++) {
      fila[j] = Math.min(prev[j] + 1, fila[j - 1] + 1,
                         prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = fila;
  }
  return prev[n];
}

function sinTildes(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Catálogo en memoria: 5.182 filas es trivial y evita depender de pg_trgm.
let catalogoMunicipios = null;
async function municipios(pgPool) {
  if (catalogoMunicipios) return catalogoMunicipios;
  // `oficial` y `apariciones` entran en el catálogo porque hacen falta para elegir
  // bien. Antes se desempataba solo por `dominancia`, y eso daba el CP equivocado:
  // la dominancia es el porcentaje de veces que ese CP corresponde a esa población,
  // así que un CP visto UNA vez tiene el 100% y ganaba a los ocho CP reales de
  // L'Hospitalet. Para esa población devolvía 08097 (4 apariciones, no oficial) en
  // lugar de 08901.
  const r = await pgPool.query(
    `SELECT cp, poblacion, provincia, dominancia, apariciones, oficial
     FROM doc_cp_poblacion`);
  catalogoMunicipios = r.rows.map((f) => ({ ...f, clave: sinTildes(f.poblacion) }));
  return catalogoMunicipios;
}

/**
 * Normaliza el nombre de un municipio para poder compararlo.
 *
 * En el histórico de ACI el mismo municipio aparece escrito de varias formas:
 * «L´HOSPITALET DE LLOBREGAT» (con acento agudo suelto, no apóstrofo), «HOSPITALET
 * DE LLOBREGAT», «EL PRAT DE LLOBREGAT» y «PRAT DE LLOBREGAT». Se quitan los
 * apóstrofos en todas sus variantes y el artículo inicial, que es lo que impide que
 * casen entre sí.
 */
function claveMunicipio(texto) {
  let t = sinTildes(texto).replace(/[´`'’‘]/g, ' ');
  t = t.replace(/^(L|EL|LA|LES|LOS|LAS|A|O|AS|OS)\s+/, '');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Resuelve provincia y código postal a partir del NOMBRE de la población.
 *
 * Es el camino inverso al que ya existía. Hasta ahora solo se podía ir de código
 * postal a población, pero el reverso del DNI trae la población y NO el código
 * postal —el DNI español no lo imprime—, así que recepción se quedaba con la
 * población y tenía que buscar el resto a mano.
 *
 * Sobre los datos: de 2.612 municipios con registro oficial, 2.503 tienen una sola
 * provincia (96%) y 2.276 un solo código postal (87%). Cuando hay varios códigos no
 * se elige uno: se devuelven todos para que recepción toque el que toca. Inventar un
 * código postal es peor que dejarlo vacío, porque nadie lo revisaría.
 */
async function resolverPoblacion(pgPool, nombre) {
  const clave = claveMunicipio(nombre || '');
  if (clave.length < 4) return null;
  const lista = await municipios(pgPool);

  // Coincidencia exacta de nombre normalizado. NO vale una búsqueda parcial:
  // «Hospitalet» casaría también con «L´Hospitalet de l´Infant», que es Tarragona.
  let filas = lista.filter((m) => claveMunicipio(m.poblacion) === clave);

  // Si no hay exacta, se admite la difusa que ya se usaba, pero exigiendo más
  // parecido que en la lectura por OCR: aquí el nombre lo ha teclado una persona.
  if (!filas.length) {
    const aprox = await buscarMunicipio(pgPool, nombre);
    if (!aprox || aprox.sim < 0.86) return null;
    const claveAprox = claveMunicipio(aprox.poblacion);
    filas = lista.filter((m) => claveMunicipio(m.poblacion) === claveAprox);
  }
  if (!filas.length) return null;

  // Los oficiales mandan; entre ellos, los más vistos primero.
  const oficiales = filas.filter((m) => m.oficial);
  const base = oficiales.length ? oficiales : filas;
  base.sort((a, b) => (b.apariciones || 0) - (a.apariciones || 0));

  // La provincia se decide por PESO, no por unanimidad. Se probó exigiendo que
  // todos los registros coincidieran y era inservible: el histórico tiene ruido de
  // tecleo y salían «Reus → Tarragona o Toledo» y «Madrid → Madrid, Jaén, Ávila,
  // Guadalajara…». Sumando apariciones, la provincia de verdad se lleva casi todo y
  // el ruido queda en una o dos, así que basta pedir que la primera tenga el 80%.
  const pesoProvincia = new Map();
  for (const m of base) {
    const pr = (m.provincia || '').trim();
    if (!pr) continue;
    pesoProvincia.set(pr, (pesoProvincia.get(pr) || 0) + (m.apariciones || 1));
  }
  const ranking = [...pesoProvincia.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranking.reduce((acc, [, n]) => acc + n, 0);
  const dominante = ranking.length ? ranking[0][0] : null;
  const cuota = total > 0 && ranking.length ? ranking[0][1] / total : 0;
  const provinciaFiable = ranking.length === 1 || cuota >= 0.8;

  // Los códigos postales que no son de la provincia dominante son ruido del mismo
  // tecleo: se descartan. Para «Reus» esto quita el 45515, que es de Toledo.
  const deLaProvincia = provinciaFiable
    ? base.filter((m) => (m.provincia || '').trim() === dominante)
    : base;
  const cps = [...new Set(deLaProvincia.map((m) => m.cp))];

  return {
    poblacion: (deLaProvincia[0] || base[0]).poblacion,
    provincia: provinciaFiable ? dominante : null,
    provincias_posibles: provinciaFiable ? null : ranking.map(([pr]) => pr),
    // La cuota se devuelve para poder avisar cuando la provincia no es unánime.
    provincia_cuota: Math.round(cuota * 100),
    cp: cps.length === 1 ? cps[0] : null,
    cps_posibles: cps.length > 1 ? cps.slice(0, 12) : null,
    oficial: Boolean(oficiales.length),
  };
}

/**
 * Busca el municipio real que mejor encaja con un texto leído por OCR.
 * Devuelve null si nada se parece lo suficiente — que es la respuesta correcta
 * ante una lectura ilegible.
 */
async function buscarMunicipio(pgPool, texto) {
  const q = sinTildes(texto);
  if (q.length < 4) return null;         // demasiado corto para ser fiable
  const lista = await municipios(pgPool);

  let mejor = null;
  for (const m of lista) {
    let sim;
    if (m.clave === q) {
      sim = 1;
    } else if (m.clave.startsWith(q) || q.startsWith(m.clave)) {
      // Lectura truncada: 'HOSPITALET DE' contra 'HOSPITALET DE LLOBREGAT'.
      // Se penaliza según lo que falte, para no aceptar prefijos de 4 letras.
      sim = 0.75 + 0.25 * (Math.min(q.length, m.clave.length)
                           / Math.max(q.length, m.clave.length));
    } else {
      sim = 1 - distancia(q, m.clave) / Math.max(q.length, m.clave.length);
    }
    // A igualdad de parecido: primero el registro OFICIAL, después el más visto en
    // el histórico. Antes se desempataba por `dominancia` y salía el CP equivocado,
    // porque un código postal visto una sola vez tiene el 100% de dominancia.
    const mejora = !mejor || sim > mejor.sim || (sim === mejor.sim && (
      (m.oficial ? 1 : 0) > (mejor.oficial ? 1 : 0)
      || ((m.oficial ? 1 : 0) === (mejor.oficial ? 1 : 0)
          && (m.apariciones || 0) > (mejor.apariciones || 0))));
    if (mejora) {
      mejor = { ...m, sim };
    }
  }
  return mejor && mejor.sim >= 0.72 ? mejor : null;
}

// ─── Rutas ───────────────────────────────────────────────────────────────────
function register(app, { pgPool, requireAuth, auditLog }) {
  // La foto viaja como binario crudo, NO como JSON: el `express.json()` global
  // del portal (límite 100 kB) se aplica antes que cualquier parser de ruta y
  // devolvía 413 sin que la imagen llegara nunca. Con octet-stream el parser
  // global la ignora, no hay que subir el límite global —que afectaría a todos
  // los módulos— y además se ahorra el 33% de peso del base64.
  const imagenBinaria = express.raw({ type: 'application/octet-stream',
                                      limit: '12mb' });

  const requireUso = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!puedeUsar(req)) {
      return res.status(403).json({ error: 'Sin acceso al escáner de documentos' });
    }
    next();
  };
  const compruebaHotel = (req, res) => {
    const hotel = String(req.query.hotel || req.body?.hotel || '').toLowerCase();
    if (!DB_DE_HOTEL[hotel]) {
      res.status(400).json({ error: 'Hotel no válido' });
      return null;
    }
    if (!hotelesPermitidos(req).includes(hotel)) {
      res.status(403).json({ error: 'Sin acceso a ese hotel' });
      return null;
    }
    return hotel;
  };
  const crypto = require('crypto');
  const hashDoc = (n) => n
    ? crypto.createHash('sha256').update(String(n).toUpperCase()).digest('hex')
    : null;

  // ── Estado del módulo: qué hoteles, si está en simulación, y salud del OCR ──
  app.get('/api/doc/estado', requireAuth, requireUso, async (req, res) => {
    let mrz = { ok: false };
    try {
      const r = await fetch(`${MRZ_URL}/salud`, { signal: AbortSignal.timeout(4000) });
      mrz = await r.json();
    } catch (e) {
      mrz = { ok: false, error: e.message };
    }
    let cpCargados = 0;
    try {
      const r = await pgPool.query('SELECT COUNT(*)::int AS n FROM doc_cp_poblacion');
      cpCargados = r.rows[0].n;
    } catch (e) { /* la tabla puede estar aún vacía */ }

    res.json({
      hoteles: HOTELES.filter((h) => hotelesPermitidos(req).includes(h.key))
        .map(({ key, label }) => ({ key, label })),
      codigosPostales: cpCargados,
      simulacion: aciWrite.DRY_RUN,
      hotelesEscritura: aciWrite.HOTELES_ESCRITURA,
      altaAcompanantes: aciWrite.PERMITIR_ALTA,
      edadRegistro: EDAD_REGISTRO,
      ocr: mrz,
    });
  });

  // ── Entradas del día ───────────────────────────────────────────────────────
  app.get('/api/doc/entradas', requireAuth, requireUso, async (req, res) => {
    const hotel = compruebaHotel(req, res);
    if (!hotel) return;
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '')
      ? req.query.fecha : new Date().toISOString().slice(0, 10);
    try {
      const pool = await getLectura();
      const r = await pool.request()
        .input('fecha', sql.Date, fecha)
        .query(qEntradas(dbDe(hotel)));
      const reservas = r.recordset.map((f) => {
        const titular = estadoPersona({
          documento: f.docTitular, fechaNac: f.fnacTitular, edadInt: f.edadTitular });
        // Pendientes = pax declarados menos quienes ya tienen documento.
        // Es una estimación: los acompañantes sin ficha no se pueden contar uno a uno.
        const conDoc = (titular.estado === 'ok' ? 1 : 0) + (f.acompConDoc || 0);
        return {
          resGuid: f.resGuid, codigo: f.codigo, habitacion: f.habitacion,
          hueGuid: f.hueGuid,
          titular: [f.nombre, f.apellido1, f.apellido2].filter(Boolean).join(' '),
          pax: f.pax, canal: f.canal,
          titularEstado: titular.estado,
          acompFilas: f.acompFilas, acompConDoc: f.acompConDoc,
          documentados: conDoc,
          completa: conDoc >= (f.pax || 1),
        };
      });
      res.json({ hotel, fecha, reservas, total: reservas.length });
    } catch (e) {
      console.error('[documentos] entradas:', e.message);
      res.status(503).json({ error: 'ACI no disponible', detalle: e.message });
    }
  });

  // ── Búsqueda de reserva ────────────────────────────────────────────────────
  app.get('/api/doc/buscar', requireAuth, requireUso, async (req, res) => {
    const hotel = compruebaHotel(req, res);
    if (!hotel) return;
    const q = limpiar(req.query.q).slice(0, 40);
    if (q.length < 2) return res.status(400).json({ error: 'Búsqueda demasiado corta' });
    // Un valor de 4+ dígitos se prueba como código y como habitación.
    const esNumero = /^\d+$/.test(q);
    try {
      const pool = await getLectura();
      const r = await pool.request()
        .input('codigo',  sql.VarChar, esNumero ? q : '')
        .input('hab',     sql.VarChar, esNumero ? q : '')
        .input('ape',     sql.NVarChar, esNumero ? '' : q)
        .input('apeLike', sql.NVarChar, esNumero ? '' : `%${q.toUpperCase()}%`)
        .query(qBuscar(dbDe(hotel)));
      res.json({
        hotel,
        resultados: r.recordset.map((f) => ({
          resGuid: f.resGuid, codigo: f.codigo, habitacion: f.habitacion,
          hueGuid: f.hueGuid,
          titular: [f.nombre, f.apellido1, f.apellido2].filter(Boolean).join(' '),
          pax: f.pax, entrada: f.entrada, salida: f.salida, canal: f.canal,
        })),
      });
    } catch (e) {
      console.error('[documentos] buscar:', e.message);
      res.status(503).json({ error: 'ACI no disponible', detalle: e.message });
    }
  });

  // ── Personas de una reserva, con qué le falta a cada una ───────────────────
  app.get('/api/doc/reserva', requireAuth, requireUso, async (req, res) => {
    const hotel = compruebaHotel(req, res);
    if (!hotel) return;
    const resGuid = parseInt(req.query.resGuid, 10);
    if (!Number.isInteger(resGuid)) {
      return res.status(400).json({ error: 'resGuid no válido' });
    }
    try {
      const db = dbDe(hotel);
      const pool = await getLectura();
      const [t, a] = await Promise.all([
        pool.request().input('res', sql.Int, resGuid).query(qTitular(db)),
        pool.request().input('res', sql.Int, resGuid).query(qAcompanantes(db)),
      ]);
      const cab = t.recordset[0];
      if (!cab) return res.status(404).json({ error: 'Reserva no encontrada' });

      const personas = [{
        rol: 'titular', hueGuid: cab.hueGuid, racGuid: null,
        nombre: cab.nombre, apellido1: cab.apellido1, apellido2: cab.apellido2,
        documento: limpiar(cab.documento) || null, tipoDoc: cab.tipoDoc || null,
        fechaNacimiento: cab.fechaNacimiento
          ? new Date(cab.fechaNacimiento).toISOString().slice(0, 10) : null,
        // 1 = hombre, 0 = mujer (verificado en fase 0).
        sexo: cab.sexo === null ? null : (cab.sexo ? 'M' : 'F'),
        nacionalidadDoc: cab.nacionalidadDoc || null,
        // Dirección que ya tenga la ficha: si está, no se vuelve a pedir.
        cp: limpiar(cab.cp) || null,
        poblacion: limpiar(cab.poblacion) || null,
        provincia: limpiar(cab.provincia) || null,
        domicilio: limpiar(cab.domicilio) || null,
        ...estadoPersona({ documento: cab.documento, fechaNac: cab.fechaNacimiento,
                           edadInt: cab.edad }),
      }];

      for (const f of a.recordset) {
        personas.push({
          rol: 'acompanante', hueGuid: null, racGuid: f.racGuid,
          nombre: f.nombre, apellido1: f.apellido1, apellido2: f.apellido2,
          documento: limpiar(f.documento) || null, tipoDoc: f.tipoDoc || null,
          fechaNacimiento: f.fechaNacimiento
            ? new Date(f.fechaNacimiento).toISOString().slice(0, 10) : null,
          sexo: f.sexo === null ? null : (f.sexo ? 'M' : 'F'),
          nacionalidadDoc: null,
          // Los acompañantes no llevan dirección: en ACI casi nunca la tienen
          // propia, y sus columnas de domicilio no están en el GRANT.
          cp: null, poblacion: null, provincia: null, domicilio: null,
          ...estadoPersona({ documento: f.documento, fechaNac: f.fechaNacimiento,
                             edadInt: f.edad }),
        });
      }

      // Cuántas personas declara la reserva y cuántas tienen ficha. La diferencia
      // es lo que no se puede escribir sin dar de alta (fase C).
      const sinFicha = Math.max(0, (cab.pax || 0) - personas.length);
      res.json({
        hotel,
        reserva: {
          resGuid: cab.resGuid, codigo: cab.codigo, habitacion: cab.habitacion,
          entrada: cab.entrada, salida: cab.salida, pax: cab.pax,
          adultos: cab.adultos, ninos: cab.ninos, canal: cab.canal,
        },
        personas,
        sinFicha,
        pendientes: personas.filter((p) => p.estado === 'pendiente').length,
        // Se puede ensayar el alta siempre que estemos en simulación; para
        // hacerla de verdad hace falta además el interruptor.
        altaDisponible: aciWrite.PERMITIR_ALTA || aciWrite.DRY_RUN,
        altaReal: aciWrite.PERMITIR_ALTA,
      });
    } catch (e) {
      console.error('[documentos] reserva:', e.message);
      res.status(503).json({ error: 'ACI no disponible', detalle: e.message });
    }
  });

  // ── Lectura de la MRZ (proxy al microservicio local) ───────────────────────
  // El navegador no habla nunca directamente con btr-mrz: pasa por aquí, de modo
  // que el servicio de OCR sigue escuchando solo en localhost.
  app.post('/api/doc/leer', requireAuth, requireUso, imagenBinaria, async (req, res) => {
    const imagen = Buffer.isBuffer(req.body) ? req.body : null;
    if (!imagen || !imagen.length) {
      return res.status(400).json({ error: 'no se ha recibido la imagen' });
    }
    try {
      // Se reenvía como multipart al microservicio, que ya tiene ese endpoint.
      const forma = new FormData();
      forma.append('imagen', new Blob([imagen], { type: 'image/jpeg' }), 'doc.jpg');
      const r = await fetch(`${MRZ_URL}/leer`, {
        method: 'POST', body: forma,
        signal: AbortSignal.timeout(20000),
      });
      const datos = await r.json();
      // Se devuelve el tamaño recibido: si la captura sale diminuta, es lo que
      // permite verlo desde la propia pantalla en vez de adivinar.
      res.status(r.status).json({ ...datos, kb: Math.round(imagen.length / 1024) });
    } catch (e) {
      console.error('[documentos] OCR no disponible:', e.message);
      res.status(503).json({ error: 'El lector de documentos no responde',
                             detalle: e.message });
    }
  });

  // ── Guardar en ACI ─────────────────────────────────────────────────────────
  app.post('/api/doc/guardar', requireAuth, requireUso, express.json(), async (req, res) => {
    const hotel = compruebaHotel(req, res);
    if (!hotel) return;
    const { resGuid, hueGuid, racGuid, documento, forzar, alta } = req.body || {};
    if (!documento || !documento.numero) {
      return res.status(400).json({ error: 'falta el documento leído' });
    }
    const usuario = loginCorto(req);
    const ip = req.headers['x-forwarded-for'] || req.ip;

    // Nada se escribe sin comprobar antes que la persona es de esta reserva y que la
    // reserva es de este hotel. Va aquí, ANTES de tocar aciWrite, para que ninguna de
    // las tres vías (titular, acompañante, alta) pueda saltárselo.
    try {
      const permiso = await validarPertenencia(hotel, { resGuid, hueGuid, racGuid, alta });
      if (!permiso.ok) {
        await auditLog(usuario, 'doc_guardar_rechazado', 'documento',
                       { hotel, resGuid, hueGuid, racGuid, motivo: permiso.motivo }, ip);
        return res.status(403).json({ error: permiso.motivo });
      }
    } catch (e) {
      return res.status(400).json({ error: 'no se ha podido validar la reserva: ' + e.message });
    }

    try {
      let resultado;
      if (racGuid !== null && racGuid !== undefined) {
        resultado = await aciWrite.escribirAcompanante(pgPool, {
          hotel, resGuid: parseInt(resGuid, 10), racGuid: parseInt(racGuid, 10),
          documento, usuario, forzar: !!forzar });
      } else if (alta === true) {
        resultado = await aciWrite.crearAcompanante(pgPool, {
          hotel, resGuid: parseInt(resGuid, 10), documento, usuario });
      } else if (hueGuid !== null && hueGuid !== undefined) {
        resultado = await aciWrite.escribirTitular(pgPool, {
          hotel, hueGuid: parseInt(hueGuid, 10), documento, usuario,
          forzar: !!forzar });
      } else {
        return res.status(400).json({ error: 'hay que indicar hueGuid, racGuid o alta' });
      }

      // Traza del escaneo, sin el número de documento en claro.
      await pgPool.query(
        `INSERT INTO doc_escaneo
           (hotel, res_guid, hue_guid, rac_guid, formato, tipo, doc_hash,
            valido, confianza, escrito, simulado, ms, usuario)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [hotel, resGuid || null, hueGuid || null, racGuid ?? null,
         documento.formato || null, documento.tipo || null,
         hashDoc(documento.numero), documento.valido ?? null,
         documento.confianza || null,
         !!resultado.ok && !resultado.simulado, !!resultado.simulado,
         req.body?.ms || null, usuario]);

      await auditLog(usuario, resultado.simulado ? 'doc_simular' : 'doc_escribir_aci',
                     `${hotel}:${resultado.alta ? 'alta' : (racGuid != null ? 'acomp' : 'titular')}`,
                     { resGuid, hueGuid, racGuid, ok: resultado.ok,
                       cambios: (resultado.cambios || []).map((c) => c.columna),
                       simulado: !!resultado.simulado }, ip);

      res.status(resultado.ok ? 200 : 409).json(resultado);
    } catch (e) {
      console.error('[documentos] guardar:', e.message);
      await auditLog(usuario, 'doc_error', hotel, { error: e.message }, ip)
        .catch(() => {});
      res.status(500).json({ error: 'No se ha podido escribir en ACI',
                             detalle: e.message });
    }
  });

  // ── Código postal → población ──────────────────────────────────────────────
  // El DNI no trae el CP, así que recepción teclea 5 dígitos y esto rellena
  // población y provincia. Se devuelve la confianza para que la UI pueda avisar
  // cuando el CP se reparte entre varios municipios.
  app.get('/api/doc/cp/:cp', requireAuth, requireUso, async (req, res) => {
    const cp = String(req.params.cp || '').trim();
    if (!/^\d{5}$/.test(cp)) {
      return res.status(400).json({ error: 'el código postal son 5 dígitos' });
    }
    try {
      const r = await pgPool.query(
        `SELECT cp, poblacion, provincia, apariciones, dominancia, oficial
         FROM doc_cp_poblacion WHERE cp = $1`, [cp]);
      if (!r.rows.length) {
        return res.json({ cp, encontrado: false, existe: false,
                          motivo: 'ese código postal no existe en el catálogo '
                                + 'oficial de municipios' });
      }
      const f = r.rows[0];
      res.json({
        cp,
        // `existe` = el CP es válido en España (catálogo oficial de ACI).
        existe: f.oficial,
        // `encontrado` = además sabemos de qué municipio es (viene del histórico).
        encontrado: f.poblacion !== null,
        poblacion: f.poblacion, provincia: f.provincia,
        apariciones: f.apariciones, dominancia: f.dominancia,
        // Fiable exige las dos cosas: que el CP exista de verdad y que el
        // municipio dominante esté claro. Sin lo primero, el nombre del histórico
        // puede ser basura ('00000' aparecía como BARCELONA al 100%).
        fiable: f.oficial && f.poblacion !== null && f.dominancia >= 60,
      });
    } catch (e) {
      console.error('[documentos] cp:', e.message);
      res.status(500).json({ error: 'no se ha podido consultar el código postal' });
    }
  });

  // ── Reconstruir la tabla de códigos postales desde ACI (solo admin) ────────
  // Camino inverso al de /api/doc/cp/:cp — de población a provincia y código postal.
  // Lo pidió recepción: el reverso del DNI da la población pero no el código postal,
  // así que con «L'Hospitalet de Llobregat» se quedaban sin los otros dos campos.
  app.get('/api/doc/municipio', requireAuth, requireUso, async (req, res) => {
    const nombre = limpiar(req.query.nombre || req.query.poblacion || '');
    if (nombre.length < 4) {
      return res.json({ encontrado: false, motivo: 'nombre demasiado corto' });
    }
    try {
      const m = await resolverPoblacion(pgPool, nombre);
      if (!m) {
        return res.json({
          encontrado: false,
          motivo: 'ese municipio no aparece en el histórico de ACI',
        });
      }
      res.json({ encontrado: true, ...m });
    } catch (e) {
      console.error('[documentos] municipio:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/doc/cp/refrescar', requireAuth, async (req, res) => {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo administradores' });
    try {
      const pool = await getLectura();

      // PASO 1 · el catálogo oficial: todos los códigos postales de España con su
      // provincia. Es la base, y basta con leerlo de un hotel (es idéntico en los
      // cuatro: 10.684 filas en cada uno).
      const oficiales = new Map();
      try {
        const r = await pool.request().query(qCodigosPostalesOficiales('Augusta'));
        for (const f of r.recordset) {
          oficiales.set(f.cp, f.provincia || null);
        }
      } catch (e) {
        console.warn('[documentos] catálogo oficial no disponible:', e.message);
      }

      // PASO 2 · el histórico, que es lo único que aporta NOMBRE de municipio.
      // Se recorren los 4 hoteles y se acumula: un CP visto en varios hoteles
      // suma apariciones, lo que refuerza la población dominante.
      const acumulado = new Map();
      for (const h of HOTELES) {
        const r = await pool.request().query(qCodigosPostales(h.db));
        for (const f of r.recordset) {
          const previo = acumulado.get(f.cp);
          if (!previo || f.veces > previo.veces) {
            acumulado.set(f.cp, {
              cp: f.cp, poblacion: f.poblacion,
              provincia: f.provincia || null,
              veces: f.veces, total: f.total,
            });
          }
        }
      }
      // Se combinan: el oficial manda en la provincia y marca el CP como válido;
      // el histórico añade el nombre del municipio cuando se conoce.
      const combinado = new Map();
      for (const [cp, provincia] of oficiales) {
        combinado.set(cp, { cp, poblacion: null, provincia,
                            veces: 0, total: 1, oficial: true });
      }
      for (const v of acumulado.values()) {
        const previo = combinado.get(v.cp);
        combinado.set(v.cp, {
          cp: v.cp,
          poblacion: v.poblacion,
          // La provincia oficial gana sobre la del histórico, que viene tecleada.
          provincia: (previo && previo.provincia) || v.provincia,
          veces: v.veces, total: v.total,
          oficial: !!(previo && previo.oficial),
        });
      }

      // Inserción en lote: uno por uno serían ~11.000 consultas y la petición
      // se agotaba por tiempo. En bloques de 500 son media docena de consultas.
      const filas = [...combinado.values()];
      let escritos = 0;
      const TAMANO_LOTE = 500;
      for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
        const lote = filas.slice(i, i + TAMANO_LOTE);
        const valores = [];
        const marcadores = lote.map((v, k) => {
          const b = k * 6;
          valores.push(
            v.cp,
            v.poblacion ? v.poblacion.slice(0, 50) : null,
            v.provincia ? v.provincia.slice(0, 50) : null,
            v.veces,
            Math.round(100 * v.veces / Math.max(1, v.total)),
            v.oficial);
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
        }).join(',');
        await pgPool.query(
          `INSERT INTO doc_cp_poblacion (cp, poblacion, provincia, apariciones, dominancia, oficial)
           VALUES ${marcadores}
           ON CONFLICT (cp) DO UPDATE SET
             poblacion = COALESCE(EXCLUDED.poblacion, doc_cp_poblacion.poblacion),
             provincia = COALESCE(EXCLUDED.provincia, doc_cp_poblacion.provincia),
             apariciones = EXCLUDED.apariciones, dominancia = EXCLUDED.dominancia,
             oficial = EXCLUDED.oficial OR doc_cp_poblacion.oficial`,
          valores);
        escritos += lote.length;
      }
      catalogoMunicipios = null;   // se recargará en la próxima búsqueda
      await auditLog(loginCorto(req), 'doc_cp_refrescar', 'doc_cp_poblacion',
                     { codigos: escritos }, req.ip);
      const stats = await pgPool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN oficial THEN 1 ELSE 0 END) AS oficiales,
                SUM(CASE WHEN poblacion IS NOT NULL THEN 1 ELSE 0 END) AS con_poblacion,
                SUM(CASE WHEN provincia IS NOT NULL THEN 1 ELSE 0 END) AS con_provincia
         FROM doc_cp_poblacion`);
      res.json({ ok: true, codigos: escritos, ...stats.rows[0] });
    } catch (e) {
      console.error('[documentos] cp/refrescar:', e.message);
      res.status(503).json({ error: 'no se ha podido leer de ACI', detalle: e.message });
    }
  });

  // ── Municipio → código postal (búsqueda tolerante) ─────────────────────────
  app.get('/api/doc/poblacion', requireAuth, requireUso, async (req, res) => {
    const q = limpiar(req.query.q).slice(0, 60);
    if (q.length < 4) {
      return res.status(400).json({ error: 'escribe al menos 4 letras' });
    }
    try {
      const m = await buscarMunicipio(pgPool, q);
      if (!m) {
        return res.json({ encontrado: false,
                          motivo: 'ningún municipio del histórico de ACI se parece' });
      }
      res.json({ encontrado: true, cp: m.cp, poblacion: m.poblacion,
                 provincia: m.provincia, similitud: Math.round(m.sim * 100),
                 dominancia: m.dominancia });
    } catch (e) {
      console.error('[documentos] poblacion:', e.message);
      res.status(500).json({ error: 'no se ha podido consultar el municipio' });
    }
  });

  // ── Lectura del domicilio del reverso (sugerencia, nunca dato verificado) ──
  app.post('/api/doc/leer-domicilio', requireAuth, requireUso, imagenBinaria,
           async (req, res) => {
    const imagen = Buffer.isBuffer(req.body) ? req.body : null;
    if (!imagen || !imagen.length) {
      return res.status(400).json({ error: 'no se ha recibido la imagen' });
    }
    try {
      const forma = new FormData();
      forma.append('imagen', new Blob([imagen], { type: 'image/jpeg' }), 'doc.jpg');
      const r = await fetch(`${MRZ_URL}/domicilio`, {
        method: 'POST', body: forma, signal: AbortSignal.timeout(25000),
      });
      const d = await r.json();
      if (!d.encontrado) return res.json({ encontrado: false, motivo: d.motivo });

      // Aquí está la clave: el municipio leído se contrasta con el catálogo real.
      // Si no casa, la lectura entera se considera no fiable y no se propone
      // nada, en vez de colar una dirección inventada por el OCR.
      const m = await buscarMunicipio(pgPool, d.poblacion || '');
      if (!m) {
        return res.json({
          encontrado: false,
          motivo: 'se ha leído algo, pero el municipio no coincide con ninguno '
                + 'del histórico de ACI: se descarta por no fiable',
        });
      }
      res.json({
        encontrado: true,
        // La vía se ofrece tal cual la leyó el OCR: hay que revisarla.
        domicilio: d.domicilio || null,
        // Municipio, provincia y CP salen del catálogo, no del OCR.
        poblacion: m.poblacion, provincia: m.provincia, cp: m.cp,
        similitud: Math.round(m.sim * 100),
        verificado: false,
        aviso: 'La calle viene del OCR y no se puede verificar: revísala. '
             + 'El municipio, la provincia y el código postal salen del histórico '
             + 'de ACI a partir de lo leído.',
      });
    } catch (e) {
      console.error('[documentos] leer-domicilio:', e.message);
      res.status(503).json({ error: 'El lector no responde', detalle: e.message });
    }
  });

  // ── Diagnóstico de permisos SQL (solo admin) ───────────────────────────────
  app.get('/api/doc/permisos', requireAuth, async (req, res) => {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo administradores' });
    const salida = [];
    for (const h of HOTELES) {
      salida.push(await aciWrite.comprobarPermisos(h.key));
    }
    res.json({ simulacion: aciWrite.DRY_RUN,
               altaAcompanantes: aciWrite.PERMITIR_ALTA, hoteles: salida });
  });

  // ── Últimos escaneos (solo admin) ──────────────────────────────────────────
  app.get('/api/doc/historial', requireAuth, async (req, res) => {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo administradores' });
    const r = await pgPool.query(
      `SELECT hotel, formato, tipo, valido, confianza, escrito, simulado, ms,
              usuario, creado_at
       FROM doc_escaneo ORDER BY creado_at DESC LIMIT 100`);
    res.json({ escaneos: r.rows });
  });

  console.log('[documentos] Rutas registradas');
}

module.exports = {
  register, ensureSchema, HOTELES, EDAD_REGISTRO,
  // Reutilizados por el módulo de pre check-in (precheckin.js): mismas consultas
  // y mismo pool de lectura, para que la vista del huésped y la de recepción no
  // puedan divergir.
  qTitular, qAcompanantes, estadoPersona, getLectura, buscarMunicipio, dbDe, limpiar,
  hotelesDeLogin, HOTELES_CLAVES: HOTELES.map((h) => h.key),
};
