// Small helpers shared by the API routers: reading request values and
// answering with errors written for the user.

/** Request value as trimmed text ("" for null/undefined). */
export const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

/** An error whose message is meant for the user, answered with its HTTP status. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

/** Positive integer id from the request, or a 400 naming the field. */
export function toInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${label} no es válido.`);
  return n;
}
