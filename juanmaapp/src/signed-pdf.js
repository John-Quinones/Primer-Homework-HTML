// The signed document (stamps + certificate) built on the server with the same
// code the browser uses (public/pdf-tools.js), so the e-mailed copy is identical
// to the one downloaded from the app.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { jsPDF } from "jspdf";
import * as PDFLib from "pdf-lib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let tools = null;
function load() {
  if (tools) return tools;
  // Run in this realm (not a vm context) so pdf-lib recognizes the arrays and pages it is given.
  const qrcode = createRequire(import.meta.url)("qrcode-generator");
  const modules = (text) => { const q = qrcode(0, "M"); q.addData(String(text)); q.make(); const n = q.getModuleCount(); return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c))); };
  const window = { jspdf: { jsPDF }, PDFLib, JuanmaQr: { modules } };
  new Function("window", readFileSync(path.join(root, "public/logo-wm.js"), "utf8"))(window);
  for (const f of ["membrete-assets.js", "membrete.js"]) new Function("window", readFileSync(path.join(root, "public", f), "utf8"))(window);
  new Function("window", readFileSync(path.join(root, "public/pdf-tools.js"), "utf8"))(window);
  tools = window.JuanmaPdf;
  return tools;
}

/** r: a request as the app sees it (signers with signature_png, events…); original: PDF bytes or null for text. */
export async function buildSignedPdf(r, original = null) {
  const blob = await load().signedPdf(r, original ? new Uint8Array(original) : null);
  return Buffer.from(await blob.arrayBuffer());
}
