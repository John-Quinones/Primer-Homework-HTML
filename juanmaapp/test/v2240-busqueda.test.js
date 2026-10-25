import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientMatches } from "../src/person.js";

const c = { full_name: "Juan Carlos Gutierrez Urrea", first_names: "Juan Carlos", last_names: "Gutierrez Urrea", id_number: "1110479397", archive_status: "Archivo provisional" };

test("el buscador de clientes encuentra por nombre, apellido, orden distinto, tildes y documento", () => {
  for (const [q, by] of [["juan carlos", ""], ["gutiérrez", ""], ["URREA juan", ""], ["1.110.479.397", "doc"], ["urrea", "last"]]) assert.ok(clientMatches(c, q, by), q);
});

test("la pantalla busca en todos los estados cuando hay texto", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /searching \? state\.clients : state\.clients\.filter/);
  assert.match(app, /\(!!q \|\| !ARCHIVED_STATUSES\.has\(k\.status\)\)/);
});
