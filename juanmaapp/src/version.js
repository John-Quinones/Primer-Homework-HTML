// Which version of the project is running. `change` = number of commits that
// touched juanmaapp/, counted from the start of the project. Up to change 63
// the version was that number ("Cambio N"); change 64 is version 2 and every
// later change adds one to the minor number (2.1, 2.2, …). CI writes
// public/version.json before publishing; locally it is read from git.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VERSION_2_CHANGE = 64;

// Version name shown to people: 63 and earlier keep their number; then 2, 2.1, 2.2, …
export function versionName(change) {
  if (!change) return "";
  if (change < VERSION_2_CHANGE) return String(change);
  return change === VERSION_2_CHANGE ? "2" : `2.${change - VERSION_2_CHANGE}`;
}

export function readVersion() {
  const v = readChange();
  return { ...v, name: versionName(v.change) };
}

function readChange() {
  try {
    return JSON.parse(readFileSync(path.join(root, "public/version.json"), "utf8"));
  } catch {}
  try {
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    // A shallow clone counts only the fetched commits and would show a wrong, smaller version (2.5 instead of 2.29).
    if (git("rev-parse", "--is-shallow-repository") === "true") throw new Error("shallow clone");
    // Uncommitted work in juanmaapp/ is the next change (the build runs right before the commit).
    const pending = git("status", "--porcelain", "--", ".") !== "";
    const change = Number(git("rev-list", "--count", "HEAD", "--", ".")) + (pending ? 1 : 0);
    const date = pending ? new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10) : git("log", "-1", "--format=%cs");
    return { change, sha: pending ? "" : git("rev-parse", "--short", "HEAD"), date };
  } catch {
    return { change: null, sha: "", date: "" };
  }
}

// The latest rows of CAMBIOS.md, shown once per version in «Novedades de la versión».
export function readNews(count = 3) {
  try {
    const plain = (t) => t.replace(/\*\*/g, "").replace(/`/g, "").trim();
    // Rows before the «Versión 2» heading are the old "Cambio N" numbers, shown as C63.
    let legacy = true;
    return readFileSync(path.join(root, "CAMBIOS.md"), "utf8").split("\n")
      .map((line) => {
        if (/^##\s+Versi[oó]n 2\b/.test(line)) legacy = false;
        const m = line.match(/^\|\s*(\d+(?:\.\d+)?)\s*\|\s*([\d/]+)\s*\|\s*(.+?)\s*\|\s*$/);
        return m && [m[1], m[2], m[3], legacy];
      })
      .filter(Boolean)
      .slice(-count).reverse()
      .map(([n, date, text, old]) => {
        // A row that opens with a bold phrase uses it as the title; otherwise its first sentence.
        const bold = text.match(/^\*\*(.+?)\*\*\s*(.*)$/);
        const [title, rest] = bold ? [bold[1], bold[2]] : [text.split(/(?<=\.)\s/)[0], text.split(/(?<=\.)\s/).slice(1).join(" ")];
        const body = plain(rest);
        return { n: old ? `C${n}` : n, date, title: plain(title).replace(/\.$/, ""), text: body.length > 190 ? body.slice(0, 187).replace(/\s+\S*$/, "") + "…" : body };
      });
  } catch {
    return [];
  }
}

export const VERSION = { ...readVersion(), news: readNews() };
export const versionLabel = (v = VERSION) => (v.change ? `Versión ${v.name}${v.date ? ` · ${v.date.split("-").reverse().join("/")}` : ""}` : "Versión local");
