import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDraft, DOCUMENT_TYPES } from "./engine.js";
import { auditDraft } from "./validate.js";
import { recordsRouter } from "./records.js";
import { jurisprudenceRouter } from "./jurisprudence-routes.js";
import { sessionMiddleware, authRouter, adminRouter, requireAuth, requirePerm, scopeOf } from "./auth.js";
import { reportsRouter } from "./reports.js";
import { courtsRouter } from "./courts.js";
import { agendaRouter } from "./agenda-routes.js";
import { monitorRouter } from "./monitor-routes.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Fill a draft request from a stored case: client data, process and custom fields. */
function caseContext(db, caseId, user) {
  const k = db.prepare(`
    SELECT k.*, t.name AS type_name, t.category_id, g.name AS category_name
    FROM cases k
    JOIN process_types t ON t.id = k.process_type_id
    JOIN process_categories g ON g.id = t.category_id
    WHERE k.id = ?`).get(caseId);
  const sc = scopeOf(user);
  if (!k || (sc !== null && !sc.includes(k.office_id))) return null;
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
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.use(sessionMiddleware(db));
  app.use(express.static(path.join(root, "public")));
  app.get("/vendor/marked.min.js", (_req, res) => res.sendFile(path.join(root, "node_modules/marked/marked.min.js")));
  app.get("/vendor/read-excel-file.min.js", (_req, res) =>
    res.sendFile(path.join(root, "node_modules/read-excel-file/bundle/read-excel-file.min.js")));
  app.get("/vendor/write-excel-file.min.js", (_req, res) => res.sendFile(path.join(root, "node_modules/write-excel-file/bundle/write-excel-file.min.js")));
  app.get("/vendor/jspdf.umd.min.js", (_req, res) => res.sendFile(path.join(root, "node_modules/jspdf/dist/jspdf.umd.min.js")));
  app.get("/vendor/jspdf.plugin.autotable.min.js", (_req, res) => res.sendFile(path.join(root, "node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.min.js")));
  app.get("/vendor/purify.min.js", (_req, res) => res.sendFile(path.join(root, "node_modules/dompurify/dist/purify.min.js")));

  app.use("/api/auth", authRouter(db));
  app.use("/api", requireAuth);
  app.use("/api/admin", adminRouter(db));
  app.use("/api", recordsRouter(db));
  app.use("/api/jurisprudencia", requirePerm("jurisprudence.use"), jurisprudenceRouter(db));
  app.use("/api/reports", requirePerm("reports.view"), reportsRouter(db));
  app.use("/api/courts", courtsRouter(db));
  app.use("/api", agendaRouter(db));
  app.use("/api/monitor", requirePerm("processes.consult"), monitorRouter(db));

  app.post("/api/generate", requirePerm("drafts.generate"), async (req, res) => {
    let body = req.body ?? {};
    if (!DOCUMENT_TYPES[body.documentType]) {
      return res.status(400).json({ error: "documentType must be PETITION, CONTRACT or POWER_OF_ATTORNEY" });
    }
    if (body.caseId) {
      const ctx = caseContext(db, Number(body.caseId), req.user);
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
      if (/authentication method/i.test(err.message || "")) message = "El servidor no tiene configurada la clave de Anthropic (ANTHROPIC_API_KEY).";
      else if (err instanceof Anthropic.AuthenticationError) message = "Invalid or missing Anthropic API key.";
      else if (err instanceof Anthropic.RateLimitError) message = "Rate limited. Try again in a moment.";
      else if (err instanceof Anthropic.BadRequestError) message = `Bad request: ${err.message}`;
      else if (err instanceof Anthropic.APIError) message = `API error ${err.status}: ${err.message}`;
      else if (err instanceof Error) message = err.message;
      console.error(err);
      send({ type: "error", error: message });
    }
    res.end();
  });

  // Anything unexpected answers JSON, never the default HTML error page.
  app.use((err, req, res, _next) => {
    console.error(err);
    if (res.headersSent) return res.end();
    res.status(err.status || 500).json({ error: err.expose ? err.message : "Error interno del servidor." });
  });

  return app;
}
