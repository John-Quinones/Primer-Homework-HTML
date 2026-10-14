import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDraft, DOCUMENT_TYPES } from "./src/engine.js";
import { auditDraft } from "./src/validate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(here, "public")));
app.get("/vendor/marked.min.js", (_req, res) => res.sendFile(path.join(here, "node_modules/marked/marked.min.js")));
app.get("/vendor/purify.min.js", (_req, res) => res.sendFile(path.join(here, "node_modules/dompurify/dist/purify.min.js")));

app.post("/api/generate", async (req, res) => {
  const body = req.body ?? {};
  if (!DOCUMENT_TYPES[body.documentType]) {
    return res.status(400).json({ error: "documentType must be PETITION, CONTRACT or POWER_OF_ATTORNEY" });
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

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`JuanMaApp listening on http://localhost:${port}`));
