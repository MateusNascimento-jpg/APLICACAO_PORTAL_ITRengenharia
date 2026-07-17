// inspecionar_faturamento.js
// -------------------------------------------------------------------------
// Foco: a tabela FATURAMENTO (tblvUnZNEkp6jKCFr) da base financeira, que
// não apareceu no diagnóstico anterior. É onde estão as PROPOSTAS por cliente.
//
// Faz 3 coisas:
//   1) Lista TODAS as tabelas que o token enxerga (pra ver se Faturamento some).
//   2) Vai DIRETO na tabela Faturamento pelo ID e amostra registros.
//   3) Mostra os campos reais desses registros (útil mesmo se a Meta API esconder).
//
// COMO RODAR (PowerShell):
//   node inspecionar_faturamento.js SEU_TOKEN
//   (opcional) node inspecionar_faturamento.js SEU_TOKEN appI163NTfZrDtw22
// -------------------------------------------------------------------------

const fs = require('fs');

const TOKEN = process.argv[2] || process.env.AIRTABLE_TOKEN;
const BASE = process.argv[3] || 'appI163NTfZrDtw22';
const TBL_FATURAMENTO = 'tblvUnZNEkp6jKCFr';
const AMOSTRA = 5;

if (!TOKEN) {
    console.error('\n[ERRO] Informe o token:  node inspecionar_faturamento.js SEU_TOKEN\n');
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
    const saida = { gerado_em: new Date().toISOString(), base: BASE };

    // 1) TODAS as tabelas via Meta API
    console.log('='.repeat(70));
    console.log(' 1) TABELAS QUE O TOKEN ENXERGA (Meta API)');
    console.log('='.repeat(70));
    try {
        const meta = await getJson(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`);
        saida.tabelas_meta = (meta.tables || []).map(t => ({ nome: t.name, id: t.id }));
        (meta.tables || []).forEach(t => {
            const marca = t.id === TBL_FATURAMENTO ? '  <<< FATURAMENTO (achou!)' : '';
            console.log(`  • ${t.name}   (${t.id})${marca}`);
        });
        const achou = (meta.tables || []).some(t => t.id === TBL_FATURAMENTO);
        console.log(achou
            ? '\n  --> Faturamento ESTÁ visível na Meta API.'
            : '\n  --> Faturamento NÃO apareceu na Meta API. Vamos tentar direto pelo ID abaixo.');
    } catch (e) {
        console.error(`  [erro Meta API] ${e.message}`);
        saida.erro_meta = e.message;
    }

    // 2) e 3) DIRETO na tabela Faturamento pelo ID (não depende da Meta API)
    console.log('\n' + '='.repeat(70));
    console.log(' 2) LENDO A TABELA FATURAMENTO DIRETO PELO ID');
    console.log('='.repeat(70));
    try {
        const dados = await getJson(`https://api.airtable.com/v0/${BASE}/${TBL_FATURAMENTO}?maxRecords=${AMOSTRA}`);
        const recs = dados.records || [];
        console.log(`  Registros lidos: ${recs.length}\n`);

        // descobre o conjunto de campos a partir dos registros reais
        const camposVistos = new Set();
        recs.forEach(r => Object.keys(r.fields).forEach(k => camposVistos.add(k)));
        console.log(`  Campos encontrados (${camposVistos.size}):`);
        [...camposVistos].forEach(c => console.log(`    • ${c}`));
        console.log('');

        const amostras = recs.map(rec => {
            const linha = {};
            Object.keys(rec.fields).forEach(k => { linha[k] = resumir(rec.fields[k]); });
            return { id: rec.id, fields: linha };
        });
        amostras.forEach((a, i) => {
            console.log(`  [${i + 1}] ${a.id}`);
            Object.keys(a.fields).forEach(k => console.log(`       ${k}: ${JSON.stringify(a.fields[k])}`));
            console.log('');
        });

        saida.faturamento = { campos: [...camposVistos], amostras };
    } catch (e) {
        console.error(`  [erro ao ler Faturamento pelo ID] ${e.message}`);
        console.error('  Se for erro de permissão/NOT_FOUND, a tabela está fora do escopo do token.');
        saida.erro_faturamento = e.message;
    }

    fs.writeFileSync('diagnostico_faturamento.json', JSON.stringify(saida, null, 2), 'utf8');
    console.log('='.repeat(70));
    console.log(' PRONTO. Arquivo: diagnostico_faturamento.json — cole aqui o conteúdo.');
    console.log('='.repeat(70) + '\n');
})();