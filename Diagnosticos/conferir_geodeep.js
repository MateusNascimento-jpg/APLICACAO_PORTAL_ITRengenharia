/* =======================================================================
   conferir_ensaios_geodeep.js
   -----------------------------------------------------------------------
   PROVA DE ISOLAMENTO: lista, para a GEODEEP, cada TIPO DE ENSAIO que
   aparece nos trabalhos dela, com a CONTAGEM de quantos trabalhos tem
   aquele tipo. Assim voce confere com os proprios olhos se os tipos que
   aparecem no filtro do portal sao realmente so os da Geodeep. */

'use strict';
require('dotenv').config();

const TOKEN =
  process.env.AIRTABLE_TOKEN ||
  process.env.AIRTABLE_API_KEY ||
  process.env.AIRTABLE_PAT;
const BASE_ID =
  process.env.AIRTABLE_BASE_ID ||
  process.env.BASE_ID;

if (!TOKEN || !BASE_ID) {
  console.error('\n[ERRO] Faltou AIRTABLE_TOKEN/AIRTABLE_BASE_ID no .env\n');
  process.exit(1);
}

const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`;
const TBL_NOVOS_TRABALHOS = 'tblJAP4Av9sWm8SmL';
const TBL_CLIENTES = 'tblkQxQ6q7cBKXZ3C';

const GEODEEP_REC = 'rectEDZrt5unCtR4Z';
const GEODEEP_PREFIXO = 'GEODEEP_';

const H = { headers: { Authorization: `Bearer ${TOKEN}` } };
const dorme = (ms) => new Promise(r => setTimeout(r, ms));

async function get(url, tentativas = 4) {
  for (let i = 1; i <= tentativas; i++) {
    const r = await fetch(url, H);
    if (r.status === 429) { await dorme(1200 * i); continue; }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }
  throw new Error('Falhou apos varias tentativas.');
}

// Le TODOS os registros de uma tabela (paginado)
async function lerTudo(tabelaId) {
  let registros = [];
  let offset = null;
  do {
    let url = `${BASE_URL}/${encodeURIComponent(tabelaId)}?pageSize=100`;
    if (offset) url += `&offset=${encodeURIComponent(offset)}`;
    const d = await get(url);
    registros = registros.concat(d.records || []);
    offset = d.offset || null;
    await dorme(220);
  } while (offset);
  return registros;
}

function primeiro(v) {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// Resolve o nome do ensaio do mesmo jeito que o airtable.js corrigido faz:
// 1) Nome_Completo_Ensaios; 2) cai na sigla de Link Ensaios
function nomeEnsaio(f) {
  const nc = primeiro(f['Nome_Completo_Ensaios ']) || primeiro(f['Nome_Completo_Ensaios']);
  if (nc && String(nc).trim()) return String(nc).trim();
  const sigla = primeiro(f['Link Ensaios']);
  return sigla ? String(sigla).trim() : '(sem ensaio)';
}

(async () => {
  try {
    console.log('Lendo todos os trabalhos (pode levar alguns segundos)...\n');
    const todos = await lerTudo(TBL_NOVOS_TRABALHOS);
    console.log(`Total de trabalhos na base inteira: ${todos.length}\n`);

    // Separa os da Geodeep (pelo campo Cliente = rec da Geodeep)
    const daGeodeep = todos.filter(r => {
      const cli = JSON.stringify(r.fields['Cliente'] || '');
      return cli.includes(GEODEEP_REC);
    });

    // Tambem separa pelo prefixo do ID Trabalho (o filtro que o portal usa),
    // para conferir se os dois criterios batem.
    const porPrefixo = todos.filter(r =>
      String(r.fields['ID Trabalho'] || '').startsWith(GEODEEP_PREFIXO)
    );

    console.log(`Trabalhos da Geodeep (pelo campo "Cliente"):     ${daGeodeep.length}`);
    console.log(`Trabalhos da Geodeep (pelo prefixo "GEODEEP_"):  ${porPrefixo.length}`);
    console.log(daGeodeep.length === porPrefixo.length
      ? '   -> OS DOIS CRITERIOS BATEM (isolamento consistente).\n'
      : '   -> ATENCAO: os criterios divergem! vale investigar.\n');

    // Conta tipos de ensaio DA GEODEEP
    const contGeodeep = {};
    daGeodeep.forEach(r => {
      const nome = nomeEnsaio(r.fields);
      contGeodeep[nome] = (contGeodeep[nome] || 0) + 1;
    });

    // Conta tipos de ensaio na BASE INTEIRA (para comparar)
    const contTodos = {};
    todos.forEach(r => {
      const nome = nomeEnsaio(r.fields);
      contTodos[nome] = (contTodos[nome] || 0) + 1;
    });

    const tiposGeodeep = Object.keys(contGeodeep).sort((a, b) =>
      a.localeCompare(b, 'pt', { sensitivity: 'base' }));

    console.log('========================================================');
    console.log(`TIPOS DE ENSAIO DA GEODEEP: ${tiposGeodeep.length} tipos distintos`);
    console.log('(estes sao EXATAMENTE os que devem aparecer no filtro dela)');
    console.log('========================================================');
    tiposGeodeep.forEach(nome => {
      console.log(`   ${String(contGeodeep[nome]).padStart(4)}x  ${nome}`);
    });

    console.log('\n========================================================');
    console.log(`PARA COMPARACAO — TIPOS NA BASE INTEIRA: ${Object.keys(contTodos).length} tipos`);
    console.log('========================================================');
    // Mostra quais tipos existem na base mas NAO na Geodeep (prova que ela nao ve tudo)
    const soOutros = Object.keys(contTodos)
      .filter(n => !contGeodeep[n])
      .sort((a, b) => a.localeCompare(b, 'pt', { sensitivity: 'base' }));
    if (soOutros.length) {
      console.log('Tipos que existem na base mas a Geodeep NAO tem (e nao deve ver):');
      soOutros.forEach(n => console.log(`        -  ${n}  (${contTodos[n]}x em outros clientes)`));
    } else {
      console.log('A Geodeep tem trabalhos de TODOS os tipos existentes na base.');
      console.log('(Por isso o filtro dela mostra muitos — e correto.)');
    }

    console.log('\n>>> Funcionando.... <<<');
  } catch (e) {
    console.error('\n[ERRO] ' + e.message + '\n');
    process.exit(1);
  }
})();