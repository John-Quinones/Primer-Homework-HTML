import test from "node:test";
import assert from "node:assert/strict";
import { parseWeather, parseFeed, weatherText } from "../src/banda-inicio.js";

test("weather answer becomes today plus three days", () => {
  const w = parseWeather({
    current: { temperature_2m: 23.6, relative_humidity_2m: 72, weather_code: 2, wind_speed_10m: 8.2 },
    daily: { time: ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"], weather_code: [2, 61, 3, 0],
      temperature_2m_max: [28, 27, 25, 28], temperature_2m_min: [18, 18, 17, 18], precipitation_probability_max: [40, 80, 20, 5] },
  });
  assert.equal(w.temp, 24); assert.equal(w.text, "Parcialmente nublado"); assert.equal(w.rain, 40);
  assert.deepEqual(w.days.map((d) => d.kind), ["rain", "cloud", "sun"]);
  assert.throws(() => parseWeather({}));
  assert.equal(weatherText(95).text, "Tormenta eléctrica");
});

test("feeds: RSS and Atom, CDATA, entities; items without a link are dropped", () => {
  const rss = `<rss><channel><item><title><![CDATA[Fallo &amp; criterio]]></title><link>https://x.co/a</link><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title>Sin enlace</title></item></channel></rss>`;
  const atom = `<feed><entry><title>Nota</title><link href="https://x.co/b"/><updated>2026-10-21T08:00:00Z</updated></entry></feed>`;
  assert.deepEqual(parseFeed(rss).map((x) => [x.title, x.link]), [["Fallo & criterio", "https://x.co/a"]]);
  assert.equal(parseFeed(atom)[0].link, "https://x.co/b");
  assert.equal(parseFeed("<html>no es un feed</html>").length, 0);
});
