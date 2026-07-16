/**
 * ui.js
 * Manages a COMPLEX of superadobe structures: add / duplicate / delete / select,
 * edits the selected structure's parameters, places it on the site, and drives
 * the 3D scene + material calculator + layer plan.
 */

(function () {

  let nextId = 1;

  function defaultStructure(overrides) {
    return Object.assign({
      id: nextId++,
      name: 'Dome',
      type: 'dome',
      diameter: 5,
      pointiness: 100,       // % → archOffset = pointiness/100 * baseRadius
      skylightRadius: 0.35,  // m
      closedTop: false,      // seal the skylight into a closed apex
      baseWallHeight: 0,     // m, derived from foundationRows
      foundationRows: 0,     // integer: cylindrical stem-wall courses at the base
      wallHeight: 3,         // m (cylinder)
      vaultLength: 6,        // m (vault)
      bagWidthCm: 50,
      courseHeightCm: 12,
      doors: 1,
      windows: 0,
      windowShape: 'rect',         // 'rect' | 'circle' (oculus)
      windowDiameterCm: 80,        // m·100, used only for circle windows
      doorWidthCm: 90,
      doorHeadShape: 'semicircle', // 'flat' | 'semicircle' | 'arc'
      doorArcHeight: 0.4,          // m, used only for 'arc' head
      corridor: true,        // entrance hall guided by a deep door mold
      corridorLen: 1.2,      // m
      buttress: false,       // §3.6.8–9 extra sack wall to 50 cm over springline
      x: 0,
      z: 0,
      rotDeg: 0,
      profile: [],
    }, overrides || {});
  }

  // ── Shared (whole-complex) settings ────────────────────────────────────────
  const shared = {
    fillType: 'sandy-loam',
    cementPct: 0,
    workers: 3,
    hoursPerDay: 8,
    skillLevel: 'intermediate',
    stepMode: false,
    stepCourse: 0,
  };

  let structures = [ defaultStructure({ name: 'Dome 1' }) ];
  let selectedId = structures[0].id;

  function selected() { return structures.find(s => s.id === selectedId) || structures[0]; }

  // ── Build profile for a structure from its params ──────────────────────────
  function recomputeProfile(s) {
    // Derive baseWallHeight from the integer foundation-row count so both
    // the profile and the material calculator see a consistent height.
    s.baseWallHeight = (s.foundationRows || 0) * (s.courseHeightCm / 100);
    const baseR = s.diameter / 2;
    if (s.type === 'dome') {
      s.profile = SuperAdobe.domeProfile({
        baseRadius: baseR,
        sackWidthCm: s.bagWidthCm,
        courseHeightCm: s.courseHeightCm,
        archOffset: (s.pointiness / 100) * baseR,
        skylightRadius: s.closedTop ? 0.06 : s.skylightRadius,
        baseWallHeight: s.baseWallHeight,
      });
    } else if (s.type === 'cylinder') {
      s.profile = SuperAdobe.cylinderProfile({
        baseRadius: baseR, sackWidthCm: s.bagWidthCm,
        courseHeightCm: s.courseHeightCm, wallHeight: s.wallHeight,
      });
    } else { // vault
      s.profile = SuperAdobe.vaultProfile({
        baseRadius: baseR, sackWidthCm: s.bagWidthCm,
        courseHeightCm: s.courseHeightCm, archOffset: (s.pointiness / 100) * baseR,
        skylightRadius: s.closedTop ? 0.06 : s.skylightRadius, baseWallHeight: 0, vaultLength: s.vaultLength,
      });
    }
  }

  // ── Generic control wiring (writes to the SELECTED structure) ─────────────
  function bindSlider(sliderId, numberId, key, target) {
    const slider = document.getElementById(sliderId);
    const num = document.getElementById(numberId);
    const write = v => { (target || selected())[key] = parseFloat(v); update(); };
    slider.addEventListener('input', () => { num.value = slider.value; write(slider.value); });
    num.addEventListener('change', () => { slider.value = num.value; write(num.value); });
  }

  function bindStepper(field, minVal, maxVal, target) {
    document.querySelectorAll(`.step-btn[data-field="${field}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        const obj = target || selected();
        const delta = parseInt(btn.dataset.delta);
        obj[field] = Math.max(minVal, Math.min(maxVal, (obj[field] || 0) + delta));
        document.getElementById(`val-${field}`).textContent = obj[field];
        update();
      });
    });
  }

  // Per-structure controls
  bindSlider('s-diameter', 'n-diameter', 'diameter');
  bindSlider('s-pointiness', 'n-pointiness', 'pointiness');
  bindSlider('s-skylight', 'n-skylight', 'skylightRadius');
  bindStepper('foundationRows', 0, 10);
  bindSlider('s-height', 'n-height', 'wallHeight');
  bindSlider('s-vault-length', 'n-vault-length', 'vaultLength');
  bindSlider('s-bagwidth', 'n-bagwidth', 'bagWidthCm');
  bindSlider('s-courseheight', 'n-courseheight', 'courseHeightCm');
  bindSlider('s-doorwidth', 'n-doorwidth', 'doorWidthCm');
  bindSlider('s-windiam', 'n-windiam', 'windowDiameterCm');
  bindSlider('s-corrlen', 'n-corrlen', 'corridorLen');
  bindSlider('s-posx', 'n-posx', 'x');
  bindSlider('s-posz', 'n-posz', 'z');
  bindSlider('s-rot', 'n-rot', 'rotDeg');
  // Quadrant rule (§3.6.9): max 4 openings total, one per quadrant
  bindStepper('doors', 0, 4);
  bindStepper('windows', 0, 4);

  document.getElementById('chk-corridor').addEventListener('change', e => {
    selected().corridor = e.target.checked;
    document.getElementById('row-corrlen').style.display = e.target.checked ? '' : 'none';
    update();
  });

  document.getElementById('chk-buttress').addEventListener('change', e => {
    selected().buttress = e.target.checked;
    update();
  });

  document.getElementById('chk-closedtop').addEventListener('change', e => {
    selected().closedTop = e.target.checked;
    updateTypeVisibility();   // hide skylight slider when the top is sealed
    update();
  });

  // Window shape (rectangular vs circular oculus)
  document.querySelectorAll('#window-shape .radio-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#window-shape .radio-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selected().windowShape = card.dataset.winshape;
      document.getElementById('row-windiam').style.display =
        card.dataset.winshape === 'circle' ? '' : 'none';
      update();
    });
  });

  // Door head shape
  document.querySelectorAll('#door-head-shape .radio-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#door-head-shape .radio-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selected().doorHeadShape = card.dataset.headshape;
      document.getElementById('row-archeight').style.display =
        card.dataset.headshape === 'arc' ? '' : 'none';
      drawDoorPreview();
      update();
    });
  });
  bindSlider('s-archeight', 'n-archeight', 'doorArcHeight');

  // Shared controls
  bindSlider('s-cement', 'n-cement', 'cementPct', shared);
  bindStepper('workers', 1, 12, shared);
  bindStepper('hours', 4, 12, shared);

  // ── Structure type ─────────────────────────────────────────────────────────
  document.querySelectorAll('#structure-type .radio-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#structure-type .radio-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selected().type = card.dataset.type;
      updateTypeVisibility();
      update();
    });
  });

  function updateTypeVisibility() {
    const t = selected().type;
    document.getElementById('row-pointiness').style.display = t === 'cylinder' ? 'none' : '';
    document.getElementById('row-closedtop').style.display = t === 'dome' ? '' : 'none';
    document.getElementById('row-skylight').style.display = (t === 'dome' && !selected().closedTop) ? '' : 'none';
    document.getElementById('section-foundation').style.display = t === 'dome' ? '' : 'none';
    document.getElementById('row-height').style.display = t === 'cylinder' ? '' : 'none';
    document.getElementById('row-vault-length').style.display = t === 'vault' ? '' : 'none';
  }

  // ── Fill type (shared) ─────────────────────────────────────────────────────
  document.querySelectorAll('.rl-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.rl-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      shared.fillType = item.dataset.fill;
      update();
    });
  });

  document.getElementById('sel-skill').addEventListener('change', e => {
    shared.skillLevel = e.target.value; update();
  });

  // ── Structure manager buttons ──────────────────────────────────────────────
  document.getElementById('btn-add-structure').addEventListener('click', () => {
    // place the new dome a comfortable distance from the selected one
    const s = selected();
    const offset = (s.diameter / 2) + 3.5;
    const n = defaultStructure({
      name: `Dome ${structures.length + 1}`,
      type: 'dome',
      x: Math.round((s.x + offset) * 4) / 4,
      z: s.z,
      diameter: s.diameter,
      bagWidthCm: s.bagWidthCm,
      courseHeightCm: s.courseHeightCm,
      doors: 0,     // domes after the first need no door; user adds one if wanted
      corridor: false,
      rotDeg: 180,  // face back toward the previous dome by default
    });
    structures.push(n);
    selectedId = n.id;
    syncControlsFromSelected();
    update();
  });

  // Ideal apse (§3.6.8): center on the outer edge of the main dome's base
  // sack; outer base edge → main apex at 45°. Acts as a buttress.
  document.getElementById('btn-add-apse').addEventListener('click', () => {
    const s = selected();
    if (s.type !== 'dome') return;
    recomputeProfile(s);
    const H = s.profile.length ? s.profile[s.profile.length - 1].y : 2;
    const apse = SuperAdobe.idealApse(s, H);
    // place opposite the door so it buttresses the back wall
    const worldAng = -(s.rotDeg || 0) * Math.PI / 180 + Math.PI;
    const n = defaultStructure({
      name: `Apse ${structures.length + 1}`,
      type: 'dome',
      diameter: Math.round(apse.baseRadius * 2 * 10) / 10,
      pointiness: s.pointiness,
      skylightRadius: Math.max(0.1, Math.min(0.35, apse.baseRadius * 0.3)),
      bagWidthCm: s.bagWidthCm,
      courseHeightCm: s.courseHeightCm,
      doors: 0, windows: 1, corridor: false,
      x: Math.round((s.x + Math.cos(worldAng) * apse.dist) * 4) / 4,
      z: Math.round((s.z + Math.sin(worldAng) * apse.dist) * 4) / 4,
      rotDeg: s.rotDeg,
    });
    structures.push(n);
    selectedId = n.id;
    syncControlsFromSelected();
    update();
  });

  document.getElementById('btn-dup-structure').addEventListener('click', () => {
    const s = selected();
    const copy = defaultStructure(Object.assign({}, s, {
      id: nextId++, name: s.name + ' copy',
      x: Math.round((s.x + s.diameter / 2 + 3) * 4) / 4, profile: [],
    }));
    structures.push(copy);
    selectedId = copy.id;
    syncControlsFromSelected();
    update();
  });

  document.getElementById('btn-del-structure').addEventListener('click', () => {
    if (structures.length <= 1) return;   // keep at least one
    structures = structures.filter(s => s.id !== selectedId);
    selectedId = structures[0].id;
    syncControlsFromSelected();
    update();
  });

  // Called by main.js when a structure is clicked in the 3D scene
  window.onStructurePick = function (id) {
    if (id === selectedId) return;
    selectedId = id;
    syncControlsFromSelected();
    update();
  };

  // Called by gizmo.js while the user drags a dome in the viewport
  window.onGizmoDrag = function (id, x, z) {
    const s = structures.find(st => st.id === id);
    if (!s) return;
    s.x = x; s.z = z;
    setVal('s-posx', 'n-posx', x);
    setVal('s-posz', 'n-posz', z);
    update();
  };

  function selectStructure(id) {
    selectedId = id;
    syncControlsFromSelected();
    update();
  }

  // ── Reflect selected structure into all controls ───────────────────────────
  function setVal(sliderId, numId, value) {
    const s = document.getElementById(sliderId), n = document.getElementById(numId);
    if (s) s.value = value;
    if (n) n.value = value;
  }

  function syncControlsFromSelected() {
    const s = selected();
    setVal('s-diameter', 'n-diameter', s.diameter);
    setVal('s-pointiness', 'n-pointiness', s.pointiness);
    setVal('s-skylight', 'n-skylight', s.skylightRadius);
    updateFoundationHint();
    setVal('s-height', 'n-height', s.wallHeight);
    setVal('s-vault-length', 'n-vault-length', s.vaultLength);
    setVal('s-bagwidth', 'n-bagwidth', s.bagWidthCm);
    setVal('s-courseheight', 'n-courseheight', s.courseHeightCm);
    setVal('s-doorwidth', 'n-doorwidth', s.doorWidthCm);
    setVal('s-corrlen', 'n-corrlen', s.corridorLen);
    setVal('s-posx', 'n-posx', s.x);
    setVal('s-posz', 'n-posz', s.z);
    setVal('s-rot', 'n-rot', s.rotDeg);
    document.getElementById('val-doors').textContent = s.doors;
    document.getElementById('val-windows').textContent = s.windows;
    document.getElementById('chk-corridor').checked = !!s.corridor;
    document.getElementById('row-corrlen').style.display = s.corridor ? '' : 'none';
    document.getElementById('chk-closedtop').checked = !!s.closedTop;
    document.getElementById('chk-buttress').checked = !!s.buttress;
    const hs = s.doorHeadShape || 'semicircle';
    document.querySelectorAll('#door-head-shape .radio-card').forEach(c =>
      c.classList.toggle('active', c.dataset.headshape === hs));
    document.getElementById('row-archeight').style.display = hs === 'arc' ? '' : 'none';
    setVal('s-archeight', 'n-archeight', s.doorArcHeight != null ? s.doorArcHeight : 0.4);
    const ws = s.windowShape || 'rect';
    document.querySelectorAll('#window-shape .radio-card').forEach(c =>
      c.classList.toggle('active', c.dataset.winshape === ws));
    document.getElementById('row-windiam').style.display = ws === 'circle' ? '' : 'none';
    setVal('s-windiam', 'n-windiam', s.windowDiameterCm != null ? s.windowDiameterCm : 80);
    drawDoorPreview();

    document.querySelectorAll('#structure-type .radio-card').forEach(c =>
      c.classList.toggle('active', c.dataset.type === s.type));
    updateTypeVisibility();
    updatePointinessLabel();
  }

  // Conventional dome (§3.6.9 Fig. 3-28): the vertical compass sits on the
  // outer edge of the base sack → rr = 2rb + sw, i.e. arch offset a = rb + sw.
  // In pointiness terms (a = p/100 · rb): p = 100·(1 + sw/rb).
  function conventionalPointiness(s) {
    const rb = Math.max(0.1, s.diameter / 2);
    return Math.round(100 * (1 + (s.bagWidthCm / 100) / rb));
  }
  document.getElementById('btn-conventional').addEventListener('click', () => {
    const s = selected();
    s.pointiness = Math.min(150, conventionalPointiness(s));
    setVal('s-pointiness', 'n-pointiness', s.pointiness);
    update();
  });

  function updatePointinessLabel() {
    const s = selected();
    const p = s.pointiness;
    let txt = 'pointed';
    if (s.type !== 'cylinder' && Math.abs(p - conventionalPointiness(s)) <= 3) txt = 'conventional — rr = 2rb + sw';
    else if (p <= 10) txt = 'shallow';
    else if (p <= 60) txt = 'rounded';
    else if (p <= 115) txt = 'pointed';
    else txt = 'sharp';
    document.getElementById('lbl-pointiness').textContent = txt;
  }

  // ── Structure list rendering ───────────────────────────────────────────────
  function renderStructureList() {
    const list = document.getElementById('structure-list');
    list.innerHTML = structures.map(s => {
      // Built height = top of the last laid course (the profile ends on the
      // hs grid, so the theoretical arc height can overstate it).
      const prof = s.type === 'vault' ? (s.profile.half || []) : (s.profile || []);
      const h = prof.length ? prof[prof.length - 1].y + (s.courseHeightCm || 12) / 200 : 0;
      const meta = s.type === 'dome'
        ? `Ø${s.diameter}m · ${h.toFixed(1)}m tall`
        : (s.type === 'cylinder' ? `Ø${s.diameter}m · ${s.wallHeight}m wall` : `Ø${s.diameter}m · ${s.vaultLength}m long`);
      const icon = s.type === 'dome' ? '⌂' : (s.type === 'vault' ? '⌣' : '○');
      return `<div class="structure-item ${s.id === selectedId ? 'active' : ''}" data-id="${s.id}">
        <span class="si-icon">${icon}</span>
        <span class="si-body"><span class="si-name">${s.name}</span><span class="si-meta">${meta}</span></span>
      </div>`;
    }).join('');
    list.querySelectorAll('.structure-item').forEach(el => {
      el.addEventListener('click', () => selectStructure(parseInt(el.dataset.id)));
    });
  }

  // ── Course step controls (operate on the selected structure) ──────────────
  function selectedProfileArr() {
    const s = selected();
    return s.type === 'vault' ? (s.profile.half || []) : (s.profile || []);
  }
  document.getElementById('cn-all').addEventListener('click', () => {
    shared.stepMode = false;
    document.getElementById('cn-all').classList.add('active');
    document.getElementById('cn-step').classList.remove('active');
    document.getElementById('cn-step-controls').style.display = 'none';
    update();
  });
  document.getElementById('cn-step').addEventListener('click', () => {
    shared.stepMode = true; shared.stepCourse = 0;
    document.getElementById('cn-step').classList.add('active');
    document.getElementById('cn-all').classList.remove('active');
    document.getElementById('cn-step-controls').style.display = '';
    update();
  });
  document.getElementById('cn-prev').addEventListener('click', () => {
    shared.stepCourse = Math.max(0, shared.stepCourse - 1);
    document.getElementById('cn-current').textContent = shared.stepCourse + 1;
    update();
  });
  document.getElementById('cn-next').addEventListener('click', () => {
    // Layering steps the whole complex: cap at the tallest structure's courses.
    const counts = structures.map(s => (s.type === 'vault' ? (s.profile.half || []) : (s.profile || [])).length);
    const max = Math.max(1, ...counts) - 1;
    shared.stepCourse = Math.min(max, shared.stepCourse + 1);
    document.getElementById('cn-current').textContent = shared.stepCourse + 1;
    update();
  });

  // ── Export / Print ─────────────────────────────────────────────────────────
  document.getElementById('btn-export').addEventListener('click', exportReport);
  document.getElementById('btn-print').addEventListener('click', () => window.print());

  // ── Main update ────────────────────────────────────────────────────────────
  let updateTimer = null;
  function update() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(_doUpdate, 60);
  }

  function paramsFor(s) {
    // Per-course built fraction: rings are cut where they enter a neighbor's
    // wall (§3.6.8) AND at door/window openings (paper eq. 10' subtracts the
    // opening arcs from every ring length), so quantities shrink accordingly.
    const others = structures.filter(o => o.id !== s.id);
    let courseSolidFrac = null;
    if (s.type === 'dome' || s.type === 'cylinder') {
      const prof = s.profile || [];
      const H = prof.length ? prof[prof.length - 1].y : 0;
      const openings = SuperAdobe.computeOpenings(s, H);
      const chM = (s.courseHeightCm || 12) / 100;
      courseSolidFrac = prof.map((c, i) => {
        const ig = SuperAdobe.intersectionGaps(s, others, c.y, c.r);
        if (ig === null) return 0;
        const og = SuperAdobe.openingGaps(c.y, c.r, openings, i, chM);
        return SuperAdobe.solidFraction(og.concat(ig));
      });
    }
    return Object.assign({}, s, shared, { innerR: s.diameter / 2, courseSolidFrac });
  }

  // ── Opening warnings (§3.6.9 quadrant rule) + Table 3-1 bag hint ─────────
  function updateRuleHints() {
    const s = selected();
    const others = structures.filter(o => o.id !== s.id);

    // Dome height + whether a neighbouring dome/apse buttresses this one (§3.6.9).
    const prof = s.type === 'vault' ? (s.profile.half || []) : (s.profile || []);
    const domeHeight = prof.length ? prof[prof.length - 1].y : 0;
    const rOuter = s.diameter / 2 + (s.bagWidthCm || 50) / 100;
    const hasButtress = others.some(o => {
      if (o.type !== 'dome' && o.type !== 'cylinder') return false;
      const d = Math.hypot((o.x || 0) - (s.x || 0), (o.z || 0) - (s.z || 0));
      return d < rOuter + (o.diameter / 2 + (o.bagWidthCm || 50) / 100);
    });

    const warnings = [
      ...SuperAdobe.validateOpenings(s, s.diameter / 2, { domeHeight, hasButtress, profile: prof }),
      ...SuperAdobe.validateDoorCollisions(s, others),
    ];
    document.getElementById('opening-warnings').innerHTML = warnings.map(w =>
      `<p class="warning">⚠ ${w}</p>`).join('');

    // §3.6.7/§3.6.9 opening limits — ideal sizes + the widest door that fits.
    const maxDoor = SuperAdobe.maxDoorWidth(s, s.diameter / 2);
    const count = (s.doors || 0) + (s.windows || 0);
    // §3.6.9 buttress advisory (dome-level, not an opening violation).
    const needsButtress = s.type === 'dome'
      && s.diameter > SuperAdobe.OPENING_RULES.buttressDiameter
      && !hasButtress && !s.buttress;
    document.getElementById('opening-hint').innerHTML =
      `§3.6.7/9: ideal door <b>1.5×1.8 m</b>, window <b>1.0×1.5 m</b>. ` +
      `Up to 4 openings — one per quadrant, ≥ 1.25 m wall between. ` +
      (count > 0 ? `Widest door for this layout: <b>${maxDoor.toFixed(2)} m</b>. ` : '') +
      (needsButtress ? `<span class="warn-text">§3.6.9: Ø > 1.5 m must be buttressed — tick “Base buttress” (Foundation) or add an apse (“+ Ideal Apse”).</span>` : '');

    const rec = SuperAdobe.recommendedSack(s.diameter);
    const ok = Math.abs(s.bagWidthCm - rec.sw) <= 5;
    document.getElementById('bag-hint').innerHTML =
      `Table 3-1 recommends <b>${rec.sw} × ${rec.hs} cm</b> sacks for Ø ${s.diameter} m` +
      (ok ? '' : ` — <span class="warn-text">current ${s.bagWidthCm} cm is off-spec</span>`);
  }

  // ── Geometric coherency F (paper eq. 8′) — live worst-ring bearing ────────
  function updateCoherency() {
    const s = selected();
    const bar = document.getElementById('fbar');
    const val = document.getElementById('fbar-val');
    const hint = document.getElementById('coherency-hint');
    const skyHint = document.getElementById('skylight-hint');
    if (!bar) return;

    const prof = s.type === 'vault' ? (s.profile.half || []) : (s.profile || []);
    if (s.type === 'cylinder' || !prof.length) {
      bar.style.width = '100%'; bar.className = 'fbar';
      val.textContent = '—'; val.className = 'fbar-val';
      if (hint) hint.textContent = 'Straight walls — every course rests fully on the one below.';
      if (skyHint) skyHint.textContent = '';
      return;
    }

    const c = SuperAdobe.coherency(prof, s.bagWidthCm, s.courseHeightCm);
    const cls = c.minF >= 0.5 ? '' : (c.minF >= 0.25 ? 'warn' : 'fail');
    bar.style.width = `${Math.round(c.minF * 100)}%`;
    bar.className = 'fbar' + (cls ? ' ' + cls : '');
    val.textContent = 'F = ' + c.minF.toFixed(2);
    val.className = 'fbar-val' + (cls ? ' ' + cls : '');
    if (hint) hint.innerHTML =
      `Worst pair: courses ${c.atCourse}–${c.atCourse + 1} — ${Math.round(c.minF * 100)}% of the flat bag width ` +
      `(L = ${(c.L * 100).toFixed(0)} cm) rests on the ring below. ` +
      (c.minF >= 0.5
        ? 'Solid (the paper suggests F ≥ ¼–½).'
        : c.minF >= 0.25
          ? '<span class="warn-text">Low — the paper suggests F ≥ ¼. Raise pointiness, widen the skylight, or use wider bags.</span>'
          : '<span class="warn-text">Very low — top rings barely rest on the one below (paper Figs 9–11, rigid-body risk). Raise pointiness, widen the skylight, or use wider bags.</span>');

    if (skyHint) {
      if (s.type === 'dome') {
        const want = s.closedTop ? 0.06 : s.skylightRadius;
        skyHint.innerHTML = c.truncated
          ? `<span class="warn-text">⚠ Courses above ${prof[prof.length - 1].y.toFixed(2)} m would float (inward step &gt; flat bag width) — ` +
            `the dome stops with skylight r = ${c.achievedRt.toFixed(2)} m (requested ${want.toFixed(2)} m).</span>`
          : `Achieved skylight r = ${c.achievedRt.toFixed(2)} m at the top ring (tr is a lower bound — thesis “tmin”).`;
      } else skyHint.textContent = '';
    }
  }

  function updateFoundationHint() {
    const s = selected();
    const fRows = s.foundationRows || 0;
    const stepEl   = document.getElementById('val-foundationRows');
    const hintEl   = document.getElementById('foundation-hint');
    const heightEl = document.getElementById('lbl-foundation-height');
    if (stepEl)   stepEl.textContent = fRows;
    if (!hintEl || !heightEl) return;
    if (fRows === 0) {
      hintEl.textContent   = 'No cylindrical base — dome curves from ground level.';
      heightEl.textContent = '';
    } else {
      const hCm = Math.round(fRows * s.courseHeightCm);
      hintEl.textContent   = fRows >= 3
        ? `${fRows} courses = ${hCm} cm stem wall.`
        : `Add ≥3 courses for domes larger than Ø4 m.`;
      heightEl.textContent = `= ${hCm} cm`;
    }
  }

  function _doUpdate() {
    structures.forEach(recomputeProfile);
    updatePointinessLabel();
    updateFoundationHint();
    renderStructureList();
    updateRuleHints();
    updateCoherency();

    // Simulation (Stage 3): analyse first so the shell paints fresh colours.
    const inSim = window.AppLevels && window.AppLevels.level === 3;
    if (inSim) computeSim();

    // 3D scene
    if (window.SceneBuilder) {
      window.SceneBuilder.buildComplex(structures, {
        selectedId, stepMode: shared.stepMode, stepCourse: shared.stepCourse,
      });
    }

    if (inSim) renderSimResults();

    // Per-structure material results + aggregate
    const perResults = structures.map(s => Calculator.compute(paramsFor(s)));
    const complex = Calculator.aggregateComplex(perResults, shared, structures.length);

    updateComplexResults(complex);
    updateSelectedSummary(perResults[structures.indexOf(selected())], selected());

    // Layer plan (selected structure)
    LayerPlan.draw(document.getElementById('layer-plan-canvas'), {
      type: selected().type,
      profile: selected().profile,
      bagWidthCm: selected().bagWidthCm,
      courseHeightCm: selected().courseHeightCm,
      plasterVisible: document.getElementById('layer-plaster').checked,
      selectedCourse: shared.stepMode ? shared.stepCourse : null,
    });

    drawDoorPreview();
  }

  // ── Render complex totals (right panel) ────────────────────────────────────
  function updateComplexResults(r) {
    document.querySelector('#stat-bags .stat-val').textContent = r.totalBagLengthM.toLocaleString();
    document.querySelector('#stat-wire .stat-val').textContent = r.totalWireM.toLocaleString();
    document.querySelector('#stat-fill .stat-val').textContent = r.totalFillM3.toFixed(1);
    document.querySelector('#stat-plaster .stat-val').textContent = r.plasterOuterM2.toFixed(0);

    const tbody = document.getElementById('detail-tbody');
    const rows = [
      ['Continuous sack (cut per ring)', r.totalBagLengthM, 'm'],
      ['Sack cuts (rings/runs)', r.totalBagCount, 'cuts'],
      ['Poly tube rolls (100m)', r.bagRolls100m, 'rolls'],
      ['Foundation sack (trench rows)', r.foundationBags, 'm'],
      ['Barbed wire (double strand)', r.totalWireM, 'm'],
      ['Wire rolls (400m)', r.wireRollsNeeded, 'rolls'],
      ['Fill material (loose)', r.fillLooseM3, 'm³'],
      ['Fill material (compacted)', r.totalFillM3, 'm³'],
      r.cementBags50kg > 0 ? ['Cement stabilizer (50kg)', r.cementBags50kg, 'bags'] : null,
      ['Rubble trench fill', r.gravelM3, 'm³'],
      ['Outer plaster area', r.plasterOuterM2, 'm²'],
      ['Inner plaster area', r.plasterInnerM2, 'm²'],
      ['Floor area (all)', r.floorAreaM2, 'm²'],
    ].filter(Boolean);
    tbody.innerHTML = rows.map(([label, val, unit]) =>
      `<tr><td>${label}</td><td>${typeof val === 'number' && !Number.isInteger(val) ? val.toFixed(2) : val.toLocaleString()}</td><td>${unit}</td></tr>`
    ).join('');

    const phases = [
      { label: 'Foundation', days: r.foundationDays },
      { label: 'Earthbag work', days: r.constructionDays },
      { label: 'Openings', days: r.openingsDays },
      { label: 'Plastering', days: r.plasterDays },
      { label: 'Curing/dry', days: r.dryingDays },
    ];
    const maxDays = Math.max(...phases.map(p => p.days), 1);
    document.getElementById('time-breakdown').innerHTML = phases.map(p =>
      `<div class="tb-row">
        <span class="tb-label">${p.label}</span>
        <div class="tb-bar-wrap"><div class="tb-bar" style="width:${(p.days / maxDays * 100).toFixed(0)}%"></div></div>
        <span class="tb-val">${p.days}d</span>
      </div>`).join('') +
      `<div class="tb-row" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
        <span class="tb-label" style="font-weight:700;color:var(--text)">Total calendar</span>
        <span class="tb-val" style="color:var(--accent);font-size:14px">${r.totalCalendarDays}d</span>
      </div>`;

    document.getElementById('eco-bar').style.width = r.ecoScore + '%';
    document.getElementById('eco-score-val').textContent = r.ecoScore + '/100';
    document.getElementById('eco-score-desc').textContent =
      Calculator.ecoDesc(r.ecoScore, shared.fillType, shared.cementPct);
  }

  // ── Selected-structure mini summary ────────────────────────────────────────
  function updateSelectedSummary(r, s) {
    const prof = s.type === 'vault' ? (s.profile.half || []) : (s.profile || []);
    const h = prof.length ? prof[prof.length - 1].y : 0;
    const items = [
      ['Name', s.name],
      ['Type', s.type],
      ['Height', `${h.toFixed(2)} m`],
      ['Courses', prof.length],
      ['Sack length', `${r.totalBagLengthM.toLocaleString()} m`],
      ['Fill (compacted)', `${r.totalFillM3.toFixed(1)} m³`],
      ['Floor area', `${r.floorAreaM2.toFixed(1)} m²`],
      ['Position', `${s.x}, ${s.z} m`],
    ];
    document.getElementById('mini-stats').innerHTML = items.map(([k, v]) =>
      `<div class="ms-row"><span class="ms-k">${k}</span><span class="ms-v">${v}</span></div>`).join('');
  }

  // ── Export text report (whole complex) ─────────────────────────────────────
  function exportReport() {
    structures.forEach(recomputeProfile);
    const perResults = structures.map(s => Calculator.compute(paramsFor(s)));
    const r = Calculator.aggregateComplex(perResults, shared, structures.length);
    const lines = [
      'SUPER ADOBE GENERATOR — COMPLEX MATERIAL REPORT',
      `Generated: ${new Date().toLocaleDateString()}`,
      '='.repeat(48),
      `Structures: ${structures.length}`,
      '',
    ];
    structures.forEach((s, i) => {
      const prof = s.type === 'vault' ? (s.profile.half || []) : (s.profile || []);
      const h = prof.length ? prof[prof.length - 1].y : 0;
      lines.push(`[${i + 1}] ${s.name} — ${s.type.toUpperCase()}`);
      lines.push(`    Inner Ø ${s.diameter} m · height ${h.toFixed(2)} m · ${prof.length} courses`);
      if (s.type !== 'cylinder') lines.push(`    Dome shape ${s.pointiness}% (arch offset ${((s.pointiness/100)*s.diameter/2).toFixed(2)} m) · skylight r=${s.skylightRadius} m`);
      lines.push(`    Position (${s.x}, ${s.z}) m · rotation ${s.rotDeg}° · ${s.doors} door(s), ${s.windows} window(s)`);
      lines.push('');
    });
    lines.push('── COMPLEX MATERIALS (all structures) ──────────');
    lines.push(`Continuous sack : ${r.totalBagLengthM} m in ${r.totalBagCount} cuts (${r.bagRolls100m} rolls × 100m)`);
    lines.push(`Barbed wire     : ${r.totalWireM} m double strand (${r.wireRollsNeeded} rolls × 400m)`);
    lines.push(`Fill material   : ${r.fillLooseM3} m³ loose / ${r.totalFillM3} m³ compacted`);
    if (r.cementBags50kg > 0) lines.push(`Cement stabiliz.: ${r.cementBags50kg} bags × 50kg`);
    lines.push(`Foundation fill : ${r.gravelM3} m³ gravel`);
    lines.push(`Outer plaster   : ${r.plasterOuterM2} m² (${r.plasterOuterKg} kg mix)`);
    lines.push(`Inner plaster   : ${r.plasterInnerM2} m² (${r.plasterInnerKg} kg mix)`);
    lines.push(`Floor area      : ${r.floorAreaM2} m²`);
    lines.push('');
    lines.push('── TIME ESTIMATE (one crew, whole complex) ─────');
    lines.push(`Crew            : ${shared.workers} workers @ ${shared.hoursPerDay}h/day (${shared.skillLevel})`);
    lines.push(`Foundation      : ${r.foundationDays} days`);
    lines.push(`Earthbag work   : ${r.constructionDays} days`);
    lines.push(`Openings        : ${r.openingsDays} days`);
    lines.push(`Plastering      : ${r.plasterDays} days`);
    lines.push(`Plaster curing  : ${r.dryingDays} days`);
    lines.push('─────────────────────────────────────────');
    lines.push(`Total calendar  : ${r.totalCalendarDays} days`);
    lines.push('');
    lines.push(`Eco score       : ${r.ecoScore}/100`);
    lines.push(Calculator.ecoDesc(r.ecoScore, shared.fillType, shared.cementPct));

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `superadobe-complex-${Date.now()}.txt`;
    a.click();
  }

  // ── Door head preview (interactive arc pivot) ──────────────────────────────
  // A small elevation of the door opening (two jambs + the head curve). For the
  // ARC head the user drags the PIVOT POINT — the compass centre the arc is
  // struck from — up/down: lowering it flattens the arc, raising it to the
  // springline makes a semicircle. The pivot sets `doorArcHeight`.
  const doorPv = { sc: 60, sy0: 150, hw: 0.45, springline: 1.85, dragging: false };

  function doorPreviewGeom() {
    const s = selected();
    const prof = s.profile || [];
    const arr = s.type === 'vault' ? (prof.half || []) : prof;
    const topY = arr.length ? arr[arr.length - 1].y : 2.3;
    const springline = Math.min(1.85, topY * 0.8);
    const hw = (s.doorWidthCm / 100) / 2;
    const shape = s.doorHeadShape || 'flat';
    const arcH = shape === 'semicircle' ? hw : (shape === 'arc' ? (s.doorArcHeight || 0.4) : 0);
    return { springline, hw, shape, arcH };
  }

  function drawDoorPreview() {
    const host = document.getElementById('door-head-preview');
    if (!host) return;
    const { springline, hw, shape, arcH } = doorPreviewGeom();
    const VBW = 240, VBH = 168, sy0 = 148, cx = 120;
    // Fixed vertical headroom so the pivot mapping stays stable while dragging.
    const sc = Math.min((sy0 - 16) / (springline + 1.0), (VBW / 2 - 18) / (hw + 0.1));
    Object.assign(doorPv, { sc, sy0, hw, springline });
    const MX = xm => (cx + xm * sc).toFixed(1);
    const MY = ym => (sy0 - ym * sc).toFixed(1);

    // Head curve as a sampled polyline (matches the build geometry exactly).
    let R = hw, cyc = springline, headPts = [];
    if (shape === 'flat') {
      headPts = [[-hw, springline], [hw, springline]];
    } else {
      if (shape === 'arc') { R = (hw * hw + arcH * arcH) / (2 * arcH); cyc = springline - (R - arcH); }
      const N = 48;
      for (let i = 0; i <= N; i++) {
        const x = -hw + (i / N) * 2 * hw;
        headPts.push([x, cyc + Math.sqrt(Math.max(0, R * R - x * x))]);
      }
    }
    const headPath = headPts.map((p, i) => (i ? 'L' : 'M') + MX(p[0]) + ',' + MY(p[1])).join(' ');

    const pivot = shape === 'flat' ? null : [0, shape === 'semicircle' ? springline : cyc];
    const bag = '#c89850', grid = 'rgba(255,255,255,0.12)', green = '#4ade80', txt = 'rgba(255,255,255,0.55)';

    let svg = `<svg viewBox="0 0 ${VBW} ${VBH}" width="100%" style="touch-action:none;cursor:${shape === 'flat' ? 'default' : 'ns-resize'};background:rgba(0,0,0,0.18);border-radius:6px">`;
    svg += `<line x1="8" y1="${sy0}" x2="${VBW - 8}" y2="${sy0}" stroke="${grid}" stroke-width="1"/>`;
    svg += `<line x1="${MX(-hw) - 8}" y1="${MY(springline)}" x2="${MX(hw) - -8}" y2="${MY(springline)}" stroke="${grid}" stroke-width="1" stroke-dasharray="3 3"/>`;
    svg += `<line x1="${MX(-hw)}" y1="${MY(0)}" x2="${MX(-hw)}" y2="${MY(springline)}" stroke="${bag}" stroke-width="5" stroke-linecap="round"/>`;
    svg += `<line x1="${MX(hw)}" y1="${MY(0)}" x2="${MX(hw)}" y2="${MY(springline)}" stroke="${bag}" stroke-width="5" stroke-linecap="round"/>`;
    svg += `<path d="${headPath}" fill="none" stroke="${bag}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (pivot) {
      const crownY = springline + arcH;
      svg += `<line x1="${MX(pivot[0])}" y1="${MY(pivot[1])}" x2="${MX(-hw)}" y2="${MY(springline)}" stroke="${green}" stroke-width="1" stroke-dasharray="2 3" opacity="0.65"/>`;
      svg += `<line x1="${MX(pivot[0])}" y1="${MY(pivot[1])}" x2="${MX(hw)}" y2="${MY(springline)}" stroke="${green}" stroke-width="1" stroke-dasharray="2 3" opacity="0.65"/>`;
      svg += `<line x1="${MX(0)}" y1="${MY(pivot[1])}" x2="${MX(0)}" y2="${MY(crownY)}" stroke="${green}" stroke-width="1" stroke-dasharray="2 3" opacity="0.45"/>`;
      svg += `<circle cx="${MX(0)}" cy="${MY(crownY)}" r="2.5" fill="${green}"/>`;
      svg += `<circle id="door-pivot" cx="${MX(pivot[0])}" cy="${MY(pivot[1])}" r="6" fill="${green}" stroke="#0f1117" stroke-width="1.5"/>`;
    }
    svg += `<text x="${cx}" y="${sy0 + 14}" fill="${txt}" font-size="9" text-anchor="middle">${(hw * 2).toFixed(2)} m wide · ${shape}${shape !== 'flat' ? ' · rise ' + arcH.toFixed(2) + ' m' : ''}</text>`;
    svg += `</svg>`;
    host.innerHTML = svg;
  }

  function setupDoorPreview() {
    const host = document.getElementById('door-head-preview');
    if (!host) return;
    const applyFromPointer = clientY => {
      const rect = host.getBoundingClientRect();
      const svgY = (clientY - rect.top) * (168 / rect.height);
      const ym = (doorPv.sy0 - svgY) / doorPv.sc;          // pivot height (m)
      const hw = doorPv.hw, springline = doorPv.springline;
      let d = Math.max(0.01, Math.min(springline - ym, hw * 6)); // pivot at/below springline
      const R = Math.hypot(hw, d);
      const arcH = Math.max(0.1, Math.min(1.5, R - d));
      const s = selected();
      s.doorHeadShape = 'arc';
      s.doorArcHeight = Math.round(arcH * 100) / 100;
      document.querySelectorAll('#door-head-shape .radio-card').forEach(c =>
        c.classList.toggle('active', c.dataset.headshape === 'arc'));
      document.getElementById('row-archeight').style.display = '';
      setVal('s-archeight', 'n-archeight', s.doorArcHeight);
      drawDoorPreview();
      update();
    };
    host.addEventListener('pointerdown', e => {
      doorPv.dragging = true;
      try { host.setPointerCapture(e.pointerId); } catch (_) {}
      applyFromPointer(e.clientY);
      e.preventDefault();
    });
    host.addEventListener('pointermove', e => { if (doorPv.dragging) applyFromPointer(e.clientY); });
    const end = e => { doorPv.dragging = false; try { host.releasePointerCapture(e.pointerId); } catch (_) {} };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
  }

  // ── Simulation (Level 3) ───────────────────────────────────────────────────
  const simEnv = Simulation.defaultEnv();
  let simField = 'utilization';
  let simResultsById = {};

  function setSimVal(sId, nId, v) {
    const s = document.getElementById(sId), n = document.getElementById(nId);
    if (s) s.value = v; if (n) n.value = v;
  }
  function syncSimControls() {
    const m = simEnv.material, l = simEnv.load;
    document.getElementById('sim-preset').value = simEnv.preset;
    document.getElementById('sim-preset-note').textContent = Simulation.MATERIAL_PRESETS[simEnv.preset].note;
    setSimVal('s-fc', 'n-fc', (m.fc / 1e6).toFixed(2));
    setSimVal('s-ft', 'n-ft', (m.ft / 1e6).toFixed(2));
    setSimVal('s-emod', 'n-emod', (m.E / 1e9).toFixed(2));
    setSimVal('s-mu', 'n-mu', m.mu);
    setSimVal('s-wind', 'n-wind', (l.windPressure / 1000).toFixed(1));
    setSimVal('s-seis', 'n-seis', l.seismicCoef);
    setSimVal('s-ground', 'n-ground', (l.groundBearing / 1000).toFixed(0));
  }

  function bindSimSlider(sId, nId, setter) {
    const s = document.getElementById(sId), n = document.getElementById(nId);
    const write = v => { setter(parseFloat(v)); update(); };
    s.addEventListener('input', () => { n.value = s.value; write(s.value); });
    n.addEventListener('change', () => { s.value = n.value; write(n.value); });
  }
  bindSimSlider('s-fc', 'n-fc', v => simEnv.material.fc = v * 1e6);
  bindSimSlider('s-ft', 'n-ft', v => simEnv.material.ft = v * 1e6);
  bindSimSlider('s-emod', 'n-emod', v => simEnv.material.E = v * 1e9);
  bindSimSlider('s-mu', 'n-mu', v => simEnv.material.mu = v);
  bindSimSlider('s-wind', 'n-wind', v => simEnv.load.windPressure = v * 1000);
  bindSimSlider('s-seis', 'n-seis', v => simEnv.load.seismicCoef = v);
  bindSimSlider('s-ground', 'n-ground', v => simEnv.load.groundBearing = v * 1000);

  document.getElementById('sim-preset').addEventListener('change', e => {
    Simulation.applyPreset(simEnv, e.target.value);
    syncSimControls();
    update();
  });

  document.querySelectorAll('.sim-field-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.sim-field-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      simField = b.dataset.field;
      if (window.SceneBuilder) window.SceneBuilder.setSimField(simField);
      renderSimResults();
    });
  });

  // Compute analysis for every structure and hand the colours to the scene.
  function computeSim() {
    simResultsById = {};
    structures.forEach(s => {
      const others = structures.filter(o => o.id !== s.id);
      const res = Simulation.analyze(s, others, simEnv);
      if (res) simResultsById[s.id] = res;
    });
    if (window.SceneBuilder) window.SceneBuilder.setSimData(simResultsById, simField, true);
  }

  const MPa = pa => (pa / 1e6).toFixed(3);
  function renderSimResults() {
    const res = simResultsById[selectedId];
    const verdictEl = document.getElementById('sim-verdict');
    if (!res) { verdictEl.textContent = 'No analysis for this structure.'; verdictEl.className = 'sim-verdict warn'; return; }

    if (res.vault) {
      verdictEl.textContent = res.note; verdictEl.className = 'sim-verdict warn';
      document.getElementById('sim-global').innerHTML = '';
      document.getElementById('sim-bench').innerHTML = '';
      document.getElementById('sim-seismic').innerHTML = '';
      renderThermal(res.thermal);
      return;
    }

    // Verdict + utilisation
    verdictEl.textContent = res.verdict;
    verdictEl.className = 'sim-verdict ' + res.verdictClass;
    document.getElementById('sim-util-bar').style.width = Math.min(100, res.overallUtil * 100).toFixed(0) + '%';
    document.getElementById('sim-util-val').textContent = res.overallUtil.toFixed(2);
    document.getElementById('sim-gov').textContent =
      `${res.peak.govMode} · ring ${res.peak.govRing + 1}`;

    // Global stability checks
    document.getElementById('sim-global').innerHTML = Object.values(res.global).map(g => {
      const pass = g.ratio >= 1;
      const fill = Math.min(100, 100 / Math.max(0.05, g.ratio));
      const col = pass ? 'var(--accent)' : 'var(--red)';
      const ratioTxt = g.ratio >= 99 ? 'n/a' : g.ratio.toFixed(2) + '×';
      return `<div class="sim-check ${pass ? 'pass' : 'fail'}">
        <span class="sim-check-icon">${pass ? '✓' : '✗'}</span>
        <span class="sim-check-name">${g.name}</span>
        <span class="sim-check-bar-wrap"><span class="sim-check-bar" style="width:${fill}%;background:${col}"></span></span>
        <span class="sim-check-val">${ratioTxt}</span>
      </div>`;
    }).join('');

    // Peak stresses vs thesis FEA envelope
    const b = res.bench;
    const benchRow = (label, val, limit, unit, conv) => {
      const ok = val <= limit;
      return `<tr><td>${label}</td>
        <td style="color:${ok ? 'var(--accent)' : 'var(--red)'}">${conv(val)}</td>
        <td>≤ ${conv(limit)} ${unit}</td></tr>`;
    };
    document.getElementById('sim-bench').innerHTML =
      benchRow('Peak tension', b.tension.val, b.tension.limit, 'MPa', MPa) +
      benchRow('Peak compression', b.compression.val, b.compression.limit, 'MPa', MPa) +
      benchRow('Peak shear', b.shear.val, b.shear.limit, 'MPa', MPa) +
      benchRow('Max deflection', b.deflect.val, b.deflect.limit, 'mm', v => (v * 1000).toFixed(2));

    // Seismic
    const sm = res.seismic;
    document.getElementById('sim-seismic').innerHTML = miniRows([
      ['Base shear', (sm.baseShear / 1000).toFixed(1) + ' kN'],
      ['Overturn ratio', sm.overturnRatio >= 99 ? 'n/a' : sm.overturnRatio.toFixed(2) + '×'],
      ['Sliding ratio', sm.slideRatio >= 99 ? 'n/a' : sm.slideRatio.toFixed(2) + '×'],
      ['Fundamental period', sm.period.toFixed(2) + ' s'],
    ]);

    renderThermal(res.thermal);
    updateLegend(res);
  }

  function renderThermal(t) {
    if (!t) { document.getElementById('sim-thermal').innerHTML = ''; return; }
    let comfort = 'Low mass';
    if (t.timeLag >= 10) comfort = 'Excellent (desert-grade)';
    else if (t.timeLag >= 6) comfort = 'Very good';
    else if (t.timeLag >= 3) comfort = 'Good';
    document.getElementById('sim-thermal').innerHTML = miniRows([
      ['U-value', t.U.toFixed(2) + ' W/m²K'],
      ['Thermal resistance', t.R.toFixed(2) + ' m²K/W'],
      ['Time lag', t.timeLag.toFixed(1) + ' h'],
      ['Decrement factor', t.decrement.toFixed(2)],
      ['Thermal mass', t.arealMass.toFixed(0) + ' kJ/m²K'],
      ['Inner swing', '±' + (t.innerSwing / 2).toFixed(1) + ' °C'],
      ['Comfort', comfort],
    ]);
  }

  function miniRows(items) {
    return items.map(([k, v]) =>
      `<div class="ms-row"><span class="ms-k">${k}</span><span class="ms-v">${v}</span></div>`).join('');
  }

  function updateLegend(res) {
    const f = Simulation.FIELDS[simField];
    const range = Simulation.fieldRange(res, simField);
    document.getElementById('sim-legend-title').textContent = f.label + (f.unit ? ` (${f.unit})` : '');
    const bar = document.getElementById('sim-legend-bar');
    bar.classList.toggle('diverging', !!f.signed);
    const lo = document.getElementById('sim-legend-lo'), hi = document.getElementById('sim-legend-hi');
    if (simField === 'utilization') { lo.textContent = '0'; hi.textContent = Math.max(1, range.hi).toFixed(1); }
    else if (simField === 'bearing') { lo.textContent = 'low'; hi.textContent = 'F=' + range.hi.toFixed(2); }
    else { lo.textContent = range.lo.toFixed(range.lo < 1 ? 2 : 1); hi.textContent = range.hi.toFixed(range.hi < 1 ? 2 : 1); }
  }

  // Called by levels.js when the Simulation tab is opened.
  window.onEnterSimulation = function () { syncSimControls(); update(); };

  // ── Land scan upload (window.LandScan → SceneBuilder.setTerrain) ─────────────
  let landFile = null, landUp = 'auto';
  const land1 = v => (Math.round(v * 10) / 10).toFixed(1);

  function applyLandScan() {
    if (!landFile || !window.LandScan || !window.SceneBuilder) return;
    const scale = parseFloat(document.getElementById('land-scale').value) || 1;
    const drop = document.getElementById('land-drop');
    const info = document.getElementById('land-info');
    const label = document.getElementById('land-drop-label');
    label.textContent = 'Reading scan…';
    window.LandScan.loadFile(landFile, { upAxis: landUp, scale }).then(terrain => {
      window.SceneBuilder.setTerrain(terrain);     // rebuilds + re-plants domes
      const i = terrain.info;
      label.textContent = landFile.name;
      drop.classList.add('loaded');
      info.style.display = '';
      info.innerHTML =
        `<b>${landFile.name}</b><br>` +
        `${land1(i.sizeX)} × ${land1(i.sizeZ)} m plot · ${land1(i.sizeY)} m relief<br>` +
        `${i.points.toLocaleString()} pts → ${i.nx}×${i.nz} grid · up = ${i.upAxis.toUpperCase()}`;
      document.getElementById('land-clear-row').style.display = '';
    }).catch(err => {
      label.textContent = 'Upload point cloud (.ply / .xyz)';
      drop.classList.remove('loaded');
      info.style.display = '';
      info.innerHTML = `<span style="color:var(--red)">${err.message || 'Could not load this scan.'}</span>`;
    });
  }

  function clearLandScan() {
    landFile = null;
    if (window.LandScan) window.LandScan.clear();
    if (window.SceneBuilder) window.SceneBuilder.clearTerrain();   // back to procedural ground
    document.getElementById('land-drop').classList.remove('loaded');
    document.getElementById('land-drop-label').textContent = 'Upload point cloud (.ply / .xyz)';
    document.getElementById('land-info').style.display = 'none';
    document.getElementById('land-clear-row').style.display = 'none';
    document.getElementById('land-file').value = '';
  }

  function setupLandScan() {
    const fileInput = document.getElementById('land-file');
    const drop = document.getElementById('land-drop');
    if (!fileInput || !drop) return;
    fileInput.addEventListener('change', e => {
      if (e.target.files && e.target.files[0]) { landFile = e.target.files[0]; applyLandScan(); }
    });
    // Drag & drop a file onto the label
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
    drop.addEventListener('drop', e => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) { landFile = e.dataTransfer.files[0]; applyLandScan(); }
    });
    // Up-axis segmented control + scale → re-grid the loaded cloud
    document.querySelectorAll('#land-up .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#land-up .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        landUp = btn.dataset.up;
        if (landFile) applyLandScan();
      });
    });
    document.getElementById('land-scale').addEventListener('change', () => { if (landFile) applyLandScan(); });
    document.getElementById('btn-land-clear').addEventListener('click', clearLandScan);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  setupDoorPreview();
  setupLandScan();
  syncSimControls();
  syncControlsFromSelected();
  // setTimeout, not requestAnimationFrame: rAF never fires in a hidden tab,
  // which would leave the first build (status bar, results, scene) unrun.
  setTimeout(_doUpdate, 0);

})();
