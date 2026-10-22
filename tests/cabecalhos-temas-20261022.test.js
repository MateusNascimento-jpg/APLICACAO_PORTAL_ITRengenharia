"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const css = fs.readFileSync(path.join(__dirname, "../public/assets/css/itr-ux-composicao.css"), "utf8");

function token(block, name) {
    const value = block.match(new RegExp(name + ":\\s*(#[0-9a-fA-F]{6});"));
    assert.ok(value, `Token ausente: ${name}`);
    return value[1].toLowerCase();
}

test("cabecalhos seguem o tema claro e escuro sem alterar a estrutura", () => {
    assert.match(css, /\.itr-header,\s*\.saudacao-principal\.itr-header/);
    assert.match(css, /@media \(max-width: 600px\)/);
    const marker = css.split("ITR-HEADER-TEMAS-2026-10-22-V3:BEGIN");
    assert.equal(marker.length, 2);
    const v3 = marker[1].split("ITR-HEADER-TEMAS-2026-10-22-V3:END")[0];
    const blocks = v3.match(/:root(?:\[data-tema="claro"\])?\s*\{[^}]+\}/g);
    assert.equal(blocks?.length, 2);
    const dark = blocks[0];
    const light = blocks[1];
    assert.match(dark, /^:root\s*\{/);
    assert.match(light, /^:root\[data-tema="claro"\]/);
    assert.equal(token(dark, "--itr-header-bg"), "#242b30");
    assert.equal(token(light, "--itr-header-bg"), "#eceeec");
    assert.equal(token(dark, "--itr-header-text"), "#f3f5f6");
    assert.equal(token(light, "--itr-header-text"), "#222c30");
    for (const field of ["--itr-header-border", "--itr-header-muted", "--itr-header-accent"]) {
        token(dark, field); token(light, field);
    }
});
