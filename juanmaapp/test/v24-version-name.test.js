import { test } from "node:test";
import assert from "node:assert/strict";
import { versionName, VERSION_2_CHANGE } from "../src/version.js";

test("version names: old changes keep their number, then 2, 2.1, 2.2 …", () => {
  assert.equal(versionName(63), "63");
  assert.equal(versionName(VERSION_2_CHANGE), "2");
  assert.equal(versionName(VERSION_2_CHANGE + 1), "2.1");
  assert.equal(versionName(VERSION_2_CHANGE + 10), "2.10");
  assert.equal(versionName(null), "");
});
