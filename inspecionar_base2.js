// inspecionar_base2.js
// -------------------------------------------------------------------------
// DIAGNÓSTICO READ-ONLY da(s) base(s) do Airtable.
// NÃO escreve nada. Só lê o schema (Meta API) e amostra alguns registros
// de cada tabela para entendermos fields, tipos e RELAÇÕES.
//
// COMO RODAR (na pasta do backend, onde está o .env):
//   node inspecionar_base2.js
//
// PRÉ-REQUISITOS no .env (só precisa do token; os IDs já estão embutidos
// abaixo, mas se preferir, pode sobrescrever por variável de ambiente):
//   AIRTABLE_TOKEN=seu_PAT   (precisa enxergar a base 2 e ter schema.bases:read + data.records:read)
//
// Ele gera:
//   - saída no terminal (resumo legível)
//   - um arquivo  diagnostico_base2.json  (schema completo + amostras) pra você colar aqui.
// -------------------------------------------------------------------------

require('dotenv').config();
const fs = require('fs');

const TOKEN = process.env.AIRTABLE_TOKEN;

// Base 2 (financeira). Pode trocar pelo .env se quiser.
const BASE_2 = process.env.AIRTABLE_BASE_ID_2 || 'appI163NTfZrDtw22';
// Base 1 (relatórios) — opcional, só pra comparar as chaves de ligação.
// Deixe null pra pular. Se quiser incluir, o script já lê do .env atual.
const BASE_1 = process.env.AIRTABLE_BASE_ID || null;

const META = (baseId) => `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
const DATA = (baseId, tableId) => `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}`;

const AMOSTRA_POR_TABELA = 3; // quantos registros amostrar por tabela

if (!TOKEN) {
    console.error('\n[ERRO] Falta AIRTABLE_TOKEN no .env.\n');
    process.exit(1);
}

async function getJson(url) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const dados = await resp.json();
    if (!resp.ok) {
        const msg = dados && dados.error ? JSON.stringify(dados.error) : `HTTP ${resp.status}`;
        throw new Error(msg);
    }
    return dados;
}

// Resume o valor de um campo pra caber no log sem despejar anexos gigantes.
function resumirValor(v) {
    if (v == null) return null;
    if (Array.isArray(v)) {
        // arrays de anexo: mostra só nome/tipo; arrays comuns: mostra os itens
        return v.map(item => {
            if (item && typeof item === 'object') {
                if (item.filename) return `[anexo: ${item.filename}]`;
                if (item.id && item.id.startsWith && item.id.startsWith('rec')) return `[link: ${item.id}]`;
                if (item.name) return item.name;
                return '[obj]';
            }
            return item;
        });
    }
    if (typeof v === 'object') {
        if (v.filename) return `[anexo: ${v.filename}]`;
        if (v.name) return v.name;
        return '[obj]';
    }
    if (typeof v === 'string' && v.length > 80) return v.slice(0, 80) + '…';
    return v;
}

async function inspecionarBase(rotulo, baseId) {
    console.log('\n' + '='.repeat(70));
    console.log(` BASE: ${rotulo}  (${baseId})`);
    console.log('='.repeat(70));

    const relatorio = { rotulo, baseId, tabelas: [] };

    let meta;
    try {
        meta = await getJson(META(baseId));
    } catch (e) {
        console.error(`\n[ERRO ao ler o schema desta base] ${e.message}`);
        console.error('Verifique se o token enxerga esta base e tem o escopo schema.bases:read.\n');
        relatorio.erro = e.message;
        return relatorio;
    }

    const tabelas = meta.tables || [];
    console.log(`\nTabelas encontradas: ${tabelas.length}\n`);

    for (const tab of tabelas) {
        console.log('-'.repeat(70));
        console.log(`TABELA: "${tab.name}"   id=${tab.id}   campoPrimario=${tab.primaryFieldId}`);
        const campos = (tab.fields || []).map(f => ({
            id: f.id,
            nome: f.name,
            tipo: f.type,
            // pra campos de link, guarda pra qual tabela liga (é o ouro das relações)
            ligaCom: f.options && f.options.linkedTableId ? f.options.linkedTableId : null,
            opcoes: f.options && f.options.choices ? f.options.choices.map(c => c.name) : null
        }));

        console.log(`  Campos (${campos.length}):`);
        campos.forEach(c => {
            let extra = '';
            if (c.ligaCom) extra = `  --> LINK para tabela ${c.ligaCom}`;
            if (c.opcoes) extra = `  opções: [${c.opcoes.join(', ')}]`;
            console.log(`    • ${c.nome}  (${c.tipo})${extra}`);
        });

        // amostra alguns registros pra ver valores reais (ajuda a identificar
        // qual campo guarda CNPJ, nome do cliente, etc.)
        let amostras = [];
        try {
            const dados = await getJson(DATA(baseId, tab.id) + `?maxRecords=${AMOSTRA_POR_TABELA}`);
            amostras = (dados.records || []).map(rec => {
                const linha = {};
                Object.keys(rec.fields).forEach(k => { linha[k] = resumirValor(rec.fields[k]); });
                return { id: rec.id, fields: linha };
            });
        } catch (e) {
            console.log(`  [não foi possível amostrar registros: ${e.message}]`);
        }

        if (amostras.length) {
            console.log(`  Amostra (${amostras.length} registro(s)):`);
            amostras.forEach((a, i) => {
                console.log(`    [${i + 1}] ${a.id}`);
                Object.keys(a.fields).forEach(k => {
                    console.log(`         ${k}: ${JSON.stringify(a.fields[k])}`);
                });
            });
        }
        console.log('');

        relatorio.tabelas.push({
            nome: tab.name,
            id: tab.id,
            campoPrimario: tab.primaryFieldId,
            campos,
            amostras
        });
    }

    return relatorio;
}

(async () => {
    const saida = { gerado_em: new Date().toISOString(), bases: [] };

    saida.bases.push(await inspecionarBase('BASE 2 — Financeira', BASE_2));

    if (BASE_1) {
        saida.bases.push(await inspecionarBase('BASE 1 — Relatórios (referência)', BASE_1));
    } else {
        console.log('\n[info] BASE 1 não inspecionada (AIRTABLE_BASE_ID vazio no .env). Isso é opcional.');
    }

    fs.writeFileSync('diagnostico_base2.json', JSON.stringify(saida, null, 2), 'utf8');
    console.log('\n' + '='.repeat(70));
    console.log(' PRONTO. Arquivo gerado: diagnostico_base2.json');
    console.log(' Me cole aqui o conteúdo desse arquivo (ou a saída do terminal).');
    console.log('='.repeat(70) + '\n');
})();