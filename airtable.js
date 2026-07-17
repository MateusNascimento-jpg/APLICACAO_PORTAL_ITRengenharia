// airtable.js

// Filtro confiavel: o campo "ID Trabalho" comeca com "<ID Cliente>_" (ex: "GEODEEP_...").

require('dotenv').config();

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const API = `https://api.airtable.com/v0/${BASE}`;

const TBL_CLIENTES = 'tblkQxQ6q7cBKXZ3C';
const TBL_NOVOS_TRABALHOS = 'tblJAP4Av9sWm8SmL';
const TBL_ENSAIOS = 'tblYtVM2crMxpxHgG'; // tabela Ensaios: "ID Ensaio" (sigla) + "Nome do Ensaio"

const TAMANHO_PAGINA = 100; // Airtable permite ate 100/pagina. 100 = 5x menos
                            // chamadas de rede que os 20 antigos => bem mais rapido.
const MESES_RECENTE = 3;

const CAMPO_ORDENACAO = 'createdTime'; // meta-dado do proprio registro Airtable (ordem real de cadastro);
                                        // NAO e um campo de coluna, entao nao entra em sort da API —
                                        // ordenacao feita em memoria (ver bloco 3 abaixo).

async function airtableGet(url) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.error?.message || 'Erro ao consultar o Airtable');
    return dados;
}

async function airtablePatch(url, fields) {
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
    });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.error?.message || 'Erro ao gravar no Airtable');
    return dados;
}

// ==================== TRADUCAO DE SIGLAS (com cache) ====================
// Usado APENAS como fallback: quando o trabalho nao tem 'Nome_Completo_Ensaios'
// preenchido, tentamos traduzir a sigla crua de 'Link Ensaios' por aqui.
let mapaEnsaios = null;

async function carregarMapaEnsaios() {
    if (mapaEnsaios) return mapaEnsaios;
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
                if (sigla && nome) {
                    // Guarda a chave original E uma versao normalizada (sem caixa/acento)
                    // para casar "LIMITE" com "Limite", "TRETON" com "Treton", etc.
                    mapa[String(sigla).trim()] = String(nome).trim();
                    mapa['__norm__' + normalizar(sigla)] = String(nome).trim();
                }
            });
            offset = resp.offset || null;
        } while (offset);
        mapaEnsaios = mapa;
    } catch (e) {
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
        if (mapa[chave]) return { nome: mapa[chave], ehLixo: false };
        // 2b) traducao tolerante (caixa/acento): "LIMITE" -> "Limites de Atterberg"
        const norm = mapa['__norm__' + normalizar(chave)];
        if (norm) return { nome: norm, ehLixo: false };
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

// ==================== TRADUCAO DE ORDEM DE SERVICO (com cache) ====================
// Le a tabela "Ordem de Serviço" UMA vez e guarda { "rec...": "OS 44 - ST", ... }.
// CORRECAO: o nome legivel esta no campo 'ID' (ex.: "OS 28", "Ferrovia"),
// e NAO em 'Name' (que estava vazio em quase toda a tabela).
const TBL_ORDEM_SERVICO = 'Ordem de Serviço';
let mapaOS = null;

async function carregarMapaOS() {
    if (mapaOS) return mapaOS;
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
    } catch (e) {
        return {}; // se falhar, nao cacheia; cai no fallback (nao mostra OS)
    }
    return mapaOS;
}

// Recebe o campo "Ordem de Serviço" do trabalho (array com codigos rec...) e
// devolve { os, os_extra } — primeira OS traduzida + quantas a mais existem.
// Forma mais segura: trata como lista mesmo que normalmente tenha 1 so.
function traduzirOS(campo, mapa) {
    const lista = Array.isArray(campo) ? campo : (campo != null ? [campo] : []);
    const nomes = lista
        .map(cod => mapa[cod] || null)
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
function formatar(rec, mapa, mapaOrdens) {
    const f = rec.fields;

    // PDF: SO de "Relatórios_Aprovados" (regra: cliente so ve o que o diretor aprovou).
    const pdf = primeiroPdf(f['Relatórios_Aprovados']);

    // RELATORIO EM ANDAMENTO (nova etapa): existe relatorio gerado no campo
    // "Relatórios" (anexo), mas ainda NAO foi aprovado pelo diretor. Isso marca
    // o estado intermediario entre "Ensaio Concluído" e "Relatório Disponível".
    const temRelatorioGerado = Array.isArray(f['Relatórios']) && f['Relatórios'].length > 0;
    const relatorioEmAndamento = temRelatorioGerado && !pdf;

    // ENSAIO: nome completo limpo (com fallback e deteccao de lixo)
    const ens = resolverEnsaio(f, mapa);

    // AMOSTRA: primeira + "+N"
    const amo = resolverAmostra(f);

    // OS: primeira traduzida + "+N" (forma segura, tratando como lista)
    const ordem = traduzirOS(f['Ordem de Serviço'], mapaOrdens);

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

        preparando: false, // (futuro) marcar quando aprovado mas PDF ainda gerando
        cancelado: (statusReal === 'Cancelado')
    };
}

// ==================== BUSCAR TRABALHOS DO CLIENTE ====================
// modo 'recente' (padrao): em andamento OU enviado nos ultimos N meses.
// modo 'todos': historico completo.
async function buscarTrabalhosDoCliente(recordIdCliente, offset = null, modo = 'recente', meses = null) {
    // 0. Dicionarios (ensaios + ordens de servico), ambos cacheados
    const mapa = await carregarMapaEnsaios();
    const mapaOrdens = await carregarMapaOS();

    // 1. Pega nome + ID Cliente (prefixo usado em "ID Trabalho")
    let nomeCliente = null, idCliente = null;
    try {
        const cli = await airtableGet(`${API}/${TBL_CLIENTES}/${recordIdCliente}`);
        nomeCliente = cli.fields['Nome Cliente'] || null;
        idCliente = cli.fields['ID Cliente'] || null;
    } catch (e) {
        return { nome_cliente: null, trabalhos: [], offset: null, tem_mais: false, modo };
    }

    // 2. Filtro de ISOLAMENTO — robusto e a prova de erro de digitacao.
    //    Antes usavamos so o prefixo do "ID Trabalho" (LEFT(...) = "GEODEEP_"),
    //    mas isso PERDIA trabalhos cujo ID Trabalho fugia do padrao (auditoria:
    //    1538 trabalhos da Geodeep pelo campo Cliente, mas so 1536 pelo prefixo
    //    -> 2 sumiam). Agora filtramos pelo campo "Cliente" (link), que numa
    //    formula exibe o NOME do cliente — a ligacao real. Mantemos o prefixo
    //    como reforco (OR), entao pegamos TUDO do cliente, sem depender de
    //    ninguem ter digitado o ID Trabalho certinho.
    const nomeEsc = escaparFormula(nomeCliente || '');
    const porCliente = nomeCliente
        ? `{Cliente} = '${nomeEsc}'`
        : null;

    let ligacao;
    if (idCliente && porCliente) {
        const prefixo = escaparFormula(idCliente) + '_';
        const tam = prefixo.length;
        ligacao = `OR(${porCliente}, LEFT({ID Trabalho}, ${tam}) = '${prefixo}')`;
    } else if (porCliente) {
        ligacao = porCliente;
    } else if (idCliente) {
        const prefixo = escaparFormula(idCliente) + '_';
        const tam = prefixo.length;
        ligacao = `LEFT({ID Trabalho}, ${tam}) = '${prefixo}'`;
    } else {
        // sem nome nem id: nao da pra isolar com seguranca -> nao retorna nada
        return { nome_cliente: nomeCliente, trabalhos: [], offset: null, tem_mais: false, modo };
    }

    let formula;
    if (modo === 'recente') {
        const limite = dataLimiteRecente(meses);
        // "recente" = cadastrado nos ultimos N meses. CREATED_TIME() e funcao
        // nativa do Airtable (sempre preenchida) — nao precisa de OR com BLANK().
        formula = `AND(${ligacao}, IS_AFTER(CREATED_TIME(), '${limite}'))`;
    } else {
        formula = ligacao;
    }

    // 3. Filtra e busca TODAS as paginas antes de ordenar. createdTime e
    //    meta-dado (a API nao ordena por ele), entao a ordem so fica correta
    //    ordenando o conjunto COMPLETO em memoria — nao basta ordenar por
    //    pagina, porque dois trabalhos do mesmo cliente podem cair em paginas
    //    diferentes (foi o bug do REG 638 vs C11-01). O parametro `offset` de
    //    entrada passa a ser ignorado: a paginacao agora e interna.
    let todosRecords = [];
    let offsetAt = null;
    do {
        let url = `${API}/${TBL_NOVOS_TRABALHOS}`
            + `?filterByFormula=${encodeURIComponent(formula)}`
            + `&pageSize=${TAMANHO_PAGINA}`;
        if (offsetAt) url += `&offset=${encodeURIComponent(offsetAt)}`;
        const resp = await airtableGet(url);
        todosRecords = todosRecords.concat(resp.records || []);
        offsetAt = resp.offset || null;
    } while (offsetAt);

    const trabalhos = todosRecords
        .map(rec => formatar(rec, mapa, mapaOrdens))
        .sort((a, b) => new Date(b.data_ordenacao) - new Date(a.data_ordenacao));

    return {
        nome_cliente: nomeCliente,
        trabalhos,
        offset: null,      // sem paginacao externa: veio tudo de uma vez
        tem_mais: false,
        modo
    };
}

// ==================== URL FRESCA DO PDF (download na hora) ====================
// Os links de anexo do Airtable expiram. Esta funcao busca o trabalho de novo
// no momento do clique e devolve uma URL valida do PDF aprovado.
async function urlRelatorioAprovado(recordIdTrabalho) {
    const rec = await airtableGet(`${API}/${TBL_NOVOS_TRABALHOS}/${recordIdTrabalho}`);
    const pdf = primeiroPdf(rec.fields['Relatórios_Aprovados']);
    if (!pdf) return null;
    return { nome: pdf.nome, url: pdf.url };
}

// ==================== BUSCAR CLIENTE POR CNPJ ====================
// Extrai o PRIMEIRO e-mail do campo "Email Cliente" (multilineText: pode
// conter varios e-mails, um por linha). Decisao de projeto: o login usa
// sempre a PRIMEIRA linha como credencial. Normaliza (minusculas, sem espaco).
function primeiroEmailCliente(campo) {
    if (!campo) return null;
    const linhas = String(campo)
        .split(/[\r\n]+/)          // quebra por linha
        .map(l => l.trim().toLowerCase())
        .filter(Boolean);          // remove linhas vazias
    return linhas[0] || null;
}

async function buscarClientePorCnpj(cnpj) {
    const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
    if (cnpjLimpo.length !== 14) return null;

    const formula = `TRIM({CNPJ}) = '${escaparFormula(cnpjLimpo)}'`;
    const url = `${API}/${TBL_CLIENTES}`
        + `?filterByFormula=${encodeURIComponent(formula)}`
        + `&maxRecords=1`;

    const resp = await airtableGet(url);
    const rec = (resp.records || [])[0];
    if (!rec) return null;

    return {
        id: rec.id,
        nome: rec.fields['Nome Cliente'] || null,
        idCliente: rec.fields['ID Cliente'] || null,
        // primeiro e-mail cadastrado (credencial de login); null se vazio
        emailLogin: primeiroEmailCliente(rec.fields['Email Cliente']),
        cnpj: cnpjLimpo
    };
}

// ==================== PAINEL DO DIRETOR ====================

// Lista TODOS os clientes do Airtable (as "nuvenzinhas" do painel).
// Retorna id (record), nome e idCliente (prefixo). Ordenado por nome.
async function listarClientes() {
    let todos = [];
    let offset = null;
    do {
        let url = `${API}/${TBL_CLIENTES}?pageSize=${TAMANHO_PAGINA}`
            + `&fields%5B%5D=${encodeURIComponent('Nome Cliente')}`
            + `&fields%5B%5D=${encodeURIComponent('ID Cliente')}`;
        if (offset) url += `&offset=${encodeURIComponent(offset)}`;
        const resp = await airtableGet(url);
        todos = todos.concat(resp.records || []);
        offset = resp.offset || null;
    } while (offset);

    // O rótulo exibido é "ID Cliente" (decisão: é onde está o nome real da
    // empresa — ex: "Grupo Aterpa"). "Nome Cliente" fica como fallback e é o
    // que o isolamento de trabalhos usa internamente (não mudar aquilo).
    return todos
        .map(rec => ({
            id: rec.id,
           nome: (rec.fields['ID Cliente'] || '(sem nome)').trim(),
            idCliente: rec.fields['ID Cliente'] || null
        }))
        .filter(c => c.nome && c.nome !== '(sem nome)')
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Define o campo "Aprovação" de um trabalho. A automacao do Airtable cuida do
// resto (quando vira "Aprovado", copia o PDF de Relatorios -> Relatorios_Aprovados).
// Valores validos = as opcoes do singleSelect na base.
const APROVACAO_VALIDAS = ['Aprovado', 'Refazer', 'Em Andamento'];

async function definirAprovacao(recordIdTrabalho, valor) {
    if (!APROVACAO_VALIDAS.includes(valor)) {
        throw new Error(`Valor de aprovação inválido: "${valor}".`);
    }
    const url = `${API}/${TBL_NOVOS_TRABALHOS}/${recordIdTrabalho}`;
    const resp = await airtablePatch(url, { 'Aprovação': valor });
    return { id: resp.id, aprovacao: resp.fields?.['Aprovação'] || valor };
}

module.exports = {
    buscarTrabalhosDoCliente,
    buscarClientePorCnpj,
    urlRelatorioAprovado,
    listarClientes,
    definirAprovacao,
    APROVACAO_VALIDAS
};