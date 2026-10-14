import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

globalThis.window = {};
createRequire(import.meta.url)("../public/importer.js");
const { guessTarget, splitHeader, buildRecord } = window.JuanmaImport;

test("guesses columns from typical Access export headers", () => {
  const cases = {
    IdCliente: "", "Código": "", Nombres: "client.full_name", Apellidos: "client.full_name",
    "Nombre del cliente": "client.full_name", "No. Documento": "client.id_number", "Cédula": "client.id_number",
    "Correo Electrónico": "client.email", Celular: "client.phone", "Tipo de Proceso": "case.category",
    Proceso: "case.type", "Clase de proceso": "case.type", "Estado del proceso": "case.status",
    Demandado: "case.counterparty", Radicado: "case.radicado", "Nombre Abogado": "case.custom",
    "Calidad del cliente": "case.client_role", Afiliado: "case.affiliated",
  };
  for (const [h, want] of Object.entries(cases)) assert.equal(guessTarget(h), want, h);
});

test("finds the header row, formats dates and drops empty rows", () => {
  const { headers, body } = splitHeader([
    ["Reporte de clientes", null],
    ["Nombres", "Fecha", "Activo"],
    ["Ana", new Date(Date.UTC(2026, 2, 5)), true],
    [null, null, null],
  ]);
  assert.deepEqual(headers, ["Nombres", "Fecha", "Activo"]);
  assert.deepEqual(body, [["Ana", "05/03/2026", "Sí"]]);
});

test("joins several columns into one field and keeps custom columns", () => {
  const headers = ["Nombres", "Apellidos", "Teléfono", "Celular", "Radicado", "Id"];
  const mapping = ["client.full_name", "client.full_name", "client.phone", "client.phone", "case.custom", ""];
  const rec = buildRecord(["María José", "Torres", "601", "311", "110013105", "7"], headers, mapping);
  assert.equal(rec.client.full_name, "María José Torres");
  assert.equal(rec.client.phone, "601 / 311");
  assert.deepEqual(rec.custom, { Radicado: "110013105" });
});
