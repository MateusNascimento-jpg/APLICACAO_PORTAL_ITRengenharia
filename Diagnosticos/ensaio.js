// ver_ensaio.js — diagnóstico final
require('dotenv').config();

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const API = `https://api.airtable.com/v0/${BASE}`;
const TBL_NOVOS_TRABALHOS = 'tblJAP4Av9sWm8SmL';

(async () => {
  try {
    const formula = encodeURIComponent("LEFT({ID Trabalho}, 8) = 'GEODEEP_'");
    const url = `${API}/${TBL_NOVOS_TRABALHOS}?filterByFormula=${formula}&pageSize=5`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const dados = await resp.json();
    if (!resp.ok) { console.log('ERRO:', dados.error?.message || dados); return; }

    (dados.records || []).forEach((rec, i) => {
      const f = rec.fields;
      console.log(`\n===== TRABALHO ${i + 1} =====`);
      console.log('ID Trabalho   :', f['ID Trabalho']);
      console.log('Ensaios       :', JSON.stringify(f['Ensaios']));
      console.log('Link Ensaios  :', JSON.stringify(f['Link Ensaios']));
      console.log('Nome da Amostra:', JSON.stringify(f['Nome da Amostra']));
      // lista só os anexos: nome + tipo (sem as URLs gigantes)
      const anexos = Array.isArray(f['Relatórios']) ? f['Relatórios'] : [];
      console.log('Anexos        :', anexos.map(a => ({ nome: a.filename, tipo: a.type })));
    });
  } catch (e) {
    console.log('Falhou:', e.message);
  }
})(); 
