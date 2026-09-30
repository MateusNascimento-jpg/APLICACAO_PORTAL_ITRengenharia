# Portal 3.3.2 — restauração das regras anteriores dos relatórios

## Causa identificada e limite da conclusão
A entrega 3.3.1 incluiu alterações fora do escopo de login e e-mails. A comparação com APLICACAO_PORTAL_ITRengenharia-main (19).zip confirma isso. Sem uma OS/cliente afetado e sem acesso aos dados de produção, não é possível afirmar qual mudança causou o sintoma específico.

| Área | Alteração feita em 3.3.1 | Restauração em 3.3.2 |
|---|---|---|
| Listagem | PDF passou a exigir Aprovação=Aprovado e nome igual ao relatório atual | Volta a indicar PDF pela existência de Relatórios_Aprovados, exatamente como no original |
| Agrupamento de clientes | Heurísticas anteriores passaram a ser somente diagnósticas; CNPJs distintos não eram agrupados automaticamente | lib/client-scope.js original, incluindo vínculos, e-mails e evidências operacionais já usados antes |
| Histórico do Diretor | Consulta em lote substituída por snapshot global | Consulta individual por ID, com concorrência original |
| Download | Alterações na abertura da janela e no controle do streaming | Implementação original, adaptando apenas reconhecimento do papel GeneratedClient para autorização/auditoria |
| Indicadores | Cancelados excluídos do KPI de andamento; rótulo de última movimentação alterado | Fórmula e rótulo originais |
| Dicionários Airtable | Inclusão de singleflight e espera após falha | Rotinas originais |

## O que permanece
- Login CNPJ + sigla exata + primeiros seis dígitos; recuperação e textos novos.
- Identidade de login e destinatários da recuperação limitados ao CNPJ digitado, mesmo quando o escopo operacional agrupa clientes.
- Sessões GeneratedClient, limites de tentativas e reconhecimento correto do cliente ao autorizar PDFs.
- E-mails 2.4.1 e seu teste Windows corrigido: não são modificados por este pacote.
- CSS, telas do Diretor, status/datas/filtros originais de trabalhos e integrações de Integridade.
- Sem alterações de .env, banco ou Airtable.

A regra de download ORIGINAL já exigia Aprovação=Aprovado, anexo em Relatórios_Aprovados e compatibilidade do nome com Relatórios. Essa verificação não foi inventada pela versão 3.3.1 e foi mantida. A mudança indevida foi aplicá-la também à listagem. Por compatibilidade, a distinção original entre listagem e download volta a existir.

A restauração dos agrupamentos volta às permissões operacionais anteriores: registros de CNPJs diferentes podem compartilhar trabalhos quando as regras originais os agrupam. Não é uma autorização nova configurada por este pacote; é a reversão da mudança de 3.3.1. Os testes originais também verificam que uma amostra isolada comum não une empresas.

## Validação
Node 22.23.3: npm run check aprovado, 58 testes; sintaxe e contratos do frontend aprovados. Testes cobrem agrupamento original, listagem de PDF publicado, restrições originais de download, histórico por ID e login/recuperação gerados. Sem Airtable/SMTP reais.
Comparação de código: airtable.js equivale ao original mais os trechos de identidade necessários ao login gerado. lib/client-scope.js e o diagnóstico correspondem ao original. CSS inalterado.
PowerShell revisado, não executado em Windows neste ambiente. Sem acesso atual ao repositório privado pela conexão deste chat; o aplicador verifica hashes antes de substituir arquivos e recusa divergências posteriores. Não houve push/deploy por este chat.

## Aplicação
1. Extraia ITR_RESTAURAR_RELATORIOS_3.3.2.zip.
2. Use Node 22, Git e o repositório do Portal em main, limpo e atualizado com origin/main.
3. Execute Aplicar-Restauracao.ps1 -PortalPath "CAMINHO_DO_PORTAL" -Push.
4. O script testa em pasta temporária sem .env, salva Git bundle e arquivos anteriores, aplica apenas os arquivos listados, cria commit e faz push quando solicitado. Preserva .env. Não apaga arquivos extras.
5. Publique apenas o Portal no Coolify. Não altere as variáveis de ambiente nem publique novamente os e-mails.
6. Após deploy, entre de novo e compare uma OS conhecida: quantidade de trabalhos, indicador de relatório e PDF. Testes de saúde não substituem essa confirmação.

Para desfazer esta correção, use git revert do commit de restauração após revisar o estado local; não use reset --hard/force-push. O backup registra o commit anterior.

## Arquivos alterados em relação à versão entregue 3.3.1

- `README.md`
- `RELEASE_CONSOLIDADO.md`
- `RESTAURACAO_RELATORIOS_3.3.2.md`
- `airtable.js`
- `lib/client-scope.js`
- `package-lock.json`
- `package.json`
- `public/assets/js/portal.js`
- `scripts/diagnose-client-scope.js`
- `server.js`
- `tests/airtable-client-work-lookup.test.js`
- `tests/client-scope.test.js`
