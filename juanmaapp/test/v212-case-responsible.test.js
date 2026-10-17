import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());

test("the case screen sets the responsible funcionario alone and gives them a task; the rest of the case stays", async () => {
  const lawyer = (await admin.call("POST", "/admin/users", { name: "Laura Gómez", email: "laura@firma.co", role: "Abogado", office_ids: [office], password: "tribunal-azul-2026" })).body;
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111222", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  const k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, title: "Pensión de vejez", facts: "Hechos guardados", radicado: "73001310500120240012300" })).body;
  assert.equal(k.assigned_user_id, null);

  const set = await admin.call("PUT", `/cases/${k.id}`, { assigned_user_id: lawyer.id });
  assert.equal(set.status, 200);
  assert.equal(set.body.assigned_user_id, lawyer.id);
  for (const f of ["title", "facts", "radicado", "process_type_id", "office_id", "status"]) assert.deepEqual(set.body[f], k[f], f);

  const t = await admin.call("POST", "/tasks", { case_id: k.id, kind: "tarea", title: "Radicar demanda", due_at: "2030-01-10 17:00", assigned_user_id: lawyer.id, remind_days: [1] });
  assert.equal(t.status, 201);
  assert.equal(t.body.assigned_user_id, lawyer.id);

  const cleared = await admin.call("PUT", `/cases/${k.id}`, { assigned_user_id: null });
  assert.equal(cleared.body.assigned_user_id, null);
  assert.equal(cleared.body.title, "Pensión de vejez");
  assert.equal((await admin.call("GET", `/tasks?caseId=${k.id}`)).body.length, 1, "the task stays when the responsible is removed");
});
