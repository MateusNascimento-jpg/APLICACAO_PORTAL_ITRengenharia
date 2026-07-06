# Sistema de Gestão e Sincronização — ITR Engenharia

Este repositório contém a infraestrutura de backend para a **Gestão de Amostras Laboratoriais** da empresa de Engenharia Civil "ITR Engenharia". O sistema atua como uma camada de integração (middleware) entre o Airtable (Fonte de Dados da companhia) e um banco de dados constrído no MySQL, permitindo consultas de alta performance e processamento de diagnósticos de clientes/ensaios e amostras. 

##  Objetivo da Aplicação
Automatizar a sincronização de dados entre o Airtable e o banco de dados relacional (MySQL), disponibilizando uma API para consumo pela interface web. O foco é garantir que os dados de laboratório estejam sempre consistentes, validados e disponíveis para busca em tempo real.

##  Stack Tecnológico
- **Runtime:** Node.js
- **Framework:** Express.js
- **Persistência:** MySQL
- **Integração:** Airtable API
- **Ferramentas de Dev:** REST Client (`.http`)

##  Estrutura do Projeto
- `server.js`: Ponto de entrada e configuração do servidor HTTP.
- `db.js`: Gerenciamento da conexão e queries com o banco de dados MySQL.
- `airtable.js`: Lógica de consumo da API do Airtable.
- `diagnostico_cliente.js`: Lógica de negócio para processamento dos diagnósticos.
- `requisicoes.http`: Arquivo para testes locais de rotas.
- `.env`: Configurações sensíveis (não versionado).

## Como Executar

### Pré-requisitos (aplicação Web) 
- Node.js (v16+)
- MySQL 8.0+
- VSCode 1.125 (Preferível) 

### Instalação
1. Clone o repositório: `git clone <url-do-repositorio>` 
2. Instale as dependências: `npm install`
3. Configure o arquivo `.env` (DB_HOST, DB_USER, DB_PASS, AIRTABLE_API_KEY).
4. Inicie o servidor: `npm start`

## Segurança e Governança
- **Variáveis de Ambiente:** O arquivo `.env` não é versionado (contém chaves sensíveis).
- **Consistência:** Uso de *constraints* nativas no MySQL para garantir a integridade e veracidade dos dados.

---
*© **ITR Engenharia** — Uso interno e restrito.*
