// ver_aprovado.js — mostra como chegam os campos da feature de aprovacao (SO LEITURA)
require('dotenv').config();
const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const API = `https://api.airtable.com/v0/${BASE}`;
const TBL = 'tblJAP4Av9sWm8SmL'; // Novos Trabalhos

(async () => {
  const formula = encodeURIComponent("LEFT({ID Trabalho}, 8) = 'GEODEEP_'");
  const url = `${API}/${TBL}?filterByFormula=${formula}&pageSize=8`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const dados = await resp.json();
  if (!resp.ok) { console.log('ERRO:', dados.error?.message || JSON.stringify(dados)); return; }

  (dados.records || []).forEach((rec, i) => {
    const f = rec.fields;
    console.log(`\n--- TRABALHO ${i + 1} (${f['ID Trabalho']}) ---`);
    console.log('record id           :', rec.id);
    console.log('Status              :', JSON.stringify(f['Status']));
    console.log('Status Cliente      :', JSON.stringify(f['Status Cliente']));
    console.log('Aprovacao           :', JSON.stringify(f['Aprovação']));
    console.log('Relatorios_Aprovados:', JSON.stringify(f['Relatórios_Aprovados']));
    console.log('Relatorios (antigo) :', Array.isArray(f['Relatórios'])
      ? f['Relatórios'].map(a => ({ nome: a.filename, tipo: a.type })) : f['Relatórios']);
  });
  console.log('\n(Campo "undefined" = nome/grafia diferente no Airtable. Me manda tudo isso.)');
})(); 
