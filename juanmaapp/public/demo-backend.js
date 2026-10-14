// In-browser stand-in for the Express API, used only by the preview build
// (scripts/build-preview.mjs). Mirrors the routes in src/records.js closely
// enough to click through the app; data lives in this tab (and localStorage
// when available). Draft generation returns a canned sample.
(function () {
  const SEED = window.JUANMA_SEED_CATALOG || [];
  const KEY = "juanmaapp-preview-v1";

  function fresh() {
    const s = { seq: 1, clients: [], categories: [], types: [], fields: [], cases: [] };
    const id = () => s.seq++;
    SEED.forEach(([name, types], i) => {
      const cat = { id: id(), name, sort: i };
      s.categories.push(cat);
      types.forEach((t, j) => s.types.push({ id: id(), category_id: cat.id, name: t, sort: j }));
    });
    const lab = s.categories.find((c) => c.name === "Laboral");
    const adm = s.categories.find((c) => c.name === "Administrativo");
    const juzgado = { id: id(), category_id: lab.id, label: "Juzgado", field_type: "text", options: [], required: false, sort: 0 };
    const radicado = { id: id(), category_id: lab.id, label: "Radicado", field_type: "text", options: [], required: false, sort: 1 };
    const etapa = { id: id(), category_id: adm.id, label: "Etapa", field_type: "select", options: ["Conciliación prejudicial", "Demanda", "Audiencia inicial", "Fallo"], required: false, sort: 0 };
    s.fields.push(juzgado, radicado, etapa);
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const ana = { id: id(), full_name: "Ana María Pérez Gómez", id_type: "CC", id_number: "52.123.456", email: "ana.perez@ejemplo.co", phone: "300 123 4567", address: "Cra 7 # 45-10", city: "Bogotá", notes: "Cliente de ejemplo", created_at: now };
    const luis = { id: id(), full_name: "Luis Fernando Rojas", id_type: "CC", id_number: "79.876.543", email: "luis.rojas@ejemplo.co", phone: "310 987 6543", address: "Calle 50 # 12-30", city: "Medellín", notes: "", created_at: now };
    s.clients.push(ana, luis);
    const typeId = (name) => s.types.find((t) => t.name === name).id;
    s.cases.push(
      { id: id(), client_id: ana.id, process_type_id: typeId("Ejecutivo Laboral"), title: "Cobro de prestaciones sociales", status: "En trámite", counterparty: "Servicios Andinos S.A.S.", facts: "La trabajadora laboró del 1 de febrero de 2023 al 30 de junio de 2026. A la terminación no se le pagaron cesantías ni prima del último semestre.", field_values: { [juzgado.id]: "Juzgado 5 Laboral del Circuito de Bogotá" }, created_at: now, updated_at: now },
      { id: id(), client_id: luis.id, process_type_id: typeId("Medio de Control de Reparación Directa"), title: "Daños por obra pública", status: "Abierto", counterparty: "Alcaldía de Medellín", facts: "El 12 de mayo de 2026 una excavación sin señalizar causó la caída del cliente.", field_values: { [etapa.id]: "Conciliación prejudicial" }, created_at: now, updated_at: now },
      { id: id(), client_id: ana.id, process_type_id: typeId("Reclamo ante la Fuente"), title: "Reporte negativo sin aviso previo", status: "Abierto", counterparty: "Banco de Ejemplo S.A.", facts: "La cliente fue reportada en mora sin la comunicación previa de 20 días.", field_values: {}, created_at: now, updated_at: now },
    );
    return s;
  }

  let s;
  try { s = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { s = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  const fail = (msg) => { throw new Error(msg); };
  const str = (v) => (v == null ? "" : String(v).trim());
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const nextId = () => s.seq++;
  const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

  const caseOut = (k) => {
    const t = s.types.find((t) => t.id === k.process_type_id);
    const c = s.categories.find((c) => c.id === t.category_id);
    const cl = s.clients.find((x) => x.id === k.client_id);
    return clone({ ...k, client_name: cl.full_name, type_name: t.name, category_id: c.id, category_name: c.name });
  };
  const cleanValues = (typeId, values) => {
    const t = s.types.find((t) => t.id === typeId) || fail("El subproceso no existe.");
    const out = {};
    for (const f of s.fields.filter((f) => f.category_id === t.category_id)) {
      const v = str(values?.[f.id]);
      if (f.required && !v) fail(`El campo "${f.label}" es obligatorio.`);
      if (v) out[f.id] = v;
    }
    return out;
  };
  const uniq = (list, name, ignoreId) => list.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== ignoreId) && fail("Ya existe un registro con ese nombre.");
  const CLIENT_FIELDS = ["full_name", "id_type", "id_number", "email", "phone", "address", "city", "notes"];

  const routes = [
    ["GET", /^\/clients(?:\?q=(.*))?$/, (m) => {
      const q = decodeURIComponent(m[1] || "").toLowerCase();
      return s.clients
        .filter((c) => !q || c.full_name.toLowerCase().includes(q) || c.id_number.includes(q))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "es"))
        .map((c) => ({ ...clone(c), case_count: s.cases.filter((k) => k.client_id === c.id).length }));
    }],
    ["POST", /^\/clients$/, (m, b) => {
      const c = { id: nextId(), created_at: stamp() };
      for (const f of CLIENT_FIELDS) c[f] = str(b[f]);
      c.full_name || fail("El nombre del cliente es obligatorio.");
      c.id_type ||= "CC";
      s.clients.push(c);
      return clone(c);
    }],
    ["PUT", /^\/clients\/(\d+)$/, (m, b) => {
      const c = s.clients.find((c) => c.id === +m[1]) || fail("El cliente no existe.");
      for (const f of CLIENT_FIELDS) if (f in b) c[f] = str(b[f]);
      c.full_name || fail("El nombre del cliente es obligatorio.");
      return clone(c);
    }],
    ["DELETE", /^\/clients\/(\d+)$/, (m) => {
      s.cases.some((k) => k.client_id === +m[1]) && fail("No se puede eliminar: tiene expedientes asociados.");
      s.clients = s.clients.filter((c) => c.id !== +m[1]);
      return null;
    }],
    ["GET", /^\/catalog$/, () => s.categories.slice().sort((a, b) => a.sort - b.sort).map((c) => ({
      ...clone(c),
      types: clone(s.types.filter((t) => t.category_id === c.id).sort((a, b) => a.sort - b.sort)),
      fields: clone(s.fields.filter((f) => f.category_id === c.id).sort((a, b) => a.sort - b.sort)),
    }))],
    ["POST", /^\/categories$/, (m, b) => {
      const name = str(b.name) || fail("El nombre es obligatorio.");
      uniq(s.categories, name);
      const c = { id: nextId(), name, sort: s.categories.length };
      s.categories.push(c);
      return clone(c);
    }],
    ["PUT", /^\/categories\/(\d+)$/, (m, b) => {
      const c = s.categories.find((c) => c.id === +m[1]) || fail("El tipo de proceso no existe.");
      const name = str(b.name) || fail("El nombre es obligatorio.");
      uniq(s.categories, name, c.id);
      c.name = name;
      return clone(c);
    }],
    ["DELETE", /^\/categories\/(\d+)$/, (m) => {
      const typeIds = s.types.filter((t) => t.category_id === +m[1]).map((t) => t.id);
      s.cases.some((k) => typeIds.includes(k.process_type_id)) && fail("No se puede eliminar: tiene expedientes asociados.");
      s.categories = s.categories.filter((c) => c.id !== +m[1]);
      s.types = s.types.filter((t) => t.category_id !== +m[1]);
      s.fields = s.fields.filter((f) => f.category_id !== +m[1]);
      return null;
    }],
    ["POST", /^\/categories\/(\d+)\/types$/, (m, b) => {
      const name = str(b.name) || fail("El nombre del subproceso es obligatorio.");
      const siblings = s.types.filter((t) => t.category_id === +m[1]);
      uniq(siblings, name);
      const t = { id: nextId(), category_id: +m[1], name, sort: siblings.length };
      s.types.push(t);
      return clone(t);
    }],
    ["PUT", /^\/types\/(\d+)$/, (m, b) => {
      const t = s.types.find((t) => t.id === +m[1]) || fail("El subproceso no existe.");
      const name = str(b.name) || fail("El nombre es obligatorio.");
      uniq(s.types.filter((x) => x.category_id === t.category_id), name, t.id);
      t.name = name;
      return clone(t);
    }],
    ["DELETE", /^\/types\/(\d+)$/, (m) => {
      s.cases.some((k) => k.process_type_id === +m[1]) && fail("No se puede eliminar: tiene expedientes asociados.");
      s.types = s.types.filter((t) => t.id !== +m[1]);
      return null;
    }],
    ["POST", /^\/categories\/(\d+)\/fields$/, (m, b) => {
      const label = str(b.label) || fail("El nombre del campo es obligatorio.");
      const type = ["text", "textarea", "number", "date", "select"].includes(b.field_type) ? b.field_type : "text";
      const options = type === "select" ? (b.options || []).map(str).filter(Boolean) : [];
      type === "select" && !options.length && fail("Una lista desplegable necesita opciones.");
      const siblings = s.fields.filter((f) => f.category_id === +m[1]);
      siblings.some((f) => f.label.toLowerCase() === label.toLowerCase()) && fail("Ya existe un campo con ese nombre.");
      const f = { id: nextId(), category_id: +m[1], label, field_type: type, options, required: !!b.required, sort: siblings.length };
      s.fields.push(f);
      return clone(f);
    }],
    ["DELETE", /^\/fields\/(\d+)$/, (m) => { s.fields = s.fields.filter((f) => f.id !== +m[1]); return null; }],
    ["GET", /^\/cases(?:\?clientId=(\d+))?$/, (m) => s.cases
      .filter((k) => !m[1] || k.client_id === +m[1])
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(caseOut)],
    ["GET", /^\/cases\/(\d+)$/, (m) => caseOut(s.cases.find((k) => k.id === +m[1]) || fail("El expediente no existe."))],
    ["POST", /^\/cases$/, (m, b) => {
      s.clients.some((c) => c.id === +b.client_id) || fail("El cliente no existe.");
      const k = {
        id: nextId(), client_id: +b.client_id, process_type_id: +b.process_type_id, title: str(b.title),
        status: str(b.status) || "Abierto", counterparty: str(b.counterparty), facts: str(b.facts),
        field_values: cleanValues(+b.process_type_id, b.field_values), created_at: stamp(), updated_at: stamp(),
      };
      s.cases.push(k);
      return caseOut(k);
    }],
    ["PUT", /^\/cases\/(\d+)$/, (m, b) => {
      const k = s.cases.find((k) => k.id === +m[1]) || fail("El expediente no existe.");
      const typeId = +b.process_type_id || k.process_type_id;
      Object.assign(k, {
        process_type_id: typeId, title: str(b.title ?? k.title), status: str(b.status) || k.status,
        counterparty: str(b.counterparty ?? k.counterparty), facts: str(b.facts ?? k.facts),
        field_values: cleanValues(typeId, b.field_values ?? k.field_values), updated_at: stamp(),
      });
      return caseOut(k);
    }],
    ["DELETE", /^\/cases\/(\d+)$/, (m) => { s.cases = s.cases.filter((k) => k.id !== +m[1]); return null; }],
  ];

  const FOOTER = "Draft generated by NomosAI for final review, verification, and execution by the attorney of record.";

  function sampleDraft(p) {
    const k = p.caseId ? caseOut(s.cases.find((k) => k.id === p.caseId)) : null;
    const cl = k ? s.clients.find((c) => c.id === k.client_id) : null;
    const name = cl?.full_name || p.client?.fullName || "**[FILL: Nombre del cliente]**";
    const idn = cl ? `${cl.id_type} ${cl.id_number}` : p.client?.idNumber || "**[FILL: Documento de identidad]**";
    const to = p.counterparty || k?.counterparty || "**[FILL: Entidad destinataria]**";
    const facts = (p.facts || k?.facts || "**[FILL: Hechos]**").split(/(?<=\.)\s+/).filter(Boolean);
    const title = { PETITION: "DERECHO DE PETICIÓN", CONTRACT: "CONTRATO DE PRESTACIÓN DE SERVICIOS", POWER_OF_ATTORNEY: "PODER ESPECIAL" }[p.documentType];
    const txId = p.payment?.required ? "JMA_PREVIEW_" + Math.random().toString(36).slice(2, 7).toUpperCase() : null;
    const doc = [
      `# ${title}`,
      "",
      `**Señores:** ${to}`,
      "",
      ...(k ? [`**Referencia:** ${k.category_name} › ${k.type_name}${k.title ? " — " + k.title : ""}`, ""] : []),
      `${name}, identificado(a) con ${idn}, presenta esta solicitud con base en los siguientes:`,
      "",
      "## HECHOS",
      "",
      ...facts.map((f, i) => `${i + 1}. ${f}`),
      "",
      "## FUNDAMENTOS DE DERECHO",
      "",
      "**[FILL: Fundamento legal a verificar por el abogado]**",
      "",
      ...(txId ? ["## HONORARIOS", "", p.payment.items || "**[FILL: Detalle de honorarios]**", "",
        `Pago seguro: https://checkout.bold.co/payment/link/${txId}`, "",
        "Secure payment processed via Bold Gateway (Credit Card, PSE Debit, or QR Code).", ""] : []),
      "## FIRMA ELECTRÓNICA",
      "",
      "_______________________",
      name,
      "",
      "OTP: [OTP_VERIFICATION_CODE] · Fecha: [TIMESTAMP] · IP: [IP_ADDRESS]",
      "",
      "> Vista previa: este texto es un ejemplo fijo. En la app real lo redacta NomosAI.",
      "",
      FOOTER,
    ].join("\n");
    const fills = [...new Set([...doc.matchAll(/\[FILL:\s*([^\]]+)\]/g)].map((m) => m[1].trim()))];
    return {
      doc,
      done: {
        type: "done", ok: true, document: doc, issues: [], fillFields: fills,
        transactionId: txId, boldLink: txId ? `https://checkout.bold.co/payment/link/${txId}` : null,
        payload: {
          document_type: p.documentType,
          client_data: { full_name: cl?.full_name || p.client?.fullName || "", id_number: cl?.id_number || p.client?.idNumber || "", email: cl?.email || p.client?.email || "" },
          payment_required: !!txId, bold_transaction_id: txId, missing_fields: fills,
        },
      },
    };
  }

  window.JuanmaBackend = {
    async request(method, url, body) {
      for (const [m, re, fn] of routes) {
        const match = m === method && url.match(re);
        if (match) {
          const out = fn(match, body || {});
          if (method !== "GET") save();
          return out;
        }
      }
      throw new Error(`Ruta no disponible en la vista previa: ${method} ${url}`);
    },
    async *generate(payload) {
      const { doc, done } = sampleDraft(payload);
      for (let i = 0; i < doc.length; i += 40) {
        yield { type: "text", text: doc.slice(i, i + 40) };
        await new Promise((r) => setTimeout(r, 12));
      }
      yield done;
    },
    reset() { s = fresh(); save(); },
  };
})();
