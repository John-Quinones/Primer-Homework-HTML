// Runs public/web-store.js + public/demo-backend.js in Node over a fake artifact database that several
// "devices" (browser tabs) share, as the published link does.
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { SEED_CATALOG } from "../src/db.js";
import { ROLES, PERMISSIONS, DEFAULT_MATRIX, GERENCIA_ONLY } from "../src/auth.js";
import { REPORTS } from "../src/reports.js";
import { SEED_TEMPLATES, DOC_CATEGORIES, VARIABLES, FEE_CLAUSE_OLD, FEE_CLAUSE_NEW, CONTRACT_HEAD_OLD, CONTRACT_HEAD_NEW, FIRM_FIXES } from "../src/templates-seed.js";
import { asGlobal, SHARED_MODULES } from "../src/browser-module.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The shared database: collection → doc id → JSON text. */
export const newDatabase = () => new Map();
const fakeDb = (data) => ({
  collection: (name) => ({
    limit: () => ({ get: async () => ({ docs: [...(data.get(name) || new Map())].map(([id, json]) => ({ id, exists: true, data: () => JSON.parse(json) })) }) }),
    where: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }), orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }),
    doc: (id) => ({
      get: async () => { const j = data.get(name)?.get(id); return { exists: j !== undefined, data: () => JSON.parse(j) }; },
      set: async (body) => { if (!data.has(name)) data.set(name, new Map()); data.get(name).set(id, JSON.stringify(body)); },
      delete: async () => { data.get(name)?.delete(id); },
    }),
  }),
});

/** A device: its own page state over the shared database. */
export async function startDevice(data, { user } = {}) {
  const local = new Map();
  const window = {
    JUANMA_SEED_CATALOG: SEED_CATALOG,
    JUANMA_AUTH: { roles: ROLES, permissions: PERMISSIONS, matrix: DEFAULT_MATRIX, gerenciaOnly: GERENCIA_ONLY },
    JUANMA_REPORTS: REPORTS,
    JUANMA_TEMPLATES: { seed: SEED_TEMPLATES, categories: DOC_CATEGORIES, variables: VARIABLES, feeClause: [FEE_CLAUSE_OLD, FEE_CLAUSE_NEW],
      contractHead: [CONTRACT_HEAD_OLD, CONTRACT_HEAD_NEW], firmFixes: FIRM_FIXES },
    JUANMA_DIVIPOLA: JSON.parse(readFileSync(path.join(root, "public/data/divipola.json"), "utf8")),
    JUANMA_VERSION: { change: 0, name: "test" },
    claude: { use: async () => fakeDb(data) },
  };
  const context = vm.createContext({
    window, console, crypto: globalThis.crypto, navigator: { userAgent: "node-test" }, TextEncoder, TextDecoder, URLSearchParams, atob, btoa, setTimeout, clearTimeout,
    localStorage: { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) },
  });
  for (const [file, name] of SHARED_MODULES) vm.runInContext(asGlobal(path.join(root, file), name), context);
  vm.runInContext(readFileSync(path.join(root, "public/web-store.js"), "utf8"), context);
  vm.runInContext(readFileSync(path.join(root, "public/demo-backend.js"), "utf8"), context);
  const backend = window.JuanmaBackend;
  await backend.ready();
  const call = async (method, url, body) => {
    try {
      const out = await backend.request(method, url, body ? JSON.parse(JSON.stringify(body)) : body);
      return { status: method === "POST" && out != null ? 201 : out == null ? 204 : 200, body: out == null ? null : JSON.parse(JSON.stringify(out)) };
    } catch (err) {
      return { status: /permiso/.test(err.message) ? 403 : /no existe/.test(err.message) ? 404 : 400, body: { error: err.message } };
    }
  };
  return { call, backend };
}
