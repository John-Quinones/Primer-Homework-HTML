// A QR code as a PNG (navy RGB 31/56/100 on transparent, like the signature stamps), made with node:zlib so e-mail programs
// get a real picture (they do not show SVG). Used for the stamp of the letters sent by e-mail.
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";

const qrcode = createRequire(import.meta.url)("qrcode-generator");
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
};

export function qrPng(text, cell = 8) {
  const q = qrcode(0, "M");
  q.addData(String(text));
  q.make();
  const n = q.getModuleCount(), size = (n + 2) * cell;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter 0 + RGBA, fully transparent
    const r = Math.floor(y / cell) - 1;
    for (let x = 0; x < size; x++) {
      const c = Math.floor(x / cell) - 1;
      if (r >= 0 && r < n && c >= 0 && c < n && q.isDark(r, c)) row.set([31, 56, 100, 255], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
