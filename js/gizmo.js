/**
 * gizmo.js
 * 2D viewport gizmo that lets you drag the selected dome along world X and Z.
 *
 * Requires:
 *   - <svg id="pos-gizmo"> absolutely covering #viewport-container
 *   - window.THREE (Three.js)
 *   - window.SceneBuilder.nudgePosition(id, x, z)  — immediate 3-D feedback
 *   - window.onGizmoDrag(id, x, z)                 — called to sync UI + rebuild
 *
 * main.js calls:
 *   PosGizmo.setData(structures, selectedId)  — after every buildComplex
 *   PosGizmo.frameTick(camera, renderer)      — every animation frame
 */
(function () {
  const svg = document.getElementById('pos-gizmo');
  if (!svg) return;

  const NS  = 'http://www.w3.org/2000/svg';
  const ARROW_LEN = 62;  // px visual length
  const HEAD_SIZE = 9;   // px arrowhead

  // ── SVG helpers ─────────────────────────────────────────────────────────────
  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  function makeArrow(color, axis) {
    const g    = el('g', {});
    const line = el('line', {
      stroke: color, 'stroke-width': '2.5', 'stroke-linecap': 'round',
      'pointer-events': 'none',
    });
    const head = el('polygon', { fill: color, 'pointer-events': 'none' });
    // Transparent hit-area wider than the visual shaft for easy grabbing
    const hit  = el('rect', {
      fill: 'transparent', cursor: 'crosshair',
      'pointer-events': 'all', 'data-axis': axis,
    });
    const lbl  = el('text', {
      fill: color, 'font-size': '11', 'font-weight': '700',
      'font-family': 'Segoe UI,system-ui,sans-serif',
      'pointer-events': 'none',
    });
    lbl.textContent = axis.toUpperCase();
    g.append(line, head, hit, lbl);
    return { g, line, head, hit, lbl };
  }

  const xArrow = makeArrow('#ef4444', 'x');
  const zArrow = makeArrow('#3b82f6', 'z');

  // Centre circle — drags freely in both X and Z
  const ctr = el('circle', {
    r: '7', fill: 'rgba(255,255,255,0.12)',
    stroke: '#ffffff', 'stroke-width': '1.5',
    cursor: 'move', 'pointer-events': 'all',
  });

  const root = el('g', { id: 'gizmo-root' });
  root.style.display = 'none';
  root.append(xArrow.g, zArrow.g, ctr);
  svg.appendChild(root);

  // ── State ────────────────────────────────────────────────────────────────────
  let _structures = [], _selectedId = null;
  let _camera = null, _renderer = null;

  function setData(structures, selectedId) {
    _structures = structures;
    _selectedId = selectedId;
  }

  // ── Projection ───────────────────────────────────────────────────────────────
  // Returns SVG-local pixel coordinates for a world point, or null if off-screen.
  function project(wx, wy, wz) {
    if (!_camera || !_renderer) return null;
    const v = new THREE.Vector3(wx, wy, wz).project(_camera);
    if (v.z > 1) return null; // behind camera
    const rect    = _renderer.domElement.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width  + (rect.left - svgRect.left),
      y: -(v.y - 1) / 2 * rect.height + (rect.top  - svgRect.top),
    };
  }

  // ── Arrow geometry ───────────────────────────────────────────────────────────
  function placeArrow(arr, ox, oy, ex, ey) {
    arr.line.setAttribute('x1', ox); arr.line.setAttribute('y1', oy);
    arr.line.setAttribute('x2', ex); arr.line.setAttribute('y2', ey);

    // Arrowhead
    const dx = ex - ox, dy = ey - oy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy * HEAD_SIZE / 2, py = ux * HEAD_SIZE / 2;
    const bx = ex - ux * HEAD_SIZE, by = ey - uy * HEAD_SIZE;
    arr.head.setAttribute('points', `${ex},${ey} ${bx+px},${by+py} ${bx-px},${by-py}`);

    // Hit rect centred on shaft, rotated to match
    const mx = (ox + ex) / 2, my = (oy + ey) / 2;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    arr.hit.setAttribute('x', mx - len / 2);
    arr.hit.setAttribute('y', my - 10);
    arr.hit.setAttribute('width', len);
    arr.hit.setAttribute('height', 20);
    arr.hit.setAttribute('transform', `rotate(${ang},${mx},${my})`);

    // Label just past arrowhead
    arr.lbl.setAttribute('x', ex + ux * 6 - 4);
    arr.lbl.setAttribute('y', ey + uy * 6 + 4);
  }

  // ── Frame tick (called every animation frame from main.js) ───────────────────
  function frameTick(camera, renderer) {
    _camera = camera; _renderer = renderer;

    const sel = _structures.find(s => s.id === _selectedId);
    if (!sel) { root.style.display = 'none'; return; }

    const sx = sel.x || 0, sz = sel.z || 0;
    const o  = project(sx,     0, sz);
    const px = project(sx + 1, 0, sz);
    const pz = project(sx,     0, sz + 1);
    if (!o || !px || !pz) { root.style.display = 'none'; return; }

    // Unit screen direction for each world axis
    const xdx = px.x - o.x, xdy = px.y - o.y;
    const zdx = pz.x - o.x, zdy = pz.y - o.y;
    const xl = Math.hypot(xdx, xdy) || 1;
    const zl = Math.hypot(zdx, zdy) || 1;

    const xEx = o.x + (xdx / xl) * ARROW_LEN, xEy = o.y + (xdy / xl) * ARROW_LEN;
    const zEx = o.x + (zdx / zl) * ARROW_LEN, zEy = o.y + (zdy / zl) * ARROW_LEN;

    placeArrow(xArrow, o.x, o.y, xEx, xEy);
    placeArrow(zArrow, o.x, o.y, zEx, zEy);
    ctr.setAttribute('cx', o.x); ctr.setAttribute('cy', o.y);

    root.style.display = '';
  }

  // ── Drag logic ───────────────────────────────────────────────────────────────
  let drag = null; // { axis, mx0, my0, x0, z0 }

  function onDown(axis, e) {
    const sel = _structures.find(s => s.id === _selectedId);
    if (!sel) return;
    drag = { axis, mx0: e.clientX, my0: e.clientY, x0: sel.x || 0, z0: sel.z || 0 };
    e.preventDefault();
    e.stopPropagation(); // prevent orbit-control mousedown on the canvas
  }

  xArrow.hit.addEventListener('mousedown', e => onDown('x',  e));
  zArrow.hit.addEventListener('mousedown', e => onDown('z',  e));
  ctr.addEventListener('mousedown',         e => onDown('xz', e));

  window.addEventListener('mousemove', e => {
    if (!drag || !_camera || !_renderer) return;
    const sel = _structures.find(s => s.id === _selectedId);
    if (!sel) return;

    // Re-project from the DRAG START position so the math stays consistent
    const o  = project(drag.x0,     0, drag.z0);
    const px = project(drag.x0 + 1, 0, drag.z0);
    const pz = project(drag.x0,     0, drag.z0 + 1);
    if (!o || !px || !pz) return;

    const xdx = px.x - o.x, xdy = px.y - o.y; // screen vector for 1m world X
    const zdx = pz.x - o.x, zdy = pz.y - o.y; // screen vector for 1m world Z
    const mdx = e.clientX - drag.mx0;
    const mdy = e.clientY - drag.my0;

    let newX = drag.x0, newZ = drag.z0;

    if (drag.axis === 'x') {
      // Project mouse delta onto screen X direction
      const scl = xdx * xdx + xdy * xdy;
      if (scl > 0.5) newX = drag.x0 + (mdx * xdx + mdy * xdy) / scl;
    } else if (drag.axis === 'z') {
      // Project mouse delta onto screen Z direction
      const scl = zdx * zdx + zdy * zdy;
      if (scl > 0.5) newZ = drag.z0 + (mdx * zdx + mdy * zdy) / scl;
    } else {
      // Free XZ: solve 2×2 linear system [xdx zdx; xdy zdy] · [dX dZ]ᵀ = [mdx mdy]ᵀ
      const det = xdx * zdy - zdx * xdy;
      if (Math.abs(det) > 0.5) {
        newX = drag.x0 + (mdx * zdy - zdx * mdy) / det;
        newZ = drag.z0 + (xdx * mdy - mdx * xdy) / det;
      }
    }

    // Clamp to slider range, round to 0.25 m grid
    newX = Math.round(Math.max(-15, Math.min(15, newX)) * 4) / 4;
    newZ = Math.round(Math.max(-15, Math.min(15, newZ)) * 4) / 4;

    if (newX === sel.x && newZ === sel.z) return;
    sel.x = newX; sel.z = newZ;

    // Immediate visual feedback — moves the Three.js group without full rebuild
    if (window.SceneBuilder && window.SceneBuilder.nudgePosition) {
      window.SceneBuilder.nudgePosition(_selectedId, newX, newZ);
    }
    // Sync sliders + schedule debounced rebuild
    if (window.onGizmoDrag) window.onGizmoDrag(_selectedId, newX, newZ);
  });

  window.addEventListener('mouseup', () => { drag = null; });

  window.PosGizmo = { setData, frameTick };
})();
