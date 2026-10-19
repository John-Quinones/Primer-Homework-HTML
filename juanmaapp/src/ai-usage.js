// What every call to the Anthropic API costs (version 2.49): tokens and web
// searches are written to ai_usage, priced at the public list rates, so
// Gerencia sees the month's spend in Configuración. It is an estimate: the
// bill in console.anthropic.com is the real figure.

// USD per million tokens [input, output], by model id prefix (longest first).
const PRICES = [
  ["claude-fable-5", 10, 50],
  ["claude-opus-5-5", 4, 20],
  ["claude-opus-5", 5, 25],
  ["claude-opus-4", 5, 25],
  ["claude-sonnet-5", 2, 10],
  ["claude-sonnet-4", 3, 15],
  ["claude-haiku-5-5", 0.1, 0.5],
  ["claude-haiku-4", 1, 5],
];
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches; web fetch costs only its tokens

export const KIND_LABELS = {
  nomosai: "NomosAI (borradores)",
  search: "Jurisprudencia: buscar",
  analyze: "Jurisprudencia: analizar",
  analyze_text: "Jurisprudencia: analizar texto pegado",
  verify: "Jurisprudencia: verificar citas",
};

const n = (v) => (Number.isFinite(v) ? v : 0);

/** Add the usage of several responses of one consultation. */
export function addUsage(total, usage) {
  const u = usage || {};
  total.input_tokens = n(total.input_tokens) + n(u.input_tokens);
  total.output_tokens = n(total.output_tokens) + n(u.output_tokens);
  total.cache_read_input_tokens = n(total.cache_read_input_tokens) + n(u.cache_read_input_tokens);
  total.cache_creation_input_tokens = n(total.cache_creation_input_tokens) + n(u.cache_creation_input_tokens);
  total.web_search_requests = n(total.web_search_requests) + n(u.server_tool_use?.web_search_requests) + n(u.web_search_requests);
  return total;
}

/** List price in USD of one consultation's usage on a model. */
export function costOf(usage, model) {
  const u = addUsage({}, usage);
  const row = PRICES.find(([p]) => String(model || "").startsWith(p)) || PRICES[1]; // unknown: priced as Opus
  let [, inp, out] = row;
  // Claude Haiku 5.5 charges more when the prompt passes 100K tokens.
  if (row[0] === "claude-haiku-5-5" && u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens > 100_000) [inp, out] = [0.5, 2.5];
  const tokens = u.input_tokens * inp + u.cache_creation_input_tokens * inp * 1.25 + u.cache_read_input_tokens * inp * 0.1 + u.output_tokens * out;
  return tokens / 1e6 + u.web_search_requests * WEB_SEARCH_USD;
}

export function recordUsage(db, { kind, userId = null, model, usage }) {
  if (!usage) return;
  const u = addUsage({}, usage);
  try {
    db.prepare(`INSERT INTO ai_usage (at_ms, user_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(Date.now(), userId, kind, String(model || ""), u.input_tokens, u.output_tokens,
      u.cache_read_input_tokens, u.cache_creation_input_tokens, u.web_search_requests, costOf(u, model));
  } catch (err) {
    console.error("No se pudo anotar el consumo de IA:", err.message); // never fails the user's request
  }
}

// Month in Colombia (UTC-5, no daylight saving) as "YYYY-MM", and its first instant.
const BOGOTA_MS = -5 * 3600 * 1000;
const monthOf = (ms) => new Date(ms + BOGOTA_MS).toISOString().slice(0, 7);
const monthStart = (ym) => Date.parse(`${ym}-01T00:00:00Z`) - BOGOTA_MS;

/** This month by kind and by person, and the totals of the last 6 months. */
export function usageSummary(db, now = Date.now()) {
  const month = monthOf(now);
  const from = monthStart(month);
  const byKind = db.prepare(`SELECT kind, COUNT(*) AS count, SUM(cost_usd) AS cost, SUM(input_tokens + cache_read_tokens + cache_write_tokens) AS input_tokens,
    SUM(output_tokens) AS output_tokens, SUM(web_searches) AS web_searches FROM ai_usage WHERE at_ms >= ? GROUP BY kind ORDER BY cost DESC`).all(from)
    .map((r) => ({ ...r, label: KIND_LABELS[r.kind] || r.kind }));
  const byUser = db.prepare(`SELECT u.user_id, COALESCE(s.name, 'Sin usuario') AS name, COUNT(*) AS count, SUM(u.cost_usd) AS cost
    FROM ai_usage u LEFT JOIN users_shown s ON s.id = u.user_id WHERE u.at_ms >= ? GROUP BY u.user_id ORDER BY cost DESC`).all(from);
  const sixAgo = monthStart(monthOf(Date.parse(`${month}-15T12:00:00Z`) - 150 * 24 * 3600 * 1000));
  const rows = db.prepare("SELECT at_ms, cost_usd FROM ai_usage WHERE at_ms >= ?").all(sixAgo);
  const months = {};
  for (const r of rows) months[monthOf(r.at_ms)] = (months[monthOf(r.at_ms)] || 0) + r.cost_usd;
  return {
    month,
    total: byKind.reduce((s, r) => s + r.cost, 0),
    count: byKind.reduce((s, r) => s + r.count, 0),
    byKind,
    byUser,
    months: Object.entries(months).sort(([a], [b]) => b.localeCompare(a)).map(([m, cost]) => ({ month: m, cost })),
  };
}
