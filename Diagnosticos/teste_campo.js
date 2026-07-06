// teste_campos.js
// Descobre os nomes dos campos da tabela "Novos Trabalhos" e como o trabalho
// se liga ao cliente. Rode uma vez com: node teste_campos.js
require('dotenv').config();
s
const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const API = `https://api.airtable.com/v0/${BASE}`;

const TBL_CLIENTES = 'tblkQxQ6q7cBKXZ3C';
const TBL_NOVOS_TRABALHOS = 'tblJAP4Av9sWm8SmL';

// rec do Geodeep (o mesmo usado no usuário de teste). Troque se precisar.
const REC_CLIENTE = 'rectEDZrt5unCtR4Z';

async function get(url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'erro');
    return d;
}

(async () => {
    try {
        // 1. Pega o nome do cliente e quantos trabalhos ele tem
        const cli = await get(`${API}/${TBL_CLIENTES}/${REC_CLIENTE}`);
        const nome = cli.fields['Nome Cliente'];
        const ids = cli.fields['Novos Trabalhos 2'] || [];
        console.log('\n=== CLIENTE ===');
        console.log('Nome:', nome);
        console.log('Qtd em "Novos Trabalhos 2":', ids.length);

        // 2. Pega 1 trabalho qualquer e mostra TODOS os campos dele
        const um = await get(`${API}/${TBL_NOVOS_TRABALHOS}?maxRecords=1`);
        const campos = um.records?.[0]?.fields || {};
        console.log('\n=== CAMPOS DA TABELA "Novos Trabalhos" ===');
        Object.keys(campos).forEach(k => {
            let v = campos[k];
            if (Array.isArray(v)) v = '[array com ' + v.length + ' item(ns)] ex: ' + JSON.stringify(v[0]);
            else v = JSON.stringify(v);
            console.log(' • ' + k + '  ->  ' + String(v).slice(0, 80));
        });

        console.log('\n>>> Procure acima o campo que aponta para o CLIENTE (algo como "Cliente").');
        console.log('>>> E confirme os campos de data ("Data de Envio do Relatório", etc.).');
    } catch (e) {
        console.error('ERRO:', e.message);
    }
})();