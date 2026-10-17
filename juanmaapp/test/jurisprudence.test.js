import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  isOfficialUrl, collectSeenUrls, verifiedUrl, lastJsonBlock, setClient, searchSentencias, verifyCitation, analyzeSentencia, ccRelatoriaUrl,
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

test("builds the Corte Constitucional page from the reference", () => {
  assert.equal(ccRelatoriaUrl("Sentencia T-760 de 2008"), "https://www.corteconstitucional.gov.co/relatoria/2008/T-760-08.htm");
  assert.equal(ccRelatoriaUrl("C-355/06"), "https://www.corteconstitucional.gov.co/relatoria/2006/C-355-06.htm");
  assert.equal(ccRelatoriaUrl("su-214 del 2016"), "https://www.corteconstitucional.gov.co/relatoria/2016/SU-214-16.htm");
  assert.equal(ccRelatoriaUrl("T-406-92"), "https://www.corteconstitucional.gov.co/relatoria/1992/T-406-92.htm");
  assert.equal(ccRelatoriaUrl("SL1234-2021"), null);
  assert.equal(ccRelatoriaUrl("radicado 25000-23-26-000-2012-00123-01"), null);
});

test("analysis of a Constitutional Court judgment goes straight to its page at medium effort", async () => {
  const url = "https://www.corteconstitucional.gov.co/relatoria/2008/T-760-08.htm";
  const stub = stubClient([{ stop_reason: "end_turn", content: [
    { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url } },
    { type: "text", text: '```json\n{"found":true,"reference":"T-760 de 2008","url":"' + url + '"}\n```' },
  ] }]);
  setClient(stub);
  const a = await analyzeSentencia({ reference: "T-760 de 2008" });
  assert.equal(a.verified, true);
  const req = stub.calls[0];
  assert.equal(req.output_config.effort, "medium");
  assert.ok(req.messages[0].content.includes(url));
  assert.deepEqual(req.tools.map((t) => t.max_uses), [2, 3]);
});

test("the same analysis is answered from the database the second time", async () => {
  const url = "https://www.corteconstitucional.gov.co/relatoria/2020/T-050-20.htm";
  const stub = stubClient([{ stop_reason: "end_turn", content: [
    { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url } },
    { type: "text", text: '```json\n{"found":true,"reference":"T-050 de 2020","url":"' + url + '"}\n```' },
  ] }]);
  setClient(stub);
  const first = await call("POST", "/jurisprudencia/analyze", { reference: "T-050 de 2020" });
  const again = await call("POST", "/jurisprudencia/analyze", { reference: "  t-050 DE 2020 " });
  assert.equal(stub.calls.length, 1);
  assert.equal(first.body.cached, undefined);
  assert.equal(again.body.cached, true);
  assert.equal(again.body.verified, true);
  assert.ok(again.body.proof);
});

test("a judgment that was not found is researched again", async () => {
  const miss = { stop_reason: "end_turn", content: [{ type: "text", text: '```json\n{"found":false,"notes":"No está."}\n```' }] };
  const stub = stubClient([miss, miss]);
  setClient(stub);
  await call("POST", "/jurisprudencia/analyze", { reference: "T-999 de 2021" });
  await call("POST", "/jurisprudencia/analyze", { reference: "T-999 de 2021" });
  assert.equal(stub.calls.length, 2);
});

test("AI errors without an HTTP status say what happened instead of 'undefined'", async () => {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { apiError } = await import("../src/jurisprudence-routes.js");
  const mid = new Anthropic.APIError(undefined, { type: "error", error: { type: "invalid_request_error", message: "bad tool" } }, undefined, undefined, "invalid_request_error");
  const [s1, m1] = apiError(mid);
  assert.equal(s1, 502);
  assert.match(m1, /invalid_request_error\): bad tool/);
  assert.doesNotMatch(m1, /undefined/);
  const [, m2] = apiError(new Anthropic.APIError(undefined, { error: { type: "overloaded_error" } }, undefined, undefined, "overloaded_error"));
  assert.match(m2, /saturado/);
  const [s3, m3] = apiError(new Anthropic.APIConnectionError({ cause: new Error("getaddrinfo ENOTFOUND api.anthropic.com") }));
  assert.equal(s3, 502);
  assert.match(m3, /ENOTFOUND/);
  assert.match(apiError(new Anthropic.APIConnectionTimeoutError())[1], /tiempo agotado/);
});

test("a mid-stream overload is retried once; a bad request is not", async () => {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { withRetry } = await import("../src/jurisprudence.js");
  let n = 0;
  const overloaded = () => new Anthropic.APIError(undefined, { error: { type: "overloaded_error" } }, undefined, undefined, "overloaded_error");
  assert.equal(await withRetry(async () => { if (n++ === 0) throw overloaded(); return "ok"; }, 0), "ok");
  n = 0;
  const bad = new Anthropic.APIError(undefined, { error: { type: "invalid_request_error" } }, undefined, undefined, "invalid_request_error");
  await assert.rejects(withRetry(async () => { n++; throw bad; }, 0));
  assert.equal(n, 1);
});
