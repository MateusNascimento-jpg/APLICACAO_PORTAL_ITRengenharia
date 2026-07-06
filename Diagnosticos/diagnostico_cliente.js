// diagnostico_cliente.js
// Mostra todos os campos preenchidos de UM cliente, para descobrir
// onde estão os trabalhos/relatórios vinculados.
require('dotenv').config();

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const API = `https://api.airtable.com/v0/${BASE}`;

const TBL_CLIENTES = 'tblkQxQ6q7cBKXZ3C';

// >>> COLE AQUI O recordId do cliente Geodeep <<<
const RECORD_ID_CLIENTE = 'rectEDZrt5unCtR4Z';

async function main() {
    const resp = await fetch(`${API}/${TBL_CLIENTES}/${RECORD_ID_CLIENTE}`, {
        headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const dados = await resp.json();

    if (!resp.ok) {
        console.log('ERRO:', JSON.stringify(dados, null, 2));
        return;
    }

    console.log('\n=== CAMPOS PREENCHIDOS DO CLIENTE ===\n');
    const campos = dados.fields;
    for (const nome in campos) {
        let valor = campos[nome];
        // Se for array de links (rec...), mostra a quantidade
        if (Array.isArray(valor)) {
            const ehLink = typeof valor[0] === 'string' && valor[0].startsWith('rec');
            console.log(`"${nome}": ${valor.length} item(ns)` + (ehLink ? '  <-- LINKS para outra tabela' : '') + `  ${JSON.stringify(valor).slice(0, 80)}`);
        } else {
            console.log(`"${nome}": ${JSON.stringify(valor).slice(0, 80)}`);
        }
    }
    console.log('\nPronto. Copie tudo e me mande.');
}

main().catch(e => console.error('Falhou:', e.message));

