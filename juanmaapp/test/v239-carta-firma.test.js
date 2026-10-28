// Version 2.3.9: the letter of «Firmar y enviar por correo» (letterhead of the firm, filled by the user).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = {};
await import("../public/carta-firma-tpl.js");
await import("../public/carta-firma.js");
const C = window.JuanmaCartaFirma;
const data = { ciudad: "Ibagué", fecha: "28 de octubre de 2026", destinatario: "Ministerio de Educación Nacional\nBogotá D.C.\n\nFondo Nacional de Prestaciones Sociales del Magisterio\nnotificaciones@fomag.gov.co",
  atencion: "Dra. Ana <Pérez>", titulo: "Derecho de petición", referencia: "Peticionario: Juan & Cía\nRadicado: 00123\nsin etiqueta", cuerpo: "Cordial saludo.\n\nPárrafo dos\ncon salto.", elaboro: "JQ" };

test("missing lists the required fields still empty", () => {
  assert.deepEqual(C.missing({}), ["Ciudad", "Fecha", "Entidad destinataria", "Texto de la carta"]);
  assert.deepEqual(C.missing(data), []);
});

test("build keeps the letterhead as is, writes entities in capitals, escapes the data and leaves the signature space", () => {
  const h = C.build(data);
  assert.match(h, /<p class="lugar">Ibagué, 28 de octubre de 2026<\/p>/);
  assert.match(h, /MINISTERIO DE EDUCACIÓN NACIONAL/);
  assert.match(h, /FONDO NACIONAL DE PRESTACIONES SOCIALES DEL MAGISTERIO/);
  assert.match(h, /<p class="correo">notificaciones@fomag\.gov\.co<\/p>/);
  assert.equal((h.match(/class="grupo"/g) || []).length, 2);
  assert.match(h, /Dra\. Ana &lt;Pérez&gt;/);
  assert.match(h, /<dt>Peticionario<\/dt><dd>Juan &amp; Cía<\/dd>/);
  assert.match(h, /<dt><\/dt><dd>sin etiqueta<\/dd>/);
  assert.match(h, /<p>Párrafo dos<br>con salto\.<\/p>/);
  assert.match(h, /class="espacio-firma"/);
  assert.match(h, /Elaboró: JQ/);
  assert.doesNotMatch(h, /@@|\{\{/);
  // the header and the footer are the ones of «Solicitud link de expediente»
  const slink = readFileSync(new URL("../src/plantillas/solicitud-link-expediente.html", import.meta.url), "utf8");
  const part = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b));
  assert.equal(part(readFileSync(new URL("../src/plantillas/carta-firma-correo.html", import.meta.url), "utf8"), "<footer", "</footer>"), part(slink, "<footer", "</footer>"));
});

test("a missing field shows as a yellow [FILL: …]; the reference box is left out when empty", () => {
  const h = C.build({ ...data, destinatario: "", fecha: "", titulo: "", referencia: "" });
  assert.match(h, /\[FILL: Entidad destinataria\]/);
  assert.match(h, /Ibagué, <mark class="fill">\[FILL: Fecha\]<\/mark>/);
  assert.doesNotMatch(h, /<section class="asunto">/);
});

test("the default text names the signer in capitals", () => {
  assert.match(C.defaultBody("John Quiñones"), /^Cordial saludo\.\n\nJOHN QUIÑONES, identificado civil y profesionalmente como aparece al final en la firma electrónica/);
});
