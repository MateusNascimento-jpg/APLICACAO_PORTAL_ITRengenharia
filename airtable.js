// airtable.js — acesso ao Airtable com isolamento por Record ID e resiliência.

const config = require('./config');
const { buildClientScopes, normalizarCnpj } = require('./lib/client-scope');

const TOKEN = config.airtable.token;
const BASE = config.airtable.baseId;
const API = `https://api.airtable.com/v0/${BASE}`;

const TBL_CLIENTES = 'tblkQxQ6q7cBKXZ3C';
const TBL_NOVOS_TRABALHOS = 'tblJAP4Av9sWm8SmL';
const TBL_ENSAIOS = 'tblYtVM2crMxpxHgG';

const TAMANHO_PAGINA = 100;
const MESES_RECENTE = 3;
const CACHE_TTL_MS = config.airtable.cacheTtlMs;
const CAMPO_ORDENACAO = 'createdTime';

function recordIdValido(id) {
    return /^rec[a-zA-Z0-9]{14}$/.test(String(id || ''));
}

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function airtableRequest(url, options = {}) {
    let ultimoErro;
    for (let tentativa = 0; tentativa <= config.airtable.retries; tentativa += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.airtable.timeoutMs);
        try {
            const resp = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${TOKEN}`,
                    ...(options.headers || {})
                }
            });
            const texto = await resp.text();
            let dados = {};
            if (texto) {
                try { dados = JSON.parse(texto); }
                catch (_) { throw new Error('Resposta inválida recebida do Airtable.'); }
            }
            if (resp.ok) return dados;

            const retryable = resp.status === 429 || resp.status >= 500;
            const erro = new Error(dados.error?.message || `Airtable respondeu HTTP ${resp.status}.`);
            erro.status = resp.status;
            if (!retryable || tentativa >= config.airtable.retries) throw erro;
            ultimoErro = erro;
        } catch (error) {
            ultimoErro = error;
            const retryable = error.name === 'AbortError' || !error.status || error.status === 429 || error.status >= 500;
            if (!retryable || tentativa >= config.airtable.retries) throw error;
        } finally {
            clearTimeout(timer);
        }

        const atraso = Math.min(4000, 250 * (2 ** tentativa)) + Math.floor(Math.random() * 180);
        await esperar(atraso);
    }
    throw ultimoErro || new Error('Falha ao consultar o Airtable.');
}

async function airtableGet(url) {
    return airtableRequest(url);
}

async function airtablePatch(url, fields) {
    return airtableRequest(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });
}

// ==================== TRADUCAO DE SIGLAS (com cache) ====================
// Usado APENAS como fallback: quando o trabalho nao tem 'Nome_Completo_Ensaios'
// preenchido, tentamos traduzir a sigla crua de 'Link Ensaios' por aqui.
let mapaEnsaios = null;
let mapaEnsaiosCarregadoEm = 0;

async function carregarMapaEnsaios() {
    if (mapaEnsaios && (Date.now() - mapaEnsaiosCarregadoEm) < CACHE_TTL_MS) return mapaEnsaios;
    const mapa = {};
    let offset = null;
    try {
        do {
            let url = `${API}/${TBL_ENSAIOS}?pageSize=100`;
            if (offset) url += `&offset=${encodeURIComponent(offset)}`;
            const resp = await airtableGet(url);
            (resp.records || []).forEach(rec => {
                const sigla = rec.fields['ID Ensaio'];
                const nome = rec.fields['Nome do Ensaio'];
                const norma = rec.fields['Norma'];
                if (sigla && nome) {
                    // Guarda a chave original E uma versao normalizada (sem caixa/acento)
                    // para casar "LIMITE" com "Limite", "TRETON" com "Treton", etc.
                    // Cada entrada carrega { nome, norma } — norma e' singleLineText,
                    // fica null quando o campo Norma nao esta preenchido no Airtable.
                    const entrada = { nome: String(nome).trim(), norma: norma ? String(norma).trim() : null };
                    mapa[String(sigla).trim()] = entrada;
                    mapa['__norm__' + normalizar(sigla)] = entrada;
                }
            });
            offset = resp.offset || null;
        } while (offset);
        mapaEnsaios = mapa;
        mapaEnsaiosCarregadoEm = Date.now();
    } catch (e) {
        // recarga falhou: mantem o cache antigo (se existir) em vez de derrubar o portal
        if (mapaEnsaios) return mapaEnsaios;
        return {};
    }
    return mapaEnsaios;
}

// Normaliza texto para comparacao tolerante (minusculo, sem acento, sem espacos duplos)
function normalizar(txt) {
    return String(txt || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// Detecta se um valor de ensaio e, na verdade, LIXO (nao e um ensaio):
//   - ID de trabalho vazado (ex.: "ODEEP_ST-TPS-TAC-C31-093")
//   - texto curto sem cara de sigla/nome (ex.: "a 3", "x", "12")
// So e chamado quando o valor NAO casou com nenhum ensaio conhecido.
function pareceLixo(valor) {
    const s = String(valor || '').trim();
    if (!s) return false;
    // 1) ID de trabalho vazado: tem underscore + codigo com tracos/numeros
    if (/_/.test(s) && /[A-Z]{2,}-[A-Z]{2,}|-[A-Z]\d{2}-\d{3}/i.test(s)) return true;
    // 2) so numeros, ou numero solto (ex.: "12", "3")
    if (/^\d+$/.test(s)) return true;
    // 3) texto muito curto e generico que nao parece sigla de ensaio:
    //    siglas reais sao MAIUSCULAS ou tem hifen (MR, DP, MR-I, CBR-N...).
    //    "a 3", "x", "ab" em minusculo com espaco/numero solto = lixo.
    if (s.length <= 4 && /[a-z]/.test(s) && /\s|\d/.test(s) && !/-/.test(s)) {
        // tem letra minuscula + espaco ou numero, sem hifen -> nao e sigla
        return true;
    }
    return false;
}

// ==================== RESOLVER O NOME DO ENSAIO ====================
// Ordem de preferencia:
//   1) 'Nome_Completo_Ensaios' (lookup) — ja vem pronto e limpo (98%)
//   2) sigla de 'Link Ensaios' traduzida pelo mapa (exata ou normalizada)
//   3) a propria sigla, se nao for lixo
// Retorna { nome, ehLixo } — ehLixo=true so quando e um ID vazado sem nome.
function resolverEnsaio(f, mapa) {
    // 1) Fonte principal: nome completo ja resolvido pelo Airtable
    const nomeCompleto = primeiro(f['Nome_Completo_Ensaios ']) // ATENCAO: o campo tem um espaco no fim
        || primeiro(f['Nome_Completo_Ensaios']);
    if (nomeCompleto && String(nomeCompleto).trim()) {
        return { nome: String(nomeCompleto).trim(), ehLixo: false };
    }

    // 2) Fallback: sigla crua
    const sigla = primeiro(f['Link Ensaios']);
    if (sigla) {
        const chave = String(sigla).trim();
        // 2a) traducao exata
        if (mapa[chave]) return { nome: mapa[chave].nome, ehLixo: false };
        // 2b) traducao tolerante (caixa/acento): "LIMITE" -> "Limites de Atterberg"
        const norm = mapa['__norm__' + normalizar(chave)];
        if (norm) return { nome: norm.nome, ehLixo: false };
        // 2c) e lixo (ID vazado, numero solto, "a 3")? entao marca como lixo
        if (pareceLixo(chave)) {
            return { nome: chave, ehLixo: true };
        }
        // 2d) sigla solta legitima sem nome cadastrado: mostra a propria sigla
        return { nome: chave, ehLixo: false };
    }

    // 3) Nada: rotulo neutro, nao e lixo (so nao tem ensaio informado)
    return { nome: 'Ensaio', ehLixo: false };
}

// ==================== RESOLVER A(S) NORMA(S) ====================
// Junta a Norma de cada ensaio vinculado em 'Link Ensaios' (normalmente 1 so,
// mas trata como lista pela mesma razao de resolverAmostra/traduzirOS: seguro
// mesmo se um dia vier mais de um). Remove duplicatas e vazios, preserva ordem.
// Retorna string ("NBR 6459, NBR 7180") ou null se nenhum ensaio tiver norma.
function resolverNormas(f, mapa) {
    const bruto = f['Link Ensaios'];
    const lista = Array.isArray(bruto) ? bruto : (bruto != null ? [bruto] : []);

    const normas = [];
    lista.forEach(sigla => {
        const chave = String(sigla || '').trim();
        if (!chave) return;
        const entrada = mapa[chave] || mapa['__norm__' + normalizar(chave)];
        const norma = entrada && entrada.norma ? String(entrada.norma).trim() : null;
        if (norma && !normas.includes(norma)) normas.push(norma);
    });

    return normas.length ? normas.join(', ') : null;
}

// ==================== TRADUCAO DE ORDEM DE SERVICO (com cache) ====================
// Le a tabela "Ordem de Serviço" UMA vez e guarda { "rec...": "OS 44 - ST", ... }.
// CORRECAO: o nome legivel esta no campo 'ID' (ex.: "OS 28", "Ferrovia"),
// e NAO em 'Name' (que estava vazio em quase toda a tabela).
const TBL_ORDEM_SERVICO = 'Ordem de Serviço';
let mapaOS = null;
let mapaOSCarregadoEm = 0;

async function carregarMapaOS() {
    if (mapaOS && (Date.now() - mapaOSCarregadoEm) < CACHE_TTL_MS) return mapaOS;
    const mapa = {};
    let offset = null;
    try {
        do {
            let url = `${API}/${encodeURIComponent(TBL_ORDEM_SERVICO)}?pageSize=100`;
            if (offset) url += `&offset=${encodeURIComponent(offset)}`;
            const resp = await airtableGet(url);
            (resp.records || []).forEach(rec => {
                // CORRIGIDO: campo 'ID' (antes era 'Name', que nao existe/vazio)
                const nome = rec.fields['ID'] || rec.fields['Nome'] || rec.fields['Name'];
                if (nome) mapa[rec.id] = String(nome).trim();
            });
            offset = resp.offset || null;
        } while (offset);
        mapaOS = mapa;
        mapaOSCarregadoEm = Date.now();
    } catch (e) {
        // recarga falhou: mantem o cache antigo (se existir) em vez de derrubar o portal
        if (mapaOS) return mapaOS;
        return {}; // sem cache anterior; cai no fallback (nao mostra OS)
    }
    return mapaOS;
}

// ==================== RECARGA SOB DEMANDA (cache miss) ====================
// Quando um recordId/sigla nao e encontrado no mapa cacheado, pode ser que
// tenha sido criado no Airtable DEPOIS da ultima carga (ver "Armadilha
// CRÍTICA: cache eterno de dicionários" no CLAUDE.md). Forcamos uma recarga
// e tentamos resolver de novo, com duas travas:
//   1) nunca duas recargas em paralelo — reaproveita a Promise ja em voo;
//   2) no maximo uma recarga por miss a cada RECARGA_MISS_JANELA_MS, para
//      nao martelar a API quando o valor realmente nao existe (sigla/OS
//      invalida, lixo).
const RECARGA_MISS_JANELA_MS = 30 * 1000;

let mapaEnsaiosRecargaEmVoo = null;
let mapaEnsaiosUltimaRecargaMiss = 0;

async function recarregarMapaEnsaiosPorMiss() {
    if (mapaEnsaiosRecargaEmVoo) return mapaEnsaiosRecargaEmVoo;
    if (Date.now() - mapaEnsaiosUltimaRecargaMiss < RECARGA_MISS_JANELA_MS) {
        return mapaEnsaios || {};
    }
    mapaEnsaiosUltimaRecargaMiss = Date.now();
    mapaEnsaiosCarregadoEm = 0; // forca carregarMapaEnsaios a ignorar o TTL e buscar de novo
    mapaEnsaiosRecargaEmVoo = carregarMapaEnsaios().finally(() => { mapaEnsaiosRecargaEmVoo = null; });
    return mapaEnsaiosRecargaEmVoo;
}

let mapaOSRecargaEmVoo = null;
let mapaOSUltimaRecargaMiss = 0;

async function recarregarMapaOSPorMiss() {
    if (mapaOSRecargaEmVoo) return mapaOSRecargaEmVoo;
    if (Date.now() - mapaOSUltimaRecargaMiss < RECARGA_MISS_JANELA_MS) {
        return mapaOS || {};
    }
    mapaOSUltimaRecargaMiss = Date.now();
    mapaOSCarregadoEm = 0; // forca carregarMapaOS a ignorar o TTL e buscar de novo
    mapaOSRecargaEmVoo = carregarMapaOS().finally(() => { mapaOSRecargaEmVoo = null; });
    return mapaOSRecargaEmVoo;
}

// Recebe a lista bruta de siglas de 'Link Ensaios' e devolve o mapa a usar:
// se alguma sigla nao-lixo nao foi encontrada no mapa atual, recarrega antes
// de resolver (cobre tanto o nome do ensaio quanto a Norma, que usam o mesmo
// mapa). Chamado UMA vez por trabalho, antes de resolverEnsaio/resolverNormas.
async function mapaEnsaiosComRecarga(f, mapa) {
    const bruto = f['Link Ensaios'];
    const lista = Array.isArray(bruto) ? bruto : (bruto != null ? [bruto] : []);
    const temMiss = lista.some(sigla => {
        const chave = String(sigla || '').trim();
        if (!chave) return false;
        const entrada = mapa[chave] || mapa['__norm__' + normalizar(chave)];
        return !entrada && !pareceLixo(chave);
    });
    if (!temMiss) return mapa;
    return recarregarMapaEnsaiosPorMiss();
}

// Recebe o campo "Ordem de Serviço" do trabalho (array com codigos rec...) e
// devolve { os, os_extra } — primeira OS traduzida + quantas a mais existem.
// Forma mais segura: trata como lista mesmo que normalmente tenha 1 so.
// Assincrona: se algum recordId nao for encontrado no mapa, recarrega o
// dicionario (cache miss) e tenta resolver de novo antes de desistir.
async function traduzirOS(campo, mapa) {
    const lista = Array.isArray(campo) ? campo : (campo != null ? [campo] : []);
    if (lista.length === 0) return { os: null, os_extra: 0 };

    let mapaAtual = mapa;
    const temMiss = lista.some(cod => !mapaAtual[cod]);
    if (temMiss) {
        mapaAtual = await recarregarMapaOSPorMiss();
    }

    const nomes = lista
        .map(cod => mapaAtual[cod] || null)
        .filter(Boolean);
    if (nomes.length === 0) return { os: null, os_extra: 0 };
    return { os: nomes[0], os_extra: nomes.length - 1 };
}

// ==================== TRADUCAO DE STATUS (Airtable -> rotulo do cliente) ====================
// Pedido do cliente: "Relatório em Andamento" deve APARECER como "Ensaio Concluído".
// O valor REAL no Airtable continua intocado; so trocamos o rotulo exibido.
const ROTULO_STATUS = {
    'Amostra Recebida': 'Amostra Recebida',
    'Ensaio em Andamento': 'Ensaio em Andamento',
    'Relatório em Andamento': 'Ensaio Concluído',
    'Relatório Disponível': 'Relatório Disponível'
};
function rotularStatus(valorReal) {
    if (!valorReal) return '';
    return ROTULO_STATUS[valorReal] || valorReal;
}

// ==================== ANEXOS ====================
// Procura o PRIMEIRO anexo PDF (ignora fotos .jpg que ficam no mesmo campo).
function primeiroPdf(campo) {
    if (!Array.isArray(campo)) return null;
    const pdf = campo.find(a => a && (
        a.type === 'application/pdf' ||
        String(a.filename || '').toLowerCase().endsWith('.pdf')
    ));
    if (!pdf) return null;
    return { nome: pdf.filename, url: pdf.url };
}

function primeiro(valor) {
    if (Array.isArray(valor)) return valor[0] ?? null;
    return valor ?? null;
}

// Conta quantos itens uteis ha num campo (para o "+N" da amostra)
function contarItens(valor) {
    if (Array.isArray(valor)) return valor.filter(v => v != null && String(v).trim() !== '').length;
    return (valor != null && String(valor).trim() !== '') ? 1 : 0;
}

function dataLimiteRecente(meses) {
    const n = (typeof meses === 'number' && meses > 0) ? meses : MESES_RECENTE;
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return d.toISOString().slice(0, 10);
}

function escaparFormula(txt) {
    return String(txt).replace(/'/g, "\\'");
}

// ==================== RESOLVER A AMOSTRA ====================
// Fonte: 'Link Amostras' (texto, 100% preenchido). Pode vir um nome so
// ("ST-01-AM-02") ou varios separados — tratamos de forma segura como lista.
// Retorna { amostra, amostra_extra }: primeira + quantas a mais.
function resolverAmostra(f) {
    let bruto = f['Link Amostras'];

    // 'Link Amostras' costuma ser texto unico; 'Nome da Amostra' costumava ser array.
    // Tratamos os dois formatos de forma segura.
    let lista = [];
    if (Array.isArray(bruto)) {
        lista = bruto;
    } else if (typeof bruto === 'string') {
        // alguns registros agrupam varios nomes com " | " — separa se houver
        lista = bruto.includes(' | ') ? bruto.split(' | ') : [bruto];
    } else if (bruto != null) {
        lista = [bruto];
    }

    // fallback final: se Link Amostras vier vazio, tenta o antigo Nome da Amostra
    if (lista.length === 0) {
        const antigo = f['Nome da Amostra'];
        if (Array.isArray(antigo)) lista = antigo;
        else if (antigo != null) lista = [antigo];
    }

    lista = lista.map(s => String(s).trim()).filter(Boolean);
    if (lista.length === 0) return { amostra: '', amostra_extra: 0 };
    return { amostra: lista[0], amostra_extra: lista.length - 1 };
}

// ==================== FORMATAR UM TRABALHO PARA O PORTAL ====================
// Devolve os campos que o portal.html espera. Mantida a compatibilidade:
// 'ensaio', 'amostra', 'os', 'status_cliente', 'status_rotulo', 'datas', 'data',
// 'pdf', 'cancelado' continuam existindo. Novos campos: 'amostra_extra',
// 'os_extra', 'ensaio_lixo' (para o front esconder do filtro se quiser).
// Assincrona: traduzirOS() e a resolucao de ensaio/norma podem recarregar o
// dicionario cacheado em caso de cache miss (ver "Armadilha CRÍTICA" no CLAUDE.md).
async function formatar(rec, mapa, mapaOrdens) {
    const f = rec.fields;

    // PDF: SO de "Relatórios_Aprovados" (regra: cliente so ve o que o diretor aprovou).
    const pdf = primeiroPdf(f['Relatórios_Aprovados']);

    // RELATORIO EM ANDAMENTO (nova etapa): existe relatorio gerado no campo
    // "Relatórios" (anexo), mas ainda NAO foi aprovado pelo diretor. Isso marca
    // o estado intermediario entre "Ensaio Concluído" e "Relatório Disponível".
    const temRelatorioGerado = Array.isArray(f['Relatórios']) && f['Relatórios'].length > 0;
    const relatorioEmAndamento = temRelatorioGerado && !pdf;

    // RELATORIO DESATUALIZADO: o PDF ja foi aprovado, mas o anexo em
    // "Relatórios" foi trocado DEPOIS da aprovação e a automação do Airtable
    // nao re-disparou (ver "Armadilha: relatório antigo aparece após troca
    // do PDF" no CLAUDE.md). Detecta comparando o nome do arquivo mais
    // recente em "Relatórios" com o que esta em "Relatórios_Aprovados".
    // NAO muda qual PDF o cliente recebe — so sinaliza para a UI.
    const pdfGerado = primeiroPdf(f['Relatórios']);
    const relatorioDesatualizado = !!(pdf && pdfGerado && pdfGerado.nome !== pdf.nome);

    // ENSAIO + NORMA(S): garante o mapa atualizado ANTES de resolver os dois
    // (evita recarregar duas vezes para o mesmo trabalho).
    const mapaFinal = await mapaEnsaiosComRecarga(f, mapa);

    // ENSAIO: nome completo limpo (com fallback e deteccao de lixo)
    const ens = resolverEnsaio(f, mapaFinal);

    // NORMA(S): da tabela Ensaios, casando pela(s) sigla(s) de Link Ensaios
    const norma = resolverNormas(f, mapaFinal);

    // AMOSTRA: primeira + "+N"
    const amo = resolverAmostra(f);

    // OS: primeira traduzida + "+N" (forma segura, tratando como lista)
    // Diagnostico (jul/2026) mostrou que 'Ordem de Serviço' (link direto) esta
    // preenchido em praticamente 100% dos registros, mas mantemos fallback
    // defensivo para 'Link Ordem de Serviço' (lookup) para casos legados.
    const ordem = await traduzirOS(f['Ordem de Serviço'] ?? f['Link Ordem de Serviço'], mapaOrdens);

    // Status REAL do Airtable e o rotulo exibido
    const statusReal = f['Status Cliente'] || '';
    const statusRotulo = rotularStatus(statusReal);

    // DATAS de cada etapa — leitura PADRONIZADA (tudo passa por primeiro()),
    // porque alguns campos vem como array e outros como texto solto.
    const datas = {
        'Data de Chegada': primeiro(f['Data de Chegada']) || null,
        'Data Início Ensaio': primeiro(f['Data Início Ensaio']) || null,
        'Data de Conclusão do Ensaio': primeiro(f['Data de Conclusão do Ensaio']) || null,
        'Data de Envio do Relatório': primeiro(f['Data de Envio do Relatório']) || null
    };

    // Data principal mostrada no canto do card (a mais "avancada" disponivel)
    const dataPrincipal = datas['Data de Envio do Relatório']
        || datas['Data de Conclusão do Ensaio']
        || datas['Data Início Ensaio']
        || datas['Data de Chegada']
        || null;

    // Data usada para ORDENAR ("mais recente" = ultimo CADASTRADO no Airtable,
    // pelo timestamp interno createdTime — decisao revisada; nao usa mais
    // Data de Chegada). 100% preenchida (todo registro tem createdTime).
    const dataOrdenacao = rec.createdTime || dataPrincipal || null;

    return {
        id: rec.id,
        id_trabalho: f['ID Trabalho'] || null,

        // ENSAIO (agora sempre o nome completo quando existe)
        ensaio: ens.nome,
        ensaio_lixo: ens.ehLixo,          // o front esconde do filtro se for true
        sigla: primeiro(f['Link Ensaios']) || '',

        // AMOSTRA (em destaque no card)
        amostra: amo.amostra,
        amostra_extra: amo.amostra_extra, // quantas amostras a mais (para "+N")

        // ORDEM DE SERVICO
        os: ordem.os,
        os_extra: ordem.os_extra,

        // NORMA(S) do(s) ensaio(s) vinculado(s), separadas por virgula (ou null)
        norma: norma,

        // Para a timeline: valor REAL (para casar a etapa) + rotulo (so exibicao)
        status_cliente: statusReal,        // ex: "Relatório em Andamento"
        status_rotulo: statusRotulo,       // ex: "Ensaio Concluído"

        datas: datas,
        data: dataPrincipal,
        data_ordenacao: dataOrdenacao,  // usada para ordenar "mais recentes"

        // PDF aprovado
        pdf: !!pdf,
        relatorio_nome: pdf ? pdf.nome : null,
        relatorio_em_andamento: relatorioEmAndamento, // tem relatorio mas nao aprovado
        relatorio_desatualizado: relatorioDesatualizado, // PDF trocado apos aprovacao; automacao nao re-disparou

        preparando: false, // (futuro) marcar quando aprovado mas PDF ainda gerando
        cancelado: (statusReal === 'Cancelado'),

        // Valor cru do campo "Aprovação" (singleSelect) — usado só no painel do
        // diretor para mostrar o status atual. Leitura adicional; nao afeta o
        // portal do cliente, que nao referencia esta chave.
        aprovacao: f['Aprovação'] || null
    };
}


// ==================== ESCOPO EMPRESARIAL / SNAPSHOT GLOBAL ====================
// Snapshot lazy + single-flight: uma tempestade de requests gera no maximo uma
// recarga do Airtable. Em falha transitória, preservamos somente snapshot ainda
// dentro do staleMaxMs; sem snapshot seguro, falhamos fechados.
let scopeSnapshot = null;
let scopeSnapshotLoadedAt = 0;
let scopeSnapshotPromise = null;

async function paginarTabelaComRitmo(table) {
    let todos = [];
    let offset = null;
    let pagina = 0;
    do {
        let url = `${API}/${encodeURIComponent(table)}?pageSize=${TAMANHO_PAGINA}`;
        if (offset) url += `&offset=${encodeURIComponent(offset)}`;
        const resp = await airtableGet(url);
        todos = todos.concat(resp.records || []);
        offset = resp.offset || null;
        pagina += 1;
        if (offset && config.clientScope.pagePaceMs > 0) await esperar(config.clientScope.pagePaceMs);
    } while (offset);
    return todos;
}

async function recarregarScopeSnapshot() {
    // Clientes primeiro; trabalhos depois. Nao há concorrencia deliberada aqui
    // para respeitar a cota da base e reduzir 429 no cold start.
    const clientes = await paginarTabelaComRitmo(TBL_CLIENTES);
    const trabalhos = await paginarTabelaComRitmo(TBL_NOVOS_TRABALHOS);
    const model = buildClientScopes(clientes, trabalhos, {
        ownerMinWorks: config.clientScope.ownerMinWorks,
        sampleTextMinShared: config.clientScope.sampleTextMinShared,
        overrides: config.clientScope.overrides
    });
    return { clientes, trabalhos, model, loadedAt: Date.now() };
}

async function carregarScopeSnapshot(force = false) {
    const now = Date.now();
    const age = scopeSnapshot ? now - scopeSnapshotLoadedAt : Infinity;
    if (!force && scopeSnapshot && age < config.clientScope.cacheTtlMs) return scopeSnapshot;

    const startRefresh = () => {
        if (scopeSnapshotPromise) return scopeSnapshotPromise;
        scopeSnapshotPromise = recarregarScopeSnapshot()
            .then(snapshot => {
                scopeSnapshot = snapshot;
                scopeSnapshotLoadedAt = snapshot.loadedAt;
                return snapshot;
            })
            .finally(() => { scopeSnapshotPromise = null; });
        return scopeSnapshotPromise;
    };

    // stale-while-revalidate: depois do primeiro snapshot, requests normais nao
    // ficam presos aos ~26 pages do Airtable durante refresh.
    if (!force && scopeSnapshot && age <= config.clientScope.staleMaxMs) {
        startRefresh().catch(error => console.warn('[AIRTABLE_SCOPE] refresh em background falhou:', error.message));
        return scopeSnapshot;
    }

    try {
        return await startRefresh();
    } catch (error) {
        if (scopeSnapshot && age <= config.clientScope.staleMaxMs) return scopeSnapshot;
        throw error;
    }
}

function clientRecordById(snapshot, id) {
    return snapshot.clientes.find(rec => rec.id === id) || null;
}

function enriquecerClienteComEscopo(snapshot, seedRecord, cnpjConhecido = null) {
    if (!seedRecord) return null;
    const scope = snapshot.model.scopeByClientId.get(seedRecord.id);
    if (!scope) return null;
    const members = scope.clientIds.map(id => clientRecordById(snapshot, id)).filter(Boolean);
    const formatted = members.map(rec => formatarClienteAcesso(rec));
    const canonicalRecord = clientRecordById(snapshot, scope.canonicalId) || seedRecord;
    const canonical = formatarClienteAcesso(canonicalRecord, cnpjConhecido || null);
    const emails = [...new Set(formatted.flatMap(c => c?.emails || []))];
    const cnpjs = [...new Set(formatted.map(c => c?.cnpj).filter(Boolean))];
    return {
        ...canonical,
        id: scope.canonicalId,
        seedId: seedRecord.id,
        cnpj: cnpjConhecido || formatarClienteAcesso(seedRecord)?.cnpj || canonical.cnpj,
        emailLogin: canonical.emailLogin || emails[0] || null,
        emails,
        cnpjs,
        scopeClientIds: [...scope.clientIds],
        scopeEvidence: scope.evidence
    };
}

async function resolverEscopoCliente(recordIdCliente) {
    if (!recordIdValido(recordIdCliente)) return null;
    const snapshot = await carregarScopeSnapshot();
    const seed = clientRecordById(snapshot, recordIdCliente);
    return seed ? enriquecerClienteComEscopo(snapshot, seed) : null;
}

function recordRecente(rec, meses) {
    const status = String(rec.fields?.['Status Cliente'] || '');
    const ativo = status !== 'Relatório Disponível' && status !== 'Cancelado';
    if (ativo) return true;
    const limite = new Date();
    limite.setMonth(limite.getMonth() - (Number.isFinite(Number(meses)) ? Number(meses) : MESES_RECENTE));
    return new Date(rec.createdTime || 0).getTime() > limite.getTime();
}

function trabalhoDentroDoEscopo(rec, scopeClientIds) {
    const links = rec?.fields?.Cliente;
    return Array.isArray(links) && links.some(id => scopeClientIds.includes(id));
}

// ==================== BUSCAR TRABALHOS DO CLIENTE ====================
// modo 'recente' (padrao): em andamento OU enviado nos ultimos N meses.
// modo 'todos': historico completo.
async function buscarTrabalhosDoCliente(recordIdCliente, offset = null, modo = 'recente', meses = null) {
    if (!recordIdValido(recordIdCliente)) {
        return { nome_cliente: null, trabalhos: [], offset: null, tem_mais: false, modo };
    }

    const snapshot = await carregarScopeSnapshot();
    const cliente = await resolverEscopoCliente(recordIdCliente);
    if (!cliente) return { nome_cliente: null, trabalhos: [], offset: null, tem_mais: false, modo };

    const scopeClientIds = cliente.scopeClientIds;
    const mapa = await carregarMapaEnsaios();
    const mapaOrdens = await carregarMapaOS();

    // Tenant isolation fail-closed: apenas linked-record IDs explicitamente
    // pertencentes ao escopo resolvido entram no payload. Nome/CNPJ/amostra nunca
    // substituem esta checagem de autorização por Record ID.
    const isolados = snapshot.trabalhos.filter(rec => {
        if (!trabalhoDentroDoEscopo(rec, scopeClientIds)) return false;
        return modo !== 'recente' || recordRecente(rec, meses);
    });

    const vistos = new Set();
    const unicos = isolados.filter(rec => {
        if (vistos.has(rec.id)) return false;
        vistos.add(rec.id); return true;
    });

    const trabalhos = (await Promise.all(unicos.map(rec => formatar(rec, mapa, mapaOrdens))))
        .sort((a, b) => new Date(b.data_ordenacao || 0) - new Date(a.data_ordenacao || 0));

    return {
        nome_cliente: cliente.idCliente || cliente.nome || null,
        trabalhos,
        offset: null,
        tem_mais: false,
        modo
    };
}

// ==================== URL FRESCA DO PDF (download na hora) ====================
// Os links de anexo do Airtable expiram. Esta funcao busca o trabalho de novo
// no momento do clique e devolve uma URL valida do PDF aprovado.
async function urlRelatorioAprovado(recordIdTrabalho, recordIdCliente = null) {
    if (!recordIdValido(recordIdTrabalho)) return null;
    const rec = await airtableGet(`${API}/${TBL_NOVOS_TRABALHOS}/${encodeURIComponent(recordIdTrabalho)}`);

    if (recordIdCliente) {
        if (!recordIdValido(recordIdCliente)) return null;
        const cliente = await resolverEscopoCliente(recordIdCliente);
        if (!cliente) return null;
        const scopeClientIds = cliente.scopeClientIds;
        const links = rec.fields?.['Cliente'];
        if (!Array.isArray(links) || !links.some(id => scopeClientIds.includes(id))) return null;
    }

    if (rec.fields?.['Aprovação'] !== 'Aprovado') return null;
    const pdf = primeiroPdf(rec.fields?.['Relatórios_Aprovados']);
    if (!pdf) return null;
    const atual = primeiroPdf(rec.fields?.['Relatórios']);
    if (atual && atual.nome && pdf.nome && atual.nome !== pdf.nome) return null;
    return { nome: pdf.nome, url: pdf.url };
}

async function trabalhoPertenceAoCliente(recordIdTrabalho, recordIdCliente) {
    if (!recordIdValido(recordIdTrabalho) || !recordIdValido(recordIdCliente)) return false;
    const cliente = await resolverEscopoCliente(recordIdCliente);
    if (!cliente) return false;
    const scopeClientIds = cliente.scopeClientIds;
    const rec = await airtableGet(`${API}/${TBL_NOVOS_TRABALHOS}/${encodeURIComponent(recordIdTrabalho)}`);
    const links = rec.fields?.['Cliente'];
    return Array.isArray(links) && links.some(id => scopeClientIds.includes(id));
}

// ==================== CLIENTE / IDENTIDADE DE ACESSO ====================
// O primeiro e-mail continua sendo a credencial inicial de ativação para
// preservar o fluxo operacional já usado pela ITR. Depois que uma senha
// pessoal é criada, esse e-mail deixa de autenticar a conta.
function emailsCliente(campo) {
    if (!campo) return [];
    const itens = Array.isArray(campo) ? campo : [campo];
    return [...new Set(itens.flatMap(item => String(item)
        .split(/[\r\n;,]+/)
        .map(l => l.trim().toLowerCase())
        .filter(Boolean)))];
}

function primeiroEmailCliente(campo) {
    return emailsCliente(campo)[0] || null;
}

function primeiroTelefoneCliente(fields) {
    const candidatos = [
        config.airtable.clientWhatsappField,
        'WhatsApp do Cliente',
        'WhatsApp Cliente',
        'WhatsApp'
    ];
    for (const nome of candidatos) {
        if (!nome || !Object.prototype.hasOwnProperty.call(fields || {}, nome)) continue;
        const valor = Array.isArray(fields[nome]) ? fields[nome][0] : fields[nome];
        const texto = String(valor || '').trim();
        if (texto) return texto;
    }
    return null;
}

function formatarClienteAcesso(rec, cnpjConhecido = null) {
    if (!rec) return null;
    const campoEmail = rec.fields?.[config.airtable.clientEmailField] ?? rec.fields?.['Email Cliente'];
    const listaEmails = emailsCliente(campoEmail);
    const cnpj = cnpjConhecido || String(rec.fields?.['CNPJ'] || '').replace(/\D/g, '');
    return {
        id: rec.id,
        nome: rec.fields?.['Nome Cliente'] || null,
        idCliente: rec.fields?.['ID Cliente'] || null,
        emailLogin: listaEmails[0] || null,
        emails: listaEmails,
        whatsapp: primeiroTelefoneCliente(rec.fields),
        cnpj
    };
}

async function buscarClientePorCnpj(cnpj) {
    const cnpjLimpo = normalizarCnpj(cnpj);
    if (!cnpjLimpo) return null;
    const snapshot = await carregarScopeSnapshot();
    const matches = snapshot.clientes.filter(rec => normalizarCnpj(rec.fields?.CNPJ) === cnpjLimpo);
    if (!matches.length) return null;

    const roots = new Set(matches.map(rec => snapshot.model.scopeByClientId.get(rec.id)?.canonicalId).filter(Boolean));
    if (roots.size !== 1) {
        // CNPJ repetido em tenants que o resolver nao conseguiu provar como um
        // unico escopo: falha fechada, sem escolher "o primeiro".
        throw new Error('CNPJ ambiguo entre escopos de cliente distintos; acesso bloqueado por segurança.');
    }
    return enriquecerClienteComEscopo(snapshot, matches[0], cnpjLimpo);
}

async function buscarClientePorId(recordIdCliente) {
    if (!recordIdValido(recordIdCliente)) return null;
    const snapshot = await carregarScopeSnapshot();
    const rec = clientRecordById(snapshot, recordIdCliente);
    return rec ? enriquecerClienteComEscopo(snapshot, rec) : null;
}

// ==================== PAINEL DO DIRETOR ====================

// Lista TODOS os clientes do Airtable (as "nuvenzinhas" do painel).
// Retorna id (record), nome e idCliente (prefixo). Ordenado por nome.
async function listarClientes() {
    const snapshot = await carregarScopeSnapshot();
    return snapshot.clientes
        .map(rec => {
            const scope = snapshot.model.scopeByClientId.get(rec.id);
            return {
                id: rec.id,
                nome: String(rec.fields?.['ID Cliente'] || '(sem nome)').trim(),
                idCliente: rec.fields?.['ID Cliente'] || null,
                cnpj: rec.fields?.CNPJ ? String(rec.fields.CNPJ).replace(/\D/g, '') : null,
                scopeCanonicalId: scope?.canonicalId || rec.id,
                scopeSize: scope?.clientIds?.length || 1
            };
        })
        .filter(c => c.nome && c.nome !== '(sem nome)')
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Busca UM registro de Novos Trabalhos pelo record id e devolve so o essencial
// para o historico de downloads do diretor: ID Trabalho + OS traduzida. Nao usa
// formatar() (que tambem resolveria ensaio/amostra/datas/pdf, desnecessario
// aqui) mas reusa o MESMO dicionario de OS (carregarMapaOS/traduzirOS) que o
// portal do cliente ja usa, garantindo o mesmo texto ("OS 28", etc.).
async function detalheTrabalhoPorId(recordId) {
    if (!recordIdValido(recordId)) return { id_trabalho: null, os: null };
    const rec = await airtableGet(`${API}/${TBL_NOVOS_TRABALHOS}/${encodeURIComponent(recordId)}`);
    const mapaOrdens = await carregarMapaOS();
    const ordem = await traduzirOS(rec.fields['Ordem de Serviço'] ?? rec.fields['Link Ordem de Serviço'], mapaOrdens);
    return {
        id_trabalho: rec.fields['ID Trabalho'] || null,
        os: ordem.os
    };
}

async function detalhesTrabalhosPorIds(ids, concorrencia = 5) {
    const unicos = [...new Set((ids || []).filter(recordIdValido))];
    const resultado = new Map();
    let cursor = 0;

    async function worker() {
        while (cursor < unicos.length) {
            const atual = unicos[cursor++];
            try { resultado.set(atual, await detalheTrabalhoPorId(atual)); }
            catch (_) { resultado.set(atual, { id_trabalho: null, os: null }); }
        }
    }

    const workers = Array.from({ length: Math.min(Math.max(1, concorrencia), unicos.length || 1) }, () => worker());
    await Promise.all(workers);
    return resultado;
}

const APROVACAO_VALIDAS = ['Aprovado', 'Refazer', 'Em Andamento'];

async function definirAprovacao(recordIdTrabalho, valor) {
    if (!recordIdValido(recordIdTrabalho)) throw new Error('Record ID de trabalho inválido.');
    if (!APROVACAO_VALIDAS.includes(valor)) throw new Error('Valor de aprovação inválido.');

    const url = `${API}/${TBL_NOVOS_TRABALHOS}/${encodeURIComponent(recordIdTrabalho)}`;
    const anteriorRec = await airtableGet(url);
    const anterior = anteriorRec.fields?.['Aprovação'] || null;
    const resp = await airtablePatch(url, { 'Aprovação': valor });
    return { id: resp.id, aprovacao: resp.fields?.['Aprovação'] || valor, anterior };
}


async function verificarAirtable() {
    const url = `${API}/${TBL_CLIENTES}?maxRecords=1&fields%5B%5D=${encodeURIComponent('ID Cliente')}`;
    await airtableGet(url);
    return true;
}

module.exports = {
    buscarTrabalhosDoCliente,
    buscarClientePorCnpj,
    buscarClientePorId,
    resolverEscopoCliente,
    carregarScopeSnapshot,
    urlRelatorioAprovado,
    trabalhoPertenceAoCliente,
    listarClientes,
    definirAprovacao,
    APROVACAO_VALIDAS,
    detalheTrabalhoPorId,
    detalhesTrabalhosPorIds,
    recordIdValido,
    verificarAirtable
};
