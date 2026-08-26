'use strict';

// ─── ÚNICA ruta de escritura a ACI Dali (PMS Hotansa, SQL Server) ────────────
//
// Todo lo que este portal escriba en el PMS pasa por aquí. Es deliberado: si un
// día Hotansa cambia el esquema, o hay que auditar qué toca el portal, hay un
// solo fichero que mirar. `lib/aci.js` sigue siendo SOLO LECTURA.
//
// Salvaguardas, todas activas a la vez:
//   1. Usuario SQL propio `aci_doc_rw` con GRANT UPDATE **por columna**. No es
//      `sa`. Aunque este código tuviera un fallo, el motor no le deja tocar
//      nada más (ver sql/aci_doc_rw.sql del proyecto btr_mrz).
//   2. Solo se rellenan huecos: un campo que ya tiene valor no se pisa salvo
//      confirmación explícita del recepcionista (`forzar`).
//   3. Copia previa de la fila completa en PostgreSQL antes de cada UPDATE, de
//      modo que deshacer una escritura concreta no exige restaurar la BD.
//   4. Modo simulación (`DOC_DRY_RUN`): registra el UPDATE que haría sin
//      ejecutarlo. Es el valor por defecto.
//
// Hallazgos de la fase 0 que condicionan este código (ver
// BTR_Proyectos/btr_mrz/FASE0_DESCUBRIMIENTO_ACI.md):
//   · `TPD_GUID` NO vale lo mismo en cada hotel: en Solana el 2 es PASAPORTE
//     mientras en los otros tres es DNI. Se resuelve SIEMPRE en ejecución por
//     `TPD_COD_str`, que sí es estable. Nunca hardcodear el número.
//   · `RAC_GUID` es un secuencial LOCAL a cada reserva (PK compuesta
//     RES_GUID + RAC_GUID), no global: insertar no desincroniza contadores.
//   · `hue_sex_bln`: 1 = hombre, 0 = mujer. Verificado cruzando 90.000 fichas
//     con nombres inequívocos en los 4 hoteles. Ojo: el 0 también es el valor
//     por defecto de las fichas sin informar, así que NO sirve como indicio de
//     "campo vacío".
//   · El número de documento va a `hue_nif_str` incluso siendo pasaporte. Es lo
//     que hace el propio PMS: `hue_pass_str` está vacío en el 100% de las
//     815.000 fichas históricas. Se replica su comportamiento, no se inventa.
//   · `HuespedKDocumentosIdentificativos` está vacía en las 4 BD: el PMS no la
//     usa. Descartada como destino.

const sql = require('mssql');

// Mapa hotel → base de datos del PMS. Contraintuitivo: la BD del Siente se
// llama "Augusta". `AS` es palabra reservada de T-SQL: siempre entre corchetes.
const DB_POR_HOTEL = {
  siente:  { db: 'Augusta', label: 'Siente Boí' },
  romanic: { db: 'HR',      label: 'Romànic'    },
  taull:   { db: 'HT',      label: 'Taüll'      },
  solana:  { db: 'AS',      label: 'Solana'     },
};

// Simulación activada por defecto: para escribir de verdad hay que ponerlo a
// 'false' explícitamente en el .env.
const DRY_RUN = String(process.env.DOC_DRY_RUN ?? 'true').toLowerCase() !== 'false';
// El alta de acompañantes que no tienen fila (fase C) va aparte y también
// arranca desactivada.
const PERMITIR_ALTA = String(process.env.DOC_ALTA_ACOMPANANTES ?? 'false').toLowerCase() === 'true';

// Hoteles donde la escritura está habilitada. Se despliega hotel a hotel: el
// usuario `aci_doc_rw` solo tiene permisos donde se le han concedido, y esta
// lista hace que el resto dé un mensaje comprensible en vez de un error de SQL.
const HOTELES_ESCRITURA = (process.env.DOC_HOTELES_ESCRITURA || '')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

function escrituraHabilitada(hotelKey) {
  // Lista vacía = ninguno habilitado (hay que declararlos explícitamente).
  return HOTELES_ESCRITURA.includes(String(hotelKey || '').toLowerCase());
}

// Mientras `aci_doc_rw` no exista en el servidor, se cae a las credenciales de
// LECTURA para poder usar el módulo en simulación (los SELECT de comparación y
// los catálogos funcionan igual). Escribir de verdad en ese estado se rechaza
// explícitamente más abajo: `welcome_ro` tiene DENY UPDATE y el error de SQL
// Server sería confuso; mejor decir qué falta.
const SIN_USUARIO_ESCRITURA = !process.env.ACI_W_PASSWORD;

const cfgEscritura = {
  server:   process.env.ACI_HOST || '172.16.1.87',
  port:     parseInt(process.env.ACI_PORT || '1433', 10),
  user:     SIN_USUARIO_ESCRITURA
    ? (process.env.ACI_USER || 'welcome_ro')
    : (process.env.ACI_W_USER || 'aci_doc_rw'),
  password: SIN_USUARIO_ESCRITURA
    ? (process.env.ACI_PASSWORD || '')
    : process.env.ACI_W_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 5000,
    requestTimeout: 15000,
  },
  pool: { max: 2, min: 0, idleTimeoutMillis: 30000 },
};

// Se llama justo antes de cualquier escritura real.
function comprobarPuedeEscribir(hotelKey) {
  if (SIN_USUARIO_ESCRITURA) {
    return 'no está configurado el usuario de escritura de ACI (ACI_W_PASSWORD). '
         + 'Ejecutar sql/aci_doc_rw.sql y añadir la contraseña al .env';
  }
  if (hotelKey && !escrituraHabilitada(hotelKey)) {
    const info = DB_POR_HOTEL[String(hotelKey).toLowerCase()];
    return `la escritura en ACI todavía no está habilitada para `
         + `${info ? info.label : hotelKey}. Se está desplegando hotel a hotel; `
         + `de momento solo: ${HOTELES_ESCRITURA.join(', ') || '(ninguno)'}`;
  }
  return null;
}

// Un pool por BD: el usuario de escritura no tiene permiso cross-database.
const pools = new Map();

function infoHotel(hotelKey) {
  const info = DB_POR_HOTEL[String(hotelKey || '').trim().toLowerCase()];
  if (!info) throw new Error(`hotel no válido: ${hotelKey}`);
  return info;
}

async function getPool(hotelKey) {
  const { db } = infoHotel(hotelKey);
  if (!pools.has(db)) {
    const p = new sql.ConnectionPool({ ...cfgEscritura, database: db });
    pools.set(db, p.connect().catch((e) => { pools.delete(db); throw e; }));
  }
  return pools.get(db);
}

// ─── Normalización ───────────────────────────────────────────────────────────

// Formato canónico observado en el PMS: mayúsculas, sin guiones ni espacios.
// En los datos existentes hay ruido de tecleo manual (99999999-A con guion,
// números sin letra); no se replica ese ruido.
function normalizarDocumento(valor) {
  return String(valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

// Los campos de ACI tienen longitudes fijas: se recorta en vez de dejar que el
// driver falle a mitad de una escritura.
function recortar(valor, largo) {
  const v = String(valor || '').trim();
  return v ? v.slice(0, largo) : null;
}

function vacio(valor) {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

function edadDesde(fechaISO) {
  if (!fechaISO) return null;
  const nac = new Date(fechaISO);
  if (Number.isNaN(nac.getTime())) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad -= 1;
  return edad >= 0 && edad <= 120 ? edad : null;
}

// ─── Catálogos: se resuelven por BD y se cachean ─────────────────────────────

const cacheTipos = new Map();     // db -> { 'D': 2, 'P': 5, ... }
const cacheNaciones = new Map();  // db -> { 'ESP': 1, 'DEU': 2, ... }

// El motivo de que esto exista: en Solana el TPD_GUID del DNI es 1 y en los
// otros hoteles es 2. Escribir un número fijo marcaría "PASAPORTE" en Solana.
async function tiposDocumento(hotelKey) {
  const { db } = infoHotel(hotelKey);
  if (!cacheTipos.has(db)) {
    const pool = await getPool(hotelKey);
    const r = await pool.request().query(
      'SELECT TPD_GUID, LTRIM(RTRIM(TPD_COD_str)) AS cod FROM dbo.TiposDocumento');
    const mapa = {};
    for (const f of r.recordset) {
      if (f.cod) mapa[String(f.cod).toUpperCase()] = f.TPD_GUID;
    }
    cacheTipos.set(db, mapa);
  }
  return cacheTipos.get(db);
}

async function naciones(hotelKey) {
  const { db } = infoHotel(hotelKey);
  if (!cacheNaciones.has(db)) {
    const pool = await getPool(hotelKey);
    const r = await pool.request().query(
      `SELECT NAC_GUID, UPPER(LTRIM(RTRIM(nac_abr_str))) AS iso3
       FROM dbo.Naciones WHERE LEN(LTRIM(RTRIM(ISNULL(nac_abr_str,'')))) = 3`);
    const mapa = {};
    for (const f of r.recordset) {
      if (f.iso3 && mapa[f.iso3] === undefined) mapa[f.iso3] = f.NAC_GUID;
    }
    cacheNaciones.set(db, mapa);
  }
  return cacheNaciones.get(db);
}

async function resolverTipo(hotelKey, codTipo) {
  if (!codTipo) return null;
  const mapa = await tiposDocumento(hotelKey);
  return mapa[String(codTipo).toUpperCase()] ?? null;
}

async function resolverNacion(hotelKey, iso3) {
  if (!iso3) return null;
  const mapa = await naciones(hotelKey);
  return mapa[String(iso3).toUpperCase()] ?? null;
}

// ─── Lectura de la ficha actual (para copia previa y comparación) ─────────────

const COLUMNAS_TITULAR = [
  'hue_nif_str', 'hue_pass_str', 'hue_dni_fna_dat', 'hue_sex_bln',
  'TPD_GUID', 'NAC_DOC_GUID', 'hue_nso_str', 'hue_eda_int',
  // Dirección: la MRZ no la contiene, se teclea. El código postal no está
  // impreso en el DNI español, así que son 5 dígitos a mano que a su vez
  // autocompletan población y provincia.
  'hue_dom_str', 'hue_pob_str', 'hue_cp_str', 'hue_prv_str',
];

async function leerFichaTitular(hotelKey, hueGuid) {
  const pool = await getPool(hotelKey);
  const r = await pool.request()
    .input('hue', sql.Int, hueGuid)
    .query(`SELECT HUE_GUID, ${COLUMNAS_TITULAR.join(', ')}
            FROM dbo.HuespedK WHERE HUE_GUID = @hue`);
  return r.recordset[0] || null;
}

const COLUMNAS_ACOMP = [
  'rac_nif_str', 'rac_fna_dat', 'rac_sex_bln', 'rac_eda_int',
  'TPD_GUID', 'NAC_GUID', 'NAC_DOC_GUID',
  'rac_nom_str', 'rac_co1_str', 'rac_co2_str',
];

async function leerFichaAcompanante(hotelKey, resGuid, racGuid) {
  const pool = await getPool(hotelKey);
  const r = await pool.request()
    .input('res', sql.Int, resGuid)
    .input('rac', sql.Int, racGuid)
    .query(`SELECT RES_GUID, RAC_GUID, ${COLUMNAS_ACOMP.join(', ')}
            FROM dbo.ReservaAcompanantes
            WHERE RES_GUID = @res AND RAC_GUID = @rac`);
  return r.recordset[0] || null;
}

// ─── Copia previa en PostgreSQL ──────────────────────────────────────────────

async function guardarCopiaPrevia(pgPool, { hotel, tabla, clave, fila, usuario }) {
  await pgPool.query(
    `INSERT INTO doc_aci_backup (hotel, tabla, clave, fila_previa, usuario)
     VALUES ($1,$2,$3,$4,$5)`,
    [hotel, tabla, JSON.stringify(clave), JSON.stringify(fila || null), usuario || null]);
}

// ─── Construcción del plan de escritura ──────────────────────────────────────

/**
 * Decide qué columnas se van a tocar y por qué. Separar esto de la ejecución
 * permite mostrar al recepcionista exactamente lo que va a pasar antes de que
 * ocurra, y es lo que se registra en modo simulación.
 *
 * Devuelve { cambios: [{columna, tipo, valor, motivo}], conflictos: [...] }
 */
function planificar(fila, propuestos, { forzar }) {
  const cambios = [];
  const conflictos = [];
  const omitidos = [];

  for (const p of propuestos) {
    if (p.valor === null || p.valor === undefined) continue;
    const actual = fila ? fila[p.columna] : null;

    // El sexo es un caso aparte: su 0 significa a la vez "mujer" y "sin
    // informar", así que no se puede saber si está vacío. Se escribe solo
    // cuando la ficha no tenía documento (es decir, se está completando por
    // primera vez) o cuando se fuerza.
    if (p.columna === 'hue_sex_bln' || p.columna === 'rac_sex_bln') {
      if (p.escribirSiempre || forzar) {
        cambios.push({ ...p, anterior: actual, motivo: 'sexo, junto con el documento' });
      } else {
        omitidos.push({ columna: p.columna, motivo: 'el campo no distingue vacío de "mujer"' });
      }
      continue;
    }

    // `hue_eda_int` / `rac_eda_int` a 0 es el valor por defecto de las fichas sin
    // informar, no la edad de un recién nacido: se trata como hueco. Si no, cada
    // escaneo pediría confirmación para "sobrescribir" un 0 que no es un dato.
    const esHueco = vacio(actual)
      || (p.ceroEsVacio && (actual === 0 || String(actual).trim() === '0'));

    if (esHueco) {
      cambios.push({ ...p, anterior: null, motivo: 'el campo estaba vacío' });
      continue;
    }

    // Ya hay valor. Si coincide, no hay nada que hacer.
    const iguales = p.comparar
      ? p.comparar(actual, p.valor)
      : String(actual).trim() === String(p.valor).trim();
    if (iguales) {
      omitidos.push({ columna: p.columna, motivo: 'ya tenía el mismo valor' });
    } else if (forzar) {
      cambios.push({ ...p, anterior: actual, motivo: 'sobrescrito por confirmación del usuario' });
    } else {
      conflictos.push({ columna: p.columna, actual, propuesto: p.valor });
    }
  }
  return { cambios, conflictos, omitidos };
}

function ejecutarPlan(peticion, cambios) {
  // Se parametriza todo: los nombres de columna vienen de constantes del código,
  // nunca de entrada del usuario.
  const asignaciones = [];
  cambios.forEach((c, i) => {
    const param = `v${i}`;
    peticion.input(param, c.tipo, c.valor);
    asignaciones.push(`${c.columna} = @${param}`);
  });
  return asignaciones.join(', ');
}

// ─── Escritura del titular ───────────────────────────────────────────────────

/**
 * Completa la ficha de identidad del titular en HuespedK.
 *
 * NO crea huéspedes: solo rellena el que ACI ya tiene asociado a la reserva.
 * Devuelve un informe de lo hecho (o de lo que se habría hecho en simulación).
 */
async function escribirTitular(pgPool, {
  hotel, hueGuid, documento, usuario, forzar = false, dryRun = DRY_RUN,
}) {
  const { db, label } = infoHotel(hotel);
  const fila = await leerFichaTitular(hotel, hueGuid);
  if (!fila) {
    return { ok: false, motivo: `no existe ficha HuespedK para HUE_GUID ${hueGuid}` };
  }

  const numero = normalizarDocumento(documento.numero);
  const tpdGuid = await resolverTipo(hotel, documento.cod_tipo_pms);
  const nacDoc = await resolverNacion(hotel, documento.nacionalidad);
  const fichaSinDocumento = vacio(fila.hue_nif_str);

  const avisos = [];
  if (documento.cod_tipo_pms && tpdGuid === null) {
    avisos.push(`el tipo de documento '${documento.cod_tipo_pms}' no existe en el `
                + `catálogo de ${label}: no se escribe el tipo`);
  }
  if (documento.nacionalidad && nacDoc === null) {
    avisos.push(`la nacionalidad '${documento.nacionalidad}' no está en el catálogo `
                + `Naciones de ${label}: no se escribe`);
  }

  const propuestos = [
    { columna: 'hue_nif_str', tipo: sql.NVarChar(16), valor: numero || null,
      comparar: (a, b) => normalizarDocumento(a) === normalizarDocumento(b) },
    { columna: 'hue_dni_fna_dat', tipo: sql.DateTime,
      valor: documento.fecha_nacimiento ? new Date(documento.fecha_nacimiento) : null,
      comparar: (a, b) => new Date(a).toISOString().slice(0, 10)
                       === new Date(b).toISOString().slice(0, 10) },
    { columna: 'hue_sex_bln', tipo: sql.Bit,
      // 1 = hombre, 0 = mujer (verificado sobre 90.000 fichas en los 4 hoteles).
      valor: documento.sexo === 'M' ? 1 : (documento.sexo === 'F' ? 0 : null),
      escribirSiempre: fichaSinDocumento },
    { columna: 'TPD_GUID', tipo: sql.Int, valor: tpdGuid },
    { columna: 'NAC_DOC_GUID', tipo: sql.Int, valor: nacDoc },
    { columna: 'hue_nso_str', tipo: sql.NVarChar(50), valor: documento.numero_soporte || null },
    { columna: 'hue_eda_int', tipo: sql.SmallInt, ceroEsVacio: true,
      valor: edadDesde(documento.fecha_nacimiento) },
    // Dirección tecleada en la pantalla de verificación. Como cualquier otro
    // campo, solo se escribe si estaba vacío (o si se confirma sobrescribir).
    { columna: 'hue_dom_str', tipo: sql.NVarChar(100),
      valor: recortar(documento.domicilio, 100) },
    { columna: 'hue_pob_str', tipo: sql.NVarChar(50),
      valor: recortar(documento.poblacion, 50) },
    { columna: 'hue_cp_str', tipo: sql.NVarChar(10),
      valor: /^\d{5}$/.test(String(documento.cp || '').trim())
        ? String(documento.cp).trim() : null },
    { columna: 'hue_prv_str', tipo: sql.NVarChar(50),
      valor: recortar(documento.provincia, 50) },
  ];

  const plan = planificar(fila, propuestos, { forzar });

  if (plan.conflictos.length && !forzar) {
    return {
      ok: false, requiereConfirmacion: true, hotel, db, hueGuid,
      conflictos: plan.conflictos, omitidos: plan.omitidos, avisos,
      motivo: 'la ficha ya tiene datos distintos: hace falta confirmación',
    };
  }
  if (!plan.cambios.length) {
    return { ok: true, sinCambios: true, hotel, db, hueGuid,
             omitidos: plan.omitidos, avisos,
             motivo: 'la ficha ya estaba completa: no se ha tocado nada' };
  }

  const resumen = plan.cambios.map((c) => ({
    columna: c.columna, valor: c.valor instanceof Date
      ? c.valor.toISOString().slice(0, 10) : c.valor,
    anterior: c.anterior, motivo: c.motivo,
  }));

  if (dryRun) {
    return { ok: true, simulado: true, hotel, db, hueGuid,
             cambios: resumen, omitidos: plan.omitidos, avisos,
             motivo: 'simulación: no se ha escrito nada en ACI' };
  }

  const impedimento = comprobarPuedeEscribir(hotel);
  if (impedimento) {
    return { ok: false, sinUsuarioEscritura: true, motivo: impedimento };
  }

  // Copia previa ANTES de tocar nada. Si esto falla, no se escribe.
  await guardarCopiaPrevia(pgPool, {
    hotel, tabla: 'HuespedK', clave: { HUE_GUID: hueGuid }, fila, usuario });

  const pool = await getPool(hotel);
  const peticion = pool.request().input('hue', sql.Int, hueGuid);
  const set = ejecutarPlan(peticion, plan.cambios);
  const r = await peticion.query(
    `UPDATE dbo.HuespedK SET ${set} WHERE HUE_GUID = @hue`);

  return { ok: true, hotel, db, hueGuid, filasAfectadas: r.rowsAffected[0],
           cambios: resumen, omitidos: plan.omitidos, avisos };
}

// ─── Escritura de un acompañante existente (fase B) ──────────────────────────

async function escribirAcompanante(pgPool, {
  hotel, resGuid, racGuid, documento, usuario, forzar = false, dryRun = DRY_RUN,
}) {
  const { db, label } = infoHotel(hotel);
  const fila = await leerFichaAcompanante(hotel, resGuid, racGuid);
  if (!fila) {
    return {
      ok: false, sinFila: true, hotel, resGuid, racGuid,
      motivo: 'este acompañante no tiene ficha creada en ACI. Darlo de alta '
            + 'requiere activar la fase C (DOC_ALTA_ACOMPANANTES)',
    };
  }

  const numero = normalizarDocumento(documento.numero);
  const tpdGuid = await resolverTipo(hotel, documento.cod_tipo_pms);
  const nacion = await resolverNacion(hotel, documento.nacionalidad);
  const fichaSinDocumento = vacio(fila.rac_nif_str);
  const avisos = [];
  if (documento.cod_tipo_pms && tpdGuid === null) {
    avisos.push(`tipo '${documento.cod_tipo_pms}' no está en el catálogo de ${label}`);
  }

  const propuestos = [
    { columna: 'rac_nif_str', tipo: sql.NVarChar(16), valor: numero || null,
      comparar: (a, b) => normalizarDocumento(a) === normalizarDocumento(b) },
    { columna: 'rac_fna_dat', tipo: sql.DateTime,
      valor: documento.fecha_nacimiento ? new Date(documento.fecha_nacimiento) : null,
      comparar: (a, b) => new Date(a).toISOString().slice(0, 10)
                       === new Date(b).toISOString().slice(0, 10) },
    { columna: 'rac_sex_bln', tipo: sql.Bit,
      valor: documento.sexo === 'M' ? 1 : (documento.sexo === 'F' ? 0 : null),
      escribirSiempre: fichaSinDocumento },
    { columna: 'rac_eda_int', tipo: sql.SmallInt, ceroEsVacio: true,
      valor: edadDesde(documento.fecha_nacimiento) },
    { columna: 'TPD_GUID', tipo: sql.Int, valor: tpdGuid },
    { columna: 'NAC_GUID', tipo: sql.Int, valor: nacion },
    { columna: 'NAC_DOC_GUID', tipo: sql.Int, valor: nacion },
    // El nombre de la MRZ va sin tildes y puede estar recortado: solo se
    // escribe si el PMS no tiene nada, nunca para "corregir" lo que ya hay.
    { columna: 'rac_nom_str', tipo: sql.NVarChar(50),
      valor: documento.nombre_dudoso ? null : (documento.nombres || null) },
    { columna: 'rac_co1_str', tipo: sql.NVarChar(50),
      valor: documento.nombre_dudoso ? null : (documento.apellido1 || null) },
    { columna: 'rac_co2_str', tipo: sql.NVarChar(50),
      valor: documento.nombre_dudoso ? null : (documento.apellido2 || null) },
  ];

  const plan = planificar(fila, propuestos, { forzar });

  if (plan.conflictos.length && !forzar) {
    return { ok: false, requiereConfirmacion: true, hotel, db, resGuid, racGuid,
             conflictos: plan.conflictos, omitidos: plan.omitidos, avisos,
             motivo: 'el acompañante ya tiene datos distintos: hace falta confirmación' };
  }
  if (!plan.cambios.length) {
    return { ok: true, sinCambios: true, hotel, db, resGuid, racGuid,
             omitidos: plan.omitidos, avisos,
             motivo: 'la ficha ya estaba completa' };
  }

  const resumen = plan.cambios.map((c) => ({
    columna: c.columna,
    valor: c.valor instanceof Date ? c.valor.toISOString().slice(0, 10) : c.valor,
    anterior: c.anterior, motivo: c.motivo,
  }));

  if (dryRun) {
    return { ok: true, simulado: true, hotel, db, resGuid, racGuid,
             cambios: resumen, omitidos: plan.omitidos, avisos,
             motivo: 'simulación: no se ha escrito nada en ACI' };
  }

  const impedimento = comprobarPuedeEscribir(hotel);
  if (impedimento) {
    return { ok: false, sinUsuarioEscritura: true, motivo: impedimento };
  }

  await guardarCopiaPrevia(pgPool, {
    hotel, tabla: 'ReservaAcompanantes',
    clave: { RES_GUID: resGuid, RAC_GUID: racGuid }, fila, usuario });

  const pool = await getPool(hotel);
  const peticion = pool.request()
    .input('res', sql.Int, resGuid).input('rac', sql.Int, racGuid);
  const set = ejecutarPlan(peticion, plan.cambios);
  const r = await peticion.query(
    `UPDATE dbo.ReservaAcompanantes SET ${set}
     WHERE RES_GUID = @res AND RAC_GUID = @rac`);

  return { ok: true, hotel, db, resGuid, racGuid,
           filasAfectadas: r.rowsAffected[0], cambios: resumen,
           omitidos: plan.omitidos, avisos };
}

// ─── Alta de acompañante sin ficha (fase C) ──────────────────────────────────

/**
 * Da de alta una fila en ReservaAcompanantes.
 *
 * Es la operación más intrusiva del módulo y por eso está desactivada por
 * defecto (`DOC_ALTA_ACOMPANANTES`). La fase 0 dejó claro que es segura: la PK
 * es compuesta (RES_GUID + RAC_GUID) y RAC_GUID es un secuencial local a la
 * reserva que empieza en 1, así que el nuevo valor sale de MAX(RAC_GUID)+1
 * dentro de la propia reserva y no toca ningún contador global del PMS.
 *
 * El SELECT del máximo va con UPDLOCK, HOLDLOCK dentro de la transacción para
 * que dos recepcionistas escaneando a la vez no elijan el mismo número.
 */
async function crearAcompanante(pgPool, {
  hotel, resGuid, documento, usuario, dryRun = DRY_RUN,
}) {
  const { db } = infoHotel(hotel);
  const tpdGuid = await resolverTipo(hotel, documento.cod_tipo_pms);
  const nacion = await resolverNacion(hotel, documento.nacionalidad);
  const numero = normalizarDocumento(documento.numero);

  if (dryRun) {
    return {
      ok: true, simulado: true, alta: true, hotel, db, resGuid,
      motivo: PERMITIR_ALTA
        ? 'simulación: se daría de alta un acompañante nuevo'
        : 'simulación: así quedaría el alta. Para hacerla de verdad hay que '
          + 'activar DOC_ALTA_ACOMPANANTES y conceder el INSERT a aci_doc_rw',
      permitidoDeVerdad: PERMITIR_ALTA,
      datos: { numero, tpdGuid, nacion,
               nombres: documento.nombres, apellido1: documento.apellido1 },
    };
  }

  // A partir de aquí sí se escribe: aquí es donde el interruptor tiene sentido.
  if (!PERMITIR_ALTA) {
    return { ok: false, deshabilitado: true, hotel, resGuid,
             motivo: 'el alta de acompañantes está desactivada '
                   + '(DOC_ALTA_ACOMPANANTES=false en el .env)' };
  }

  const impedimentoAlta = comprobarPuedeEscribir(hotel);
  if (impedimentoAlta) {
    return { ok: false, sinUsuarioEscritura: true, motivo: impedimentoAlta };
  }

  const pool = await getPool(hotel);
  const transaccion = new sql.Transaction(pool);
  await transaccion.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const siguiente = await new sql.Request(transaccion)
      .input('res', sql.Int, resGuid)
      .query(`SELECT ISNULL(MAX(RAC_GUID), 0) + 1 AS siguiente
              FROM dbo.ReservaAcompanantes WITH (UPDLOCK, HOLDLOCK)
              WHERE RES_GUID = @res`);
    const racGuid = siguiente.recordset[0].siguiente;

    await new sql.Request(transaccion)
      .input('res', sql.Int, resGuid)
      .input('rac', sql.Int, racGuid)
      .input('nom', sql.NVarChar(50), documento.nombres || null)
      .input('co1', sql.NVarChar(50), documento.apellido1 || null)
      .input('co2', sql.NVarChar(50), documento.apellido2 || null)
      .input('nif', sql.NVarChar(16), numero || null)
      .input('fna', sql.DateTime, documento.fecha_nacimiento
        ? new Date(documento.fecha_nacimiento) : null)
      .input('sex', sql.Bit, documento.sexo === 'M' ? 1 : (documento.sexo === 'F' ? 0 : null))
      .input('eda', sql.SmallInt, edadDesde(documento.fecha_nacimiento))
      .input('tpd', sql.Int, tpdGuid)
      .input('nac', sql.Int, nacion)
      .query(`INSERT INTO dbo.ReservaAcompanantes
                (RES_GUID, RAC_GUID, rac_nom_str, rac_co1_str, rac_co2_str,
                 rac_nif_str, rac_fna_dat, rac_sex_bln, rac_eda_int,
                 TPD_GUID, NAC_GUID, NAC_DOC_GUID)
              VALUES (@res, @rac, @nom, @co1, @co2, @nif, @fna, @sex, @eda,
                      @tpd, @nac, @nac)`);

    await transaccion.commit();
    // La copia previa de un alta es la propia constancia de que no existía.
    await guardarCopiaPrevia(pgPool, {
      hotel, tabla: 'ReservaAcompanantes',
      clave: { RES_GUID: resGuid, RAC_GUID: racGuid }, fila: null, usuario });

    return { ok: true, alta: true, hotel, db, resGuid, racGuid };
  } catch (e) {
    await transaccion.rollback().catch(() => {});
    throw e;
  }
}

// ─── Diagnóstico ─────────────────────────────────────────────────────────────

async function comprobarPermisos(hotelKey) {
  const { db, label } = infoHotel(hotelKey);
  const salida = { hotel: hotelKey, db, label, conecta: false };
  try {
    const pool = await getPool(hotelKey);
    await pool.request().query('SELECT 1');
    salida.conecta = true;
    salida.usuario = cfgEscritura.user;
    salida.sinUsuarioEscritura = SIN_USUARIO_ESCRITURA;
    const tipos = await tiposDocumento(hotelKey);
    salida.tipos_documento = tipos;
    salida.tpd_dni = tipos.D ?? null;
    salida.tpd_pasaporte = tipos.P ?? null;
    salida.naciones = Object.keys(await naciones(hotelKey)).length;
  } catch (e) {
    salida.error = e.message;
  }
  return salida;
}

module.exports = {
  DB_POR_HOTEL, DRY_RUN, PERMITIR_ALTA, SIN_USUARIO_ESCRITURA,
  HOTELES_ESCRITURA, escrituraHabilitada,
  infoHotel, normalizarDocumento, edadDesde,
  leerFichaTitular, leerFichaAcompanante,
  escribirTitular, escribirAcompanante, crearAcompanante,
  resolverTipo, resolverNacion, tiposDocumento, naciones,
  comprobarPermisos,
};
