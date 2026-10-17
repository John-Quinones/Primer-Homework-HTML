// pdf.js (pdfjs-dist legacy build) as two classic scripts: the library sets
// window.pdfjsLib and the worker sets window.pdfjsWorker, which pdf.js uses on
// the main thread (no separate worker file, so it also runs inside the
// single-file published link). Used to show PDF pages before signing.
import { readFileSync } from "node:fs";
import path from "node:path";

// "export{a as B,c as D};" → "globalThis.NAME={B:a,D:c};", wrapped so its top-level names stay private.
const toGlobal = (code, name) => "(function(){" + code
  .replace(/import\.meta\.url/g, "(document.baseURI)")
  .replace(/export\{([^}]*)\};?\s*$/, (_, list) => `globalThis.${name}={${list.split(",").map((x) => { const [a, b] = x.trim().split(/\s+as\s+/); return `${b || a}:${a}`; }).join(",")}};`) + "\n})();";

export function pdfjsClassic(root) {
  const dir = path.join(root, "node_modules/pdfjs-dist/legacy/build");
  return {
    lib: toGlobal(readFileSync(path.join(dir, "pdf.min.mjs"), "utf8"), "pdfjsLib"),
    worker: toGlobal(readFileSync(path.join(dir, "pdf.worker.min.mjs"), "utf8"), "pdfjsWorker"),
  };
}
