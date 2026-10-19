// Version 2.42: a copy of the database every 3 days, the newest 5 kept; Gerencia sees and downloads them.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../src/db.js";
import { backupIfDue, makeBackup, backupStatus, backupDir } from "../src/backup.js";
import { startServer } from "./helpers.js";

const dir = mkdtempSync(path.join(tmpdir(), "jm-backup-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("copies sit next to the database; none for an in-memory one", () => {
  assert.equal(backupDir("/home/data/juanmaapp.db"), "/home/data/respaldos");
  assert.equal(backupDir(":memory:"), null);
});

test("a copy is made when due, every 3 days, and only the newest 5 stay", () => {
  const db = openDb(path.join(dir, "app.db"));
  db.prepare("INSERT INTO clients (full_name) VALUES ('Ana Gómez')").run();
  const out = path.join(dir, "respaldos");
  const t0 = Date.parse("2026-10-19T12:00:00Z");
  const first = backupIfDue(db, { dir: out, now: t0 });
  assert.equal(first.ok, true);
  // The copy is a complete database with the data.
  const copy = new DatabaseSync(path.join(out, first.file));
  assert.equal(copy.prepare("SELECT full_name FROM clients").get().full_name, "Ana Gómez");
  copy.close();
  assert.equal(backupIfDue(db, { dir: out, now: t0 + 2 * 86400000 }), null); // not due yet
  for (let i = 1; i <= 6; i++) assert.equal(backupIfDue(db, { dir: out, now: t0 + i * 3 * 86400000 }).ok, true);
  assert.equal(readdirSync(out).length, 5);
  assert.equal(existsSync(path.join(out, first.file)), false); // the oldest was removed
  const st = backupStatus(db, out);
  assert.equal(st.files.length, 5);
  assert.equal(st.every_days, 3);
});

test("a failed copy is logged, rings Gerencia's bell once and retries an hour later", () => {
  const db = openDb(":memory:");
  const bad = path.join(dir, "no-es-carpeta");
  db.prepare("VACUUM INTO ?").run(bad); // a file where the folder should be
  let fails = 0;
  const t0 = Date.parse("2026-10-19T12:00:00Z");
  assert.equal(backupIfDue(db, { dir: bad, now: t0, onFail: () => fails++ }).ok, false);
  assert.equal(backupIfDue(db, { dir: bad, now: t0 + 60000, onFail: () => fails++ }), null);
  assert.equal(backupIfDue(db, { dir: bad, now: t0 + 3600000, onFail: () => fails++ }).ok, false);
  assert.equal(fails, 2);
  assert.equal(makeBackup(db, { dir: null }).ok, false);
});

test("only Gerencia sees the copies; with no folder (tests) they are off", async () => {
  const srv = await startServer();
  after(() => srv.close());
  const admin = await srv.setup();
  const office = (await admin.call("GET", "/admin/offices")).body[0].id;
  const b = await admin.call("GET", "/admin/backups");
  assert.equal(b.status, 200);
  assert.equal(b.body.enabled, false);
  assert.equal((await admin.call("POST", "/admin/backups")).status, 500);
  assert.equal((await admin.call("GET", "/admin/backups/..%2F..%2Fetc.db")).status, 404);
  await admin.call("POST", "/admin/users", { name: "Laura Abogada", email: "laura@firma.co", role: "Abogado", office_ids: [office], password: "una frase larga 77" });
  const laura = await srv.login("laura@firma.co", "una frase larga 77");
  assert.equal(laura.loginStatus, 200);
  assert.equal((await laura.call("GET", "/admin/backups")).status, 403);
});
