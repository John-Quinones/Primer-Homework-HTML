import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("crear cliente con un documento ya registrado avisa y deja decidir", () => {
  assert.match(app, /Ya existe un cliente con ese \$\{data\.person_type === "juridica" \? "NIT" : "documento"\}/);
  assert.match(app, /x\.id !== Number\(id\) && dupKey\(x\.id_number\) === num/); // el propio registro se excluye al editar
});

test("crear expediente con un radicado ya registrado avisa y deja decidir", () => {
  assert.match(app, /Ya existe un expediente con ese radicado/);
  assert.match(app, /x\.id !== Number\(d\.id\)/);
});

test("el aviso ofrece «Crear de todos modos» y «Ver el existente»", () => {
  assert.match(app, /okLabel: "Crear de todos modos", cancelLabel: "Ver el existente"/);
});
