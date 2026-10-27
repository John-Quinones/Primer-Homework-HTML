// Version 2.2.87: party categories. Starter list once, CRUD only for Gerencia, same behaviour on server and link, a role in use cannot
// be renamed or moved, column titles follow the client's category, and cases already loaded keep their marks.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";
import { sideLabels, sideOfRole, normPartyRole, defaultRole, setPartyCategories, partyWords, partyContext } from "../src/case-meta.js";

let srv, admin, sides;
before(async () => {
  srv = await startServer();
  admin = await srv.setup();
  const link = await startLink();
  await link.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co" });
  sides = { server: admin.call, link: link.call };
});
after(() => srv.close());

async function same(scenario) {
  const out = {};
  for (const [name, call] of Object.entries(sides)) out[name] = await scenario(call);
  assert.deepEqual(out.link, out.server);
  return out.server;
}
const strip = (list) => list.map(({ id, pair_id, created_at, updated_at, created_by, ...x }) => x);

test("starter list, CRUD, pairs and the rule for roles in use behave the same on server and link", async () => {
  const out = await same(async (call) => {
    const all = (await call("GET", "/party-categories?all=1")).body;
    const byTitle = Object.fromEntries(all.map((x) => [x.title, x]));
    const pairOf = (t) => all.find((x) => x.id === byTitle[t].pair_id)?.title ?? null;
    const novel = (await call("POST", "/party-categories", { title: " Tutelante ", plural: "Tutelantes", side: "activa" })).body;
    const dup = await call("POST", "/party-categories", { title: "tutelante", side: "activa" });
    const noSide = await call("POST", "/party-categories", { title: "Otro" });
    const badPair = await call("POST", "/party-categories", { title: "Otro", side: "activa", pair_id: byTitle.Demandante.id });
    const cl = (await call("POST", "/clients", { full_name: "Ana Pérez", id_type: "CC", id_number: "123" })).body;
    const cat = (await call("GET", "/catalog")).body[0];
    const mk = await call("POST", "/cases", { client_id: cl.id, category_id: cat.id, process_type_id: cat.types[0].id, title: "X", client_role: "Tutelante", affiliated: true, parties: [{ role: "Accionado", name: "Sura", side: "pasiva" }] });
    const used = (await call("GET", "/party-categories?all=1")).body.find((x) => x.title === "Tutelante");
    const rename = await call("PUT", `/party-categories/${novel.id}`, { title: "Tutelante 2" });
    const plural = await call("PUT", `/party-categories/${novel.id}`, { plural: "Los tutelantes" });
    const delUsed = (await call("DELETE", `/party-categories/${novel.id}`)).body;
    const badRole = await call("POST", "/cases", { client_id: cl.id, category_id: cat.id, process_type_id: cat.types[0].id, title: "Y", client_role: "Inventado" });
    const cond = (await call("DELETE", `/party-categories/${byTitle["Cliente afiliado"].id}`)).body;
    const condUses = byTitle["Cliente afiliado"].uses;
    const accionado = (await call("GET", "/party-categories?all=1")).body.find((x) => x.title === "Accionado").uses;
    return { first: strip(all).slice(0, 4), count: all.length, pair: [pairOf("Ejecutante"), pairOf("Convocado"), pairOf("Peticionario"), pairOf("Accionante")],
      legacyOff: all.filter((x) => !x.is_active).map((x) => x.title), conds: all.filter((x) => x.kind === "condicion").map((x) => x.flag),
      novelSide: novel.side, dup: dup.status, noSide: noSide.status, badPair: badPair.status, mk: mk.status, used: used.uses, rename: rename.status,
      plural: plural.body.plural, delUsed: { ...delUsed, id: 0 }, badRole: badRole.status, cond: { ...cond, id: 0 }, condUses, accionado };
  });
  assert.equal(out.count, 21);
  assert.deepEqual(out.pair, ["Ejecutado", "Convocante", null, "Accionado"]);
  assert.deepEqual(out.legacyOff, ["Querellante", "Querellado", "Defendido"]);
  assert.deepEqual(out.conds, ["affiliated", "ad_litem"]);
  assert.equal(out.dup, 400); assert.equal(out.noSide, 400); assert.equal(out.badPair, 400);
  assert.equal(out.mk, 201); assert.equal(out.used, 1);
  assert.equal(out.rename, 400); assert.equal(out.plural, "Los tutelantes");
  assert.deepEqual(out.delUsed, { id: 0, deleted: false, deactivated: true });
  assert.equal(out.badRole, 400);
  assert.equal(out.cond.deactivated, true);
});

test("column titles follow the client's category and old cases keep Demandantes / Demandados", () => {
  setPartyCategories([]);
  assert.deepEqual(sideLabels("Laboral", "Ordinario", "Demandante"), { activa: "Demandantes", pasiva: "Demandados" });
  assert.deepEqual(sideLabels("Laboral", "Ordinario"), { activa: "Demandantes", pasiva: "Demandados" });
  assert.deepEqual(sideLabels("Laboral", "Ordinario", "Ejecutante"), { activa: "Ejecutantes", pasiva: "Ejecutados" });
  assert.deepEqual(sideLabels("Laboral", "Ordinario", "Ejecutado"), { activa: "Ejecutantes", pasiva: "Ejecutados" });
  assert.deepEqual(sideLabels("Civil", "Conciliación", "Convocante"), { activa: "Convocantes", pasiva: "Convocados" });
  setPartyCategories([
    { id: 1, title: "Accionante", plural: "Accionantes", side: "activa", pair_id: 2, kind: "rol", is_active: 1 },
    { id: 2, title: "Accionado", plural: "Accionados", side: "pasiva", pair_id: 1, kind: "rol", is_active: 1 },
    { id: 3, title: "Quejoso", plural: "Quejosos", side: "activa", pair_id: null, kind: "rol", is_active: 1 }]);
  assert.deepEqual(sideLabels("Laboral", "Ordinario", "Accionado"), { activa: "Accionantes", pasiva: "Accionados" });
  assert.equal(sideLabels("Laboral", "Ordinario", "Quejoso").activa, "Quejosos");
  assert.equal(sideOfRole("Quejoso"), "activa");
  assert.equal(normPartyRole("quejoso"), "Quejoso");
  assert.equal(defaultRole("pasiva", "Laboral", "Ordinario", "Accionante"), "Accionado");
  assert.equal(defaultRole("activa", "Laboral", "Ordinario", "Accionante"), "Accionante");
  // Template words use the chosen category: «la accionante», «los accionados».
  const k = { client_role: "Accionante", parties: [] };
  const w = partyWords(partyContext(k, "Laboral", "Ordinario", { id: 1 }), "mujer");
  assert.equal(w["cliente.calidad"], "la accionante"); assert.equal(w["contraparte.calidad"], "el accionado");
  setPartyCategories([]);
});
