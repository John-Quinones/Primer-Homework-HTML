// Solo LEE. Copia la base y las copias de respaldo a /home/data/rescate-<hora>/ y revisa cada COPIA.
// No modifica, mueve ni borra nada de /home/data. Uso (en SSH de Azure): node diagnostico-db.mjs
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const DATA = process.env.DB_DIR || "/home/data";
const out = path.join(DATA, "rescate-" + new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });
const size = (f) => (existsSync(f) ? statSync(f).size : "no existe");

const files = [];
for (const ext of ["", "-wal", "-shm", "-journal"]) {
  const src = path.join(DATA, "juanmaapp.db" + ext);
  if (existsSync(src)) { copyFileSync(src, path.join(out, "juanmaapp.db" + ext)); }
  console.log(`juanmaapp.db${ext}: ${size(src)} bytes`);
}
files.push("juanmaapp.db");
const bdir = path.join(DATA, "respaldos");
if (existsSync(bdir)) for (const f of readdirSync(bdir).filter((x) => x.endsWith(".db")).sort().reverse()) {
  mkdirSync(path.join(out, "respaldos"), { recursive: true });
  copyFileSync(path.join(bdir, f), path.join(out, "respaldos", f));
  files.push(path.join("respaldos", f));
}
console.log("\nCopias hechas en:", out, "\n");
for (const f of files) {
  const p = path.join(out, f);
  try {
    const db = new DatabaseSync(p, { readOnly: true });
    const check = db.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]).slice(0, 3).join(" | ");
    let n = {};
    for (const t of ["clients", "cases", "payments", "users"]) { try { n[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch (e) { n[t] = "ERROR: " + e.message; } }
    console.log(`${f} (${size(p)} bytes)\n  integridad: ${check}\n  filas: ${JSON.stringify(n)}`);
    db.close();
  } catch (e) { console.log(`${f}: NO SE PUDO ABRIR: ${e.message}`); }
}
