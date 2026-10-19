// Code audit (refactors that keep behavior): shared HTTP helpers, session read only for the API,
// reminders without per-task count queries, and the test link reading every stored file piece.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { HttpError, str, toInt } from "../src/http.js";
import { notify, taskReminders } from "../src/monitor.js";

let srv, admin;
before(async () => {
  srv = await startServer();
  admin = await srv.setup();
});
after(() => srv.close());

test("shared helpers: trimmed text, positive ids and user-facing errors", () => {
  assert.equal(str("  a "), "a");
  assert.equal(str(null), "");
  assert.equal(str(12), "12");
  assert.equal(toInt("7", "id"), 7);
  assert.throws(() => toInt("0", "El cliente"), (e) => e instanceof HttpError && e.status === 400 && e.message === "El cliente no es válido.");
  assert.equal(new HttpError(404, "x").expose, true);
});

test("page files load without reading the session; the API still needs it", async () => {
  const site = srv.base.replace(/\/api$/, "");
  let reads = 0;
  const prepare = srv.db.prepare.bind(srv.db);
  srv.db.prepare = (sql) => { if (/FROM sessions/.test(sql)) reads++; return prepare(sql); };
  try {
    const page = await fetch(site + "/styles.css", { headers: { Cookie: admin.cookie } });
    assert.equal(page.status, 200);
    assert.equal(reads, 0);
    const me = await admin.call("GET", "/auth/status");
    assert.equal(me.status, 200);
    assert.ok(reads > 0);
    assert.equal((await srv.session().call("GET", "/cases")).status, 401);
  } finally {
    srv.db.prepare = prepare;
  }
});

test("notify says whether the reminder is new; reminders count each one once", async () => {
  const userId = srv.db.prepare("SELECT id FROM users LIMIT 1").get().id;
  assert.equal(notify(srv.db, userId, "x", "t", "", "", "audit-key"), true);
  assert.equal(notify(srv.db, userId, "x", "t", "", "", "audit-key"), false);

  const lab = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
  const client = (await admin.call("POST", "/clients", { full_name: "Marta Ruiz" })).body;
  const k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: lab.types[0].id })).body;
  const soon = new Date(Date.now() - 5 * 3600 * 1000 + 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  const past = new Date(Date.now() - 5 * 3600 * 1000 - 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  for (const due_at of [soon, past]) {
    assert.equal((await admin.call("POST", "/tasks", { case_id: k.id, title: `Tarea ${due_at}`, due_at, remind_days: [0, 1], assigned_user_id: userId })).status, 201);
  }
  const first = taskReminders(srv.db);
  assert.equal(first, 2); // the task due in an hour: «mañana» (1 day before); the past one: «vencida»
  assert.equal(taskReminders(srv.db), 0);
});

// A stand-in for the link's database: collections of documents, where/orderBy/limit like the real one (limit ≤ 1000).
function fakeStore(docs, { refuseOrderBy = false } = {}) {
  const query = (name, filters = [], order = null, max = 1000) => ({
    where: (f, op, v) => query(name, [...filters, [f, op, v]], order, max),
    orderBy: (f) => { if (refuseOrderBy) throw new Error("unsupported"); return query(name, filters, f, max); },
    limit: (n) => query(name, filters, order, Math.min(n, 1000)),
    async get() {
      let rows = [...(docs.get(name) || new Map())].filter(([, d]) => filters.every(([f, op, v]) => (op === ">=" ? d[f] >= v : op === "<" ? d[f] < v : true)));
      rows.sort(([a, x], [b, y]) => (order ? (x[order] < y[order] ? -1 : x[order] > y[order] ? 1 : 0) : 0) || (a < b ? -1 : 1));
      return { docs: rows.slice(0, max).map(([id, d]) => ({ id, exists: true, data: () => d })) };
    },
    doc: (id) => ({
      set: async (body) => { if (!docs.has(name)) docs.set(name, new Map()); docs.get(name).set(id, body); },
      delete: async () => docs.get(name)?.delete(id),
    }),
  });
  return { collection: (name) => query(name) };
}

async function storeWith(docs, opts) {
  const window = { claude: { use: async () => fakeStore(docs, opts) } };
  vm.runInNewContext(readFileSync(new URL("../public/web-store.js", import.meta.url), "utf8"), { window, setTimeout, localStorage: null, Promise, JSON, Map, Math, String, Object, Error });
  return window.JuanmaStore;
}

function savedState(files) {
  const docs = new Map([["jm_meta", new Map([["info", { value: {} }], ["blobs", { index: {} }]])], ["jm_blob", new Map()]]);
  for (let i = 0; i < files; i++) {
    const key = `photo-${String(i).padStart(4, "0")}`;
    docs.get("jm_meta").get("blobs").index[key] = 2;
    docs.get("jm_blob").set(`${key}-0`, { key, n: 0, part: "AA" });
    docs.get("jm_blob").set(`${key}-1`, { key, n: 1, part: "BB" });
  }
  return docs;
}

test("the test link reads every stored file piece, past 1000, and saving keeps them all", async () => {
  const docs = savedState(700); // 1400 pieces
  const store = await storeWith(docs);
  const state = await store.load();
  assert.equal(Object.keys(state.blobs).length, 700);
  assert.equal(state.blobs["photo-0699"], "AABB");
  await store.save(state);
  // Saving re-cuts each file into pieces (here one each); no file is lost.
  const reread = await (await storeWith(docs)).load();
  assert.equal(Object.keys(reread.blobs).length, 700);
  assert.ok(Object.values(reread.blobs).every((b) => b === "AABB"));
  const again = await store.refresh("clients", "photo-06");
  assert.equal(Object.keys(again.blobs).length, 100);
});

test("if the store refuses the ordered read, the link reads as before", async () => {
  const docs = savedState(3);
  const store = await storeWith(docs, { refuseOrderBy: true });
  const state = await store.load();
  assert.equal(Object.keys(state.blobs).length, 3);
});
