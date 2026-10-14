// Delivery channels for reminders and process reports: e-mail over SMTP and
// WhatsApp through the Meta WhatsApp Business Cloud API. A channel that is
// not configured is reported as such; nothing is sent silently elsewhere.
import nodemailer from "nodemailer";

const env = process.env;
let transport = null;
let sendWhatsappImpl = null;

export function channelsStatus() {
  return {
    email: !!(env.SMTP_HOST && env.MAIL_FROM),
    whatsapp: !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && env.WHATSAPP_TEMPLATE),
  };
}

/** Tests replace the transports. */
export function setTransports({ mail, whatsapp } = {}) {
  if (mail) transport = mail;
  if (whatsapp) sendWhatsappImpl = whatsapp;
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

export async function sendEmail(to, subject, text, html) {
  const t = mailer();
  if (!t) return { channel: "email", ok: false, detail: "Correo no configurado en el servidor (SMTP)." };
  if (!to) return { channel: "email", ok: false, detail: "El usuario no tiene correo para reportes." };
  try {
    await t.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
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
