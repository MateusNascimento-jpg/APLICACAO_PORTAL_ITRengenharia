'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalModuleLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'dotenv') {
        return { config() { return {}; } };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
};

process.on('exit', () => {
    Module._load = originalModuleLoad;
});

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() {
            return JSON.stringify(body);
        }
    };
}

function prepararAmbiente() {
    process.env.AIRTABLE_TOKEN = 'test-token';
    process.env.AIRTABLE_BASE_ID = 'appTESTBASE12345';

    process.env.DB_HOST = 'localhost';
    process.env.DB_USER = 'test';
    process.env.DB_PASS = 'test';
    process.env.DB_NAME = 'test';

    process.env.PORTAL_SECURITY_PEPPER =
        Buffer.alloc(32, 7).toString('base64');

    process.env.CLIENT_PASSWORDS_ENABLED = 'false';
}

test(
    'cliente é isolado pelo Record ID e a fórmula recente não depende do nome do linked record',
    async () => {

        prepararAmbiente();

        const clienteId = `rec${'A'.repeat(14)}`;
        const outroClienteId = `rec${'B'.repeat(14)}`;

        const autorizado = `rec${'C'.repeat(14)}`;
        const outro = `rec${'D'.repeat(14)}`;

        let formulaConsultada = '';

        const originalFetch = global.fetch;

        global.fetch = async function fetchMock(url) {

            const parsed = new URL(String(url));

            if (
                parsed.pathname.endsWith(
                    '/tblYtVM2crMxpxHgG'
                )
            ) {
                return jsonResponse({ records: [] });
            }

            if (
                decodeURIComponent(parsed.pathname)
                    .endsWith('/Ordem de Serviço')
            ) {
                return jsonResponse({ records: [] });
            }

            if (
                parsed.pathname.endsWith(
                    `/tblkQxQ6q7cBKXZ3C/${clienteId}`
                )
            ) {
                return jsonResponse({
                    id: clienteId,
                    fields: {
                        'ID Cliente': 'CLIENTE PRIMARIO',
                        'Nome Cliente': 'Nome Legado'
                    }
                });
            }

            if (
                parsed.pathname.endsWith(
                    '/tblJAP4Av9sWm8SmL'
                )
            ) {
                formulaConsultada =
                    parsed.searchParams.get(
                        'filterByFormula'
                    ) || '';

                return jsonResponse({
                    records: [
                        {
                            id: autorizado,
                            createdTime:
                                '2026-09-01T12:00:00.000Z',
                            fields: {
                                Cliente: [clienteId],
                                'Link Amostras':
                                    'AM-CLIENTE-01',
                                'Status Cliente':
                                    'Amostra Recebida'
                            }
                        },
                        {
                            id: outro,
                            createdTime:
                                '2026-09-01T12:01:00.000Z',
                            fields: {
                                Cliente:
                                    [outroClienteId],
                                'Link Amostras':
                                    'AM-OUTRO-CLIENTE',
                                'Status Cliente':
                                    'Amostra Recebida'
                            }
                        }
                    ]
                });
            }

            throw new Error(
                `URL não prevista: ${url}`
            );
        };

        try {

            delete require.cache[
                require.resolve('../config')
            ];

            delete require.cache[
                require.resolve('../airtable')
            ];

            const {
                buscarTrabalhosDoCliente
            } = require('../airtable');

            const resultado =
                await buscarTrabalhosDoCliente(
                    clienteId,
                    null,
                    'recente',
                    3
                );

            assert.doesNotMatch(
                formulaConsultada,
                /CLIENTE PRIMARIO|Nome Legado/
            );

            assert.match(
                formulaConsultada,
                /Status Cliente/
            );

            assert.match(
                formulaConsultada,
                /CREATED_TIME/
            );

            assert.equal(
                resultado.trabalhos.length,
                1
            );

            assert.equal(
                resultado.trabalhos[0].id,
                autorizado
            );

            assert.equal(
                resultado.trabalhos[0].amostra,
                'AM-CLIENTE-01'
            );

        } finally {
            global.fetch = originalFetch;
        }
    }
);

test(
    'histórico completo não depende de texto do cliente e continua fail-closed por Record ID',
    async () => {

        prepararAmbiente();

        const clienteId =
            `rec${'E'.repeat(14)}`;

        const outroClienteId =
            `rec${'F'.repeat(14)}`;

        const autorizado =
            `rec${'G'.repeat(14)}`;

        const outro =
            `rec${'H'.repeat(14)}`;

        let formulaConsultada = null;

        const originalFetch = global.fetch;

        global.fetch = async function fetchMock(url) {

            const parsed = new URL(String(url));

            if (
                parsed.pathname.endsWith(
                    '/tblYtVM2crMxpxHgG'
                )
            ) {
                return jsonResponse({ records: [] });
            }

            if (
                decodeURIComponent(parsed.pathname)
                    .endsWith('/Ordem de Serviço')
            ) {
                return jsonResponse({ records: [] });
            }

            if (
                parsed.pathname.endsWith(
                    `/tblkQxQ6q7cBKXZ3C/${clienteId}`
                )
            ) {
                return jsonResponse({
                    id: clienteId,
                    fields: {
                        'ID Cliente':
                            'CLIENTE SEM NOME LEGADO'
                    }
                });
            }

            if (
                parsed.pathname.endsWith(
                    '/tblJAP4Av9sWm8SmL'
                )
            ) {
                formulaConsultada =
                    parsed.searchParams.get(
                        'filterByFormula'
                    );

                return jsonResponse({
                    records: [
                        {
                            id: autorizado,
                            createdTime:
                                '2024-01-01T12:00:00.000Z',
                            fields: {
                                Cliente: [clienteId],
                                'Link Amostras':
                                    'AM-HISTORICO-01',
                                'Status Cliente':
                                    'Relatório Disponível'
                            }
                        },
                        {
                            id: outro,
                            createdTime:
                                '2024-01-01T12:01:00.000Z',
                            fields: {
                                Cliente:
                                    [outroClienteId],
                                'Link Amostras':
                                    'AM-OUTRO',
                                'Status Cliente':
                                    'Relatório Disponível'
                            }
                        }
                    ]
                });
            }

            throw new Error(
                `URL não prevista: ${url}`
            );
        };

        try {

            delete require.cache[
                require.resolve('../config')
            ];

            delete require.cache[
                require.resolve('../airtable')
            ];

            const {
                buscarTrabalhosDoCliente
            } = require('../airtable');

            const resultado =
                await buscarTrabalhosDoCliente(
                    clienteId,
                    null,
                    'todos',
                    3
                );

            assert.equal(
                formulaConsultada,
                null
            );

            assert.equal(
                resultado.nome_cliente,
                'CLIENTE SEM NOME LEGADO'
            );

            assert.equal(
                resultado.trabalhos.length,
                1
            );

            assert.equal(
                resultado.trabalhos[0].id,
                autorizado
            );

        } finally {
            global.fetch = originalFetch;
        }
    }
);