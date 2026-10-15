// ==============================================================================
// MEDIDORES CHARTS - RENDERIZADO NATIVO CANVAS 2D (feat-028)
// Sin dependencias externas: CSP-safe, offline-first, PWA-friendly.
// ==============================================================================

(function () {
  const PALETA = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
  const COLOR_EJE = "#64748b";
  const COLOR_GRID = "rgba(100, 116, 139, 0.18)";

  function prepararCanvas(canvas, altura = 260) {
    const dpr = window.devicePixelRatio || 1;
    const anchoCss = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    canvas.style.width = "100%";
    canvas.style.height = `${altura}px`;
    canvas.width = Math.round(anchoCss * dpr);
    canvas.height = Math.round(altura * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, anchoCss, altura);
    return { ctx, w: anchoCss, h: altura };
  }

  function textoVacio(ctx, w, h, mensaje) {
    ctx.fillStyle = COLOR_EJE;
    ctx.font = "13px 'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(mensaje, w / 2, h / 2);
  }

  function dibujarLinea(canvas, series, opciones = {}) {
    if (!canvas) return;
    const altura = opciones.altura || 260;
    const { ctx, w, h } = prepararCanvas(canvas, altura);
    const todas = (series || []).filter((s) => s.puntos && s.puntos.length > 0).slice(0, 8);
    if (todas.length === 0) {
      textoVacio(ctx, w, h, "Sin lecturas en el rango seleccionado.");
      return;
    }
    const pad = { l: 52, r: 12, t: 14, b: 30 };
    let minV = Infinity;
    let maxV = -Infinity;
    let minT = Infinity;
    let maxT = -Infinity;
    const parsed = todas.map((s) => ({
      meta: s,
      pts: s.puntos
        .map((p) => ({ t: new Date(p.fecha).getTime(), v: Number(p.valor) }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a, b) => a.t - b.t),
    }));
    for (const s of parsed) {
      for (const p of s.pts) {
        if (p.v < minV) minV = p.v;
        if (p.v > maxV) maxV = p.v;
        if (p.t < minT) minT = p.t;
        if (p.t > maxT) maxT = p.t;
      }
    }
    if (!Number.isFinite(minV)) {
      textoVacio(ctx, w, h, "Sin datos válidos.");
      return;
    }
    if (minV === maxV) { minV -= 1; maxV += 1; }
    if (minT === maxT) { minT -= 86400000; maxT += 86400000; }

    const X = (t) => pad.l + ((t - minT) / (maxT - minT)) * (w - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - minV) / (maxV - minV)) * (h - pad.t - pad.b);

    ctx.strokeStyle = COLOR_GRID;
    ctx.fillStyle = COLOR_EJE;
    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = minV + ((maxV - minV) * i) / 4;
      const y = Y(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(formatoCorto(v), pad.l - 6, y + 4);
    }
    ctx.textAlign = "center";
    const tIni = new Date(minT);
    const tFin = new Date(maxT);
    ctx.fillText(etiquetaFecha(tIni), pad.l + 30, h - 10);
    ctx.fillText(etiquetaFecha(tFin), w - pad.r - 30, h - 10);

    parsed.forEach((s, idx) => {
      const color = PALETA[idx % PALETA.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.pts.forEach((p, j) => {
        const x = X(p.t);
        const y = Y(p.v);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = color;
      for (const p of s.pts) {
        ctx.beginPath();
        ctx.arc(X(p.t), Y(p.v), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Leyenda compacta
    ctx.textAlign = "left";
    ctx.font = "12px 'Plus Jakarta Sans', system-ui, sans-serif";
    parsed.forEach((s, idx) => {
      const y = pad.t + idx * 16;
      if (y > h - pad.b) return;
      ctx.fillStyle = PALETA[idx % PALETA.length];
      ctx.fillRect(w - pad.r - 150, y - 9, 10, 10);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(String(s.meta.medidorCodigo).slice(0, 20), w - pad.r - 136, y);
    });
  }

  function dibujarBarras(canvas, items, opciones = {}) {
    if (!canvas) return;
    const altura = opciones.altura || 260;
    const { ctx, w, h } = prepararCanvas(canvas, altura);
    const datos = (items || []).slice(0, 12);
    if (datos.length === 0) {
      textoVacio(ctx, w, h, "Sin consumos acumulados registrados aún.");
      return;
    }
    const pad = { l: 52, r: 12, t: 14, b: 56 };
    const maxV = Math.max(...datos.map((d) => Number(d.consumoNeto) || 0), 1);
    const n = datos.length;
    const slot = (w - pad.l - pad.r) / n;
    const barW = Math.min(46, slot * 0.55);

    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.fillStyle = COLOR_EJE;
    ctx.textAlign = "right";
    ctx.strokeStyle = COLOR_GRID;
    for (let i = 0; i <= 4; i++) {
      const v = (maxV * i) / 4;
      const y = pad.t + (1 - i / 4) * (h - pad.t - pad.b);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(formatoCorto(v), pad.l - 6, y + 4);
    }

    ctx.textAlign = "center";
    ctx.font = "11px 'Plus Jakarta Sans', system-ui, sans-serif";
    datos.forEach((d, i) => {
      const v = Number(d.consumoNeto) || 0;
      const bh = ((h - pad.t - pad.b) * v) / maxV;
      const x = pad.l + slot * i + (slot - barW) / 2;
      const y = h - pad.b - bh;
      ctx.fillStyle = PALETA[i % PALETA.length];
      ctx.fillRect(x, y, barW, bh);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(formatoCorto(v), x + barW / 2, y - 6);
      ctx.save();
      ctx.translate(x + barW / 2, h - pad.b + 12);
      ctx.rotate(-0.35);
      ctx.fillStyle = COLOR_EJE;
      const etiqueta = String(d.instalacionNombre || "?").slice(0, 16);
      ctx.fillText(etiqueta, 0, 10);
      ctx.restore();
    });
  }

  function dibujarDona(canvas, entradas, opciones = {}) {
    if (!canvas) return;
    const altura = opciones.altura || 260;
    const { ctx, w, h } = prepararCanvas(canvas, altura);
    const datos = (entradas || []).filter((e) => Number(e.valor) > 0);
    if (datos.length === 0) {
      textoVacio(ctx, w, h, "Sin distribución por recurso.");
      return;
    }
    const total = datos.reduce((a, e) => a + Number(e.valor), 0);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 24;
    const r = R * 0.58;
    let ang = -Math.PI / 2;
    datos.forEach((e, i) => {
      const frac = Number(e.valor) / total;
      const ang2 = ang + frac * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, ang, ang2);
      ctx.arc(cx, cy, r, ang2, ang, true);
      ctx.closePath();
      ctx.fillStyle = PALETA[i % PALETA.length];
      ctx.fill();
      ang = ang2;
    });
    // Leyenda lateral / inferior
    ctx.font = "12px 'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.textAlign = "left";
    datos.forEach((e, i) => {
      const y = 20 + i * 18;
      if (y > h - 8) return;
      ctx.fillStyle = PALETA[i % PALETA.length];
      ctx.fillRect(12, y - 10, 10, 10);
      ctx.fillStyle = "#e2e8f0";
      const pct = ((Number(e.valor) / total) * 100).toFixed(1);
      ctx.fillText(`${e.clave}: ${e.valor} (${pct}%)`, 28, y);
    });
  }

  function formatoCorto(v) {
    if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 10) / 10);
  }

  function etiquetaFecha(d) {
    try {
      return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
    } catch {
      return "";
    }
  }

  window.Charts = { dibujarLinea, dibujarBarras, dibujarDona };
})();
