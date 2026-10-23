import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

globalThis.window = {};
createRequire(import.meta.url)("../public/importer.js");
const { guessAll, buildRecord, plan } = window.JuanmaImport;

// Headers of the downloadable Excel files (Importar → Plantilla / Descargar datos actuales).
const CLIENT_HEADERS = ["Nombre completo", "Tipo de documento", "Número de documento", "Correo", "Teléfono", "Dirección", "Ciudad", "Departamento de expedición", "Ciudad de expedición", "Notas"];
const CASE_HEADERS = ["Nombre del cliente", "Número de documento", "Tipo de proceso", "Subproceso", "Asunto", "Estado", "Fecha de creación",
  "Radicado", "No. carpeta", "Despacho judicial", "Ciudad del proceso", "Calidad del cliente"];

test("the downloadable headers map to the importer's own fields", () => {
  assert.deepEqual(guessAll(CLIENT_HEADERS), ["client.full_name", "client.id_type", "client.id_number", "client.email", "client.phone", "client.address", "client.city", "client.id_department", "client.id_city", "client.notes"]);
  assert.deepEqual(guessAll(CASE_HEADERS), ["client.full_name", "client.id_number", "case.category", "case.type", "case.title", "case.status", "case.created_at",
    "case.radicado", "case.folder", "case.court_name", "case.city", "case.client_role"]);
});

test("plan counts new and existing clients and cases without writing", async () => {
  const calls = [];
  const api = async (method, path) => {
    calls.push(method + " " + path);
    if (path === "/clients") return [{ id: 1, full_name: "Ana Pérez", id_number: "123" }];
    if (path === "/cases") return [{ id: 9, client_id: 1, radicado: "73001333100620170000200", title: "" }];
    return [];
  };
  const headers = CASE_HEADERS, mapping = guessAll(headers);
  const row = (name, doc, rad) => ({ ...buildRecord([name, doc, "Judicial", "Ordinario", "Asunto", "Activo", "", rad, "", "", "", ""], headers, mapping), rowNumber: 2 });
  const out = await plan([row("Ana Pérez", "123", "73001333100620170000200"), row("Luis Gómez", "456", ""), row("Luis Gómez", "456", "")], api, { withCases: true });
  assert.deepEqual(out, { rows: 3, clientsNew: 1, clientsExisting: 1, casesNew: 1, casesExisting: 2 });
  assert.ok(calls.every((c) => c.startsWith("GET ")));
});
