import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("la ficha del expediente tiene solo el icono de copiar junto al radicado", () => {
  assert.match(app, /class="copy-ico" data-action="copy-radicado" data-radicado="\$\{escapeHtml\(k\.radicado\)\}"/);
  assert.doesNotMatch(app, /Copiar sin guiones<\/button>/);
});

test("copiar deja solo los dígitos del radicado", () => {
  assert.match(app, /"copy-radicado": async \(\) => \{\s*const digits = String\(btn\.dataset\.radicado \|\| ""\)\.replace\(\/\\D\/g, ""\)/);
  assert.equal("73-001-40-03-007-2026-00642-00".replace(/\D/g, ""), "73001400300720260064200");
  assert.equal("73001400300720260064200".length, 23);
});
