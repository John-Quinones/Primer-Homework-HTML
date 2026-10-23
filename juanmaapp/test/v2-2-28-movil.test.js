// Version 2.2.28: the version number is visible on phones and Mony fits small screens (desktop untouched).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");

test("la barra superior trae la versión para el celular y app.js la llena", () => {
  assert.match(read("index.html"), /class="tagline top-version" data-version-top hidden/);
  assert.match(read("app.js"), /\[data-version-top\]/);
});

test("el estilo móvil solo vale en pantallas pequeñas", () => {
  const css = read("styles.css");
  const i = css.indexOf("Versión móvil (2.2.28)");
  assert.ok(i > 0);
  const block = css.slice(i);
  assert.match(block, /^[^@]*\.top-version \{ display: none; \}/); // escritorio: oculta
  assert.match(block, /@media \(max-width: 760px\) \{[\s\S]*\.top-version:not\(\[hidden\]\)/);
  assert.match(block, /@media \(max-width: 560px\)[\s\S]*\.mony-voice-box/);
});
