import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

test("the client photo is optional: added, replaced, removed and logged; the other data never changes", async () => {
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Marta", last_names: "León", id_type: "CC", id_number: "52999111", phone: "3001234567", office_id: office })).body;
  assert.equal(c.has_photo, false);
  assert.equal(c.photo, "");

  const set = await admin.call("PUT", `/clients/${c.id}/photo`, { photo: PNG });
  assert.equal(set.status, 200);
  assert.equal(set.body.photo, PNG);
  assert.equal(set.body.phone, c.phone);
  assert.equal(set.body.full_name, c.full_name);

  // Lists only say whether there is a photo, so they stay light.
  const listed = (await admin.call("GET", "/clients")).body.find((x) => x.id === c.id);
  assert.equal(!!listed.has_photo, true);
  assert.equal(listed.photo, undefined);

  // Editing the client's data keeps the photo.
  await admin.call("PUT", `/clients/${c.id}`, { ...c, notes: "Llamar en la tarde" });
  assert.equal((await admin.call("GET", `/clients/${c.id}`)).body.photo, PNG);

  assert.equal((await admin.call("PUT", `/clients/${c.id}/photo`, { photo: "data:text/html;base64,PHA+" })).status, 400);
  assert.equal((await admin.call("PUT", `/clients/${c.id}/photo`, { photo: "data:image/png;base64," + "A".repeat(1_600_000) })).status, 400);

  const off = await admin.call("PUT", `/clients/${c.id}/photo`, { photo: "" });
  assert.equal(off.body.has_photo, false);
  assert.equal(off.body.notes, "Llamar en la tarde");

  const log = (await admin.call("GET", "/audit?q=foto")).body;
  assert.ok(log.some((e) => e.changes.some((ch) => ch.label === "Foto" && ch.before === "No" && ch.after === "Sí")));
});
