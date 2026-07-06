# Notas da correção — Portal ITR Engenharia

## O que foi corrigido
- Login retorna `usuario` completo e mantém `perfil` para compatibilidade.
- JWT passa a usar 8h por padrão (`JWT_EXPIRES_IN=8h`, configurável no `.env`).
- Botão “Manter conectado” agora diferencia `localStorage` e `sessionStorage` corretamente.
- Portal lê token tanto de `localStorage` quanto de `sessionStorage`.
- Cadastro público usa `/api/cadastro` e preenche `tipo_documento`, `nome_empresa`, `perfil`, `airtable_client_id` e `status_conta`.
- Backend mantém aliases para as duas famílias de rotas:
  - Cliente: `/api/meus-dados` e `/api/trabalhos`
  - Download: `/api/relatorio/:id` e `/api/trabalho/:id/download`
  - Diretor: `/api/clientes` e `/api/diretor/clientes`
  - Trabalhos do diretor: `/api/cliente/:id/trabalhos` e `/api/diretor/trabalhos/:clienteId`
- Download aprovado registra auditoria em `relatorios_baixados` com `INSERT IGNORE`.
- Painel do Diretor mostra “Relatório enviado!” ao aprovar.
- Recuperação de senha agora possui telas `esqueci-senha.html` e `redefinir-senha.html`.
- Logo em base64 foi substituído por `public/IMG/logo.png`.
- `package.json` ganhou `npm start` e `npm run dev`.
- Foi adicionada uma migration segura em `migrations/001_corrigir_portal_itr.sql` para não precisar rodar o SQL destrutivo com `DROP DATABASE`.

## Como rodar
```bash
npm install
npm start
```

Depois abra:
```txt
http://localhost:3000/login.html
```

## Importante
Não rode o arquivo `Banco_dados_Login_ITRengenharia.sql` em banco com dados reais, porque ele contém `DROP DATABASE`.
Para banco já existente, use `migrations/001_corrigir_portal_itr.sql`.
