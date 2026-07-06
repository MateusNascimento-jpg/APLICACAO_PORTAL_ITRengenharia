// ver_cnpj2.js — confirma que TRIM resolve o espaço no CNPJ
require('dotenv').config();
const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const API = `https://api.airtable.com/v0/${BASE}`;
const TBL_CLIENTES = 'tblkQxQ6q7cBKXZ3C';
const CNPJ_TESTE = '11222333000181';

(async () => {
  const formula = encodeURIComponent(`TRIM({CNPJ}) = '${CNPJ_TESTE}'`);
  const url = `${API}/${TBL_CLIENTES}?filterByFormula=${formula}&maxRecords=3`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const dados = await resp.json();
  if (!resp.ok) { console.log('ERRO:', dados.error?.message); return; }
  console.log('Encontrados:', (dados.records || []).length);
  (dados.records || []).forEach(rec => {
    console.log('  rec id:', rec.id, '| Nome:', rec.fields['Nome Cliente']);
  });
})();