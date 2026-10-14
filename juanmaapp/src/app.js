import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDraft, DOCUMENT_TYPES } from "./engine.js";
import { auditDraft } from "./validate.js";
import { recordsRouter } from "./records.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Fill a draft request from a stored case: client data, process and custom fields. */
function caseContext(db, caseId) {
  const k = db.prepare(`
    SELECT k.*, t.name AS type_name, t.category_id, g.name AS category_name
    FROM cases k
    JOIN process_types t ON t.id = k.process_type_id
    JOIN process_categories g ON g.id = t.category_id
    WHERE k.id = ?`).get(caseId);
  if (!k) return null;
  const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(k.client_id);
  const values = JSON.parse(k.field_values);
  const fields = db.prepare("SELECT * FROM custom_fields WHERE category_id = ? ORDER BY sort, id").all(k.category_id)
    .filter((f) => values[f.id])
    .map((f) => ({ label: f.label, value: values[f.id] }));
  return {
    client: {
      fullName: c.full_name,
      idNumber: [c.id_type, c.id_number].filter(Boolean).join(" "),
      email: c.email,
      address: [c.address, c.city].filter(Boolean).join(", "),
    },
    counterparty: k.counterparty,
    facts: k.facts,
    process: { category: k.category_name, type: k.type_name, title: k.title, fields },
  };
}

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: "200kb" }));
  app.use(express.static(path.join(root, "public")));
  app.get("/vendor/marked.min.js", (_req, res) => res.sendFile(path.join(root, "node_modules/marked/marked.min.js")));
  app.get("/vendor/purify.min.js", (_req, res) => res.sendFile(path.join(root, "node_modules/dompurify/dist/purify.min.js")));

  app.use("/api", recordsRouter(db));

  app.post("/api/generate", async (req, res) => {
    let body = req.body ?? {};
    if (!DOCUMENT_TYPES[body.documentType]) {
      return res.status(400).json({ error: "documentType must be PETITION, CONTRACT or POWER_OF_ATTORNEY" });
    }
    if (body.caseId) {
      const ctx = caseContext(db, Number(body.caseId));
      if (!ctx) return res.status(404).json({ error: "El expediente no existe." });
      // Form values typed by the user win over stored ones.
      body = {
        ...body,
        client: { ...ctx.client, ...Object.fromEntries(Object.entries(body.client ?? {}).filter(([, v]) => v)) },
        counterparty: body.counterparty || ctx.counterparty,
        facts: body.facts || ctx.facts,
        process: ctx.process,
      };
    }

    // NDJSON stream: {type:"text"} deltas, then one {type:"done"} or {type:"error"}.
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    const send = (obj) => res.write(JSON.stringify(obj) + "\n");

    try {
      const result = await generateDraft(body, { onText: (text) => send({ type: "text", text }) });

      if (result.stopReason === "refusal") {
        send({ type: "error", error: "The model declined this request.", details: result.stopDetails });
        return res.end();
      }

      const audit = auditDraft(result.text, { transactionId: result.transactionId });
      if (result.stopReason === "max_tokens") {
        audit.issues.push({ level: "error", code: "TRUNCATED", detail: "Output hit max_tokens." });
        audit.ok = false;
      }
      send({
        type: "done",
        transactionId: result.transactionId,
        boldLink: result.transactionId ? `https://checkout.bold.co/payment/link/${result.transactionId}` : null,
        servedBy: result.servedBy,
        ...audit,
      });
    } catch (err) {
      let message = "Unexpected error.";
      if (err instanceof Anthropic.AuthenticationError) message = "Invalid or missing Anthropic API key.";
      else if (err instanceof Anthropic.RateLimitError) message = "Rate limited. Try again in a moment.";
      else if (err instanceof Anthropic.BadRequestError) message = `Bad request: ${err.message}`;
      else if (err instanceof Anthropic.APIError) message = `API error ${err.status}: ${err.message}`;
      else if (err instanceof Error) message = err.message;
      console.error(err);
      send({ type: "error", error: message });
    }
    res.end();
  });

  return app;
}
