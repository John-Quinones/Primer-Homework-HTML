import { test } from "node:test";
import assert from "node:assert/strict";
import { auditDraft, splitSections, AUDIT_FOOTER } from "../src/validate.js";

const goodDoc = `SECTION 1: LEGAL DOCUMENT

# DERECHO DE PETICIÓN

Señores **[FILL: Entidad destinataria]**.

Firma: ______  OTP: [OTP_VERIFICATION_CODE] · [TIMESTAMP] · [IP_ADDRESS]

Pago: https://checkout.bold.co/payment/link/JMA_X1

${AUDIT_FOOTER}

SECTION 2: JSON VARIABLES PAYLOAD

\`\`\`json
{"document_type":"PETITION","client_data":{"full_name":"Ana","id_number":"","email":""},
 "payment_required":true,"bold_transaction_id":"JMA_X1","missing_fields":["Entidad destinataria"]}
\`\`\`
`;

test("splits document and payload", () => {
  const { document, payload, payloadError } = splitSections(goodDoc);
  assert.equal(payloadError, null);
  assert.equal(payload.document_type, "PETITION");
  assert.ok(document.startsWith("# DERECHO DE PETICIÓN"));
  assert.ok(!document.includes("SECTION 2"));
});

test("clean draft passes and lists FILL markers", () => {
  const r = auditDraft(goodDoc, { transactionId: "JMA_X1" });
  assert.deepEqual(r.issues, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fillFields, ["Entidad destinataria"]);
});

test("flags blacklisted phrases in English and Spanish", () => {
  const r = auditDraft(goodDoc.replace("Señores", "Cabe destacar que es crucial. Señores"));
  const hit = r.issues.find((i) => i.code === "FORBIDDEN_PHRASE");
  assert.ok(hit);
  assert.match(hit.detail, /cabe destacar/);
  assert.match(hit.detail, /crucial/);
});

test("does not flag words that merely contain a forbidden token", () => {
  const r = auditDraft(goodDoc.replace("Señores", "Crucialmente no aplica. Señores"));
  assert.equal(r.issues.find((i) => i.code === "FORBIDDEN_PHRASE"), undefined);
});

test("flags missing footer, wrong Bold id and bad JSON", () => {
  const noFooter = goodDoc.replace(AUDIT_FOOTER, "");
  assert.ok(auditDraft(noFooter).issues.some((i) => i.code === "MISSING_AUDIT_FOOTER"));

  const wrongId = auditDraft(goodDoc, { transactionId: "JMA_OTHER" });
  assert.ok(wrongId.issues.some((i) => i.code === "BOLD_ID_MISMATCH"));

  const badJson = auditDraft(goodDoc.replace('"PETITION",', '"PETITION"'));
  assert.ok(badJson.issues.some((i) => i.code === "PAYLOAD_INVALID"));
  assert.equal(badJson.ok, false);
});
