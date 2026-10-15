// Trusted timestamps (RFC 3161). When TSA_URL is set, the SHA-256 of each sent
// e-mail is stamped by that Time Stamping Authority; the reply (.tsr) is kept so
// anyone can verify it later, e.g. `openssl ts -reply -in sello.tsr -text`.
// Accredited Colombian TSAs (ONAC) give the stamp full legal weight.
import { randomBytes } from "node:crypto";

const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const int = (bytes) => tlv(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const SHA256_OID = Buffer.from("0609608648016503040201", "hex");

/** DER TimeStampReq for a SHA-256 digest (hex), asking for the TSA certificate. */
export function timestampRequest(sha256Hex, nonce = randomBytes(8)) {
  const imprint = seq(seq(SHA256_OID, Buffer.from([0x05, 0x00])), tlv(0x04, Buffer.from(sha256Hex, "hex")));
  return seq(int(Buffer.from([1])), imprint, int(nonce), Buffer.from([0x01, 0x01, 0xff]));
}

/** PKIStatus (0 granted, 1 granted with mods) and the token's genTime, read from a TimeStampResp. */
export function readTimestampReply(der) {
  const b = Buffer.from(der);
  const at = b.indexOf(Buffer.from([0x02, 0x01]));
  const status = at >= 0 && at < 12 ? b[at + 2] : null;
  let genTime = null;
  for (let i = 0; i <= b.length - 17; i++) {
    if (b[i] === 0x18 && b[i + 1] >= 15 && b[i + 1] <= 24) {
      const s = b.subarray(i + 2, i + 2 + b[i + 1]).toString("latin1");
      const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/);
      if (m) { genTime = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}${m[7] || ""} UTC`; break; }
    }
  }
  return { status, granted: status === 0 || status === 1, genTime };
}

let fetchImpl = (...a) => fetch(...a);
/** Tests replace the network call. */
export const setTsaFetch = (fn) => { fetchImpl = fn; };

/** Stamp a digest; returns { ok, url, tsr (base64), genTime, detail }. Never throws. */
export async function stamp(sha256Hex) {
  const url = process.env.TSA_URL;
  if (!url) return { ok: false, detail: "Sin sello de tiempo: TSA_URL no está configurado." };
  try {
    const headers = { "Content-Type": "application/timestamp-query" };
    if (process.env.TSA_USER) headers.Authorization = "Basic " + Buffer.from(`${process.env.TSA_USER}:${process.env.TSA_PASS || ""}`).toString("base64");
    const res = await fetchImpl(url, { method: "POST", headers, body: timestampRequest(sha256Hex) });
    const body = Buffer.from(await res.arrayBuffer());
    if (!res.ok) return { ok: false, url, detail: `La TSA respondió ${res.status}.` };
    const r = readTimestampReply(body);
    if (!r.granted) return { ok: false, url, detail: `La TSA no concedió el sello (estado ${r.status}).` };
    return { ok: true, url, tsr: body.toString("base64"), genTime: r.genTime, detail: "" };
  } catch (err) {
    return { ok: false, url, detail: `Sello de tiempo: ${err.message}` };
  }
}
