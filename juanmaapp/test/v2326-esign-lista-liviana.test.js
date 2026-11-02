import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

test("the e-signature list filters by case and leaves out the PDFs and the drawn signatures", async () => {
  const office = (await admin.call("GET", "/admin/offices")).body[0].id;
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Lara", id_number: "55" })).body;
  const type = (await admin.call("GET", "/catalog")).body.flatMap((x) => x.types)[0].id;
  const k1 = (await admin.call("POST", "/cases", { client_id: c.id, process_type_id: type, title: "Uno" })).body.id;
  const k2 = (await admin.call("POST", "/cases", { client_id: c.id, process_type_id: type, title: "Dos" })).body.id;
  const ins = srv.db.prepare("INSERT INTO sign_requests (title, case_id, office_id, doc_kind, doc_file, doc_name, doc_hash, status, signed_pdf) VALUES (?,?,?,?,?,?,?,?,?)");
  const a = Number(ins.run("A", k1, office, "pdf", Buffer.from("%PDF-1.4 a"), "a.pdf", "h1", "completada", Buffer.from("%PDF-1.4 firmado")).lastInsertRowid);
  ins.run("B", k2, office, "pdf", Buffer.from("%PDF-1.4 b"), "b.pdf", "h2", "enviada", null);
  srv.db.prepare("INSERT INTO sign_signers (request_id, name, token_hash, status, signature_png) VALUES (?,?,?,?,?)").run(a, "Firmante", "tk1", "firmado", "data:image/png;base64,AAAA");

  const all = (await admin.call("GET", "/esign")).body;
  assert.equal(all.length, 2);
  const one = (await admin.call("GET", `/esign?caseId=${k1}`)).body;
  assert.deepEqual(one.map((x) => x.title), ["A"]);
  assert.equal(one[0].has_pdf, true);
  assert.equal(one[0].has_signed_pdf, true);
  assert.equal(all.find((x) => x.title === "B").has_signed_pdf, false);
  assert.ok(!("doc_file" in one[0]) && !("signed_pdf" in one[0]));
  assert.equal(one[0].signers[0].signature_png, "");
  // the detail still carries the drawn signature
  assert.equal((await admin.call("GET", `/esign/${a}`)).body.signers[0].signature_png, "data:image/png;base64,AAAA");
});
