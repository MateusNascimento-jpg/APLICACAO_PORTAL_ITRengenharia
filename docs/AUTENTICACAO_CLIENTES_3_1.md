# Implantação segura — senha pessoal e onboarding (3.1)

## Regra de rollout

**Não habilite `CLIENT_PASSWORDS_ENABLED=true` antes de configurar e testar o serviço de notificações.** A release vem com a flag `false` para não mudar o login dos clientes durante a instalação.

## 1. Atualize e migre os dois serviços

Portal:

```bash
npm ci
npm run verify
npm test
npm run migrate
npm run preflight
```

Serviço de e-mail/WhatsApp:

```bash
npm ci
npm run verificar
npm run test:security
```

## 2. Gere um segredo compartilhado

No Portal, localmente:

```bash
npm run generate:notification-secret
```

Guarde o valor em local seguro. Configure **o mesmo valor** nos ambientes:

Portal:

```text
PORTAL_NOTIFICATIONS_HMAC_SECRET=<segredo>
PORTAL_NOTIFICATIONS_URL=https://<servico-notificacoes>.onrender.com
```

Notificações:

```text
PORTAL_INTERNAL_HMAC_SECRET=<mesmo segredo>
PORTAL_ORIGIN=https://portal.itr.eng.br
```

Nunca reutilize `CHAVE_DISPARO_MANUAL`.

## 3. Teste com a feature ainda desligada

```text
CLIENT_PASSWORDS_ENABLED=false
```

Confirme login atual, cliente, Diretor, relatórios e `/ready`.

## 4. Atualize a comunicação diária

O e-mail diário agora chama o e-mail cadastrado de **“Senha inicial (somente no primeiro acesso)”**. No WhatsApp, o contexto de template inclui:

```text
cnpj
senha_inicial
email_acesso
```

O template aprovado na Meta deve explicar que, após o primeiro acesso, o cliente usa CNPJ + senha pessoal.

## 5. Habilite primeiro em ambiente/teste controlado

No Portal:

```text
CLIENT_PASSWORDS_ENABLED=true
```

Teste com um cliente de teste:

1. CNPJ + e-mail cadastrado não deve abrir o Portal; deve enviar link.
2. Link de ativação deve criar a senha uma única vez.
3. CNPJ + senha deve autenticar.
4. CNPJ + e-mail não deve mais autenticar.
5. Recuperação deve responder genericamente e enviar link somente para dados válidos.
6. Reset deve invalidar a senha anterior e outras sessões.
7. Alteração em `Minha conta` deve exigir a senha atual.
8. Tour deve permitir `Fazer tour`, `Agora não`, `Pular tutorial` e replay em Conta.

## 6. WhatsApp de segurança (opcional)

O link de recuperação fica **somente no e-mail**. Para avisos de segurança via Meta, configure um template aprovado com parâmetros nomeados:

```text
cliente
evento
portal_url
```

E habilite:

```text
PORTAL_SECURITY_WHATSAPP_ENABLED=true
WHATSAPP_SECURITY_TEMPLATE_NAME=<template-aprovado>
WHATSAPP_SECURITY_TEMPLATE_LANGUAGE=pt_BR
```

## 7. Produção

Somente depois dos testes acima, habilite `CLIENT_PASSWORDS_ENABLED=true` no Render do Portal e acompanhe logs de `FIRST_ACCESS_NOTIFY`, `PASSWORD_NOTIFY`, `PASSWORD_*` e `/ready`.
