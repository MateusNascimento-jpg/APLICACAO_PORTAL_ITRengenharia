'use strict';
const { hash, canonical } = require('./protocol');
const { today, calendar } = require('./contract');
const collection = type => !['NFSE_AVAILABLE', 'BOLETO_PAYMENT_RECORDED'].includes(type);
// Version of what one intent states: identity, labels, values and its own document.
// Status and authorization are excluded because every proof re-checks them live.
function eventVersion(s, type) {
    const kind = type === 'BOLETO_PAYMENT_RECORDED' ? null : type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto';
    return hash(canonical([s.clientId, s.proposalId, s.contractId, s.invoiceId, s.cnpjTag, s.contractName, s.installment,
        s.amountCents, s.dueDate, kind && s.documents[kind]]));
}
async function eligible(s, state, event, now, { overdueBoletoPayable = false } = {}) {
    if (!state || !s.registered.includes(event.recipient)) throw new Error('RECIPIENT_UNAUTHORIZED');
    if (s.proposalStatus !== 'Aceita' || !['Ativo', 'Concluído'].includes(s.contractStatus) ||
        !['Aguardando Emissão da NF', 'A Vencer', 'Vencido', 'Pago'].includes(s.paymentStatus)) throw new Error('STATUS_INELIGIBLE');
    if (!calendar(event, now)) throw new Error('OBSOLETE');
    if (event.type === 'BOLETO_PAYMENT_RECORDED') {
        if (s.paymentStatus !== 'Pago' || !state.transitionId || state.transitionId !== event.transitionId) throw new Error('PAYMENT_TRANSITION_INVALID');
        return null;
    }
    if (collection(event.type) && (state.stopped || s.paymentStatus === 'Pago')) throw new Error('COLLECTION_STOPPED');
    const d = s.documents[event.document.kind];
    if (!d || canonical(d) !== canonical(event.document)) throw new Error('DOCUMENT_CHANGED');
    if (state.blockedKinds?.includes(d.kind)) throw new Error('RECONCILIATION_REQUIRED');
    // Boletos and NFSe registered in Airtable were already approved by the responsible teams.
    if (d.kind === 'nfse') return { payable: false, payableAfterDue: false };
    // Whether a boleto remains payable after its due date is still open, so neither the PDF nor a claim about it goes out.
    if ((s.dueDate && s.dueDate < today(now) || s.paymentStatus === 'Vencido') && !overdueBoletoPayable) throw new Error('BOLETO_OVERDUE_RULE_PENDING');
    return { payable: true, payableAfterDue: overdueBoletoPayable };
}
module.exports = { collection, eligible, eventVersion };
