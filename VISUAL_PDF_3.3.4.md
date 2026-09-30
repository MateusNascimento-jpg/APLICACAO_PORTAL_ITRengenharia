# Portal 3.3.4 — apresentação dos PDFs bloqueados pelo navegador

Correção limitada ao frontend de abertura dos PDFs. Remove do card os avisos de preparação/sucesso, o texto “O navegador não abriu todos os PDFs” e a lista de links sem estilo.
Quando houver arquivos que não abriram, apresenta um diálogo compacto “Relatórios disponíveis”, com nomes dos arquivos, botões “Abrir PDF” e “Fechar”. Abre os PDFs em novas guias; o Portal permanece aberto. O bloqueio de guias do navegador continua existindo e não é contornado: os links permitem a abertura individual por clique.
O “ler mais” das amostras já existia antes e não está visível na imagem enviada. Ele não foi removido, pois pertence à expansão do nome da amostra e não ao download de PDF.

Backend, seleção dos anexos, aprovação, agrupamentos, status, login e e-mails permanecem byte a byte iguais à 3.3.3. O CSS original foi preservado com a adição somente de seletores .relatorios-dialog, sem regras globais novas.

Validação: Node 22, npm run check aprovado (67 testes). Testes DOM simulados verificam diálogo, links seguros e ausência de avisos no card. Não houve validação visual em navegador real: Chromium não estava disponível no ambiente. Nenhum push/deploy foi executado neste chat.

Aplicação: Iniciar.ps1 cria uma pasta nova, reutiliza Node 22 disponível (ou baixa se ausente), clona main e executa Aplicar-MultiPDF.ps1 -Push. O aplicador verifica a base 3.3.3, testa, salva backup, aplica os arquivos listados, cria commit e faz push. Divergências posteriores são recusadas. Sem alterações de .env/Coolify/e-mails. Publique somente o Portal e recarregue a página.
