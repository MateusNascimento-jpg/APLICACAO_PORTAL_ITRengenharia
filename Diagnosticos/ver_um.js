// ver_um.js — acha sozinho UM trabalho aprovado e mostra como o PDF chega
require('dotenv').config();
const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const API = `https://api.airtable.com/v0/${BASE}`;
const TBL = 'tblJAP4Av9sWm8SmL';

(async () => {
  const formula = encodeURIComponent("{Aprovação} = 'Aprovado'");
  const url = `${API}/${TBL}?filterByFormula=${formula}&pageSize=3`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const dados = await resp.json();
  if (!resp.ok) { console.log('ERRO:', dados.error?.message || JSON.stringify(dados)); return; }
  if (!dados.records || dados.records.length === 0) {
    console.log('Nenhum trabalho com Aprovacao = "Aprovado" foi encontrado.');
    return;
  }
  dados.records.forEach((rec, i) => {
    const f = rec.fields;
    console.log(`\n--- APROVADO ${i + 1} (${f['ID Trabalho']}) ---`);
    console.log('record id           :', rec.id);
    console.log('Aprovacao           :', JSON.stringify(f['Aprovação']));
    console.log('Status Cliente      :', JSON.stringify(f['Status Cliente']));
    console.log('Relatorios_Aprovados:', JSON.stringify(f['Relatórios_Aprovados'], null, 2));
  });
})(); 