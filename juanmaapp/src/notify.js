// Delivery channels for reminders, reports and e-signature: e-mail through
// Microsoft 365 (Microsoft Graph, MAIL_TRANSPORT=graph) or any SMTP server, and
// WhatsApp through the Meta WhatsApp Business Cloud API (approved templates).
// A channel that is not configured is reported as such; nothing is sent
// silently elsewhere.
import nodemailer from "nodemailer";

const env = process.env;
let transport = null;
let sendWhatsappImpl = null;
let sendSmsImpl = null;

// Microsoft 365 through Graph: the app registration used for sign-in (MS_*) with the
// application permission Mail.Send, limited by Exchange to the MAIL_FROM mailbox.
const graphMail = () => env.MAIL_TRANSPORT === "graph" && !!(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && env.MAIL_FROM);

export function channelsStatus() {
  return {
    email: !!((env.SMTP_HOST || graphMail()) && env.MAIL_FROM),
    email_via: graphMail() ? "Microsoft 365 (Graph)" : env.SMTP_HOST ? `SMTP ${env.SMTP_HOST}` : "",
    whatsapp_otp: !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && env.WHATSAPP_TEMPLATE_OTP),
    whatsapp: !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && env.WHATSAPP_TEMPLATE),
    bold: !!env.BOLD_API_KEY,
    sms: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM),
  };
}

/** Tests replace the transports. */
export function setTransports({ mail, whatsapp, sms } = {}) {
  if (mail) transport = mail;
  if (whatsapp) sendWhatsappImpl = whatsapp;
  if (sms) sendSmsImpl = sms;
}

// Graph accepts the whole message as MIME (base64) up to about 4 MB per request.
export const GRAPH_MAX_MIME = 3.9 * 1024 * 1024 * 3 / 4;
let graphToken = { value: "", until: 0 };
async function graphAccessToken() {
  if (graphToken.value && graphToken.until > Date.now() + 60000) return graphToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft no entregó el permiso para enviar (${data.error_description || data.error || res.status}).`);
  graphToken = { value: data.access_token, until: Date.now() + (Number(data.expires_in) || 3000) * 1000 };
  return graphToken.value;
}
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
/** A nodemailer-like transport that hands the exact MIME message to Microsoft Graph. */
const graphTransport = {
  graph: true,
  async sendMail(mail) {
    const raw = Buffer.from(mail.raw || (await composer.sendMail(mail)).message);
    if (raw.length > GRAPH_MAX_MIME) throw new Error("El mensaje supera el límite de Microsoft 365 (unos 3 MB con anexos). Envíe los anexos solo por enlace.");
    const token = await graphAccessToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MAIL_FROM)}/sendMail`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" }, body: raw.toString("base64"),
    });
    if (res.status !== 202) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`Microsoft 365 respondió ${res.status}: ${data?.error?.message || ""}`.trim());
    }
    const recipients = mail.envelope?.to || [mail.to, mail.cc].flat().filter(Boolean);
    const messageId = (raw.toString("latin1").match(/^Message-ID:\s*(<[^>]+>)/im) || [])[1] || "";
    return { messageId, accepted: [recipients].flat(), rejected: [], response: `202 Accepted · Microsoft 365 (Graph) · ${new Date().toISOString()}` };
  },
};

/** The e-mail transport in use (tests may replace it), or null when e-mail is not configured. */
export function mailTransport() { return mailer(); }

function mailer() {
  if (transport) return transport;
  if (!channelsStatus().email) return null;
  if (graphMail()) return (transport = graphTransport);
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === "1",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transport;
}

export async function sendEmail(to, subject, text, html, attachments = []) {
  const t = mailer();
  if (!t) return { channel: "email", ok: false, detail: "Correo no configurado en el servidor (Microsoft 365 o SMTP)." };
  if (!to) return { channel: "email", ok: false, detail: "El usuario no tiene correo para reportes." };
  try {
    await t.sendMail({ from: env.MAIL_FROM, to, subject, text, html, ...(attachments.length ? { attachments } : {}) });
    return { channel: "email", ok: true, detail: to };
  } catch (err) {
    return { channel: "email", ok: false, detail: `Error SMTP: ${err.message}` };
  }
}

// Business-initiated WhatsApp messages need templates approved by Meta (WhatsApp Manager):
// - WHATSAPP_TEMPLATE (category Utility), one body variable, e.g. "TEC Jurídicos le informa: {{1}} …";
// - WHATSAPP_TEMPLATE_OTP (category Authentication, copy-code button) for e-signature codes.
// Meta refuses variables with line breaks, tabs or more than 4 spaces in a row: they are flattened here.
const flat = (t) => String(t ?? "").replace(/[\r\n\t]+/g, " · ").replace(/ {4,}/g, "   ").replace(/( · )+/g, " · ").trim();
const waNumber = (digits) => (digits.length === 10 ? "57" + digits : digits); // Colombian mobile without country code
async function sendTemplate(digits, name, components) {
  const to = waNumber(digits);
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: env.WHATSAPP_LANG || "es" }, components } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { channel: "whatsapp", ok: false, detail: `WhatsApp respondió ${res.status}: ${data?.error?.message || ""}`.trim() };
    return { channel: "whatsapp", ok: true, detail: "+" + to };
  } catch (err) {
    return { channel: "whatsapp", ok: false, detail: `Error WhatsApp: ${err.message}` };
  }
}

export async function sendWhatsapp(phone, text) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return { channel: "whatsapp", ok: false, detail: "El usuario no tiene número de WhatsApp." };
  if (sendWhatsappImpl) return sendWhatsappImpl(digits, flat(text));
  if (!channelsStatus().whatsapp) return { channel: "whatsapp", ok: false, detail: "WhatsApp no configurado en el servidor." };
  return sendTemplate(digits, env.WHATSAPP_TEMPLATE, [{ type: "body", parameters: [{ type: "text", text: flat(text).slice(0, 1000) }] }]);
}

/** A one-time code: the Authentication template (copy-code button) when configured, else the general template. */
export async function sendWhatsappCode(phone, code, text) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return { channel: "whatsapp", ok: false, detail: "No hay número de celular." };
  if (sendWhatsappImpl) return sendWhatsappImpl(digits, flat(text), code);
  if (!env.WHATSAPP_TEMPLATE_OTP) return sendWhatsapp(phone, text);
  if (!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID)) return { channel: "whatsapp", ok: false, detail: "WhatsApp no configurado en el servidor." };
  return sendTemplate(digits, env.WHATSAPP_TEMPLATE_OTP, [
    { type: "body", parameters: [{ type: "text", text: code }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
  ]);
}

// Text messages (SMS) through Twilio's REST API: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
// and TWILIO_FROM (the sending number, e.g. +1415…, or an approved sender id).
export async function sendSms(phone, text) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return { channel: "sms", ok: false, detail: "No hay número de celular." };
  const to = "+" + (digits.length === 10 ? "57" + digits : digits);
  if (sendSmsImpl) return sendSmsImpl(to, text);
  if (!channelsStatus().sms) return { channel: "sms", ok: false, detail: "Mensajes de texto (SMS) no configurados en el servidor." };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: text.slice(0, 600) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { channel: "sms", ok: false, detail: `SMS respondió ${res.status}: ${data?.message || ""}`.trim() };
    return { channel: "sms", ok: true, detail: to };
  } catch (err) {
    return { channel: "sms", ok: false, detail: `SMS: ${err.message}` };
  }
}

/** Whether a channel can send right now (configured, or replaced by a test transport). */
export function channelReady(channel) {
  if (channel === "sms") return !!sendSmsImpl || channelsStatus().sms;
  if (channel === "whatsapp") return !!sendWhatsappImpl || channelsStatus().whatsapp;
  return !!transport || channelsStatus().email;
}
