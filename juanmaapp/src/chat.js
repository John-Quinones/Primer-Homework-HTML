// Chat between the firm's users (version 2.2.82): direct, group and general conversations,
// unread counters, mentions, files, links to clients and cases, search, and video calls.
// Video: the browsers talk to each other (WebRTC, free); this server only carries the handshake
// (`chat_signals`) and knows who is in the call. Private conversations are visible only to their members.
import express from "express";
import { randomUUID } from "node:crypto";
import { str } from "./http.js";
import { scopeOf } from "./auth.js";
import { notify } from "./monitor.js";

export const MAX_BODY = 4000;
export const MAX_FILE = 5 * 1024 * 1024;
// Images shown inside the message (their real type is checked against the first bytes). Anything else is
// offered as a download only, and programs/scripts are refused.
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|msi|dll|js|mjs|vbs|vbe|ps1|jar|apk|app|sh|hta|lnk|reg|svg|html?)$/i;
export function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 6 && /^GIF8[79]a/.test(buf.toString("latin1", 0, 6))) return "image/gif";
  if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}
export const CALL_MAX = 6; // a full mesh: every participant sends video to every other one
const ONLINE = "-3 minutes";
const CALL_ALIVE = "-25 seconds";
const RING_LIVE = "-15 minutes"; // an unanswered timbre stops sounding after this
export const RING_DEFAULT = "Sube al segundo piso";

export function chatRouter(db) {
  const r = express.Router();
  const err = (res, status, error) => res.status(status).json({ error });
  const shown = (id) => db.prepare("SELECT name FROM users_shown WHERE id = ?").get(id)?.name || "";

  // The «General» channel always exists; every active user belongs to it.
  const general = () => {
    let g = db.prepare("SELECT id FROM chat_conversations WHERE kind = 'general'").get();
    if (!g) g = { id: Number(db.prepare("INSERT INTO chat_conversations (kind, name) VALUES ('general', 'General')").run().lastInsertRowid) };
    return g.id;
  };
  const maxId = (conv) => db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM chat_messages WHERE conv_id = ?").get(conv).m;
  function ensureMember(conv, uid) {
    if (db.prepare("SELECT 1 FROM chat_members WHERE conv_id = ? AND user_id = ?").get(conv, uid)) return;
    // Someone new to «General» starts with what is already there marked as read.
    db.prepare("INSERT INTO chat_members (conv_id, user_id, last_read_id) VALUES (?, ?, ?)").run(conv, uid, maxId(conv));
  }
  /** The conversation if this user belongs to it, else null. */
  function mine(req, id) {
    const c = db.prepare("SELECT * FROM chat_conversations WHERE id = ?").get(Number(id));
    if (!c) return null;
    if (c.kind === "general") { ensureMember(c.id, req.user.id); return c; }
    return db.prepare("SELECT 1 FROM chat_members WHERE conv_id = ? AND user_id = ? AND left_at IS NULL").get(c.id, req.user.id) ? c : null;
  }
  const memberIds = (c) => (c.kind === "general"
    ? db.prepare("SELECT id FROM users WHERE active = 1").all().map((u) => u.id)
    : db.prepare("SELECT m.user_id AS id FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.conv_id = ? AND m.left_at IS NULL AND u.active = 1").all(c.id).map((u) => u.id));
  const onlineSet = () => new Set(db.prepare(`SELECT DISTINCT user_id FROM sessions WHERE last_seen > datetime('now', ?)`).all(ONLINE).map((x) => x.user_id));

  const activeCall = (conv) => {
    const c = db.prepare("SELECT * FROM chat_calls WHERE conv_id = ? AND ended_at IS NULL ORDER BY started_at DESC").get(conv);
    if (!c) return null;
    const people = db.prepare(`SELECT m.user_id AS id, u.name FROM chat_call_members m JOIN users_shown u ON u.id = m.user_id
      WHERE m.call_id = ? AND m.left_at IS NULL AND m.ping_at > datetime('now', ?) ORDER BY m.joined_at`).all(c.id, CALL_ALIVE);
    if (!people.length) {
      db.prepare("UPDATE chat_calls SET ended_at = datetime('now') WHERE id = ?").run(c.id);
      return null;
    }
    return { id: c.id, started_by: c.started_by, participants: people };
  };

  const title = (c, uid) => {
    if (c.kind === "direct") {
      const other = db.prepare("SELECT m.user_id FROM chat_members m WHERE m.conv_id = ? AND m.user_id <> ?").get(c.id, uid);
      return other ? shown(other.user_id) : "(sin usuario)";
    }
    return c.name;
  };
  const preview = (m) => (m.retracted_at ? "Mensaje eliminado" : m.kind === "call" ? "Videollamada" : (m.body || (m.file_id ? "Archivo adjunto" : m.link_label ? "Enlace" : "")).slice(0, 80));

  // ----- people -----
  r.get("/users", (req, res) => {
    const on = onlineSet();
    res.json(db.prepare(`SELECT s.id, s.name, s.role, EXISTS(SELECT 1 FROM user_photos p WHERE p.user_id = s.id) AS has_photo
      FROM users_shown s JOIN users u ON u.id = s.id WHERE u.active = 1 AND s.id <> ? ORDER BY s.name COLLATE NOCASE`).all(req.user.id)
      .map((u) => ({ ...u, has_photo: !!u.has_photo, online: on.has(u.id) })));
  });

  // ----- conversations -----
  r.get("/conversations", (req, res) => {
    const g = general();
    ensureMember(g, req.user.id);
    const on = onlineSet();
    const rows = db.prepare(`SELECT c.*, m.last_read_id FROM chat_conversations c JOIN chat_members m ON m.conv_id = c.id
      WHERE m.user_id = ? AND m.left_at IS NULL`).all(req.user.id);
    const out = rows.map((c) => {
      const last = db.prepare("SELECT * FROM chat_messages WHERE conv_id = ? ORDER BY id DESC LIMIT 1").get(c.id);
      const unread = db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE conv_id = ? AND id > ? AND user_id <> ?").get(c.id, c.last_read_id, req.user.id).n;
      const other = c.kind === "direct" ? db.prepare("SELECT user_id FROM chat_members WHERE conv_id = ? AND user_id <> ?").get(c.id, req.user.id)?.user_id : null;
      return { id: c.id, kind: c.kind, title: title(c, req.user.id), other_id: other ?? null, online: other ? on.has(other) : false,
        members: memberIds(c).length, unread,
        last_at: last?.created_at || c.created_at, last_preview: last ? preview(last) : "", last_from: last ? shown(last.user_id) : "",
        call: activeCall(c.id) };
    }).sort((a, b) => (a.kind === "general" ? -1 : b.kind === "general" ? 1 : String(b.last_at).localeCompare(String(a.last_at))));
    res.json(out);
  });

  r.post("/conversations", (req, res) => {
    const b = req.body ?? {};
    const exists = (id) => db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(id);
    if (b.user_id) {
      const other = Number(b.user_id);
      if (!exists(other) || other === req.user.id) return err(res, 400, "Elija a otro usuario activo.");
      const key = `${Math.min(other, req.user.id)}:${Math.max(other, req.user.id)}`;
      let c = db.prepare("SELECT * FROM chat_conversations WHERE direct_key = ?").get(key);
      if (!c) {
        const id = Number(db.prepare("INSERT INTO chat_conversations (kind, direct_key, created_by) VALUES ('direct', ?, ?)").run(key, req.user.id).lastInsertRowid);
        for (const u of [req.user.id, other]) db.prepare("INSERT INTO chat_members (conv_id, user_id) VALUES (?, ?)").run(id, u);
        c = { id };
      }
      return res.status(c.created_by ? 200 : 201).json({ id: c.id });
    }
    const name = str(b.name).slice(0, 80);
    const ids = [...new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map(Number).filter((x) => x && x !== req.user.id && exists(x)))];
    if (!name) return err(res, 400, "Escriba el nombre del grupo.");
    if (!ids.length) return err(res, 400, "Elija al menos un integrante.");
    const id = Number(db.prepare("INSERT INTO chat_conversations (kind, name, created_by) VALUES ('group', ?, ?)").run(name, req.user.id).lastInsertRowid);
    for (const u of [req.user.id, ...ids]) db.prepare("INSERT INTO chat_members (conv_id, user_id) VALUES (?, ?)").run(id, u);
    for (const u of ids) notify(db, u, "chat", `${req.user.name} le agregó al grupo «${name}»`, "", `#chat-${id}`, `chatgroup:${id}:${u}`);
    res.status(201).json({ id });
  });

  // Rename a group, add people (any member) or leave it.
  r.put("/conversations/:id", (req, res) => {
    const c = mine(req, req.params.id);
    if (!c || c.kind !== "group") return err(res, 404, "El grupo no existe.");
    const b = req.body ?? {};
    if (b.name !== undefined) {
      const name = str(b.name).slice(0, 80);
      if (!name) return err(res, 400, "Escriba el nombre del grupo.");
      db.prepare("UPDATE chat_conversations SET name = ? WHERE id = ?").run(name, c.id);
    }
    for (const u of (Array.isArray(b.add) ? b.add : []).map(Number)) {
      if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(u)) continue;
      const cur = db.prepare("SELECT left_at FROM chat_members WHERE conv_id = ? AND user_id = ?").get(c.id, u);
      if (!cur) db.prepare("INSERT INTO chat_members (conv_id, user_id, last_read_id) VALUES (?, ?, ?)").run(c.id, u, maxId(c.id));
      else if (cur.left_at) db.prepare("UPDATE chat_members SET left_at = NULL WHERE conv_id = ? AND user_id = ?").run(c.id, u);
      else continue;
      notify(db, u, "chat", `${req.user.name} le agregó al grupo «${c.name}»`, "", `#chat-${c.id}`, `chatgroup:${c.id}:${u}:${Date.now()}`);
    }
    res.json({ id: c.id });
  });
  r.post("/conversations/:id/leave", (req, res) => {
    const c = mine(req, req.params.id);
    if (!c || c.kind !== "group") return err(res, 404, "El grupo no existe.");
    db.prepare("UPDATE chat_members SET left_at = datetime('now') WHERE conv_id = ? AND user_id = ?").run(c.id, req.user.id);
    res.json({ ok: true });
  });
  r.get("/conversations/:id/members", (req, res) => {
    const c = mine(req, req.params.id);
    if (!c) return err(res, 404, "La conversación no existe.");
    const on = onlineSet();
    res.json(memberIds(c).map((id) => ({ id, name: shown(id), online: on.has(id) })).sort((a, b) => a.name.localeCompare(b.name)));
  });

  // ----- messages -----
  const outMessage = (m, uid) => {
    const f = m.file_id ? db.prepare("SELECT id, name, mime, size FROM chat_files WHERE id = ?").get(m.file_id) : null;
    const retracted = !!m.retracted_at;
    return {
      id: m.id, conv_id: m.conv_id, user_id: m.user_id, user_name: shown(m.user_id), mine: m.user_id === uid, kind: m.kind,
      body: retracted ? "" : m.body, created_at: m.created_at, edited_at: m.edited_at, retracted,
      link: !retracted && (m.case_id || m.client_id) ? { case_id: m.case_id, client_id: m.client_id, label: m.link_label } : null,
      file: !retracted && f ? f : null,
      call_id: m.kind === "call" ? m.call_id : null,
    };
  };

  r.get("/conversations/:id/messages", (req, res) => {
    const c = mine(req, req.params.id);
    if (!c) return err(res, 404, "La conversación no existe.");
    const after = Number(req.query.after) || 0, before = Number(req.query.before) || 0;
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    let rows;
    if (after) rows = db.prepare("SELECT * FROM chat_messages WHERE conv_id = ? AND id > ? ORDER BY id LIMIT 500").all(c.id, after);
    else if (before) rows = db.prepare("SELECT * FROM chat_messages WHERE conv_id = ? AND id < ? ORDER BY id DESC LIMIT ?").all(c.id, before, limit).reverse();
    else rows = db.prepare("SELECT * FROM chat_messages WHERE conv_id = ? ORDER BY id DESC LIMIT ?").all(c.id, limit).reverse();
    // Edits and retractions of messages the page already has travel as «changed since» (`since` = the previous answer's `now`).
    const since = str(req.query.since);
    const changed = after && since
      ? db.prepare("SELECT * FROM chat_messages WHERE conv_id = ? AND id <= ? AND (edited_at >= ? OR retracted_at >= ?) ORDER BY id")
          .all(c.id, after, since, since).map((m) => outMessage(m, req.user.id))
      : [];
    if (req.query.read !== "0") {
      const top = rows.length ? Math.max(...rows.map((m) => m.id)) : 0;
      if (top) db.prepare("UPDATE chat_members SET last_read_id = MAX(last_read_id, ?) WHERE conv_id = ? AND user_id = ?").run(top, c.id, req.user.id);
    }
    const lastRead = db.prepare("SELECT last_read_id FROM chat_members WHERE conv_id = ? AND user_id = ?").get(c.id, req.user.id)?.last_read_id || 0;
    // How far the others have read: for ✓✓ on my own messages in direct chats.
    const others = c.kind === "direct" ? db.prepare("SELECT last_read_id FROM chat_members WHERE conv_id = ? AND user_id <> ?").get(c.id, req.user.id)?.last_read_id || 0 : 0;
    res.json({ messages: rows.map((m) => outMessage(m, req.user.id)), changed, more: !after && rows.length === limit, last_read_id: lastRead, other_read_id: others,
      now: db.prepare("SELECT datetime('now') AS t").get().t, call: activeCall(c.id) });
  });

  /** A case or client the sender may open; keeps the label that the others see. */
  function linkOf(req, b) {
    const cid = Number(b.case_id) || null, kid = Number(b.client_id) || null;
    if (cid) {
      const sc = scopeOf(req.user);
      const k = db.prepare("SELECT k.id, k.title, k.office_id, k.client_id, c.full_name FROM cases k JOIN clients c ON c.id = k.client_id WHERE k.id = ?").get(cid);
      if (!k || (sc !== null && !sc.includes(k.office_id))) return { error: "No puede enlazar ese expediente." };
      return { case_id: k.id, client_id: null, label: `Expediente · ${k.full_name} · ${k.title}`.slice(0, 200) };
    }
    if (kid) {
      const c = db.prepare("SELECT id, full_name FROM clients WHERE id = ?").get(kid);
      if (!c) return { error: "El cliente no existe." };
      return { case_id: null, client_id: c.id, label: `Cliente · ${c.full_name}`.slice(0, 200) };
    }
    return { case_id: null, client_id: null, label: "" };
  }

  function mentioned(c, body, fromId) {
    const low = body.toLowerCase();
    return memberIds(c).filter((id) => id !== fromId && low.includes("@" + shown(id).toLowerCase()));
  }

  /** Tell the others: a mention always; a direct or group message once per unread streak. */
  function tellOthers(c, m, req) {
    const who = req.user.name;
    const tagged = new Set(mentioned(c, m.body, req.user.id));
    const text = (m.body || (m.file_id ? "Archivo adjunto" : "Enlace")).slice(0, 120);
    for (const uid of memberIds(c)) {
      if (uid === req.user.id) continue;
      if (tagged.has(uid)) {
        notify(db, uid, "chat", `${who} le mencionó${c.kind === "general" ? " en General" : c.kind === "group" ? ` en «${c.name}»` : ""}`, text, `#chat-${c.id}`, `chatmention:${m.id}:${uid}`);
      } else if (c.kind !== "general") {
        const lr = db.prepare("SELECT last_read_id FROM chat_members WHERE conv_id = ? AND user_id = ?").get(c.id, uid)?.last_read_id || 0;
        notify(db, uid, "chat", c.kind === "group" ? `${who} escribió en «${c.name}»` : `${who} le escribió`, text, `#chat-${c.id}`, `chatmsg:${c.id}:${uid}:${lr}`);
      }
    }
  }

  r.post("/conversations/:id/messages", (req, res) => {
    const c = mine(req, req.params.id);
    if (!c) return err(res, 404, "La conversación no existe.");
    const b = req.body ?? {};
    const body = str(b.body).trim().slice(0, MAX_BODY);
    const link = linkOf(req, b);
    if (link.error) return err(res, 400, link.error);
    let fileId = null;
    if (b.file) {
      const data = Buffer.from(String(b.file.data_base64 || ""), "base64");
      if (!data.length) return err(res, 400, "El archivo está vacío.");
      if (data.length > MAX_FILE) return err(res, 413, "El archivo pesa más de 5 MB.");
      const fname = str(b.file.name).slice(0, 160) || "archivo";
      if (BLOCKED_EXT.test(fname)) return err(res, 400, "Ese tipo de archivo no se puede enviar por el chat (programas, scripts y páginas web).");
      // The stored type is the real one for images and a neutral one for everything else.
      const mime = sniffImage(data) || "application/octet-stream";
      fileId = Number(db.prepare("INSERT INTO chat_files (conv_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?)")
        .run(c.id, fname, mime, data.length, data).lastInsertRowid);
    }
    if (!body && !fileId && !link.label) return err(res, 400, "Escriba un mensaje.");
    const id = Number(db.prepare("INSERT INTO chat_messages (conv_id, user_id, body, case_id, client_id, link_label, file_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(c.id, req.user.id, body, link.case_id, link.client_id, link.label, fileId).lastInsertRowid);
    db.prepare("UPDATE chat_members SET last_read_id = ? WHERE conv_id = ? AND user_id = ?").run(id, c.id, req.user.id);
    const m = db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id);
    tellOthers(c, m, req);
    res.status(201).json(outMessage(m, req.user.id));
  });

  // Only the author edits or retracts; the earlier text stays in `history` (nothing is deleted).
  const ownMessage = (req, res) => {
    const m = db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(Number(req.params.id));
    if (!m || !mine(req, m.conv_id)) { err(res, 404, "El mensaje no existe."); return null; }
    if (m.user_id !== req.user.id || m.kind !== "text") { err(res, 403, "Solo el autor puede cambiar su mensaje."); return null; }
    if (m.retracted_at) { err(res, 400, "El mensaje ya fue eliminado."); return null; }
    return m;
  };
  r.put("/messages/:id", (req, res) => {
    const m = ownMessage(req, res);
    if (!m) return;
    const body = str(req.body?.body).trim().slice(0, MAX_BODY);
    if (!body) return err(res, 400, "Escriba el mensaje.");
    if (body === m.body) return res.json(outMessage(m, req.user.id));
    const history = [...JSON.parse(m.history), { body: m.body, at: m.edited_at || m.created_at }];
    db.prepare("UPDATE chat_messages SET body = ?, edited_at = datetime('now'), history = ? WHERE id = ?").run(body, JSON.stringify(history), m.id);
    res.json(outMessage(db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(m.id), req.user.id));
  });
  r.post("/messages/:id/retract", (req, res) => {
    const m = ownMessage(req, res);
    if (!m) return;
    db.prepare("UPDATE chat_messages SET retracted_at = datetime('now') WHERE id = ?").run(m.id);
    res.json(outMessage(db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(m.id), req.user.id));
  });

  r.get("/files/:id", (req, res) => {
    const f = db.prepare("SELECT * FROM chat_files WHERE id = ?").get(Number(req.params.id));
    if (!f || !mine(req, f.conv_id)) return err(res, 404, "El archivo no existe.");
    // A retracted message's file is no longer offered.
    const m = db.prepare("SELECT retracted_at FROM chat_messages WHERE file_id = ?").get(f.id);
    if (m?.retracted_at) return err(res, 404, "El archivo no existe.");
    const inline = req.query.inline === "1" && IMAGE_MIMES.includes(f.mime);
    res.setHeader("Content-Type", inline ? f.mime : IMAGE_MIMES.includes(f.mime) ? f.mime : "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.send(f.data);
  });

  r.get("/search", (req, res) => {
    const q = str(req.query.q).trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    const rows = db.prepare(`SELECT m.*, c.kind AS conv_kind, c.name AS conv_name FROM chat_messages m JOIN chat_conversations c ON c.id = m.conv_id
      WHERE m.retracted_at IS NULL AND m.kind = 'text' AND (m.body LIKE ? ESCAPE '\\' OR m.link_label LIKE ? ESCAPE '\\')
        AND (c.kind = 'general' OR EXISTS (SELECT 1 FROM chat_members x WHERE x.conv_id = c.id AND x.user_id = ? AND x.left_at IS NULL))
      ORDER BY m.id DESC LIMIT 50`).all(like, like, req.user.id);
    res.json(rows.map((m) => ({ id: m.id, conv_id: m.conv_id, conv_title: title({ id: m.conv_id, kind: m.conv_kind, name: m.conv_name }, req.user.id),
      user_name: shown(m.user_id), body: m.body, link_label: m.link_label, created_at: m.created_at })));
  });

  // Total unread for the menu badge, and how many of them mention me.
  r.get("/unread", (req, res) => {
    const g = general();
    ensureMember(g, req.user.id);
    const rows = db.prepare(`SELECT c.id, COUNT(x.id) AS n FROM chat_members m JOIN chat_conversations c ON c.id = m.conv_id
      LEFT JOIN chat_messages x ON x.conv_id = c.id AND x.id > m.last_read_id AND x.user_id <> m.user_id
      WHERE m.user_id = ? AND m.left_at IS NULL GROUP BY c.id`).all(req.user.id);
    const call = db.prepare(`SELECT 1 FROM chat_calls k WHERE k.ended_at IS NULL AND k.started_by <> ? AND EXISTS (SELECT 1 FROM chat_call_members cm WHERE cm.call_id = k.id AND cm.left_at IS NULL AND cm.ping_at > datetime('now', ?))
      AND (k.conv_id = ? OR EXISTS (SELECT 1 FROM chat_members m WHERE m.conv_id = k.conv_id AND m.user_id = ? AND m.left_at IS NULL))`).get(req.user.id, CALL_ALIVE, g, req.user.id);
    const rings = db.prepare("SELECT id, from_user, body, created_at FROM chat_rings WHERE to_user = ? AND seen_at IS NULL AND created_at > datetime('now', ?) ORDER BY id").all(req.user.id, RING_LIVE)
      .map((x) => ({ id: x.id, from: shown(x.from_user), body: x.body, created_at: x.created_at }));
    res.json({ unread: rows.reduce((s, x) => s + x.n, 0), by_conversation: Object.fromEntries(rows.filter((x) => x.n).map((x) => [x.id, x.n])), calling: !!call, rings });
  });

  // ----- timbre: an audible, visible call for one person («Sube al segundo piso») -----
  r.post("/ring", (req, res) => {
    const to = Number(req.body?.to);
    const target = db.prepare("SELECT s.id FROM users_shown s JOIN users u ON u.id = s.id WHERE u.active = 1 AND s.id = ?").get(to);
    if (!target || to === req.user.id) return err(res, 400, "Elija a otra persona del despacho.");
    const body = str(req.body?.body).trim().slice(0, 120) || RING_DEFAULT;
    if (db.prepare("SELECT 1 FROM chat_rings WHERE from_user = ? AND to_user = ? AND created_at > datetime('now', '-5 seconds')").get(req.user.id, to))
      return err(res, 429, "Ya le sonó el timbre hace unos segundos.");
    const id = Number(db.prepare("INSERT INTO chat_rings (from_user, to_user, body) VALUES (?, ?, ?)").run(req.user.id, to, body).lastInsertRowid);
    notify(db, to, "chat", `🔔 ${req.user.name} le tocó el timbre`, body, "#chat", `chatring:${id}`);
    res.status(201).json({ id, to_name: shown(to), body });
  });

  // The person answers («Voy para allá»); the one who rang is told.
  r.post("/rings/:id/seen", (req, res) => {
    const k = db.prepare("SELECT * FROM chat_rings WHERE id = ? AND to_user = ?").get(Number(req.params.id), req.user.id);
    if (!k) return err(res, 404, "Ese timbre no existe.");
    if (!k.seen_at) {
      db.prepare("UPDATE chat_rings SET seen_at = datetime('now') WHERE id = ?").run(k.id);
      notify(db, k.from_user, "chat", `${req.user.name} contestó su timbre`, "Va para allá.", "#chat", `chatringseen:${k.id}`);
    }
    res.json({ ok: true });
  });

  // ----- video calls -----
  /** Start the conversation's call, or join the one in progress. */
  r.post("/conversations/:id/call", (req, res) => {
    const c = mine(req, req.params.id);
    if (!c) return err(res, 404, "La conversación no existe.");
    let call = activeCall(c.id);
    if (call && call.participants.length >= CALL_MAX && !call.participants.some((p) => p.id === req.user.id)) return err(res, 409, `La videollamada ya tiene ${CALL_MAX} personas.`);
    if (!call) {
      const id = randomUUID();
      db.prepare("INSERT INTO chat_calls (id, conv_id, started_by) VALUES (?, ?, ?)").run(id, c.id, req.user.id);
      db.prepare("INSERT INTO chat_messages (conv_id, user_id, kind, body, call_id) VALUES (?, ?, 'call', 'Inició una videollamada', ?)").run(c.id, req.user.id, id);
      for (const uid of memberIds(c)) {
        if (uid !== req.user.id) notify(db, uid, "chat", `${req.user.name} inició una videollamada${c.kind === "direct" ? "" : ` en ${c.kind === "general" ? "General" : "«" + c.name + "»"}`}`, "Toque para unirse", `#chat-${c.id}`, `chatcall:${id}:${uid}`);
      }
      call = { id, started_by: req.user.id, participants: [] };
    }
    db.prepare(`INSERT INTO chat_call_members (call_id, user_id) VALUES (?, ?)
      ON CONFLICT(call_id, user_id) DO UPDATE SET left_at = NULL, ping_at = datetime('now'), joined_at = datetime('now')`).run(call.id, req.user.id);
    const peers = activeCall(c.id).participants.filter((p) => p.id !== req.user.id);
    res.status(201).json({ call_id: call.id, peers, ice_servers: iceServers() });
  });

  const callOf = (req, res) => {
    const k = db.prepare("SELECT * FROM chat_calls WHERE id = ?").get(String(req.params.id));
    if (!k || !mine(req, k.conv_id)) { err(res, 404, "La videollamada no existe."); return null; }
    return k;
  };
  // One request both asks for the new handshake messages and says «I am still here».
  r.get("/calls/:id/poll", (req, res) => {
    const k = callOf(req, res);
    if (!k) return;
    db.prepare("UPDATE chat_call_members SET ping_at = datetime('now') WHERE call_id = ? AND user_id = ? AND left_at IS NULL").run(k.id, req.user.id);
    db.prepare("DELETE FROM chat_signals WHERE created_at < datetime('now', '-10 minutes')").run();
    const since = Number(req.query.since) || 0;
    const sig = db.prepare("SELECT id, from_user, kind, payload FROM chat_signals WHERE call_id = ? AND to_user = ? AND id > ? ORDER BY id").all(k.id, req.user.id, since);
    const call = activeCall(k.conv_id);
    res.json({ signals: sig.map((s) => ({ id: s.id, from: s.from_user, kind: s.kind, payload: JSON.parse(s.payload) })),
      participants: call && call.id === k.id ? call.participants : [], ended: !call || call.id !== k.id });
  });
  r.post("/calls/:id/signal", (req, res) => {
    const k = callOf(req, res);
    if (!k) return;
    const b = req.body ?? {};
    const to = Number(b.to);
    if (!["offer", "answer", "ice"].includes(b.kind)) return err(res, 400, "Señal no válida.");
    if (!db.prepare("SELECT 1 FROM chat_call_members WHERE call_id = ? AND user_id = ? AND left_at IS NULL").get(k.id, to)) return err(res, 404, "Esa persona ya no está en la llamada.");
    const payload = JSON.stringify(b.payload ?? null);
    if (payload.length > 20000) return err(res, 413, "Señal demasiado grande.");
    db.prepare("INSERT INTO chat_signals (call_id, from_user, to_user, kind, payload) VALUES (?, ?, ?, ?, ?)").run(k.id, req.user.id, to, b.kind, payload);
    res.status(201).json({ ok: true });
  });
  r.post("/calls/:id/leave", (req, res) => {
    const k = callOf(req, res);
    if (!k) return;
    db.prepare("UPDATE chat_call_members SET left_at = datetime('now') WHERE call_id = ? AND user_id = ?").run(k.id, req.user.id);
    if (!db.prepare("SELECT 1 FROM chat_call_members WHERE call_id = ? AND left_at IS NULL").get(k.id)) db.prepare("UPDATE chat_calls SET ended_at = datetime('now') WHERE id = ?").run(k.id);
    res.json({ ok: true });
  });

  return r;
}

/** STUN is free (Google's public servers). A TURN relay, only if the firm has one, goes in CHAT_TURN_URL / _USER / _PASS. */
export function iceServers() {
  const list = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.CHAT_TURN_URL) list.push({ urls: process.env.CHAT_TURN_URL.split(","), username: process.env.CHAT_TURN_USER || "", credential: process.env.CHAT_TURN_PASS || "" });
  return list;
}
