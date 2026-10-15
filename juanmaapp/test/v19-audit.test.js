import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
let srv, admin, laura, caseId, base;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const office = (await admin.call("GET", "/admin/offices")).body[0].id;
  await admin.call("POST", "/admin/users", { name: "Laura Gómez", email: "laura@firma.co", role: "Abogado", office_ids: [office], password: "laura-clave-2026" });
  laura = await srv.login("laura@firma.co", "laura-clave-2026");
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Marco", last_names: "Pineda", id_number: "9" })).body;
  const type = (await admin.call("GET", "/catalog")).body.flatMap((x) => x.types)[0].id;
  caseId = (await admin.call("POST", "/cases", { client_id: c.id, process_type_id: type, title: "Ordinario" })).body.id;
  base = srv.base;
});
after(() => srv.close());

test("each change records who, what changed, when and from which device", async () => {
  // Laura edits the case from an iPhone.
  const res = await fetch(`${base}/cases/${caseId}`, { method: "PUT", body: JSON.stringify({ status: "Archivo provisional", title: "Ordinario laboral" }),
    headers: { "Content-Type": "application/json", "X-JuanMa": "1", Cookie: laura.cookie, "User-Agent": IPHONE } });
  assert.equal(res.status, 200);
  const log = (await admin.call("GET", "/audit")).body;
  const e = log.find((x) => x.action === "Modificó" && x.case_id === caseId);
  assert.ok(e, "logged");
  assert.equal(e.user_name, "Laura Gómez");
  assert.equal(e.device, "Móvil");
  assert.equal(e.device_detail, "iOS · Safari");
  assert.deepEqual(e.changes.map((x) => [x.label, x.before, x.after]), [["Asunto o título", "Ordinario", "Ordinario laboral"], ["Estado", "Activo", "Archivo provisional"]]);
  assert.match(e.summary, /Modificó expediente «Ordinario laboral»/);
});

test("sign-ins, failed sign-ins and refused deletes are logged; only audit.view sees the whole log", async () => {
  await srv.login("laura@firma.co", "mala-clave-1234");
  assert.equal((await laura.call("DELETE", `/cases/${caseId}`)).status, 403);
  const log = (await admin.call("GET", "/audit")).body;
  assert.ok(log.some((x) => x.action === "Ingresó" && x.user_name === "Laura Gómez"));
  assert.ok(log.some((x) => x.action === "Ingreso fallido" && /Contraseña incorrecta/.test(x.summary) && !x.ok));
  assert.ok(log.some((x) => x.action === "Intentó (sin permiso)" && x.user_name === "Laura Gómez"));
  assert.equal((await laura.call("GET", "/audit")).status, 403, "Abogado cannot see the log");
  const own = (await laura.call("GET", `/audit?caseId=${caseId}`)).body;
  assert.ok(own.length >= 2, "but sees the history of a case she can open");
  const filtered = (await admin.call("GET", "/audit?device=Móvil")).body;
  assert.ok(filtered.every((x) => x.device === "Móvil") && filtered.length >= 1);
});
