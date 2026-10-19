// Runs public/demo-backend.js (the published link's backend) in Node, on an empty
// in-memory store, so tests can send it the same requests as the server.
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

/** A fresh link backend; returns { call(method, url, body) → { status, body } } like the server helper. */
export async function startLink() {
  let saved = null;
  const local = new Map();
  const window = {
    JUANMA_SEED_CATALOG: SEED_CATALOG,
    JUANMA_AUTH: { roles: ROLES, permissions: PERMISSIONS, matrix: DEFAULT_MATRIX, gerenciaOnly: GERENCIA_ONLY },
    JUANMA_REPORTS: REPORTS,
    JUANMA_TEMPLATES: { seed: SEED_TEMPLATES, categories: DOC_CATEGORIES, variables: VARIABLES, feeClause: [FEE_CLAUSE_OLD, FEE_CLAUSE_NEW],
      contractHead: [CONTRACT_HEAD_OLD, CONTRACT_HEAD_NEW], firmFixes: FIRM_FIXES },
    JUANMA_DIVIPOLA: JSON.parse(readFileSync(path.join(root, "public/data/divipola.json"), "utf8")),
    JUANMA_VERSION: { change: 0, name: "test" },
    JuanmaStore: { load: async () => saved && JSON.parse(saved), save: async (s) => { saved = JSON.stringify(s); }, refresh: async () => null },
  };
  const context = vm.createContext({
    window, console, crypto: globalThis.crypto, navigator: { userAgent: "node-test" }, TextEncoder, TextDecoder, URLSearchParams, atob, btoa, setTimeout, clearTimeout,
    localStorage: { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) },
  });
  for (const [file, name] of SHARED_MODULES) vm.runInContext(asGlobal(path.join(root, file), name), context);
  vm.runInContext(readFileSync(path.join(root, "public/demo-backend.js"), "utf8"), context);
  const backend = window.JuanmaBackend;
  await backend.ready();
  const call = async (method, url, body) => {
    try {
      const out = await backend.request(method, url, body ? JSON.parse(JSON.stringify(body)) : body);
      // Plain JSON, as the page receives it (and objects of this realm, for deepEqual).
      return { status: method === "POST" && out != null ? 201 : out == null ? 204 : 200, body: out == null ? null : JSON.parse(JSON.stringify(out)) };
    } catch (err) {
      return { status: /permiso/.test(err.message) ? 403 : /no existe/.test(err.message) ? 404 : 400, body: { error: err.message } };
    }
  };
  return { call, backend };
}
