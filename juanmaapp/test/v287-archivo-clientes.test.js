// Version 2.87: a client can be sent to «Archivo provisional» / «Archivo definitivo» and back to activo,
// the same on the server and the published link. Nothing else changes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";

let srv, sides;
before(async () => {
  srv = await startServer();
  const link = await startLink();
  const server = await srv.setup();
  await link.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co" });
  sides = { server: server.call, link: link.call };
});
after(() => srv.close());

async function same(scenario) {
  const out = {};
  for (const [name, call] of Object.entries(sides)) out[name] = await scenario(call);
  assert.deepEqual(out.link, out.server);
  return out.server;
}

test("archive state: activo by default, provisional, definitivo, back to activo; edits keep it", async () => {
  const out = await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Ana Archivo", id_number: "8001" })).body;
    const states = [c.archive_status];
    for (const status of ["Archivo provisional", "Archivo definitivo", ""]) states.push((await call("PUT", `/clients/${c.id}/archive`, { status })).body.archive_status);
    await call("PUT", `/clients/${c.id}/archive`, { status: "Archivo provisional" });
    states.push((await call("PUT", `/clients/${c.id}`, { phone: "3001112233" })).body.archive_status);
    const list = (await call("GET", "/clients")).body.find((x) => x.id === c.id);
    states.push(list.archive_status, (await call("PUT", `/clients/${c.id}/archive`, { status: "Cerrado" })).status);
    return states;
  });
  assert.deepEqual(out, ["", "Archivo provisional", "Archivo definitivo", "", "Archivo provisional", "Archivo provisional", 400]);
});

test("archiving a client leaves its cases untouched", async () => {
  const out = await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Beto Casos", id_number: "8002" })).body;
    const type = (await call("GET", "/catalog")).body.find((g) => g.types.length).types[0].id;
    const k = (await call("POST", "/cases", { client_id: c.id, process_type_id: type })).body;
    await call("PUT", `/clients/${c.id}/archive`, { status: "Archivo definitivo" });
    const after = (await call("GET", `/cases/${k.id}`)).body;
    return [k.status, after.status, (await call("GET", `/cases?clientId=${c.id}`)).body.length];
  });
  assert.deepEqual(out, ["Activo", "Activo", 1]);
});

test("only Gerencia handles «Archivo definitivo» (server)", async () => {
  const g = await srv.login("gerencia@firma.co", "clave-segura-1");
  const office = (await g.call("GET", "/admin/offices")).body[0].id;
  await g.call("POST", "/admin/users", { name: "Pedro Ruiz", email: "pedro@firma.co", role: "Abogado", office_ids: [office], password: "Temporal-2026-x" });
  const p = await srv.login("pedro@firma.co", "Temporal-2026-x");
  const c = (await g.call("POST", "/clients", { full_name: "Dora Definitiva", id_number: "8003", office_id: office })).body;
  assert.equal((await p.call("PUT", `/clients/${c.id}/archive`, { status: "Archivo provisional" })).body.archive_status, "Archivo provisional");
  assert.equal((await p.call("PUT", `/clients/${c.id}/archive`, { status: "Archivo definitivo" })).status, 403);
  assert.equal((await g.call("PUT", `/clients/${c.id}/archive`, { status: "Archivo definitivo" })).body.archive_status, "Archivo definitivo");
  assert.equal((await p.call("PUT", `/clients/${c.id}/archive`, { status: "" })).status, 403, "cannot take it out of definitivo either");
  assert.equal((await g.call("PUT", `/clients/${c.id}/archive`, { status: "" })).body.archive_status, "");
});

test("search by the place where the ID card was issued", async () => {
  const { clientMatches } = await import("../src/person.js");
  const c = { full_name: "Eva Expedida", id_city: "Ibagué", id_department: "Tolima", city: "Bogotá", department: "Bogotá" };
  assert.equal(clientMatches(c, "ibague", "idplace"), true);
  assert.equal(clientMatches(c, "tolima", "idplace"), true);
  assert.equal(clientMatches(c, "bogota", "idplace"), false);
  assert.equal(clientMatches(c, "bogota", "city"), true);
});

async function importerApi() {
  const { createRequire } = await import("node:module");
  if (!globalThis.window?.JuanmaImport) { globalThis.window = globalThis.window || {}; createRequire(import.meta.url)("../public/importer.js"); }
  return window.JuanmaImport;
}

test("import: the «Estado del cliente» column archives new clients, and existing ones only when updating", async () => {
  const IMP = await importerApi();
  const headers = ["Nombre completo", "Número de documento", "Estado del cliente"];
  const mapping = IMP.guessAll(headers);
  assert.deepEqual(mapping, ["client.full_name", "client.id_number", "client.archive_status"]);
  const rec = (name, doc, st) => ({ ...IMP.buildRecord([name, doc, st], headers, mapping), rowNumber: 2 });
  const run = async (updateMode) => {
    const calls = [], stored = [{ id: 1, full_name: "Vieja Cliente", id_number: "111", archive_status: "" }];
    const api = async (method, path, body) => {
      calls.push(`${method} ${path} ${JSON.stringify(body)}`);
      if (path === "/clients" && method === "GET") return stored;
      if (path === "/clients" && method === "POST") return { id: 2, ...body, archive_status: "" };
      if (path.endsWith("/archive")) return { id: +path.split("/")[2], archive_status: body.status, full_name: "x", id_number: "" };
      return [];
    };
    const sum = await IMP.run([rec("Nueva Cliente", "222", "Archivo provisional"), rec("Vieja Cliente", "111", "Archivo definitivo"), rec("Otra Cliente", "333", "")], api, { withCases: false, updateMode });
    return { sum, archives: calls.filter((c) => c.includes("/archive")) };
  };
  const fill = await run("fill");
  // version 2.105: an existing client still «Activo» takes the file's state even when only blanks are filled
  assert.deepEqual(fill.archives, ['PUT /clients/2/archive {"status":"Archivo provisional"}', 'PUT /clients/1/archive {"status":"Archivo definitivo"}']);
  const upd = await run("update");
  assert.equal(upd.archives.length, 2);
  assert.ok(upd.archives.some((c) => c.includes("/clients/1/archive") && c.includes("Archivo definitivo")));
});

test("version 2.96: «Pendiente Pago Sentencia» is a fourth status for cases and clients", async () => {
  const { statusFrom, normStatus, STATUSES } = await import("../src/case-meta.js");
  assert.ok(STATUSES.includes("Pendiente Pago Sentencia"));
  for (const t of ["Pendiente Pago Sentencia", "pendiente de pago de sentencia", "PENDIENTE PAGO SENTENCIA", "Pago de sentencia", "PPS"]) assert.equal(statusFrom(t), "Pendiente Pago Sentencia", t);
  assert.equal(normStatus("2"), "Archivo definitivo");
  assert.equal(normStatus("Archivo provisional"), "Archivo provisional");
  assert.equal(statusFrom("algo raro"), null);
  assert.equal(normStatus("algo raro"), "Activo");
  const out = await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Pedro Pendiente", id_number: "8004" })).body;
    const type = (await call("GET", "/catalog")).body.find((g) => g.types.length).types[0].id;
    const k = (await call("POST", "/cases", { client_id: c.id, process_type_id: type, status: "pendiente pago sentencia" })).body;
    const edited = (await call("PUT", `/cases/${k.id}`, { status: "Pendiente Pago Sentencia" })).body.status;
    const client = (await call("PUT", `/clients/${c.id}/archive`, { status: "Pendiente Pago Sentencia" })).body.archive_status;
    return [k.status, edited, client];
  });
  assert.deepEqual(out, ["Pendiente Pago Sentencia", "Pendiente Pago Sentencia", "Pendiente Pago Sentencia"]);
  const { archiveState } = await importerApi();
  assert.equal(archiveState("Pendiente Pago Sentencia"), "Pendiente Pago Sentencia");
  assert.equal(archiveState("pendiente pago de sentencia"), "Pendiente Pago Sentencia");
  assert.equal(archiveState("Activo"), "");
  assert.equal(archiveState("quién sabe"), undefined);
});

test("version 2.97: a case waiting for its sentence payment stays among the monitored statuses", async () => {
  const { LIVE_STATUSES } = await import("../src/case-meta.js");
  assert.ok(LIVE_STATUSES.includes("Pendiente Pago Sentencia"));
});

test("version 2.104: re-uploading the Excel updates «Pago de Sentencia» on existing cases and clients, only the state", async () => {
  const IMP = await importerApi();
  window.JuanmaCaseMeta = await import("../src/case-meta.js");
  const headers = ["Nombre completo", "Número de documento", "Estado", "Radicado"];
  const mapping = IMP.guessAll(headers);
  const rad = "73001333100120170000200";
  const rec = ["Vieja Cliente", "111", "Pago de Sentencia", rad];
  const records = [{ ...IMP.buildRecord(rec, headers, mapping), rowNumber: 2 }];
  const make = () => {
    const calls = [];
    const api = async (method, path, body) => {
      calls.push(`${method} ${path} ${JSON.stringify(body ?? "")}`);
      if (path === "/clients" && method === "GET") return [{ id: 1, full_name: "Vieja Cliente", id_number: "111", archive_status: "" }];
      if (path === "/cases" && method === "GET") return [{ id: 7, client_id: 1, process_type_id: 3, title: "", radicado: rad, status: "Activo", field_values: {} }];
      if (path === "/catalog") return [{ id: 1, name: "Laboral", fields: [], types: [{ id: 3, name: "Ordinario" }] }];
      if (path.endsWith("/archive")) return { id: 1, archive_status: body.status, full_name: "Vieja Cliente", id_number: "111" };
      if (path === "/cases/7") return { id: 7, client_id: 1, process_type_id: 3, title: "", radicado: rad, status: body.status, field_values: {} };
      return [];
    };
    return { calls, api };
  };
  const p = make();
  const plan = await IMP.plan(records, p.api, { withCases: true, updateMode: "update" });
  assert.deepEqual(plan.changes.map((c) => [c.field, c.before, c.after]), [["archive_status", "Activo", "Pendiente Pago Sentencia"], ["case_status", "Activo", "Pendiente Pago Sentencia"]]);
  assert.equal(p.calls.some((c) => c.startsWith("PUT")), false);
  const fill = make();
  await IMP.run(records, fill.api, { withCases: true, defaultCategory: "Laboral", defaultType: "Ordinario", updateMode: "fill" });
  // «Activo» counts as empty: filling blanks may still set the state, and the preview says so
  assert.equal(fill.calls.filter((c) => c.startsWith("PUT")).length, 2);
  assert.ok(IMP.TARGETS.find((t) => t.key === "client.archive_status").label.includes("pendiente pago sentencia"));
  const upd = make();
  const sum = await IMP.run(records, upd.api, { withCases: true, defaultCategory: "Laboral", defaultType: "Ordinario", updateMode: "update" });
  assert.deepEqual(upd.calls.filter((c) => c.startsWith("PUT")), ['PUT /clients/1/archive {"status":"Pendiente Pago Sentencia"}', 'PUT /cases/7 {"status":"Pendiente Pago Sentencia"}']);
  assert.equal(sum.casesUpdated, 1);
});
