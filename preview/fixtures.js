const nome = 'Construtora Demonstração — dados fictícios';
const trabalhos = [
  { id: 'demo-1', ensaio: 'Resistência à compressão — demonstração', sigla: 'RC', amostra: 'Corpos de prova A01', os: 'DEMO-001', norma: 'ABNT NBR 5739', data: '2026-10-15', pdf: true, status_cliente: 'Relatório Disponível', aprovacao: 'Aprovado', datas: {} },
  { id: 'demo-2', ensaio: 'Caracterização de solo — demonstração', sigla: 'CS', amostra: 'Amostra S02', os: 'DEMO-002', norma: 'ABNT NBR 6457', data: '2026-10-17', relatorio_em_andamento: true, aprovacao: 'Em Andamento', datas: {} },
  { id: 'demo-3', ensaio: 'Controle de concreto — demonstração', sigla: 'CC', amostra: 'Lote C03', os: 'DEMO-003', data: '2026-10-18', status_cliente: 'Aguardando', aprovacao: 'Em Andamento', datas: {} }
];
function response(route, persona) {
  const usuario = { nome: 'Visitante da prévia', nomeEmpresa: nome, documento: '00000000000000', perfil: persona === 'director' ? 'Director' : 'Cliente', visualizacaoDev: true, seguranca: { onboardingRequired: false } };
  const routes = {
    '/api/perfil': { sucesso: true, usuario },
    '/api/runtime': { sucesso: true, safeMode: true, visualizacaoDev: true },
    '/api/navegacao': { sucesso: true, propostas: true, relatorios: true, financeiro: true },
    '/api/meus-dados': { sucesso: true, nome_cliente: nome, trabalhos, offset: null },
    '/api/conta': { sucesso: true, conta: { emails: ['contato@example.invalid'], whatsapps: [] } },
    '/api/propostas': { sucesso: true, propostas: [{ id: 'demo-proposta', numero: 'DEMO-2026/001', dataEnvio: '2026-10-15', status: 'Em Análise pelo Cliente', valor: 4200, formaPagamento: 'Demonstração — sem cobrança', prazoPagamentoDias: 30, documentos: [] }] },
    '/api/financeiro': { sucesso: true, estado: 'vazio', faturas: [], contratos: [], pendencias: {}, atualizadoEm: '2026-10-19T12:00:00Z' },
    '/api/diretor/clientes': { sucesso: true, clientes: [{ id: 'demo-cliente', nome, cnpj: '00000000000000' }] },
    '/api/diretor/trabalhos/demo-cliente': { sucesso: true, trabalhos: trabalhos.map(t => ({ ...t, id_trabalho: t.ensaio })) },
    '/api/diretor/downloads': { sucesso: true, downloads: [] }
  };
  return routes[route];
}
module.exports = { response };
