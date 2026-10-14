// Signature pad: draw with mouse, finger or pen; returns a PNG data URL.
(function () {
  function SigPad(canvas) {
    const ctx = canvas.getContext("2d");
    let drawing = false, last = null, empty = true;
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const data = empty ? null : canvas.toDataURL();
      canvas.width = r.width * devicePixelRatio;
      canvas.height = r.height * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0b1f4a";
      if (data) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = data; }
    };
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; empty = false;
    });
    const end = () => { drawing = false; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.style.touchAction = "none";
    fit();
    window.addEventListener("resize", fit);
    return {
      clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; },
      isEmpty: () => empty,
      toPng: () => canvas.toDataURL("image/png"),
    };
  }
  window.JuanmaSigPad = SigPad;
})();
