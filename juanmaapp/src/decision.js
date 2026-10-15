// The decision (auto or sentencia) behind each actuación of the Rama Judicial,
// read from the actuación's name and annotation. Shared by the server and the
// published link (served in /shared.js). Nothing is invented: when the
// annotation has no text beyond the registration stamp, only the name is used.

const SENTENCIA = /\b(sentencia|fallo)\b/i;
const AUTO = /\b(auto|providencia|mandamiento|resuelve|admite|inadmite|rechaza|niega|concede|decreta|ordena|aprueba|imprueba|libra|declara|fija fecha|se[nñ]ala fecha|requiere|termina|archiva|levanta|suspende|reanuda|acepta|tiene por|corre traslado)\b/i;
// Notices that publish a decision taken in an earlier actuación.
const NOTICE = /\b(fijaci[oó]n (de )?estado|estado electr[oó]nico|notificaci[oó]n por estado|edicto|aviso)\b/i;
// Records that are not decisions even if they mention one.
const NOT_DECISION = /^(recepci[oó]n|radicaci[oó]n|reparto|al despacho|memorial|constancia|oficio|env[ií]o|entrega|cambio de|registro|agregar|anexo|correo|devoluci[oó]n|se recibe)/i;
// Annotations that only say when the record was made.
const STAMP = /^actuaci[oó]n registrada el \d{1,2}\/\d{1,2}\/\d{4}( a las [\d:]+(\s*[ap]\.?\s*m\.?)?)?\.?$/i;

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const sentence = (s) => (s ? s.charAt(0).toLocaleUpperCase("es") + s.slice(1).toLocaleLowerCase("es") : "");

/** { kind: "Sentencia" | "Auto", text } for an actuación that is a decision, else null. */
export function decisionOf(a) {
  const name = clean(a?.actuacion);
  const note = clean(a?.anotacion);
  const useful = note && !STAMP.test(note) ? note : "";
  if (!name || NOTICE.test(name) || NOT_DECISION.test(name)) return null;
  const all = `${name} ${useful}`;
  const kind = SENTENCIA.test(all) ? "Sentencia" : AUTO.test(all) ? "Auto" : null;
  if (!kind) return null;
  return { kind, text: useful ? `${sentence(name)}: ${useful}` : sentence(name) };
}

/**
 * Adds `decision`, `decision_kind` and `notified` to each actuación. A notice
 * (fijación de estado, edicto, aviso) points to the latest decision dated on
 * or before it, within 15 days; that decision is marked as notified.
 */
export function withDecisions(acts) {
  const out = acts.map((a) => {
    const d = decisionOf(a);
    return { ...a, decision: d?.text ?? "", decision_kind: d?.kind ?? "", notified: "" };
  });
  const days = (x) => Date.parse(String(x).slice(0, 10) + "T00:00:00Z") / 86400000;
  for (const n of out) {
    if (!NOTICE.test(clean(n.actuacion))) continue;
    const at = days(n.fecha);
    const prev = out
      .filter((d) => d.decision && d.fecha && days(d.fecha) <= at && at - days(d.fecha) <= 15)
      .sort((x, y) => y.fecha.localeCompare(x.fecha))[0];
    if (!prev) continue;
    n.decision = prev.decision;
    n.decision_kind = prev.decision_kind;
    n.notified = `${sentence(clean(n.actuacion))} ${n.fecha_inicial || n.fecha}`;
    prev.notified ||= n.notified;
  }
  return out;
}
