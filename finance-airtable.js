// finance-airtable.js — leitura/escrita isolada da base financeira do Portal.
// A base operacional continua em airtable.js; este módulo nunca reutiliza o AIRTABLE_BASE_ID operacional.

const config = require('./config');
const { normalizarCnpj } = require('./lib/client-scope');

const finance = config.financeAirtable;

const TBL_CLIENTES = 'tbl8Sw1hYuEvgot8O';
const TBL_PROPOSTAS = 'tblTzY3Iggkhydke2';
const TBL_CATEGORIAS = 'tblvUVOgnV2jrVWre';

const F_CLIENTE_NOME = 'fldzpP7zyK4AfGcYL';
const F_CLIENTE_CNPJ = 'fldb8XcWv0Uooz3Uo';
const F_CLIENTE_EMAIL = 'fldtqo76edbzzQcNz';
const F_FEEDBACK = 'fldFMHkwowNMiiPpX';
const F_DESCRICAO_SERVICO = 'fldUqjrs0ZC46CIUg';

const F_NUMERO = 'fldrervlNmfixboQB';
const F_DATA_ENVIO = 'fldM5NumvmCwo9LEC';
const F_STATUS = 'fldTvIRySPUEG2Mwf';
const F_PDF = 'fld2aWLikbuqsoOgZ';
const F_CLIENTE = 'fldauuqhFbHn59uOl';
const F_VALOR = 'fld2lqgkDOpeKYJF5';
const F_FORMA_PAGAMENTO = 'fldOO5vLkKB4b8FIS';
const F_PRAZO = 'fldtZwrb2jt1zqSpz';
const F_SETOR = 'fldgQMKfXgzwF9JnP';
const F_CATEGORIA = 'fldPb7E5ICXlxoDM3';
const F_OBSERVACOES = 'flddZcSRWZZq57UrJ';
const F_CATEGORIA_NOME = 'fld563dZJQ1IcWmIQ';

const CACHE_CLIENTES_MS = 60_000;
const CACHE_PROPOSTAS_MS = 30_000;
const CACHE_CATEGORIAS_MS = 5 * 60_000;
let cacheClientes = { carregadoEm: 0, porCnpj: new Map() };
let cacheCategorias = { carregadoEm: 0, porId: new Map() };
const cachePropostas = new Map();
let propostasSnapshot = null;
let propostasInFlight = null;

function habilitado() {
    return Boolean(finance && finance.baseId && finance.token);
}

function recordIdValido(id) {
    return /^rec[a-zA-Z0-9]{14}$/.test(String(id || ''));
}

function valorSelect(valor) {
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) return valor.name || null;
    return valor == null ? null : String(valor);
}

function idDeLink(item) {
    // A REST API do Airtable devolve campos linked-record como array de record IDs
    // (strings). Alguns conectores/fixtures podem devolver objetos { id, name }.
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') return item.id || null;
    return null;
}

function idsDeLinks(valor) {
    if (!Array.isArray(valor)) return [];
    return valor.map(idDeLink).filter(Boolean);
}

function primeiroNomeLink(valor) {
    if (!Array.isArray(valor) || !valor.length) return null;
    const primeiro = valor[0];
    return primeiro && typeof primeiro === 'object' ? (primeiro.name || null) : null;
}

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(url, options = {}) {
    if (!habilitado()) {
        const erro = new Error('Integração financeira não configurada.');
        erro.code = 'FINANCE_NOT_CONFIGURED';
        throw erro;
    }

    let ultimoErro;
    for (let tentativa = 0; tentativa <= (options.method === 'PATCH' ? 0 : finance.retries); tentativa += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), finance.timeoutMs);
        try {
            const resp = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${finance.token}`,
                    ...(options.headers || {})
                }
            });
            const texto = await resp.text();
            let dados = {};
            if (texto) {
                try { dados = JSON.parse(texto); }
                catch (_) { throw new Error('Resposta inválida recebida do Airtable Financeiro.'); }
            }
            if (resp.ok) return dados;

            const retryable = resp.status === 429 || resp.status >= 500;
            const erro = new Error(dados.error?.message || `Airtable Financeiro respondeu HTTP ${resp.status}.`);
            erro.status = resp.status;
            if (!retryable || tentativa >= finance.retries) throw erro;
            ultimoErro = erro;
        } catch (error) {
            ultimoErro = error;
            const retryable = options.method !== 'PATCH' && (error.name === 'AbortError' || !error.status || error.status === 429 || error.status >= 500);
            if (!retryable || tentativa >= finance.retries) throw error;
        } finally {
            clearTimeout(timer);
        }
        await esperar(Math.min(2500, 250 * (2 ** tentativa)));
    }
    throw ultimoErro || new Error('Falha ao consultar o Airtable Financeiro.');
}

function api(tableId) {
    return `https://api.airtable.com/v0/${finance.baseId}/${tableId}`;
}

async function listarTodos(tableId, fieldIds, filterFormula = null, returnIds = true) {
    const registros = [];
    let offset = null;
    const offsets = new Set();
    do {
        const params = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: String(returnIds) });
        fieldIds.forEach(id => params.append('fields[]', id));
        if (filterFormula) params.set('filterByFormula', filterFormula);
        if (offset) params.set('offset', offset);
        const dados = await request(`${api(tableId)}?${params.toString()}`);
        registros.push(...(dados.records || []));
        offset = dados.offset || null;
        if (offset) {
            if (offsets.has(offset) || offsets.size >= 1000) throw new Error('AIRTABLE_PAGINATION_INVALID');
            offsets.add(offset);
            await esperar(220);
        }
    } while (offset);
    return registros;
}

async function carregarClientes() {
    if (Date.now() - cacheClientes.carregadoEm < CACHE_CLIENTES_MS && cacheClientes.porCnpj.size) return cacheClientes.porCnpj;
    const regs = await listarTodos(TBL_CLIENTES, [F_CLIENTE_NOME, F_CLIENTE_CNPJ]);
    const mapa = new Map();
    regs.forEach(rec => {
        const cnpj = normalizarCnpj(rec.fields?.[F_CLIENTE_CNPJ]);
        if (cnpj && mapa.has(cnpj)) { mapa.set(cnpj, { ambiguous: true }); return; }
        if (cnpj) mapa.set(cnpj, { id: rec.id, nome: rec.fields?.[F_CLIENTE_NOME] || null, cnpj });
    });
    cacheClientes = { carregadoEm: Date.now(), porCnpj: mapa };
    return mapa;
}

async function buscarClienteFinanceiroPorCnpj(cnpj) {
    const normalizado = normalizarCnpj(cnpj);
    if (!normalizado) return null;
    const mapa = await carregarClientes();
    const cliente = mapa.get(normalizado);
    if (cliente?.ambiguous) throw new Error('FINANCE_DUPLICATE_CNPJ');
    return cliente || null;
}

async function carregarCategorias() {
    if (Date.now() - cacheCategorias.carregadoEm < CACHE_CATEGORIAS_MS && cacheCategorias.porId.size) {
        return cacheCategorias.porId;
    }
    const regs = await listarTodos(TBL_CATEGORIAS, [F_CATEGORIA_NOME]);
    const mapa = new Map();
    regs.forEach(rec => {
        const nome = rec.fields?.[F_CATEGORIA_NOME];
        if (rec.id && nome) mapa.set(rec.id, String(nome));
    });
    cacheCategorias = { carregadoEm: Date.now(), porId: mapa };
    return mapa;
}

function mapearProposta(rec, categoriasPorId = new Map()) {
    const f = rec.fields || {};
    const anexos = Array.isArray(f[F_PDF]) ? f[F_PDF] : [];
    const categorias = Array.isArray(f[F_CATEGORIA])
        ? f[F_CATEGORIA].map(item => {
            if (item && typeof item === 'object' && item.name) return item.name;
            const id = idDeLink(item);
            return id ? (categoriasPorId.get(id) || null) : null;
        }).filter(Boolean)
        : [];
    return {
        id: rec.id,
        numero: f[F_NUMERO] || null,
        dataEnvio: f[F_DATA_ENVIO] || null,
        status: valorSelect(f[F_STATUS]) || 'Pendente',
        cliente: primeiroNomeLink(f[F_CLIENTE]),
        valor: typeof f[F_VALOR] === 'number' ? f[F_VALOR] : null,
        formaPagamento: valorSelect(f[F_FORMA_PAGAMENTO]),
        prazoPagamentoDias: Number.isFinite(f[F_PRAZO]) ? f[F_PRAZO] : null,
        setor: valorSelect(f[F_SETOR]),
        categorias,
        observacoes: f[F_OBSERVACOES] || null,
        descricao: typeof f[F_DESCRICAO_SERVICO]==='string' ? f[F_DESCRICAO_SERVICO] :
            (typeof f[F_DESCRICAO_SERVICO]?.value==='string' ? f[F_DESCRICAO_SERVICO].value : null),
        documentos: anexos.map(a => ({ id: a.id, nome: a.filename || 'Proposta.pdf', tipo: a.type || 'application/pdf', tamanho: a.size || null }))
    };
}

async function carregarRegistrosPropostas() {
    if (propostasSnapshot && Date.now() - propostasSnapshot.time < CACHE_PROPOSTAS_MS) return propostasSnapshot.records;
    if (propostasInFlight) return propostasInFlight;
    propostasInFlight = listarTodos(TBL_PROPOSTAS, [
        F_NUMERO, F_DATA_ENVIO, F_STATUS, F_PDF, F_CLIENTE, F_VALOR,
        F_FORMA_PAGAMENTO, F_PRAZO, F_SETOR, F_CATEGORIA, F_OBSERVACOES, F_DESCRICAO_SERVICO
    ]).then(records => {
        propostasSnapshot = { time: Date.now(), records };
        return records;
    }).finally(() => { propostasInFlight = null; });
    return propostasInFlight;
}

async function carregarPropostasCliente(clienteId, forcar = false) {
    const cached = cachePropostas.get(clienteId);
    if (!forcar && cached && Date.now() - cached.carregadoEm < CACHE_PROPOSTAS_MS) return cached.propostas;

    const [registros, categoriasPorId] = await Promise.all([
        carregarRegistrosPropostas(),
        carregarCategorias()
    ]);
    const propostas = registros
        .filter(rec => {
            const links = idsDeLinks(rec.fields?.[F_CLIENTE]);
            return links.length === 1 && links[0] === clienteId;
        })
        .map(rec => mapearProposta(rec, categoriasPorId))
        .sort((a, b) => String(b.dataEnvio || '').localeCompare(String(a.dataEnvio || '')) || String(b.numero || '').localeCompare(String(a.numero || '')));

    cachePropostas.set(clienteId, { carregadoEm: Date.now(), propostas });
    return propostas;
}

async function listarPropostasPorCnpj(cnpj) {
    const cliente = await buscarClienteFinanceiroPorCnpj(cnpj);
    if (!cliente) return { cliente: null, propostas: [] };
    return { cliente, propostas: await carregarPropostasCliente(cliente.id) };
}

async function propostaDoCliente(cnpj, propostaId, forcar = false) {
    if (!recordIdValido(propostaId)) return null;
    const cliente = await buscarClienteFinanceiroPorCnpj(cnpj);
    if (!cliente) return null;
    const propostas = await carregarPropostasCliente(cliente.id, forcar);
    const proposta = propostas.find(p => p.id === propostaId) || null;
    return proposta ? { cliente, proposta } : null;
}

// Decisões comerciais passam exclusivamente pelo serviço persistente de propostas.
async function carregarPropostaAtual(propostaId, cnpj = null) {
    if (!recordIdValido(propostaId)) throw new Error('PROPOSAL_NOT_FOUND');
    const rec = await request(`${api(TBL_PROPOSTAS)}/${propostaId}?returnFieldsByFieldId=true`);
    const links = idsDeLinks(rec.fields?.[F_CLIENTE]);
    if (links.length !== 1 || !recordIdValido(links[0])) throw new Error('PROPOSAL_LINK_INVALID');
    const cliente = await request(`${api(TBL_CLIENTES)}/${links[0]}?returnFieldsByFieldId=true`);
    const documento = normalizarCnpj(cliente.fields?.[F_CLIENTE_CNPJ]);
    if (!/^\d{14}$/.test(documento || '') || (cnpj && documento !== normalizarCnpj(cnpj))) throw new Error('PROPOSAL_NOT_FOUND');
    // Evita aceitar um vínculo cadastral duplicado/ambíguo pelo mesmo CNPJ.
    const unico = await buscarClienteFinanceiroPorCnpj(documento);
    if (!unico || unico.id !== cliente.id) throw new Error('PROPOSAL_LINK_INVALID');
    const { emails } = require('./lib/portal-access');
    return {
        ...mapearProposta(rec),
        createdTime: rec.createdTime,
        cnpj: documento,
        clienteId: cliente.id,
        nomeCliente: cliente.fields?.[F_CLIENTE_NOME] || 'Cliente',
        emails: emails(cliente.fields?.[F_CLIENTE_EMAIL] || ''),
        anexos: rec.fields?.[F_PDF] || [],
        feedback: rec.fields?.[F_FEEDBACK] || ''
    };
}

async function atualizarDecisao(propostaId, status, feedback) {
    if (!['Aceita', 'Rejeitada'].includes(status)) throw new Error('DECISION_INVALID');
    const fields = { [F_STATUS]: status };
    if (status === 'Rejeitada') fields[F_FEEDBACK] = feedback;
    await request(`${api(TBL_PROPOSTAS)}/${propostaId}?returnFieldsByFieldId=true`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });
    cachePropostas.clear();
    propostasSnapshot = null;
}

async function obterDocumentoProposta(cnpj, propostaId, attachmentId) {
    const proposta = await carregarPropostaAtual(propostaId, cnpj);
    const anexo = proposta.anexos.find(item => item.id === attachmentId);
    if (!anexo?.url) return null;
    return { nome: anexo.filename || 'Proposta.pdf', tipo: anexo.type, tamanho: anexo.size, url: anexo.url };
}

async function listarCandidatas(cutoff) {
    const timestamp = new Date(cutoff).toISOString();
    return listarTodos(TBL_PROPOSTAS, [F_CLIENTE, F_STATUS, F_PDF], `IS_AFTER(CREATED_TIME(), DATETIME_PARSE('${timestamp}'))`);
}

// Leitura de um registro pelo Record ID, usada pelo módulo Financeiro
// (lib/financeiro). Somente GET; registro inexistente retorna null.
async function obterRegistro(tableId, recordId) {
    if (!recordIdValido(recordId)) return null;
    try {
        return await request(`${api(tableId)}/${recordId}?returnFieldsByFieldId=true`);
    } catch (error) {
        if (error.status === 404) return null;
        throw error;
    }
}

module.exports = {
    habilitado,
    listarPropostasPorCnpj,
    carregarPropostaAtual,
    atualizarDecisao,
    listarCandidatas,
    obterDocumentoProposta,
    // Financeiro (somente leitura): reaproveita paginação, retries e timeout.
    listarRegistros: listarTodos,
    listarRegistrosPorNome: (tableId, names) => listarTodos(tableId, names, null, false),
    obterRegistro
};
