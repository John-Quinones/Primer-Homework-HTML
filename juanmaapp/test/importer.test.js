import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

globalThis.window = {};
createRequire(import.meta.url)("../public/importer.js");
const { guessTarget, guessAll, splitHeader, buildRecord, parsePesos, parseDate, titleCase } = window.JuanmaImport;

test("guesses columns from typical Access export headers", () => {
  const cases = {
    IdCliente: "", "Código": "", Nombres: "client.first_names", Apellidos: "client.last_names",
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

test("reads the firm's server export: area, type, city, status codes, folder, court, fees and payments", () => {
  const headers = ["No.", "AREA", "FECHA DE CREACIÓN", "TIPO DE PROCESO", "CLIENTE", "ACTUACIONES", "CIUDAD", "ESTADO", "RADICADO",
    "No. CARPETA", "DESPACHO JUDICIAL", "HONORARIOS", "PAGOS"];
  assert.deepEqual(guessAll(headers), ["", "case.category", "case.created_at", "case.type", "client.full_name", "case.actuaciones", "case.city",
    "case.status", "case.radicado", "case.folder", "case.court_name", "pay.fees", "pay.paid"]);
  // Without an AREA column, "Tipo de proceso" is still the process type, and "Ciudad" the client's city.
  assert.deepEqual(guessAll(["Tipo de proceso", "Ciudad", "Cliente"]), ["case.category", "client.city", "client.full_name"]);
  assert.equal(parsePesos("$ 3.500.000"), 3500000);
  assert.equal(parsePesos("1.500.000,50"), 1500000);
  assert.equal(parsePesos("2000000"), 2000000);
  assert.equal(parseDate("15/03/2023"), "2023-03-15");
  assert.equal(parseDate("2022-8-1"), "2022-08-01");
  assert.equal(titleCase("NULIDAD Y RESTABLECIMIENTO DEL DERECHO"), "Nulidad y Restablecimiento del Derecho");
  assert.equal(titleCase("Juzgado 2 de Ibagué"), "Juzgado 2 de Ibagué");
});
