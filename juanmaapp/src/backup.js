// Automatic copies of the database (version 2.42, user's rule: every 3 days).
// The server writes a full, consistent copy with VACUUM INTO next to the
// database (DB_PATH's folder + /respaldos, or BACKUP_DIR), keeps the newest
// BACKUP_KEEP files and logs every attempt. A failed copy rings Gerencia's bell.
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { HttpError } from "./http.js";

const DAY_MS = 86400000;
const NAME_RE = /^juanmaapp-\d{4}-\d{2}-\d{2}-\d{4}\.db$/;
const RETRY_MS = 3600000; // after a failure, try again an hour later

export const backupDays = () => Number(process.env.BACKUP_DAYS) || 3;
export const backupKeep = () => Number(process.env.BACKUP_KEEP) || 5;

// The file each open database was opened from (set by openDb in db.js).
export const dbFiles = new WeakMap();

/** Folder of the copies, or null when the database is in memory (tests) or copies are turned off.
 * Takes the database (or its file name). */
export function backupDir(dbOrFile) {
  const dbFile = typeof dbOrFile === "string" ? dbOrFile : dbFiles.get(dbOrFile);
  if (process.env.BACKUP_DIR === "off" || !dbFile || dbFile === ":memory:") return null;
  return process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(dbFile)), "respaldos");
}

export function backupSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS backup_log (
    id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, ok INTEGER NOT NULL, file TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0, trigger TEXT NOT NULL DEFAULT 'auto', error TEXT NOT NULL DEFAULT '')`);
}

// 'YYYY-MM-DD-HHMM' in Colombia time (UTC-5).
const stampName = (ms) => new Date(ms - 5 * 3600000).toISOString().slice(0, 16).replace("T", "-").replace(":", "");

/** The copies on disk, newest first. */
export function listBackups(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => NAME_RE.test(f))
    .map((f) => ({ file: f, size: statSync(path.join(dir, f)).size })).sort((a, b) => b.file.localeCompare(a.file));
}

/** Make one copy now; removes the oldest beyond the limit. Returns the log row. */
export function makeBackup(db, { dir = backupDir(db), trigger = "auto", now = Date.now() } = {}) {
  backupSchema(db);
  if (!dir) return { ok: false, error: "Las copias están desactivadas en este servidor." };
  let row;
  try {
    mkdirSync(dir, { recursive: true });
    let file = `juanmaapp-${stampName(now)}.db`;
    if (existsSync(path.join(dir, file))) return { ok: true, file, size: statSync(path.join(dir, file)).size, trigger };
    db.prepare("VACUUM INTO ?").run(path.join(dir, file));
    row = { ok: 1, file, size: statSync(path.join(dir, file)).size, error: "" };
    for (const old of listBackups(dir).slice(backupKeep())) unlinkSync(path.join(dir, old.file));
  } catch (err) {
    row = { ok: 0, file: "", size: 0, error: String(err.message || err).slice(0, 300) };
  }
  db.prepare("INSERT INTO backup_log (at_ms, ok, file, size, trigger, error) VALUES (?, ?, ?, ?, ?, ?)").run(now, row.ok, row.file, row.size, trigger, row.error);
  return { ...row, ok: !!row.ok, trigger };
}

/** Copy of the database taken right before a receipt is deleted (version 2.58). No copy, no deletion; in-memory databases (tests) have none to make. */
export function backupBeforeReceiptDelete(db) {
  const file = dbFiles.get(db);
  if (!file || file === ":memory:") return null;
  const out = makeBackup(db, { trigger: "antes-de-borrar-recibo" });
  if (!out.ok) throw new HttpError(409, `No se borró: no se pudo hacer la copia de respaldo previa (${out.error}).`);
  return out;
}

/** Called every minute by the scheduler: a copy when the last good one is BACKUP_DAYS old (or there is none). */
export function backupIfDue(db, { dir = backupDir(db), now = Date.now(), onFail = () => {} } = {}) {
  if (!dir) return null;
  backupSchema(db);
  const lastOk = db.prepare("SELECT MAX(at_ms) AS t FROM backup_log WHERE ok = 1").get().t;
  const lastTry = db.prepare("SELECT MAX(at_ms) AS t FROM backup_log").get().t;
  if (lastOk && now - lastOk < backupDays() * DAY_MS) return null;
  if (lastTry && lastTry !== lastOk && now - lastTry < RETRY_MS) return null;
  const out = makeBackup(db, { dir, now });
  if (!out.ok) onFail(out);
  return out;
}

/** What the Configuración panel shows. */
export function backupStatus(db, dir = backupDir(db)) {
  backupSchema(db);
  const log = db.prepare("SELECT at_ms, ok, file, size, trigger, error FROM backup_log ORDER BY id DESC LIMIT 10").all()
    .map((r) => ({ ...r, ok: !!r.ok }));
  const lastOk = log.find((r) => r.ok)?.at_ms ?? null;
  return { enabled: !!dir, every_days: backupDays(), keep: backupKeep(), files: listBackups(dir), log,
    next_ms: dir ? (lastOk ? lastOk + backupDays() * DAY_MS : Date.now()) : null };
}

/** Path of one copy, only for a valid name inside the folder. */
export function backupPath(name, dir) {
  if (!dir || !NAME_RE.test(String(name))) return null;
  const p = path.join(dir, name);
  return existsSync(p) ? p : null;
}
