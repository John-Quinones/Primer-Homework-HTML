// Chat between users and video calls (version 2.2.82). Loaded after app.js and uses its $, $$, api, me, toast, ask, escapeHtml.
// Messages are fetched by polling (simple and works behind Azure's proxy). Video goes browser to browser (WebRTC, free STUN);
// the server only relays the handshake. The published test link has one browser, so there the chat explains it needs the server.
(() => {
  const SERVER_ONLY = !!window.JuanmaBackend; // the published link and the demo have one browser: no one to chat with
  const S = { convs: [], people: [], cur: null, msgs: [], members: [], otherRead: 0, more: false, now: "", attach: null, link: null, editing: null, focus: 0, busy: false, lastUnread: 0, calling: false };
  const POLL_MS = 3000, LIST_MS = 10000, BADGE_MS = 15000;

  // ---------- helpers ----------
  const utc = (t) => new Date(String(t).replace(" ", "T").slice(0, 19) + "Z");
  const dayKey = (t) => utc(t).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const hhmm = (t) => utc(t).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hour12: true });
  const dayLabel = (t) => {
    const k = dayKey(t), today = dayKey(new Date().toISOString()), yest = dayKey(new Date(Date.now() - 864e5).toISOString());
    return k === today ? "Hoy" : k === yest ? "Ayer" : utc(t).toLocaleDateString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" });
  };
  const initials = (n) => String(n).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const hue = (n) => [...String(n)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const avatar = (n, online) => `<span class="chat-av" style="--h:${hue(n)}" aria-hidden="true">${escapeHtml(initials(n))}${online === undefined ? "" : `<i class="chat-dot${online ? " on" : ""}"></i>`}</span>`;
  const rich = (text, mentionNames) => {
    let h = escapeHtml(text);
    for (const n of mentionNames) h = h.replace(new RegExp("@" + escapeHtml(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark class="chat-at">${m}</mark>`);
    return h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\n/g, "<br>");
  };

  // ---------- unread badge (always on, outside the chat screen too) ----------
  async function pollBadge() {
    if (SERVER_ONLY || !me) return;
    const u = await api("GET", "/chat/unread").catch(() => null);
    if (!u) return;
    const b = $("#chat-badge");
    b.hidden = !u.unread && !u.calling;
    b.textContent = u.calling ? "📹" : u.unread > 99 ? "99+" : u.unread;
    b.classList.toggle("calling", !!u.calling);
    document.title = document.title.replace(/^\(\d+\) /, "");
    if (u.unread) document.title = `(${u.unread}) ${document.title}`;
    if (u.unread > S.lastUnread && document.hidden && window.Notification?.permission === "granted") {
      try { new Notification("TEC Jurídicos · Chat", { body: `Tiene ${u.unread} mensaje${u.unread === 1 ? "" : "s"} sin leer.` }); } catch { /* not allowed here */ }
    }
    if (u.calling && !S.calling && !callState && inChat()) toast("Hay una videollamada en curso: abra el chat para unirse.");
    if (u.unread !== S.lastUnread || u.calling !== S.calling) refreshBell?.(); // mentions and calls also reach the bell
    S.lastUnread = u.unread;
    S.calling = u.calling;
    S.byConv = u.by_conversation;
  }
  const inChat = () => /^#chat(-\d+)?$/.test(location.hash);
  setInterval(() => { if (me) pollBadge(); }, BADGE_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && me) pollBadge(); });

  // ---------- screen ----------
  async function renderChat() {
    if (SERVER_ONLY) {
      $("#chat-app").hidden = true;
      const el = $("#chat-server");
      el.hidden = false;
      el.innerHTML = "<strong>El chat y la videollamada funcionan en el servidor.</strong> Esta copia de pruebas la usa una sola persona en un solo navegador, así que no hay con quién conversar. En la App publicada en Azure cada usuario ve sus conversaciones, quién está conectado y puede llamar por video.";
      return;
    }
    $("#chat-server").hidden = true;
    $("#chat-app").hidden = false;
    if (window.Notification?.permission === "default") Notification.requestPermission().catch(() => {});
    await Promise.all([loadPeople(), loadConvs()]);
    const want = Number(location.hash.match(/^#chat-(\d+)$/)?.[1]) || 0;
    if (want && want !== S.cur?.id) await openConv(want);
    else if (!S.cur) showEmpty(true);
  }
  RENDER.chat = renderChat;

  async function loadPeople() {
    S.people = await api("GET", "/chat/users");
    drawPeople();
  }
  async function loadConvs() {
    S.convs = await api("GET", "/chat/conversations");
    drawConvs();
    if (S.cur) {
      const c = S.convs.find((x) => x.id === S.cur.id);
      if (c) { S.cur = c; drawHead(); drawBanner(); }
    }
  }
  function drawPeople() {
    $("#chat-people").innerHTML = S.people.map((p) => `<li><button type="button" class="chat-row" data-person="${p.id}">${avatar(p.name, p.online)}
      <span class="chat-row-t"><strong>${escapeHtml(p.name)}</strong><small>${p.online ? "Conectado" : "Sin conexión"} · ${escapeHtml(p.role)}</small></span></button></li>`).join("") || '<li class="hint">No hay más usuarios activos.</li>';
  }
  function drawConvs() {
    $("#chat-convs").innerHTML = S.convs.map((c) => `<li><button type="button" class="chat-row${S.cur?.id === c.id ? " active" : ""}" data-conv="${c.id}">
      ${c.kind === "direct" ? avatar(c.title, c.online) : `<span class="chat-av grp" aria-hidden="true">${c.kind === "general" ? "#" : "👥"}</span>`}
      <span class="chat-row-t"><strong>${escapeHtml(c.title)}${c.call ? ' <span class="chat-live" title="Videollamada en curso">📹</span>' : ""}</strong>
      <small>${c.last_preview ? escapeHtml((c.last_from && c.kind !== "direct" ? c.last_from.split(" ")[0] + ": " : "") + c.last_preview) : "Sin mensajes"}</small></span>
      ${c.unread ? `<b class="nav-badge">${c.unread > 99 ? "99+" : c.unread}</b>` : ""}</button></li>`).join("");
  }
  const showEmpty = (on) => { $("#chat-empty").hidden = !on; $("#chat-main").hidden = on; $("#chat-app").classList.toggle("show-main", !on); };

  function drawHead() {
    const c = S.cur;
    $("#chat-title").textContent = c.title;
    const other = c.kind === "direct" ? S.people.find((p) => p.id === c.other_id) : null;
    $("#chat-sub").textContent = c.kind === "direct" ? (c.online || other?.online ? "Conectado" : "Sin conexión")
      : c.kind === "general" ? "Todo el despacho" : `${c.members} integrantes`;
    $("#chat-members").hidden = c.kind === "direct";
  }
  function drawBanner() {
    const b = $("#chat-banner"), call = S.cur?.call;
    b.hidden = !call;
    if (!call) return;
    const mine = call.participants.some((p) => p.id === me.id);
    b.innerHTML = `<span>📹 Videollamada en curso con ${escapeHtml(call.participants.map((p) => p.name).join(", "))}</span>${mine || callState ? "" : '<button type="button" class="primary mini" data-chat-join>Unirse</button>'}`;
  }

  async function openConv(id, focusId = 0) {
    const c = S.convs.find((x) => x.id === id) || (await loadConvs(), S.convs.find((x) => x.id === id));
    if (!c) { toast("Esa conversación no existe o no es suya.", true); showEmpty(true); return; }
    S.cur = c; S.msgs = []; S.members = []; S.editing = null; S.attach = null; S.link = null; S.focus = focusId;
    history.replaceState(null, "", `#chat-${id}`);
    showEmpty(false);
    drawConvs(); drawHead(); drawBanner(); drawChips(); setEditing(null);
    $("#chat-input").value = "";
    const q = focusId ? `?before=${focusId + 30}&limit=60` : "";
    const r = await api("GET", `/chat/conversations/${id}/messages${q}`);
    S.msgs = r.messages; S.more = r.more; S.otherRead = r.other_read_id; S.now = r.now;
    drawLog(!focusId);
    if (focusId) $(`[data-msg="${focusId}"]`)?.scrollIntoView({ block: "center" });
    api("GET", `/chat/conversations/${id}/members`).then((m) => (S.members = m)).catch(() => {});
    loadConvs(); pollBadge();
    $("#chat-input").focus();
  }

  // ---------- messages ----------
  function drawLog(toBottom) {
    const log = $("#chat-log");
    const stick = toBottom || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const names = S.members.map((m) => m.name);
    let day = "", html = S.more ? '<button type="button" class="mini chat-older" data-chat-older>Cargar mensajes anteriores</button>' : "";
    for (const m of S.msgs) {
      const k = dayKey(m.created_at);
      if (k !== day) { day = k; html += `<div class="chat-day"><span>${escapeHtml(dayLabel(m.created_at))}</span></div>`; }
      if (m.kind === "call") { html += `<div class="chat-sys" data-msg="${m.id}">📹 ${escapeHtml(m.user_name)} inició una videollamada · ${hhmm(m.created_at)}</div>`; continue; }
      const direct = S.cur.kind === "direct";
      const ticks = m.mine && direct ? `<span class="chat-ticks${m.id <= S.otherRead ? " read" : ""}" title="${m.id <= S.otherRead ? "Leído" : "Enviado"}">${m.id <= S.otherRead ? "✓✓" : "✓"}</span>` : "";
      let inner;
      if (m.retracted) inner = '<em class="chat-gone">Mensaje eliminado</em>';
      else {
        inner = (m.body ? `<p>${rich(m.body, names)}</p>` : "")
          + (m.link ? `<button type="button" class="chat-chip" data-go="${m.link.case_id ? `#expediente-${m.link.case_id}` : `#cliente-${m.link.client_id}`}">${m.link.case_id ? "📁" : "👤"} ${escapeHtml(m.link.label)}</button>` : "")
          + (m.file ? `<a class="chat-chip" href="/api/chat/files/${m.file.id}" download="${escapeHtml(m.file.name)}">📎 ${escapeHtml(m.file.name)} <small>${Math.max(1, Math.round(m.file.size / 1024))} KB</small></a>` : "");
      }
      html += `<div class="chat-msg${m.mine ? " mine" : ""}${S.focus === m.id ? " focus" : ""}" data-msg="${m.id}">
        ${m.mine || direct ? "" : avatar(m.user_name)}
        <div class="chat-bubble">${m.mine || direct ? "" : `<strong class="chat-from">${escapeHtml(m.user_name)}</strong>`}${inner}
          <span class="chat-meta">${m.edited_at && !m.retracted ? "editado · " : ""}${hhmm(m.created_at)} ${ticks}
          ${m.mine && !m.retracted ? `<button type="button" class="chat-act" data-edit="${m.id}" title="Editar">✎</button><button type="button" class="chat-act" data-retract="${m.id}" title="Eliminar">🗑</button>` : ""}</span></div></div>`;
    }
    log.innerHTML = html || '<p class="hint chat-none">Todavía no hay mensajes. Escriba el primero.</p>';
    if (stick) log.scrollTop = log.scrollHeight;
  }

  async function tick() {
    if (SERVER_ONLY || !me || !S.cur || !inChat() || document.hidden || S.busy) return;
    const last = S.msgs.length ? S.msgs[S.msgs.length - 1].id : 0;
    const q = `after=${last}&since=${encodeURIComponent(S.now || "")}`;
    const r = await api("GET", `/chat/conversations/${S.cur.id}/messages?${q}`).catch(() => null);
    if (!r || !S.cur) return;
    S.now = r.now; S.otherRead = r.other_read_id;
    let dirty = r.messages.length > 0;
    for (const ch of r.changed) { const i = S.msgs.findIndex((x) => x.id === ch.id); if (i >= 0) { S.msgs[i] = ch; dirty = true; } }
    S.msgs.push(...r.messages);
    if (S.cur.kind === "direct") dirty = true; // read marks
    if (dirty) drawLog(false);
    if (S.cur.call?.id !== r.call?.id || (r.call?.participants.length || 0) !== (S.cur.call?.participants.length || 0)) { S.cur.call = r.call; drawBanner(); }
  }
  setInterval(() => tick(), POLL_MS);
  setInterval(() => { if (me && inChat() && !document.hidden) { loadPeople().catch(() => {}); loadConvs().catch(() => {}); } }, LIST_MS);

  async function send(e) {
    e.preventDefault();
    if (!S.cur || S.busy) return;
    const input = $("#chat-input"), body = input.value.trim();
    if (!body && !S.attach && !S.link) return;
    S.busy = true; $("#chat-send").disabled = true;
    try {
      if (S.editing) {
        const m = await api("PUT", `/chat/messages/${S.editing}`, { body });
        const i = S.msgs.findIndex((x) => x.id === m.id);
        if (i >= 0) S.msgs[i] = m;
        setEditing(null);
      } else {
        const payload = { body };
        if (S.link) Object.assign(payload, S.link.case_id ? { case_id: S.link.case_id } : { client_id: S.link.client_id });
        if (S.attach) payload.file = S.attach;
        const m = await api("POST", `/chat/conversations/${S.cur.id}/messages`, payload);
        S.msgs.push(m);
        S.attach = null; S.link = null; drawChips();
      }
      input.value = ""; input.style.height = "";
      drawLog(true);
      loadConvs();
    } catch (err) { toast(err.message, true); } finally { S.busy = false; $("#chat-send").disabled = false; input.focus(); }
  }
  function setEditing(id) {
    S.editing = id;
    const m = S.msgs.find((x) => x.id === id);
    $("#chat-form").classList.toggle("editing", !!m);
    if (m) { $("#chat-input").value = m.body; $("#chat-input").focus(); }
    drawChips();
  }
  function drawChips() {
    const el = $("#chat-chips"), parts = [];
    if (S.editing) parts.push('<span class="chat-chip">✎ Editando el mensaje <button type="button" class="chat-x" data-chip="edit" aria-label="Cancelar edición">✕</button></span>');
    if (S.attach) parts.push(`<span class="chat-chip">📎 ${escapeHtml(S.attach.name)} <button type="button" class="chat-x" data-chip="file" aria-label="Quitar archivo">✕</button></span>`);
    if (S.link) parts.push(`<span class="chat-chip">${S.link.case_id ? "📁" : "👤"} ${escapeHtml(S.link.label)} <button type="button" class="chat-x" data-chip="link" aria-label="Quitar enlace">✕</button></span>`);
    el.hidden = !parts.length;
    el.innerHTML = parts.join("");
  }

  // ---------- mentions ----------
  function mentionQuery() {
    const i = $("#chat-input");
    const m = i.value.slice(0, i.selectionStart).match(/(^|\s)@([^\s@]{0,30})$/);
    return m ? m[2].toLowerCase() : null;
  }
  function drawMention() {
    const box = $("#chat-mention"), q = mentionQuery();
    const list = q === null ? [] : S.members.filter((m) => m.id !== me.id && m.name.toLowerCase().includes(q)).slice(0, 6);
    box.hidden = !list.length;
    box.innerHTML = list.map((m) => `<button type="button" data-at="${escapeHtml(m.name)}">${avatar(m.name, m.online)} ${escapeHtml(m.name)}</button>`).join("");
  }

  // ---------- link picker ----------
  let linkTimer = 0;
  async function drawLinkList() {
    const q = $("#chat-link-q").value.trim().toLowerCase();
    const [clients, cases] = await Promise.all([api("GET", `/clients${q ? "?q=" + encodeURIComponent(q) : ""}`), api("GET", "/cases")]);
    const hit = (s) => !q || String(s).toLowerCase().includes(q);
    const rows = [
      ...cases.filter((k) => hit([k.client_name, k.title, k.radicado, k.case_number, k.type_name, k.folder].join(" "))).slice(0, 15)
        .map((k) => `<li><button type="button" class="chat-row" data-pick-case="${k.id}" data-label="${escapeHtml(`Expediente · ${k.client_name} · ${k.title}`.slice(0, 200))}"><span class="chat-av grp">📁</span><span class="chat-row-t"><strong>${escapeHtml(k.client_name)}</strong><small>${escapeHtml(k.title)}${k.radicado ? " · " + escapeHtml(k.radicado) : ""}</small></span></button></li>`),
      ...clients.slice(0, 15).map((c) => `<li><button type="button" class="chat-row" data-pick-client="${c.id}" data-label="${escapeHtml(`Cliente · ${c.full_name}`.slice(0, 200))}"><span class="chat-av grp">👤</span><span class="chat-row-t"><strong>${escapeHtml(c.full_name)}</strong><small>${escapeHtml([c.id_type, c.id_number].filter(Boolean).join(" "))}</small></span></button></li>`),
    ];
    $("#chat-link-list").innerHTML = rows.join("") || '<li class="hint">Sin coincidencias.</li>';
  }

  // ---------- search ----------
  let searchTimer = 0;
  async function search() {
    const q = $("#chat-search").value.trim(), box = $("#chat-found");
    if (q.length < 2) { box.hidden = true; $("#chat-convs").hidden = false; return; }
    const people = S.people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    const found = await api("GET", `/chat/search?q=${encodeURIComponent(q)}`).catch(() => []);
    box.hidden = false; $("#chat-convs").hidden = true;
    box.innerHTML = (people.length ? `<h4 class="chat-sub-title">Personas</h4><ul class="chat-list">${people.map((p) => `<li><button type="button" class="chat-row" data-person="${p.id}">${avatar(p.name, p.online)}<span class="chat-row-t"><strong>${escapeHtml(p.name)}</strong></span></button></li>`).join("")}</ul>` : "")
      + `<h4 class="chat-sub-title">Mensajes</h4><ul class="chat-list">${found.map((m) => `<li><button type="button" class="chat-row" data-conv="${m.conv_id}" data-focus="${m.id}"><span class="chat-row-t"><strong>${escapeHtml(m.conv_title)} · ${escapeHtml(m.user_name)}</strong><small>${escapeHtml((m.body || m.link_label).slice(0, 90))}</small></span></button></li>`).join("") || '<li class="hint">Sin mensajes con ese texto.</li>'}</ul>`;
  }

  // ---------- new chat / group ----------
  function openNew() {
    $("#chat-new-name").value = "";
    $("#chat-new-people").innerHTML = S.people.map((p) => `<label class="chat-check"><input type="checkbox" value="${p.id}" /> ${avatar(p.name, p.online)} ${escapeHtml(p.name)}</label>`).join("");
    newHint();
    $("#chat-new-dialog").showModal();
  }
  const newPicked = () => $$("#chat-new-people input:checked").map((i) => Number(i.value));
  function newHint() {
    const n = newPicked().length, name = $("#chat-new-name").value.trim();
    $("#chat-new-hint").textContent = n === 0 ? "Elija a quién quiere escribir." : n === 1 && !name ? "Se abrirá un chat privado con esa persona." : name ? `Se creará el grupo «${name}» con ${n} persona${n === 1 ? "" : "s"} más usted.` : "Escriba el nombre del grupo.";
  }
  async function createNew() {
    const ids = newPicked(), name = $("#chat-new-name").value.trim();
    if (!ids.length) return toast("Elija al menos una persona.", true);
    if (ids.length > 1 && !name) return toast("Escriba el nombre del grupo.", true);
    const r = await api("POST", "/chat/conversations", ids.length === 1 && !name ? { user_id: ids[0] } : { name: name || "Grupo", user_ids: ids });
    $("#chat-new-dialog").close();
    await loadConvs();
    await openConv(r.id);
  }
  async function openPerson(id) {
    const r = await api("POST", "/chat/conversations", { user_id: id });
    $("#chat-search").value = ""; await search();
    await loadConvs();
    await openConv(r.id);
  }

  // ---------- members ----------
  async function openMembers() {
    const c = S.cur;
    S.members = await api("GET", `/chat/conversations/${c.id}/members`);
    $("#chat-members-title").textContent = c.title;
    $("#chat-members-list").innerHTML = S.members.map((m) => `<li class="chat-row">${avatar(m.name, m.online)}<span class="chat-row-t"><strong>${escapeHtml(m.name)}${m.id === me.id ? " (usted)" : ""}</strong><small>${m.online ? "Conectado" : "Sin conexión"}</small></span></li>`).join("");
    const addable = c.kind === "group" ? S.people.filter((p) => !S.members.some((m) => m.id === p.id)) : [];
    $("#chat-members-add").hidden = !addable.length;
    $("#chat-members-select").innerHTML = addable.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    $("#chat-leave").hidden = c.kind !== "group";
    $("#chat-members-dialog").showModal();
  }

  // ---------- video call (WebRTC mesh) ----------
  let callState = null;
  const tile = (id, name, local) => {
    let el = $(`#call-grid [data-tile="${id}"]`);
    if (!el) {
      el = document.createElement("div");
      el.className = "call-tile"; el.dataset.tile = id;
      el.innerHTML = `<video autoplay playsinline ${local ? "muted" : ""}></video><span class="call-name">${escapeHtml(name)}</span><span class="call-state"></span>`;
      $("#call-grid").append(el);
      $("#call-grid").dataset.n = $$("#call-grid .call-tile").length;
    }
    return el;
  };
  const dropTile = (id) => { $(`#call-grid [data-tile="${id}"]`)?.remove(); $("#call-grid").dataset.n = $$("#call-grid .call-tile").length; };

  async function startCall() {
    if (callState) return $("#chat-call-dialog").showModal();
    if (!S.cur) return;
    if (!navigator.mediaDevices?.getUserMedia) return toast("Este navegador no permite videollamadas (use Chrome, Edge o Safari actualizados, con https).", true);
    let stream, note = "";
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }); } catch {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); note = "No se pudo usar la cámara: entra solo con micrófono."; } catch { return toast("Permita el acceso a la cámara y al micrófono para la videollamada.", true); }
    }
    let join;
    try { join = await api("POST", `/chat/conversations/${S.cur.id}/call`); } catch (err) { stream.getTracks().forEach((t) => t.stop()); return toast(err.message, true); }
    callState = { id: join.call_id, conv: S.cur.id, ice: join.ice_servers, stream, pcs: new Map(), since: 0, queue: new Map(), timer: 0, names: new Map(), screen: null };
    $("#call-title").textContent = S.cur.title;
    $("#call-note").textContent = note;
    $("#call-grid").innerHTML = "";
    const mine = tile("me", me.name + " (usted)", true);
    mine.querySelector("video").srcObject = stream;
    const dlg = $("#chat-call-dialog");
    dlg.dataset.forced = "1"; // «Atrás» must not hang up by accident: «Colgar» is the way out
    dlg.showModal();
    setStatus(join.peers.length ? "Conectando…" : "Esperando a que se una alguien…");
    for (const p of join.peers) { callState.names.set(p.id, p.name); await offerTo(p.id, p.name); }
    callState.timer = setInterval(pollCall, 1200);
    drawMedia();
    loadConvs();
  }
  const setStatus = (t) => { $("#call-status").textContent = t; };

  function makePc(peerId, name) {
    const st = callState;
    if (st.pcs.has(peerId)) return st.pcs.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: st.ice });
    st.pcs.set(peerId, pc);
    st.names.set(peerId, name);
    st.stream.getTracks().forEach((t) => pc.addTrack(t, st.stream));
    pc.onicecandidate = (e) => { if (e.candidate) signal(peerId, "ice", e.candidate.toJSON()); };
    pc.ontrack = (e) => { const t = tile(peerId, st.names.get(peerId) || name, false); t.querySelector(".call-name").textContent = st.names.get(peerId) || name; t.querySelector("video").srcObject = e.streams[0]; };
    pc.onconnectionstatechange = () => {
      const t = $(`#call-grid [data-tile="${peerId}"] .call-state`);
      if (t) t.textContent = pc.connectionState === "connected" ? "" : pc.connectionState === "failed" ? "Sin conexión" : "Conectando…";
      if (pc.connectionState === "failed") $("#call-note").textContent = "No se pudo conectar el video con " + name + ". Suele ser el cortafuegos de una de las redes: pruebe desde otra red o avise a Gerencia.";
      if (pc.connectionState === "connected") setStatus("En llamada");
    };
    tile(peerId, name, false);
    return pc;
  }
  const signal = (to, kind, payload) => api("POST", `/chat/calls/${callState?.id}/signal`, { to, kind, payload }).catch(() => {});
  async function offerTo(peerId, name) {
    const pc = makePc(peerId, name);
    await pc.setLocalDescription(await pc.createOffer());
    await signal(peerId, "offer", pc.localDescription.toJSON());
  }
  async function flushIce(peerId, pc) {
    for (const c of callState.queue.get(peerId) || []) await pc.addIceCandidate(c).catch(() => {});
    callState.queue.delete(peerId);
  }
  async function onSignal(s) {
    const st = callState;
    const name = st.names.get(s.from) || "Participante";
    if (s.kind === "offer") {
      let pc = st.pcs.get(s.from);
      // Both sides offered at once: the higher user id keeps its offer, the other gives way.
      if (pc && pc.signalingState === "have-local-offer") {
        if (me.id > s.from) return;
        await pc.setLocalDescription({ type: "rollback" });
      }
      pc = pc || makePc(s.from, name);
      await pc.setRemoteDescription(s.payload);
      await flushIce(s.from, pc);
      await pc.setLocalDescription(await pc.createAnswer());
      await signal(s.from, "answer", pc.localDescription.toJSON());
    } else if (s.kind === "answer") {
      const pc = st.pcs.get(s.from);
      if (pc && pc.signalingState === "have-local-offer") { await pc.setRemoteDescription(s.payload); await flushIce(s.from, pc); }
    } else if (s.kind === "ice") {
      const pc = st.pcs.get(s.from);
      if (pc?.remoteDescription) await pc.addIceCandidate(s.payload).catch(() => {});
      else st.queue.set(s.from, [...(st.queue.get(s.from) || []), s.payload]);
    }
  }
  async function pollCall() {
    const st = callState;
    if (!st || st.polling) return;
    st.polling = true;
    try {
      const r = await api("GET", `/chat/calls/${st.id}/poll?since=${st.since}`);
      for (const p of r.participants) if (p.id !== me.id) st.names.set(p.id, p.name);
      for (const s of r.signals) { st.since = Math.max(st.since, s.id); await onSignal(s).catch((e) => console.warn("call", e)); }
      const here = new Set(r.participants.map((p) => p.id));
      for (const [id, pc] of [...st.pcs]) if (!here.has(id)) { pc.close(); st.pcs.delete(id); dropTile(id); }
      if (r.ended && !r.participants.length) return endCall(false);
      if (st.pcs.size === 0 && r.participants.length <= 1) setStatus("Esperando a que se una alguien…");
    } catch { /* a missed poll is retried */ } finally { st.polling = false; }
  }
  async function endCall(notify = true) {
    const st = callState;
    if (!st) return;
    callState = null;
    clearInterval(st.timer);
    st.pcs.forEach((pc) => pc.close());
    st.stream.getTracks().forEach((t) => t.stop());
    st.screen?.getTracks().forEach((t) => t.stop());
    if (notify) await api("POST", `/chat/calls/${st.id}/leave`).catch(() => {});
    const dlg = $("#chat-call-dialog");
    delete dlg.dataset.forced;
    if (dlg.open) dlg.close();
    $("#call-grid").innerHTML = "";
    loadConvs(); drawBanner();
  }
  function drawMedia() {
    const st = callState;
    if (!st) return;
    const a = st.stream.getAudioTracks()[0], v = st.stream.getVideoTracks()[0];
    $("#call-mic").textContent = a?.enabled === false ? "🎤 Activar micrófono" : "🎤 Silenciar";
    $("#call-cam").hidden = !v;
    $("#call-cam").textContent = v?.enabled === false ? "📷 Encender cámara" : "📷 Apagar cámara";
    $("#call-screen").hidden = !navigator.mediaDevices?.getDisplayMedia;
    $("#call-screen").textContent = st.screen ? "🖥 Dejar de compartir" : "🖥 Compartir pantalla";
  }
  async function toggleScreen() {
    const st = callState;
    if (st.screen) return stopScreen();
    try { st.screen = await navigator.mediaDevices.getDisplayMedia({ video: true }); } catch { return; }
    const track = st.screen.getVideoTracks()[0];
    track.onended = stopScreen;
    for (const pc of st.pcs.values()) pc.getSenders().find((x) => x.track?.kind === "video")?.replaceTrack(track);
    $("#call-grid [data-tile=me] video").srcObject = st.screen;
    drawMedia();
  }
  function stopScreen() {
    const st = callState;
    if (!st?.screen) return;
    st.screen.getTracks().forEach((t) => t.stop());
    st.screen = null;
    const cam = st.stream.getVideoTracks()[0];
    for (const pc of st.pcs.values()) pc.getSenders().find((x) => x.track?.kind === "video" || !x.track)?.replaceTrack(cam || null);
    $("#call-grid [data-tile=me] video").srcObject = st.stream;
    drawMedia();
  }

  // ---------- events ----------
  if (!SERVER_ONLY) {
    $("#chat-form").addEventListener("submit", send);
    const input = $("#chat-input");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#chat-form").requestSubmit(); }
      if (e.key === "Escape" && S.editing) { setEditing(null); input.value = ""; }
    });
    input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; drawMention(); });
    $("#chat-mention").addEventListener("click", (e) => {
      const b = e.target.closest("[data-at]");
      if (!b) return;
      const before = input.value.slice(0, input.selectionStart).replace(/@[^\s@]*$/, "@" + b.dataset.at + " ");
      input.value = before + input.value.slice(input.selectionStart);
      input.focus(); $("#chat-mention").hidden = true;
    });
    $("#chat-attach").addEventListener("click", () => $("#chat-file").click());
    $("#chat-file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) return toast("El archivo pesa más de 5 MB.", true);
      const data = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.readAsDataURL(f); });
      S.attach = { name: f.name, mime: f.type || "application/octet-stream", data_base64: data };
      drawChips();
    });
    $("#chat-link").addEventListener("click", () => { $("#chat-link-q").value = ""; drawLinkList().catch((err) => toast(err.message, true)); $("#chat-link-dialog").showModal(); $("#chat-link-q").focus(); });
    $("#chat-link-q").addEventListener("input", () => { clearTimeout(linkTimer); linkTimer = setTimeout(() => drawLinkList().catch(() => {}), 250); });
    $("#chat-link-list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick-case],[data-pick-client]");
      if (!b) return;
      S.link = b.dataset.pickCase ? { case_id: Number(b.dataset.pickCase), label: b.dataset.label } : { client_id: Number(b.dataset.pickClient), label: b.dataset.label };
      $("#chat-link-dialog").close(); drawChips(); input.focus();
    });
    $("#chat-chips").addEventListener("click", (e) => {
      const x = e.target.closest("[data-chip]")?.dataset.chip;
      if (x === "edit") { setEditing(null); input.value = ""; }
      if (x === "file") S.attach = null;
      if (x === "link") S.link = null;
      drawChips();
    });
    $("#chat-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search().catch(() => {}), 300); });
    $("#chat-new").addEventListener("click", openNew);
    $("#chat-new-people").addEventListener("change", newHint);
    $("#chat-new-name").addEventListener("input", newHint);
    $("#chat-new-go").addEventListener("click", () => guarded(createNew));
    $("#chat-members").addEventListener("click", () => guarded(openMembers));
    $("#chat-members-addgo").addEventListener("click", () => guarded(async () => {
      const id = Number($("#chat-members-select").value);
      if (!id) return;
      await api("PUT", `/chat/conversations/${S.cur.id}`, { add: [id] });
      await loadConvs(); await openMembers();
    }));
    $("#chat-leave").addEventListener("click", () => guarded(async () => {
      if (!(await ask({ title: "¿Salir del grupo?", message: `Dejará de ver «${S.cur.title}». Los mensajes quedan para los demás.`, okLabel: "Salir", danger: true }))) return;
      await api("POST", `/chat/conversations/${S.cur.id}/leave`);
      $("#chat-members-dialog").close();
      S.cur = null; showEmpty(true); history.replaceState(null, "", "#chat"); await loadConvs();
    }));
    $("#chat-to-list").addEventListener("click", () => { $("#chat-app").classList.remove("show-main"); });
    $("#chat-call").addEventListener("click", () => guarded(startCall));
    $("#chat-banner").addEventListener("click", (e) => { if (e.target.closest("[data-chat-join]")) guarded(startCall); });
    $("#call-end").addEventListener("click", () => endCall(true));
    $("#call-mic").addEventListener("click", () => { const t = callState?.stream.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; drawMedia(); } });
    $("#call-cam").addEventListener("click", () => { const t = callState?.stream.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; drawMedia(); } });
    $("#call-screen").addEventListener("click", () => guarded(toggleScreen));
    $("#chat-call-dialog").addEventListener("cancel", (e) => e.preventDefault()); // Esc does not hang up
    $("#view-chat").addEventListener("click", (e) => {
      const conv = e.target.closest("[data-conv]"), person = e.target.closest("[data-person]"), go = e.target.closest("[data-go]");
      if (conv) { guarded(() => openConv(Number(conv.dataset.conv), Number(conv.dataset.focus) || 0)); if (conv.dataset.focus) { $("#chat-search").value = ""; search(); } return; }
      if (person) return guarded(() => openPerson(Number(person.dataset.person)));
      if (go) { location.hash = go.dataset.go; return; }
      const older = e.target.closest("[data-chat-older]");
      if (older) return guarded(async () => {
        const first = S.msgs[0]?.id;
        const r = await api("GET", `/chat/conversations/${S.cur.id}/messages?before=${first}&limit=60&read=0`);
        S.msgs = [...r.messages, ...S.msgs]; S.more = r.more; drawLog(false);
      });
      const ed = e.target.closest("[data-edit]");
      if (ed) return setEditing(Number(ed.dataset.edit));
      const rt = e.target.closest("[data-retract]");
      if (rt) return guarded(async () => {
        if (!(await ask({ title: "¿Eliminar el mensaje?", message: "Los demás verán «Mensaje eliminado». Queda registro interno del texto original.", okLabel: "Eliminar", danger: true }))) return;
        const m = await api("POST", `/chat/messages/${rt.dataset.retract}/retract`);
        const i = S.msgs.findIndex((x) => x.id === m.id);
        if (i >= 0) S.msgs[i] = m;
        drawLog(false);
      });
    });
    // Sign-in done: start counting unread messages right away.
    const wait = setInterval(() => { if (me) { clearInterval(wait); pollBadge(); } }, 800);
  }
})();
