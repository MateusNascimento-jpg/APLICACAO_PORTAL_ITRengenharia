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
function grantFor(s, recipient, now) {
    return s.grants.find(g => g.clientId === s.clientId && g.cnpjTag === s.cnpjTag && g.recipient === recipient &&
        g.authorized === true && g.revoked !== true && g.validUntil > now && g.validFrom <= now && /^[a-f0-9]{64}$/.test(g.evidenceHash || '') && s.registered.includes(recipient));
}
async function eligible(s, state, event, repo, now) {
    if (!state || !grantFor(s, event.recipient, now)) throw new Error('RECIPIENT_UNAUTHORIZED');
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
    const attestation = await repo.document(documentKey(s.invoiceId, d));
    if (!attestation || attestation.revoked || attestation.validUntil <= now || attestation.validFrom > now ||
        attestation.clientId !== s.clientId || attestation.cnpjTag !== s.cnpjTag || attestation.proposalId !== s.proposalId ||
        attestation.contractId !== s.contractId || attestation.invoiceId !== s.invoiceId || attestation.sha256 !== d.sha256 ||
        attestation.kind !== d.kind || attestation.dueDate !== s.dueDate || attestation.amountCents !== s.amountCents ||
        !/^[a-f0-9]{64}$/.test(attestation.evidenceHash || '')) throw new Error('DOCUMENT_UNVERIFIED');
    if (collection(event.type) && (attestation.payable !== true ||
        ((s.dueDate && s.dueDate < today(now) || s.paymentStatus === 'Vencido') && attestation.payableAfterDue !== true)))
        throw new Error('DOCUMENT_NOT_PAYABLE');
    return attestation;
}
module.exports = { collection, documentKey, eligible, eventVersion, grantFor };
