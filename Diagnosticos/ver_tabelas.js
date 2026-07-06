// ver_tabelas.js — lista todas as tabelas da base e seus campos
require('dotenv').config();

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;

(async () => {
  try {
    const url = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const dados = await resp.json();

    if (!resp.ok) {
      console.log('ERRO:', dados.error?.message || JSON.stringify(dados));
      console.log('\n(Se o erro for de permissão, seu token não tem o escopo "schema.bases:read". Me avise.)');
      return;
    }

    (dados.tables || []).forEach(t => {
      console.log(`\n===== TABELA: ${t.name}  (${t.id}) =====`);
      console.log('Campos:', t.fields.map(f => f.name));
    });
  } catch (e) {
    console.log('Falhou:', e.message);
  }
})();  
