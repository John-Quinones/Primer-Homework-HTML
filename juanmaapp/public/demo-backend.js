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
      prefs: {}, log: [], templates: [], signs: [], consents: [], blobs: {}, info: { created: now } };
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
    st = JSON.parse(JSON.stringify(st)); // never change the loaded objects in place (they can be read-only)
    for (const k of ["offices", "users", "clients", "categories", "types", "fields", "cases", "saved", "courts", "tasks", "notes", "acts", "checks", "log", "templates", "signs", "authorities"]) st[k] ||= [];
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
    // Version 2.33: «Número de expediente». What the Excel import kept as "Radicado (como venía)" is
    // that number (user's rule): copied once per case, the imported field stays as it was.
    const asImported = st.fields.filter((f) => CM.isImportedRadicadoLabel(f.label));
    for (const k of st.cases) {
      if (k.case_number !== undefined) continue;
      const catId = st.types.find((t) => t.id === k.process_type_id)?.category_id;
      k.case_number = CM.cleanCaseNumber(asImported.filter((f) => f.category_id === catId).map((f) => String(k.field_values?.[f.id] ?? "").trim()).find(Boolean));
    }
    // Version 2.35 (user's rule): the 21-digit case number + "00" becomes the radicado, once (as on the server).
    if (!st.info.radFromNumber) {
      for (const { id, radicado } of CM.radicadosFromNumbers(st.cases).out) {
        const k = st.cases.find((x) => x.id === id), place = !k.department ? placeFromRad(radicado) : null;
        Object.assign(k, { radicado, department: place?.department || k.department || "", city: place ? k.city || place.city : k.city || "" });
      }
      st.info.radFromNumber = true;
    }
    for (const k of ["charges", "receipts", "reminders", "casedocs", "audit", "consents", "tasklog"]) st[k] ||= [];
    delete st.consentTexts; // version 2.4: the texts are kept as stored files (ctext-SHA256)
    // Clients with a single name (before change 19): guess natural or legal entity, split natural names.
    for (const c of st.clients) {
      if (c.person_type) continue;
      if (window.JuanmaPerson.looksLikeCompany(c.full_name, c.id_type)) Object.assign(c, { person_type: "juridica", id_type: "NIT", first_names: "", last_names: "", legal_rep: "" });
      else {
        const sp = window.JuanmaPerson.splitFullName(c.full_name);
        Object.assign(c, { person_type: "natural", ...sp, full_name: `${sp.first_names} ${sp.last_names}`.trim() || c.full_name, legal_rep: "" });
      }
    }
    st.payset ||= null;
    for (const c of st.courts) if (c.circuit === undefined) c.circuit = CM.courtCircuit(c.name);
    // Signature events carry their time in "at", as on the server.
    for (const r of st.signs) for (const e of r.events || []) e.at ??= e.created_at;
    for (const t of st.templates) if (t.builtin && t.body) t.body = t.body.replaceAll("JuanMaApp", "TecjuridicosApp");
    if (TPL.feeClause) for (const t of st.templates) if (t.builtin && t.body?.includes(TPL.feeClause[0])) t.body = t.body.replace(TPL.feeClause[0], TPL.feeClause[1]);
    for (const [from, to] of TPL.firmFixes || []) for (const t of st.templates) if (t.builtin && t.body?.includes(from)) t.body = t.body.split(from).join(to);
    if (TPL.contractHead) for (const t of st.templates) if (t.builtin && t.body?.startsWith(TPL.contractHead[0])) t.body = TPL.contractHead[1] + t.body.slice(TPL.contractHead[0].length);
    // Starter templates added in later versions arrive once (one the firm deleted does not come back).
    if (!Array.isArray(st.info.seededTemplates)) st.info = { ...st.info, seededTemplates: st.templates.filter((t) => t.builtin).map((t) => t.name) };
    for (const t of TPL.seed) {
      if (st.info.seededTemplates.includes(t.name)) continue;
      if (!st.templates.some((x) => x.name === t.name)) {
        const now = new Date().toISOString().slice(0, 19).replace("T", " ");
        st.templates.push({ id: nextId(), name: t.name, category: t.category, description: t.description, format: "markdown",
          body: t.body, filename: null, builtin: true, created_at: now, updated_at: now });
      }
      st.info = { ...st.info, seededTemplates: [...st.info.seededTemplates, t.name] };
    }
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
  const setCurrent = (id) => { currentId = id; hiddenUntil = 0; try { id ? localStorage.setItem("juanmaapp-current", String(id)) : localStorage.removeItem("juanmaapp-current"); } catch {} };
  const fail = (msg) => { throw new Error(msg); };
  const str = (v) => (v == null ? "" : String(v).trim());
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // Time-based ids: unique across viewers writing to the same link.
  let lastId = 0;
  const nextId = () => (lastId = Math.max(lastId + 1, Date.now()));
  const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

  // ----- session, permissions, scope -----
  const officeName = (id) => s.offices.find((o) => o.id === id)?.name || "";
  const clientOut = (c, withPhoto) => {
    const { foto, ...out } = clone(c), photo = s.blobs[`photo-${c.id}`] || "";
    return { ...out, office_name: officeName(c.office_id), has_photo: !!photo, ...(withPhoto ? { photo } : {}) };
  };
  const permsOf = (role) => {
    const p = [...(s.matrix[role] || [])];
    if (role === "Gerencia" && !p.includes("users.manage")) p.push("users.manage");
    return p;
  };
  const userPerms = (u) => {
    const p = u.custom_permissions ? [...u.permissions] : permsOf(u.role);
    // Deleting is for Gerencia only (change 24).
    const only = AUTH.gerenciaOnly || [];
    if (u.role === "Gerencia") { for (const x of ["users.manage", ...only]) if (!p.includes(x)) p.push(x); return p; }
    return p.filter((x) => !only.includes(x));
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
    return DIV.municipios.find((m) => (!code || m.dep === code) && nrm(m.name) === n)?.name || (n.startsWith("bogota") ? "Bogotá, D.C." : window.JuanmaPerson.properName(x));
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
  // Version 2.11, same as the server: a hidden user reads "Asistente"; only the hidden-users
  // password (Gerencia, 15 minutes, this viewer only) shows who it is.
  const ASSISTANT = "Asistente";
  let hiddenUntil = 0;
  const hiddenOpen = () => hiddenUntil > Date.now() && me().role === "Gerencia";
  const shownName = (u) => (u ? (u.hidden ? ASSISTANT : u.name) : null);
  const userOut = (u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, created_at: u.created_at, hidden: !!u.hidden,
    offices: s.offices.filter((o) => u.office_ids.includes(o.id)).map((o) => ({ id: o.id, name: o.name })),
    permissions: userPerms(u), phone: u.phone || "", professional_card: u.professional_card || "", custom_permissions: !!u.custom_permissions,
  });
  const me = () => {
    const u = s.users.find((x) => x.id === currentId && x.active);
    if (!u) fail("Inicie sesión para continuar.");
    return u.hidden ? { ...userOut(u), name: ASSISTANT, real_name: u.name } : userOut(u);
  };
  // ----- Audit log (change 50), same entries as the server's audit_log -----
  const AUDIT_MAX = 5000; // the link's database keeps the latest entries
  const AUDIT_SNAP = [[/^\/cases\/(\d+)$/, "cases"], [/^\/cases\/(\d+)\/folder$/, "cases"], [/^\/cases\/(\d+)\/radicado$/, "cases"], [/^\/cases\/(\d+)\/number$/, "cases"], [/^\/clients\/(\d+)$/, "clients"], [/^\/clients\/(\d+)\/photo$/, "clients"], [/^\/tasks\/(\d+)$/, "tasks"],
    [/^\/payments\/charges\/(\d+)/, "charges"], [/^\/payments\/receipts\/(\d+)/, "receipts"], [/^\/admin\/users\/(\d+)/, "users"], [/^\/esign\/(\d+)/, "signs"]];
  const auditSnap = (path) => {
    const hit = AUDIT_SNAP.find(([re]) => re.test(path));
    if (!hit) return null;
    const id = +path.match(hit[0])[1], row = (s[hit[1]] || []).find((x) => x.id === id);
    return { coll: hit[1], id, before: row ? JSON.parse(JSON.stringify(row)) : null };
  };
  const auditName = (x) => x && (x.full_name || x.title || x.name || x.concept || x.subject || (x.number ? `N.º ${x.number}` : "") || x.email || "");
  function auditAdd(entry, user = (() => { try { return me(); } catch { return null; } })()) {
    const d = CM.deviceOf(navigator.userAgent);
    s.audit.push({ id: nextId(), at: stamp(), user_id: user?.id ?? null, user_name: user?.name ?? "", module: "Acceso", entity: "", record_id: null, case_id: null,
      summary: "", changes: [], ok: true, ip: "", device: d.kind, device_detail: d.detail, user_agent: navigator.userAgent.slice(0, 300), ...entry });
    if (s.audit.length > AUDIT_MAX) s.audit.splice(0, s.audit.length - AUDIT_MAX);
  }
  function auditChange(method, path, body, out, snap, ok = true) {
    const t = CM.auditTarget(path);
    const after = ok && snap && method !== "DELETE" ? (s[snap.coll] || []).find((x) => x.id === snap.id) : null;
    const created = method === "POST" && out && typeof out === "object" && !Array.isArray(out) ? out : null;
    const caseId = t.isCase ? t.id ?? created?.id ?? null : after?.case_id ?? snap?.before?.case_id ?? created?.case_id ?? (+body?.case_id || null);
    const name = auditName(after) || auditName(snap?.before) || auditName(created) || "";
    const verb = ok ? CM.auditVerb(method, path) : "Intentó (sin permiso)";
    auditAdd({ action: verb, module: t.module, entity: t.entity, record_id: snap?.id ?? t.id ?? created?.id ?? null, case_id: caseId, ok,
      summary: `${verb} ${t.entity}${name ? ` «${name}»` : ""}`, changes: method === "PUT" ? CM.auditDiff(snap?.before, after) : [] });
  }
  const need = (perm) => { if (!me().permissions.includes(perm)) fail("Su rol no tiene permiso para esta acción."); };
  const onlyGerencia = () => { if (me().role !== "Gerencia") fail("Solo Gerencia puede ocultar usuarios: su rol no tiene permiso para esta acción."); };
  const hiddenTries = { n: 0, until: 0 };
  // PBKDF2-SHA256 (the link has no scrypt); only the salt and hash are stored.
  const hiddenHash = async (pw, salt) => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(pw || "")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 200000 }, key, 256);
    return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  const hiddenCheck = async (pw) => !!s.info.hiddenPass && (await hiddenHash(pw, s.info.hiddenPass.salt)) === s.info.hiddenPass.hash;
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
    return clone({ parties: [], ...k, client_name: cl.full_name, type_name: typePath(t), category_id: c.id, category_name: c.name,
      office_name: officeName(k.office_id), assigned_name: shownName(u), court_address: (k.court_id && s.courts.find((x) => x.id === k.court_id)?.address) || "" });
  };
  // Same as the server: our clients among the parties are linked to their client record.
  const isPartyClient = (k, clientId) => (k.parties || []).some((p) => p.ours && p.client_id === clientId);
  const caseParties = (list, mainClientId) => {
    const { parties, error } = CM.cleanParties(list);
    if (error) fail(error);
    const digits = (x) => String(x || "").replace(/\D/g, "");
    for (const p of parties) {
      if (p.client_id && !s.clients.some((c) => c.id === p.client_id && clientVisible(c))) p.client_id = null;
      if (p.ours && !p.client_id && digits(p.id_number).length >= 5) p.client_id = s.clients.find((c) => clientVisible(c) && digits(c.id_number) === digits(p.id_number))?.id ?? null;
      if (!p.ours) p.client_id = null;
    }
    return parties.filter((p) => p.client_id !== mainClientId);
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
  const CLIENT_FIELDS = ["id_number", "email", "phone", "address", "department", "city", "notes"];
  const PERSON = window.JuanmaPerson;
  const nameFields = (b, existing = {}) => { try { return PERSON.personFields(b, existing); } catch (err) { fail(err.message); } };
  const placeClient = (c) => {
    const dep = canonDep(c.department);
    if (c.department && !dep) fail("Departamento no reconocido.");
    c.department = dep;
    c.city = canonCity(c.city, dep);
    c.address = PERSON.properAddress(c.address);
    c.phone = PERSON.properPhone(c.phone);
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
    const monitor = "monitor" in b ? (b.monitor ? 1 : 0) : cur.monitor ?? 0; // v2.38: only the box turns it on
    return { department, city, area: area || c?.area || "", court_id: courtId, court_name, court_email, radicado, monitor: radicado ? monitor : 0,
      judge_name: pick("judge_name").replace(/\s+/g, " ").slice(0, 200) };
  };
  const savedVisible = (r) => scope() === null || r.created_by === me().id || (r.case_id && s.cases.some((k) => k.id === r.case_id && inScope(k.office_id)));
  const usedFolders = () => {
    const ids = s.fields.filter((f) => CM.isFolderLabel(f.label)).map((f) => f.id);
    return s.cases.flatMap((k) => ids.map((i) => str(k.field_values?.[i])).filter(Boolean).map((folder) => ({ case_id: k.id, folder })));
  };
  const qs = (url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] || ""));
  const tplMetaOut = (t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, format: t.format, filename: t.filename,
    builtin: !!t.builtin, created_at: t.created_at, updated_at: t.updated_at, file_size: s.blobs[`tpl-${t.id}`] ? Math.round(s.blobs[`tpl-${t.id}`].length * 0.75) : null });
  const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const authorityWriter = () => ["cases.write", "mail.send", "drafts.generate"].some((p) => me().permissions.includes(p)) || fail("Su rol no tiene permiso para esta acción.");
  function authorityInput(b) {
    const entity = str(b?.entity).slice(0, 200);
    CM.entityKey(entity) || fail("Escriba la entidad o el despacho.");
    const email = str(b?.email).toLowerCase().slice(0, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("El correo no es válido.");
    return { entity, entity_key: CM.entityKey(entity), treatment: CM.TREATMENTS.includes(str(b?.treatment)) ? str(b.treatment) : "Señor(a)",
      name: str(b?.name).slice(0, 200), title: str(b?.title).slice(0, 200), address: str(b?.address).slice(0, 200), email, city: str(b?.city).slice(0, 100) };
  }
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
        "expediente.radicado": window.JuanmaPortals.formatRadicado(k.radicado),
        "expediente.tipo_proceso": o.category_name, "expediente.subproceso": o.type_name, "expediente.asunto": k.title,
        "expediente.contraparte": k.counterparty, "expediente.hechos": k.facts, "expediente.despacho": k.court_name, "expediente.juez": k.judge_name || "", "expediente.numero": (k.radicado ? window.JuanmaPortals.formatRadicado(k.radicado) : k.case_number) || "", "expediente.correo_despacho": k.court_email,
        "expediente.area": k.area, "expediente.ciudad": k.city, "expediente.departamento": k.department,
      });
      for (const f of s.fields.filter((f) => f.category_id === o.category_id)) v[`campo.${f.label}`] = k.field_values[f.id] ?? "";
      const folder = s.fields.find((f) => f.category_id === o.category_id && CM.isFolderLabel(f.label) && String(k.field_values[f.id] ?? "").trim());
      if (folder) v["expediente.carpeta"] = String(k.field_values[folder.id]).trim();
      Object.assign(v, CM.recipientVariables(CM.caseRecipient(o, s.authorities)));
      Object.assign(v, LG.feeVariables(s.charges.filter((x) => x.case_id === k.id), s.receipts.filter((x) => x.case_id === k.id)));
      if (k.assigned_user_id) lawyer = s.users.find((x) => x.id === k.assigned_user_id) || lawyer;
      office = s.offices.find((x) => x.id === k.office_id);
    }
    office ||= s.offices.find((x) => x.id === lawyer.office_ids[0]) || s.offices.find((x) => x.is_main);
    Object.assign(v, {
      // A hidden lawyer signs as "Asistente", without personal contact data (version 2.11).
      "abogado.nombre": shownName(lawyer), "abogado.tarjeta_profesional": lawyer.hidden ? "" : lawyer.professional_card || "",
      "abogado.correo": lawyer.hidden ? "" : lawyer.email, "abogado.telefono": lawyer.hidden ? "" : lawyer.phone || "",
      "oficina.nombre": office?.name, "oficina.ciudad": office?.city, "oficina.direccion": office?.address, "oficina.telefono": office?.phone, "oficina.correo": office?.email,
      "fecha.hoy": today, "fecha.ciudad_y_fecha": `${office?.city || v["expediente.ciudad"] || ""}, ${today}`.replace(/^, /, ""),
    });
    for (const key of Object.keys(v)) if (v[key] === null || v[key] === undefined || String(v[key]).trim() === "") delete v[key];
    return v;
  }
  const taskOut = (t) => {
    const k = s.cases.find((x) => x.id === t.case_id);
    const o = caseOut(k);
    const name = (id) => shownName(s.users.find((u) => u.id === id));
    return clone({ done_by: null, done_notes: "", delivered_at: "", response_at: "", response_notes: "", term_from: "", term_days: null, term_unit: "", term_label: "", ...t,
      radicado: k.radicado, case_title: k.title, office_id: k.office_id, client_id: k.client_id, client_name: o.client_name, type_name: o.type_name, case_user_id: k.assigned_user_id ?? null,
      assigned_name: name(t.assigned_user_id), case_assigned_name: name(k.assigned_user_id), created_by_name: name(t.created_by), done_by_name: name(t.done_by) });
  };
  // Task history (version 2.18), same rows as the server's task_log; never changed or removed.
  const logTask = (before, after) => {
    const t = after || before;
    for (const e of CM.taskLogEvents(before, after, (id) => shownName(s.users.find((u) => u.id === id)) || ""))
      s.tasklog.push({ id: nextId(), at: stamp(), task_id: t.id, case_id: t.case_id, user_id: me().id, action: e.action, kind: t.kind, title: t.title,
        detail: String(e.detail).slice(0, 500), assigned_user_id: t.assigned_user_id ?? null });
  };
  // Same as the server: the assignee hears about a new task in the bell.
  const tellAssignee = (t, before) => {
    if (!t.assigned_user_id || t.assigned_user_id === before || t.assigned_user_id === me().id || t.status !== "pendiente") return;
    const key = `assign:${t.id}:${t.assigned_user_id}`;
    if (s.notes.some((n) => n.key === key)) return;
    const o = taskOut(t);
    s.notes.push({ id: nextId(), user_id: t.assigned_user_id, kind: "asignada", title: `${me().name} le asignó: ${CM.TASK_KIND_LABEL[t.kind]} · ${t.title}`,
      body: `Plazo ${t.due_at} · ${o.client_name}`, link: `#expediente-${t.case_id}`, key, created_at: stamp(), read_at: null });
  };
  // Version 2.26, same as the server's sendNotice: the bell always; e-mail and WhatsApp need the server,
  // so the link says so and hands the office the text to send from its own e-mail or WhatsApp.
  const sendNotice = (t, opts = {}) => {
    const o = taskOut(t), uid = t.assigned_user_id || o.case_user_id;
    const u = uid && s.users.find((x) => x.id === uid && x.active);
    if (!u) return { error: "La tarea no tiene funcionario asignado y el expediente no tiene responsable." };
    const link = window.JUANMA_LINK_URL ? `${window.JUANMA_LINK_URL}#expediente-${t.case_id}` : "";
    const message = str(opts.message).slice(0, 500);
    const n = CM.taskNotice(o, { to: u.name, by: me().name, message, link });
    s.notes.push({ id: nextId(), user_id: u.id, kind: "asignada", title: `${me().name} le notificó: ${CM.TASK_KIND_LABEL[t.kind]} · ${t.title}`,
      body: `${t.kind === "audiencia" ? "Fecha" : "Plazo"} ${t.due_at} · ${o.client_name}${message ? " · " + message : ""}`, link: `#expediente-${t.case_id}`, key: null, created_at: stamp(), read_at: null });
    const off = "El enlace de pruebas no envía correos ni WhatsApp: eso lo hace el servidor (Azure). Puede enviarlo desde su propio correo o WhatsApp.";
    const results = [{ channel: "app", ok: true, detail: "Aviso en la campana de la App" }];
    if (opts.email) results.push({ channel: "email", ok: false, detail: off });
    if (opts.whatsapp) results.push({ channel: "whatsapp", ok: false, detail: off });
    const shownTo = shownName(u);
    const LABEL = { app: "App", email: "correo", whatsapp: "WhatsApp" };
    s.tasklog.push({ id: nextId(), at: stamp(), task_id: t.id, case_id: t.case_id, user_id: me().id, action: "notificada", kind: t.kind, title: t.title,
      detail: `A ${shownTo} por ${results.map((x) => `${LABEL[x.channel]} ${x.ok ? "(enviado)" : "(no enviado)"}`).join(", ")}${message ? ` · ${message}` : ""}`.slice(0, 500),
      assigned_user_id: t.assigned_user_id ?? null });
    const open = !u.hidden;
    return { to: { id: u.id, name: shownTo, email: open ? u.email : "", phone: open ? u.phone || "" : "" }, results,
      mail: { subject: n.subject, text: n.text }, short: `${n.short}${link ? " · " + link : ""}` };
  };
  const noticeOpts = (b) => (b && typeof b === "object" ? { email: b.email !== false, whatsapp: !!b.whatsapp, message: b.message } : null);
  const taskValues = (b, cur = {}) => {
    const v = {
      kind: CM.TASK_KINDS.includes(b.kind) ? b.kind : cur.kind || "tarea",
      title: "title" in b ? str(b.title) : cur.title, notes: "notes" in b ? str(b.notes) : cur.notes || "",
      due_at: "due_at" in b ? str(b.due_at).replace("T", " ").slice(0, 16) : cur.due_at,
      location: "location" in b ? str(b.location) : cur.location || "",
      assigned_user_id: "assigned_user_id" in b ? (+b.assigned_user_id || null) : cur.assigned_user_id ?? null,
      remind_days: "remind_days" in b ? [...new Set(b.remind_days)].sort((a, c) => c - a) : cur.remind_days || [1],
      status: ["pendiente", "hecha", "cancelada"].includes(b.status) ? b.status : cur.status || "pendiente",
      done_notes: "done_notes" in b ? str(b.done_notes) : cur.done_notes || "",
      delivered_at: "delivered_at" in b ? str(b.delivered_at).slice(0, 10) : cur.delivered_at || "",
      response_at: "response_at" in b ? str(b.response_at).slice(0, 10) : cur.response_at || "",
      response_notes: "response_notes" in b ? str(b.response_notes) : cur.response_notes || "",
      term_from: "term_from" in b ? str(b.term_from).slice(0, 10) : cur.term_from || "",
      term_days: "term_days" in b ? (Number.isInteger(Number(b.term_days)) && Number(b.term_days) > 0 && b.term_days !== "" ? Number(b.term_days) : null) : cur.term_days ?? null,
      term_unit: "term_unit" in b ? (b.term_unit === "calendario" ? "calendario" : "habiles") : cur.term_unit || "",
      term_label: "term_label" in b ? str(b.term_label).slice(0, 200) : cur.term_label || "",
    };
    v.title || fail("Escriba el título.");
    (!v.term_days || v.term_days <= 400) || fail("Término no válido.");
    if (!v.term_days || !v.term_from) Object.assign(v, { term_from: "", term_days: null, term_unit: "", term_label: "" });
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v.due_at || "") || fail("Indique fecha y hora.");
    if (!CM.RESPONSE_KINDS.includes(v.kind)) Object.assign(v, { delivered_at: "", response_at: "", response_notes: "" });
    [v.delivered_at, v.response_at].every((d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d)) || fail("Fecha no válida.");
    if (v.response_at && v.response_at !== (cur.response_at || "") && v.status !== "cancelada") v.status = "hecha";
    // Same as the server: the assignee must be able to open the case (audit A01-003).
    const k = s.cases.find((x) => x.id === (+b.case_id || cur.case_id));
    const who = v.assigned_user_id && v.assigned_user_id !== cur.assigned_user_id && s.users.find((u) => u.id === v.assigned_user_id && u.active);
    if (v.assigned_user_id && v.assigned_user_id !== cur.assigned_user_id && !who) fail("El responsable no existe.");
    if (who && k) { const o = userOut(who); if (!o.permissions.includes("scope.all") && !o.offices.some((x) => x.id === k.office_id)) fail("Ese funcionario no tiene acceso a la oficina de este expediente."); }
    return v;
  };
  // Same windows as the server's taskReminders(): each fires once.
  function reminders() {
    const now = Date.now();
    const KIND = CM.TASK_KIND_LABEL;
    for (const t of s.tasks.filter((x) => x.status === "pendiente")) {
      const k = s.cases.find((x) => x.id === t.case_id);
      const who = t.assigned_user_id || k?.assigned_user_id || t.created_by;
      if (!who || !k) continue;
      const due = bogotaMs(t.due_at);
      const client = s.clients.find((c) => c.id === k.client_id)?.full_name || "";
      const push = (key, title, body) => {
        if (s.notes.some((n) => n.key === key)) return;
        s.notes.push({ id: nextId(), user_id: who, kind: t.kind, title, body, link: `#expediente-${t.case_id}`, key, created_at: stamp(), read_at: null });
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
    rama: "La consulta automática en la Rama Judicial necesita la app instalada en el servidor (este enlace no puede conectarse a sitios externos). Mientras tanto, use el botón «Portales» de cada expediente: copia el radicado y abre la Rama Judicial, Publicaciones Procesales, TYBA o SAMAI.",
    juris: "La búsqueda y la verificación en las relatorías oficiales se hacen en la App del servidor (Azure): use el botón «Buscar en la App del servidor». Aquí puede analizar una sentencia pegando su texto.",
    mail: "El envío de correos necesita la app instalada en el servidor con el correo de la firma configurado (SMTP).",
    consent: "El envío del enlace de autorizaciones necesita la app instalada en el servidor. En este enlace use «Firmar en la oficina».",
  };
  // ----- Client authorizations (change 56): append-only, hash-chained like the server -----
  const LEGAL = window.JuanmaLegal;
  const shaText = (text) => sha256(new TextEncoder().encode(text)); // sha256(bytes) is defined with e-signature
  const consentClient = (id) => s.clients.find((x) => x.id === id && clientVisible(x)) || fail("El cliente no existe.");
  const consentsOut = (cid) => {
    const records = clone(s.consents.filter((r) => r.client_id === cid));
    return { version: LEGAL.legalVersion().name, items: LEGAL.CONSENT_ITEMS, methods: LEGAL.CONSENT_METHODS, status: LEGAL.consentStatus(records), records, requests: [] };
  };
  async function recordConsents(c, answers, ctx) {
    const keys = LEGAL.CONSENT_ITEMS.map((i) => i.key).filter((k) => typeof answers[k] === "boolean");
    keys.length || fail("Marque o desmarque al menos una autorización.");
    const at = stamp(), u = ctx.byClient ? { id: null, name: "" } : me(); // the signer's own page has no signed-in user
    for (const key of keys) {
      const text = LEGAL.consentText(key), docSha = await shaText(text);
      // The exact text, once per version, kept with the stored files (it does not fit in one database document).
      s.blobs[`ctext-${docSha}`] ||= btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ version: LEGAL.legalVersion().name, item: key, text }))));
      const prev = s.consents.length ? s.consents[s.consents.length - 1].hash : "";
      const r = { id: nextId(), client_id: c.id, client_name: c.full_name, client_id_number: [c.id_type, c.id_number].filter(Boolean).join(" "), item: key,
        granted: answers[key] ? 1 : 0, method: ctx.method, doc_version: LEGAL.legalVersion().name, doc_sha256: docSha, at, ip: "", user_agent: str(ctx.user_agent).slice(0, 400),
        typed_name: str(ctx.typed_name).slice(0, 200), typed_id: str(ctx.typed_id).slice(0, 40), signature_png: ctx.signature_png || "", note: str(ctx.note).slice(0, 1000),
        registered_by: u.id, registered_by_name: u.name, request_id: null, prev_hash: prev };
      r.hash = await shaText(LEGAL.consentCanonical(r, prev) + r.signature_png);
      s.consents.push(r);
    }
  }
  const routes = [
    // ----- auth -----
    ["GET", /^\/auth\/status$/, () => {
      const u = s.users.find((x) => x.id === currentId && x.active);
      return { setupNeeded: !s.users.length, user: u ? userOut(u) : null, version: window.JUANMA_VERSION || null };
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
      auditAdd({ action: "Ingresó", summary: "Inicio de sesión en el enlace de prueba" }, u);
      return { user: userOut(u) };
    }],
    ["POST", /^\/auth\/logout$/, () => { try { auditAdd({ action: "Salió", summary: "Cerró sesión" }); } catch {} setCurrent(null); return null; }],
    ["GET", /^\/audit(?:\?(.*))?$/, (m, b, url) => {
      const q = qs(url);
      if (q.caseId) visibleCase(+q.caseId); else need("audit.view");
      const from = q.from ? Date.parse(q.from + "T00:00:00-05:00") : null, to = q.to ? Date.parse(q.to + "T23:59:59-05:00") : null;
      const like = String(q.q || "").toLowerCase();
      // Who really did it stays in user_id; a hidden user reads "Asistente" unless unlocked.
      const open = hiddenOpen(), hidden = s.users.filter((u) => u.hidden), hiddenIds = new Set(hidden.map((u) => u.id));
      const mask = (t) => (open ? t : hidden.reduce((acc, u) => (u.name ? acc.split(u.name).join(ASSISTANT) : acc).split(u.email || "\u0000").join("(oculto)"), t));
      return clone(s.audit.filter((e) => {
        const t = Date.parse(e.at.replace(" ", "T") + "Z");
        return (!q.caseId || e.case_id === +q.caseId) && (!from || t >= from) && (!to || t <= to) && (!q.userId || e.user_id === +q.userId)
          && (!q.module || e.module === q.module) && (!q.device || e.device === q.device) && (!q.before || e.id < +q.before)
          && (!like || `${e.summary} ${open || !hiddenIds.has(e.user_id) ? e.user_name : ""} ${JSON.stringify(e.changes)}`.toLowerCase().includes(like));
      }).sort((a, b) => b.id - a.id).slice(0, 300).map((e) => ({ ...e, summary: mask(e.summary), changes: JSON.parse(mask(JSON.stringify(e.changes || []))),
        ...(hiddenIds.has(e.user_id) ? { user_name: open ? `${hidden.find((u) => u.id === e.user_id).name} (oculto)` : ASSISTANT, hidden_user: true } : {}) })));
    }],
    ["POST", /^\/auth\/password$/, () => fail("En el enlace de prueba la identidad la da su cuenta de Claude; las contraseñas se usan en la app instalada.")],
    ["GET", /^\/admin\/channels$/, () => ({ web: true, email: false, whatsapp: false, whatsapp_otp: false })],
    ["POST", /^\/admin\/test-tsa$/, () => fail("En el enlace de prueba no se piden sellos de tiempo: pruebe desde la app en Azure.")],
    ["POST", /^\/admin\/test-channel$/, () => fail("En el enlace de prueba no se envían mensajes: pruebe desde la app en Azure.")],
    ["POST", /^\/auth\/(forgot|reset)$/, () => fail("En el enlace de prueba no hay contraseñas: se entra eligiendo el usuario. Recuperar la contraseña funciona en la app instalada.")],
    ["POST", /^\/auth\/email$/, (m, b) => {
      const u = s.users.find((x) => x.id === currentId) || fail("Inicie sesión.");
      const email = str(b.email).toLowerCase();
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || fail("Escriba un correo válido.");
      email === u.email && fail("Ese ya es su correo.");
      s.users.some((x) => x.email === email && x.id !== u.id) && fail("Ese correo ya está registrado por otro usuario.");
      u.email = email;
      return { user: userOut(u) };
    }],

    // ----- admin -----
    ["GET", /^\/admin\/offices$/, () => { me(); return s.offices.slice().sort((a, b) => b.is_main - a.is_main || a.name.localeCompare(b.name, "es")).map((o) => ({
      ...clone(o), case_count: s.cases.filter((k) => k.office_id === o.id).length,
      user_count: s.users.filter((u) => u.office_ids.includes(o.id)).length })); }],
    ["POST", /^\/admin\/offices$/, (m, b) => {
      need("users.manage");
      const name = str(b.name) || fail("El nombre de la oficina es obligatorio.");
      uniq(s.offices, name);
      const department = canonDep(b.department);
      const o = { id: nextId(), name, department, city: canonCity(b.city, department), address: PERSON.properAddress(b.address), phone: PERSON.properPhone(b.phone), email: str(b.email), is_main: false };
      s.offices.push(o);
      return clone(o);
    }],
    ["PUT", /^\/admin\/offices\/(\d+)$/, (m, b) => {
      need("users.manage");
      const o = s.offices.find((x) => x.id === +m[1]) || fail("La oficina no existe.");
      for (const f of ["name", "department", "city", "address", "phone", "email"]) if (f in b) o[f] = str(b[f]);
      o.department = canonDep(o.department);
      o.city = canonCity(o.city, o.department);
      o.address = PERSON.properAddress(o.address);
      o.phone = PERSON.properPhone(o.phone);
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
    ["GET", /^\/admin\/users\/directory$/, () => { me(); const open = hiddenOpen(); return s.users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((u) => { const o = userOut(u), shown = !u.hidden || open;
        return { id: o.id, name: shown ? o.name : ASSISTANT, role: shown ? o.role : ASSISTANT, offices: o.offices, scopeAll: o.permissions.includes("scope.all") }; }); }],
    // Hidden users are left out until Gerencia enters the hidden-users password.
    ["GET", /^\/admin\/users$/, () => { need("users.manage"); const open = hiddenOpen();
      return s.users.filter((u) => open || !u.hidden).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, "es")).map(userOut); }],
    ["GET", /^\/admin\/hidden-users$/, () => {
      need("users.manage");
      const open = hiddenOpen();
      return { count: s.users.filter((u) => u.hidden).length, has_password: !!s.info.hiddenPass, unlocked: open,
        unlocked_until: open ? new Date(hiddenUntil).toISOString() : null, can_manage: me().role === "Gerencia" };
    }],
    ["POST", /^\/admin\/hidden-users\/password$/, async (m, b) => {
      onlyGerencia();
      if (s.info.hiddenPass && !(await hiddenCheck(b.current))) {
        auditAdd({ action: "Intentó cambiar la contraseña de usuarios ocultos", module: "Usuarios", ok: false, summary: "Contraseña actual incorrecta" });
        fail("La contraseña actual de usuarios ocultos no es correcta.");
      }
      const pw = String(b.next || "");
      pw.length < 10 && fail("La contraseña debe tener al menos 10 caracteres.");
      (/^\d+$/.test(pw) || /^(.)\1+$/.test(pw)) && fail("Esa contraseña es fácil de adivinar: pruebe una frase de varias palabras.");
      const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const had = !!s.info.hiddenPass;
      s.info = { ...s.info, hiddenPass: { salt, hash: await hiddenHash(b.next, salt), set_at: stamp(), set_by: me().id } };
      hiddenUntil = 0;
      auditAdd({ action: had ? "Cambió la contraseña de usuarios ocultos" : "Creó la contraseña de usuarios ocultos", module: "Usuarios", summary: "Contraseña de usuarios ocultos" });
      return null;
    }],
    ["POST", /^\/admin\/hidden-users\/unlock$/, async (m, b) => {
      onlyGerencia();
      s.info.hiddenPass || fail("Primero cree la contraseña de usuarios ocultos.");
      hiddenTries.until > Date.now() && fail(`Demasiados intentos. Espere ${Math.ceil((hiddenTries.until - Date.now()) / 60000)} minuto(s).`);
      if (!(await hiddenCheck(b.password))) {
        hiddenTries.n++;
        if (hiddenTries.n >= 5) Object.assign(hiddenTries, { n: 0, until: Date.now() + 15 * 60000 });
        auditAdd({ action: "Intentó ver usuarios ocultos", module: "Usuarios", ok: false, summary: "Contraseña de usuarios ocultos incorrecta" });
        await save();
        fail("La contraseña de usuarios ocultos no es correcta.");
      }
      hiddenTries.n = 0;
      hiddenUntil = Date.now() + 15 * 60000;
      auditAdd({ action: "Vio usuarios ocultos", module: "Usuarios", summary: "Abrió la vista de usuarios ocultos por 15 minutos" });
      return { ok: true, unlocked_until: new Date(hiddenUntil).toISOString() };
    }],
    ["POST", /^\/admin\/hidden-users\/lock$/, () => { hiddenUntil = 0; return null; }],
    ["PUT", /^\/admin\/users\/(\d+)\/hidden$/, (m, b) => {
      onlyGerencia();
      const hide = b.hidden === true, u = s.users.find((x) => x.id === +m[1]);
      (!u || (u.hidden && !hiddenOpen())) && fail("El usuario no existe.");
      hide && !s.info.hiddenPass && fail("Primero cree la contraseña de usuarios ocultos.");
      !hide && !hiddenOpen() && fail("Escriba la contraseña de usuarios ocultos para mostrar este usuario.");
      u.hidden = hide;
      auditAdd({ action: hide ? "Ocultó un usuario" : "Volvió a mostrar un usuario", module: "Usuarios", entity: "usuario", record_id: u.id,
        summary: hide ? "Ocultó un usuario: sus acciones se ven como «Asistente»" : "Volvió a mostrar un usuario oculto" });
      return userOut(u);
    }],
    ["POST", /^\/admin\/users$/, (m, b) => {
      need("users.manage");
      if (b.role === "Gerencia" && me().role !== "Gerencia") fail("Solo Gerencia puede crear usuarios de Gerencia.");
      const name = str(b.name), email = str(b.email).toLowerCase();
      (name && email.includes("@")) || fail("Nombre y correo son obligatorios.");
      s.roles.some((r) => r.name === b.role) || fail("Rol no válido.");
      (b.office_ids || []).length || fail("Asigne al menos una oficina.");
      s.users.some((u) => u.email === email) && fail("Ya existe un usuario con ese correo.");
      const u = { id: nextId(), name, email, phone: PERSON.properPhone(b.phone), professional_card: str(b.professional_card), role: b.role, active: true, office_ids: b.office_ids.map(Number), created_at: stamp(),
        custom_permissions: !!b.custom_permissions, permissions: (b.permissions || []).filter((p) => p in AUTH.permissions) };
      s.users.push(u);
      return userOut(u);
    }],
    ["PUT", /^\/admin\/users\/(\d+)$/, (m, b) => {
      need("users.manage");
      const u = s.users.find((x) => x.id === +m[1] && (!x.hidden || hiddenOpen())) || fail("El usuario no existe.");
      const role = b.role ?? u.role;
      if ((u.role === "Gerencia" || role === "Gerencia") && me().role !== "Gerencia") fail("Solo Gerencia puede modificar usuarios de Gerencia.");
      s.roles.some((r) => r.name === role) || fail("Rol no válido.");
      const active = b.active === undefined ? u.active : !!b.active;
      if (u.role === "Gerencia" && (role !== "Gerencia" || !active) && !s.users.some((x) => x.id !== u.id && x.role === "Gerencia" && x.active)) {
        fail("Debe quedar al menos un usuario activo de Gerencia.");
      }
      Array.isArray(b.office_ids) && !b.office_ids.length && fail("Asigne al menos una oficina.");
      const email = b.email ? str(b.email).toLowerCase() : u.email;
      s.users.some((x) => x.email === email && x.id !== u.id) && fail("Ya existe un usuario con ese correo.");
      Object.assign(u, { name: str(b.name) || u.name, email, role, active, phone: "phone" in b ? PERSON.properPhone(b.phone) : u.phone,
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
      return CM.filterCourts(s.courts.filter((c) => !text || nrm(c.name + " " + c.email + " " + c.code).includes(text)),
        { department: q.department, city: q.city, area: q.area })
        .sort((a, b) => (a.department + a.city + a.area + a.name).localeCompare(b.department + b.city + b.area + b.name, "es")).slice(0, Number(q.limit) || 500).map(clone);
    }],
    // Version 2.27: the link cannot open the Rama Judicial's site; the directory and other cases still suggest a name.
    ["GET", /^\/courts\/judge(?:\?(.*))?$/, (m, b, url) => {
      const q = qs(url);
      const c = s.courts.find((x) => x.id === Number(q.court_id));
      const courtName = c?.name || str(q.court_name);
      const count = new Map();
      if (courtName) for (const k of s.cases) if (k.judge_name && ((c && k.court_id === c.id) || k.court_name === courtName)) count.set(k.judge_name, (count.get(k.judge_name) || 0) + 1);
      return { rama: null, directory: c?.judge || "", others: [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).slice(0, 5).map((x) => x[0]),
        rama_error: "El enlace de pruebas no puede abrir la página de la Rama Judicial. En la App del servidor (Azure) el nombre del juez se trae con el radicado; aquí escríbalo a mano." };
    }],
    ["POST", /^\/courts\/import$/, (m, b) => {
      need("catalog.manage");
      if (b.replace && me().role !== "Gerencia") fail("Solo Gerencia puede reemplazar todo el directorio.");
      const out = { created: 0, updated: 0, skipped: [] };
      (b.rows || []).forEach((row, i) => {
        const name = str(row.name), department = canonDep(row.department);
        if (!name || !department) { out.skipped.push({ row: row.rowNumber ?? i + 2, reason: "Sin nombre o departamento." }); return; }
        const city = canonCity(row.city, department);
        const v = { code: str(row.code), name, department, city, circuit: CM.courtCircuit(name, row.circuit), area: inferArea(name, row.area), email: str(row.email).toLowerCase(), phone: str(row.phone), address: str(row.address), judge: str(row.judge).replace(/\s+/g, " "), updated_at: stamp() };
        const hit = s.courts.find((c) => c.name === name && c.city === city);
        if (hit) { Object.assign(hit, { ...v, judge: v.judge || hit.judge || "" }); out.updated++; } else { s.courts.push({ id: nextId(), city_code: "", ...v }); out.created++; }
      });
      return out;
    }],

    // ----- officials per entity (version 2.27), same rules as src/authorities.js -----
    ["GET", /^\/authorities(?:\?(.*))?$/, (m, b, url) => {
      const q = CM.entityKey(qs(url).q || "");
      return s.authorities.filter((x) => !q || (CM.entityKey(x.entity) + " " + CM.entityKey(x.name)).includes(q))
        .sort((a, b) => a.entity.localeCompare(b.entity, "es")).map(clone);
    }],
    ["POST", /^\/authorities$/, (m, b) => {
      authorityWriter();
      const v = authorityInput(b);
      const hit = s.authorities.find((x) => CM.entityKey(x.entity) === v.entity_key);
      if (hit) { Object.assign(hit, v, { updated_by: me().id, updated_at: stamp() }); return { ...clone(hit), updated: true }; }
      const row = { id: nextId(), ...v, updated_by: me().id, updated_at: stamp() };
      s.authorities.push(row);
      return clone(row);
    }],
    ["PUT", /^\/authorities\/(\d+)$/, (m, b) => {
      authorityWriter();
      const row = s.authorities.find((x) => x.id === +m[1]) || fail("No existe.");
      const v = authorityInput(b);
      const other = s.authorities.find((x) => x.id !== row.id && CM.entityKey(x.entity) === v.entity_key);
      if (other) fail(`Ya hay un funcionario guardado para «${other.entity}».`);
      Object.assign(row, v, { updated_by: me().id, updated_at: stamp() });
      return clone(row);
    }],
    ["DELETE", /^\/authorities\/(\d+)$/, (m) => { s.authorities = s.authorities.filter((x) => x.id !== +m[1]); return null; }],

    // ----- agenda -----
    ["GET", /^\/tasks(?:\?(.*))?$/, (m, b, url) => {
      const q = qs(url);
      return s.tasks.filter((t) => {
        const k = s.cases.find((x) => x.id === t.case_id);
        if (!k || !inScope(k.office_id)) return false;
        if (q.caseId && t.case_id !== +q.caseId) return false;
        if (q.mine === "1" && !(t.assigned_user_id === me().id || (!t.assigned_user_id && (k.assigned_user_id === me().id
          || (!k.assigned_user_id && t.created_by === me().id))))) return false;
        if (q.userId && (t.assigned_user_id || k.assigned_user_id) !== +q.userId) return false;
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
      const t = { id: nextId(), case_id: +b.case_id, created_by: me().id, created_at: stamp(), done_at: null, done_by: null, ...taskValues(b) };
      if (t.status === "hecha") Object.assign(t, { done_at: stamp(), done_by: me().id });
      s.tasks.push(t);
      logTask(null, t);
      const opts = noticeOpts(b.notify), notice = opts && t.status === "pendiente" ? sendNotice(t, opts) : null;
      if (!notice || notice.error) tellAssignee(t, null);
      return { ...taskOut(t), ...(notice ? { notice } : {}) };
    }],
    ["PUT", /^\/tasks\/(\d+)$/, (m, b) => {
      need("cases.write");
      const t = s.tasks.find((x) => x.id === +m[1]) || fail("La tarea no existe.");
      visibleCase(t.case_id);
      const prev = clone(t), before = t.due_at, assignee = t.assigned_user_id, wasDone = t.status === "hecha";
      Object.assign(t, taskValues(b, t));
      t.done_at = t.status === "hecha" ? t.done_at || stamp() : null;
      t.done_by = t.status === "hecha" ? (wasDone ? t.done_by ?? null : me().id) : null;
      logTask(prev, t);
      if (before !== t.due_at) s.notes = s.notes.filter((n) => !String(n.key || "").startsWith(`task:${t.id}:`));
      const opts = noticeOpts(b.notify), notice = opts && t.status === "pendiente" ? sendNotice(t, opts) : null;
      if (!notice || notice.error) tellAssignee(t, assignee);
      return { ...taskOut(t), ...(notice ? { notice } : {}) };
    }],
    ["POST", /^\/tasks\/(\d+)\/notify$/, (m, b) => {
      need("cases.write");
      const t = s.tasks.find((x) => x.id === +m[1]) || fail("La tarea no existe.");
      visibleCase(t.case_id);
      t.status === "pendiente" || fail("Esta tarea ya está cerrada.");
      const notice = sendNotice(t, noticeOpts(b || {}));
      if (notice.error) fail(notice.error);
      return notice;
    }],
    ["GET", /^\/tasks\/notify-channels$/, () => ({ email: false, whatsapp: false, link: true })],
    ["DELETE", /^\/tasks\/(\d+)$/, (m) => {
      need("cases.write");
      const t = s.tasks.find((x) => x.id === +m[1]);
      if (t) { visibleCase(t.case_id); logTask(clone(t), null); }
      s.tasks = s.tasks.filter((x) => x.id !== +m[1]);
      return null;
    }],
    ["GET", /^\/task-log(?:\?(.*))?$/, (m, b, url) => {
      const q = qs(url), caseId = +q.caseId;
      visibleCase(caseId);
      const name = (id) => shownName(s.users.find((u) => u.id === id)) || "";
      const rows = s.tasklog.filter((x) => x.case_id === caseId).map((x) => ({ ...clone(x), user_name: name(x.user_id), assigned_name: name(x.assigned_user_id) }));
      const logged = new Set(rows.map((x) => `${x.action}:${x.task_id}`));
      // Tasks from before version 2.18 show only what they kept: who created them and who closed them.
      for (const t of s.tasks.filter((x) => x.case_id === caseId)) {
        const base = { task_id: t.id, case_id: caseId, kind: t.kind, title: t.title, assigned_user_id: t.assigned_user_id ?? null, assigned_name: name(t.assigned_user_id), earlier: true };
        if (t.created_at && !logged.has(`creada:${t.id}`)) rows.push({ ...base, at: t.created_at, user_id: t.created_by ?? null, user_name: name(t.created_by), action: "creada", detail: "" });
        if (t.done_at && t.status === "hecha" && !logged.has(`hecha:${t.id}`)) rows.push({ ...base, at: t.done_at, user_id: t.done_by ?? null, user_name: name(t.done_by), action: "hecha", detail: t.done_notes || "" });
      }
      const uid = +q.userId || null;
      return rows.filter((x) => !uid || x.user_id === uid || x.assigned_user_id === uid)
        .sort((a, b) => String(b.at).localeCompare(String(a.at)) || (b.id || 0) - (a.id || 0));
    }],
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
    ["GET", /^\/monitor\/cases\/(\d+)\/actuaciones$/, (m) => { need("processes.consult"); visibleCase(+m[1]); return clone(window.JuanmaDecision.withDecisions(s.acts.filter((a) => a.case_id === +m[1]).sort((a, b) => b.fecha.localeCompare(a.fecha)))); }],
    ["PUT", /^\/monitor\/cases\/(\d+)\/monitor$/, (m, b) => { need("processes.consult"); visibleCase(+m[1]).monitor = b.monitor ? 1 : 0; return { id: +m[1], monitor: !!b.monitor }; }],
    ["POST", /^\/monitor\/check$/, () => { need("processes.consult"); fail(NEEDS_SERVER.rama); }],
    ["POST", /^\/monitor\/cases\/(\d+)\/check-all$/, () => { need("processes.consult"); fail(NEEDS_SERVER.rama); }],
    ["POST", /^\/monitor\/cases\/(\d+)\/rama$/, () => { need("processes.consult"); fail(NEEDS_SERVER.rama); }],
    ["GET", /^\/monitor\/portal-probe$/, () => fail("La prueba de conexión con los portales se hace desde la app en Azure (este enlace no se conecta a sitios externos).")],
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
      const lines = [`TecjuridicosApp · Reporte de procesos · ${bogotaNow()} (hora Colombia)`, "", `Procesos consultados: ${ids.length}. Actuaciones nuevas: ${news.length}.`];
      if (news.length) { lines.push("", "ACTUACIONES NUEVAS"); for (const a of news) lines.push(`• ${window.JuanmaPortals.formatRadicado(s.cases.find((k) => k.id === a.case_id).radicado)} · ${a.fecha} · ${a.actuacion}`); }
      lines.push("", "Enlace de prueba: con la app instalada el reporte sale por correo y WhatsApp a las horas elegidas.");
      const channels = [p.by_email && { channel: "email", ok: false, detail: "Requiere la app instalada." }, p.by_whatsapp && { channel: "whatsapp", ok: false, detail: "Requiere la app instalada." }].filter(Boolean);
      s.log.push({ id: nextId(), user_id: me().id, sent_at: stamp(), ms: Date.now(), trigger: "manual", channels, summary: lines.join("\n") });
      s.notes.push({ id: nextId(), user_id: me().id, kind: "reporte", title: "Reporte de procesos (manual)", body: `${ids.length} procesos · ${news.length} actuaciones nuevas`, link: "#consulta", key: null, created_at: stamp(), read_at: null });
      return { text: lines.join("\n"), caseCount: ids.length, newCount: news.length, channels };
    }],
    ["GET", /^\/monitor\/log$/, () => { need("processes.consult"); return clone(s.log.filter((l) => l.user_id === me().id).reverse()); }],

    // ----- clients -----
    ["GET", /^\/clients\/(\d+)$/, (m) => {
      const c = s.clients.find((x) => x.id === +m[1] && clientVisible(x)) || fail("El cliente no existe.");
      return clientOut(c, true);
    }],
    ["GET", /^\/clients(?:\?(.*))?$/, (m, b, url) => {
      const q = qs(url);
      return s.clients
        .filter((c) => clientVisible(c) && window.JuanmaPerson.clientMatches(c, q.q || "", q.by || ""))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "es"))
        .map((c) => ({ ...clientOut(c), case_count: s.cases.filter((k) => (k.client_id === c.id || isPartyClient(k, c.id)) && inScope(k.office_id)).length }));
    }],
    ["POST", /^\/clients$/, (m, b) => {
      need("clients.write");
      const c = { id: nextId(), created_at: stamp(), foto: "No" };
      for (const f of CLIENT_FIELDS) c[f] = str(b[f]);
      Object.assign(c, nameFields(b));
      c.id_number = c.id_number.replace(/\s+/g, "");
      placeClient(c);
      c.office_id = officeFor(b.office_id);
      s.clients.push(c);
      return clientOut(c, true);
    }],
    ["PUT", /^\/clients\/(\d+)$/, (m, b) => {
      need("clients.write");
      const c = s.clients.find((c) => c.id === +m[1] && clientVisible(c)) || fail("El cliente no existe.");
      const names = nameFields(b, c);
      for (const f of CLIENT_FIELDS) if (f in b) c[f] = str(b[f]);
      Object.assign(c, names);
      c.id_number = c.id_number.replace(/\s+/g, "");
      placeClient(c);
      c.office_id = officeFor(b.office_id, c.office_id);
      return clientOut(c, true);
    }],
    // Optional photo (version 2.22), kept as a blob so the client buckets stay small; "" removes it.
    ["PUT", /^\/clients\/(\d+)\/photo$/, (m, b) => {
      need("clients.write");
      const c = s.clients.find((c) => c.id === +m[1] && clientVisible(c)) || fail("El cliente no existe.");
      const photo = str(b.photo);
      if (!photo) { delete s.blobs[`photo-${c.id}`]; c.foto = "No"; }
      else {
        /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo) || fail("La foto debe ser una imagen JPG, PNG o WebP.");
        photo.length <= 1500000 || fail("La foto es demasiado grande. Use una imagen más pequeña.");
        s.blobs[`photo-${c.id}`] = photo;
        c.foto = "Sí";
      }
      return clientOut(c, true);
    }],
    ["DELETE", /^\/clients\/(\d+)$/, (m) => {
      need("clients.delete");
      s.clients.some((c) => c.id === +m[1] && clientVisible(c)) || fail("El cliente no existe.");
      s.cases.some((k) => k.client_id === +m[1]) && fail("No se puede eliminar: tiene expedientes asociados.");
      s.clients = s.clients.filter((c) => c.id !== +m[1]);
      delete s.blobs[`photo-${m[1]}`];
      for (const r of s.consents) if (r.client_id === +m[1]) r.client_id = null; // the evidence stays, with the name and document
      return null;
    }],

    // ----- client authorizations (change 56), same records as the server's consent_records -----
    ["GET", /^\/clients\/(\d+)\/consents$/, (m) => consentsOut(consentClient(+m[1]).id)],
    ["POST", /^\/clients\/(\d+)\/consents$/, async (m, b) => {
      need("clients.write");
      const c = consentClient(+m[1]);
      str(b.typed_name) || fail("Escriba el nombre de quien autoriza.");
      /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.signature_png || "") || fail("Falta la firma en pantalla.");
      await recordConsents(c, b.answers || {}, { method: "presencial", user_agent: navigator.userAgent, typed_name: b.typed_name, typed_id: b.typed_id, signature_png: b.signature_png, note: b.note });
      return consentsOut(c.id);
    }],
    ["POST", /^\/clients\/(\d+)\/consents\/revoke$/, async (m, b) => {
      need("clients.write");
      const c = consentClient(+m[1]);
      LEGAL.consentItem(b.item) || fail("Autorización no válida.");
      str(b.note) || fail("Indique cómo pidió el cliente la revocación (por ejemplo, correo del 15/10/2026).");
      await recordConsents(c, { [b.item]: false }, { method: "revocacion", user_agent: navigator.userAgent, note: b.note });
      return consentsOut(c.id);
    }],
    ["POST", /^\/clients\/(\d+)\/consent-link$/, () => fail(NEEDS_SERVER.consent)],

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
      if ("body" in b && t.format === "markdown" && !b.file_base64) t.body = String(b.body).trim() ? String(b.body) : fail("La plantilla está vacía.");
      // Replacing with an updated Word file (version 2.16): a text template becomes a Word one.
      if (b.file_base64) {
        atob(String(b.file_base64).slice(0, 8)).slice(0, 2) !== "PK" && fail("El archivo no es un documento de Word (.docx) válido.");
        b.file_base64.length > 11200000 && fail("El archivo debe pesar menos de 8 MB.");
        s.blobs[`tpl-${t.id}`] = b.file_base64;
        t.filename = str(b.filename) || t.filename || `${t.name}.docx`;
        t.format = "docx";
        t.body = null;
      }
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
        .filter((k) => inScope(k.office_id) && (!q.clientId || k.client_id === +q.clientId || isPartyClient(k, +q.clientId)) && (!q.officeId || k.office_id === +q.officeId)
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
        assigned_user_id: checkAssignee(b.assigned_user_id, officeId), updated_at: stamp(),
        created_at: /^\d{4}-\d{2}-\d{2}$/.test(str(b.created_at)) && !Number.isNaN(Date.parse(b.created_at)) ? `${b.created_at} 00:00:00` : stamp(),
        last_checked_at: null, last_action_date: null, ...caseLocation(b), parties: caseParties(b.parties, c.id), case_number: CM.cleanCaseNumber(b.case_number),
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
        updated_at: stamp(), ...caseLocation(b, k), parties: "parties" in b ? caseParties(b.parties, k.client_id) : k.parties || [],
        case_number: "case_number" in b ? CM.cleanCaseNumber(b.case_number) : k.case_number ?? "",
      });
      return caseOut(k);
    }],
    // Folder numbers (version 2.18), same rules as the server.
    ["GET", /^\/folders\/next$/, () => ({ next: CM.nextFolder(usedFolders().map((x) => x.folder)) })],
    ["PUT", /^\/cases\/(\d+)\/folder$/, (m, b) => {
      need("cases.write");
      const k = visibleCase(+m[1]);
      const folder = str(b.folder).slice(0, 40);
      const catId = (s.types.find((t) => t.id === k.process_type_id) || fail("El subproceso no existe.")).category_id;
      const mine = s.fields.filter((f) => f.category_id === catId && CM.isFolderLabel(f.label));
      if (!folder && mine.some((f) => f.required)) fail("El número de carpeta es obligatorio en este tipo de proceso.");
      if (folder) {
        const other = usedFolders().find((x) => x.case_id !== k.id && CM.folderKey(x.folder) === CM.folderKey(folder));
        if (other) {
          const ok = s.cases.find((x) => x.id === other.case_id), oc = s.clients.find((c) => c.id === ok?.client_id);
          fail(`La carpeta ${other.folder} ya está asignada ${oc && clientVisible(oc) ? `al expediente «${ok.title || caseOut(ok).type_name}» de ${oc.full_name}` : "a otro expediente"}. Escriba otro número.`);
        }
      }
      const values = { ...k.field_values };
      for (const f of mine) delete values[f.id];
      if (folder) {
        let f = mine[0];
        if (!f) { f = { id: nextId(), category_id: catId, label: "No. Carpeta", field_type: "text", options: [], required: false, sort: s.fields.filter((x) => x.category_id === catId).length }; s.fields.push(f); }
        values[f.id] = folder;
      }
      Object.assign(k, { field_values: values, updated_at: stamp() });
      return caseOut(k);
    }],
    // «Número de expediente» (version 2.33), same rules as the server: case editors or the case's responsible.
    ["PUT", /^\/cases\/(\d+)\/number$/, (m, b) => {
      const k = visibleCase(+m[1]);
      if (!me().permissions.includes("cases.write") && k.assigned_user_id !== me().id) fail("Solo el funcionario asignado al expediente, o quien puede editar expedientes, cambia este número.");
      Object.assign(k, { case_number: CM.cleanCaseNumber(b.case_number), updated_at: stamp() });
      return caseOut(k);
    }],
    // «Cargar radicados» (version 2.24), same rules as the server.
    ["PUT", /^\/cases\/(\d+)\/radicado$/, (m, b) => {
      const k = visibleCase(+m[1]);
      if (!me().permissions.includes("cases.write") && k.assigned_user_id !== me().id) fail("Solo el funcionario asignado al expediente, o quien puede editar expedientes, cambia el radicado.");
      const fmt = window.JuanmaPortals.formatRadicado;
      const radicado = str(b.radicado).replace(/\D/g, "");
      if (radicado && radicado.length !== 23) fail(`El radicado debe tener 23 dígitos (tiene ${radicado.length}).`);
      if (radicado === (k.radicado || "")) return caseOut(k);
      if (k.radicado && !b.replace) fail(`Este expediente ya tiene el radicado ${fmt(k.radicado)}. Confirme si quiere cambiarlo.`);
      const other = radicado && s.cases.find((x) => x.id !== k.id && x.radicado === radicado);
      if (other) {
        const oc = s.clients.find((c) => c.id === other.client_id);
        fail(`El radicado ${fmt(radicado)} ya está en ${oc && clientVisible(oc) ? `el expediente «${other.title || caseOut(other).type_name}» de ${oc.full_name}` : "otro expediente"}.`);
      }
      const place = radicado && !k.department ? placeFromRad(radicado) : null;
      const monitor = !radicado ? 0 : "monitor" in b ? (b.monitor ? 1 : 0) : k.monitor ? 1 : 0; // v2.38: only the box
      Object.assign(k, { radicado, monitor, department: place?.department || k.department || "", city: place ? k.city || place.city : k.city || "", updated_at: stamp() });
      return caseOut(k);
    }],
    ["DELETE", /^\/cases\/(\d+)$/, (m) => {
      need("cases.delete"); visibleCase(+m[1]);
      s.cases = s.cases.filter((k) => k.id !== +m[1]);
      for (const d of s.casedocs.filter((x) => x.case_id === +m[1])) delete s.blobs[`doc-${d.id}`];
      s.casedocs = s.casedocs.filter((x) => x.case_id !== +m[1]);
      return null;
    }],
    // ----- documents saved to a case -----
    ["GET", /^\/cases\/(\d+)\/documents$/, (m) => {
      visibleCase(+m[1]);
      return s.casedocs.filter((d) => d.case_id === +m[1]).sort((a, b) => b.id - a.id).map((d) => ({ ...clone(d), created_by_name: userName(d.created_by) }));
    }],
    ["POST", /^\/cases\/(\d+)\/documents$/, async (m, b) => {
      need("cases.write"); visibleCase(+m[1]);
      const ext = String(b.filename || "").toLowerCase().match(/\.(docx|pdf)$/)?.[1] || fail("Solo se guardan archivos Word (.docx) o PDF.");
      const b64 = String(b.file_base64 || "");
      (!b64 || b64.length > 7000000) && fail("En el enlace de prueba el archivo debe pesar menos de 5 MB.");
      const head = atob(b64.slice(0, 8));
      (ext === "pdf" ? !head.startsWith("%PDF-") : !head.startsWith("PK")) && fail("El archivo no corresponde a su formato.");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const d = { id: nextId(), case_id: +m[1], name: (str(b.name) || str(b.filename)).slice(0, 200), filename: str(b.filename).slice(0, 200),
        mime: ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: bytes.length, sha256: hash, created_by: me().id, created_at: stamp() };
      s.blobs[`doc-${d.id}`] = b64;
      s.casedocs.push(d);
      return clone(d);
    }],
    ["GET", /^\/cases\/(\d+)\/documents\/(\d+)\/file$/, (m) => {
      visibleCase(+m[1]);
      const d = s.casedocs.find((x) => x.id === +m[2] && x.case_id === +m[1]) || fail("El documento no existe.");
      return { filename: d.filename, mime: d.mime, base64: s.blobs[`doc-${d.id}`] || fail("El archivo no está disponible.") };
    }],
    ["DELETE", /^\/cases\/(\d+)\/documents\/(\d+)$/, (m) => {
      need("cases.write"); visibleCase(+m[1]);
      s.casedocs = s.casedocs.filter((x) => !(x.id === +m[2] && x.case_id === +m[1]));
      delete s.blobs[`doc-${m[2]}`];
      return null;
    }],

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
            title: k.title, radicado: window.JuanmaPortals.formatRadicado(k.radicado || ""), role: k.client_role || "", affiliated: k.affiliated ? "Sí" : "No", status: k.status, assigned: k.assigned_name || "", counterparty: k.counterparty, created: day(k.created_at), updated: day(k.updated_at) };
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
          const g = groups.get(key) || { user: k.assigned_name || "Sin responsable", role: (({ hidden, role } = s.users.find((u) => u.id === key) || {}) => (hidden ? ASSISTANT : role || ""))(), cases: 0, active: 0, closed: 0 };
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

  // ----- e-signature: in person on this device, or by private link + one-time code (change 61) -----
  // On the link the messages cannot leave by themselves: the app prepares the link and the code
  // and the office sends them from its own WhatsApp or e-mail. The signer opens the same link
  // (#firmar-CODE, or types the request code on the sign-in screen) and signs with the code.
  const hideSecrets = ({ token_hash, otp_hash, otp_expires_at, otp_attempts, ...x }) => x;
  const signOut = (r) => ({
    ...clone(r), doc_text: r.doc_kind === "markdown" ? s.blobs[`signtxt-${r.id}`] || "" : null, has_pdf: !!s.blobs[`signpdf-${r.id}`],
    signers: r.signers.map((x) => ({ ...hideSecrets(clone(x)), signature_png: s.blobs[`sig-${r.id}-${x.id}`] || null })),
  });
  // A signer may have signed from another device: read the requests as stored now before using them.
  async function syncSigns() {
    const now = await window.JuanmaStore.refresh?.("signs", "sig-");
    if (!now) return;
    s.signs = now.items;
    Object.assign(s.blobs, now.blobs);
  }
  const SIGN_LINK = window.JUANMA_LINK_URL || "";
  const OTP_HOURS = 24;
  const CODE_ABC = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const newSignToken = () => { const c = [...crypto.getRandomValues(new Uint32Array(8))].map((x) => CODE_ABC[x % CODE_ABC.length]).join(""); return `${c.slice(0, 4)}-${c.slice(4)}`; };
  const normSignToken = (t) => String(t || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");
  const newOtp = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const maskMail = (e) => String(e || "").replace(/^(.{2}).*(@.*)$/, "$1•••$2");
  const maskTel = (p) => { const d = String(p || "").replace(/\D/g, ""); return d ? `•••${d.slice(-4)}` : ""; };
  const VIA = { email: "correo", whatsapp: "WhatsApp", sms: "SMS" };
  // New link code and one-time code for a signer (the old ones stop working). Only their hashes are kept.
  async function issueLink(r, x) {
    const token = newSignToken(), otp = newOtp();
    x.token_hash = await shaText(token);
    x.otp_hash = await shaText(`${x.id}:${otp}`);
    x.otp_expires_at = new Date(Date.now() + OTP_HOURS * 3600000).toISOString();
    x.otp_attempts = 0;
    x.otp_sent_at = stamp();
    const codeVia = x.otp_channel === "email" || !x.phone ? "email" : "whatsapp";
    const linkVia = x.email ? "email" : "whatsapp";
    const link = SIGN_LINK ? `${SIGN_LINK}#firmar-${token}` : "";
    const firm = paySettings().firm_name || "TEC Jurídicos";
    // Same parts as the server's e-mail; the office chose which ones go (version 2.8).
    const ask = policiesFor(r, x);
    const parts = LEGAL.signMailParts({ name: x.name, message: r.message, title: r.title, link, code_via: VIA[codeVia],
      policies: (ask?.items || []).map((i) => ({ title: i.title })), version: LEGAL.legalVersion().name }, r.mail_opts);
    const at = parts.findIndex((p) => p.key === "link");
    parts.splice(at + 1, 0, { text: `Código de la solicitud: ${token} (si la página se lo pide, escríbalo en «¿Le enviaron un documento para firmar?»).` });
    if (!link) parts.splice(at, 1);
    const link_text = parts.map((p) => p.text).join("\n\n");
    const code_text = `${firm}: su código para firmar «${r.title.slice(0, 60)}» es ${otp}. Vence en ${OTP_HOURS} horas. No lo comparta.`;
    signEvent(r, x.id, "enlace_generado", `Enlace por ${VIA[linkVia]} (${linkVia === "email" ? maskMail(x.email) : maskTel(x.phone)}) y código por ${VIA[codeVia]} (${codeVia === "email" ? maskMail(x.email) : maskTel(x.phone)}); los envía ${me().name} desde su equipo.`);
    return { signer_id: x.id, name: x.name, ok: true, manual: true, token, otp, link, link_via: linkVia, code_via: codeVia,
      email: x.email, wa: PERSON.mobileDigits(x.phone), subject: `Documento para firmar: ${r.title}`, link_text, code_text, hours: OTP_HOURS };
  }
  // Same as the server's clientForSigner: the signer is a client of the firm (same document, or the case's client with the same e-mail).
  const digitsOf = (v) => String(v || "").replace(/\D/g, "");
  const signerClient = (r, x) => {
    const d = digitsOf(x.id_number);
    if (d.length >= 5) { const c = s.clients.find((y) => digitsOf(y.id_number) === d); if (c) return c; }
    const k = r.case_id && s.cases.find((y) => y.id === r.case_id);
    const c = k && s.clients.find((y) => y.id === k.client_id);
    return c && x.email && c.email && c.email.toLowerCase() === x.email.toLowerCase() ? c : null;
  };
  // Same as the server's policiesFor: only with the services contract, only the items the office left in the message and not answered yet.
  const policiesFor = (r, x) => {
    if (!LEGAL.isServiceContract(r.title)) return null;
    const client = signerClient(r, x);
    if (!client) return null;
    const items = LEGAL.policyItemsToAsk(r.title, r.mail_opts, s.consents.filter((y) => y.client_id === client.id).map((y) => y.item));
    return items.length ? { client, items } : null;
  };
  async function bySignToken(token) {
    await syncSigns();
    const code = normSignToken(token);
    /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code) || fail("El código de la solicitud no es válido. Revise el mensaje que le llegó.");
    const h = await shaText(code);
    for (const r of s.signs) { const x = r.signers.find((y) => y.token_hash === h); if (x) return { r, x }; }
    fail("El enlace o el código de la solicitud no es válido o fue reemplazado por uno nuevo. Pida que se lo envíen de nuevo.");
  }
  const signerView = (r, x) => ({
    title: r.title, message: r.message, doc_kind: r.doc_kind, doc_text: r.doc_kind === "markdown" ? s.blobs[`signtxt-${r.id}`] || "" : null, doc_hash: r.doc_hash,
    request_status: r.status, signed: r.status === "completada",
    stamp_page: r.stamp_page, stamp_pos: r.stamp_pos, signers_count: r.signers.length,
    signer: { name: x.name, status: x.status, signed_at: x.signed_at, otp_channel: x.otp_channel, email: maskMail(x.email), phone: maskTel(x.phone) },
    consent: x.status === "pendiente" && r.status === "enviada" && policiesFor(r, x) ? { items: policiesFor(r, x).items, version: LEGAL.legalVersion().name } : undefined,
  });
  async function finishIfAll(r) {
    if (!r.signers.every((y) => y.status === "firmado")) return;
    r.status = "completada"; r.completed_at = stamp();
    signEvent(r, null, "completada", "Todos los firmantes firmaron.");
    const notes = await window.JuanmaStore.refresh?.("notes");
    if (notes) s.notes = notes.items;
    s.notes.push({ id: nextId(), user_id: r.created_by, kind: "firma", title: "Documento firmado por todos", body: r.title, link: "#firmas", key: null, created_at: stamp(), read_at: null });
  }
  const signVisible = (r) => inScope(r.office_id) || r.created_by === me().id;
  const getSign = (id) => s.signs.find((r) => r.id === id && signVisible(r)) || fail("La solicitud no existe.");
  const signEvent = (r, signerId, event, detail = "") => r.events.push({ id: nextId(), request_id: r.id, signer_id: signerId, event, detail, ip: "", at: stamp(), created_at: stamp() });
  const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Same 10-character codes as src/verify-code.js.
  const newVerifyCode = () => {
    const A = "23456789ABCDEFGHJKMNPQRSTUVWXYZ", v = crypto.getRandomValues(new Uint32Array(10));
    const c = [...v].map((x) => A[x % A.length]).join("");
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  };
  const signedName = (title) => `${String(title).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w .-]+/g, "").trim().slice(0, 80) || "documento"} - firmado.pdf`;
  // The signed PDF is built once and kept, so every copy has the same SHA-256 and can be verified.
  async function ensureSignedPdf(r) {
    if (r.status !== "completada") fail("El documento aún no está firmado por todos.");
    if (!s.blobs[`signedpdf-${r.id}`]) {
      r.verify_code ||= newVerifyCode();
      const original = s.blobs[`signpdf-${r.id}`] ? b64bytes(s.blobs[`signpdf-${r.id}`]) : null;
      const blob = await window.JuanmaPdf.signedPdf({ ...signOut(r) }, original);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      s.blobs[`signedpdf-${r.id}`] = btoa(bin);
      r.signed_sha256 = await sha256(bytes);
      signEvent(r, null, "pdf_firmado_generado", `SHA-256 ${r.signed_sha256}`);
      await save();
    }
    return { filename: signedName(r.title), sha256: r.signed_sha256, base64: s.blobs[`signedpdf-${r.id}`] };
  }
  const b64bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  routes.push(
    ["GET", /^\/esign$/, async () => { need("esign.use"); await syncSigns(); return s.signs.filter(signVisible).slice().reverse().map(signOut); }],
    ["GET", /^\/esign\/(\d+)$/, async (m) => { need("esign.use"); await syncSigns(); return signOut(getSign(+m[1])); }],
    ["GET", /^\/esign\/(\d+)\/signed$/, async (m) => { need("esign.use"); await syncSigns(); return ensureSignedPdf(getSign(+m[1])); }],
    // The signer's page (no sign-in: the request code is the credential, the one-time code proves the phone or e-mail).
    ["GET", /^\/public\/sign\/([\w-]+)$/, async (m) => { const { r, x } = await bySignToken(m[1]); return signerView(r, x); }],
    ["GET", /^\/public\/sign\/([\w-]+)\/pdf$/, async (m) => {
      const { r } = await bySignToken(m[1]);
      s.blobs[`signpdf-${r.id}`] || fail("La solicitud no tiene PDF.");
      return { name: r.doc_name, base64: s.blobs[`signpdf-${r.id}`] };
    }],
    ["GET", /^\/public\/sign\/([\w-]+)\/signed$/, async (m) => ensureSignedPdf((await bySignToken(m[1])).r)],
    ["POST", /^\/public\/sign\/([\w-]+)\/sign$/, async (m, b) => {
      const { r, x } = await bySignToken(m[1]);
      (x.status !== "pendiente" || r.status !== "enviada") && fail("Este documento ya no está pendiente de su firma.");
      (!x.otp_hash || Date.parse(x.otp_expires_at) < Date.now()) && fail("El código de verificación venció. Pida a la firma que le envíe uno nuevo.");
      x.otp_attempts >= 5 && fail("Demasiados intentos con un código equivocado. Pida a la firma que le envíe uno nuevo.");
      (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.signature_png || "") || b.signature_png.length > 400000) && fail("Dibuje su firma.");
      str(b.typed_name).length >= 3 || fail("Escriba su nombre completo.");
      b.accept || fail("Debe aceptar el documento para firmarlo.");
      const ask = policiesFor(r, x), client = ask?.client;
      if (ask) for (const i of ask.items) typeof b.consents?.[i.key] === "boolean" || fail(`Responda si acepta o no: ${i.title}.`);
      if ((await shaText(`${x.id}:${String(b.otp ?? "").replace(/\D/g, "")}`)) !== x.otp_hash) {
        x.otp_attempts = (x.otp_attempts || 0) + 1;
        signEvent(r, x.id, "codigo_incorrecto", `Intento ${x.otp_attempts} de 5`);
        await save();
        fail(x.otp_attempts >= 5 ? "Código incorrecto. Ya no quedan intentos: pida a la firma un código nuevo." : `Código incorrecto. Le quedan ${5 - x.otp_attempts} intento(s).`);
      }
      const via = x.otp_channel === "email" || !x.phone ? `correo ${maskMail(x.email)}` : `WhatsApp ${maskTel(x.phone)}`;
      Object.assign(x, { status: "firmado", method: "enlace_otp", otp_channel: x.otp_channel === "email" || !x.phone ? "email" : "whatsapp",
        signed_at: stamp(), user_agent: navigator.userAgent.slice(0, 300), typed_name: str(b.typed_name), otp_hash: null });
      s.blobs[`sig-${r.id}-${x.id}`] = b.signature_png;
      signEvent(r, x.id, "firmado", `OTP verificado por ${via} · SHA-256 ${r.doc_hash}`);
      if (client) {
        await window.JuanmaStore.refresh?.("consents").then((now) => { if (now) s.consents = now.items; });
        await recordConsents(client, Object.fromEntries(ask.items.map((i) => [i.key, b.consents[i.key]])), { method: "firma", byClient: true, user_agent: navigator.userAgent, typed_name: b.typed_name, typed_id: x.id_number,
          note: `Firma de «${r.title}» (solicitud N.º ${r.id})` });
        signEvent(r, x.id, "politicas_respondidas", ask.items.map((i) => `${i.key}: ${b.consents[i.key] ? "sí" : "no"}`).join(" · "));
      }
      await finishIfAll(r);
      return signerView(r, x);
    }],
    ["POST", /^\/public\/sign\/([\w-]+)\/reject$/, async (m, b) => {
      const { r, x } = await bySignToken(m[1]);
      (x.status !== "pendiente" || r.status !== "enviada") && fail("Este documento ya no está pendiente.");
      Object.assign(x, { status: "rechazado", reject_reason: str(b.reason).slice(0, 500), otp_hash: null });
      r.status = "rechazada";
      signEvent(r, x.id, "rechazado", str(b.reason).slice(0, 500));
      return signerView(r, x);
    }],
    ["POST", /^\/public\/verify$/, async (m, b) => {
      await syncSigns();
      const hash = String(b.sha256 || "").toLowerCase();
      const code = String(b.code || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^(.{5})(.{5})$/, "$1-$2");
      const describe = (r, match) => ({ match, title: r.title, status: r.status, created_at: r.created_at, completed_at: r.completed_at, verify_code: r.verify_code,
        doc_hash: r.doc_hash, signed_sha256: r.signed_sha256 || null,
        signers: r.signers.map((x) => ({ name: x.name, id_type: x.id_type, id_number: x.id_number ? `•••${String(x.id_number).replace(/\D/g, "").slice(-3)}` : "",
          status: x.status, method: x.method, otp_channel: x.otp_channel, signed_at: x.signed_at })) });
      if (/^[0-9a-f]{64}$/.test(hash)) {
        const signed = s.signs.find((r) => r.signed_sha256 === hash);
        if (signed) return describe(signed, "firmado");
        const original = s.signs.find((r) => r.doc_hash === hash);
        return original ? describe(original, "original") : { match: "ninguno" };
      }
      if (/^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(code)) { const r = s.signs.find((x) => x.verify_code === code); return r ? describe(r, "codigo") : { match: "ninguno" }; }
      fail("Cargue el archivo o escriba el código de verificación.");
    }],
    ["GET", /^\/esign\/(\d+)\/pdf$/, (m) => {
      need("esign.use");
      const r = getSign(+m[1]);
      s.blobs[`signpdf-${r.id}`] || fail("La solicitud no tiene PDF.");
      return { name: r.doc_name, base64: s.blobs[`signpdf-${r.id}`] };
    }],
    ["POST", /^\/esign$/, async (m, b) => {
      need("esign.use");
      const remote = b.mode !== "presencial";
      const title = str(b.title) || fail("Escriba el nombre del documento.");
      const signers = (Array.isArray(b.signers) ? b.signers : []).map((x) => ({ name: str(x.name), id_type: str(x.id_type) || "CC", id_number: str(x.id_number),
        email: str(x.email).toLowerCase(), phone: str(x.phone), otp_channel: ["email", "whatsapp"].includes(x.otp_channel) ? x.otp_channel : "email" }));
      (!signers.length || signers.length > 10) && fail("Agregue entre 1 y 10 firmantes.");
      const problem = PERSON.signersProblem(signers, { remote });
      problem && fail(problem.message);
      remote && !SIGN_LINK && fail("Este archivo no conoce la dirección del enlace de prueba; use la firma presencial.");
      await syncSigns();
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
        message: str(b.message), status: "enviada", created_by: me().id, created_at: stamp(), completed_at: null, signers: [], events: [],
        stamp_page: /^(last|first|all|new|\d{1,3})$/.test(str(b.stamp_page)) ? str(b.stamp_page) : "last",
        stamp_pos: ["br", "bc", "bl", "tr", "tl"].includes(b.stamp_pos) || /^at:(0(\.\d{1,4})?|1(\.0{1,4})?),(0(\.\d{1,4})?|1(\.0{1,4})?)$/.test(str(b.stamp_pos)) ? str(b.stamp_pos) : "br", notify: b.notify !== false, verify_code: newVerifyCode(),
        mail_opts: LEGAL.mailOptions(b.mail) };
      for (const x of signers) r.signers.push({ id: nextId(), ...x, status: "pendiente", method: null, signed_at: null, ip: "", user_agent: "", typed_name: "", reject_reason: null, otp_sent_at: null });
      if (pdf) s.blobs[`signpdf-${r.id}`] = pdf; else s.blobs[`signtxt-${r.id}`] = text;
      signEvent(r, null, "creada", `${me().name} · SHA-256 ${hash}`);
      const delivery = [];
      if (remote) for (const x of r.signers) delivery.push(await issueLink(r, x));
      s.signs.push(r);
      return { ...signOut(r), delivery };
    }],
    ["POST", /^\/esign\/(\d+)\/remind\/(\d+)$/, async (m) => {
      need("esign.use");
      await syncSigns();
      const r = getSign(+m[1]);
      const x = r.signers.find((y) => y.id === +m[2]);
      (!x || r.status !== "enviada" || x.status !== "pendiente") && fail("Este firmante no tiene firma pendiente.");
      PERSON.signerProblem(x, { remote: true }) && fail(PERSON.signerProblem(x, { remote: true }).message);
      return issueLink(r, x);
    }],
    ["POST", /^\/esign\/(\d+)\/cancel$/, async (m) => {
      need("esign.use");
      await syncSigns();
      const r = getSign(+m[1]);
      r.status !== "enviada" && fail("Solo se cancelan solicitudes en curso.");
      r.status = "cancelada";
      signEvent(r, null, "cancelada", me().name);
      return signOut(r);
    }],
    ["POST", /^\/esign\/(\d+)\/in-person\/(\d+)$/, async (m, b) => {
      need("esign.use");
      await syncSigns();
      const r = getSign(+m[1]);
      const x = r.signers.find((y) => y.id === +m[2]);
      (!x || r.status !== "enviada" || x.status !== "pendiente") && fail("Este firmante no tiene firma pendiente.");
      (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.signature_png || "") || b.signature_png.length > 400000) && fail("Dibuje la firma.");
      str(b.typed_name) || fail("Escriba el nombre completo del firmante.");
      b.accept || fail("El firmante debe aceptar el documento.");
      Object.assign(x, { status: "firmado", method: "presencial", signed_at: stamp(), user_agent: navigator.userAgent.slice(0, 300), typed_name: str(b.typed_name), otp_hash: null });
      if (str(b.id_number)) x.id_number = str(b.id_number);
      s.blobs[`sig-${r.id}-${x.id}`] = b.signature_png;
      signEvent(r, x.id, "firmado_presencial", `Testigo: ${me().name} · SHA-256 ${r.doc_hash}`);
      await finishIfAll(r);
      return signOut(r);
    }],
    // ----- certified e-mail: needs the server's mail account -----
    ["GET", /^\/mail\/status$/, () => { need("mail.send"); return { configured: false, message: NEEDS_SERVER.mail }; }],
    ["GET", /^\/mail$/, () => { need("mail.send"); return []; }],
    ["POST", /^\/mail$/, () => { need("mail.send"); fail(NEEDS_SERVER.mail); }],
  );

  // ----- payments: charges, receipts, portfolio, reminders (same rules as src/payments.js) -----
  const PAY_DEFAULTS = { auto: false, days_before: 3, repeat_days: 7, pay_info: "", firm_name: "Tecjuridicos S.A.S.", firm_nit: "901.269.714-4", channels: ["email"], receipt_start: LG.RECEIPT_START };
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const money = (v) => (typeof v === "number" ? Math.round(v) : Number(String(v ?? "").replace(/[^\d]/g, "")));
  const todayCO = () => bogotaNow().slice(0, 10);
  const paySettings = () => {
    const saved = { ...(s.payset || {}) };
    if (!saved.firm_name || saved.firm_name === "TEC Jurídicos") delete saved.firm_name; // version 2.4: legal name and NIT by default
    if (!saved.firm_nit) delete saved.firm_nit;
    return { ...PAY_DEFAULTS, ...saved };
  };
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
  const userName = (id) => shownName(s.users.find((u) => u.id === id)) || "";

  function paymentsReport(type, q) {
    const { charges, receipts, credit } = ledger(null, +q.officeId || null);
    if (type === "cartera") {
      const rows = LG.clientRows(charges, credit, receipts, s.clients).map((r) => ({ client: r.client_name, doc: r.id_number, phone: r.phone,
        billed: r.billed, paid: r.paid, received: r.received, balance: r.balance, overdue: r.overdue, max_days: r.max_days, next_due: r.next_due || "", last_payment: r.last_payment || "" }));
      return { columns: [["client", "Cliente"], ["doc", "Documento"], ["phone", "Teléfono"], ["billed", "Facturado"], ["paid", "Aplicado a cobros"], ["received", "Total pagado"],
        ["balance", "Saldo"], ["overdue", "Vencido"], ["max_days", "Días de mora"], ["next_due", "Próximo vencimiento"], ["last_payment", "Último pago"]], rows };
    }
    const inRange = (d) => (!DATE.test(q.from || "") || d >= q.from) && (!DATE.test(q.to || "") || d <= q.to);
    const rows = receipts.filter((r) => inRange(r.paid_on)).sort((a, b) => a.number - b.number).map((r) => ({
      number: LG.receiptLabel(r.number), date: r.paid_on, client: s.clients.find((c) => c.id === r.client_id)?.full_name || "",
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
        received_total: receipts.filter((x) => !x.voided_at).reduce((a, x) => a + x.amount, 0),
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
      const r = { id: nextId(), number: LG.nextReceiptNumber(s.receipts.reduce((a, x) => Math.max(a, x.number), 0), paySettings().receipt_start), client_id: client.id, charge_id: charge?.id ?? null,
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
    ["GET", /^\/payments\/settings$/, () => {
      need("payments.manage");
      return { ...paySettings(), receipt_next: LG.nextReceiptNumber(s.receipts.reduce((a, x) => Math.max(a, x.number), 0), paySettings().receipt_start) };
    }],
    ["PUT", /^\/payments\/settings$/, (m, b) => {
      need("payments.manage");
      s.payset = { auto: !!b.auto, days_before: Math.min(30, Math.max(0, Number(b.days_before) || 0)), repeat_days: Math.min(60, Math.max(1, Number(b.repeat_days) || 7)),
        pay_info: str(b.pay_info).slice(0, 1500), firm_name: str(b.firm_name) || PAY_DEFAULTS.firm_name, firm_nit: str(b.firm_nit) || PAY_DEFAULTS.firm_nit,
        channels: (b.channels || ["email"]).filter((x) => ["email", "whatsapp"].includes(x)),
        receipt_start: Math.max(1, Math.round(Number(b.receipt_start) || paySettings().receipt_start)) };
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
      `Counterparty / addressee: ${req.counterparty || "[not provided]"}`, ...CM.recipientPrompt(req.recipient), "",
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
    signLink: !!(window.JUANMA_LINK_URL),
    async request(method, url, body) {
      await READY;
      const path = url.split("?")[0];
      const logged = method !== "GET" && !/^\/(notifications|auth\/|monitor\/report\/preview|admin\/hidden-users\/)/.test(path) && !/^\/admin\/users\/\d+\/hidden$/.test(path) && s.users.some((x) => x.id === currentId);
      if (method === "DELETE" && me().role !== "Gerencia") {
        auditChange(method, path, body, null, null, false); await save();
        fail("Solo Gerencia puede eliminar.");
      }
      for (const [m, re, fn] of routes) {
        const match = m === method && url.match(re);
        if (match) {
          const snap = logged ? auditSnap(path) : null;
          let out;
          try { out = await fn(match, body || {}, url); } catch (err) {
            if (logged && /permiso/.test(err.message)) { auditChange(method, path, body, null, snap, false); await save(); }
            throw err;
          }
          if (logged) auditChange(method, path, body, out, snap);
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
    demoUsers: () => (s ? s.users.filter((u) => u.active).map((u) => ({ email: u.email, name: shownName(u), role: u.hidden ? ASSISTANT : u.role, office: userOut(u).offices.map((o) => o.name).join(", ") })) : []),
    ready: () => READY,
    exportData: async () => { await READY; return JSON.stringify(s); },
  };
})();
