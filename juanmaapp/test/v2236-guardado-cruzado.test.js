// Version 2.2.36: two devices (tabs) on the published link keep their own copy of the data. Saving from an old copy
// used to rewrite the whole bucket: an edit by the other device was lost, a record created there disappeared, a
// deleted one came back, and deleting one record could take the one next to it. Now only what each copy changed is applied.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { newDatabase, startDevice } from "./link-shared.js";

const bucket = (id) => id % 64;
const EMAIL = "gerencia@firma.co";
let data, A, B;
const person = (i) => ({ person_type: "natural", first_names: "Cli" + i, last_names: "Prueba", id_number: String(7000 + i) });

before(async () => {
  data = newDatabase();
  A = await startDevice(data);
  await A.call("POST", "/auth/setup", { name: "Gerente General", email: EMAIL });
  for (let i = 0; i < 150; i++) await A.call("POST", "/clients", person(i));
});
const open = async () => { const d = await startDevice(data); await d.call("POST", "/auth/login", { email: EMAIL }); return d; };
const clients = async (d) => (await d.call("GET", "/clients")).body;
// two clients of the same bucket
const pair = async (d) => {
  const list = await clients(d);
  for (const x of list) { const y = list.find((c) => c.id !== x.id && bucket(c.id) === bucket(x.id)); if (y) return [x, y]; }
};

test("an edit made on one device is not lost when another device saves a neighbour", async () => {
  A = await open(); B = await open();
  const [x, y] = await pair(A);
  assert.equal((await B.call("PUT", `/clients/${x.id}`, { notes: "cambio de B" })).status, 200);
  assert.equal((await A.call("PUT", `/clients/${y.id}`, { notes: "cambio de A" })).status, 200);
  const C = await open(), list = await clients(C);
  assert.equal(list.find((c) => c.id === x.id).notes, "cambio de B");
  assert.equal(list.find((c) => c.id === y.id).notes, "cambio de A");
});

test("deleting one record never removes the one next to it, even from an old copy", async () => {
  A = await open();
  const [x, y] = await pair(A);
  B = await open();
  // B creates records until one lands in the same bucket as x and y
  let z;
  for (let i = 0; !z && i < 400; i++) { const c = (await B.call("POST", "/clients", person(1000 + i))).body; if (bucket(c.id) === bucket(x.id)) z = c; }
  assert.ok(z, "a new record in the same bucket");
  // A still has the old copy (no z) and deletes x
  const del = await A.call("DELETE", `/clients/${x.id}`, { confirm: x.full_name });
  assert.equal(del.status, 204);
  const C = await open(), list = await clients(C);
  assert.ok(!list.some((c) => c.id === x.id), "x deleted");
  assert.ok(list.some((c) => c.id === y.id), "y stays");
  assert.ok(list.some((c) => c.id === z.id), "z, created on the other device, stays");
});

test("a record deleted on one device does not come back when another one saves", async () => {
  A = await open(); B = await open();
  const [x, y] = await pair(A);
  assert.equal((await B.call("DELETE", `/clients/${x.id}`, { confirm: x.full_name })).status, 204);
  assert.equal((await A.call("PUT", `/clients/${y.id}`, { notes: "otra cosa" })).status, 200);
  const C = await open(), list = await clients(C);
  assert.ok(!list.some((c) => c.id === x.id));
  assert.equal(list.find((c) => c.id === y.id).notes, "otra cosa");
});

test("signing in takes what the other devices saved; an edit of A shows on B afterwards", async () => {
  A = await open(); B = await open();
  const [x] = await pair(A);
  await A.call("PUT", `/clients/${x.id}`, { notes: "editado en A" });
  assert.notEqual((await clients(B)).find((c) => c.id === x.id).notes, "editado en A", "B has not asked yet");
  await B.call("POST", "/auth/login", { email: EMAIL });
  assert.equal((await clients(B)).find((c) => c.id === x.id).notes, "editado en A");
});

test("cases: an update only touches its own case", async () => {
  A = await open();
  const type = (await A.call("GET", "/catalog")).body[0].types[0];
  const cl = (await A.call("POST", "/clients", person(9001))).body;
  const mk = async (t) => (await A.call("POST", "/cases", { client_id: cl.id, process_type_id: type.id, title: t })).body;
  const ks = []; for (let i = 0; i < 130; i++) ks.push(await mk("Caso " + i));
  const k1 = ks[0], k2 = ks.find((k) => k.id !== k1.id && bucket(k.id) === bucket(k1.id));
  B = await open();
  await B.call("PUT", `/cases/${k1.id}`, { title: "Editado en B" });
  await A.call("PUT", `/cases/${k2.id}`, { title: "Editado en A" });
  const C = await open(), list = (await C.call("GET", "/cases")).body;
  assert.equal(list.find((k) => k.id === k1.id).title, "Editado en B");
  assert.equal(list.find((k) => k.id === k2.id).title, "Editado en A");
  assert.equal(list.filter((k) => k.client_id === cl.id).length, 130);
});
