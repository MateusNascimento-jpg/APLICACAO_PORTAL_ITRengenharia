// inspecionar_airtable.js
// Roda uma vez só, para descobrir nomes de tabelas e campos da base.
require('dotenv').config();

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;

async function main() {
    // 1. Lista as tabelas da base
    const metaResp = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, {
        headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const meta = await metaResp.json();

    if (!meta.tables) {
        console.log('ERRO:', JSON.stringify(meta, null, 2));
        return;
    }

    for (const tabela of meta.tables) {
        console.log('\n=========================================');
        console.log('TABELA:', tabela.name);
        console.log('  (id da tabela:', tabela.id, ')');
        console.log('  CAMPOS:');
        tabela.fields.forEach(f => {
            console.log(`   - "${f.name}"  [tipo: ${f.type}]`);
        });
    } 
    console.log('\n=========================================');
    console.log('Pronto. Copie tudo acima e me mande.');
}

main().catch(e => console.error('Falhou:', e.message));