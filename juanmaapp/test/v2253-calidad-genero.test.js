// Version 2.2.53: role words follow the gender and number («la demandante», «el demandado», «los demandantes»).
import { test } from "node:test";
import assert from "node:assert/strict";
import { roleWords, partyContext, partyWords } from "../src/case-meta.js";

test("role words: gender and number", () => {
  assert.equal(roleWords("Demandante", false, false).con, "el demandante");
  assert.equal(roleWords("Demandante", true, false).con, "la demandante");
  assert.equal(roleWords("Demandado", true, false).con, "la demandada");
  assert.equal(roleWords("Demandado", false, true).con, "los demandados");
  assert.equal(roleWords("Demandado", true, true).con, "las demandadas");
  assert.equal(roleWords("Peticionario", true, false).sola, "peticionaria");
  assert.equal(roleWords("Víctima", false, false).con, "la víctima");
  assert.equal(roleWords("Demandado", true, false).titulo, "Demandada");
});

const client = (id, gender, person_type = "natural") => ({ id, gender, person_type });
const lookup = (all) => (id) => all.find((c) => c.id === id);

test("client suing: «la demandante» and the counterparty «el demandado»; several defendants → plural", () => {
  const k = { client_role: "Demandante", parties: [{ side: "pasiva", name: "A" }, { side: "pasiva", name: "B" }] };
  const ctx = partyContext(k, "Laboral", "Ordinario", client(1, "mujer"));
  const w = partyWords(ctx, "mujer");
  assert.equal(w["cliente.calidad"], "la demandante");
  assert.equal(w["parte.activa"], "la demandante");
  assert.equal(w["contraparte.calidad"], "los demandados");
  assert.equal(w["parte.pasiva_titulo"], "Demandados");
  assert.equal(partyWords(ctx, "hombre")["cliente.calidad"], "el demandante");
  assert.deepEqual(partyWords(ctx, ""), {});
});
test("client defendant, woman: «la demandada»; ejecutivo uses ejecutante / ejecutado", () => {
  const w = partyWords(partyContext({ client_role: "Demandado", parties: [] }, "Civil", "Ordinario", client(1, "mujer")), "mujer");
  assert.equal(w["cliente.calidad"], "la demandada");
  assert.equal(w["parte.activa"], "el demandante");
  const e = partyWords(partyContext({ client_role: "Ejecutante", parties: [] }, "Civil", "Ejecutivo singular", client(1, "hombre")), "hombre");
  assert.equal(e["cliente.calidad"], "el ejecutante");
  assert.equal(e["contraparte.calidad"], "el ejecutado");
});
test("several clients on our side: «los demandantes», or «las» when all are women", () => {
  const all = [client(2, "mujer"), client(3, "hombre")];
  const k = (ids) => ({ client_role: "Demandante", parties: ids.map((id) => ({ side: "activa", ours: true, client_id: id, name: "x" })) });
  assert.equal(partyWords(partyContext(k([2, 3]), "Laboral", "", client(1, "mujer"), lookup(all)), "mujer")["cliente.calidad"], "los demandantes");
  assert.equal(partyWords(partyContext(k([2]), "Laboral", "", client(1, "mujer"), lookup(all)), "mujer")["cliente.calidad"], "las demandantes");
});
test("a company is written in the feminine («la demandante»)", () => {
  const w = partyWords(partyContext({ client_role: "Demandante", parties: [] }, "Civil", "", client(1, "", "juridica")), "");
  assert.equal(w["cliente.calidad"], "la demandante");
});

// The documents' data: same words on the server and on the link.
import { before, after } from "node:test";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";

let srv, sides;
before(async () => {
  srv = await startServer();
  const admin = await srv.setup();
  const link = await startLink();
  await link.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co" });
  sides = { server: admin.call, link: link.call };
});
after(() => srv.close());

test("templates data: the client woman defendant against two people; same on server and link", async () => {
  const out = {};
  for (const [name, call] of Object.entries(sides)) {
    const lab = (await call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
    const cl = (await call("POST", "/clients", { full_name: "Gladys Vera Morales", id_type: "CC", id_number: "65760174", gender: "mujer" })).body;
    const k = (await call("POST", "/cases", { client_id: cl.id, process_type_id: lab.types[0].id, client_role: "Demandado",
      parties: [{ side: "activa", name: "Pedro Pérez" }, { side: "activa", name: "Ana Gómez" }] })).body;
    const d = (await call("GET", `/templates/data?caseId=${k.id}`)).body;
    out[name] = [d["cliente.calidad"], d["contraparte.calidad"], d["parte.pasiva_titulo"], d["parte.activa_sola"]];
  }
  assert.deepEqual(out.server, ["la demandada", "los demandantes", "Demandada", "demandantes"]);
  assert.deepEqual(out.link, out.server);
});
