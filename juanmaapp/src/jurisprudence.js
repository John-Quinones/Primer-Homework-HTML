// Case-law research against Colombia's high courts and tribunals. Claude
// searches and reads only official court sites (web_search / web_fetch with
// allowed_domains); every URL it reports is checked against the URLs the
// tools actually returned, so a sentence that was not found on an official
// page is never presented as verified.
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "./engine.js";

export const OFFICIAL_DOMAINS = [
  "corteconstitucional.gov.co",
  "cortesuprema.gov.co",
  "consejodeestado.gov.co",
  "ramajudicial.gov.co", // includes consultajurisprudencial.* and tribunal sites
];

export const COURTS = {
  CC: "Corte Constitucional",
  CSJ: "Corte Suprema de Justicia",
  CE: "Consejo de Estado",
  TRIB: "Tribunales Superiores y Administrativos",
};

export const CSJ_SALAS = ["Sala Plena", "Sala de Casación Civil, Agraria y Rural", "Sala de Casación Laboral", "Sala de Casación Penal", "Sala de Instrucción", "Sala de Primera Instancia"];

let client = new Anthropic();
/** Tests swap in a stub client. */
export function setClient(c) { client = c; }

const SYSTEM = `You are a Colombian case-law researcher working for attorneys.

Rules:
- Search and read ONLY the official court websites available through your tools.
- Report a judgment only if you opened or saw it in a search result during this task. Never fill in a court, number, date, reporting judge, URL or quotation from memory.
- If you cannot find something on an official page, say so: set the field to null and explain in "notes".
- Quote the judgment verbatim when you quote it. Write summaries in Spanish, in plain legal language, without filler.
- End your answer with exactly one fenced \`\`\`json block containing the requested object and nothing after it.`;

export function isOfficialUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

const normUrl = (u) => {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return String(u).toLowerCase();
  }
};

/** Collect every URL the server tools returned (search results, fetched pages, citations). */
export function collectSeenUrls(content) {
  const seen = new Set();
  const walk = (node, inToolResult) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, inToolResult));
    const isResult = inToolResult || (typeof node.type === "string" && node.type.endsWith("_tool_result"));
    if (isResult && typeof node.url === "string") seen.add(normUrl(node.url));
    if (Array.isArray(node.citations)) {
      for (const c of node.citations) if (typeof c?.url === "string") seen.add(normUrl(c.url));
    }
    for (const [k, v] of Object.entries(node)) if (k !== "citations") walk(v, isResult);
  };
  walk(content, false);
  return seen;
}

/** A URL counts as verified only if it is official and a tool actually returned it. */
export function verifiedUrl(url, seen) {
  return typeof url === "string" && isOfficialUrl(url) && seen.has(normUrl(url));
}

export function lastJsonBlock(text) {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (!blocks.length) throw new Error("La respuesta no trajo el bloque JSON esperado.");
  return JSON.parse(blocks.at(-1)[1]);
}

/** One research turn with official-only web tools; resumes pause_turn. */
async function research(prompt, { maxSearches = 6 } = {}) {
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: maxSearches, allowed_domains: OFFICIAL_DOMAINS },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, allowed_domains: OFFICIAL_DOMAINS },
  ];
  const messages = [{ role: "user", content: prompt }];
  const content = [];
  for (let i = 0; i < 5; i++) {
    const msg = await client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high" },
      system: SYSTEM,
      tools,
      messages,
    }).finalMessage();

    content.push(...msg.content);
    if (msg.stop_reason === "refusal") throw new Error("El modelo no pudo atender esta consulta.");
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  const text = content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { data: lastJsonBlock(text), seen: collectSeenUrls(content) };
}

function courtFilter({ court, sala }) {
  if (!court) return "any of: Corte Constitucional, Corte Suprema de Justicia (all chambers), Consejo de Estado, or Colombian tribunals";
  return COURTS[court] + (sala ? `, ${sala}` : "");
}

// ---------- Search ----------
export async function searchSentencias({ query, court, sala, yearFrom, yearTo }) {
  const prompt = `Find up to 8 Colombian judgments relevant to this research question:
"${query}"

Court: ${courtFilter({ court, sala })}.
${yearFrom || yearTo ? `Years: ${yearFrom || "any"} to ${yearTo || "today"}.` : ""}

Return:
\`\`\`json
{"results": [{
  "court": "", "sala": "", "reference": "e.g. T-123 de 2020, SL1234-2021, radicado 25000-23-...",
  "date": "YYYY-MM-DD or null", "reporting_judge": "magistrado ponente or null",
  "topic": "one sentence on what it decides", "url": "official URL where you saw it"
}], "notes": ""}
\`\`\``;
  const { data, seen } = await research(prompt);
  const results = (data.results || []).map((r) => ({ ...r, verified: verifiedUrl(r.url, seen) }));
  return { results, notes: data.notes || "" };
}

// ---------- Analysis ----------
export async function analyzeSentencia({ reference, url, court }) {
  const target = url ? `the judgment at ${url}` : `the judgment "${reference}"${court ? ` of the ${COURTS[court] || court}` : ""}`;
  const prompt = `Locate ${target} on the official court website, read it, and analyze it.

Return:
\`\`\`json
{
  "found": true,
  "court": "", "sala": "", "reference": "", "date": "YYYY-MM-DD or null", "reporting_judge": "",
  "url": "official URL you read",
  "legal_problem": "problema jurídico",
  "facts": "hechos relevantes, brief",
  "ratio_decidendi": "regla de decisión",
  "decision": "lo que resolvió (parte resolutiva)",
  "dissents": "salvamentos o aclaraciones de voto, or null",
  "cited_norms": ["normas que aplica"],
  "summary": "resumen de 150 a 250 palabras",
  "key_quotes": [{"text": "verbatim quote", "section": "where it appears"}],
  "notes": ""
}
\`\`\`
If you cannot find it on an official site, return {"found": false, "notes": "why"}.`;
  const { data, seen } = await research(prompt);
  return { ...data, verified: !!data.found && verifiedUrl(data.url, seen) };
}

// ---------- Citation check ----------
export async function verifyCitation({ citation, claim }) {
  const prompt = `An attorney's draft cites this Colombian judgment:
Citation: "${citation}"
${claim ? `Passage of the draft that relies on it: "${claim}"` : ""}

1. Confirm on an official court website whether this judgment exists with this exact reference (court, number, year).
2. If it exists, check whether it actually supports what the passage says. If the citation has errors (wrong number, year or court), give the correct reference if you found it.

Return:
\`\`\`json
{
  "exists": "yes | no | unknown",
  "supports_claim": "yes | partially | no | unknown | not_applicable",
  "correct_reference": "", "court": "", "date": "YYYY-MM-DD or null",
  "url": "official URL you read",
  "supporting_quote": "verbatim passage of the judgment, or null",
  "explanation": "2-4 sentences in Spanish"
}
\`\`\``;
  const { data, seen } = await research(prompt, { maxSearches: 4 });
  const verified = verifiedUrl(data.url, seen);
  // Without an official page we read, existence cannot be confirmed.
  if (!verified && data.exists === "yes") {
    data.exists = "unknown";
    data.explanation = `${data.explanation || ""} (No se obtuvo la página oficial, así que no se puede confirmar.)`.trim();
  }
  return { citation, ...data, verified };
}
