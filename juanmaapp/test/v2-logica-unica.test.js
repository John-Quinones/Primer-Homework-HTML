// One logic for the server and the published link (code audit, phase 2):
// the same requests sent to both backends must give the same answers.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";

const RAD_IBAGUE = "73001310500120230001200"; // first five digits: Ibagué (Tolima)
const RAD_OTHER = "73001310500120230009900";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let srv, sides;
before(async () => {
  srv = await startServer();
  const link = await startLink();
  const server = await srv.setup();
  await link.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co" });
  sides = { server: server.call, link: link.call };
});
after(() => srv.close());

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const okOrError = (r) => (r.status >= 400 ? { error: r.body.error } : { ok: true });

/** Runs `scenario(call)` on both backends and checks that both give the same result. */
async function same(scenario) {
  const out = {};
  for (const [name, call] of Object.entries(sides)) out[name] = await scenario(call);
  assert.deepEqual(out.link, out.server);
  return out.server;
}

const CLIENT_KEYS = ["full_name", "first_names", "last_names", "id_type", "person_type", "gender", "id_number", "department", "city", "address", "phone", "email", "notes"];
const CASE_KEYS = ["department", "city", "area", "radicado", "monitor", "court_name", "judge_name", "status", "client_role"];
const firstType = async (call) => (await call("GET", "/catalog")).body.find((c) => c.types.length).types[0].id;

test("clients: names, document, department and city are cleaned the same way", async () => {
  const out = await same(async (call) => {
    const r = await call("POST", "/clients", { gender: "F", full_name: "ana maría pérez gómez", id_number: " 1 234 567 ", department: "tolima", city: "ibague", phone: "3001234567", address: "cra 5 # 10-20" });
    return { status: r.status, ...pick(r.body, CLIENT_KEYS) };
  });
  assert.equal(out.department, "Tolima");
  assert.equal(out.city, "Ibagué");
  assert.equal(out.id_number, "1234567");
});

test("clients: refusals and partial changes match", async () => {
  await same(async (call) => okOrError(await call("POST", "/clients", { full_name: "Pedro Ruiz", id_number: "222", department: "Narnia" })));
  // San Andrés was refused by the link before (phase 2): now both accept it.
  await same(async (call) => pick((await call("POST", "/clients", { full_name: "Isleña Prueba", id_number: "333", department: "san andres" })).body, ["department"]));
  await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Luis Díaz", id_number: "444", department: "Tolima", city: "Ibagué", notes: "nota" })).body;
    const r = await call("PUT", `/clients/${c.id}`, { phone: "310 555 1234" });
    return pick(r.body, CLIENT_KEYS);
  });
});

test("clients: photo rules match", async () => {
  await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Foto Prueba", id_number: "555" })).body;
    const bad = okOrError(await call("PUT", `/clients/${c.id}/photo`, { photo: "data:image/gif;base64,AAAA" }));
    const big = okOrError(await call("PUT", `/clients/${c.id}/photo`, { photo: "data:image/png;base64," + "A".repeat(1_500_001) }));
    const good = (await call("PUT", `/clients/${c.id}/photo`, { photo: PNG })).body.has_photo;
    const gone = (await call("PUT", `/clients/${c.id}/photo`, { photo: "" })).body.has_photo;
    return { bad, big, good, gone };
  });
});

test("cases: place from the radicado, area, court and monitor match", async () => {
  const out = await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Caso Uno", id_number: "601" })).body;
    const type = await firstType(call);
    const k = await call("POST", "/cases", { client_id: c.id, process_type_id: type, radicado: RAD_IBAGUE, judge_name: "  Juez   Pérez ", created_at: "2019-03-04" });
    return { status: k.status, ...pick(k.body, CASE_KEYS), created_at: k.body.created_at };
  });
  assert.deepEqual([out.department, out.city, out.monitor], ["Tolima", "Ibagué", 0]);
  assert.equal(out.judge_name, "Juez Pérez");
  assert.equal(out.created_at, "2019-03-04 00:00:00");
});

test("cases: refusals match (radicado length, area, court)", async () => {
  await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Caso Dos", id_number: "602" })).body;
    const type = await firstType(call);
    const base = { client_id: c.id, process_type_id: type };
    return [
      okOrError(await call("POST", "/cases", { ...base, radicado: "123" })),
      okOrError(await call("POST", "/cases", { ...base, area: "Marciana" })),
      okOrError(await call("POST", "/cases", { ...base, court_id: 987654321 })),
      okOrError(await call("POST", "/cases", { ...base, court_id: "abc" })),
      okOrError(await call("POST", "/cases", { ...base, department: "Narnia" })),
    ];
  });
});

test("cases: «Cargar radicados» rules match", async () => {
  await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Caso Tres", id_number: "603" })).body;
    const type = await firstType(call);
    const a = (await call("POST", "/cases", { client_id: c.id, process_type_id: type, title: "Primero" })).body;
    const b = (await call("POST", "/cases", { client_id: c.id, process_type_id: type, title: "Segundo" })).body;
    const steps = [];
    const put = async (id, body) => { const r = await call("PUT", `/cases/${id}/radicado`, body); steps.push(r.status >= 400 ? { error: r.body.error } : pick(r.body, CASE_KEYS)); };
    await put(a.id, { radicado: "7300131050012023" });
    await put(a.id, { radicado: RAD_IBAGUE });
    await put(a.id, { radicado: RAD_IBAGUE }); // unchanged
    await put(a.id, { radicado: RAD_OTHER }); // needs replace
    await put(a.id, { radicado: RAD_OTHER, replace: true, monitor: true });
    await put(b.id, { radicado: RAD_OTHER }); // used by the first case
    await put(a.id, { radicado: "", replace: true });
    return steps;
  });
});

test("cases: our clients among the parties are linked by document on both sides", async () => {
  await same(async (call) => {
    const main = (await call("POST", "/clients", { full_name: "Parte Principal", id_number: "70001" })).body;
    const other = (await call("POST", "/clients", { full_name: "Parte Nuestra", id_number: "70002" })).body;
    const type = await firstType(call);
    const k = (await call("POST", "/cases", { client_id: main.id, process_type_id: type, parties: [
      { side: "activa", name: "Parte Nuestra", id_number: "70.002", ours: true },
      { side: "pasiva", name: "Contraparte S.A.S.", id_number: "900123", ours: false, client_id: other.id },
      { side: "activa", name: "Parte Principal", id_number: "70001", ours: true },
    ] })).body;
    return k.parties.map((p) => ({ name: p.name, ours: p.ours, linked: p.client_id === other.id, client_id_null: p.client_id == null }));
  });
});
