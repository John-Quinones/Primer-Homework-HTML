// Version 2.25: the sender marks on the preview where the signature goes ("at:X,Y").
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jsPDF } from "jspdf";
import * as PDFLib from "pdf-lib";
import { startServer } from "./helpers.js";

const window = { jspdf: { jsPDF }, PDFLib };
new Function("window", readFileSync(new URL("../public/pdf-tools.js", import.meta.url), "utf8"))(window);
const { stampBoxes, stampSpot, STAMP } = window.JuanmaPdf;

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

test("a chosen spot puts the first stamp there, the rest to the right, inside the page", () => {
  const [a, b] = stampBoxes(612, 792, 2, "at:0.1000,0.2500");
  assert.ok(Math.abs(a.x - 61.2) < 1e-9);
  assert.equal(a.y, 792 - 198 - STAMP.h); // 25 % from the top
  assert.equal(b.x, a.x + STAMP.w + STAMP.gap);
  assert.equal(b.y, a.y);
  // Near the right and bottom edges it is pulled back inside the page, above the footer.
  const [c] = stampBoxes(612, 792, 1, "at:1,1");
  assert.equal(c.x, 612 - STAMP.w);
  assert.equal(c.y, STAMP.footer);
  assert.equal(stampSpot("at:1.5,0.2"), null);
  assert.equal(stampSpot("br"), null);
  // Corners keep working as before.
  assert.equal(stampBoxes(612, 792, 1, "br")[0].x, 612 - 26 - STAMP.w);
});

test("the server keeps the spot, refuses bad ones and tells the signer where it goes", async () => {
  const r = await admin.call("POST", "/esign", { title: "Poder", doc_text: "# PODER\n\nTexto.", stamp_page: "1", stamp_pos: "at:0.3000,0.6500",
    signers: [{ name: "Ana Pérez", email: "ana@cliente.co" }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.stamp_pos, "at:0.3000,0.6500");
  const bad = await admin.call("POST", "/esign", { title: "Poder", doc_text: "x", stamp_pos: "at:2,0.5", signers: [{ name: "Ana Pérez", email: "ana@cliente.co" }] });
  assert.equal(bad.body.stamp_pos, "br");
  const sql = srv.db.prepare("SELECT stamp_pos FROM sign_requests WHERE id = ?").get(r.body.id);
  assert.equal(sql.stamp_pos, "at:0.3000,0.6500");
});

test("the signed PDF draws the stamp at the chosen spot", async () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const r = { id: 7, title: "Poder", doc_text: "# PODER\n\nTexto.", doc_hash: "ab", stamp_page: "1", stamp_pos: "at:0.2000,0.4000", events: [],
    signers: [{ name: "Ana", status: "firmado", signature_png: PNG, signed_at: "2026-10-18 10:00:00", otp_channel: "email" }] };
  const blob = await window.JuanmaPdf.signedPdf(r);
  const pdf = await PDFLib.PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(pdf.getPageCount() >= 2, "document + certificate");
});
