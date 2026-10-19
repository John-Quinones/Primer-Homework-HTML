// Version 2.49: cheaper AI. NomosAI on Claude Haiku 5.5, case law on Claude
// Sonnet 5.5 with limits on what it reads, a free check of Corte
// Constitucional citations, and the cost of every call written down.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { setClient, verifyCitation, searchSentencias, checkExists, MODEL as JURIS_MODEL } from "../src/jurisprudence.js";
import { MODEL as NOMOS_MODEL } from "../src/engine.js";
import { costOf, addUsage, usageSummary, recordUsage } from "../src/ai-usage.js";
import { ccRelatoriaUrl, pageNamesJudgment } from "../src/court-links.js";
import { startServer } from "./helpers.js";

function stubClient(msgs) {
  const calls = [];
  return { calls, beta: { messages: { stream(params) { calls.push(params); const m = msgs[Math.min(calls.length - 1, msgs.length - 1)]; return { finalMessage: async () => m }; } } } };
}
const usage = { input_tokens: 50000, output_tokens: 2000, server_tool_use: { web_search_requests: 2 } };

test("NomosAI writes with Claude Haiku 5.5 and case law runs on Claude Sonnet 5.5", () => {
  assert.equal(NOMOS_MODEL, "claude-haiku-5-5");
  assert.equal(JURIS_MODEL, "claude-sonnet-5-5");
});

test("costs follow the list prices, web searches included", () => {
  assert.equal(costOf(usage, "claude-sonnet-5-5").toFixed(4), (0.1 + 0.02 + 0.02).toFixed(4));
  assert.equal(costOf(usage, "claude-opus-5-5").toFixed(4), (0.2 + 0.04 + 0.02).toFixed(4));
  assert.equal(costOf({ input_tokens: 10000, output_tokens: 10000 }, "claude-haiku-5-5").toFixed(4), "0.0060");
  // Haiku's higher rate above 100K prompt tokens.
  assert.equal(costOf({ input_tokens: 200000, output_tokens: 0 }, "claude-haiku-5-5").toFixed(2), "0.10");
  // Cache reads cost a tenth.
  assert.equal(costOf({ cache_read_input_tokens: 1e6 }, "claude-sonnet-5-5").toFixed(2), "0.20");
  assert.deepEqual(addUsage(addUsage({}, usage), usage).web_search_requests, 4);
});

test("search reads less: 3 searches, 2 pages, 15,000 tokens per page", async () => {
  const stub = stubClient([{ stop_reason: "end_turn", model: "claude-sonnet-5-5", usage, content: [{ type: "text", text: '```json\n{"results":[]}\n```' }] }]);
  setClient(stub);
  let seen;
  await searchSentencias({ query: "pensión de sobreviviente" }, { onUsage: (u) => (seen = u) });
  const [search, fetchTool] = stub.calls[0].tools;
  assert.equal(stub.calls[0].model, "claude-sonnet-5-5");
  assert.equal(search.max_uses, 3);
  assert.equal(fetchTool.max_uses, 2);
  assert.equal(fetchTool.max_content_tokens, 15000);
  assert.equal(seen.usage.web_search_requests, 2);
  assert.equal(seen.model, "claude-sonnet-5-5");
});

test("a Corte Constitucional citation is checked at its own page first, with one search at most", async () => {
  const stub = stubClient([{ stop_reason: "end_turn", content: [{ type: "text", text: '```json\n{"exists":"unknown","supports_claim":"unknown"}\n```' }] }]);
  setClient(stub);
  await verifyCitation({ citation: "T-760 de 2008", claim: "x" });
  assert.ok(stub.calls[0].messages[0].content.includes("https://www.corteconstitucional.gov.co/relatoria/2008/T-760-08.htm"));
  assert.equal(stub.calls[0].tools[0].max_uses, 1);
});

test("the free check opens the relatoría without AI and never says 'no'", async () => {
  const page = (status, body) => async () => ({ ok: status === 200, status, arrayBuffer: async () => new TextEncoder().encode(body).buffer });
  const yes = await checkExists("Sentencia T-760 de 2008", { fetchImpl: page(200, "<title>T-760-08 Corte Constitucional</title>") });
  assert.equal(yes.exists, "yes");
  assert.equal(yes.verified, true);
  assert.equal(yes.url, ccRelatoriaUrl("T-760 de 2008"));
  assert.equal((await checkExists("T-760 de 2008", { fetchImpl: page(404, "") })).exists, "unknown");
  assert.equal((await checkExists("T-760 de 2008", { fetchImpl: page(200, "Sentencia T-761/08") })).exists, "unknown");
  assert.equal((await checkExists("T-760 de 2008", { fetchImpl: async () => { throw new Error("ECONNRESET"); } })).exists, "unknown");
  const other = await checkExists("SL1234-2021", { fetchImpl: () => assert.fail("must not fetch") });
  assert.equal(other.checked, false);
  assert.ok(pageNamesJudgment("SENTENCIA T-007/20", "T-7 de 2020"));
  assert.ok(!pageNamesJudgment("SENTENCIA T-70/20", "T-7 de 2020"));
});

const srv = await startServer();
after(() => srv.close());

test("every AI answer writes its cost; a repeated citation check is free; only Gerencia sees the month", async () => {
  const admin = await srv.setup();
  const url = "https://www.corteconstitucional.gov.co/relatoria/2008/T-760-08.htm";
  const stub = stubClient([{ stop_reason: "end_turn", model: "claude-sonnet-5-5", usage, content: [
    { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url } },
    { type: "text", text: '```json\n{"exists":"yes","supports_claim":"yes","url":"' + url + '","explanation":"Sí."}\n```' },
  ] }]);
  setClient(stub);
  const first = await admin.call("POST", "/jurisprudencia/verify", { citation: "T-760 de 2008", claim: "La salud es un derecho fundamental." });
  assert.equal(first.status, 200);
  assert.equal(first.body.verified, true);
  const again = await admin.call("POST", "/jurisprudencia/verify", { citation: "t-760 DE 2008", claim: "La salud es un derecho fundamental." });
  assert.equal(again.body.cached, true);
  assert.equal(stub.calls.length, 1);

  const rows = srv.db.prepare("SELECT kind, model, web_searches, cost_usd FROM ai_usage").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "verify");
  assert.equal(rows[0].web_searches, 2);
  assert.equal(rows[0].cost_usd.toFixed(4), "0.1400");

  const sum = await admin.call("GET", "/admin/ai-usage");
  assert.equal(sum.status, 200);
  assert.equal(sum.body.count, 1);
  assert.equal(sum.body.byKind[0].label, "Jurisprudencia: verificar citas");
  assert.equal(sum.body.byUser[0].name, "Gerente General");
  assert.equal(sum.body.months.length, 1);

  const office = (await admin.call("GET", "/admin/offices")).body[0].id;
  await admin.call("POST", "/admin/users", { name: "Laura Abogada", email: "laura@firma.co", role: "Abogado", office_ids: [office], password: "una frase larga 77" });
  const laura = await srv.login("laura@firma.co", "una frase larga 77");
  assert.equal((await laura.call("GET", "/admin/ai-usage")).status, 403);
});

test("months are counted in Colombia time", () => {
  const db = srv.db;
  db.exec("DELETE FROM ai_usage");
  const at = (iso) => db.prepare("UPDATE ai_usage SET at_ms = ? WHERE id = (SELECT MAX(id) FROM ai_usage)").run(Date.parse(iso));
  recordUsage(db, { kind: "nomosai", model: "claude-haiku-5-5", usage: { input_tokens: 1e6 } });
  at("2026-11-01T03:00:00Z"); // 31 Oct, 22:00 in Bogotá
  recordUsage(db, { kind: "nomosai", model: "claude-haiku-5-5", usage: { input_tokens: 1e6 } });
  at("2026-11-01T06:00:00Z"); // 1 Nov, 01:00 in Bogotá
  const s = usageSummary(db, Date.parse("2026-11-10T12:00:00Z"));
  assert.equal(s.month, "2026-11");
  assert.equal(s.count, 1);
  assert.deepEqual(s.months.map((m) => m.month), ["2026-11", "2026-10"]);
});
