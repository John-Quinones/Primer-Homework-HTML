// Delivery channels for reminders and process reports: e-mail over SMTP and
// WhatsApp through the Meta WhatsApp Business Cloud API. A channel that is
// not configured is reported as such; nothing is sent silently elsewhere.
import nodemailer from "nodemailer";

const env = process.env;
let transport = null;
let sendWhatsappImpl = null;
let sendSmsImpl = null;

export function channelsStatus() {
  return {
    email: !!(env.SMTP_HOST && env.MAIL_FROM),
    whatsapp: !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && env.WHATSAPP_TEMPLATE),
    sms: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM),
  };
}

/** Tests replace the transports. */
export function setTransports({ mail, whatsapp, sms } = {}) {
  if (mail) transport = mail;
  if (whatsapp) sendWhatsappImpl = whatsapp;
  if (sms) sendSmsImpl = sms;
}

function mailer() {
  if (transport) return transport;
  if (!channelsStatus().email) return null;
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
  if (!t) return { channel: "email", ok: false, detail: "Correo no configurado en el servidor (SMTP)." };
  if (!to) return { channel: "email", ok: false, detail: "El usuario no tiene correo para reportes." };
  try {
    await t.sendMail({ from: env.MAIL_FROM, to, subject, text, html, ...(attachments.length ? { attachments } : {}) });
    return { channel: "email", ok: true, detail: to };
  } catch (err) {
    return { channel: "email", ok: false, detail: `Error SMTP: ${err.message}` };
  }
}

// Business-initiated WhatsApp messages need a template approved by Meta. The
// template takes one body parameter: the report text (WhatsApp caps it).
export async function sendWhatsapp(phone, text) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return { channel: "whatsapp", ok: false, detail: "El usuario no tiene número de WhatsApp." };
  if (sendWhatsappImpl) return sendWhatsappImpl(digits, text);
  if (!channelsStatus().whatsapp) return { channel: "whatsapp", ok: false, detail: "WhatsApp no configurado en el servidor." };
  const to = digits.length === 10 ? "57" + digits : digits; // Colombian mobile without country code
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: {
          name: env.WHATSAPP_TEMPLATE, language: { code: env.WHATSAPP_LANG || "es" },
          components: [{ type: "body", parameters: [{ type: "text", text: text.slice(0, 1000) }] }],
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { channel: "whatsapp", ok: false, detail: `WhatsApp respondió ${res.status}: ${data?.error?.message || ""}`.trim() };
    return { channel: "whatsapp", ok: true, detail: "+" + to };
  } catch (err) {
    return { channel: "whatsapp", ok: false, detail: `Error WhatsApp: ${err.message}` };
  }
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
