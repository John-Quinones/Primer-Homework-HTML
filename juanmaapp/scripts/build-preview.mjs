// Bundles public/ into one self-contained HTML file that runs without the
// server: the in-browser demo backend replaces /api. Output:
// preview/juanmaapp-preview.html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_CATALOG } from "../src/db.js";
import { ROLES, PERMISSIONS, DEFAULT_MATRIX } from "../src/auth.js";
import { REPORTS } from "../src/reports.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
// Keep inlined scripts from closing the <script> element early.
const safe = (js) => js.replace(/<\/script/gi, "<\\/script");

const logo = "data:image/png;base64," + readFileSync(path.join(root, "public/logo-t.png")).toString("base64");
let html = read("public/index.html");

html = html
  .replace('<link rel="stylesheet" href="brand.css" />', () => `<style>\n${read("public/brand.css")}\n</style>`)
  .replace('<link rel="stylesheet" href="styles.css" />', () => `<style>\n${read("public/styles.css")}\n</style>`)
  .replaceAll("logo-t.png", logo)
  .replace('<script src="vendor/marked.min.js"></script>', () => `<script>${safe(read("node_modules/marked/marked.min.js"))}</script>`)
  .replace('<script src="vendor/purify.min.js"></script>', () => `<script>${safe(read("node_modules/dompurify/dist/purify.min.js"))}</script>`)
  .replace('<script src="vendor/read-excel-file.min.js"></script>', () => `<script>${safe(read("node_modules/read-excel-file/bundle/read-excel-file.min.js"))}</script>`)
  .replace('<script src="importer.js"></script>', () => `<script>${safe(read("public/importer.js"))}</script>`)
  .replace('<script src="vendor/write-excel-file.min.js"></script>', () => `<script>${safe(read("node_modules/write-excel-file/bundle/write-excel-file.min.js"))}</script>`)
  .replace('<script src="vendor/jspdf.umd.min.js"></script>', () => `<script>${safe(read("node_modules/jspdf/dist/jspdf.umd.min.js"))}</script>`)
  .replace('<script src="vendor/jspdf.plugin.autotable.min.js"></script>', () => `<script>${safe(read("node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.min.js"))}</script>`)
  .replace('<script src="citations.js"></script>', () => `<script>${safe(read("public/citations.js"))}</script>`)
  .replace('<script src="app.js"></script>', () => [
    `<script>window.JUANMA_SEED_CATALOG = ${JSON.stringify(SEED_CATALOG)};
window.JUANMA_AUTH = ${JSON.stringify({ roles: ROLES, permissions: PERMISSIONS, matrix: DEFAULT_MATRIX })};
window.JUANMA_REPORTS = ${JSON.stringify(REPORTS)};</script>`,
    `<script>${safe(read("public/demo-backend.js"))}</script>`,
    `<script>${safe(read("public/app.js"))}</script>`,
  ].join("\n"));

mkdirSync(path.join(root, "preview"), { recursive: true });
const out = path.join(root, "preview/juanmaapp-preview.html");
writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);

// Web-link version: the host adds its own document skeleton, so publish only
// the title, styles and body content, plus safe-area gutters for phones.
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"))
  .replace(title, "")
  .replace(/<meta charset="utf-8" \/>\s*/, "")
  .replace(/<meta name="viewport"[^>]*>\s*/, "");
const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
const gutters = `<style>
.topbar, main, .sidenav {
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}
@media (min-width: 761px) { main { padding-left: 24px; } .sidenav { padding-right: 12px; } }
.toast { bottom: calc(20px + env(safe-area-inset-bottom, 0px)); }
</style>`;
const artifact = `${title}\n<meta name="claude:viewport-fit-sides" content="cover">\n${head}\n${gutters}\n${body}`;
const outA = path.join(root, "preview/juanmaapp-web.html");
writeFileSync(outA, artifact);
console.log(`Wrote ${path.relative(root, outA)} (${(artifact.length / 1024).toFixed(0)} KB)`);
