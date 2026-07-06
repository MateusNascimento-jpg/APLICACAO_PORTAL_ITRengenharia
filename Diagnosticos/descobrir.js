/* =======================================================================
   descobrir3.js — Fecha a Ordem de Serviço (qual campo usar + nomes).
   Salve na MESMA pasta do airtable.js e rode:  node descobrir3.js
   Só LÊ. Cole todo o resultado no chat.
   ======================================================================= */
require('dotenv').config();
const TOKEN   = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
const BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.BASE_ID;
const GEODEEP_REC = 'rectEDZrt5unCtR4Z';
if (!TOKEN || !BASE_ID){ console.log('Faltou TOKEN/BASE_ID no .env'); process.exit(1); }
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`;
const H = { headers: { Authorization: `Bearer ${TOKEN}` } };
async function get(u){ const r = await fetch(u, H); if(!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); }

(async () => {
  try {
    // 1) Ler a tabela "Ordem de Serviço" inteira -> mapa rec -> Name
    console.log('\n===== 1) TABELA "Ordem de Serviço": código -> nome =====');
    let recs = [], offset = null, p = 0;
    do {
      let u = `${BASE_URL}/${encodeURIComponent('Ordem de Serviço')}?pageSize=100`;
      if (offset) u += `&offset=${offset}`;
      const d = await get(u); recs = recs.concat(d.records||[]); offset = d.offset; p++;
    } while (offset && p < 10);
    console.log(`   Total de Ordens de Serviço: ${recs.length}`);
    const mapa = {};
    recs.forEach(r => { mapa[r.id] = r.fields['Name'] || r.fields['Nome'] || '(sem nome)'; });
    console.log('   Primeiras 15:', recs.slice(0,15).map(r => `${r.id}="${mapa[r.id]}"`).join('  |  '));
    // que campos a tabela OS tem (pra saber se há Status/Cliente úteis)
    console.log('   Campos da tabela OS:', Object.keys(recs[0].fields).join(' | '));

    // 2) Pegar trabalhos da Geodeep e ver os dois campos de OS lado a lado
    console.log('\n===== 2) Nos trabalhos da Geodeep: "Ordem de Serviço" vs "Link Ordem de Serviço" =====');
    let tr = [], off2 = null, q = 0;
    do {
      let u = `${BASE_URL}/${encodeURIComponent('Novos Trabalhos')}?pageSize=100`;
      if (off2) u += `&offset=${off2}`;
      const d = await get(u); tr = tr.concat(d.records||[]); off2 = d.offset; q++;
    } while (off2 && q < 4);
    const geo = tr.filter(r => JSON.stringify(r.fields['Cliente']||'').includes(GEODEEP_REC));
    console.log(`   Trabalhos da Geodeep nesta amostra: ${geo.length}`);
    geo.slice(0,6).forEach((r,i) => {
      const os1 = r.fields['Ordem de Serviço'];
      const os2 = r.fields['Link Ordem de Serviço'];
      const nome1 = Array.isArray(os1) ? os1.map(x=>mapa[x]||x).join(',') : os1;
      console.log(`   [${i+1}] amostra="${(r.fields['Nome da Amostra']||[''])[0]}"`);
      console.log(`        Ordem de Serviço      = ${JSON.stringify(os1)}  => nome: ${nome1}`);
      console.log(`        Link Ordem de Serviço = ${JSON.stringify(os2)}`);
    });

    // 3) Quantas OS distintas a Geodeep usa (pra dimensionar o filtro)
    const osDaGeo = {};
    geo.forEach(r => {
      const os1 = r.fields['Ordem de Serviço'];
      if (Array.isArray(os1)) os1.forEach(x => { const n = mapa[x]||x; osDaGeo[n] = (osDaGeo[n]||0)+1; });
    });
    console.log('\n===== 3) Ordens de Serviço usadas pela Geodeep (nome -> qtd) =====');
    Object.entries(osDaGeo).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`   "${k}" -> ${v}`));

    console.log('\n>>> PRONTO. Cole tudo no chat. <<<\n');
  } catch(e){ console.log('ERRO:', e.message); }
})();






















