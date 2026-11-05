'use strict';
const { date } = require('./contract');
const { documentKey } = require('./policy');
function validateEvidence(input, cipher) {
    const d = structuredClone(input);
    if (!d || !/^rec[A-Za-z0-9]{14}$/.test(d.clientId || '') || !/^\d{14}$/.test(d.cnpj || '') ||
        !/^[a-f0-9]{64}$/.test(d.evidenceHash || '') || !Number.isSafeInteger(d.validFrom) || !Number.isSafeInteger(d.validUntil) ||
        d.validUntil <= d.validFrom || typeof d.revoked !== 'boolean') throw new Error('EVIDENCE_INVALID');
    d.cnpjTag = cipher.tag(d.cnpj); delete d.cnpj;
    if (d.type === 'document') {
        if (![d.proposalId, d.contractId, d.invoiceId].every(x => /^rec[A-Za-z0-9]{14}$/.test(x || '')) ||
            d.kind !== 'nfse' || !/^[a-f0-9]{64}$/.test(d.sha256 || '') ||
            !(d.dueDate === null || date(d.dueDate)) || !(d.amountCents === null || Number.isSafeInteger(d.amountCents) && d.amountCents >= 0) ||
            typeof d.payable !== 'boolean' || typeof d.payableAfterDue !== 'boolean') throw new Error('DOCUMENT_EVIDENCE_INVALID');
        d.id = documentKey(d.invoiceId, d);
    } else throw new Error('EVIDENCE_TYPE_INVALID');
    const allowed = ['type', 'clientId', 'cnpjTag', 'evidenceHash', 'validFrom', 'validUntil', 'revoked', 'id',
        'proposalId', 'contractId', 'invoiceId', 'kind', 'sha256', 'dueDate', 'amountCents', 'payable', 'payableAfterDue'];
    if (Object.keys(d).some(k => !allowed.includes(k))) throw new Error('EVIDENCE_EXTRA_FIELD');
    return d;
}
module.exports = { validateEvidence };
