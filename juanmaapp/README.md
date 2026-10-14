# JuanMaApp

Legal draft generator for paralegals and attorneys, driven by the **NomosAI Engine** system prompt. It drafts Rights of Petition, Contracts and Powers of Attorney, with an e-signature block, an optional Bold payment section, and a JSON payload for downstream Python / Node.js services.

## Run

```bash
cd juanmaapp
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or `ant auth login`
npm start                              # http://localhost:3000
npm test                               # output validator tests
```

Env vars: `PORT` (default 3000), `NOMOS_MODEL` (default `claude-opus-5-5`).

## How it works

| Piece | File |
|---|---|
| NomosAI Engine system prompt (prompt-cached) | `prompts/nomosai-system-prompt.md` |
| Claude call (streaming, effort `high`, server-side refusal fallback) | `src/engine.js` |
| Rule checks on every draft | `src/validate.js` |
| API: `POST /api/generate` → NDJSON stream | `server.js` |
| UI (Spanish) | `public/` |

`src/validate.js` checks each draft instead of trusting the prompt alone. It splits SECTION 1 (Markdown) from SECTION 2 (JSON), parses the payload, and flags:

- blacklisted phrases (English and Spanish)
- a missing human-audit footer
- missing `[OTP_VERIFICATION_CODE]` / `[TIMESTAMP]` / `[IP_ADDRESS]`
- a Bold transaction ID that doesn't match the one the server issued

It also lists every `[FILL: …]` marker, and the UI highlights them in the draft.

### `POST /api/generate`

```json
{
  "documentType": "PETITION | CONTRACT | POWER_OF_ATTORNEY",
  "language": "Spanish",
  "jurisdiction": "Colombia",
  "client": { "fullName": "", "idNumber": "", "email": "", "address": "" },
  "counterparty": "",
  "facts": "",
  "payment": { "required": true, "items": "Redacción: COP 350.000" }
}
```

The response is newline-delimited JSON. It sends `{"type":"text","text":…}` deltas, then one `{"type":"done", document, payload, fillFields, issues, ok, transactionId, boldLink}` or one `{"type":"error", error}`.

## Pending before production

- **Brand.** `public/brand.css` uses colors sampled from the brand image (`image.png` at the repo root): navy `#002E6E`, blue `#017BC5`, mid blue `#01569B`, silver `#ADAEB2`, black `#101010`. The wordmark font is approximated with Michroma. Swap in the exact values and font from the PDF manual if they differ; no other file hard-codes a color or font.
- **Bold.** The server generates the transaction reference (`JMA_…`) and builds the link in the format the prompt specifies: `https://checkout.bold.co/payment/link/<id>`. It does **not** yet create the payment link through Bold's API. Wire that in with the merchant's Bold credentials so the link resolves.
- **E-signature.** `[OTP_VERIFICATION_CODE]`, `[TIMESTAMP]` and `[IP_ADDRESS]` stay as placeholders for your e-signature provider to fill at signing time.
- **Legal review.** Every draft carries the audit footer and must be reviewed by the attorney of record. Legal citations the model isn't sure of come back as `[FILL: …]` markers. They are never invented.
