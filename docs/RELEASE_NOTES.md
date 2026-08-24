# Release final — segurança + design original

Esta release substitui a experiência visual redesenhada pela interface original fornecida no ZIP atual, mantendo as camadas de segurança implementadas. Nenhuma credencial real é incluída no pacote.


## 3.0.1 — correção administrativa

- Corrige limpeza do rate limit do Diretor: conta e IP são zerados após login válido.
- `npm run reset:director-password` também remove bloqueios administrativos pendentes.
- Novo `npm run unlock:director` para recuperação local sem alterar a senha.
- JS/CSS passam a revalidar no navegador para evitar mistura de arquivos de versões diferentes após atualização.
- Nenhuma alteração visual nas páginas do Portal.
