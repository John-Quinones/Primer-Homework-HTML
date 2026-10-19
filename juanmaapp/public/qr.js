// QR codes (version 2.60) for the signature stamps. `modules(text)` gives the dark/light matrix
// (qrcode-generator), `png(text)` a PNG data URL in the brand navy on a transparent background (RGB 31/56/100).
(function () {
  function modules(text) {
    const q = window.qrcode(0, "M");
    q.addData(String(text));
    q.make();
    const n = q.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
  }
  function png(text, px = 360) {
    const m = modules(text), n = m.length, cell = Math.max(1, Math.floor(px / (n + 2)));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = cell * (n + 2);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgb(31,56,100)";
    m.forEach((row, r) => row.forEach((dark, c) => dark && ctx.fillRect((c + 1) * cell, (r + 1) * cell, cell, cell)));
    return canvas.toDataURL("image/png");
  }
  window.JuanmaQr = { modules, png };
})();
