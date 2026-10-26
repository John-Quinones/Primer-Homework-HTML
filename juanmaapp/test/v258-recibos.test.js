// Receipts in Word/PDF (version 2.58): signer data in the user, the receipt saved in the case,
// and no receipt deleted except by Gerencia, with a copy of the database first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";

let srv, sides;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF").toString("base64");
const DOCX = Buffer.concat([Buffer.from("PK"), Buffer.alloc(20, 1)]).toString("base64");

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

async function receiptWithCase(call) {
  const cl = (await call("POST", "/clients", { full_name: "Armando Gómez Rocha", id_number: "79123456", id_type: "CC" })).body;
  const cat = (await call("GET", "/catalog")).body.find((c) => c.types.length);
  const k = (await call("POST", "/cases", { client_id: cl.id, process_type_id: cat.types[0].id, title: "Nulidad y restablecimiento" })).body;
  const r = (await call("POST", "/payments/receipts", { client_id: cl.id, case_id: k.id, amount: 2000000, method: "Transferencia", concept: "Honorarios" })).body;
  return { cl, k, r };
}

test("the user keeps the data they sign receipts with, and the receipt list carries it", async () => {
  const out = await same(async (call) => {
    const me = (await call("GET", "/auth/status")).body;
    const id = me.user?.id ?? me.id;
    await call("PUT", `/admin/users/${id}`, { legal_name: "JOHN FREDY QUIÑONES MONTAÑA", id_number: "17418999", professional_card: "150081" });
    const { r } = await receiptWithCase(call);
    const list = (await call("GET", `/payments/receipts?clientId=${r.client_id}`)).body;
    return { signer: [list[0].signer_name, list[0].signer_id, list[0].signer_card] };
  });
  assert.deepEqual(out.signer, ["JOHN FREDY QUIÑONES MONTAÑA", "17418999", "150081"]);
});

test("a receipt is saved in the case as Word and PDF, and only for a receipt of that case", async () => {
  await same(async (call) => {
    const { k, r } = await receiptWithCase(call);
    const bad = await call("POST", `/cases/${k.id}/documents`, { name: "x", filename: "x.pdf", file_base64: PDF, kind: "recibo", receipt_id: 999999 });
    assert.equal(bad.status >= 400, true);
    for (const [ext, b64] of [["docx", DOCX], ["pdf", PDF]]) {
      const ok = await call("POST", `/cases/${k.id}/documents`, { name: "Recibo", filename: `r.${ext}`, file_base64: b64, kind: "recibo", receipt_id: r.id });
      assert.equal(ok.body.kind, "recibo");
    }
    const docs = (await call("GET", `/cases/${k.id}/documents`)).body;
    return docs.map((d) => [d.kind, d.receipt_id === r.id]);
  });
});

test("Gerencia deletes a receipt with its documents; a case with receipts cannot be deleted", async () => {
  await same(async (call) => {
    const { k, r } = await receiptWithCase(call);
    await call("POST", `/cases/${k.id}/documents`, { name: "Recibo", filename: "r.pdf", file_base64: PDF, kind: "recibo", receipt_id: r.id });
    const blocked = await call("DELETE", `/cases/${k.id}`);
    assert.equal(blocked.status >= 400, true);
    assert.match(blocked.body.error, /recibos/);
    const del = await call("DELETE", `/payments/receipts/${r.id}`, { confirm: String(r.number) });
    assert.equal(del.status, 204);
    assert.deepEqual((await call("GET", `/cases/${k.id}/documents`)).body, []);
    assert.equal((await call("GET", `/payments/receipts?clientId=${r.client_id}`)).body.length, 0);
    return "ok";
  });
});

test("other roles cannot delete a receipt or its saved document", async () => {
  const g = sides.server;
  const office = (await g("GET", "/admin/offices")).body[0].id;
  await g("POST", "/admin/users", { name: "Abogada Caja", email: "caja@firma.co", role: "Abogado", office_ids: [office], password: "tribunal-azul-2026",
    custom_permissions: true, permissions: ["payments.manage", "cases.write", "clients.read", "cases.read"] });
  const u = await srv.login("caja@firma.co", "tribunal-azul-2026");
  await u.call("POST", "/auth/password", { current: "tribunal-azul-2026", next: "tribunal-verde-2026" });
  const { k, r } = await receiptWithCase(g);
  const doc = (await g("POST", `/cases/${k.id}/documents`, { name: "Recibo", filename: "r.pdf", file_base64: PDF, kind: "recibo", receipt_id: r.id })).body;
  assert.equal((await u.call("DELETE", `/payments/receipts/${r.id}`)).status, 403);
  assert.equal((await u.call("DELETE", `/cases/${k.id}/documents/${doc.id}`)).status, 403);
});

test("deleting a receipt makes a copy of the database first (and refuses if it cannot)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "recibos-"));
  const db = openDb(path.join(dir, "juanmaapp.db"));
  const server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = "";
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json", "X-JuanMa": "1", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
    const t = await res.text();
    return { status: res.status, body: t ? JSON.parse(t) : null };
  };
  try {
    await call("POST", "/auth/setup", { name: "Gerente", email: "g@firma.co", password: "clave-segura-1" });
    const { r } = await receiptWithCase(call);
    assert.equal((await call("DELETE", `/payments/receipts/${r.id}`, { confirm: String(r.number) })).status, 204);
    const copies = readdirSync(path.join(dir, "respaldos"));
    assert.equal(copies.length, 1);
    const log = db.prepare("SELECT trigger FROM backup_log ORDER BY id DESC").get();
    assert.equal(log.trigger, "antes-de-borrar-recibo");
  } finally { server.close(); }
});

test("version 2.59: each user keeps their own drawn signature, nobody else's", async () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  await same(async (call) => {
    const id = (await call("GET", "/auth/status")).body.user.id;
    assert.equal((await call("GET", `/admin/users/${id}/signature`)).body.signature, "");
    assert.equal((await call("PUT", `/admin/users/${id}/signature`, { signature: "no es imagen" })).status >= 400, true);
    await call("PUT", `/admin/users/${id}/signature`, { signature: PNG });
    assert.equal((await call("GET", `/admin/users/${id}/signature`)).body.signature, PNG);
    assert.equal((await call("PUT", `/admin/users/${id + 999}/signature`, { signature: PNG })).status >= 400, true);
    await call("PUT", `/admin/users/${id}/signature`, { signature: "" });
    return (await call("GET", `/admin/users/${id}/signature`)).body.signature;
  });
});
