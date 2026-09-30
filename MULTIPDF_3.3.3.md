# Portal ITR 3.3.3 — múltiplos PDFs aprovados

## Escopo
Base: Portal 3.3.2 confirmado funcionando pelo usuário. A conexão GitHub deste chat retornou 404, portanto a versão remota atual não foi lida. O aplicador compara o conteúdo dos arquivos com a base 3.3.2 e recusa sobrescrever diferenças posteriores.

- Um único botão/ícone existente por trabalho.
- Um PDF: uma nova guia. Vários PDFs: uma guia para cada arquivo, quando permitido pelo navegador.
- A página do Portal não é usada como destino do PDF.
- O navegador pode bloquear guias adicionais. Nesse caso, links com o nome de cada PDF restante aparecem no próprio card. Basta clicar individualmente. Não há como garantir várias guias automáticas contra a política do navegador.
- As guias de preparação exibem texto, e são fechadas em erros, sessão expirada ou quando há menos arquivos que na listagem.
- Exibição inline em PDF preservada: o cliente usa o botão de download do visualizador do navegador. Não gera ZIP nem força salvamento automático.

## Causa da guia branca
A versão anterior chamava window.open com a feature noopener e esperava receber uma referência controlável à janela. Sem essa referência, o fallback navegava a própria página do Portal para o PDF. Agora as guias são criadas no clique, recebem opener=null explicitamente e são direcionadas individualmente ao proxy autenticado, sem fallback de navegação no Portal.

## Backend
O campo Relatórios_Aprovados é percorrido para selecionar todos os PDFs. Imagens são ignoradas e IDs de anexo repetidos são deduplicados. A listagem recebe apenas a quantidade, sem expor URLs do Airtable.
O endpoint /api/trabalho/:id/download preserva arquivo/url do primeiro PDF para compatibilidade e acrescenta arquivos[]. Cada URL aponta para /api/relatorio/:id?arquivo=ID_DO_ANEXO.
O proxy reconsulta o trabalho e verifica sessão, escopo do cliente, aprovação e seleção do anexo a cada PDF. A seleção por ID evita trocar arquivos se a ordem mudar; um arquivo removido retorna 404, sem substituir pelo primeiro. URLs temporárias do Airtable são resolvidas no servidor.

## Regras preservadas
Login, recuperação, e-mails, WhatsApp, agrupamentos restaurados na 3.3.2, status, datas, CSS, filtros, histórico e streaming não foram reformulados.
A aprovação continua obrigatória para download. A verificação de desatualização original — nome do primeiro PDF de Relatórios comparado ao primeiro de Relatórios_Aprovados — permanece exatamente como na 3.3.2. Este pacote não modifica essa regra nem as automações de aprovação do Airtable. Todos os anexos devem ser PDFs aprovados no campo correto.

## Validação
Node 22.23.3: npm run check, 67 testes aprovados; sintaxe/contratos do frontend e manifesto de integridade aprovados. Inclui HTTP local real com Airtable/SMTP simulados, seleção por ID, exigência de sessão, proxy PDF, abertura de guias com DOM simulado, bloqueio parcial, sessão expirada e fechamento de guias excedentes. Não houve teste manual em navegador Windows nem envio real.
Sem deploy ou push por este chat. O usuário executará a aplicação e o push pelo script, seguidos pelo deploy do Portal no Coolify.

## Aplicação
Baixe o pacote, extraia e execute Iniciar.ps1. Ele cria uma nova pasta em Projetos, clona main do repositório correto, prepara Node 22 portátil sem substituir o Node do sistema e chama Aplicar-MultiPDF.ps1 com -Push.
O aplicador exige repositório limpo e sincronizado, verifica hashes, testa em pasta temporária sem .env, salva backup Git/arquivos, aplica os arquivos explícitos, cria commit e faz push sem force. Preserva .env e os demais projetos. Não altera variáveis no Coolify nem o serviço de e-mails.
Após deploy do Portal, recarregue a página e teste um trabalho com um PDF e outro com dois ou mais PDFs aprovados. Confira que o Portal permanece aberto, os nomes correspondem aos arquivos e os links alternativos aparecem quando o navegador bloqueia guias. Se a aprovação original bloquear o arquivo, o card mostra a mensagem de indisponibilidade e fecha as guias temporárias.

## Arquivos alterados

- `MULTIPDF_3.3.3.md`
- `airtable.js`
- `lib/report-attachments.js`
- `package-lock.json`
- `package.json`
- `public/assets/js/portal.js`
- `server.js`
- `tests/airtable-client-work-lookup.test.js`
- `tests/report-attachments.test.js`
- `tests/report-download-http.test.js`
- `tests/report-tabs.test.js`
