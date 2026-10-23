// Inicio: «Últimos movimientos» reads /audit?recent=1 (15 latest; own entries when the role lacks audit.view).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("audit route has a recent mode limited to 15 and to own entries without audit.view", () => {
  const src = readFileSync(new URL("../src/audit.js", import.meta.url), "utf8");
  assert.match(src, /q\.recent/);
  assert.match(src, /LIMIT \$\{q\.recent \? 15 : 300\}/);
  assert.match(src, /user_id = \?"\); params\.push\(req\.user\.id\)/);
});
