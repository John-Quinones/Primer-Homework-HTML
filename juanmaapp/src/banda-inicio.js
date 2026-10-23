// Band at the top of Inicio: weather for Ibagué and headlines from legal news feeds.
// Free sources, no key and no AI credits. The server asks them at most every 30 min (weather)
// and 60 min (news), keeps the last good answer, and Inicio never waits for them.
import express from "express";

export const CITY = { name: "Ibagué, Tolima", latitude: 4.4389, longitude: -75.2322 };
const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?latitude=${CITY.latitude}&longitude=${CITY.longitude}`
  + "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m"
  + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
  + "&timezone=America%2FBogota&forecast_days=4";

// name = what the person sees; home = the source's own news page (always shown as a button).
export const NEWS_SOURCES = [
  { name: "Rama Judicial", home: "https://www.ramajudicial.gov.co/web/ventanilla/historico-de-noticias", feed: "https://www.ramajudicial.gov.co/web/ventanilla/historico-de-noticias?p_p_id=com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet&_com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_rss=true" },
  { name: "Corte Suprema", home: "https://cortesuprema.gov.co/", feed: "https://cortesuprema.gov.co/feed/" },
  { name: "Consejo de Estado", home: "https://www.consejodeestado.gov.co/", feed: "https://www.consejodeestado.gov.co/feed/" },
  { name: "Ámbito Jurídico", home: "https://www.ambitojuridico.com/", feed: "https://www.ambitojuridico.com/rss.xml" },
];

// WMO weather codes (Open-Meteo) in plain Spanish; kind picks the icon.
export function weatherText(code) {
  const c = Number(code);
  if (c === 0) return { text: "Despejado", kind: "sun" };
  if (c === 1) return { text: "Mayormente despejado", kind: "sun" };
  if (c === 2) return { text: "Parcialmente nublado", kind: "cloud" };
  if (c === 3) return { text: "Nublado", kind: "cloud" };
  if (c === 45 || c === 48) return { text: "Niebla", kind: "cloud" };
  if (c >= 51 && c <= 57) return { text: "Llovizna", kind: "rain" };
  if (c >= 61 && c <= 67) return { text: "Lluvia", kind: "rain" };
  if (c >= 80 && c <= 82) return { text: "Aguaceros", kind: "rain" };
  if (c >= 95) return { text: "Tormenta eléctrica", kind: "rain" };
  return { text: "Variable", kind: "cloud" };
}

export function parseWeather(j) {
  const cur = j?.current, d = j?.daily;
  if (!cur || !d?.time?.length) throw new Error("Respuesta sin datos");
  const w = weatherText(cur.weather_code);
  const days = d.time.slice(1, 4).map((t, i) => ({
    date: t, ...weatherText(d.weather_code[i + 1]),
    max: Math.round(d.temperature_2m_max[i + 1]), min: Math.round(d.temperature_2m_min[i + 1]),
  }));
  return {
    city: CITY.name, temp: Math.round(cur.temperature_2m), text: w.text, kind: w.kind,
    humidity: Math.round(cur.relative_humidity_2m), wind: Math.round(cur.wind_speed_10m),
    rain: Math.round(d.precipitation_probability_max?.[0] ?? 0), days,
  };
}

const unesc = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Items (RSS <item> or Atom <entry>) of a feed: title, link, date. Anything unreadable is dropped. */
export function parseFeed(xml, max = 5) {
  const out = [];
  for (const m of String(xml).matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    const title = unesc((b.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
    const link = unesc((b.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i) || [])[1]) || (b.match(/<link\b[^>]*href="([^"]+)"/i) || [])[1] || "";
    const when = unesc((b.match(/<(?:pubDate|updated|published)\b[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i) || [])[1]);
    const t = Date.parse(when);
    if (title && /^https?:\/\//i.test(link)) out.push({ title, link, at: Number.isNaN(t) ? null : new Date(t).toISOString() });
    if (out.length >= max) break;
  }
  return out;
}

async function getText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "TecjuridicosApp/1.0", Accept: "application/xml,application/json,text/xml,*/*" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const cache = { weather: { at: 0, data: null }, news: { at: 0, data: null } };
const TTL = { weather: 30 * 60e3, news: 60 * 60e3 };
// The last good answer survives a failed refresh; a failure is retried after 5 min, not on every visit.
async function cached(key, load) {
  const c = cache[key], now = Date.now();
  if (c.data && now - c.at < TTL[key]) return c.data;
  if (c.failedAt && now - c.failedAt < 5 * 60e3) return c.data;
  try { c.data = await load(); c.at = now; c.failedAt = 0; } catch { c.failedAt = now; }
  return c.data;
}

export const loadWeather = () => cached("weather", async () => ({ ...parseWeather(JSON.parse(await getText(WEATHER_URL))), at: new Date().toISOString() }));

export const loadNews = () => cached("news", async () => {
  const lists = await Promise.all(NEWS_SOURCES.map(async (s) => {
    try { return parseFeed(await getText(s.feed), 4).map((x) => ({ ...x, source: s.name })); } catch { return []; }
  }));
  const all = lists.flat();
  if (!all.length) throw new Error("Ninguna fuente respondió");
  // Newest first; items without a date go last. At most two per source in the first six so one feed cannot fill the band.
  all.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const seen = {}, items = [];
  for (const x of all) { seen[x.source] = (seen[x.source] || 0) + 1; if (seen[x.source] <= 2) items.push(x); if (items.length >= 6) break; }
  return { items, at: new Date().toISOString() };
});

export function bandaInicioRouter() {
  const r = express.Router();
  r.get("/banda", async (_req, res) => {
    const [clima, noticias] = await Promise.all([loadWeather(), loadNews()]);
    res.json({ clima: clima || null, noticias: noticias || null, fuentes: NEWS_SOURCES.map(({ name, home }) => ({ name, home })) });
  });
  return r;
}
