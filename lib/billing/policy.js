'use strict';
const { hash, canonical } = require('./protocol');
const { calendar } = require('./contract');
const collection = type => !['NFSE_AVAILABLE', 'BOLETO_PAYMENT_RECORDED'].includes(type);
const REMINDERS = ['BOLETO_D_MINUS_1', 'BOLETO_DUE_TODAY', 'BOLETO_OVERDUE_REMINDER'];
// Version of what one intent states: identity, labels, values and its own document.
// Status and authorization are excluded because every proof re-checks them live.
function eventVersion(s, type) {
    const kind = type === 'BOLETO_PAYMENT_RECORDED' ? null : type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto';
    return hash(canonical([s.clientId, s.proposalId, s.contractId, s.invoiceId, s.cnpjTag, s.contractName, s.installment,
        s.amountCents, s.dueDate, kind && s.documents[kind]]));
}
async function eligible(s, state, event, now) {
    if (!state || !s.registered.includes(event.recipient)) throw new Error('RECIPIENT_UNAUTHORIZED');
    if (s.proposalStatus !== 'Aceita' || !['Ativo', 'Concluído'].includes(s.contractStatus) ||
        !['Aguardando Emissão da NF', 'A Vencer', 'Vencido', 'Pago'].includes(s.paymentStatus)) throw new Error('STATUS_INELIGIBLE');
    if (!calendar(event, now)) throw new Error('OBSOLETE');
    if (event.type === 'BOLETO_PAYMENT_RECORDED') {
        if (s.paymentStatus !== 'Pago' || !state.transitionId || state.transitionId !== event.transitionId) throw new Error('PAYMENT_TRANSITION_INVALID');
        return null;
    }
    if (collection(event.type) && (state.stopped || s.paymentStatus === 'Pago')) throw new Error('COLLECTION_STOPPED');
    // Not durable: the installment is evaluated again once the registry is corrected.
    if (collection(event.type) && s.paymentDataInconsistent) throw new Error('PAYMENT_DATA_INCONSISTENT');
    if (REMINDERS.includes(event.type) && !s.amountCents) throw new Error('INSTALLMENT_AMOUNT_MISSING');
    const d = s.documents[event.document.kind];
    if (!d || canonical(d) !== canonical(event.document)) throw new Error('DOCUMENT_CHANGED');
    if (state.blockedKinds?.includes(d.kind)) throw new Error('RECONCILIATION_REQUIRED');
    // Boletos and NFSe registered in Airtable were already approved by the responsible teams.
    if (d.kind === 'nfse') return { payable: false, payableAfterDue: false };
    // ITR confirmed the original PDF stays payable after the due date, with charges handled by the bank.
    return { payable: true, payableAfterDue: true };
}
module.exports = { collection, eligible, eventVersion };
