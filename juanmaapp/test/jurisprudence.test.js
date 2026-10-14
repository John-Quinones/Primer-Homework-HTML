import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  isOfficialUrl, collectSeenUrls, verifiedUrl, lastJsonBlock, setClient, searchSentencias, verifyCitation,
} from "../src/jurisprudence.js";
import { startServer } from "./helpers.js";

globalThis.window ??= {};
createRequire(import.meta.url)("../public/citations.js");
const { extractCitations } = window.JuanmaCitations;

test("only court domains count as official", () => {
  assert.ok(isOfficialUrl("https://www.corteconstitucional.gov.co/relatoria/2008/t-760-08.htm"));
  assert.ok(isOfficialUrl("https://consultajurisprudencial.ramajudicial.gov.co/WebRelatoria/csj/index.xhtml"));
  assert.ok(!isOfficialUrl("https://corteconstitucional.gov.co.example.com/t-760-08"));
  assert.ok(!isOfficialUrl("https://blog-juridico.co/t-760-08"));
  assert.ok(!isOfficialUrl("not a url"));
});

test("extracts Colombian citations with the sentence that relies on them", () => {
  const cites = extractCitations(
    "La Corte, en la Sentencia T-760 de 2008, ordenó medidas. Ver C-355/06. La Sala Laboral en SL1234-2021 reiteró la regla. " +
    "El Consejo de Estado, radicado 25000-23-26-000-2012-00123-01, condenó al Estado. Otra vez T-760 de 2008.");
  assert.deepEqual(cites.map((c) => c.citation),
    ["Sentencia T-760 de 2008", "C-355/06", "SL1234-2021", "radicado 25000-23-26-000-2012-00123-01"]);
  assert.match(cites[2].claim, /Sala Laboral/);
});

test("collects URLs from tool results and citations, not from model text", () => {
  const content = [
    { type: "server_tool_use", name: "web_search", input: { query: "x", url: "https://evil.example/ignored" } },
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://www.corteconstitucional.gov.co/relatoria/2020/T-001-20.htm" }] },
    { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://cortesuprema.gov.co/doc/SL1-2021.pdf" } },
    { type: "text", text: "see https://www.consejodeestado.gov.co/made-up", citations: [{ url: "https://relatoria.consejodeestado.gov.co/doc/1" }] },
  ];
  const seen = collectSeenUrls(content);
  assert.ok(verifiedUrl("https://corteconstitucional.gov.co/relatoria/2020/T-001-20.htm/", seen));
  assert.ok(verifiedUrl("https://cortesuprema.gov.co/doc/SL1-2021.pdf", seen));
  assert.ok(verifiedUrl("https://relatoria.consejodeestado.gov.co/doc/1", seen));
  assert.ok(!verifiedUrl("https://www.consejodeestado.gov.co/made-up", seen));
  assert.ok(!verifiedUrl("https://evil.example/ignored", seen));
});

test("reads the last JSON block", () => {
  assert.deepEqual(lastJsonBlock("x ```json\n{\"a\":1}\n``` y ```json\n{\"a\":2}\n```"), { a: 2 });
  assert.throws(() => lastJsonBlock("no json"));
});

// Stub client: returns canned content blocks and records requests.
function stubClient(blocksPerCall) {
  const calls = [];
  return {
    calls,
    beta: { messages: { stream(params) {
      calls.push(params);
      const msg = blocksPerCall[calls.length - 1];
      return { finalMessage: async () => msg };
    } } },
  };
}

test("search restricts tools to official domains and flags unverified results", async () => {
  const stub = stubClient([{
    stop_reason: "end_turn",
    content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://www.corteconstitucional.gov.co/relatoria/2021/T-100-21.htm" }] },
      { type: "text", text: '```json\n{"results":[' +
        '{"court":"Corte Constitucional","reference":"T-100 de 2021","url":"https://www.corteconstitucional.gov.co/relatoria/2021/T-100-21.htm"},' +
        '{"court":"Corte Constitucional","reference":"T-999 de 2021","url":"https://www.corteconstitucional.gov.co/relatoria/2021/T-999-21.htm"}' +
        '],"notes":""}\n```' },
    ],
  }]);
  setClient(stub);
  const { results } = await searchSentencias({ query: "estabilidad laboral reforzada" });
  assert.deepEqual(results.map((r) => r.verified), [true, false]);
  const tools = stub.calls[0].tools;
  assert.deepEqual(tools.map((t) => t.type), ["web_search_20260209", "web_fetch_20260209"]);
  assert.ok(tools.every((t) => t.allowed_domains.includes("corteconstitucional.gov.co")));
});

test("verify resumes pause_turn and downgrades 'exists' without an official page", async () => {
  const stub = stubClient([
    { stop_reason: "pause_turn", content: [{ type: "server_tool_use", name: "web_search", input: {} }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: '```json\n{"exists":"yes","supports_claim":"yes","url":"https://example.com/t-1","explanation":"Encontrada."}\n```' }] },
  ]);
  setClient(stub);
  const r = await verifyCitation({ citation: "T-1 de 2020", claim: "..." });
  assert.equal(stub.calls.length, 2);
  assert.equal(stub.calls[1].messages.at(-1).role, "assistant");
  assert.equal(r.verified, false);
  assert.equal(r.exists, "unknown");
});

let srv, call;
before(async () => {
  srv = await startServer();
  call = (await srv.setup()).call;
});
after(() => srv.close());

test("saved judgments API validates input and never trusts a page's 'verified' flag", async () => {
  assert.equal((await call("POST", "/jurisprudencia/search", { query: " " })).status, 400);
  assert.equal((await call("POST", "/jurisprudencia/saved", {})).status, 400);
  assert.equal((await call("POST", "/jurisprudencia/saved", { reference: "T-1 de 2020", case_id: 999 })).status, 404);
  const forged = await call("POST", "/jurisprudencia/saved", {
    reference: "T-1 de 2020", url: "https://www.corteconstitucional.gov.co/x", verified: true, proof: "made-up", analysis: { summary: "x" },
  });
  assert.equal(forged.status, 201);
  assert.equal(forged.body.verified, false);
  assert.deepEqual(forged.body.analysis, { summary: "x" });
  assert.equal((await call("GET", "/jurisprudencia/saved")).body.length, 1);
  assert.equal((await call("DELETE", `/jurisprudencia/saved/${forged.body.id}`)).status, 204);
});

test("a result verified by the server keeps its mark when saved", async () => {
  setClient(stubClient([{
    stop_reason: "end_turn",
    content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://www.corteconstitucional.gov.co/relatoria/2021/T-100-21.htm" }] },
      { type: "text", text: '```json\n{"results":[{"court":"Corte Constitucional","reference":"T-100 de 2021","url":"https://www.corteconstitucional.gov.co/relatoria/2021/T-100-21.htm"}]}\n```' },
    ],
  }]));
  const found = await call("POST", "/jurisprudencia/search", { query: "salud" });
  const r = found.body.results[0];
  assert.equal(r.verified, true);
  assert.ok(r.proof);
  const saved = await call("POST", "/jurisprudencia/saved", { ...r, analysis: {} });
  assert.equal(saved.body.verified, true);
});
