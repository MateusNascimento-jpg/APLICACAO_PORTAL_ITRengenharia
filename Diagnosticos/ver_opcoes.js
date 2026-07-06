// ver_opcoes.js — mostra as opcoes exatas dos campos singleSelect "Aprovacao" e "Status"
require('dotenv').config();
const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;

(async () => {
  const url = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const dados = await resp.json();
  if (!resp.ok) { console.log('ERRO:', dados.error?.message || JSON.stringify(dados)); return; }

  const tabela = (dados.tables || []).find(t => t.id === 'tblJAP4Av9sWm8SmL');
  ['Aprovação', 'Status'].forEach(nome => {
    const campo = tabela.fields.find(f => f.name === nome);
    console.log(`\n=== Opcoes de "${nome}" ===`);
    if (!campo) { console.log('  (campo nao encontrado)'); return; }
    (campo.options?.choices || []).forEach(c => console.log(`  "${c.name}"`));
  });
})();s