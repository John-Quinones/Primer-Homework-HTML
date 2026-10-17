// Which change of the project is running. "Cambio N" = number of commits
// that touched juanmaapp/, counted from the start of the project. CI writes
// public/version.json before publishing; locally it is read from git.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readVersion() {
  try {
    return JSON.parse(readFileSync(path.join(root, "public/version.json"), "utf8"));
  } catch {}
  try {
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
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
    return readFileSync(path.join(root, "CAMBIOS.md"), "utf8").split("\n")
      .map((line) => line.match(/^\|\s*(\d+)\s*\|\s*([\d/]+)\s*\|\s*(.+?)\s*\|\s*$/))
      .filter(Boolean)
      .slice(-count).reverse()
      .map(([, n, date, text]) => {
        // A row that opens with a bold phrase uses it as the title; otherwise its first sentence.
        const bold = text.match(/^\*\*(.+?)\*\*\s*(.*)$/);
        const [title, rest] = bold ? [bold[1], bold[2]] : [text.split(/(?<=\.)\s/)[0], text.split(/(?<=\.)\s/).slice(1).join(" ")];
        const body = plain(rest);
        return { n: Number(n), date, title: plain(title).replace(/\.$/, ""), text: body.length > 190 ? body.slice(0, 187).replace(/\s+\S*$/, "") + "…" : body };
      });
  } catch {
    return [];
  }
}

export const VERSION = { ...readVersion(), news: readNews() };
export const versionLabel = (v = VERSION) => (v.change ? `Cambio ${v.change}${v.date ? ` · ${v.date.split("-").reverse().join("/")}` : ""}` : "Versión local");
