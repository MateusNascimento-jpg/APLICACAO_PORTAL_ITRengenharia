// teste_filtro.js — descobre como filtrar Novos Trabalhos pelo cliente.
require('dotenv').config();
const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const API = `https://api.airtable.com/v0/${BASE}`;
const TBL = 'tblJAP4Av9sWm8SmL';
const REC = 'rectEDZrt5unCtR4Z'; // Geodeep

async function get(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const d = await r.json();
  return { ok: r.ok, d };
}

function resultado(rotulo, r) {
  if (r.ok) {
    console.log(rotulo + ' -> ' + (r.d.records ? r.d.records.length : 0) + ' resultados');
  } else {
    console.log(rotulo + ' -> ERRO: ' + (r.d.error && r.d.error.message));
  }
}

(async () => {
  // O que o Airtable guarda em {Cliente} e {Clientes2}?
  console.log('--- Conteudo de {Cliente} e {Clientes2} no 1o registro ---');
  const amostra = await get(`${API}/${TBL}?maxRecords=1`);
  const f = amostra.d.records && amostra.d.records[0] ? amostra.d.records[0].fields : {};
  console.log('Cliente   =', JSON.stringify(f['Cliente']));
  console.log('Clientes2 =', JSON.stringify(f['Clientes2']));
  console.log('');

  // Teste A: FIND do rec dentro de ARRAYJOIN(Clientes2)
  const fA = encodeURIComponent(`FIND('${REC}', ARRAYJOIN({Clientes2}))`);
  resultado('[A] FIND rec em Clientes2', await get(`${API}/${TBL}?filterByFormula=${fA}&maxRecords=3`));

  // Teste B: nome do cliente no campo Cliente
  const fB = encodeURIComponent(`{Cliente}='Geodeep'`); 
  resultado('[B] {Cliente}=Geodeep', await get(`${API}/${TBL}?filterByFormula=${fB}&maxRecords=3`));
 
  // Teste C: FIND do nome dentro de ARRAYJOIN(Cliente)
  const fC = encodeURIComponent(`FIND('Geodeep', ARRAYJOIN({Cliente}))`);
  resultado('[C] FIND Geodeep em Cliente', await get(`${API}/${TBL}?filterByFormula=${fC}&maxRecords=3`));

  // Teste D: ID Trabalho comeca com GEODEEP_
  const fD = encodeURIComponent(`LEFT({ID Trabalho},8)='GEODEEP_'`);
  resultado('[D] ID Trabalho comeca GEODEEP_', await get(`${API}/${TBL}?filterByFormula=${fD}&maxRecords=3`));

  console.log('');
  console.log('>>> Me diga qual (A/B/C/D) retornou resultados maior que 0.');
})();  