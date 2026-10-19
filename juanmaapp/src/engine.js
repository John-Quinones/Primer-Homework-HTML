import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recipientPrompt } from "./case-meta.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(path.join(here, "..", "prompts", "nomosai-system-prompt.md"), "utf8");

// Version 2.49 (user's rule): drafts are written with Claude Haiku 5.5, the
// lowest-priced model; NOMOS_MODEL can choose another one.
export const MODEL = process.env.NOMOS_MODEL || "claude-haiku-5-5";
// Claude Haiku has no server-side fallback after a refusal; the larger models do.
const HAS_FALLBACK = !/^claude-haiku/.test(MODEL);
const client = new Anthropic();

export const DOCUMENT_TYPES = {
  PETITION: "Right of Petition (administrative / constitutional)",
  CONTRACT: "Contract / Agreement",
  POWER_OF_ATTORNEY: "Power of Attorney (special or general)",
  LAWSUIT: "Lawsuit (Demanda)",
};

/** Reference sent to Bold. Generated server-side so the model never invents one. */
export function newTransactionId() {
  return `JMA_${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString("hex").toUpperCase()}`;
}

function buildUserMessage(req, transactionId) {
  const lines = [
    `Document type: ${req.documentType} — ${DOCUMENT_TYPES[req.documentType]}`,
    `Output language: ${req.language || "Spanish"}`,
    `Jurisdiction: ${req.jurisdiction || "[not provided]"}`,
    "",
    "Client:",
    `- Full name: ${req.client?.fullName || "[not provided]"}`,
    `- ID number: ${req.client?.idNumber || "[not provided]"}`,
    `- Email: ${req.client?.email || "[not provided]"}`,
    `- Address: ${req.client?.address || "[not provided]"}`,
    "",
    `Counterparty / addressee: ${req.counterparty || "[not provided]"}`,
    ...recipientPrompt(req.recipient),
    "",
  ];
  if (req.process) {
    lines.push(
      `Process: ${req.process.category} › ${req.process.type}${req.process.title ? ` (${req.process.title})` : ""}`,
      ...req.process.fields.map((f) => `- ${f.label}: ${f.value}`),
      "",
    );
  }
  lines.push(
    "Case facts and instructions from the paralegal or attorney:",
    req.facts || "[not provided]",
    "",
  );
  if (typeof req.template === "string" && req.template.trim()) {
    lines.push(
      "Base template from the firm (keep its structure and wording):",
      "<<<TEMPLATE",
      req.template.slice(0, 60000),
      "TEMPLATE>>>",
      "",
    );
  }
  if (req.payment?.required) {
    lines.push(
      "Fees: payment IS required.",
      `Itemized fees: ${req.payment.items || "[not provided]"}`,
      `Bold transaction ID (use exactly this value): ${transactionId}`,
    );
  } else {
    lines.push("Fees: no payment section required. Set payment_required to false.");
  }
  return lines.join("\n");
}

/**
 * Stream a draft. Calls onText for each text delta and resolves with the
 * final text plus metadata once the message completes.
 */
export async function generateDraft(req, { onText } = {}) {
  const transactionId = req.payment?.required ? newTransactionId() : null;

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    ...(HAS_FALLBACK ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    output_config: { effort: "high" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserMessage(req, transactionId) }],
  });

  if (onText) stream.on("text", (delta) => onText(delta));
  const message = await stream.finalMessage();

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    text,
    transactionId,
    stopReason: message.stop_reason,
    stopDetails: message.stop_details ?? null,
    servedBy: message.model,
    usage: message.usage,
  };
}
