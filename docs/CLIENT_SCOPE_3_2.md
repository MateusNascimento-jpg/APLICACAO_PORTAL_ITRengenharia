# Portal ITR 3.2 — Client Scope Resolver

- Nenhum campo novo no Airtable.
- Nenhuma migration nova no MySQL.
- O tenant e resolvido para uma lista explicita de Airtable Record IDs.
- Evidencias automaticas fortes: mesmo CNPJ, mesmo e-mail exato, mesmo trabalho linked, mesmo sample Record ID, owner operacional consistente, ou sobreposicao forte de varias amostras raras.
- Uma unica amostra textual ou nome parecido nunca concede acesso.
- A autorizacao final de trabalhos e PDF sempre exige `fields.Cliente` conter um Record ID do escopo.
- Snapshot do Airtable tem cache, single-flight e stale maximo.
- Rate limit em memoria precede MySQL; scrypt possui gate de concorrencia; /ready tem cache curto; servidor tem timeouts anti-slowloris.
- `PORTAL_SCOPE_OVERRIDES_JSON` existe apenas como escape hatch code-only revisado.
