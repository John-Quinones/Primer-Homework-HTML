import { test } from "node:test";
import assert from "node:assert/strict";
import { versionName, VERSION_2_CHANGE, V2_2_1_CHANGE } from "../src/version.js";

test("version names: old changes keep their number, then 2, 2.1, 2.2 …", () => {
  assert.equal(versionName(63), "63");
  assert.equal(versionName(VERSION_2_CHANGE), "2");
  assert.equal(versionName(VERSION_2_CHANGE + 1), "2.1");
  assert.equal(versionName(VERSION_2_CHANGE + 10), "2.10");
  assert.equal(versionName(null), "");
  assert.equal(versionName(V2_2_1_CHANGE - 1), "2.106");
  assert.equal(versionName(V2_2_1_CHANGE), "2.2.1");
  assert.equal(versionName(V2_2_1_CHANGE + 1), "2.2.2");
  assert.equal(versionName(V2_2_1_CHANGE + 11), "2.2.12");
});

test("2.103 and 2.2.1 are different names; the news list reads three-part rows", async () => {
  const { readNews } = await import("../src/version.js");
  assert.notEqual(versionName(V2_2_1_CHANGE - 2), versionName(V2_2_1_CHANGE));
  assert.ok(readNews(3).every((n) => /^(C\d+|\d+(\.\d+){0,2})$/.test(n.n)));
});
