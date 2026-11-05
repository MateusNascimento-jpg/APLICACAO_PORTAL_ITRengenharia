# Migration 006: revisão e aplicação

**Situação:** testada em MySQL 8.0.46 local e descartável, em 05/11/2026. Nunca rodou em banco de homologação ou produção.

## Revisão

- **Conteúdo:** 8 comandos `CREATE TABLE IF NOT EXISTS portal_billing_*`. Não há `DROP`, `ALTER`, `UPDATE` nem `DELETE`, e nenhuma tabela existente é tocada.
- **Proteção:** `lib/billing/migrate.js` recusa qualquer outro tipo de comando e usa um lock contra execução simultânea.
- **Tabelas sem uso:** `portal_billing_grants` e `portal_billing_documents` não são lidas pelo código, mas continuam porque não se sabe se a migration já foi aplicada em algum ambiente. Removê-las exige outra decisão.
- **Limite do `IF NOT EXISTS`:** uma tabela já existente com outro formato passa sem erro. Por isso a verificação confere tabelas e colunas.
- **Crescimento:** auditoria, nonces e versões não têm limpeza. Isso não impede o início da operação, mas precisa de uma regra de retenção.

## Aplicação

A aplicação nunca acontece ao subir o Portal.

```bash
npm run billing:migrate                                      # mostra o plano e não abre conexão
npm run billing:migrate -- --verificar                       # confere o banco, somente leitura
npm run billing:migrate -- --aplicar --backup-confirmado     # aplica e confere
```

Saída `0` indica banco conforme, `2` indica tabelas ou colunas faltando e `1` indica falha. Repetir a aplicação é seguro. O script usa o banco configurado no `.env`, então **confira o ambiente antes de rodar**.

## Teste em MySQL isolado

`tests/billing-mysql.test.js` cobre migrations, cifragem, locks, transações, nonces, reinício e falhas. Sem as variáveis abaixo, os testes de banco ficam como pulados.

**Último resultado:** 7/7, além de `billing-migrate` e `billing-report` com saída 0. A instância foi criada só para isso, com pasta de dados temporária, `--no-defaults`, escuta em 127.0.0.1, porta própria e usuário restrito ao banco, e foi apagada ao final. O servidor MySQL da máquina não foi acessado.

```bash
export BILLING_LOCAL_DB_NAME=itr_billing_test_homologacao BILLING_LOCAL_DB_USER=<usuário> BILLING_LOCAL_DB_PASSWORD=<senha>
NODE_ENV=test node --test tests/billing-mysql.test.js
```

O teste **apaga e recria as tabelas `portal_billing_*`** desse banco. Ele só aceita host local e banco com nome `itr_billing_test_*`. O usuário deve ter acesso apenas a esse banco.
