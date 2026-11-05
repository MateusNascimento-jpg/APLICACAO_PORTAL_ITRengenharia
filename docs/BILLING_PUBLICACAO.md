# Automação financeira: publicação coordenada

Cada etapa exige autorização própria. Publicar o código com as flags desligadas não ativa nada. Para ligar a automação, os dois serviços precisam estar na mesma versão, porque `contract.js` mudou.

## Antes de publicar

- [ ] Commits finais aprovados e testes offline verdes em Node.js 22.22.0 nos dois repositórios
- [ ] `lib/billing/contract.js` e `protocol.js` do Portal idênticos a `billing/contract.js` e `protocol.js` das Notificações
- [ ] `npm audit`, `npm run verify:release` e revisão dos e-mails em Gmail e Outlook
- [ ] Airtable conferido em modo leitura: `fldVMUZcwtKKrrpDN`, tipos de data e valor de pagamento, e ID novo a cada PDF substituído
- [ ] Decisões: senha (`BILLING_SEGURANCA_SENHA.md`), risco do PDF (`BILLING_RISCO_CONTEUDO_PDF.md`), responsável pela rotina diária (`BILLING_ROTINA_DIARIA.md`) e clientes do piloto
- [ ] Backup do MySQL; nenhum recibo ou evento financeiro antigo nos ambientes

## Publicar na main

Integração direta, sem Pull Request. **Antes do push, confirme no Coolify se o Auto Deploy está ligado em cada aplicação** e se as variáveis financeiras estão ausentes ou iguais a `false`. Valor diferente de `true` ou `false` impede a subida do serviço.

```bash
git checkout main && git pull --ff-only origin main
git merge --ff-only <branch da automação>
git push origin main
```

Publique as Notificações e depois o Portal, em sequência.

## Implantar, com tudo desligado

1. [ ] `npm run billing:migrate -- --aplicar --backup-confirmado`; saída `0`
2. [ ] Subir as Notificações com `BILLING_EMAILS_ENABLED=false`
3. [ ] Subir o Portal com `PORTAL_BILLING_ENABLED=false`, `PORTAL_BILLING_WORKER_ENABLED=false` e `PORTAL_BILLING_PILOT_CLIENTS` vazio
4. [ ] Confirmar 503 `DISABLED` nas rotas financeiras e os fluxos homologados normais

## Ativar o piloto

5. [ ] Configurar segredos e origens; `PORTAL_NF_NOTIFICACOES_ATIVAS=false`
6. [ ] Ligar `BILLING_EMAILS_ENABLED=true` e depois `PORTAL_BILLING_ENABLED=true`
7. [ ] Ligar `PORTAL_BILLING_WORKER_ENABLED=true`, com a lista vazia, e confirmar `baselineComplete: true` em `npm run billing:report`
8. [ ] Preencher `PORTAL_BILLING_PILOT_CLIENTS` com os IDs exatos, conferidos no Airtable, e reiniciar o Portal
9. [ ] Lançar um boleto novo do piloto e confirmar a entrega; só documentos lançados depois da liberação geram mensagens
10. [ ] Rodar a rotina diária e ampliar a lista aos poucos

## Rollback

Desligar, nesta ordem, `PORTAL_BILLING_WORKER_ENABLED`, `PORTAL_BILLING_ENABLED` e `BILLING_EMAILS_ENABLED`. Preservar fila, auditoria e recibos, e conciliar as entregas incertas antes de religar. As tabelas `portal_billing_*` podem permanecer.
