import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";

/** Start the app on an in-memory DB; returns { base, db, close, setup, login }. */
export async function startServer() {
  const db = openDb(":memory:");
  const server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  // A tiny client that keeps its session cookie.
  const session = (cookie = "") => {
    const call = async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        headers: { "Content-Type": "application/json", "X-JuanMa": "1", ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
    return { call, get cookie() { return cookie; } };
  };

  const setup = async () => {
    const s = session();
    const r = await s.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co", password: "clave-segura-1" });
    if (r.status !== 201) throw new Error("setup failed " + JSON.stringify(r.body));
    return s;
  };
  const login = async (email, password) => {
    const s = session();
    const r = await s.call("POST", "/auth/login", { email, password });
    return Object.assign(s, { loginStatus: r.status });
  };

  return { base, db, session, setup, login, close: () => server.close() };
}
