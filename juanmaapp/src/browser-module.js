// Turns a dependency-free ES module from src/ into a browser script that
// defines one global, so the page and the server share the same code.
import { readFileSync } from "node:fs";

export function asGlobal(file, globalName) {
  const source = readFileSync(file, "utf8");
  const names = [...source.matchAll(/^export (?:async )?(?:const|function|let|class) (\w+)/gm)].map((m) => m[1]);
  const body = source.replace(/^export \{[^}]*\};?$/gm, "").replace(/^export /gm, "");
  return `window.${globalName} = (function () {\n${body}\nreturn { ${names.join(", ")} };\n})();\n`;
}

export const SHARED_MODULES = [["src/case-meta.js", "JuanmaCaseMeta"], ["src/ledger.js", "JuanmaLedger"], ["src/validate.js", "JuanmaValidate"], ["src/person.js", "JuanmaPerson"], ["src/portals.js", "JuanmaPortals"], ["src/decision.js", "JuanmaDecision"], ["src/legal.js", "JuanmaLegal"], ["src/court-links.js", "JuanmaCourtLinks"], ["src/place-rules.js", "JuanmaPlaces"], ["src/record-rules.js", "JuanmaRecords"], ["src/contract-objects.js", "JuanmaContractObjects"], ["src/doc-numbers.js", "JuanmaDocNumbers"]];
