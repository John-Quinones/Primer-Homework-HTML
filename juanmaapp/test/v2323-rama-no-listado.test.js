import test, { after } from "node:test";
import assert from "node:assert/strict";
import { setFetch, findByRadicado, NOT_LISTED_MSG } from "../src/ramajudicial.js";

process.env.RAMA_RETRY_MS = "1";
after(() => setFetch((...a) => fetch(...a)));

test("a process whose last two digits differ is still found", async () => {
  setFetch(async () => ({ ok: true, json: async () => ({ procesos: [{ idProceso: 7, llaveProceso: "73168400300120240012701", despacho: "JUZGADO 01 CIVIL MUNICIPAL" }] }) }));
  const r = await findByRadicado("73-168-40-03-001-2024-00127-00");
  assert.equal(r.length, 1);
});

test("a different process is not taken for it", async () => {
  setFetch(async () => ({ ok: true, json: async () => ({ procesos: [{ idProceso: 8, llaveProceso: "73168400300120240099900" }] }) }));
  assert.equal((await findByRadicado("73168400300120240012700")).length, 0);
});

test("an empty list is retried once, and an HTML block page is reported as such", async () => {
  let n = 0;
  setFetch(async () => ({ ok: true, json: async () => ({ procesos: n++ ? [{ idProceso: 9, llaveProceso: "73168400300120240012700" }] : [] }) }));
  assert.equal((await findByRadicado("73168400300120240012700")).length, 1);
  setFetch(async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } }));
  await assert.rejects(findByRadicado("73168400300120240012700"), /no es la esperada/);
  assert.match(NOT_LISTED_MSG, /no significa que no exista/);
});
