// The address used in links sent by e-mail (password reset, invitations, signing, receipts).
// Never taken from the request's Host header in production: an attacker could otherwise make
// the app mail a link to their own site (audit A07-004). Azure sets WEBSITE_HOSTNAME itself.
export function publicBase(req) {
  const fixed = process.env.PUBLIC_URL || (process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}` : "");
  if (fixed) return fixed.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("Falta configurar PUBLIC_URL en el servidor.");
  return `${req.protocol}://${req.get("host")}`;
}
