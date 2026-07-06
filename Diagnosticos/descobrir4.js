/* =======================================================================
   descobrir4.js — Lista os "tipos de ensaio" que aparecem nos trabalhos da
   Geodeep e mostra quais TÊM nome completo na tabela Ensaios (ensaio real)
   e quais NÃO têm (suspeitos de lixo, ex: IDs vazados).
   Salve na MESMA pasta do airtable.js e rode:  node descobrir4.js
   Só LÊ. Cole o resultado no chat.
   ======================================================================= */
require('dotenv').config();
const TOKEN   = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
const BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.BASE_ID;
const GEODEEP_REC = 'rectEDZrt5unCtR4Z';
if (!TOKEN || !BASE_ID){ console.log('Faltou TOKEN/BASE_ID no .env'); process.exit(1); }
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`;
const TBL_ENSAIOS = 'tblYtVM2crMxpxHgG';
const TBL_NOVOS = 'tblJAP4Av9sWm8SmL';
const H = { headers: { Authorization: `Bearer ${TOKEN}` } };
async function get(u){ const r = await fetch(u, H); if(!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); }

(async () => {
  try {
    // 1) Mapa de siglas válidas (tabela Ensaios): ID Ensaio -> Nome do Ensaio
    const valido = {};
    let off = null;
    do {
      let u = `${BASE_URL}/${TBL_ENSAIOS}?pageSize=100`;
      if (off) u += `&offset=${off}`;
      const d = await get(u);
      (d.records||[]).forEach(r => {
        const s = r.fields['ID Ensaio']; const n = r.fields['Nome do Ensaio'];
        if (s && n) valido[String(s).trim()] = String(n).trim();
      });
      off = d.offset;
    } while (off);
    console.log(`Tabela Ensaios: ${Object.keys(valido).length} siglas com nome completo.\n`);

    // 2) Junta os valores de "Link Ensaios" dos trabalhos da Geodeep
    let recs = [], off2 = null, p = 0;
    do {
      let u = `${BASE_URL}/${TBL_NOVOS}?pageSize=100`;
      if (off2) u += `&offset=${off2}`;
      const d = await get(u);
      recs = recs.concat(d.records||[]); off2 = d.offset; p++;
    } while (off2 && p < 6);
    const geo = recs.filter(r => JSON.stringify(r.fields['Cliente']||'').includes(GEODEEP_REC));

    const cont = {};
    geo.forEach(r => {
      let v = r.fields['Link Ensaios'];
      if (Array.isArray(v)) v = v[0];
      if (v == null) v = '(vazio)';
      cont[v] = (cont[v]||0)+1;
    });

    const reais = [], suspeitos = [];
    Object.keys(cont).forEach(v => {
      const temNome = valido[String(v).trim()] !== undefined;
      const ehNomeCompleto = String(v).length > 6 && /\s/.test(v); // tem espaço, parece nome
      if (temNome || ehNomeCompleto) reais.push(v);
      else suspeitos.push(v);
    });

    console.log('===== ENSAIOS REAIS (nome completo ou tradução conhecida) =====');
    reais.sort().forEach(v => console.log(`   OK   "${v}"  (${cont[v]}x)`));
    console.log('\n===== SUSPEITOS DE LIXO (sigla solta / ID / sem nome) =====');
    suspeitos.sort().forEach(v => console.log(`   ??   "${v}"  (${cont[v]}x)`));
    console.log('\n>>> Cole tudo no chat. <<<');
  } catch(e){ console.log('ERRO:', e.message); }
})();
