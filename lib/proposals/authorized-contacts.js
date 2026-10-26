'use strict';

// Regra comercial aprovada em 23/10/2026:
// os endereços cadastrados no cliente FINANCEIRO vinculado à proposta
// são elegíveis ao recebimento do código de aceite (um contato escolhido).
// O carregador de propostas verifica o vínculo único e o CNPJ do cliente.
// Não existe tabela adicional de autorização por endereço.
const { documento, emails } = require('../portal-access');

function commercialRecipients(proposal) {
    if (!/^rec[A-Za-z0-9]{14}$/.test(String(proposal?.clienteId || '')) ||
        !/^rec[A-Za-z0-9]{14}$/.test(String(proposal?.id || '')) ||
        documento(proposal?.cnpj).length !== 14 ||
        !Array.isArray(proposal?.emails)) return [];
    return emails(proposal.emails);
}

function createAuthorizedContacts() {
    return { async forProposal(proposal) { return commercialRecipients(proposal); } };
}

module.exports = { commercialRecipients, createAuthorizedContacts };
