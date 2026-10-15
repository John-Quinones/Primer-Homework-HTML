// Public verification codes for signed documents: 10 characters without look-alikes (0/O, 1/I/L).
import { randomInt } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function newVerifyCode() {
  let c = "";
  for (let i = 0; i < 10; i++) c += ALPHABET[randomInt(ALPHABET.length)];
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}
export const normVerifyCode = (x) => String(x ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^(.{5})(.{5})$/, "$1-$2");
