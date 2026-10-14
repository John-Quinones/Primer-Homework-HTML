// In-browser backend for the published link (and a local copy of the file).
// It mirrors the server's routes, roles and office scope. The firm's data is
// real and persists through web-store.js (the link's database on claude.ai,
// or this browser's storage). NomosAI drafts and sentence analysis use the
// viewer's Claude account. What needs the internet or sending e-mail (Rama
// Judicial, official case-law sites, e-mailed signature links, traced
// e-mail) answers with a clear message instead of made-up results.
(function () {
  const SEED = window.JUANMA_SEED_CATALOG || [];
  const AUTH = window.JUANMA_AUTH || { roles: [], permissions: {}, matrix: {} };
  const REPORTS = window.JUANMA_REPORTS || {};
  const TPL = window.JUANMA_TEMPLATES || { seed: [], categories: [], variables: [] };
  const AREAS = window.JUANMA_AREAS || [];
  const DIV = window.JUANMA_DIVIPOLA || { departamentos: [], municipios: [] };
  const CM = window.JuanmaCaseMeta;
  const LG = window.JuanmaLedger;
  const OPEN = ["Activo"];
  const ARCHIVED = ["Archivo provisional", "Archivo definitivo"];
  const partyRole = (x) => { const r = CM.normPartyRole(x); r === null && fail(`Calidad del cliente no válida: ${x}`); return r; };

  // A clean start: the main office, the process catalog and the starter templates. No sample people or cases.
  function fresh() {
    const now = stamp();
    const st = { offices: [], users: [], matrix: JSON.parse(JSON.stringify(AUTH.matrix)), roles: AUTH.roles.map((name) => ({ name, builtin: true })),
      clients: [], categories: [], types: [], fields: [], cases: [], saved: [], courts: [], tasks: [], notes: [], acts: [], checks: [],
      prefs: {}, log: [], templates: [], signs: [], blobs: {}, info: { created: now } };
    st.offices.push({ id: nextId(), name: "Ibagué", department: "Tolima", city: "Ibagué", address: "", phone: "", email: "", is_main: true });
    SEED.forEach(([name, types], i) => {
      const cat = { id: nextId(), name, sort: i };
      st.categories.push(cat);
      types.forEach((t, j) => st.types.push({ id: nextId(), category_id: cat.id, parent_id: null, name: t, sort: j }));
    });
    for (const t of TPL.seed) st.templates.push({ id: nextId(), name: t.name, category: t.category, description: t.description, format: "markdown", body: t.body,
      filename: null, builtin: true, created_at: now, updated_at: now });
    return st;
  }

  // Bring stored data up to the current structure without losing anything.
  function migrate(st) {
    for (const k of ["offices", "users", "clients", "categories", "types", "fields", "cases", "saved", "courts", "tasks", "notes", "acts", "checks", "log", "templates", "signs"]) st[k] ||= [];
    st.prefs ||= {}; st.blobs ||= {}; st.info ||= {};
    st.matrix ||= JSON.parse(JSON.stringify(AUTH.matrix));
    st.roles ||= AUTH.roles.map((name) => ({ name, builtin: true }));
    // Permissions added in later versions reach the built-in roles once.
    st.info.knownPerms ||= Object.keys(AUTH.permissions).filter((p) => !["esign.use", "mail.send", "payments.manage"].includes(p));
    // Data saved before the payments module counted that permission as known without granting it.
    if (!st.info.paymentsGranted) { st.info.knownPerms = st.info.knownPerms.filter((p) => p !== "payments.manage"); st.info.paymentsGranted = true; }
    for (const p of Object.keys(AUTH.permissions)) {
      if (st.info.knownPerms.includes(p)) continue;
      for (const [role, perms] of Object.entries(AUTH.matrix)) if (perms.includes(p) && st.matrix[role] && !st.matrix[role].includes(p)) st.matrix[role].push(p);
      st.info.knownPerms.push(p);
    }
    for (const t of st.types) if (t.parent_id === undefined) t.parent_id = null;
    for (const k of st.cases) { k.status = CM.normStatus(k.status); k.client_role ??= ""; k.affiliated ??= false; }
    for (const k of ["charges", "receipts", "reminders"]) st[k] ||= [];
    st.payset ||= null;
    for (const t of st.templates) if (t.file_b64) { st.blobs[`tpl-${t.id}`] = t.file_b64; delete t.file_b64; }
    return st;
  }

  // The earlier test versions kept data in this browser, mixed with sample
  // records. Bring over what the firm entered (catalog, fields, templates,
  // clients, cases, tasks…) and leave the samples behind. The old copy stays.
  function rescueOld() {
    let old = null, from = null;
    for (const v of [5, 4, 3, 2, 1]) {
      try { old = JSON.parse(localStorage.getItem(`juanmaapp-preview-v${v}`) || "null"); } catch { old = null; }
      if (old) { from = v; break; }
    }
    if (!old) return null;
    const isSample = (x) => /@ejemplo(-ficticio)?\.co$/i.test(x?.email || "") || /\(ejemplo\)|ejemplo ficticio|de ejemplo/i.test(`${x?.name || ""} ${x?.title || ""} ${x?.notes || ""} ${x?.reference || ""}`);
    const st = fresh();
    for (const k of ["categories", "types", "fields"]) if (old[k]?.length) st[k] = old[k];
    if (old.matrix) st.matrix = old.matrix;
    if (old.roles?.length) st.roles = old.roles;
    st.users = (old.users || []).filter((u) => !isSample(u));
    st.clients = (old.clients || []).filter((c) => !isSample(c));
    const clientIds = new Set(st.clients.map((c) => c.id));
    st.cases = (old.cases || []).filter((k) => clientIds.has(k.client_id));
    const userIds = new Set(st.users.map((u) => u.id));
    const caseIds = new Set(st.cases.map((k) => k.id));
    st.courts = (old.courts || []).filter((c) => !isSample(c) && !String(c.code || "").startsWith("ej-"));
    const courtIds = new Set(st.courts.map((c) => c.id));
    for (const k of st.cases) {
      if (k.assigned_user_id && !userIds.has(k.assigned_user_id)) k.assigned_user_id = null;
      if (k.court_id && !courtIds.has(k.court_id)) Object.assign(k, { court_id: null, court_email: /ejemplo/.test(k.court_email || "") ? "" : k.court_email });
      if (/ejemplo/.test(k.court_name || "")) k.court_name = "";
      k.last_checked_at = null; k.last_action_date = null;
    }
    st.tasks = (old.tasks || []).filter((x) => caseIds.has(x.case_id) && !isSample(x))
      .map((x) => ({ ...x, assigned_user_id: userIds.has(x.assigned_user_id) ? x.assigned_user_id : null }));
    st.saved = (old.saved || []).filter((r) => !isSample(r) && (!r.case_id || caseIds.has(r.case_id)));
    st.templates = (old.templates || st.templates).map((x) => ({ ...x }));
    // Offices: the main one, plus any that the firm's own records use.
    const used = new Set([...st.clients, ...st.cases].map((x) => x.office_id).concat(st.users.flatMap((u) => u.office_ids || [])));
    st.offices = (old.offices || st.offices).filter((o) => o.is_main || used.has(o.id));
    if (!st.offices.some((o) => o.is_main)) st.offices.unshift(fresh().offices[0]);
    st.info.rescuedFrom = `juanmaapp-preview-v${from}`;
    return st;
  }

  let s = null;
  let saving = Promise.resolve();
  // One save at a time, in order.
  const save = () => (saving = saving.catch(() => {}).then(() => window.JuanmaStore.save(s)));
  const READY = (async () => {
    const loaded = await window.JuanmaStore.load();
    s = migrate(loaded || rescueOld() || fresh());
    await save();
  })();
  // Who is signed in is per viewer, never shared.
  let currentId = (() => { try { return Number(localStorage.getItem("juanmaapp-current")) || null; } catch { return null; } })();
  const setCurrent = (id) => { currentId = id; try { id ? localStorage.setItem("juanmaapp-current", String(id)) : localStorage.removeItem("juanmaapp-current"); } catch {} };
  const fail = (msg) => { throw new Error(msg); };
  const str = (v) => (v == null ? "" : String(v).trim());
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // Time-based ids: unique across viewers writing to the same link.
  let lastId = 0;
  const nextId = () => (lastId = Math.max(lastId + 1, Date.now()));
  const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

  // ----- session, permissions, scope -----
  const officeName = (id) => s.offices.find((o) => o.id === id)?.name || "";
  const permsOf = (role) => {
    const p = [...(s.matrix[role] || [])];
    if (role === "Gerencia" && !p.includes("users.manage")) p.push("users.manage");
    return p;
  };
  const userPerms = (u) => {
    const p = u.custom_permissions ? [...u.permissions] : permsOf(u.role);
    if (u.role === "Gerencia" && !p.includes("users.manage")) p.push("users.manage");
    return p;
  };
  const nrm = (x) => String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  const canonDep = (x) => {
    const n = nrm(x);
    if (!n) return "";
    return DIV.departamentos.find((d) => nrm(d.name) === n)?.name || (n.startsWith("bogota") ? "Bogotá, D.C." : n.startsWith("valle") ? "Valle del Cauca" : "");
  };
  const canonCity = (x, dep) => {
    const n = nrm(x);
    if (!n) return "";
    const code = DIV.departamentos.find((d) => d.name === dep)?.code;
    return DIV.municipios.find((m) => (!code || m.dep === code) && nrm(m.name) === n)?.name || (n.startsWith("bogota") ? "Bogotá, D.C." : String(x).trim());
  };
  const AREA_RULES = [[/ejecucion de penas/, "Ejecución de Penas"], [/pequenas causas|competencia multiple/, "Pequeñas Causas y Competencia Múltiple"],
    [/restitucion de tierras/, "Restitución de Tierras"], [/adolescente/, "Penal para Adolescentes"], [/administrativ|contencioso/, "Administrativo"],
    [/laboral/, "Laboral"], [/familia/, "Familia"], [/promiscuo/, "Promiscuo"], [/penal|control de garantias|conocimiento/, "Penal"], [/civil/, "Civil"],
    [/constitucional/, "Constitucional"]];
  const inferArea = (name, explicit) => {
    const e = nrm(explicit);
    if (e) { const d = AREAS.find((a) => nrm(a) === e); if (d) return d; for (const [re, a] of AREA_RULES) if (re.test(e)) return a; }
    for (const [re, a] of AREA_RULES) if (re.test(nrm(name))) return a;
    return "Otro";
  };
  const placeFromRad = (r) => {
    const m = DIV.municipios.find((x) => x.code === String(r).slice(0, 5));
    return m ? { department: DIV.departamentos.find((d) => d.code === m.dep).name, city: m.name } : null;
  };
  const bogotaNow = (d = new Date()) => new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  const bogotaMs = (local) => Date.parse(String(local).replace(" ", "T") + ":00-05:00");
  const userOut = (u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, created_at: u.created_at,
    offices: s.offices.filter((o) => u.office_ids.includes(o.id)).map((o) => ({ id: o.id, name: o.name })),
    permissions: userPerms(u), phone: u.phone || "", professional_card: u.professional_card || "", custom_permissions: !!u.custom_permissions,
  });
  const me = () => {
    const u = s.users.find((x) => x.id === currentId && x.active);
    if (!u) fail("Inicie sesión para continuar.");
    return userOut(u);
  };
  const need = (perm) => { if (!me().permissions.includes(perm)) fail("Su rol no tiene permiso para esta acción."); };
  const scope = () => (me().permissions.includes("scope.all") ? null : me().offices.map((o) => o.id));
  const inScope = (officeId) => { const sc = scope(); return sc === null || sc.includes(officeId); };
  const clientVisible = (c) => inScope(c.office_id) || s.cases.some((k) => k.client_id === c.id && inScope(k.office_id));
  const officeFor = (requested, fallback) => {
    const sc = scope();
    const oid = +requested || fallback || (sc === null ? s.offices.find((o) => o.is_main).id : sc[0]);
    s.offices.some((o) => o.id === oid) || fail("La oficina no existe.");
    inScope(oid) || fail("No tiene acceso a esa oficina.");
    return oid;
  };
  const checkAssignee = (uid, officeId) => {
    if (!uid) return null;
    const u = s.users.find((x) => x.id === +uid && x.active) || fail("El responsable no existe o está inactivo.");
    if (!userPerms(u).includes("scope.all") && !u.office_ids.includes(officeId)) fail("El responsable no pertenece a la oficina del expediente.");
    return u.id;
  };

  const caseOut = (k) => {
    const t = s.types.find((t) => t.id === k.process_type_id);
    const c = s.categories.find((c) => c.id === t.category_id);
    const cl = s.clients.find((x) => x.id === k.client_id);
    const u = s.users.find((x) => x.id === k.assigned_user_id);
    return clone({ ...k, client_name: cl.full_name, type_name: typePath(t), category_id: c.id, category_name: c.name,
      office_name: officeName(k.office_id), assigned_name: u?.name ?? null });
  };
  const typePath = (t) => { const p = t.parent_id && s.types.find((x) => x.id === t.parent_id); return p ? `${p.name} › ${t.name}` : t.name; };
  const typeUses = (t) => s.cases.filter((k) => k.process_type_id === t.id || s.types.some((x) => x.parent_id === t.id && x.id === k.process_type_id)).length;
  const visibleCase = (id) => {
    const k = s.cases.find((k) => k.id === id);
    if (!k || !inScope(k.office_id)) fail("El expediente no existe.");
    return k;
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
  const CLIENT_FIELDS = ["full_name", "id_type", "id_number", "email", "phone", "address", "department", "city", "notes"];
  const placeClient = (c) => {
    const dep = canonDep(c.department);
    if (c.department && !dep) fail("Departamento no reconocido.");
    c.department = dep;
    c.city = canonCity(c.city, dep);
  };
  // Same rules as the server's caseLocation().
  const caseLocation = (b, cur = {}) => {
    const pick = (k) => (k in b ? str(b[k]) : cur[k] ?? "");
    const radicado = pick("radicado").replace(/\D/g, "");
    if (radicado && radicado.length !== 23) fail("El radicado debe tener 23 dígitos.");
    let department = canonDep(pick("department"));
    if (pick("department") && !department) fail("Departamento no reconocido.");
    let city = canonCity(pick("city"), department);
    const fr = radicado ? placeFromRad(radicado) : null;
    if (fr && !department) { department = fr.department; city = city || fr.city; }
    const area = pick("area");
    if (area && !AREAS.includes(area)) fail("Área no válida.");
    const courtId = "court_id" in b ? (+b.court_id || null) : cur.court_id ?? null;
    let court_name = pick("court_name"), court_email = pick("court_email");
    const c = courtId ? s.courts.find((x) => x.id === courtId) || fail("El despacho no existe en el directorio.") : null;
    if (c) { court_name = c.name; court_email = c.email; department ||= c.department; city ||= c.city; }
    const monitor = "monitor" in b ? (b.monitor ? 1 : 0) : cur.monitor ?? (radicado ? 1 : 0);
    return { department, city, area: area || c?.area || "", court_id: courtId, court_name, court_email, radicado, monitor: radicado ? monitor : 0 };
  };
  const savedVisible = (r) => scope() === null || r.created_by === me().id || (r.case_id && s.cases.some((k) => k.id === r.case_id && inScope(k.office_id)));
  const qs = (url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] || ""));
  const tplMetaOut = (t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, format: t.format, filename: t.filename,
    builtin: !!t.builtin, created_at: t.created_at, updated_at: t.updated_at, file_size: s.blobs[`tpl-${t.id}`] ? Math.round(s.blobs[`tpl-${t.id}`].length * 0.75) : null });
  const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  // Same mapping as the server's templateData().
  function templateData(caseId) {
    const u = me();
    const b = new Date(Date.now() - 5 * 3600 * 1000);
    const today = `${b.getUTCDate()} de ${MONTHS[b.getUTCMonth()]} de ${b.getUTCFullYear()}`;
    const v = {};
    let lawyer = s.users.find((x) => x.id === u.id), office = null;
    if (caseId) {
      const k = visibleCase(caseId);
      const o = caseOut(k);
      const c = s.clients.find((x) => x.id === k.client_id);
      Object.assign(v, {
        "cliente.nombre": c.full_name, "cliente.tipo_documento": c.id_type, "cliente.documento": c.id_number, "cliente.correo": c.email,
        "cliente.telefono": c.phone, "cliente.direccion": c.address, "cliente.ciudad": c.city, "cliente.departamento": c.department,
        "expediente.radicado": /^\d{23}$/.test(k.radicado || "") ? k.radicado.replace(/^(\d{5})(\d{2})(\d{2})(\d{3})(\d{4})(\d{5})(\d{2})$/, "$1-$2-$3-$4-$5-$6-$7") : k.radicado,
        "expediente.tipo_proceso": o.category_name, "expediente.subproceso": o.type_name, "expediente.asunto": k.title,
        "expediente.contraparte": k.counterparty, "expediente.hechos": k.facts, "expediente.despacho": k.court_name, "expediente.correo_despacho": k.court_email,
        "expediente.area": k.area, "expediente.ciudad": k.city, "expediente.departamento": k.department,
      });
      for (const f of s.fields.filter((f) => f.category_id === o.category_id)) v[`campo.${f.label}`] = k.field_values[f.id] ?? "";
      if (k.assigned_user_id) lawyer = s.users.find((x) => x.id === k.assigned_user_id) || lawyer;
      office = s.offices.find((x) => x.id === k.office_id);
    }
    office ||= s.offices.find((x) => x.id === lawyer.office_ids[0]) || s.offices.find((x) => x.is_main);
    Object.assign(v, {
      "abogado.nombre": lawyer.name, "abogado.tarjeta_profesional": lawyer.professional_card || "", "abogado.correo": lawyer.email, "abogado.telefono": lawyer.phone || "",
      "oficina.nombre": office?.name, "oficina.ciudad": office?.city, "oficina.direccion": office?.address, "oficina.telefono": office?.phone, "oficina.correo": office?.email,
      "fecha.hoy": today, "fecha.ciudad_y_fecha": `${office?.city || v["expediente.ciudad"] || ""}, ${today}`.replace(/^, /, ""),
    });
    for (const key of Object.keys(v)) if (v[key] === null || v[key] === undefined || String(v[key]).trim() === "") delete v[key];
    return v;
  }
  const taskOut = (t) => {
    const k = s.cases.find((x) => x.id === t.case_id);
    const o = caseOut(k);
    return clone({ ...t, radicado: k.radicado, case_title: k.title, office_id: k.office_id, client_name: o.client_name, type_name: o.type_name,
      assigned_name: s.users.find((u) => u.id === t.assigned_user_id)?.name ?? null });
  };
  const taskValues = (b, cur = {}) => {
    const v = {
      kind: ["tarea", "audiencia", "termino"].includes(b.kind) ? b.kind : cur.kind || "tarea",
      title: "title" in b ? str(b.title) : cur.title, notes: "notes" in b ? str(b.notes) : cur.notes || "",
      due_at: "due_at" in b ? str(b.due_at).replace("T", " ").slice(0, 16) : cur.due_at,
      location: "location" in b ? str(b.location) : cur.location || "",
      assigned_user_id: "assigned_user_id" in b ? (+b.assigned_user_id || null) : cur.assigned_user_id ?? null,
      remind_days: "remind_days" in b ? [...new Set(b.remind_days)].sort((a, c) => c - a) : cur.remind_days || [1],
      status: ["pendiente", "hecha", "cancelada"].includes(b.status) ? b.status : cur.status || "pendiente",
    };
    v.title || fail("Escriba el título.");
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v.due_at || "") || fail("Indique fecha y hora.");
    return v;
  };
  // Same windows as the server's taskReminders(): each fires once.
  function reminders() {
    const now = Date.now();
    const KIND = { tarea: "Tarea", audiencia: "Audiencia", termino: "Término" };
    for (const t of s.tasks.filter((x) => x.status === "pendiente")) {
      const k = s.cases.find((x) => x.id === t.case_id);
      const who = t.assigned_user_id || k?.assigned_user_id || t.created_by;
      if (!who || !k) continue;
      const due = bogotaMs(t.due_at);
      const client = s.clients.find((c) => c.id === k.client_id)?.full_name || "";
      const push = (key, title, body) => {
        if (s.notes.some((n) => n.key === key)) return;
        s.notes.push({ id: nextId(), user_id: who, kind: t.kind, title, body, link: "#agenda", key, created_at: stamp(), read_at: null });
      };
      for (const d of t.remind_days) {
        if (now >= due - d * 86400000 && now < due) push(`task:${t.id}:${d}`, `${KIND[t.kind]} ${d === 0 ? "hoy" : d === 1 ? "mañana" : "en " + d + " días"}: ${t.title}`, `${t.due_at} · ${client}`);
      }
      if (now >= due) push(`task:${t.id}:overdue`, `${KIND[t.kind]} vencida: ${t.title}`, `${t.due_at} · ${client}`);
    }
    save();
  }
  const prefsOf = (uid) => {
    const u = s.users.find((x) => x.id === uid);
    return s.prefs[uid] ? clone(s.prefs[uid]) : { user_id: uid, hours: ["07:00"], by_email: true, email: u.email, by_whatsapp: false, whatsapp: u.phone || "", scope: "mine", selected: [] };
  };
  // Things that need the internet or an e-mail server. The link says so instead of inventing results.
  const NEEDS_SERVER = {
    rama: "La consulta automática en la Rama Judicial necesita la app instalada en el servidor (este enlace no puede conectarse a sitios externos). Mientras tanto, registre aquí los radicados y consulte en consultaprocesos.ramajudicial.gov.co.",
    juris: "La búsqueda y verificación en las relatorías oficiales necesita la app instalada en el servidor (este enlace no puede abrir sitios externos). Aquí puede analizar una sentencia pegando su texto.",
    mail: "El envío de correos necesita la app instalada en el servidor con el correo de la firma configurado (SMTP).",
    remote: "La firma por enlace con código al correo necesita la app instalada en el servidor. En este enlace use la firma presencial.",
  };
  const routes = [
    // ----- auth -----
    ["GET", /^\/auth\/status$/, () => {
      const u = s.users.find((x) => x.id === currentId && x.active);
      return { setupNeeded: !s.users.length, user: u ? userOut(u) : null };
    }],
    ["POST", /^\/auth\/setup$/, (m, b) => {
      s.users.length && fail("La app ya está configurada.");
      const name = str(b.name), email = str(b.email).toLowerCase();
      (name && email.includes("@")) || fail("Nombre y correo son obligatorios.");
      const u = { id: nextId(), name, email, phone: "", professional_card: "", role: "Gerencia", active: true, office_ids: [s.offices.find((o) => o.is_main).id],
        created_at: stamp(), custom_permissions: false, permissions: [] };
      s.users.push(u);
      setCurrent(u.id);
      return { user: userOut(u) };
    }],
    ["POST", /^\/auth\/login$/, (m, b) => {
      const u = s.users.find((x) => x.email === str(b.email).toLowerCase() && x.active) || fail("No hay un usuario activo con ese correo.");
      setCurrent(u.id);
      return { user: userOut(u) };
    }],
    ["POST", /^\/auth\/logout$/, () => { setCurrent(null); return null; }],
    ["POST", /^\/auth\/password$/, () => fail("En el enlace de prueba la identidad la da su cuenta de Claude; las contraseñas se usan en la app instalada.")],

    // ----- admin -----
    ["GET", /^\/admin\/offices$/, () => { me(); return s.offices.slice().sort((a, b) => b.is_main - a.is_main || a.name.localeCompare(b.name, "es")).map((o) => ({
      ...clone(o), case_count: s.cases.filter((k) => k.office_id === o.id).length,
      user_count: s.users.filter((u) => u.office_ids.includes(o.id)).length })); }],
    ["POST", /^\/admin\/offices$/, (m, b) => {
      need("users.manage");
      const name = str(b.name) || fail("El nombre de la oficina es obligatorio.");
      uniq(s.offices, name);
      const department = canonDep(b.department);
      const o = { id: nextId(), name, department, city: canonCity(b.city, department), address: str(b.address), phone: str(b.phone), email: str(b.email), is_main: false };
      s.offices.push(o);
      return clone(o);
    }],
    ["PUT", /^\/admin\/offices\/(\d+)$/, (m, b) => {
      need("users.manage");
      const o = s.offices.find((x) => x.id === +m[1]) || fail("La oficina no existe.");
      for (const f of ["name", "department", "city", "address", "phone", "email"]) if (f in b) o[f] = str(b[f]);
      o.department = canonDep(o.department);
      o.city = canonCity(o.city, o.department);
      o.name || fail("El nombre de la oficina es obligatorio.");
      uniq(s.offices, o.name, o.id);
      if (b.is_main === true) s.offices.forEach((x) => (x.is_main = x.id === o.id));
      return clone(o);
    }],
    ["DELETE", /^\/admin\/offices\/(\d+)$/, (m) => {
      need("users.manage");
      const o = s.offices.find((x) => x.id === +m[1]) || fail("La oficina no existe.");
      o.is_main && fail("No se puede eliminar la oficina principal.");
      (s.cases.some((k) => k.office_id === o.id) || s.clients.some((c) => c.office_id === o.id)) && fail("La oficina tiene clientes o expedientes. Reasígnelos antes de eliminarla.");
      s.offices = s.offices.filter((x) => x.id !== o.id);
      s.users.forEach((u) => (u.office_ids = u.office_ids.filter((x) => x !== o.id)));
      return null;
    }],
    ["GET", /^\/admin\/users\/directory$/, () => { me(); return s.users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((u) => { const o = userOut(u); return { id: o.id, name: o.name, role: o.role, offices: o.offices, scopeAll: o.permissions.includes("scope.all") }; }); }],
    ["GET", /^\/admin\/users$/, () => { need("users.manage"); return s.users.slice().sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, "es")).map(userOut); }],
    ["POST", /^\/admin\/users$/, (m, b) => {
      need("users.manage");
      const name = str(b.name), email = str(b.email).toLowerCase();
      (name && email.includes("@")) || fail("Nombre y correo son obligatorios.");
      s.roles.some((r) => r.name === b.role) || fail("Rol no válido.");
      (b.office_ids || []).length || fail("Asigne al menos una oficina.");
      s.users.some((u) => u.email === email) && fail("Ya existe un usuario con ese correo.");
      const u = { id: nextId(), name, email, phone: str(b.phone), professional_card: str(b.professional_card), role: b.role, active: true, office_ids: b.office_ids.map(Number), created_at: stamp(),
        custom_permissions: !!b.custom_permissions, permissions: (b.permissions || []).filter((p) => p in AUTH.permissions) };
      s.users.push(u);
      return userOut(u);
    }],
    ["PUT", /^\/admin\/users\/(\d+)$/, (m, b) => {
      need("users.manage");
      const u = s.users.find((x) => x.id === +m[1]) || fail("El usuario no existe.");
      const role = b.role ?? u.role;
      s.roles.some((r) => r.name === role) || fail("Rol no válido.");
      const active = b.active === undefined ? u.active : !!b.active;
      if (u.role === "Gerencia" && (role !== "Gerencia" || !active) && !s.users.some((x) => x.id !== u.id && x.role === "Gerencia" && x.active)) {
        fail("Debe quedar al menos un usuario activo de Gerencia.");
      }
      Array.isArray(b.office_ids) && !b.office_ids.length && fail("Asigne al menos una oficina.");
      const email = b.email ? str(b.email).toLowerCase() : u.email;
      s.users.some((x) => x.email === email && x.id !== u.id) && fail("Ya existe un usuario con ese correo.");
      Object.assign(u, { name: str(b.name) || u.name, email, role, active, phone: "phone" in b ? str(b.phone) : u.phone,
        professional_card: "professional_card" in b ? str(b.professional_card) : u.professional_card });
      if (b.custom_permissions !== undefined) {
        u.custom_permissions = !!b.custom_permissions;
        u.permissions = u.custom_permissions ? (b.permissions || []).filter((p) => p in AUTH.permissions) : [];
      }
      if (Array.isArray(b.office_ids)) u.office_ids = b.office_ids.map(Number);
      return userOut(u);
    }],
    ["GET", /^\/admin\/roles$/, () => {
      me();
      return { roles: s.roles.map((r) => r.name), permissions: AUTH.permissions,
        details: s.roles.map((r) => ({ ...r, users: s.users.filter((u) => u.role === r.name).length })),
        matrix: Object.fromEntries(s.roles.map((r) => [r.name, permsOf(r.name)])) };
    }],
    ["POST", /^\/admin\/roles$/, (m, b) => {
      need("users.manage");
      const name = str(b.name) || fail("Escriba el nombre del rol (máximo 60 caracteres).");
      s.roles.some((r) => r.name.toLowerCase() === name.toLowerCase()) && fail("Ya existe un rol con ese nombre.");
      s.roles.push({ name, builtin: false });
      s.matrix[name] = b.copy_from ? permsOf(b.copy_from).filter((p) => p !== "users.manage" || b.copy_from !== "Gerencia") : [];
      return { role: name, permissions: permsOf(name) };
    }],
    ["PUT", /^\/admin\/roles\/(.+)$/, (m, b) => {
      need("users.manage");
      const role = decodeURIComponent(m[1]);
      const r = s.roles.find((x) => x.name === role) || fail("Rol no válido.");
      const newName = str(b.name);
      if (newName && newName !== role) {
        r.builtin && fail("Los roles incluidos no se pueden renombrar.");
        s.roles.some((x) => x.name === newName) && fail("Ya existe un rol con ese nombre.");
        r.name = newName;
        s.matrix[newName] = s.matrix[role];
        delete s.matrix[role];
        s.users.forEach((u) => { if (u.role === role) u.role = newName; });
        return { role: newName, permissions: permsOf(newName) };
      }
      s.matrix[role] = (b.permissions || []).filter((p) => p in AUTH.permissions);
      return { role, permissions: permsOf(role) };
    }],
    ["DELETE", /^\/admin\/roles\/(.+)$/, (m) => {
      need("users.manage");
      const role = decodeURIComponent(m[1]);
      const r = s.roles.find((x) => x.name === role) || fail("Rol no válido.");
      r.builtin && fail("Los roles incluidos no se pueden eliminar.");
      s.users.some((u) => u.role === role) && fail("Hay usuarios con este rol. Cámbielos de rol antes de eliminarlo.");
      s.roles = s.roles.filter((x) => x !== r);
      delete s.matrix[role];
      return null;
    }],

    // ----- courts -----
    ["GET", /^\/courts\/meta$/, () => ({ areas: AREAS, total: s.courts.length, updated: s.courts.map((c) => c.updated_at).sort().at(-1) || null })],
    ["GET", /^\/courts(?:\?(.*))?$/, (m, b, url) => {
      const q = qs(url);
      const text = nrm(q.q || "");
      return s.courts.filter((c) => (!q.department || c.department === q.department) && (!q.city || c.city === q.city) && (!q.area || c.area === q.area)
        && (!text || nrm(c.name + " " + c.email + " " + c.code).includes(text)))
        .sort((a, b) => (a.department + a.city + a.area + a.name).localeCompare(b.department + b.city + b.area + b.name, "es")).slice(0, Number(q.limit) || 500).map(clone);
    }],
    ["POST", /^\/courts\/import$/, (m, b) => {
      need("catalog.manage");
      const out = { created: 0, updated: 0, skipped: [] };
      (b.rows || []).forEach((row, i) => {
        const name = str(row.name), department = canonDep(row.department);
        if (!name || !department) { out.skipped.push({ row: row.rowNumber ?? i + 2, reason: "Sin nombre o departamento." }); return; }
        const city = canonCity(row.city, department);
        const v = { code: str(row.code), name, department, city, area: inferArea(name, row.area), email: str(row.email).toLowerCase(), phone: str(row.phone), address: str(row.address), updated_at: stamp() };
        const hit = s.courts.find((c) => c.name === name && c.city === city);
        if (hit) { Object.assign(hit, v); out.updated++; } else { s.courts.push({ id: nextId(), city_code: "", ...v }); out.created++; }
      });
      return out;
    }],

    // ----- agenda -----
    ["GET", /^\/tasks(?:\?(.*))?$/, (m, b, url) => {
      const q = qs(url);
      return s.tasks.filter((t) => {
        const k = s.cases.find((x) => x.id === t.case_id);
        if (!k || !inScope(k.office_id)) return false;
        if (q.caseId && t.case_id !== +q.caseId) return false;
        if (q.mine === "1" && !(t.assigned_user_id === me().id || (!t.assigned_user_id && (k.assigned_user_id === me().id
          || (!k.assigned_user_id && t.created_by === me().id))))) return false;
        if (q.status && t.status !== q.status) return false;
        if (q.kind && t.kind !== q.kind) return false;
        if (q.from && t.due_at < q.from) return false;
        if (q.to && t.due_at > q.to) return false;
        return true;
      }).sort((a, b) => a.due_at.localeCompare(b.due_at)).map(taskOut);
    }],
    ["POST", /^\/tasks$/, (m, b) => {
      need("cases.write");
      visibleCase(+b.case_id);
      const t = { id: nextId(), case_id: +b.case_id, created_by: me().id, created_at: stamp(), done_at: null, ...taskValues(b) };
      s.tasks.push(t);
      return taskOut(t);
    }],
    ["PUT", /^\/tasks\/(\d+)$/, (m, b) => {
      need("cases.write");
      const t = s.tasks.find((x) => x.id === +m[1]) || fail("La tarea no existe.");
      visibleCase(t.case_id);
      const before = t.due_at;
      Object.assign(t, taskValues(b, t));
      t.done_at = t.status === "hecha" ? t.done_at || stamp() : null;
      if (before !== t.due_at) s.notes = s.notes.filter((n) => !String(n.key || "").startsWith(`task:${t.id}:`));
      return taskOut(t);
    }],
    ["DELETE", /^\/tasks\/(\d+)$/, (m) => { need("cases.write"); s.tasks = s.tasks.filter((t) => t.id !== +m[1]); return null; }],
    ["GET", /^\/notifications$/, () => {
      reminders();
      const mine = s.notes.filter((n) => n.user_id === me().id).sort((a, b) => b.id - a.id);
      return { items: clone(mine.slice(0, 50)), unread: mine.filter((n) => !n.read_at).length };
    }],
    ["POST", /^\/notifications\/read$/, (m, b) => {
      const ids = b.ids?.length ? b.ids.map(Number) : null;
      s.notes.forEach((n) => { if (n.user_id === me().id && !n.read_at && (!ids || ids.includes(n.id))) n.read_at = stamp(); });
      return null;
    }],

    // ----- process consultation (data typed in; automatic checks need the server) -----
    ["GET", /^\/monitor\/status$/, () => { need("processes.consult"); return { channels: { email: false, whatsapp: false }, hours: ["07:00", "13:00", "17:00"] }; }],
    ["GET", /^\/monitor\/cases$/, () => {
      need("processes.consult");
      const sel = prefsOf(me().id).selected || [];
      return s.cases.filter((k) => k.radicado && inScope(k.office_id)).map((k) => {
        const o = caseOut(k);
        const last = s.checks.filter((c) => c.case_id === k.id).at(-1);
        return { ...o, client_name: o.client_name, new_7d: s.acts.filter((a) => a.case_id === k.id && a.isNew && Date.now() - a.foundMs < 7 * 86400000).length,
          last_error: last && !last.ok ? last.error : null, selected: sel.includes(k.id), monitor: !!k.monitor };
      }).sort((a, b) => String(b.last_action_date || "").localeCompare(String(a.last_action_date || "")));
    }],
    ["GET", /^\/monitor\/cases\/(\d+)\/actuaciones$/, (m) => { need("processes.consult"); visibleCase(+m[1]); return clone(s.acts.filter((a) => a.case_id === +m[1]).sort((a, b) => b.fecha.localeCompare(a.fecha))); }],
    ["PUT", /^\/monitor\/cases\/(\d+)\/monitor$/, (m, b) => { need("processes.consult"); visibleCase(+m[1]).monitor = b.monitor ? 1 : 0; return { id: +m[1], monitor: !!b.monitor }; }],
    ["POST", /^\/monitor\/check$/, () => { need("processes.consult"); fail(NEEDS_SERVER.rama); }],
    ["GET", /^\/monitor\/prefs$/, () => { need("processes.consult"); return prefsOf(me().id); }],
    ["PUT", /^\/monitor\/prefs$/, (m, b) => {
      need("processes.consult");
      b.by_whatsapp && String(b.whatsapp || "").replace(/\D/g, "").length < 10 && fail("Número de WhatsApp no válido.");
      s.prefs[me().id] = { user_id: me().id, hours: (b.hours || []).filter((h) => ["07:00", "13:00", "17:00"].includes(h)), by_email: !!b.by_email, email: str(b.email),
        by_whatsapp: !!b.by_whatsapp, whatsapp: str(b.whatsapp), scope: ["mine", "office", "selected"].includes(b.scope) ? b.scope : "mine", selected: (b.selected || []).map(Number) };
      return prefsOf(me().id);
    }],
    ["POST", /^\/monitor\/report$/, (m, b) => {
      need("processes.consult");
      const p = prefsOf(me().id);
      const ids = s.cases.filter((k) => k.radicado && inScope(k.office_id) && (p.scope === "office" ? k.monitor : p.scope === "selected" ? (p.selected || []).includes(k.id) : k.monitor && k.assigned_user_id === me().id)).map((k) => k.id);
      b.check && fail(NEEDS_SERVER.rama);
      const since = s.log.filter((l) => l.user_id === me().id).at(-1)?.ms || 0;
      const news = s.acts.filter((a) => ids.includes(a.case_id) && a.isNew && a.foundMs > since);
      const lines = [`JuanMaApp · Reporte de procesos · ${bogotaNow()} (hora Colombia)`, "", `Procesos consultados: ${ids.length}. Actuaciones nuevas: ${news.length}.`];
      if (news.length) { lines.push("", "ACTUACIONES NUEVAS"); for (const a of news) lines.push(`• ${s.cases.find((k) => k.id === a.case_id).radicado} · ${a.fecha} · ${a.actuacion}`); }
      lines.push("", "Enlace de prueba: con la app instalada el reporte sale por correo y WhatsApp a las horas elegidas.");
      const channels = [p.by_email && { channel: "email", ok: false, detail: "Requiere la app instalada." }, p.by_whatsapp && { channel: "whatsapp", ok: false, detail: "Requiere la app instalada." }].filter(Boolean);
      s.log.push({ id: nextId(), user_id: me().id, sent_at: stamp(), ms: Date.now(), trigger: "manual", channels, summary: lines.join("\n") });
      s.notes.push({ id: nextId(), user_id: me().id, kind: "reporte", title: "Reporte de procesos (manual)", body: `${ids.length} procesos · ${news.length} actuaciones nuevas`, link: "#consulta", key: null, created_at: stamp(), read_at: null });
      return { text: lines.join("\n"), caseCount: ids.length, newCount: news.length, channels };
    }],
    ["GET", /^\/monitor\/log$/, () => { need("processes.consult"); return clone(s.log.filter((l) => l.user_id === me().id).reverse()); }],

    // ----- clients -----
    ["GET", /^\/clients(?:\?q=(.*))?$/, (m) => {
      const q = decodeURIComponent(m[1] || "").toLowerCase();
      return s.clients
        .filter((c) => clientVisible(c) && (!q || c.full_name.toLowerCase().includes(q) || c.id_number.includes(q)))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "es"))
        .map((c) => ({ ...clone(c), office_name: officeName(c.office_id), case_count: s.cases.filter((k) => k.client_id === c.id && inScope(k.office_id)).length }));
    }],
    ["POST", /^\/clients$/, (m, b) => {
      need("clients.write");
      const c = { id: nextId(), created_at: stamp() };
      for (const f of CLIENT_FIELDS) c[f] = str(b[f]);
      c.full_name || fail("El nombre del cliente es obligatorio.");
      c.id_type ||= "CC";
      placeClient(c);
      c.office_id = officeFor(b.office_id);
      s.clients.push(c);
      return { ...clone(c), office_name: officeName(c.office_id) };
    }],
    ["PUT", /^\/clients\/(\d+)$/, (m, b) => {
      need("clients.write");
      const c = s.clients.find((c) => c.id === +m[1] && clientVisible(c)) || fail("El cliente no existe.");
      for (const f of CLIENT_FIELDS) if (f in b) c[f] = str(b[f]);
      c.full_name || fail("El nombre del cliente es obligatorio.");
      placeClient(c);
      c.office_id = officeFor(b.office_id, c.office_id);
      return { ...clone(c), office_name: officeName(c.office_id) };
    }],
    ["DELETE", /^\/clients\/(\d+)$/, (m) => {
      need("clients.delete");
      s.clients.some((c) => c.id === +m[1] && clientVisible(c)) || fail("El cliente no existe.");
      s.cases.some((k) => k.client_id === +m[1]) && fail("No se puede eliminar: tiene expedientes asociados.");
      s.clients = s.clients.filter((c) => c.id !== +m[1]);
      return null;
    }],

    // ----- catalog -----
    ["GET", /^\/catalog$/, () => s.categories.slice().sort((a, b) => a.sort - b.sort).map((c) => ({
      ...clone(c),
      types: s.types.filter((t) => t.category_id === c.id).sort((a, b) => a.sort - b.sort).map((t) => ({ ...clone(t), parent_id: t.parent_id ?? null, path: typePath(t), uses: typeUses(t) })),
      fields: clone(s.fields.filter((f) => f.category_id === c.id).sort((a, b) => a.sort - b.sort)),
    }))],
    ["POST", /^\/categories$/, (m, b) => {
      need("catalog.manage");
      const name = str(b.name) || fail("El nombre es obligatorio.");
      uniq(s.categories, name);
      const c = { id: nextId(), name, sort: s.categories.length };
      s.categories.push(c);
      return clone(c);
    }],
    ["PUT", /^\/categories\/(\d+)$/, (m, b) => {
      need("catalog.manage");
      const c = s.categories.find((c) => c.id === +m[1]) || fail("El tipo de proceso no existe.");
      const name = str(b.name) || fail("El nombre es obligatorio.");
      uniq(s.categories, name, c.id);
      c.name = name;
      return clone(c);
    }],
    ["DELETE", /^\/categories\/(\d+)$/, (m) => {
      need("catalog.manage");
      const typeIds = s.types.filter((t) => t.category_id === +m[1]).map((t) => t.id);
      s.cases.some((k) => typeIds.includes(k.process_type_id)) && fail("No se puede eliminar: tiene expedientes asociados.");
      s.categories = s.categories.filter((c) => c.id !== +m[1]);
      s.types = s.types.filter((t) => t.category_id !== +m[1]);
      s.fields = s.fields.filter((f) => f.category_id !== +m[1]);
      return null;
    }],
    ["POST", /^\/categories\/(\d+)\/types$/, (m, b) => {
      need("catalog.manage");
      const name = str(b.name) || fail("El nombre del subproceso es obligatorio.");
      const parentId = +b.parent_id || null;
      if (parentId) {
        const parent = s.types.find((t) => t.id === parentId) || fail("El subproceso padre no existe.");
        (parent.category_id !== +m[1] || parent.parent_id) && fail("Solo se admiten subprocesos de segundo orden bajo un subproceso principal.");
      }
      const siblings = s.types.filter((t) => t.category_id === +m[1] && (t.parent_id || null) === parentId);
      uniq(siblings, name);
      const t = { id: nextId(), category_id: +m[1], parent_id: parentId, name, sort: siblings.length };
      s.types.push(t);
      return clone(t);
    }],
    ["PUT", /^\/types\/(\d+)$/, (m, b) => {
      need("catalog.manage");
      const t = s.types.find((t) => t.id === +m[1]) || fail("El subproceso no existe.");
      const name = str(b.name) || fail("El nombre es obligatorio.");
      uniq(s.types.filter((x) => x.category_id === t.category_id && (x.parent_id || null) === (t.parent_id || null)), name, t.id);
      t.name = name;
      return clone(t);
    }],
    ["DELETE", /^\/types\/(\d+)$/, (m) => {
      need("catalog.manage");
      const ids = [+m[1], ...s.types.filter((t) => t.parent_id === +m[1]).map((t) => t.id)];
      s.cases.some((k) => ids.includes(k.process_type_id)) && fail("No se puede eliminar: tiene expedientes asociados.");
      s.types = s.types.filter((t) => !ids.includes(t.id));
      return null;
    }],
    ["PUT", /^\/categories\/(\d+)\/order$/, (m, b) => {
      need("catalog.manage");
      const ids = (b.type_ids || []).map(Number);
      const rows = ids.map((id) => s.types.find((t) => t.id === id && t.category_id === +m[1]));
      (rows.some((r) => !r) || new Set(rows.map((r) => r.parent_id || 0)).size > 1) && fail("Solo se pueden ordenar subprocesos del mismo nivel.");
      rows.forEach((r, i) => (r.sort = i));
      return { ok: true };
    }],
    ["POST", /^\/categories\/(\d+)\/sort-by-usage$/, (m) => {
      need("catalog.manage");
      const groups = new Map();
      for (const t of s.types.filter((t) => t.category_id === +m[1])) { const k = t.parent_id || 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
      for (const list of groups.values()) list.sort((a, b) => typeUses(b) - typeUses(a) || a.sort - b.sort).forEach((t, i) => (t.sort = i));
      return { ok: true };
    }],
    ["PUT", /^\/category-order$/, (m, b) => { need("catalog.manage"); (b.ids || []).map(Number).forEach((id, i) => { const c = s.categories.find((x) => x.id === id); if (c) c.sort = i; }); return { ok: true }; }],
    ["PUT", /^\/categories\/(\d+)\/fields\/order$/, (m, b) => { need("catalog.manage"); (b.field_ids || []).map(Number).forEach((id, i) => { const f = s.fields.find((x) => x.id === id && x.category_id === +m[1]); if (f) f.sort = i; }); return { ok: true }; }],

    // ----- document templates -----
    ["GET", /^\/templates\/meta$/, () => { need("drafts.generate"); return { categories: TPL.categories, variables: TPL.variables }; }],
    ["GET", /^\/templates$/, () => { need("drafts.generate"); return s.templates.slice().sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name, "es")).map(tplMetaOut); }],
    ["GET", /^\/templates\/data(?:\?caseId=(\d+))?$/, (m) => { need("drafts.generate"); return templateData(m[1] ? +m[1] : null); }],
    ["GET", /^\/templates\/(\d+)$/, (m) => { need("drafts.generate"); const t = s.templates.find((x) => x.id === +m[1]) || fail("La plantilla no existe."); return { ...tplMetaOut(t), body: t.body }; }],
    ["GET", /^\/templates\/(\d+)\/file$/, (m) => { need("drafts.generate"); const t = s.templates.find((x) => x.id === +m[1]); (t && s.blobs[`tpl-${t.id}`]) || fail("La plantilla no tiene archivo."); return { filename: t.filename, base64: s.blobs[`tpl-${t.id}`] }; }],
    ["POST", /^\/templates$/, (m, b) => {
      need("templates.manage");
      const name = str(b.name) || fail("Escriba el nombre de la plantilla.");
      TPL.categories.includes(b.category) || fail("Categoría no válida.");
      const t = { id: nextId(), name, category: b.category, description: str(b.description), builtin: false, created_at: stamp(), updated_at: stamp(),
        format: b.file_base64 ? "docx" : "markdown", body: b.file_base64 ? null : String(b.body || ""), filename: b.file_base64 ? str(b.filename) : null };
      t.format === "markdown" && !t.body.trim() && fail("La plantilla está vacía.");
      if (t.format === "docx") {
        atob(String(b.file_base64).slice(0, 8)).slice(0, 2) !== "PK" && fail("El archivo no es un documento de Word (.docx) válido.");
        b.file_base64.length > 11200000 && fail("El archivo debe pesar menos de 8 MB.");
        s.blobs[`tpl-${t.id}`] = b.file_base64;
      }
      s.templates.push(t);
      return { ...tplMetaOut(t), body: t.body };
    }],
    ["PUT", /^\/templates\/(\d+)$/, (m, b) => {
      need("templates.manage");
      const t = s.templates.find((x) => x.id === +m[1]) || fail("La plantilla no existe.");
      if ("name" in b) t.name = str(b.name) || fail("Escriba el nombre de la plantilla.");
      if ("category" in b) { TPL.categories.includes(b.category) || fail("Categoría no válida."); t.category = b.category; }
      if ("description" in b) t.description = str(b.description);
      if ("body" in b && t.format === "markdown") t.body = String(b.body).trim() ? String(b.body) : fail("La plantilla está vacía.");
      t.updated_at = stamp();
      return { ...tplMetaOut(t), body: t.body };
    }],
    ["DELETE", /^\/templates\/(\d+)$/, (m) => { need("templates.manage"); s.templates = s.templates.filter((x) => x.id !== +m[1]); delete s.blobs[`tpl-${m[1]}`]; return null; }],
    ["POST", /^\/categories\/(\d+)\/fields$/, (m, b) => {
      need("catalog.manage");
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
    ["DELETE", /^\/fields\/(\d+)$/, (m) => { need("catalog.manage"); s.fields = s.fields.filter((f) => f.id !== +m[1]); return null; }],

    // ----- cases -----
    ["GET", /^\/cases(?:\?(.*))?$/, (m, b, url) => {
      const q = qs(url);
      return s.cases
        .filter((k) => inScope(k.office_id) && (!q.clientId || k.client_id === +q.clientId) && (!q.officeId || k.office_id === +q.officeId)
          && (q.mine !== "1" || k.assigned_user_id === me().id))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(caseOut);
    }],
    ["GET", /^\/cases\/(\d+)$/, (m) => caseOut(visibleCase(+m[1]))],
    ["POST", /^\/cases$/, (m, b) => {
      need("cases.write");
      const c = s.clients.find((c) => c.id === +b.client_id && clientVisible(c)) || fail("El cliente no existe.");
      const officeId = officeFor(b.office_id);
      const k = {
        id: nextId(), client_id: c.id, process_type_id: +b.process_type_id, title: str(b.title),
        status: CM.normStatus(b.status), counterparty: str(b.counterparty), facts: str(b.facts),
        client_role: partyRole(b.client_role), affiliated: !!b.affiliated,
        field_values: cleanValues(+b.process_type_id, b.field_values), office_id: officeId,
        assigned_user_id: checkAssignee(b.assigned_user_id, officeId), created_at: stamp(), updated_at: stamp(),
        last_checked_at: null, last_action_date: null, ...caseLocation(b),
      };
      s.cases.push(k);
      return caseOut(k);
    }],
    ["PUT", /^\/cases\/(\d+)$/, (m, b) => {
      need("cases.write");
      const k = visibleCase(+m[1]);
      const typeId = +b.process_type_id || k.process_type_id;
      const officeId = officeFor(b.office_id, k.office_id);
      Object.assign(k, {
        process_type_id: typeId, title: str(b.title ?? k.title), status: str(b.status) ? CM.normStatus(b.status) : k.status,
        client_role: "client_role" in b ? partyRole(b.client_role) : k.client_role || "", affiliated: "affiliated" in b ? !!b.affiliated : !!k.affiliated,
        counterparty: str(b.counterparty ?? k.counterparty), facts: str(b.facts ?? k.facts),
        field_values: cleanValues(typeId, b.field_values ?? k.field_values), office_id: officeId,
        assigned_user_id: "assigned_user_id" in b ? checkAssignee(b.assigned_user_id, officeId) : k.assigned_user_id,
        updated_at: stamp(), ...caseLocation(b, k),
      });
      return caseOut(k);
    }],
    ["DELETE", /^\/cases\/(\d+)$/, (m) => { need("cases.delete"); visibleCase(+m[1]); s.cases = s.cases.filter((k) => k.id !== +m[1]); return null; }],

    // ----- case law: analysis of a pasted judgment; official-site search needs the server -----
    ["POST", /^\/jurisprudencia\/search$/, () => { need("jurisprudence.use"); fail(NEEDS_SERVER.juris); }],
    ["POST", /^\/jurisprudencia\/verify$/, () => { need("jurisprudence.use"); fail(NEEDS_SERVER.juris); }],
    ["POST", /^\/jurisprudencia\/analyze$/, async (m, b) => { need("jurisprudence.use"); return analyzePasted(b); }],
    ["GET", /^\/jurisprudencia\/saved(?:\?caseId=(\d+))?$/, (m) => { need("jurisprudence.use"); return clone(s.saved.filter((r) => savedVisible(r) && (!m[1] || r.case_id === +m[1])).slice().reverse()); }],
    ["POST", /^\/jurisprudencia\/saved$/, (m, b) => {
      need("jurisprudence.use");
      if (b.case_id) visibleCase(+b.case_id);
      const r = { id: nextId(), case_id: +b.case_id || null, reference: str(b.reference) || fail("Falta la referencia."),
        court: str(b.court), url: str(b.url), verified: false, analysis: b.analysis || {}, created_by: me().id, created_at: stamp() };
      s.saved.push(r);
      return clone(r);
    }],
    ["DELETE", /^\/jurisprudencia\/saved\/(\d+)$/, (m) => { need("jurisprudence.use"); s.saved = s.saved.filter((r) => !(r.id === +m[1] && savedVisible(r))); return null; }],

    // ----- reports -----
    ["GET", /^\/reports\/([a-z]+)(?:\?.*)?$/, (m, b, url) => {
      need("reports.view");
      const type = m[1];
      REPORTS[type] || fail("Reporte no disponible.");
      const q = qs(url);
      const day = (t) => String(t).slice(0, 10);
      const inRange = (t) => (!q.from || day(t) >= q.from) && (!q.to || day(t) <= q.to);
      const officeOk = (oid) => inScope(oid) && (!q.officeId || oid === +q.officeId);
      const statusOk = (st) => !q.status || (q.status === "activos" ? OPEN.includes(st) : q.status === "archivados" || q.status === "cerrados" ? ARCHIVED.includes(st) : st === q.status);
      const cases = s.cases.filter((k) => officeOk(k.office_id)).map(caseOut);
      let columns, rows;
      if (type === "expedientes") {
        columns = [["office", "Oficina"], ["client", "Cliente"], ["doc", "Documento"], ["category", "Tipo de proceso"], ["type", "Subproceso"],
          ["title", "Asunto"], ["radicado", "Radicado"], ["role", "Calidad del cliente"], ["affiliated", "Afiliado"], ["status", "Estado"], ["assigned", "Responsable"],
          ["counterparty", "Contraparte"], ["created", "Creado"], ["updated", "Actualizado"]];
        rows = cases.filter((k) => inRange(k.created_at) && statusOk(k.status) && (!q.categoryId || k.category_id === +q.categoryId)
          && (!q.assignedUserId || k.assigned_user_id === +q.assignedUserId)).map((k) => {
          const c = s.clients.find((x) => x.id === k.client_id);
          return { office: k.office_name, client: k.client_name, doc: `${c.id_type} ${c.id_number}`.trim(), category: k.category_name, type: k.type_name,
            title: k.title, radicado: k.radicado || "", role: k.client_role || "", affiliated: k.affiliated ? "Sí" : "No", status: k.status, assigned: k.assigned_name || "", counterparty: k.counterparty, created: day(k.created_at), updated: day(k.updated_at) };
        });
      } else if (type === "clientes") {
        columns = [["office", "Oficina"], ["name", "Nombre"], ["doc", "Documento"], ["email", "Correo"], ["phone", "Teléfono"], ["city", "Ciudad"], ["cases", "Expedientes"], ["created", "Creado"]];
        rows = s.clients.filter((c) => clientVisible(c) && (!q.officeId || c.office_id === +q.officeId) && inRange(c.created_at)).map((c) => ({
          office: officeName(c.office_id), name: c.full_name, doc: `${c.id_type} ${c.id_number}`.trim(), email: c.email, phone: c.phone, city: c.city,
          cases: s.cases.filter((k) => k.client_id === c.id).length, created: day(c.created_at) }));
      } else if (type === "oficinas") {
        columns = [["office", "Oficina"], ["city", "Ciudad"], ["clients", "Clientes"], ["cases", "Expedientes"], ["active", "Activos"], ["closed", "Archivados"], ["unassigned", "Sin responsable"], ["users", "Usuarios"]];
        rows = s.offices.filter((o) => officeOk(o.id)).map((o) => {
          const ks = s.cases.filter((k) => k.office_id === o.id);
          return { office: o.name, city: o.city, clients: s.clients.filter((c) => c.office_id === o.id).length, cases: ks.length,
            active: ks.filter((k) => OPEN.includes(k.status)).length, closed: ks.filter((k) => ARCHIVED.includes(k.status)).length,
            unassigned: ks.filter((k) => !k.assigned_user_id).length, users: s.users.filter((u) => u.office_ids.includes(o.id)).length };
        });
      } else if (type === "responsables") {
        columns = [["user", "Responsable"], ["role", "Rol"], ["cases", "Expedientes"], ["active", "Activos"], ["closed", "Archivados"]];
        const groups = new Map();
        for (const k of cases) {
          const key = k.assigned_user_id || 0;
          const g = groups.get(key) || { user: k.assigned_name || "Sin responsable", role: s.users.find((u) => u.id === key)?.role || "", cases: 0, active: 0, closed: 0 };
          g.cases++; g.active += OPEN.includes(k.status) ? 1 : 0; g.closed += ARCHIVED.includes(k.status) ? 1 : 0;
          groups.set(key, g);
        }
        rows = [...groups.values()].sort((a, b) => b.cases - a.cases);
      } else if (type === "procesos") {
        columns = [["category", "Tipo de proceso"], ["type", "Subproceso"], ["cases", "Expedientes"], ["active", "Activos"]];
        const groups = new Map();
        for (const k of cases.filter((k) => inRange(k.created_at))) {
          const g = groups.get(k.process_type_id) || { category: k.category_name, type: k.type_name, cases: 0, active: 0 };
          g.cases++; g.active += OPEN.includes(k.status) ? 1 : 0;
          groups.set(k.process_type_id, g);
        }
        rows = [...groups.values()];
      } else if (type === "cartera" || type === "recibos") {
        need("payments.manage");
        ({ columns, rows } = paymentsReport(type, q));
      } else {
        columns = [["reference", "Sentencia"], ["court", "Corte"], ["verified", "Fuente oficial verificada"], ["case", "Expediente"], ["url", "Enlace"], ["saved", "Guardada"]];
        rows = s.saved.filter((r) => savedVisible(r) && inRange(r.created_at)).map((r) => {
          const k = s.cases.find((x) => x.id === r.case_id);
          return { reference: r.reference, court: r.court, verified: r.verified ? "Sí" : "No", case: k ? `${caseOut(k).client_name} · ${caseOut(k).type_name}` : "", url: r.url, saved: day(r.created_at) };
        });
      }
      return { type, title: REPORTS[type], columns: columns.map(([key, label]) => ({ key, label })), rows,
        generatedAt: new Date().toISOString(), generatedBy: me().name };
    }],
  ];

  // ----- e-signature (in person on this device) -----
  const signOut = (r) => ({
    ...clone(r), doc_text: r.doc_kind === "markdown" ? s.blobs[`signtxt-${r.id}`] || "" : null, has_pdf: !!s.blobs[`signpdf-${r.id}`],
    signers: r.signers.map((x) => ({ ...clone(x), signature_png: s.blobs[`sig-${r.id}-${x.id}`] || null })),
  });
  const signVisible = (r) => inScope(r.office_id) || r.created_by === me().id;
  const getSign = (id) => s.signs.find((r) => r.id === id && signVisible(r)) || fail("La solicitud no existe.");
  const signEvent = (r, signerId, event, detail = "") => r.events.push({ id: nextId(), request_id: r.id, signer_id: signerId, event, detail, ip: "", created_at: stamp() });
  const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const b64bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  routes.push(
    ["GET", /^\/esign$/, () => { need("esign.use"); return s.signs.filter(signVisible).slice().reverse().map(signOut); }],
    ["GET", /^\/esign\/(\d+)$/, (m) => { need("esign.use"); return signOut(getSign(+m[1])); }],
    ["GET", /^\/esign\/(\d+)\/pdf$/, (m) => {
      need("esign.use");
      const r = getSign(+m[1]);
      s.blobs[`signpdf-${r.id}`] || fail("La solicitud no tiene PDF.");
      return { name: r.doc_name, base64: s.blobs[`signpdf-${r.id}`] };
    }],
    ["POST", /^\/esign$/, async (m, b) => {
      need("esign.use");
      b.mode !== "presencial" && fail(NEEDS_SERVER.remote);
      const title = str(b.title) || fail("Escriba el nombre del documento.");
      const signers = (Array.isArray(b.signers) ? b.signers : []).map((x) => ({ name: str(x.name), id_type: str(x.id_type) || "CC", id_number: str(x.id_number), email: str(x.email).toLowerCase(), phone: str(x.phone) }));
      (!signers.length || signers.length > 10) && fail("Agregue entre 1 y 10 firmantes.");
      signers.some((x) => !x.name) && fail("Cada firmante necesita nombre.");
      let kind, hash, pdf = null, text = null;
      if (b.doc_pdf_base64) {
        const bytes = b64bytes(String(b.doc_pdf_base64));
        (!bytes.length || bytes.length > 10 * 1024 * 1024) && fail("El PDF debe pesar menos de 10 MB.");
        String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-" && fail("El archivo no es un PDF válido.");
        kind = "pdf"; pdf = String(b.doc_pdf_base64); hash = await sha256(bytes);
      } else {
        text = String(b.doc_text ?? "");
        text.trim() || fail("El documento está vacío.");
        kind = "markdown"; hash = await sha256(new TextEncoder().encode(text));
      }
      let officeId = null;
      if (b.case_id) officeId = visibleCase(+b.case_id).office_id;
      officeId ||= me().offices[0]?.id ?? null;
      const r = { id: nextId(), title, case_id: +b.case_id || null, office_id: officeId, doc_kind: kind, doc_name: str(b.doc_name), doc_hash: hash,
        message: str(b.message), status: "enviada", created_by: me().id, created_at: stamp(), completed_at: null, signers: [], events: [] };
      for (const x of signers) r.signers.push({ id: nextId(), ...x, status: "pendiente", method: null, signed_at: null, ip: "", user_agent: "", typed_name: "", reject_reason: null, otp_sent_at: null });
      if (pdf) s.blobs[`signpdf-${r.id}`] = pdf; else s.blobs[`signtxt-${r.id}`] = text;
      signEvent(r, null, "creada", `${me().name} · SHA-256 ${hash}`);
      s.signs.push(r);
      return { ...signOut(r), delivery: [] };
    }],
    ["POST", /^\/esign\/(\d+)\/remind\/(\d+)$/, () => { need("esign.use"); fail(NEEDS_SERVER.remote); }],
    ["POST", /^\/esign\/(\d+)\/cancel$/, (m) => {
      need("esign.use");
      const r = getSign(+m[1]);
      r.status !== "enviada" && fail("Solo se cancelan solicitudes en curso.");
      r.status = "cancelada";
      signEvent(r, null, "cancelada", me().name);
      return signOut(r);
    }],
    ["POST", /^\/esign\/(\d+)\/in-person\/(\d+)$/, (m, b) => {
      need("esign.use");
      const r = getSign(+m[1]);
      const x = r.signers.find((y) => y.id === +m[2]);
      (!x || r.status !== "enviada" || x.status !== "pendiente") && fail("Este firmante no tiene firma pendiente.");
      (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.signature_png || "") || b.signature_png.length > 400000) && fail("Dibuje la firma.");
      str(b.typed_name) || fail("Escriba el nombre completo del firmante.");
      b.accept || fail("El firmante debe aceptar el documento.");
      Object.assign(x, { status: "firmado", method: "presencial", signed_at: stamp(), user_agent: navigator.userAgent.slice(0, 300), typed_name: str(b.typed_name) });
      if (str(b.id_number)) x.id_number = str(b.id_number);
      s.blobs[`sig-${r.id}-${x.id}`] = b.signature_png;
      signEvent(r, x.id, "firmado_presencial", `Testigo: ${me().name} · SHA-256 ${r.doc_hash}`);
      if (r.signers.every((y) => y.status === "firmado")) {
        r.status = "completada"; r.completed_at = stamp();
        signEvent(r, null, "completada", "Todos los firmantes firmaron.");
        s.notes.push({ id: nextId(), user_id: r.created_by, kind: "firma", title: "Documento firmado por todos", body: r.title, link: "#firmas", key: null, created_at: stamp(), read_at: null });
      }
      return signOut(r);
    }],
    // ----- certified e-mail: needs the server's mail account -----
    ["GET", /^\/mail\/status$/, () => { need("mail.send"); return { configured: false, message: NEEDS_SERVER.mail }; }],
    ["GET", /^\/mail$/, () => { need("mail.send"); return []; }],
    ["POST", /^\/mail$/, () => { need("mail.send"); fail(NEEDS_SERVER.mail); }],
  );

  // ----- payments: charges, receipts, portfolio, reminders (same rules as src/payments.js) -----
  const PAY_DEFAULTS = { auto: false, days_before: 3, repeat_days: 7, pay_info: "", firm_name: "TEC Jurídicos", firm_nit: "", channels: ["email"] };
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const money = (v) => (typeof v === "number" ? Math.round(v) : Number(String(v ?? "").replace(/[^\d]/g, "")));
  const todayCO = () => bogotaNow().slice(0, 10);
  const paySettings = () => ({ ...PAY_DEFAULTS, ...(s.payset || {}) });
  const ledger = (clientId = null, officeId = null) => {
    const ok = (x) => inScope(x.office_id) && (!clientId || x.client_id === clientId) && (!officeId || x.office_id === officeId);
    const receipts = s.receipts.filter(ok);
    const { charges, credit } = LG.applyPayments(s.charges.filter(ok), receipts, todayCO());
    return { charges, receipts, credit };
  };
  const decorate = (list) => list.map((c) => {
    const cl = s.clients.find((x) => x.id === c.client_id) || {};
    const k = c.case_id ? s.cases.find((x) => x.id === c.case_id) : null;
    return { ...clone(c), client_name: cl.full_name || "", client_email: cl.email || "", client_phone: cl.phone || "",
      case_label: k ? [k.radicado, k.title].filter(Boolean).join(" · ") : "", state_label: LG.STATE_LABELS[c.state] };
  });
  const payClient = (id) => s.clients.find((c) => c.id === +id && clientVisible(c)) || fail("El cliente no existe.");
  const payOffice = (client, caseId) => {
    if (caseId) {
      const k = visibleCase(+caseId);
      k.client_id !== client.id && fail("El expediente no es de este cliente.");
      return k.office_id;
    }
    return inScope(client.office_id) ? client.office_id : scope()?.[0] ?? null;
  };
  const getCharge = (id) => s.charges.find((c) => c.id === +id && inScope(c.office_id)) || fail("El cobro no existe.");
  const userName = (id) => s.users.find((u) => u.id === id)?.name || "";

  function paymentsReport(type, q) {
    const { charges, receipts, credit } = ledger(null, +q.officeId || null);
    if (type === "cartera") {
      const rows = LG.clientRows(charges, credit, receipts, s.clients).map((r) => ({ client: r.client_name, doc: r.id_number, phone: r.phone,
        billed: r.billed, paid: r.paid, balance: r.balance, overdue: r.overdue, max_days: r.max_days, next_due: r.next_due || "", last_payment: r.last_payment || "" }));
      return { columns: [["client", "Cliente"], ["doc", "Documento"], ["phone", "Teléfono"], ["billed", "Facturado"], ["paid", "Pagado"],
        ["balance", "Saldo"], ["overdue", "Vencido"], ["max_days", "Días de mora"], ["next_due", "Próximo vencimiento"], ["last_payment", "Último pago"]], rows };
    }
    const inRange = (d) => (!DATE.test(q.from || "") || d >= q.from) && (!DATE.test(q.to || "") || d <= q.to);
    const rows = receipts.filter((r) => inRange(r.paid_on)).sort((a, b) => a.number - b.number).map((r) => ({
      number: `RC-${String(r.number).padStart(6, "0")}`, date: r.paid_on, client: s.clients.find((c) => c.id === r.client_id)?.full_name || "",
      concept: r.concept, method: r.method, reference: r.reference, amount: r.voided_at ? 0 : r.amount, status: r.voided_at ? `Anulado: ${r.void_reason}` : "Vigente" }));
    return { columns: [["number", "Recibo"], ["date", "Fecha"], ["client", "Cliente"], ["concept", "Concepto"], ["method", "Medio"],
      ["reference", "Referencia"], ["amount", "Valor"], ["status", "Estado"]], rows };
  }

  routes.push(
    ["GET", /^\/payments\/meta$/, () => { need("payments.manage"); return { methods: LG.METHODS, aging: LG.AGING.map(([key, label]) => ({ key, label })), states: LG.STATE_LABELS, channels: { email: false, whatsapp: false } }; }],
    ["GET", /^\/payments\/summary(?:\?.*)?$/, (m, b, url) => {
      need("payments.manage");
      const { charges, receipts, credit } = ledger(null, +qs(url).officeId || null);
      const t = todayCO(), monthStart = t.slice(0, 8) + "01";
      return {
        today: t, totals: LG.portfolio(charges, credit),
        collected_month: receipts.filter((x) => !x.voided_at && x.paid_on >= monthStart).reduce((a, x) => a + x.amount, 0),
        due_7d: charges.filter((c) => c.balance > 0 && c.days_overdue === 0 && c.due_date <= LG.addDays(t, 7)).reduce((a, c) => a + c.balance, 0),
        clients: LG.clientRows(charges, credit, receipts, s.clients),
      };
    }],
    ["GET", /^\/payments\/charges(?:\?.*)?$/, (m, b, url) => {
      need("payments.manage");
      const q = qs(url);
      let list = decorate(ledger(+q.clientId || null).charges);
      if (q.caseId) list = list.filter((c) => c.case_id === +q.caseId);
      if (q.state === "abiertos") list = list.filter((c) => c.balance > 0);
      else if (LG.STATE_LABELS[q.state]) list = list.filter((c) => c.state === q.state);
      return list.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);
    }],
    ["POST", /^\/payments\/charges$/, (m, b) => {
      need("payments.manage");
      const client = payClient(b.client_id);
      const concept = str(b.concept) || fail("Escriba el concepto del cobro.");
      const total = money(b.amount);
      total > 0 || fail("Escriba un valor mayor que cero.");
      DATE.test(str(b.due_date)) || fail("Indique la fecha de vencimiento.");
      const n = Math.min(60, Math.max(1, Number(b.installments) || 1));
      n > total && fail("Demasiadas cuotas para ese valor.");
      const step = b.every === "quincenal" ? (d, i) => LG.addDays(d, 15 * i) : b.every === "semanal" ? (d, i) => LG.addDays(d, 7 * i) : (d, i) => LG.addMonths(d, i);
      const officeId = payOffice(client, b.case_id);
      const ids = LG.splitAmount(total, n).map((amount, i) => {
        const c = { id: nextId(), client_id: client.id, case_id: +b.case_id || null, office_id: officeId, concept, plan_label: n > 1 ? `Cuota ${i + 1} de ${n}` : "",
          amount, due_date: step(str(b.due_date), i), pay_link: str(b.pay_link), notes: str(b.notes), status: "vigente", void_reason: "",
          last_reminder_at: null, created_by: me().id, created_at: stamp() };
        s.charges.push(c);
        return c.id;
      });
      return { ids };
    }],
    ["PUT", /^\/payments\/charges\/(\d+)$/, (m, b) => {
      need("payments.manage");
      const c = getCharge(m[1]);
      c.status === "anulado" && fail("El cobro está anulado.");
      const amount = "amount" in b ? money(b.amount) : c.amount;
      amount > 0 || fail("Escriba un valor mayor que cero.");
      const due = "due_date" in b ? str(b.due_date) : c.due_date;
      DATE.test(due) || fail("Indique la fecha de vencimiento.");
      Object.assign(c, { concept: str(b.concept) || c.concept, amount, due_date: due, pay_link: "pay_link" in b ? str(b.pay_link) : c.pay_link, notes: "notes" in b ? str(b.notes) : c.notes });
      return { ok: true };
    }],
    ["POST", /^\/payments\/charges\/(\d+)\/void$/, (m, b) => {
      need("payments.manage");
      const c = getCharge(m[1]);
      Object.assign(c, { status: "anulado", void_reason: str(b.reason) || fail("Escriba el motivo de la anulación.") });
      return { ok: true };
    }],
    ["POST", /^\/payments\/charges\/(\d+)\/remind$/, (m, b) => {
      need("payments.manage");
      const raw = getCharge(m[1]);
      const c = ledger(raw.client_id).charges.find((x) => x.id === raw.id);
      c.balance > 0 || fail("Este cobro no tiene saldo pendiente.");
      const channels = (b.channels || []).filter((x) => ["email", "whatsapp", "manual"].includes(x));
      channels.length || fail("Elija cómo enviar el recordatorio.");
      const client = s.clients.find((x) => x.id === c.client_id);
      const st = paySettings();
      const message = LG.reminderMessage({ clientName: client.full_name, charge: c, firmName: st.firm_name, payInfo: st.pay_info, today: todayCO() });
      const results = channels.map((ch) => ch === "manual" ? { channel: "manual", ok: true, detail: "Enviado por el usuario (WhatsApp o copia del texto)." }
        : { channel: ch, ok: false, detail: "El envío automático necesita la app instalada; use “Abrir en WhatsApp” o copie el texto." });
      for (const r of results) s.reminders.push({ id: nextId(), charge_id: c.id, client_id: c.client_id, channel: r.channel, ok: r.ok, detail: r.detail, trigger: "manual", created_by: me().id, sent_at: stamp() });
      if (results.some((r) => r.ok)) raw.last_reminder_at = stamp();
      return { results, message };
    }],
    ["GET", /^\/payments\/receipts(?:\?.*)?$/, (m, b, url) => {
      need("payments.manage");
      const q = qs(url);
      return s.receipts.filter((r) => inScope(r.office_id) && (!q.clientId || r.client_id === +q.clientId)
        && (!DATE.test(q.from || "") || r.paid_on >= q.from) && (!DATE.test(q.to || "") || r.paid_on <= q.to))
        .sort((a, b) => b.number - a.number).map((r) => {
          const c = s.clients.find((x) => x.id === r.client_id) || {};
          const ch = s.charges.find((x) => x.id === r.charge_id);
          return { ...clone(r), client_name: c.full_name || "", client_doc: [c.id_type, c.id_number].filter(Boolean).join(" "), client_email: c.email || "",
            charge_concept: ch?.concept ?? null, plan_label: ch?.plan_label ?? null, created_by_name: userName(r.created_by) };
        });
    }],
    ["POST", /^\/payments\/receipts$/, (m, b) => {
      need("payments.manage");
      const client = payClient(b.client_id);
      const amount = money(b.amount);
      amount > 0 || fail("Escriba el valor recibido.");
      LG.METHODS.includes(b.method) || fail("Elija el medio de pago.");
      const paidOn = str(b.paid_on) || todayCO();
      DATE.test(paidOn) || fail("Fecha de pago no válida.");
      let charge = null;
      if (b.charge_id) {
        charge = getCharge(b.charge_id);
        charge.client_id !== client.id && fail("El cobro no es de este cliente.");
        charge.status === "anulado" && fail("El cobro está anulado.");
      }
      const caseId = charge?.case_id || +b.case_id || null;
      const r = { id: nextId(), number: s.receipts.reduce((a, x) => Math.max(a, x.number), 0) + 1, client_id: client.id, charge_id: charge?.id ?? null,
        case_id: caseId, office_id: charge?.office_id ?? payOffice(client, caseId), amount, method: b.method, reference: str(b.reference), paid_on: paidOn,
        concept: str(b.concept) || (charge ? [charge.concept, charge.plan_label].filter(Boolean).join(" · ") : "Abono a cuenta"), notes: str(b.notes),
        voided_at: null, void_reason: "", created_by: me().id, created_at: stamp() };
      s.receipts.push(r);
      return { ...clone(r), client_name: client.full_name };
    }],
    ["POST", /^\/payments\/receipts\/(\d+)\/void$/, (m, b) => {
      need("payments.manage");
      const r = s.receipts.find((x) => x.id === +m[1] && inScope(x.office_id)) || fail("El recibo no existe.");
      r.voided_at && fail("El recibo ya está anulado.");
      Object.assign(r, { void_reason: str(b.reason) || fail("Escriba el motivo de la anulación."), voided_at: stamp() });
      return { ok: true };
    }],
    ["GET", /^\/payments\/reminders(?:\?.*)?$/, (m, b, url) => {
      need("payments.manage");
      const q = qs(url);
      return s.reminders.filter((x) => { const c = s.charges.find((y) => y.id === x.charge_id); return c && inScope(c.office_id) && (!q.clientId || x.client_id === +q.clientId); })
        .slice().reverse().slice(0, 500).map((x) => {
          const c = s.charges.find((y) => y.id === x.charge_id);
          return { ...clone(x), client_name: s.clients.find((y) => y.id === x.client_id)?.full_name || "", concept: c.concept, plan_label: c.plan_label, created_by_name: userName(x.created_by) };
        });
    }],
    ["GET", /^\/payments\/settings$/, () => { need("payments.manage"); return paySettings(); }],
    ["PUT", /^\/payments\/settings$/, (m, b) => {
      need("payments.manage");
      s.payset = { auto: !!b.auto, days_before: Math.min(30, Math.max(0, Number(b.days_before) || 0)), repeat_days: Math.min(60, Math.max(1, Number(b.repeat_days) || 7)),
        pay_info: str(b.pay_info).slice(0, 1500), firm_name: str(b.firm_name) || PAY_DEFAULTS.firm_name, firm_nit: str(b.firm_nit),
        channels: (b.channels || ["email"]).filter((x) => ["email", "whatsapp"].includes(x)) };
      return paySettings();
    }],
  );

  // ----- NomosAI with the viewer's Claude account -----
  const PROMPT = window.JUANMA_PROMPT || "";
  const V = window.JuanmaValidate;
  const DOCUMENT_TYPES = { PETITION: "Right of Petition (administrative / constitutional)", CONTRACT: "Contract / Agreement",
    POWER_OF_ATTORNEY: "Power of Attorney (special or general)", LAWSUIT: "Lawsuit (Demanda)" };
  let sampleFn;
  const getSample = async () => {
    if (sampleFn !== undefined) return sampleFn;
    sampleFn = window.claude?.use ? await window.claude.use("sample").catch(() => null) : null;
    return sampleFn;
  };
  const sampleError = (e) => ({
    not_granted: "Para redactar con NomosAI, permita que este enlace use Claude (se pide la primera vez).",
    rate_limited: "Demasiadas solicitudes seguidas. Espere un momento e intente de nuevo.",
    prompt_too_large: "El texto es demasiado largo. Recórtelo e intente de nuevo.",
    refused: "NomosAI no pudo atender esta solicitud.",
    session_expired: "Su sesión de Claude venció. Recargue la página.",
  }[e?.code] || `No se pudo completar (${e?.message || e?.code || "error"}).`);
  const newTransactionId = () => `JMA_${Date.now().toString(36).toUpperCase()}_${[...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

  function caseContext(caseId) {
    const k = visibleCase(caseId);
    const o = caseOut(k);
    const c = s.clients.find((x) => x.id === k.client_id);
    const values = k.field_values || {};
    const fields = s.fields.filter((f) => f.category_id === o.category_id && values[f.id]).sort((a, b) => a.sort - b.sort).map((f) => ({ label: f.label, value: values[f.id] }));
    return {
      client: { fullName: c.full_name, idNumber: [c.id_type, c.id_number].filter(Boolean).join(" "), email: c.email, address: [c.address, c.city].filter(Boolean).join(", ") },
      counterparty: k.counterparty, facts: k.facts,
      process: { category: o.category_name, type: o.type_name, title: k.title, fields, clientRole: k.client_role || "", status: k.status, radicado: k.radicado || "" },
    };
  }

  function buildUserMessage(req, transactionId) {
    const lines = [
      `Document type: ${req.documentType} — ${DOCUMENT_TYPES[req.documentType]}`, `Output language: ${req.language || "Spanish"}`,
      `Jurisdiction: ${req.jurisdiction || "Colombia"}`, "", "Client:",
      `- Full name: ${req.client?.fullName || "[not provided]"}`, `- ID number: ${req.client?.idNumber || "[not provided]"}`,
      `- Email: ${req.client?.email || "[not provided]"}`, `- Address: ${req.client?.address || "[not provided]"}`, "",
      `Counterparty / addressee: ${req.counterparty || "[not provided]"}`, "",
    ];
    if (req.process) {
      lines.push(`Process: ${req.process.category} › ${req.process.type}${req.process.title ? ` (${req.process.title})` : ""}`,
        ...(req.process.clientRole ? [`- Client's procedural role: ${req.process.clientRole}`] : []),
        ...(req.process.radicado ? [`- Radicado: ${req.process.radicado}`] : []),
        ...req.process.fields.map((f) => `- ${f.label}: ${f.value}`), "");
    }
    lines.push("Case facts and instructions from the paralegal or attorney:", req.facts || "[not provided]", "");
    if (typeof req.template === "string" && req.template.trim()) lines.push("Base template from the firm (keep its structure and wording):", "<<<TEMPLATE", req.template.slice(0, 60000), "TEMPLATE>>>", "");
    if (req.payment?.required) lines.push("Fees: payment IS required.", `Itemized fees: ${req.payment.items || "[not provided]"}`, `Bold transaction ID (use exactly this value): ${transactionId}`);
    else lines.push("Fees: no payment section required. Set payment_required to false.");
    return lines.join("\n");
  }

  async function analyzePasted(b) {
    const text = String(b.text || "").trim();
    text.length < 400 && fail("Pegue en el recuadro el texto completo de la sentencia, copiado de la relatoría oficial. La búsqueda por referencia o enlace necesita la app instalada.");
    const sample = await getSample();
    sample || fail("Este navegador no tiene acceso a Claude para analizar la sentencia.");
    const prompt = `You are a Colombian case-law analyst working for attorneys. Analyze ONLY the judgment text below. Do not add facts, numbers, dates or quotations from memory; if something is not in the text, use null.
Write in Spanish, plain legal language, no filler.

Reference given by the user: ${str(b.reference) || "[not given]"}

<<<SENTENCIA
${text.slice(0, 180000)}
SENTENCIA>>>

Return only a JSON object:
{"court": "", "sala": "", "reference": "", "date": "YYYY-MM-DD or null", "reporting_judge": "or null",
 "legal_problem": "", "facts": "", "ratio_decidendi": "", "decision": "", "dissents": "or null",
 "cited_norms": [""], "summary": "150-250 palabras", "key_quotes": [{"text": "verbatim, copied exactly from the text", "section": ""}], "notes": ""}`;
    let data;
    try { data = await sample.json(prompt, { modelTier: "complex" }); } catch (e) { fail(sampleError(e)); }
    // Keep only quotes that really appear in the pasted text.
    const flat = (x) => String(x || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
    const hay = flat(text);
    const quotes = (data.key_quotes || []).filter((q) => q?.text && hay.includes(flat(q.text)));
    const dropped = (data.key_quotes || []).length - quotes.length;
    return { ...data, found: true, key_quotes: quotes, url: str(b.url), verified: false,
      notes: [data.notes, "Análisis hecho sobre el texto pegado; la fuente oficial no se verificó desde este enlace.", dropped ? `Se descartaron ${dropped} cita(s) que no aparecen textualmente.` : ""].filter(Boolean).join(" ") };
  }

  window.JuanmaBackend = {
    web: true,
    esignRemote: false,
    async request(method, url, body) {
      await READY;
      for (const [m, re, fn] of routes) {
        const match = m === method && url.match(re);
        if (match) {
          const out = await fn(match, body || {}, url);
          if (method !== "GET") await save();
          return out;
        }
      }
      throw new Error(`Función no disponible en este enlace: ${method} ${url}`);
    },
    async *generate(payload) {
      await READY;
      need("drafts.generate");
      DOCUMENT_TYPES[payload.documentType] || fail("Tipo de documento no válido.");
      let req = { ...payload };
      if (payload.caseId) {
        const ctx = caseContext(+payload.caseId);
        req = { ...req, client: { ...ctx.client, ...Object.fromEntries(Object.entries(payload.client ?? {}).filter(([, v]) => v)) },
          counterparty: payload.counterparty || ctx.counterparty, facts: payload.facts || ctx.facts, process: ctx.process };
      }
      const sample = await getSample();
      sample || fail("Este navegador no tiene acceso a Claude para redactar.");
      const transactionId = req.payment?.required ? newTransactionId() : null;
      const input = `${PROMPT}\n\n---\n\nREQUEST\n\n${buildUserMessage(req, transactionId)}`;
      // Turn the callback stream into yielded deltas.
      const queue = [];
      let wake = null, finished = false, result = null, error = null;
      const push = (x) => { queue.push(x); wake?.(); };
      sample(input, { modelTier: "complex", cache: false, onText: ({ delta }) => delta && push(delta) })
        .then((r) => { result = r; }, (e) => { error = e; })
        .finally(() => { finished = true; wake?.(); });
      while (true) {
        if (queue.length) { yield { type: "text", text: queue.shift() }; continue; }
        if (finished) break;
        await new Promise((r) => (wake = r));
        wake = null;
      }
      if (error) { yield { type: "error", error: sampleError(error) }; return; }
      const audit = V.auditDraft(result.text, { transactionId });
      if (result.truncated) { audit.issues.push({ level: "error", code: "TRUNCATED", detail: "El texto quedó incompleto." }); audit.ok = false; }
      yield { type: "done", transactionId, boldLink: transactionId ? `https://checkout.bold.co/payment/link/${transactionId}` : null, servedBy: "Claude (cuenta del usuario)", ...audit };
    },
    // Sign-in on the link: pick your user (the link is private to the firm).
    demoUsers: () => (s ? s.users.filter((u) => u.active).map((u) => ({ email: u.email, name: u.name, role: u.role, office: userOut(u).offices.map((o) => o.name).join(", ") })) : []),
    ready: () => READY,
    exportData: async () => { await READY; return JSON.stringify(s); },
  };
})();
