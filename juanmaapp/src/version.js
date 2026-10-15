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

export const VERSION = readVersion();
export const versionLabel = (v = VERSION) => (v.change ? `Cambio ${v.change}${v.date ? ` · ${v.date.split("-").reverse().join("/")}` : ""}` : "Versión local");
