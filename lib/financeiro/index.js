'use strict';

// Módulo Financeiro (Contratos e Faturas) — consulta somente leitura.

const { createFinanceiroService } = require('./service');
const { registerFinanceiroRoutes, papelPermitido } = require('./routes');
const { STATUS_PROPOSTA_ACEITA } = require('./schema');

function possuiPropostaAceita(propostas) {
    return Array.isArray(propostas) && propostas.some(p => p && p.status === STATUS_PROPOSTA_ACEITA);
}

// Usado por /api/navegacao a partir da lista de propostas já carregada (mesmo
// vínculo estrito por Record ID). É apenas apresentação: as rotas do
// Financeiro refazem toda a autorização a cada pedido.
function financeiroVisivel(session, propostas) {
    return papelPermitido(session) && possuiPropostaAceita(propostas);
}

function install(app, dependencies) {
    const service = createFinanceiroService({ airtable: dependencies.airtable });
    registerFinanceiroRoutes(app, { ...dependencies, service });
    return service;
}

module.exports = { install, financeiroVisivel, possuiPropostaAceita };
