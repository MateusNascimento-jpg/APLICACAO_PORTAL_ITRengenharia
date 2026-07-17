// inspecionar_comercial.js
// -------------------------------------------------------------------------
// Lê as 3 tabelas comerciais da base 2 que faltam pra fechar o mapa:
//   Clientes  (tbl8Sw1hYuEvgot8O)
//   Proposta  (tblTzY3Iggkhydke2)
//   Contratos (tblxokBaJhPpLuljO)
//
// Objetivo: descobrir a CHAVE que liga o cliente da base 2 com o da base 1
// (aposta: CNPJ) e entender como Proposta/Contrato se amarram ao cliente.
//
// RODAR (PowerShell):
//   node inspecionar_comercial.js SEU_TOKEN
// -------------------------------------------------------------------------

const fs = require('fs');

const TOKEN = process.argv[2] || process.env.AIRTABLE_TOKEN;
const BASE = process.argv[3] || 'appI163NTfZrDtw22';
const AMOSTRA = 4;

const ALVOS = [
    { nome: 'Clientes',  id: 'tbl8Sw1hYuEvgot8O' },
    { nome: 'Proposta',  id: 'tblTzY3Iggkhydke2' },
    { nome: 'Contratos', id: 'tblxokBaJhPpLuljO' }
];

if (!TOKEN) {
    console.error('\n[ERRO] Informe o token:  node inspecionar_comercial.js SEU_TOKEN\n');
    process.exit(1);
}

async function getJson(url) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados && dados.error ? JSON.stringify(dados.error) : `HTTP ${resp.status}`);
    return dados;
}

function resumir(v) {
    if (v == null) return null;
    if (Array.isArray(v)) return v.map(item => {
        if (item && typeof item === 'object') {
            if (item.filename) return `[anexo: ${item.filename}]`;
            if (item.id && String(item.id).startsWith('rec')) return `[link: ${item.id}]`;
            if (item.name) return item.name;
            return '[obj]';
        }
        return item;
    });
    if (typeof v === 'object') { if (v.filename) return `[anexo: ${v.filename}]`; if (v.name) return v.name; return '[obj]'; }
    if (typeof v === 'string' && v.length > 120) return v.slice(0, 120) + '…';
    return v;
}

(async () => {
    const saida = { gerado_em: new Date().toISOString(), base: BASE, tabelas: [] };

    // pega os tipos de campo via Meta API (uma vez), pra marcar links e CNPJ
    let metaPorId = {};
    try {
        const meta = await getJson(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`);
        (meta.tables || []).forEach(t => { metaPorId[t.id] = t.fields || []; });
    } catch (e) {
        console.log(`[aviso] não consegui a Meta API (${e.message}); sigo só com os dados.`);
    }

    for (const alvo of ALVOS) {
        console.log('\n' + '='.repeat(70));
        console.log(` TABELA: ${alvo.nome}   (${alvo.id})`);
        console.log('='.repeat(70));

        const bloco = { nome: alvo.nome, id: alvo.id, campos: [], amostras: [] };

        // campos + tipos (da Meta API)
        const fields = metaPorId[alvo.id] || [];
        if (fields.length) {
            console.log('  Campos:');
            fields.forEach(f => {
                const liga = f.options && f.options.linkedTableId ? `  --> LINK para ${f.options.linkedTableId}` : '';
                const opc = f.options && f.options.choices ? `  opções: [${f.options.choices.map(c => c.name).join(', ')}]` : '';
                const cnpjMark = /cnpj/i.test(f.name) ? '   <<< possível CHAVE (CNPJ)' : '';
                console.log(`    • ${f.name}  (${f.type})${liga}${opc}${cnpjMark}`);
                bloco.campos.push({ nome: f.name, tipo: f.type, ligaCom: f.options?.linkedTableId || null });
            });
        }

        // amostra registros
        try {
            const dados = await getJson(`https://api.airtable.com/v0/${BASE}/${alvo.id}?maxRecords=${AMOSTRA}`);
            const recs = dados.records || [];
            console.log(`\n  Amostra (${recs.length} registro(s)):`);
            recs.forEach((rec, i) => {
                const linha = {};
                Object.keys(rec.fields).forEach(k => { linha[k] = resumir(rec.fields[k]); });
                console.log(`    [${i + 1}] ${rec.id}`);
                Object.keys(linha).forEach(k => console.log(`         ${k}: ${JSON.stringify(linha[k])}`));
                console.log('');
                bloco.amostras.push({ id: rec.id, fields: linha });
            });
        } catch (e) {
            console.log(`  [erro ao amostrar: ${e.message}]`);
            bloco.erro = e.message;
        }

        saida.tabelas.push(bloco);
    }

    fs.writeFileSync('diagnostico_comercial.json', JSON.stringify(saida, null, 2), 'utf8');
    console.log('='.repeat(70));
    console.log(' PRONTO. Arquivo: diagnostico_comercial.json — cole aqui o conteúdo.');
    console.log('='.repeat(70) + '\n');
})();