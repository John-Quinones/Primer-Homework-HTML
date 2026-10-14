// Bundles public/ into one self-contained HTML file that runs without the
// server: the in-browser demo backend replaces /api. Output:
// preview/juanmaapp-preview.html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_CATALOG } from "../src/db.js";

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
  .replace('<script src="app.js"></script>', () => [
    `<script>window.JUANMA_SEED_CATALOG = ${JSON.stringify(SEED_CATALOG)};</script>`,
    `<script>${safe(read("public/demo-backend.js"))}</script>`,
    `<script>${safe(read("public/app.js"))}</script>`,
  ].join("\n"));

mkdirSync(path.join(root, "preview"), { recursive: true });
const out = path.join(root, "preview/juanmaapp-preview.html");
writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
