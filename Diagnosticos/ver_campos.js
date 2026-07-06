// ver_campos.js — lista TODOS os campos da tabela Novos Trabalhos (existam dados ou nao)
require('dotenv').config();
const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;

(async () => {
  const url = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const dados = await resp.json();
  if (!resp.ok) { console.log('ERRO:', dados.error?.message || JSON.stringify(dados)); return; }

  const tabela = (dados.tables || []).find(t => t.id === 'tblJAP4Av9sWm8SmL');
  if (!tabela) { console.log('Tabela tblJAP4Av9sWm8SmL nao encontrada.'); return; }

  console.log('\n=== TABELA:', tabela.name, '===\n');
  tabela.fields.forEach(f => {
    console.log(`"${f.name}"  [tipo: ${f.type}]`);
  });
  console.log('\n(Procure por algo parecido com "Aprovacao" e "Relatorios Aprovados". Me manda a lista toda.)');
})();