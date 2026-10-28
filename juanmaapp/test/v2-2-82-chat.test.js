import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

// Chat between users (version 2.2.82): privacy, unread counters, mentions, links, edits and video calls.
test("chat between users", async () => {
  const t = await startServer();
  const admin = await t.setup();
  const ibague = (await admin.call("GET", "/admin/offices")).body[0];
  const bogota = (await admin.call("POST", "/admin/offices", { name: "Bogotá", city: "Bogotá" })).body;
  const mk = (name, email, role, office) => admin.call("POST", "/admin/users", { name, email, role, office_ids: [office], password: "clave-segura-9" });
  await mk("Laura Bogotá", "laura@firma.co", "Abogado", bogota.id);
  await mk("Andrés Ibagué", "andres@firma.co", "Asistente", ibague.id);
  await mk("Carla Prueba", "carla@firma.co", "Abogado", ibague.id);
  const laura = await t.login("laura@firma.co", "clave-segura-9");
  const andres = await t.login("andres@firma.co", "clave-segura-9");
  const carla = await t.login("carla@firma.co", "clave-segura-9");

  // Directory, presence and the general channel.
  const users = (await laura.call("GET", "/chat/users")).body;
  assert.deepEqual(users.map((u) => u.name).sort(), ["Andrés Ibagué", "Carla Prueba", "Gerente General"]);
  assert.ok(users.every((u) => u.online), "everyone just signed in");
  const list0 = (await laura.call("GET", "/chat/conversations")).body;
  assert.equal(list0.length, 1);
  assert.equal(list0[0].kind, "general");

  // A direct conversation is one per pair, and private.
  const andId = users.find((u) => u.name === "Andrés Ibagué").id;
  const d1 = (await laura.call("POST", "/chat/conversations", { user_id: andId })).body.id;
  const d2 = (await andres.call("POST", "/chat/conversations", { user_id: users.find((u) => u.name === "Andrés Ibagué") && (await andres.call("GET", "/chat/users")).body.find((u) => u.name === "Laura Bogotá").id })).body.id;
  assert.equal(d1, d2);
  assert.equal((await laura.call("POST", "/chat/conversations/" + d1 + "/messages", { body: "Hola Andrés" })).status, 201);
  assert.equal((await carla.call("GET", `/chat/conversations/${d1}/messages`)).status, 404, "a third person cannot read it");
  assert.equal((await admin.call("GET", `/chat/conversations/${d1}/messages`)).status, 404, "nor Gerencia");
  assert.equal((await carla.call("POST", `/chat/conversations/${d1}/messages`, { body: "intruso" })).status, 404);

  // Unread counters and read marks.
  assert.equal((await andres.call("GET", "/chat/unread")).body.unread, 1);
  assert.equal((await laura.call("GET", "/chat/unread")).body.unread, 0);
  const seen = (await andres.call("GET", `/chat/conversations/${d1}/messages`)).body;
  assert.equal(seen.messages[0].body, "Hola Andrés");
  assert.equal((await andres.call("GET", "/chat/unread")).body.unread, 0);
  assert.equal((await laura.call("GET", `/chat/conversations/${d1}/messages?read=0`)).body.other_read_id, seen.messages[0].id);
  // The bell tells the receiver once per unread streak.
  const bell = (await andres.call("GET", "/notifications")).body.items.filter((n) => n.kind === "chat");
  assert.equal(bell.length, 1);
  assert.equal(bell[0].link, `#chat-${d1}`);

  // General channel: mention notifies only the mentioned. Whoever opens the chat later starts with General read.
  await carla.call("GET", "/chat/conversations");
  const gen = list0[0].id;
  await laura.call("POST", `/chat/conversations/${gen}/messages`, { body: "Buenos días @Carla Prueba, ¿revisó el término?" });
  assert.equal((await carla.call("GET", "/notifications")).body.items.some((n) => /mencion/.test(n.title)), true);
  assert.equal((await andres.call("GET", "/notifications")).body.items.some((n) => /mencion/.test(n.title)), false);
  assert.equal((await carla.call("GET", "/chat/unread")).body.unread, 1);

  // Groups.
  const ids = Object.fromEntries((await laura.call("GET", "/chat/users")).body.map((u) => [u.name, u.id]));
  assert.equal((await laura.call("POST", "/chat/conversations", { name: "Laboral", user_ids: [] })).status, 400);
  const grp = (await laura.call("POST", "/chat/conversations", { name: "Laboral", user_ids: [ids["Andrés Ibagué"]] })).body.id;
  assert.equal((await carla.call("GET", `/chat/conversations/${grp}/messages`)).status, 404);
  assert.equal((await andres.call("PUT", `/chat/conversations/${grp}`, { add: [ids["Carla Prueba"]] })).status, 200);
  assert.equal((await carla.call("GET", `/chat/conversations/${grp}/messages`)).status, 200);

  // Links: only to a case the sender may open.
  const cl = (await admin.call("POST", "/clients", { full_name: "Cliente Uno" })).body;
  const cat = (await admin.call("POST", "/categories", { name: "Civil" })).body;
  const ty = (await admin.call("POST", `/categories/${cat.id}/types`, { name: "Ejecutivo" })).body;
  const kBog = (await admin.call("POST", "/cases", { client_id: cl.id, process_type_id: ty.id, office_id: bogota.id, title: "Caso Bogotá" })).body;
  const kIba = (await admin.call("POST", "/cases", { client_id: cl.id, process_type_id: ty.id, office_id: ibague.id, title: "Caso Ibagué" })).body;
  assert.equal((await laura.call("POST", `/chat/conversations/${grp}/messages`, { body: "mire", case_id: kIba.id })).status, 400, "Laura has no access to Ibagué");
  const withLink = await laura.call("POST", `/chat/conversations/${grp}/messages`, { body: "mire este", case_id: kBog.id });
  assert.equal(withLink.status, 201);
  assert.equal(withLink.body.link.case_id, kBog.id);
  assert.match(withLink.body.link.label, /Cliente Uno/);

  // Files: stored, downloadable by members only, size capped.
  const f = await laura.call("POST", `/chat/conversations/${grp}/messages`, { file: { name: "nota.txt", mime: "text/plain", data_base64: Buffer.from("hola").toString("base64") } });
  assert.equal(f.body.file.name, "nota.txt");
  const dl = await fetch(t.base + `/chat/files/${f.body.file.id}`, { headers: { Cookie: carla.cookie } });
  assert.equal(await dl.text(), "hola");
  assert.equal((await fetch(t.base + `/chat/files/${f.body.file.id}`, { headers: { Cookie: (await t.login("laura@firma.co", "clave-segura-9")).cookie } })).status, 200);
  const outsider = await fetch(t.base + `/chat/files/${f.body.file.id}`, { headers: { Cookie: admin.cookie } });
  assert.equal(outsider.status, 404);

  // Edit and retract: only the author; the earlier text is kept.
  const m = (await laura.call("POST", `/chat/conversations/${d1}/messages`, { body: "Texto original" })).body;
  assert.equal((await andres.call("PUT", `/chat/messages/${m.id}`, { body: "robado" })).status, 403);
  const ed = (await laura.call("PUT", `/chat/messages/${m.id}`, { body: "Texto corregido" })).body;
  assert.equal(ed.body, "Texto corregido");
  assert.ok(ed.edited_at);
  assert.deepEqual(JSON.parse(t.db.prepare("SELECT history FROM chat_messages WHERE id = ?").get(m.id).history).map((h) => h.body), ["Texto original"]);
  assert.equal((await andres.call("POST", `/chat/messages/${m.id}/retract`)).status, 403);
  const gone = (await laura.call("POST", `/chat/messages/${m.id}/retract`)).body;
  assert.equal(gone.retracted, true);
  assert.equal(gone.body, "");
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE id = ?").get(m.id).n, 1, "nothing is deleted");

  // Search only inside my conversations.
  assert.equal((await laura.call("GET", "/chat/search?q=término")).body.length, 1);
  assert.equal((await andres.call("GET", "/chat/search?q=Texto original")).body.length, 0);
  assert.equal((await carla.call("GET", "/chat/search?q=Hola Andr")).body.length, 0, "Carla is not in that conversation");

  // Messages never reach the Bitácora.
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE module LIKE '%hat%' OR summary LIKE '%Texto%'").get().n, 0);

  // Video call: start, join, handshake, leave.
  const c1 = (await laura.call("POST", `/chat/conversations/${d1}/call`)).body;
  assert.equal(c1.peers.length, 0);
  assert.ok(c1.ice_servers[0].urls[0].startsWith("stun:"));
  const dm = (await andres.call("GET", "/chat/conversations")).body.find((c) => c.id === d1);
  assert.equal(dm.call.id, c1.call_id);
  assert.equal((await andres.call("GET", "/chat/unread")).body.calling, true);
  assert.equal((await carla.call("POST", `/chat/conversations/${d1}/call`)).status, 404);
  const c2 = (await andres.call("POST", `/chat/conversations/${d1}/call`)).body;
  assert.equal(c2.call_id, c1.call_id);
  assert.deepEqual(c2.peers.map((p) => p.name), ["Laura Bogotá"]);
  const lauraId = c2.peers[0].id;
  assert.equal((await andres.call("POST", `/chat/calls/${c1.call_id}/signal`, { to: lauraId, kind: "offer", payload: { sdp: "x" } })).status, 201);
  const poll = (await laura.call("GET", `/chat/calls/${c1.call_id}/poll`)).body;
  assert.equal(poll.signals[0].kind, "offer");
  assert.equal(poll.participants.length, 2);
  assert.equal((await laura.call("GET", `/chat/calls/${c1.call_id}/poll?since=${poll.signals[0].id}`)).body.signals.length, 0);
  assert.equal((await andres.call("POST", `/chat/calls/${c1.call_id}/signal`, { to: ids["Carla Prueba"], kind: "offer", payload: {} })).status, 404);
  await andres.call("POST", `/chat/calls/${c1.call_id}/leave`);
  await laura.call("POST", `/chat/calls/${c1.call_id}/leave`);
  assert.equal((await andres.call("GET", "/chat/conversations")).body.find((c) => c.id === d1).call, null);
  assert.equal((await laura.call("GET", `/chat/calls/${c1.call_id}/poll`)).body.ended, true);
  t.close();
});

// Timbre (version 2.2.96): one person rings another; it stays until answered.
test("chat timbre", async () => {
  const t = await startServer();
  const admin = await t.setup();
  const ibague = (await admin.call("GET", "/admin/offices")).body[0];
  const mk = (name, email) => admin.call("POST", "/admin/users", { name, email, role: "Asistente", office_ids: [ibague.id], password: "clave-segura-9" });
  await mk("Monica Julieth Salcedo Mendez", "monica@firma.co");
  await mk("Carla Prueba", "carla@firma.co");
  const monica = await t.login("monica@firma.co", "clave-segura-9");
  const carla = await t.login("carla@firma.co", "clave-segura-9");
  const monId = (await carla.call("GET", "/chat/users")).body.find((u) => u.name.startsWith("Monica")).id;
  assert.equal((await carla.call("POST", "/chat/ring", { to: 999999 })).status, 400);
  const k = await carla.call("POST", "/chat/ring", { to: monId });
  assert.equal(k.status, 201);
  assert.equal(k.body.body, "Sube al segundo piso");
  assert.equal((await carla.call("POST", "/chat/ring", { to: monId })).status, 429, "no flooding");
  assert.equal((await carla.call("GET", "/chat/unread")).body.rings.length, 0, "only the target hears it");
  const heard = (await monica.call("GET", "/chat/unread")).body.rings;
  assert.equal(heard.length, 1);
  assert.equal(heard[0].from, "Carla Prueba");
  assert.equal((await carla.call("POST", `/chat/rings/${k.body.id}/seen`)).status, 404, "only the target can answer");
  assert.equal((await monica.call("POST", `/chat/rings/${k.body.id}/seen`)).status, 200);
  assert.equal((await monica.call("GET", "/chat/unread")).body.rings.length, 0);
});
