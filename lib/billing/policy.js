'use strict';
const { hash, canonical } = require('./protocol');
const { today, calendar } = require('./contract');
const collection = type => !['NFSE_AVAILABLE', 'BOLETO_PAYMENT_RECORDED'].includes(type);
const documentKey = (invoiceId, d) => hash(canonical([invoiceId, d.kind, d.sha256]));
// Version of what one intent states: identity, labels, values and its own document.
// Status and authorization are excluded because every proof re-checks them live.
function eventVersion(s, type) {
    const kind = type === 'BOLETO_PAYMENT_RECORDED' ? null : type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto';
    return hash(canonical([s.clientId, s.proposalId, s.contractId, s.invoiceId, s.cnpjTag, s.contractName, s.installment,
        s.amountCents, s.dueDate, kind && s.documents[kind]]));
}
async function eligible(s, state, event, repo, now, { overdueBoletoPayable = false } = {}) {
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
    // A boleto registered in Airtable was already approved by Finance. Whether it remains payable
    // after its due date is an open business rule, so neither the PDF nor a claim about it goes out.
    if (d.kind === 'boleto') {
        if ((s.dueDate && s.dueDate < today(now) || s.paymentStatus === 'Vencido') && !overdueBoletoPayable) throw new Error('BOLETO_OVERDUE_RULE_PENDING');
        return { payable: true, payableAfterDue: overdueBoletoPayable };
    }
    // That approval does not cover NFSe, which still needs its attestation.
    const attestation = await repo.document(documentKey(s.invoiceId, d));
    if (!attestation || attestation.revoked || attestation.validUntil <= now || attestation.validFrom > now ||
        attestation.clientId !== s.clientId || attestation.cnpjTag !== s.cnpjTag || attestation.proposalId !== s.proposalId ||
        attestation.contractId !== s.contractId || attestation.invoiceId !== s.invoiceId || attestation.sha256 !== d.sha256 ||
        attestation.kind !== d.kind || attestation.dueDate !== s.dueDate || attestation.amountCents !== s.amountCents ||
        !/^[a-f0-9]{64}$/.test(attestation.evidenceHash || '')) throw new Error('DOCUMENT_UNVERIFIED');
    return attestation;
}
module.exports = { collection, documentKey, eligible, eventVersion };
