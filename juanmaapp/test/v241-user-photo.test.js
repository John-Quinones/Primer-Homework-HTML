import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

// Version 2.41: optional photo of the funcionario (user), same rules as the client photo.
let srv, admin, laura, lauraId, sofiaId, adminId;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const office = (await admin.call("GET", "/admin/offices")).body[0].id;
  lauraId = (await admin.call("POST", "/admin/users", { name: "Laura Gómez", email: "laura@firma.co", role: "Abogado", office_ids: [office], password: "tribunal-azul-2026" })).body.id;
  sofiaId = (await admin.call("POST", "/admin/users", { name: "Sofía Rincón", email: "sofia@firma.co", role: "Abogado", office_ids: [office], password: "tribunal-verde-2026" })).body.id;
  laura = await srv.login("laura@firma.co", "tribunal-azul-2026");
  adminId = (await admin.call("GET", "/auth/status")).body.user.id;
});
after(() => srv.close());

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

test("Gerencia sets, replaces and removes a funcionario's photo; the user's data never changes", async () => {
  const before = (await admin.call("GET", "/admin/users")).body.find((u) => u.id === lauraId);
  assert.equal(before.has_photo, false);

  const set = await admin.call("PUT", `/admin/users/${lauraId}/photo`, { photo: PNG });
  assert.equal(set.status, 200);
  assert.equal(set.body.photo, PNG);
  assert.equal(set.body.has_photo, true);
  assert.equal(set.body.email, "laura@firma.co");
  assert.equal(set.body.role, "Abogado");

  // Lists only say whether there is a photo; any signed-in user can see it (pickers, header).
  const listed = (await admin.call("GET", "/admin/users")).body.find((u) => u.id === lauraId);
  assert.equal(listed.has_photo, true);
  assert.equal(listed.photo, undefined);
  assert.equal((await laura.call("GET", `/admin/users/${lauraId}/photo`)).body.photo, PNG);

  // Editing the user keeps the photo.
  await admin.call("PUT", `/admin/users/${lauraId}`, { phone: "3001234567" });
  assert.equal((await admin.call("GET", `/admin/users/${lauraId}/photo`)).body.photo, PNG);

  assert.equal((await admin.call("PUT", `/admin/users/${lauraId}/photo`, { photo: "data:text/html;base64,PHA+" })).status, 400);
  assert.equal((await admin.call("PUT", `/admin/users/${lauraId}/photo`, { photo: "data:image/png;base64," + "A".repeat(1_600_000) })).status, 400);

  const off = await admin.call("PUT", `/admin/users/${lauraId}/photo`, { photo: "" });
  assert.equal(off.body.has_photo, false);
  assert.equal(off.body.phone, "300 123 4567");

  const log = (await admin.call("GET", "/audit?q=foto")).body;
  assert.ok(log.some((e) => e.changes.some((ch) => ch.label === "Foto" && ch.before === "No" && ch.after === "Sí")));
});

test("each funcionario changes only their own photo, unless they manage users", async () => {
  assert.equal((await laura.call("PUT", `/admin/users/${lauraId}/photo`, { photo: PNG })).status, 200);
  assert.equal((await laura.call("GET", "/auth/status")).body.user.has_photo, true);
  assert.equal((await laura.call("PUT", `/admin/users/${sofiaId}/photo`, { photo: PNG })).status, 403);
  assert.equal((await laura.call("PUT", `/admin/users/${adminId}/photo`, { photo: "" })).status, 403);
  assert.equal((await admin.call("GET", `/admin/users/${sofiaId}/photo`)).body.photo, "");
});
