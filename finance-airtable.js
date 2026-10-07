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
    for (let tentativa = 0; tentativa <= finance.retries; tentativa += 1) {
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
            const retryable = error.name === 'AbortError' || !error.status || error.status === 429 || error.status >= 500;
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

async function listarTodos(tableId, fieldIds) {
    const registros = [];
    let offset = null;
    do {
        const params = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true' });
        fieldIds.forEach(id => params.append('fields[]', id));
        if (offset) params.set('offset', offset);
        const dados = await request(`${api(tableId)}?${params.toString()}`);
        registros.push(...(dados.records || []));
        offset = dados.offset || null;
    } while (offset);
    return registros;
}

async function carregarClientes() {
    if (Date.now() - cacheClientes.carregadoEm < CACHE_CLIENTES_MS && cacheClientes.porCnpj.size) return cacheClientes.porCnpj;
    const regs = await listarTodos(TBL_CLIENTES, [F_CLIENTE_NOME, F_CLIENTE_CNPJ]);
    const mapa = new Map();
    regs.forEach(rec => {
        const cnpj = normalizarCnpj(rec.fields?.[F_CLIENTE_CNPJ]);
        if (cnpj) mapa.set(cnpj, { id: rec.id, nome: rec.fields?.[F_CLIENTE_NOME] || null, cnpj });
    });
    cacheClientes = { carregadoEm: Date.now(), porCnpj: mapa };
    return mapa;
}

async function buscarClienteFinanceiroPorCnpj(cnpj) {
    const normalizado = normalizarCnpj(cnpj);
    if (!normalizado) return null;
    const mapa = await carregarClientes();
    return mapa.get(normalizado) || null;
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
        documentos: anexos.map(a => ({ id: a.id, nome: a.filename || 'Proposta.pdf', tipo: a.type || 'application/pdf', tamanho: a.size || null }))
    };
}

async function carregarPropostasCliente(clienteId, forcar = false) {
    const cached = cachePropostas.get(clienteId);
    if (!forcar && cached && Date.now() - cached.carregadoEm < CACHE_PROPOSTAS_MS) return cached.propostas;

    const [registros, categoriasPorId] = await Promise.all([
        listarTodos(TBL_PROPOSTAS, [
            F_NUMERO, F_DATA_ENVIO, F_STATUS, F_PDF, F_CLIENTE, F_VALOR,
            F_FORMA_PAGAMENTO, F_PRAZO, F_SETOR, F_CATEGORIA, F_OBSERVACOES
        ]),
        carregarCategorias()
    ]);
    const propostas = registros
        .filter(rec => idsDeLinks(rec.fields?.[F_CLIENTE]).includes(clienteId))
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

async function aceitarProposta(cnpj, propostaId) {
    const atual = await propostaDoCliente(cnpj, propostaId, true);
    if (!atual) return { ok: false, code: 'NOT_FOUND' };
    if (atual.proposta.status === 'Aceita') return { ok: true, proposta: atual.proposta, idempotente: true };
    if (['Rejeitada', 'Expirada'].includes(atual.proposta.status)) {
        return { ok: false, code: 'TERMINAL_STATUS', status: atual.proposta.status };
    }

    await request(`${api(TBL_PROPOSTAS)}/${encodeURIComponent(propostaId)}?returnFieldsByFieldId=true`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [F_STATUS]: 'Aceita' } })
    });
    cachePropostas.delete(atual.cliente.id);
    const atualizado = await propostaDoCliente(cnpj, propostaId, true);
    return { ok: true, proposta: atualizado?.proposta || { ...atual.proposta, status: 'Aceita' }, idempotente: false };
}

async function obterDocumentoProposta(cnpj, propostaId, attachmentId) {
    const atual = await propostaDoCliente(cnpj, propostaId, true);
    if (!atual) return null;

    const params = new URLSearchParams({ returnFieldsByFieldId: 'true' });
    params.append('fields[]', F_PDF);
    const dados = await request(`${api(TBL_PROPOSTAS)}/${encodeURIComponent(propostaId)}?${params.toString()}`);
    const anexos = Array.isArray(dados.fields?.[F_PDF]) ? dados.fields[F_PDF] : [];
    const anexo = anexos.find(a => a.id === attachmentId);
    if (!anexo?.url) return null;
    return { nome: anexo.filename || 'Proposta.pdf', tipo: anexo.type || 'application/pdf', tamanho: anexo.size || null, url: anexo.url };
}

module.exports = {
    habilitado,
    listarPropostasPorCnpj,
    aceitarProposta,
    obterDocumentoProposta
};
