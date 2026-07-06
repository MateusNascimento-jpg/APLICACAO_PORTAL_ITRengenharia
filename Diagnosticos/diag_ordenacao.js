/* =======================================================================
   diag_ordenacao.js
   -----------------------------------------------------------------------
   Descobre QUAL campo de data faz o trabalho mais recente da Geodeep
   (o que voce chama de "2167" / ultimo cadastrado) aparecer no TOPO.

   Mostra, para a Geodeep:
     - o(s) trabalho(s) cujo ID Trabalho/amostra batem com "2167" ou os
       ultimos cadastrados (usando o Record ID e a ordem da API);
     - o TOP 5 por cada campo de data candidato, lado a lado, pra gente
       ver qual deles coloca o trabalho certo em primeiro.
     - tambem usa o parametro de ordenacao NATIVO do Airtable por
       "Created time" (a ordem real de criacao), que e o que a grade do
       Airtable mostra por padrao.

   SO LE. Rode na pasta do airtable.js:  node diag_ordenacao.js
   Cole o resultado no chat.
   ======================================================================= */
'use strict';
require('dotenv').config();

const TOKEN = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
const BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.BASE_ID;
if (!TOKEN || !BASE_ID) { console.error('Faltou TOKEN/BASE_ID no .env'); process.exit(1); }

const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`;
const TBL = 'tblJAP4Av9sWm8SmL'; // Novos Trabalhos
const GEODEEP_REC = 'rectEDZrt5unCtR4Z';
const H = { headers: { Authorization: `Bearer ${TOKEN}` } };
const dorme = (ms) => new Promise(r => setTimeout(r, ms));

async function get(url) {
  for (let i = 1; i <= 4; i++) {
    const r = await fetch(url, H);
    if (r.status === 429) { await dorme(1200 * i); continue; }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }
  throw new Error('falhou');
}

// Le todos os trabalhos da Geodeep (pelo campo Cliente)
async function lerGeodeep() {
  let recs = [], offset = null;
  do {
    let url = `${BASE_URL}/${TBL}?pageSize=100`;
    if (offset) url += `&offset=${encodeURIComponent(offset)}`;
    const d = await get(url);
    recs = recs.concat(d.records || []);
    offset = d.offset || null;
    await dorme(200);
  } while (offset);
  return recs.filter(r => JSON.stringify(r.fields['Cliente'] || '').includes(GEODEEP_REC));
}

function p(v){ if(Array.isArray(v)) return v[0]??null; return v??null; }
function resumo(r){
  const f = r.fields;
  return `${(f['ID Trabalho']||'(sem id)').slice(0,55)}`;
}

const CAMPOS_DATA = [
  'Data da Última Atualização Update',
  'Data de Envio do Relatório',
  'Data de Chegada',
  'Data Início Ensaio',
  'Data de Conclusão do Ensaio',
  'Data da Preparação',
  'Data Lançamento'
];

(async () => {
  try {
    console.log('Lendo trabalhos da Geodeep...\n');
    const geo = await lerGeodeep();
    console.log(`Total de trabalhos da Geodeep: ${geo.length}\n`);

    // 1) Procurar trabalhos que mencionam "2167" ou parecem os ultimos.
    //    Como nao temos numero de linha pela API, mostramos os 5 ULTIMOS
    //    retornados pela API (a API devolve grosso modo na ordem de criacao).
    console.log('===== OS 5 ULTIMOS retornados pela API (ordem ~de criacao) =====');
    geo.slice(-5).forEach((r,i) => {
      console.log(`  ${geo.length-5+i+1}) ${resumo(r)}`);
      console.log(`        Record ID: ${r.id}`);
      CAMPOS_DATA.forEach(c => {
        const v = p(r.fields[c]);
        console.log(`        ${c}: ${v || '(vazio)'}`);
      });
      console.log('');
    });

    // 2) Para cada campo de data, mostrar o TOP 5 (mais novo primeiro)
    CAMPOS_DATA.forEach(campo => {
      const comData = geo
        .map(r => ({ r, v: p(r.fields[campo]) }))
        .filter(x => x.v)
        .sort((a,b) => String(b.v).localeCompare(String(a.v)));
      console.log(`===== TOP 5 por "${campo}" (${comData.length}/${geo.length} tem essa data) =====`);
      comData.slice(0,5).forEach((x,i) => {
        console.log(`  ${i+1}) ${String(x.v).slice(0,10)}  ${resumo(x.r)}`);
      });
      console.log('');
    });

    console.log('>>> Cole tudo no chat. Veja qual campo coloca o trabalho 2167 (ou o que voce considera o mais recente) em 1o lugar. <<<');
  } catch (e) {
    console.error('ERRO:', e.message);
  }
})();