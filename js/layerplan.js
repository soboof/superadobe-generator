/**
 * layerplan.js
 * Draws the 2D layer plan (section view) on a canvas.
 * Shows earthbag courses, barbed wire positions, plaster layers, and dimensions.
 */

const LayerPlan = (() => {

  function draw(canvas, params) {
    const {
      type,
      profile,        // array of {y, r} or {half, length}
      bagWidthCm,
      courseHeightCm,
      plasterVisible,
      selectedCourse, // null = all
    } = params;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Dark background
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, W, H);

    const actualProfile = type === 'vault' ? profile.half : profile;
    if (!actualProfile || actualProfile.length === 0) return;

    const maxR = Math.max(...actualProfile.map(c => c.r));
    const maxY = actualProfile[actualProfile.length - 1].y;
    const bw = bagWidthCm / 100;
    const ch = courseHeightCm / 100;

    // Padding + scale
    const pad = 24;
    const scaleX = (W / 2 - pad) / (maxR + bw);
    const scaleY = (H - pad * 2 - 20) / (maxY + ch);
    const scale = Math.min(scaleX, scaleY);

    const originX = W / 2;
    const originY = H - pad;

    function tx(r) { return originX + r * scale; }
    function txL(r) { return originX - r * scale; }
    function ty(y) { return originY - y * scale; }

    // Ground line
    ctx.strokeStyle = '#2a3347';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, originY);
    ctx.lineTo(W, originY);
    ctx.stroke();

    // Foundation fill
    ctx.fillStyle = 'rgba(100,116,139,0.15)';
    ctx.fillRect(txL(maxR + bw + 0.05), originY, (maxR + bw + 0.05) * 2 * scale, 20);

    // ── Draw each course ──────────────────────────────────────────────────
    actualProfile.forEach(({ y, r }, i) => {
      const isSelected = selectedCourse !== null && selectedCourse === i;
      const isHighlight = selectedCourse === null || isSelected;

      const top = ty(y + ch / 2);
      const bot = ty(y - ch / 2);
      const courseH = bot - top;

      // Left and right bag cross-sections
      const rOuter = r + bw / 2;
      const rInner = Math.max(0, r - bw / 2);
      const bagW = (rOuter - rInner) * scale;
      const xR = tx(rInner);
      const xL = txL(rOuter);

      // Bag fill colour (alternating slight tone for readability)
      const baseAlpha = isHighlight ? 1 : 0.25;
      const evenOdd = i % 2 === 0;
      ctx.fillStyle = evenOdd
        ? `rgba(180,130,60,${baseAlpha * 0.85})`
        : `rgba(200,155,80,${baseAlpha * 0.85})`;
      ctx.strokeStyle = `rgba(255,200,100,${baseAlpha * 0.45})`;
      ctx.lineWidth = 0.6;

      // Bag cross-section = STADIUM/capsule (sw wide × ch tall, ends rounded
      // by ch/2 — flat top/bottom, rounded inner/outer faces). Centred on the
      // layer curve at mid radius r.
      const cyMid = ty(y);
      const capR = courseH / 2;

      // Right bag (capsule)
      ctx.beginPath();
      ctx.roundRect(tx(r) - bagW / 2, cyMid - courseH / 2, bagW, courseH, capR);
      ctx.fill();
      ctx.stroke();

      // Left bag (mirror capsule)
      ctx.beginPath();
      ctx.roundRect(txL(r) - bagW / 2, cyMid - courseH / 2, bagW, courseH, capR);
      ctx.fill();
      ctx.stroke();

      // Barbed wire: the strands run circumferentially, so in this radial
      // section they read as DOTS on the bedding joint — the §3.6.6 DOUBLE
      // line, stitched toward the interior so it sits under the NEXT ring
      // (drawn astride the next course's centreline). No wire on the top
      // course: nothing rests on it.
      const nextC = actualProfile[i + 1];
      if (nextC) {
        const wireY = ty(y + ch / 2);
        const spread = Math.min(0.05, Math.max(0.015, (bw - ch) / 4));
        ctx.fillStyle = `rgba(200,168,75,${baseAlpha * 0.95})`;
        [nextC.r - spread, nextC.r + spread].forEach(rw => {
          [tx(rw), txL(rw)].forEach(px => {
            ctx.beginPath();
            ctx.arc(px, wireY, 1.7, 0, Math.PI * 2);
            ctx.fill();
          });
        });
      }

      // Course number
      if (isHighlight && courseH > 8) {
        ctx.fillStyle = `rgba(255,255,255,${baseAlpha * 0.35})`;
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(i + 1, originX, top + courseH / 2 + 3);
      }
    });

    // ── Layer curve (the generating arc / vertical compass path) ──────────
    // Connects the inner edge of every course — the curve the bags wrap.
    ctx.strokeStyle = 'rgba(96,165,250,0.7)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    [1, -1].forEach(sign => {
      ctx.beginPath();
      actualProfile.forEach((c, i) => {
        const innerEdge = (c.inner != null ? c.inner : Math.max(0, c.r - bw / 2));
        const px = originX + sign * innerEdge * scale;
        const py = ty(c.y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // ── Plaster overlay ───────────────────────────────────────────────────
    if (plasterVisible) {
      const pt = 0.03; // 3cm plaster
      actualProfile.forEach(({ y, r }) => {
        const top = ty(y + ch / 2 + pt);
        const bot = ty(y - ch / 2);
        const courseH = bot - top;
        const rOuter = r + bw / 2 + pt;
        const rInner = Math.max(0, r - bw / 2 - pt);

        // Outer plaster
        ctx.fillStyle = 'rgba(203,213,225,0.25)';
        ctx.fillRect(tx(r + bw / 2), top, pt * scale, courseH);
        ctx.fillRect(txL(r + bw / 2 + pt), top, pt * scale, courseH);

        // Inner plaster
        ctx.fillStyle = 'rgba(203,213,225,0.15)';
        ctx.fillRect(txL(r - bw / 2), top, pt * scale, courseH);
        ctx.fillRect(tx(r - bw / 2 - pt), top, pt * scale, courseH);
      });
    }

    // ── Centre line ───────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(74,222,128,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(originX, ty(maxY + ch));
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Dimension annotations ─────────────────────────────────────────────
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    // Diameter annotation
    const dimY = originY + 14;
    const firstR = actualProfile[0].r;
    ctx.strokeStyle = '#2a3347';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(txL(firstR + bw / 2), dimY - 4);
    ctx.lineTo(tx(firstR + bw / 2), dimY - 4);
    ctx.stroke();
    ctx.fillText(`Ø ${(firstR * 2 - bw).toFixed(1)} m`, originX, dimY + 7);

    // Height annotation
    const lastCourse = actualProfile[actualProfile.length - 1];
    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`↑ ${(lastCourse.y + ch / 2).toFixed(2)} m`, tx(firstR + bw / 2) + 6, ty(lastCourse.y / 2));

    // Legend
    ctx.textAlign = 'left';
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(180,130,60,0.9)';
    ctx.fillRect(8, 8, 10, 8); ctx.fillStyle = '#94a3b8'; ctx.fillText('Earthbag', 21, 16);
    ctx.fillStyle = 'rgba(200,168,75,0.95)';
    ctx.beginPath(); ctx.arc(11, 28, 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(16, 28, 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#94a3b8'; ctx.fillText('Barbed wire ×2 (section)', 21, 32);
  }

  return { draw };

})();
