import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { startServer } from "./helpers.js";

test("version 2.3: pdf.js is served as classic scripts for the PDF preview", async () => {
  const srv = await startServer();
  try {
    for (const [file, name] of [["pdfjs.js", "pdfjsLib"], ["pdfjs-worker.js", "pdfjsWorker"]]) {
      const res = await fetch(`${srv.base.replace(/\/api$/, "")}/vendor/${file}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /javascript/);
      const code = await res.text();
      assert.ok(code.includes(`globalThis.${name}=`), `${file} defines ${name}`);
      assert.doesNotThrow(() => new vm.Script(code), `${file} is a classic script`);
    }
  } finally { await srv.close(); }
});
