// In-browser stand-in for the Express API, used only by the preview build
// (scripts/build-preview.mjs). It mirrors the server's routes, roles and
// office scope closely enough to click through the app as each role. Data
// lives in this browser (localStorage when available). Drafts and case-law
// results are fixed, clearly labeled examples.
(function () {
  const SEED = window.JUANMA_SEED_CATALOG || [];
  const AUTH = window.JUANMA_AUTH || { roles: [], permissions: {}, matrix: {} };
  const REPORTS = window.JUANMA_REPORTS || {};
  const KEY = "juanmaapp-preview-v3";
  const OPEN = ["Abierto", "En trámite", "En espera de respuesta"];

  function fresh() {
    const s = { seq: 1, offices: [], users: [], matrix: JSON.parse(JSON.stringify(AUTH.matrix)), current: null,
      clients: [], categories: [], types: [], fields: [], cases: [], saved: [] };
    const id = () => s.seq++;
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const office = (name, city, is_main = false) => { const o = { id: id(), name, city, address: "", phone: "", email: "", is_main }; s.offices.push(o); return o; };
    const ibague = office("Ibagué", "Ibagué", true), bogota = office("Bogotá", "Bogotá"), neiva = office("Neiva", "Neiva");
    const user = (name, role, offs) => {
      const u = { id: id(), name, email: name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, ".") + "@ejemplo.co",
        role, active: true, office_ids: offs.map((o) => o.id), created_at: now };
      s.users.push(u);
      return u;
    };
    user("María Fernanda Ruiz", "Gerencia", [ibague]);
    user("Carlos Arango", "Director Jurídico", [ibague]);
    user("Patricia Lozano", "Director Contable", [ibague]);
    user("Jorge Méndez", "Gerente Regional", [bogota, neiva]);
    const laura = user("Laura Gómez", "Abogado", [ibague]);
    const andres = user("Andrés Torres", "Dependiente Judicial", [bogota]);
    user("Camila Rojas", "Asistente", [ibague]);

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
    const client = (full_name, id_number, email, phone, address, city, o) => {
      const c = { id: id(), full_name, id_type: "CC", id_number, email, phone, address, city, notes: "Cliente de ejemplo", office_id: o.id, created_at: now };
      s.clients.push(c);
      return c;
    };
    const ana = client("Ana María Pérez Gómez", "52.123.456", "ana.perez@ejemplo.co", "300 123 4567", "Cra 5 # 12-40", "Ibagué", ibague);
    const luis = client("Luis Fernando Rojas", "79.876.543", "luis.rojas@ejemplo.co", "310 987 6543", "Calle 50 # 12-30", "Bogotá", bogota);
    const rosa = client("Rosa Elena Cárdenas", "36.111.222", "rosa.cardenas@ejemplo.co", "315 222 3344", "Av. La Toma # 8-15", "Neiva", neiva);
    const typeId = (name) => s.types.find((t) => t.name === name).id;
    const kase = (c, type, title, status, counterparty, facts, values, o, assignee) => s.cases.push({
      id: id(), client_id: c.id, process_type_id: typeId(type), title, status, counterparty, facts, field_values: values,
      office_id: o.id, assigned_user_id: assignee?.id ?? null, created_at: now, updated_at: now });
    kase(ana, "Ejecutivo Laboral", "Cobro de prestaciones sociales", "En trámite", "Servicios Andinos S.A.S.",
      "La trabajadora laboró del 1 de febrero de 2023 al 30 de junio de 2026. A la terminación no se le pagaron cesantías ni prima del último semestre.",
      { [juzgado.id]: "Juzgado 2 Laboral del Circuito de Ibagué" }, ibague, laura);
    kase(luis, "Medio de Control de Reparación Directa", "Daños por obra pública", "Abierto", "Alcaldía de Bogotá",
      "El 12 de mayo de 2026 una excavación sin señalizar causó la caída del cliente.", { [etapa.id]: "Conciliación prejudicial" }, bogota, andres);
    kase(ana, "Reclamo ante la Fuente", "Reporte negativo sin aviso previo", "Abierto", "Banco de Ejemplo S.A.",
      "La cliente fue reportada en mora sin la comunicación previa de 20 días.", {}, ibague, null);
    kase(rosa, "Fijación de Cuota Alimentaria", "Cuota para dos hijos menores", "En espera de respuesta", "Padre de los menores",
      "Los menores viven con la madre desde enero de 2026 y el padre no aporta.", {}, neiva, null);
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

  // ----- session, permissions, scope -----
  const officeName = (id) => s.offices.find((o) => o.id === id)?.name || "";
  const permsOf = (role) => {
    const p = [...(s.matrix[role] || [])];
    if (role === "Gerencia" && !p.includes("users.manage")) p.push("users.manage");
    return p;
  };
  const userOut = (u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, created_at: u.created_at,
    offices: s.offices.filter((o) => u.office_ids.includes(o.id)).map((o) => ({ id: o.id, name: o.name })),
    permissions: permsOf(u.role),
  });
  const me = () => {
    const u = s.users.find((x) => x.id === s.current && x.active);
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
    if (!permsOf(u.role).includes("scope.all") && !u.office_ids.includes(officeId)) fail("El responsable no pertenece a la oficina del expediente.");
    return u.id;
  };

  const caseOut = (k) => {
    const t = s.types.find((t) => t.id === k.process_type_id);
    const c = s.categories.find((c) => c.id === t.category_id);
    const cl = s.clients.find((x) => x.id === k.client_id);
    const u = s.users.find((x) => x.id === k.assigned_user_id);
    return clone({ ...k, client_name: cl.full_name, type_name: t.name, category_id: c.id, category_name: c.name,
      office_name: officeName(k.office_id), assigned_name: u?.name ?? null });
  };
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
  const CLIENT_FIELDS = ["full_name", "id_type", "id_number", "email", "phone", "address", "city", "notes"];
  const savedVisible = (r) => scope() === null || r.created_by === me().id || (r.case_id && s.cases.some((k) => k.id === r.case_id && inScope(k.office_id)));
  const qs = (url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] || ""));

  const routes = [
    // ----- auth -----
    ["GET", /^\/auth\/status$/, () => {
      const u = s.users.find((x) => x.id === s.current && x.active);
      return { setupNeeded: false, user: u ? userOut(u) : null };
    }],
    ["POST", /^\/auth\/login$/, (m, b) => {
      const u = s.users.find((x) => x.email === str(b.email).toLowerCase() && x.active) || fail("Correo o contraseña incorrectos.");
      s.current = u.id;
      return { user: userOut(u) };
    }],
    ["POST", /^\/auth\/logout$/, () => { s.current = null; return null; }],
    ["POST", /^\/auth\/password$/, () => fail("En la vista previa no se cambian contraseñas.")],

    // ----- admin -----
    ["GET", /^\/admin\/offices$/, () => { me(); return s.offices.slice().sort((a, b) => b.is_main - a.is_main || a.name.localeCompare(b.name, "es")).map((o) => ({
      ...clone(o), case_count: s.cases.filter((k) => k.office_id === o.id).length,
      user_count: s.users.filter((u) => u.office_ids.includes(o.id)).length })); }],
    ["POST", /^\/admin\/offices$/, (m, b) => {
      need("users.manage");
      const name = str(b.name) || fail("El nombre de la oficina es obligatorio.");
      uniq(s.offices, name);
      const o = { id: nextId(), name, city: str(b.city), address: str(b.address), phone: str(b.phone), email: str(b.email), is_main: false };
      s.offices.push(o);
      return clone(o);
    }],
    ["PUT", /^\/admin\/offices\/(\d+)$/, (m, b) => {
      need("users.manage");
      const o = s.offices.find((x) => x.id === +m[1]) || fail("La oficina no existe.");
      for (const f of ["name", "city", "address", "phone", "email"]) if (f in b) o[f] = str(b[f]);
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
      AUTH.roles.includes(b.role) || fail("Rol no válido.");
      (typeof b.password === "string" && b.password.length >= 10) || fail("La contraseña inicial debe tener al menos 10 caracteres.");
      (b.office_ids || []).length || fail("Asigne al menos una oficina.");
      s.users.some((u) => u.email === email) && fail("Ya existe un usuario con ese correo.");
      const u = { id: nextId(), name, email, role: b.role, active: true, office_ids: b.office_ids.map(Number), created_at: stamp() };
      s.users.push(u);
      return userOut(u);
    }],
    ["PUT", /^\/admin\/users\/(\d+)$/, (m, b) => {
      need("users.manage");
      const u = s.users.find((x) => x.id === +m[1]) || fail("El usuario no existe.");
      const role = b.role ?? u.role;
      AUTH.roles.includes(role) || fail("Rol no válido.");
      const active = b.active === undefined ? u.active : !!b.active;
      if (u.role === "Gerencia" && (role !== "Gerencia" || !active) && !s.users.some((x) => x.id !== u.id && x.role === "Gerencia" && x.active)) {
        fail("Debe quedar al menos un usuario activo de Gerencia.");
      }
      b.password && b.password.length < 10 && fail("La contraseña debe tener al menos 10 caracteres.");
      Array.isArray(b.office_ids) && !b.office_ids.length && fail("Asigne al menos una oficina.");
      const email = b.email ? str(b.email).toLowerCase() : u.email;
      s.users.some((x) => x.email === email && x.id !== u.id) && fail("Ya existe un usuario con ese correo.");
      Object.assign(u, { name: str(b.name) || u.name, email, role, active });
      if (Array.isArray(b.office_ids)) u.office_ids = b.office_ids.map(Number);
      return userOut(u);
    }],
    ["GET", /^\/admin\/roles$/, () => { me(); return { roles: AUTH.roles, permissions: AUTH.permissions, matrix: Object.fromEntries(AUTH.roles.map((r) => [r, permsOf(r)])) }; }],
    ["PUT", /^\/admin\/roles\/(.+)$/, (m, b) => {
      need("users.manage");
      const role = decodeURIComponent(m[1]);
      AUTH.roles.includes(role) || fail("Rol no válido.");
      s.matrix[role] = (b.permissions || []).filter((p) => p in AUTH.permissions);
      return { role, permissions: permsOf(role) };
    }],

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
      c.office_id = officeFor(b.office_id);
      s.clients.push(c);
      return { ...clone(c), office_name: officeName(c.office_id) };
    }],
    ["PUT", /^\/clients\/(\d+)$/, (m, b) => {
      need("clients.write");
      const c = s.clients.find((c) => c.id === +m[1] && clientVisible(c)) || fail("El cliente no existe.");
      for (const f of CLIENT_FIELDS) if (f in b) c[f] = str(b[f]);
      c.full_name || fail("El nombre del cliente es obligatorio.");
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
      types: clone(s.types.filter((t) => t.category_id === c.id).sort((a, b) => a.sort - b.sort)),
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
      const siblings = s.types.filter((t) => t.category_id === +m[1]);
      uniq(siblings, name);
      const t = { id: nextId(), category_id: +m[1], name, sort: siblings.length };
      s.types.push(t);
      return clone(t);
    }],
    ["PUT", /^\/types\/(\d+)$/, (m, b) => {
      need("catalog.manage");
      const t = s.types.find((t) => t.id === +m[1]) || fail("El subproceso no existe.");
      const name = str(b.name) || fail("El nombre es obligatorio.");
      uniq(s.types.filter((x) => x.category_id === t.category_id), name, t.id);
      t.name = name;
      return clone(t);
    }],
    ["DELETE", /^\/types\/(\d+)$/, (m) => {
      need("catalog.manage");
      s.cases.some((k) => k.process_type_id === +m[1]) && fail("No se puede eliminar: tiene expedientes asociados.");
      s.types = s.types.filter((t) => t.id !== +m[1]);
      return null;
    }],
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
        status: str(b.status) || "Abierto", counterparty: str(b.counterparty), facts: str(b.facts),
        field_values: cleanValues(+b.process_type_id, b.field_values), office_id: officeId,
        assigned_user_id: checkAssignee(b.assigned_user_id, officeId), created_at: stamp(), updated_at: stamp(),
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
        process_type_id: typeId, title: str(b.title ?? k.title), status: str(b.status) || k.status,
        counterparty: str(b.counterparty ?? k.counterparty), facts: str(b.facts ?? k.facts),
        field_values: cleanValues(typeId, b.field_values ?? k.field_values), office_id: officeId,
        assigned_user_id: "assigned_user_id" in b ? checkAssignee(b.assigned_user_id, officeId) : k.assigned_user_id,
        updated_at: stamp(),
      });
      return caseOut(k);
    }],
    ["DELETE", /^\/cases\/(\d+)$/, (m) => { need("cases.delete"); visibleCase(+m[1]); s.cases = s.cases.filter((k) => k.id !== +m[1]); return null; }],

    // ----- case law (fictitious examples, never verified) -----
    ["POST", /^\/jurisprudencia\/search$/, (m, b) => {
      need("jurisprudence.use");
      str(b.query) || fail("Escriba qué busca.");
      const court = { CC: "Corte Constitucional", CSJ: "Corte Suprema de Justicia", CE: "Consejo de Estado", TRIB: "Tribunal Superior" }[b.court];
      return {
        notes: "Vista previa: estos resultados son EJEMPLOS FICTICIOS para mostrar la pantalla. En la app real la búsqueda consulta las relatorías oficiales.",
        results: [
          { court: court || "Corte Constitucional", sala: b.sala || "", reference: "T-000 de 2026 (ejemplo ficticio)", date: null, reporting_judge: null,
            topic: `Ejemplo de resultado para: «${str(b.query)}».`, url: "", verified: false },
          { court: court || "Consejo de Estado", sala: b.sala || "", reference: "Radicado 00000-00-00-000-2026-00000-00 (ejemplo ficticio)", date: null, reporting_judge: null,
            topic: "Segundo ejemplo de resultado. Así se ve una sentencia sin fuente oficial verificada.", url: "", verified: false },
        ],
      };
    }],
    ["POST", /^\/jurisprudencia\/analyze$/, (m, b) => {
      need("jurisprudence.use");
      return {
        found: true, verified: false, court: "Ejemplo", sala: "", reference: (str(b.reference) || "Sentencia") + " (análisis de ejemplo)",
        date: null, reporting_judge: null, url: "",
        summary: "Vista previa: este análisis es un ejemplo de formato. En la app real NomosAI lee la sentencia en la relatoría oficial y redacta aquí el resumen.",
        legal_problem: "Aquí aparece el problema jurídico que resolvió la Corte.",
        facts: "Aquí aparecen los hechos relevantes.", ratio_decidendi: "Aquí aparece la regla de decisión.",
        decision: "Aquí aparece lo que resolvió (parte resolutiva).", dissents: null, cited_norms: ["Normas citadas por la sentencia"],
        key_quotes: [{ text: "Las citas textuales se copian literalmente de la sentencia.", section: "Consideraciones" }], notes: "",
      };
    }],
    ["POST", /^\/jurisprudencia\/verify$/, (m, b) => {
      need("jurisprudence.use");
      return {
        citation: str(b.citation), exists: "unknown", supports_claim: "unknown", verified: false, correct_reference: "", url: "", supporting_quote: null,
        explanation: "Vista previa: la verificación real consulta la relatoría oficial y confirma si la sentencia existe y respalda lo que se afirma.",
      };
    }],
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
      const statusOk = (st) => !q.status || (q.status === "activos" ? OPEN.includes(st) : q.status === "cerrados" ? st === "Cerrado" : st === q.status);
      const cases = s.cases.filter((k) => officeOk(k.office_id)).map(caseOut);
      let columns, rows;
      if (type === "expedientes") {
        columns = [["office", "Oficina"], ["client", "Cliente"], ["doc", "Documento"], ["category", "Tipo de proceso"], ["type", "Subproceso"],
          ["title", "Asunto"], ["status", "Estado"], ["assigned", "Responsable"], ["counterparty", "Contraparte"], ["created", "Creado"], ["updated", "Actualizado"]];
        rows = cases.filter((k) => inRange(k.created_at) && statusOk(k.status) && (!q.categoryId || k.category_id === +q.categoryId)
          && (!q.assignedUserId || k.assigned_user_id === +q.assignedUserId)).map((k) => {
          const c = s.clients.find((x) => x.id === k.client_id);
          return { office: k.office_name, client: k.client_name, doc: `${c.id_type} ${c.id_number}`.trim(), category: k.category_name, type: k.type_name,
            title: k.title, status: k.status, assigned: k.assigned_name || "", counterparty: k.counterparty, created: day(k.created_at), updated: day(k.updated_at) };
        });
      } else if (type === "clientes") {
        columns = [["office", "Oficina"], ["name", "Nombre"], ["doc", "Documento"], ["email", "Correo"], ["phone", "Teléfono"], ["city", "Ciudad"], ["cases", "Expedientes"], ["created", "Creado"]];
        rows = s.clients.filter((c) => clientVisible(c) && (!q.officeId || c.office_id === +q.officeId) && inRange(c.created_at)).map((c) => ({
          office: officeName(c.office_id), name: c.full_name, doc: `${c.id_type} ${c.id_number}`.trim(), email: c.email, phone: c.phone, city: c.city,
          cases: s.cases.filter((k) => k.client_id === c.id).length, created: day(c.created_at) }));
      } else if (type === "oficinas") {
        columns = [["office", "Oficina"], ["city", "Ciudad"], ["clients", "Clientes"], ["cases", "Expedientes"], ["active", "Activos"], ["closed", "Cerrados"], ["unassigned", "Sin responsable"], ["users", "Usuarios"]];
        rows = s.offices.filter((o) => officeOk(o.id)).map((o) => {
          const ks = s.cases.filter((k) => k.office_id === o.id);
          return { office: o.name, city: o.city, clients: s.clients.filter((c) => c.office_id === o.id).length, cases: ks.length,
            active: ks.filter((k) => OPEN.includes(k.status)).length, closed: ks.filter((k) => k.status === "Cerrado").length,
            unassigned: ks.filter((k) => !k.assigned_user_id).length, users: s.users.filter((u) => u.office_ids.includes(o.id)).length };
        });
      } else if (type === "responsables") {
        columns = [["user", "Responsable"], ["role", "Rol"], ["cases", "Expedientes"], ["active", "Activos"], ["closed", "Cerrados"]];
        const groups = new Map();
        for (const k of cases) {
          const key = k.assigned_user_id || 0;
          const g = groups.get(key) || { user: k.assigned_name || "Sin responsable", role: s.users.find((u) => u.id === key)?.role || "", cases: 0, active: 0, closed: 0 };
          g.cases++; g.active += OPEN.includes(k.status) ? 1 : 0; g.closed += k.status === "Cerrado" ? 1 : 0;
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

  const FOOTER = "Draft generated by NomosAI for final review, verification, and execution by the attorney of record.";

  function sampleDraft(p) {
    const k = p.caseId ? caseOut(visibleCase(p.caseId)) : null;
    const cl = k ? s.clients.find((c) => c.id === k.client_id) : null;
    const name = cl?.full_name || p.client?.fullName || "**[FILL: Nombre del cliente]**";
    const idn = cl ? `${cl.id_type} ${cl.id_number}` : p.client?.idNumber || "**[FILL: Documento de identidad]**";
    const to = p.counterparty || k?.counterparty || "**[FILL: Entidad destinataria]**";
    const facts = (p.facts || k?.facts || "**[FILL: Hechos]**").split(/(?<=\.)\s+/).filter(Boolean);
    const title = { PETITION: "DERECHO DE PETICIÓN", CONTRACT: "CONTRATO DE PRESTACIÓN DE SERVICIOS", POWER_OF_ATTORNEY: "PODER ESPECIAL" }[p.documentType];
    const txId = p.payment?.required ? "JMA_PREVIEW_" + Math.random().toString(36).slice(2, 7).toUpperCase() : null;
    const doc = [
      `# ${title}`, "", `**Señores:** ${to}`, "",
      ...(k ? [`**Referencia:** ${k.category_name} › ${k.type_name}${k.title ? " — " + k.title : ""}`, ""] : []),
      `${name}, identificado(a) con ${idn}, presenta esta solicitud con base en los siguientes:`, "",
      "## HECHOS", "", ...facts.map((f, i) => `${i + 1}. ${f}`), "",
      "## FUNDAMENTOS DE DERECHO", "", "**[FILL: Fundamento legal a verificar por el abogado]**", "",
      ...(txId ? ["## HONORARIOS", "", p.payment.items || "**[FILL: Detalle de honorarios]**", "",
        `Pago seguro: https://checkout.bold.co/payment/link/${txId}`, "",
        "Secure payment processed via Bold Gateway (Credit Card, PSE Debit, or QR Code).", ""] : []),
      "## FIRMA ELECTRÓNICA", "", "_______________________", name, "",
      "OTP: [OTP_VERIFICATION_CODE] · Fecha: [TIMESTAMP] · IP: [IP_ADDRESS]", "",
      "> Vista previa: este texto es un ejemplo fijo. En la app real lo redacta NomosAI.", "", FOOTER,
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
      if (url.startsWith("/jurisprudencia/") && method === "POST" && !url.endsWith("/saved")) await new Promise((r) => setTimeout(r, 500));
      for (const [m, re, fn] of routes) {
        const match = m === method && url.match(re);
        if (match) {
          const out = fn(match, body || {}, url);
          if (method !== "GET") save();
          return out;
        }
      }
      throw new Error(`Ruta no disponible en la vista previa: ${method} ${url}`);
    },
    async *generate(payload) {
      need("drafts.generate");
      const { doc, done } = sampleDraft(payload);
      for (let i = 0; i < doc.length; i += 40) {
        yield { type: "text", text: doc.slice(i, i + 40) };
        await new Promise((r) => setTimeout(r, 12));
      }
      yield done;
    },
    demoUsers: () => s.users.filter((u) => u.active).map((u) => ({ email: u.email, name: u.name, role: u.role, office: userOut(u).offices.map((o) => o.name).join(", ") })),
    reset() { s = fresh(); save(); },
  };
})();
