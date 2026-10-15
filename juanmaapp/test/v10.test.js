import { test } from "node:test";
import assert from "node:assert/strict";
import { PORTALS, portalOrder, radicadoDigits } from "../src/portals.js";
import { asGlobal } from "../src/browser-module.js";

test("portals: the four official sites, each with a how-to", () => {
  assert.deepEqual(PORTALS.map((p) => p.id), ["cpnu", "publicaciones", "tyba", "samai"]);
  for (const p of PORTALS) assert.match(p.url, /^https:\/\/[a-z.]+\.gov\.co\//);
  assert.deepEqual(PORTALS.filter((p) => p.auto).map((p) => p.id), ["cpnu"]);
});

test("portals: administrative radicados go to SAMAI first, the rest to the Rama Judicial", () => {
  assert.equal(radicadoDigits("73001-33-33-004-2019-00123-00"), "73001333300420190012300");
  assert.equal(radicadoDigits("123"), "");
  assert.equal(portalOrder("73001-33-33-004-2019-00123-00")[0], "samai");
  assert.equal(portalOrder("73001233300020200015600")[0], "samai");
  assert.equal(portalOrder("11001031500020211095200")[0], "samai");
  assert.equal(portalOrder("73001310300120190012300")[0], "cpnu");
  assert.equal(portalOrder("")[0], "cpnu");
});

test("portals: served to the page as a global", () => {
  const js = asGlobal(new URL("../src/portals.js", import.meta.url).pathname, "JuanmaPortals");
  const window = {};
  new Function("window", js)(window);
  assert.equal(window.JuanmaPortals.portalOrder("73001333300420190012300")[0], "samai");
});
