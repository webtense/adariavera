'use strict';
// Deshace una escritura a partir de la copia previa guardada en PostgreSQL.
// Es el procedimiento de emergencia del módulo: se pasa el id del backup.
//   node deshacer.js <id>            → muestra qué se restauraría
//   node deshacer.js <id> --aplicar  → lo restaura de verdad
const fs = require('fs');
const sql = require('/opt/btr-gestion-portal/node_modules/mssql');
const { Pool } = require('/opt/btr-gestion-portal/node_modules/pg');
const env = {};
for (const l of fs.readFileSync('/opt/btr-gestion-portal/.env','utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,'');
}
const DB = { siente:'Augusta', romanic:'HR', taull:'HT', solana:'AS' };
// Solo estas columnas se pueden restaurar: son las mismas que el módulo escribe.
const RESTAURABLES = {
  HuespedK: ['hue_nif_str','hue_pass_str','hue_dni_fna_dat','hue_sex_bln','TPD_GUID',
             'NAC_DOC_GUID','hue_nso_str','hue_eda_int','hue_dom_str','hue_pob_str',
             'hue_cp_str','hue_prv_str'],
  ReservaAcompanantes: ['rac_nif_str','rac_fna_dat','rac_sex_bln','rac_eda_int','TPD_GUID',
                        'NAC_GUID','NAC_DOC_GUID','rac_nom_str','rac_co1_str','rac_co2_str'],
};
const TIPO = {
  hue_dni_fna_dat: sql.DateTime, rac_fna_dat: sql.DateTime,
  hue_sex_bln: sql.Bit, rac_sex_bln: sql.Bit,
  TPD_GUID: sql.Int, NAC_GUID: sql.Int, NAC_DOC_GUID: sql.Int,
  hue_eda_int: sql.SmallInt, rac_eda_int: sql.SmallInt,
};

(async () => {
  const id = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!id) { console.error('uso: deshacer.js <id> [--aplicar]'); process.exit(1); }

  const pg = new Pool({ connectionString:process.env.DATABASE_URL
  || 'postgresql://puzzle@127.0.0.1:5432/gestion_portal' });
  const b = (await pg.query('SELECT * FROM doc_aci_backup WHERE id=$1', [id])).rows[0];
  if (!b) { console.error('no existe esa copia'); process.exit(1); }
  if (!b.fila_previa) {
    console.error('la copia corresponde a un ALTA: deshacerla sería borrar la fila,'
      + ' y este usuario no tiene permiso de borrado. Hay que hacerlo desde ACI.');
    process.exit(1);
  }

  const cols = RESTAURABLES[b.tabla];
  console.log(`Copia ${id} · ${b.hotel} · ${b.tabla} · ${JSON.stringify(b.clave)}`);
  console.log(`Guardada el ${new Date(b.creado_at).toLocaleString('es-ES')} por ${b.usuario}`);
  console.log('\nValores que se restaurarían:');
  for (const c of cols) console.log(`   ${c.padEnd(18)} → ${JSON.stringify(b.fila_previa[c])}`);

  if (!aplicar) { console.log('\n(simulación; añade --aplicar para restaurar)'); await pg.end(); process.exit(0); }

  const p = await new sql.ConnectionPool({ server:'172.16.1.87', port:1433,
    user: env.ACI_W_USER, password: env.ACI_W_PASSWORD, database: DB[b.hotel],
    options:{encrypt:false,trustServerCertificate:true}, pool:{max:1,min:0}}).connect();
  const pet = p.request();
  const sets = [];
  cols.forEach((c, i) => {
    let v = b.fila_previa[c];
    if (v !== null && TIPO[c] === sql.DateTime) v = new Date(v);
    pet.input('v'+i, TIPO[c] || sql.NVarChar, v);
    sets.push(`${c} = @v${i}`);
  });
  const donde = Object.entries(b.clave)
    .map(([k, v], i) => { pet.input('k'+i, sql.Int, v); return `${k} = @k${i}`; }).join(' AND ');
  const r = await pet.query(`UPDATE dbo.${b.tabla} SET ${sets.join(', ')} WHERE ${donde}`);
  console.log(`\n✓ restaurado · ${r.rowsAffected[0]} fila(s)`);
  await pg.query(`INSERT INTO doc_aci_backup (hotel, tabla, clave, fila_previa, usuario)
                  VALUES ($1,$2,$3,$4,$5)`,
    [b.hotel, b.tabla, b.clave, null, 'deshacer-de-' + id]);
  await p.close(); await pg.end(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
