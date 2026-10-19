// Where the browser backend keeps the firm's data.
// - Published link (claude.ai): the artifact's own database, so data survives
//   updates of the app and is the same on every device that opens the link.
// - A local copy of the file: this browser's storage.
// Records are grouped into 64 buckets per collection (one document each, well
// under the 256 KB document limit); only buckets that changed are rewritten.
// Large files (Word templates, PDFs, signatures) go in 180 KB chunks.
(function () {
  const BUCKETS = 64;
  const CHUNK = 180000;
  const LOCAL_KEY = "juanmaapp-data-v1"; // never changes: data is migrated, not reset
  const COLLECTIONS = ["offices", "users", "clients", "categories", "types", "fields", "cases", "saved", "courts", "tasks",
    "notes", "acts", "checks", "log", "templates", "signs", "charges", "receipts", "reminders", "casedocs", "audit", "consents", "tasklog", "authorities"];
  const META = ["roles", "matrix", "prefs", "info", "payset"];
  let db = null, kind = "local";
  const saved = new Map(); // document path -> JSON last written
  let blobIndex = {};      // blob key -> chunk count

  const bucketOf = (id) => {
    const n = typeof id === "number" ? id : [...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    return Math.abs(n) % BUCKETS;
  };
  const safe = (k) => String(k).replace(/[^A-Za-z0-9_.~:@+-]/g, "_");

  async function readCollection(name) {
    const snap = await db.collection(name).limit(1000).get();
    // Documents can come back read-only (frozen) on some devices: work on plain copies.
    return snap.docs.filter((d) => d.exists).map((d) => ({ id: d.id, data: JSON.parse(JSON.stringify(d.data())) }));
  }

  // jm_blob holds one document per 180 KB piece of every stored file (photos, templates, PDFs)
  // and can pass the store's 1000-document read limit. Reading only the first 1000 would leave
  // files out, and the next save would delete the pieces of the files it read in part. So it is
  // read in windows ordered by key; if the store refuses that query, the single read is used as before.
  async function readBlobDocs(from = "", to = null) {
    try {
      const byId = new Map();
      for (let start = from; ;) {
        let q = db.collection("jm_blob").where("key", ">=", start);
        if (to !== null) q = q.where("key", "<", to);
        const snap = await q.orderBy("key").limit(1000).get();
        for (const d of snap.docs) if (d.exists) byId.set(d.id, JSON.parse(JSON.stringify(d.data())));
        if (snap.docs.length < 1000) break;
        const last = snap.docs[snap.docs.length - 1].data().key;
        if (last === start) break; // a file has far fewer than 1000 pieces; never loop forever
        start = last; // the next window starts again at this key, so its pieces are all read
      }
      return [...byId].map(([id, data]) => ({ id, data }));
    } catch {
      if (to !== null) return null;
      return readCollection("jm_blob");
    }
  }

  async function load() {
    const ns = window.claude?.use ? await Promise.race([window.claude.use("db"), new Promise((r) => setTimeout(() => r(null), 12000))]).catch(() => null) : null;
    if (ns) {
      db = ns;
      kind = "db";
      const metaDocs = await readCollection("jm_meta");
      if (!metaDocs.length) return null;
      const state = {};
      for (const m of metaDocs) {
        saved.set(`jm_meta/${m.id}`, JSON.stringify(m.data));
        if (m.id === "blobs") blobIndex = m.data.index || {};
        else state[m.id] = m.data.value;
      }
      for (const c of COLLECTIONS) {
        state[c] = [];
        for (const d of await readCollection(`jm_${c}`)) {
          saved.set(`jm_${c}/${d.id}`, JSON.stringify(d.data));
          state[c].push(...(d.data.items || []));
        }
        state[c].sort((a, b) => (a.id > b.id ? 1 : -1));
      }
      state.blobs = {};
      const chunks = await readBlobDocs();
      const byKey = {};
      for (const d of chunks) { saved.set(`jm_blob/${d.id}`, JSON.stringify(d.data)); (byKey[d.data.key] ||= [])[d.data.n] = d.data.part; }
      for (const [key, parts] of Object.entries(byKey)) if (parts.length === (blobIndex[key] || parts.length)) state.blobs[key] = parts.join("");
      return state;
    }
    kind = "local";
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch { return null; }
  }

  async function write(path, body) {
    const json = JSON.stringify(body);
    if (saved.get(path) === json) return;
    const [col, id] = path.split("/");
    try {
      await db.collection(col).doc(id).set(body);
    } catch (err) {
      if (err?.code === "quota_exceeded") throw new Error("Se llenó el espacio del enlace de prueba. Elimine registros que no necesite o instale la app en el servidor.");
      if (err?.code === "invalid_argument") throw new Error("Usted puede ver estos datos pero no modificarlos con su nivel de acceso a este enlace.");
      throw new Error(`No se pudo guardar (${err?.code || err?.message}).`);
    }
    saved.set(path, json);
  }
  async function remove(path) {
    const [col, id] = path.split("/");
    await db.collection(col).doc(id).delete();
    saved.delete(path);
  }

  async function save(state) {
    if (kind === "local") {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); }
      catch { throw new Error("Este navegador no tiene espacio para guardar más datos."); }
      return;
    }
    const want = new Map();
    for (const m of META) want.set(`jm_meta/${m}`, { value: state[m] ?? null });
    for (const c of COLLECTIONS) {
      const buckets = {};
      for (const item of state[c] || []) (buckets[bucketOf(item.id)] ||= []).push(item);
      for (const [b, items] of Object.entries(buckets)) want.set(`jm_${c}/b${b}`, { items });
    }
    const index = {};
    for (const [key, b64] of Object.entries(state.blobs || {})) {
      const n = Math.max(1, Math.ceil(b64.length / CHUNK));
      index[key] = n;
      for (let i = 0; i < n; i++) want.set(`jm_blob/${safe(key)}-${i}`, { key, n: i, part: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
    want.set("jm_meta/blobs", { index });
    // Write changed documents first, then drop ones that no longer exist.
    for (const [path, body] of want) await write(path, body);
    for (const path of [...saved.keys()]) if (!want.has(path)) await remove(path);
  }

  // Re-reads one collection (and the blobs whose key starts with blobPrefix) as stored now, so
  // records another device changed (a signer signing by link) are not overwritten with an old copy.
  async function refresh(name, blobPrefix = null) {
    if (kind !== "db") return null;
    const items = [];
    for (const path of [...saved.keys()]) if (path.startsWith(`jm_${name}/`)) saved.delete(path);
    for (const d of await readCollection(`jm_${name}`)) {
      saved.set(`jm_${name}/${d.id}`, JSON.stringify(d.data));
      items.push(...(d.data.items || []));
    }
    items.sort((a, b) => (a.id > b.id ? 1 : -1));
    const blobs = {};
    if (blobPrefix) {
      const byKey = {};
      for (const { id, data } of (await readBlobDocs(blobPrefix, blobPrefix + "\uffff")) || []) {
        saved.set(`jm_blob/${id}`, JSON.stringify(data));
        (byKey[data.key] ||= [])[data.n] = data.part;
      }
      for (const [key, parts] of Object.entries(byKey)) if (!parts.includes(undefined)) blobs[key] = parts.join("");
    }
    return { items, blobs };
  }

  window.JuanmaStore = { load, save, refresh, kind: () => kind };
})();
