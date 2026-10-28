// Version 2.2.90: «Solicitud link de expediente», an HTML letter inside Memorial › Solicitud de link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { readFileSync } from "node:fs";

globalThis.window = globalThis;
import { letterFields, signerView } from "../src/solicitud-link-letter.js";
window.JuanmaSolicitudLink = { letterFields, signerView };
await import("../public/html-template.js");
const H = window.JuanmaHtmlTemplate;

test("the letter arrives once, as a memorial of the category «Solicitud de link»", () => {
  const db = openDb(":memory:");
  const t = db.prepare("SELECT t.*, c.title AS cat FROM document_templates t LEFT JOIN memorial_categories c ON c.id = t.memorial_category_id WHERE t.name = 'Solicitud link de expediente'").get();
  assert.equal(t.category, "Memorial");
  assert.equal(t.cat, "Solicitud de link");
  assert.ok(H.isHtml(t.body));
  assert.match(t.body, /data:image\/png;base64,/);
  assert.doesNotMatch(t.body, /@@/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM document_templates WHERE name = 'Solicitud link de expediente'").get().n, 1);
});

test("fill: values are escaped and a missing one is a highlighted [FILL: …]", () => {
  const html = H.fill("<!--tj-html-->\n<p>{{demandante}} / {{tipo_actuacion}}</p>", { demandante: "A & <B>" });
  assert.match(html, /A &amp; &lt;B&gt;/);
  assert.match(html, /<mark class="fill">\[FILL: Tipo de actuación/);
});

test("fromCase maps the case's data to the letter's own names", () => {
  const v = H.fromCase({ "fecha.hoy": "27 de octubre de 2026", "expediente.juez": "Yolanda Vargas", "expediente.despacho": "Juzgado 3 Civil", "expediente.radicado": "73001-40-03-003-2026-00312-00",
    "cliente.nombre": "Alirio Guzmán", "cliente.calidad_sola": "demandante" }, "JFQ",
    { legal_name: "John Fredy Quiñones Montaña", id_number: "17418999", professional_card: "150081", email: "gerencia@tecjuridicos.com" });
  assert.equal(v.ciudad, "Ibagué");
  assert.equal(v.nombre_juez_o_doctora, "YOLANDA VARGAS");
  assert.equal(v.numero_radicado, "73-001-40-03-003-2026-00312-00");
  assert.equal(v.nombre_abogado, "JOHN FREDY QUIÑONES MONTAÑA");
  assert.equal(v.firma_cc, "CC. 17418999");
  assert.equal(v.firma_tarjeta, "Tarjeta Profesional No. 150.081 del C. S. de la J.");
  assert.equal(v.demandante, "Alirio Guzmán");
  assert.equal(v.elaboro, "JFQ");
});

test("the template names every variable John asked for", () => {
  const body = readFileSync(new URL("../src/plantillas/solicitud-link-expediente.html", import.meta.url), "utf8");
  for (const k of ["ciudad", "fecha_solicitud", "nombre_juez_o_doctora", "cargo_despacho", "correo_juzgado", "ciudad_juzgado", "tipo_actuacion", "demandante", "demandado", "numero_radicado", "nombre_abogado", "nombre_cliente", "cliente_del_senor", "firma_nombre", "firma_cc", "firma_tarjeta", "firma_contacto", "firma_fecha"])
    assert.ok(body.includes(`{{${k}}}`), k);
  assert.match(body, /print-color-adjust:\s*exact/);
  assert.match(body, /Carrera 5 No\. 29-32 Of\.290 Centro Comercial La Quinta/);
  assert.doesNotMatch(body, /Yo,/);
});

test("the starter letter takes the new design only while it is exactly the one 2.2.90 seeded", async () => {
  const { createHash } = await import("node:crypto");
  const { SLINK_V1_SHA, SEED_TEMPLATES } = await import("../src/templates-seed.js");
  const { seedTemplates } = await import("../src/templates.js");
  const old = readFileSync(new URL("./fixtures/solicitud-link-v1.html", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(old).digest("hex"), SLINK_V1_SHA);
  const db = openDb(":memory:");
  const name = "Solicitud link de expediente", flag = () => db.prepare("DELETE FROM app_flags WHERE key = 'template-slink-v2'").run();
  const body = () => db.prepare("SELECT body FROM document_templates WHERE name = ?").get(name).body;
  db.prepare("UPDATE document_templates SET body = ? WHERE name = ?").run(old, name);
  flag(); seedTemplates(db);
  assert.equal(body(), SEED_TEMPLATES.find((t) => t.name === name).body);
  db.prepare("UPDATE document_templates SET body = ? WHERE name = ?").run(old + "<!-- editada por Gerencia -->", name);
  flag(); seedTemplates(db);
  assert.match(body(), /editada por Gerencia/);
});
