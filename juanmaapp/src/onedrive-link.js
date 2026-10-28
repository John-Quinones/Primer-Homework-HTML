// Version 2.3.7: a OneDrive / SharePoint link for files too big to attach, with the steps the recipient follows to open it.
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const HOSTS = [/^1drv\.ms$/, /^onedrive\.live\.com$/, /^([a-z0-9-]+\.)*sharepoint\.com$/, /^([a-z0-9-]+\.)*onedrive\.com$/];

/** The link as a clean https URL, or "" when empty; throws a Spanish message when it is not a OneDrive/SharePoint address. */
export function cleanOnedriveUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { throw new Error("El enlace de OneDrive no es válido."); }
  if (u.protocol !== "https:" || !HOSTS.some((h) => h.test(u.hostname.toLowerCase()))) throw new Error("El enlace debe ser de OneDrive o SharePoint (1drv.ms, onedrive.live.com o sharepoint.com).");
  return u.href;
}

const steps = (password) => [
  "Haga clic en el botón o enlace «Abrir archivo en OneDrive» (también puede copiar la dirección y pegarla en su navegador).",
  "Se abre una página de OneDrive con el archivo. No necesita instalar nada; si OneDrive le pide una verificación, escriba el correo al que llegó este mensaje y el código que Microsoft le envíe.",
  ...(password ? [`Si le pide contraseña, escriba: ${password}`] : []),
  "Para guardarlo en su equipo pulse «Descargar» (arriba en la página). También puede leerlo en pantalla sin descargarlo.",
  "Si el enlace no abre, responda este correo y se lo hacemos llegar por otro medio.",
];

/** {text, html} to add to a message, or null when there is no link. `od` = {url, name, password}. */
export function onedriveBlock(od) {
  const url = cleanOnedriveUrl(od?.url);
  if (!url) return null;
  const name = String(od?.name ?? "").trim().slice(0, 150), password = String(od?.password ?? "").trim().slice(0, 100);
  const list = steps(password);
  const text = [`Archivo de gran tamaño en OneDrive${name ? `: ${name}` : ""}`, "Por su peso, el archivo no va adjunto a este correo. Para abrirlo:", ...list.map((x, i) => `${i + 1}. ${x}`), `Enlace: ${url}`].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#101010;margin:18px 0;padding:14px 16px;border:1px solid #c4c8cb;border-left:4px solid #027cc6;border-radius:6px">
<p style="margin:0 0 6px"><strong>Archivo de gran tamaño en OneDrive${name ? `: ${esc(name)}` : ""}</strong></p>
<p style="margin:0 0 8px">Por su peso, el archivo no va adjunto a este correo. Para abrirlo:</p>
<ol style="margin:0 0 12px;padding-left:20px">${list.map((x) => `<li style="margin:3px 0">${esc(x)}</li>`).join("")}</ol>
<p style="margin:0"><a href="${esc(url)}" style="display:inline-block;background:#002b6a;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Abrir archivo en OneDrive</a></p>
<p style="margin:8px 0 0;font-size:11px;color:#888;word-break:break-all">${esc(url)}</p></div>`;
  return { text, html, url };
}
