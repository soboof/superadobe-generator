/**
 * main.js
 * Three.js scene: renders a COMPLEX of superadobe structures, each placed on a
 * shared terrain. Supports orbit controls, layer toggles, course stepping, and
 * click-to-select of structures via raycasting.
 */

(function () {
  // ── Scene setup ──────────────────────────────────────────────────────────
  const canvas = document.getElementById('three-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1117);
  scene.fog = new THREE.Fog(0x0f1117, 28, 80);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(8, 6, 8);
  camera.lookAt(0, 2, 0);

  // ── Orbit controls (manual, lightweight) ─────────────────────────────────
  let isDragging = false, didDrag = false, prevX = 0, prevY = 0;
  let dragButton = 0;
  let orbitTheta = Math.PI / 4, orbitPhi = Math.PI / 4, orbitR = 14;
  let orbitTarget = new THREE.Vector3(0, 2, 0);

  function updateCamera() {
    camera.position.set(
      orbitTarget.x + orbitR * Math.sin(orbitPhi) * Math.sin(orbitTheta),
      orbitTarget.y + orbitR * Math.cos(orbitPhi),
      orbitTarget.z + orbitR * Math.sin(orbitPhi) * Math.cos(orbitTheta)
    );
    camera.lookAt(orbitTarget);
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    isDragging = true; didDrag = false;
    dragButton = e.button;
    prevX = e.clientX; prevY = e.clientY;
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    if (Math.abs(dx) + Math.abs(dy) > 3) didDrag = true;

    if (dragButton === 2) {
      // Right-drag: pan the orbit target
      const panSpeed = orbitR * 0.001;
      // Camera right vector (horizontal)
      const right = new THREE.Vector3(Math.cos(orbitTheta), 0, -Math.sin(orbitTheta));
      // Camera up vector in world space
      const camUp = new THREE.Vector3(
        -Math.cos(orbitPhi) * Math.sin(orbitTheta),
        Math.sin(orbitPhi),
        -Math.cos(orbitPhi) * Math.cos(orbitTheta)
      );
      orbitTarget.addScaledVector(right, -dx * panSpeed);
      orbitTarget.addScaledVector(camUp, dy * panSpeed);
    } else {
      // Left-drag: orbit
      orbitTheta -= dx * 0.006;
      orbitPhi = Math.max(0.05, Math.min(Math.PI * 0.48, orbitPhi + dy * 0.006));
    }

    prevX = e.clientX; prevY = e.clientY;
    updateCamera();
  });
  canvas.addEventListener('wheel', e => {
    orbitR = Math.max(3, Math.min(60, orbitR + e.deltaY * 0.02));
    updateCamera();
    e.preventDefault();
  }, { passive: false });

  // Touch support
  let lastTouchDist = 0;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { isDragging = true; prevX = e.touches[0].clientX; prevY = e.touches[0].clientY; }
    if (e.touches.length === 2) { lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
  });
  canvas.addEventListener('touchend', () => { isDragging = false; });
  canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && isDragging) {
      const dx = (e.touches[0].clientX - prevX) * 0.008;
      const dy = (e.touches[0].clientY - prevY) * 0.008;
      orbitTheta -= dx; orbitPhi = Math.max(0.05, Math.min(Math.PI * 0.48, orbitPhi + dy));
      prevX = e.touches[0].clientX; prevY = e.touches[0].clientY;
      updateCamera();
    }
    if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      orbitR = Math.max(3, Math.min(60, orbitR - (d - lastTouchDist) * 0.05));
      lastTouchDist = d; updateCamera();
    }
    e.preventDefault();
  }, { passive: false });

  // ── Lights ───────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  const sun = new THREE.DirectionalLight(0xfff5e0, 1.4);
  sun.position.set(14, 24, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -28;
  sun.shadow.camera.right = sun.shadow.camera.top = 28;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xa8d8ea, 0.3);
  fill.position.set(-10, 5, -6);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x6b7c3c, 0.35));

  // ── Materials ─────────────────────────────────────────────────────────────
  function bagMaterial(odd) {
    return new THREE.MeshStandardMaterial({
      color: odd ? 0xb08040 : 0xc89850, roughness: 0.85, metalness: 0.0,
      side: THREE.DoubleSide,   // bag tubes are swept inside-out; render both faces
    });
  }
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1c1c1e });
  const plasterOuterMat = new THREE.MeshStandardMaterial({ color: 0xd4c5a0, roughness: 0.9, transparent: true, opacity: 0.9, side: THREE.FrontSide });
  const plasterInnerMat = new THREE.MeshStandardMaterial({ color: 0xe8dfc0, roughness: 0.95, side: THREE.BackSide });
  const terrainMat = new THREE.MeshStandardMaterial({ color: 0x3d5a2e, roughness: 0.95, metalness: 0 });
  const foundMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 0.9 });
  const selectMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xcba877, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
  // Stage 3 (Simulation): a stress/utilisation heat-map painted per vertex.
  const simMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide });

  // Render mode: 1 = LAYOUT (smooth unified shell), 2 = LAYERING (bag courses),
  //              3 = SIMULATION (heat-mapped shell)
  let renderLevel = (window.AppLevels && window.AppLevels.level) || 1;
  // Simulation data: { resultsById: {id: analysisResult}, field: 'utilization' }
  let simData = { resultsById: {}, field: 'utilization' };

  // Uploaded land scan (window.LandScan terrain) or null for the procedural plane.
  // When set, structures are planted on the scanned surface via heightAt(x,z).
  let customTerrain = null;
  function groundY(x, z) { return customTerrain ? customTerrain.heightAt(x || 0, z || 0) : 0; }

  // ── Scene groups ──────────────────────────────────────────────────────────
  const structuresRoot = new THREE.Group();   // all structure groups
  const terrainGroup = new THREE.Group();
  scene.add(structuresRoot, terrainGroup);

  // Per-layer visibility is tracked and applied on (re)build.
  const layerVisible = { bags: true, wire: true, plaster: false, terrain: true };

  function disposeGroup(g) {
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    while (g.children.length) g.remove(g.children[0]);
  }

  // Paint a shell geometry with per-vertex colours for the chosen sim field.
  function paintSimColors(geom, result, fieldKey) {
    if (!geom || !result || !window.Simulation || !result.rings) return;
    const pos = geom.attributes.position;
    const range = Simulation.fieldRange(result, fieldKey);
    const f = Simulation.FIELDS[fieldKey];
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ring = Simulation.ringAtHeight(result, pos.getY(i));
      const val = f.get(ring) * f.scale;
      const c = Simulation.colorForField(fieldKey, val, range);
      colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
    }
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }

  // ── Build one structure into a positioned group ──────────────────────────
  // `others` = the remaining structures: course rings are cut where they run
  // into a neighbor's wall (thesis §3.6.8 — sacks stop at the intersection
  // points and each dome abides by its own compass).
  function buildStructureGroup(s, opts, others) {
    const group = new THREE.Group();
    group.position.set(s.x || 0, groundY(s.x, s.z), s.z || 0);
    group.rotation.y = (s.rotDeg || 0) * Math.PI / 180;
    group.userData.structureId = s.id;

    const bw = s.bagWidthCm;
    const ch = s.courseHeightCm;
    const innerR = s.diameter / 2;
    const isSelected = s.id === opts.selectedId;

    const bagGroup = new THREE.Group();
    const wireGroup = new THREE.Group();
    const plasterGroup = new THREE.Group();
    group.add(bagGroup, wireGroup, plasterGroup);

    // Foundation
    const foundGeom = SuperAdobe.buildFoundationGeometry(innerR, bw);
    const found = new THREE.Mesh(foundGeom, foundMat);
    found.receiveShadow = true;
    group.add(found);

    if ((s.type === 'dome' || s.type === 'cylinder') && renderLevel === 1) {
      // ── Stage 1: smooth unified shell (revolve + boolean trim) ──────────
      const shellGeom = SuperAdobe.buildShellGeometry(s, others);
      if (shellGeom) {
        const m = new THREE.Mesh(shellGeom, shellMat);
        m.castShadow = true; m.receiveShadow = true;
        bagGroup.add(m);
      }
    } else if ((s.type === 'dome' || s.type === 'cylinder') && renderLevel === 3) {
      // ── Stage 3: simulation heat-map painted on the unified shell ─────────
      const shellGeom = SuperAdobe.buildShellGeometry(s, others);
      const result = simData.resultsById[s.id];
      if (shellGeom) {
        paintSimColors(shellGeom, result, simData.field);
        const m = new THREE.Mesh(shellGeom, result ? simMat : shellMat);
        m.castShadow = true; m.receiveShadow = true;
        bagGroup.add(m);
      }
    } else if (s.type === 'dome' || s.type === 'cylinder') {
      const profile = s.profile;
      const totalH = profile.length ? profile[profile.length - 1].y : 2;
      const openings = SuperAdobe.computeOpenings(s, totalH);

      // Layering steps the WHOLE complex layer by layer (every structure cut
      // at the same course index), not one dome at a time.
      const visible = opts.stepMode
        ? profile.slice(0, opts.stepCourse + 1)
        : profile;
      // Step height reached so far — the door / corridor build up with it.
      const stepMaxY = opts.stepMode && visible.length
        ? visible[visible.length - 1].y
        : Infinity;

      visible.forEach((c, i) => {
        // Gaps from openings + neighbor-dome intersections (null = course
        // entirely inside a neighbor: not built at all)
        const interGaps = SuperAdobe.intersectionGaps(s, others, c.y, c.r, i);
        if (interGaps === null) return;
        const gaps = SuperAdobe.openingGaps(c.y, c.r, openings, i, ch / 100).concat(interGaps);
        const geoms = SuperAdobe.buildCourseGeometries(c.y, c.r, bw, ch, gaps, i);
        const mat = bagMaterial(i % 2);
        geoms.forEach(g => {
          const m = new THREE.Mesh(g, mat);
          m.castShadow = true; m.receiveShadow = true;
          bagGroup.add(m);
        });
        // Barbed wire: the §3.6.6 DOUBLE strand in the bedding joint on top of
        // this course, stitched toward the INTERIOR so it sits under the NEXT
        // ring — laid astride the next course's centreline. The top course of
        // the whole profile gets no wire (nothing rests on it).
        const next = profile[i + 1];
        if (next) {
          const jointY = c.y + ch / 200 + 0.004;
          const spreadM = Math.min(0.05, Math.max(0.015, (bw / 100 - ch / 100) / 4));
          // Door→corridor bridges: where the ring wire ends at a doorway that has
          // a corridor, run it out along the jambs to the corridor mouth so the
          // dome and corridor wires are ONE connected line through the layer
          // (broken only at windows and the open corridor mouth). Jamb region only.
          let bridges = null;
          if (s.type === 'dome' && s.corridor && s.doors > 0) {
            const bwM = bw / 100;
            const startR = (profile[0] ? profile[0].inner : innerR) + bwM;
            const Lout = startR + (s.corridorLen || 1.2);
            bridges = [];
            openings.forEach(d => {
              if (d.kind !== 'door') return;
              const sl = d.springline != null ? d.springline : d.top;
              if (c.y > sl + 1e-6) return;                   // jamb region only
              if (c.y < (d.bottom || 0) - 1e-6) return;      // below the threshold: ring is unbroken
              const inJamb = (c.y + ch / 200) <= sl + 1e-6;  // matches openingGaps notch
              const plusCut = (i % 2) === 1;
              const hwPlus  = d.width / 2 + (inJamb && plusCut ? bwM : 0);
              const hwMinus = d.width / 2 + (inJamb && !plusCut ? bwM : 0);
              const hi = d.angle + hwPlus / c.r;
              const lo = d.angle - hwMinus / c.r;
              const zc = d.width / 2 + bwM / 2;               // jamb centreline offset
              const Rd = c.inner + bwM;                       // dome outer face radius here
              const jx = Math.sqrt(Math.max(0.01, Rd * Rd - zc * zc));
              const ca = Math.cos(d.angle), sa = Math.sin(d.angle);
              const rot = (x, z) => ({ x: x * ca - z * sa, z: x * sa + z * ca });
              bridges.push({
                hi, lo,
                prepend: [rot(Lout, zc), rot(jx, zc)],         // +z mouth → jamb → ring
                append:  [rot(jx, -zc), rot(Lout, -zc)],       // ring → jamb → −z mouth
              });
            });
            if (!bridges.length) bridges = null;
          }
          SuperAdobe.buildWireGeometries(jointY, next.r, gaps, (ch / 100) * 0.35, bridges, spreadM)
            .forEach(wg => wireGroup.add(new THREE.LineSegments(wg, wireMat)));
        }
      });

      // Entrance corridor: a hall guided by a deep door mold (§3.6.7-3.6.8).
      // It builds up with the Step view — only courses up to the current step
      // height are laid, so the door rises along with the dome.
      if (s.type === 'dome' && s.corridor && s.doors > 0) {
        const doorOpenings = openings.filter(o => o.kind === 'door');
        doorOpenings.forEach(d => {
          const startR = (profile[0] ? profile[0].inner : innerR) + bw / 100; // outer face of dome wall
          const corridorOpts = {
            angle: d.angle,
            startR,
            profile,                       // dome profile → courses begin on the dome surface
            length: s.corridorLen || 1.2,
            doorWidth: d.width,
            doorTop: d.springline != null ? d.springline : d.top,
            headShape: d.headShape || 'flat',
            arcHeight: d.arcHeight || 0,
            bagWidthCm: bw, courseHeightCm: ch,
            maxY: stepMaxY,
          };
          SuperAdobe.buildCorridorGeometries(corridorOpts).forEach((g, gi) => {
            const m = new THREE.Mesh(g, bagMaterial(gi % 2));
            m.castShadow = true; m.receiveShadow = true;
            bagGroup.add(m);
          });
          // Barbed wire follows the corridor courses too — one strand on each
          // course centreline, in the bedding joint between the layers.
          SuperAdobe.buildCorridorWireGeometries(corridorOpts)
            .forEach(wg => wireGroup.add(new THREE.LineSegments(wg, wireMat)));
        });
      }

      // Door / window HEAD BAG: the continuous "mold" course — a real bag swept
      // along the exact head curve on the dome wall, capping each opening. It
      // appears once the courses have built up past the crown (Step view).
      if (s.type === 'dome') {
        openings.forEach((o, oi) => {
          if (opts.stepMode && stepMaxY < o.top - 1e-6) return;   // not laid yet
          const headBag = SuperAdobe.buildOpeningHeadBag(o, profile, bw, ch);
          if (headBag) {
            const m = new THREE.Mesh(headBag, bagMaterial(oi % 2));
            m.castShadow = true; m.receiveShadow = true;
            bagGroup.add(m);
          }
        });
      }

      // Plaster shells
      const outerGeom = SuperAdobe.buildPlasterGeometry(profile, bw, 3);
      if (outerGeom) { const m = new THREE.Mesh(outerGeom, plasterOuterMat); m.castShadow = true; plasterGroup.add(m); }
      const innerGeom = SuperAdobe.buildInnerPlasterGeometry(profile, bw, 3);
      if (innerGeom) plasterGroup.add(new THREE.Mesh(innerGeom, plasterInnerMat));
    }

    if (s.type === 'vault') {
      const { half, length: L } = s.profile;
      const bagLenM = bw / 100;
      const nAlong = Math.ceil(L / bagLenM);
      const visible = opts.stepMode ? half.slice(0, opts.stepCourse + 1) : half;

      visible.forEach((c, i) => {
        for (let sIdx = 0; sIdx < nAlong; sIdx++) {
          const z = -L / 2 + sIdx * bagLenM + bagLenM / 2;
          const segs = Math.max(12, Math.round(c.r * 20));
          const pts = [];
          for (let k = 0; k <= segs; k++) {
            const a = (k / segs) * Math.PI;
            pts.push(new THREE.Vector3(Math.cos(a) * c.r, c.y, 0));
          }
          const curve = new THREE.CatmullRomCurve3(pts);
          const tg = new THREE.TubeGeometry(curve, segs, bagLenM / 2, 5, false);
          tg.translate(0, 0, z);
          const m = new THREE.Mesh(tg, bagMaterial(i % 2));
          m.castShadow = true; bagGroup.add(m);
        }
        // Barbed wire in the bedding joint (top of course): the §3.6.6 DOUBLE
        // strand astride the bag centreline on both long edges of the vault.
        const wy = c.y + ch / 200 + 0.004;
        const nZ = Math.max(2, Math.round(L / 0.2));
        const vSp = Math.min(0.05, Math.max(0.015, (bw / 100 - ch / 100) / 4));
        [-1, 1].forEach(side => {
          [-vSp, vSp].forEach(off => {
            const pts = [];
            for (let k = 0; k <= nZ; k++) {
              pts.push(new THREE.Vector3(side * (c.r + off), wy, -L / 2 + (k / nZ) * L));
            }
            const wg = SuperAdobe.barbedStrand(pts, 0.2, (ch / 100) * 0.35);
            if (wg) wireGroup.add(new THREE.LineSegments(wg, wireMat));
          });
        });
      });
    }

    // Base buttress (§3.6.8–3.6.9): an extra sack wall around the dome's base,
    // to 50 cm above the springline, sewn to the base rings. Cut where a door
    // (plus its corridor walls) passes through, and at neighbouring domes.
    if (s.type === 'dome' && s.buttress) {
      const profile = s.profile || [];
      const totalH = profile.length ? profile[profile.length - 1].y : 2;
      const doorOps = SuperAdobe.computeOpenings(s, totalH).filter(o => o.kind === 'door');
      const bCourses = SuperAdobe.buttressCourses(profile, bw, ch, s.baseWallHeight);
      // In Step view the buttress rises together with the dome courses.
      const bMaxY = (renderLevel === 2 && opts.stepMode && profile.length)
        ? profile[Math.min(opts.stepCourse, profile.length - 1)].y
        : Infinity;
      const bSpread = Math.min(0.05, Math.max(0.015, (bw / 100 - ch / 100) / 4));
      bCourses.forEach((c, i) => {
        if (c.y > bMaxY + 1e-6) return;
        const gaps = [];
        doorOps.forEach(d => {
          const half = d.width / 2 + (bw / 100) * 1.5;   // clear the corridor walls
          gaps.push([d.angle - half / c.r, d.angle + half / c.r]);
        });
        const ig = SuperAdobe.intersectionGaps(s, others, c.y, c.r);
        if (ig === null) return;
        const allGaps = gaps.concat(ig);
        SuperAdobe.buildCourseGeometries(c.y, c.r, bw, ch, allGaps, i).forEach(g => {
          const m = new THREE.Mesh(g, bagMaterial(i % 2));
          m.castShadow = true; m.receiveShadow = true;
          bagGroup.add(m);
        });
        // §3.6.6 double wire on the buttress courses too (they are sewn on).
        const nextB = bCourses[i + 1];
        if (nextB) {
          SuperAdobe.buildWireGeometries(c.y + ch / 200 + 0.004, nextB.r, allGaps, (ch / 100) * 0.35, null, bSpread)
            .forEach(wg => wireGroup.add(new THREE.LineSegments(wg, wireMat)));
        }
      });
    }

    // Selection highlight: a glowing base ring
    if (isSelected) {
      const ringGeom = new THREE.RingGeometry(innerR + bw / 100 + 0.15, innerR + bw / 100 + 0.4, 48);
      ringGeom.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeom, selectMat);
      ring.position.y = 0.02;
      group.add(ring);
    }

    bagGroup.visible = layerVisible.bags;
    wireGroup.visible = layerVisible.wire;
    plasterGroup.visible = layerVisible.plaster;
    return group;
  }

  // ── Build the whole complex ──────────────────────────────────────────────
  let _lastStructures = [], _lastOpts = {};
  function buildComplex(structures, opts) {
    opts = opts || {};
    _lastStructures = structures; _lastOpts = opts;
    if (window.PosGizmo) window.PosGizmo.setData(structures, opts.selectedId || null);
    disposeGroup(structuresRoot);
    disposeGroup(terrainGroup);

    // Ground: an uploaded land scan if present, else the procedural plane sized
    // to enclose all structures.
    let terrain;
    if (customTerrain) {
      terrain = customTerrain.buildMesh();
    } else {
      let extent = 12;
      structures.forEach(s => {
        const reach = Math.hypot(s.x || 0, s.z || 0) + s.diameter + 4;
        extent = Math.max(extent, reach * 2);
      });
      terrain = new THREE.Mesh(SuperAdobe.buildTerrainGeometry(extent), terrainMat);
      terrain.receiveShadow = true;
    }
    terrainGroup.add(terrain);
    terrainGroup.visible = layerVisible.terrain;

    let totalCourses = 0;
    structures.forEach(s => {
      structuresRoot.add(buildStructureGroup(s, opts, structures.filter(o => o.id !== s.id)));
      const prof = s.type === 'vault' ? (s.profile.half || []) : (s.profile || []);
      totalCourses += prof.length;
    });

    // Frame the complex
    frameComplex(structures, opts.selectedId);

    // Status
    let tris = 0;
    scene.traverse(o => {
      if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      }
    });
    document.getElementById('status-structures').textContent = `${structures.length} structure${structures.length !== 1 ? 's' : ''}`;
    document.getElementById('status-courses').textContent = `${totalCourses} courses`;
    document.getElementById('status-poly').textContent = `${Math.round(tris / 1000)}k tri`;
  }

  let framedOnce = false;
  function frameComplex(structures, selectedId) {
    if (!structures.length) return;
    // Centre on the selected structure if present, else the centroid
    const sel = structures.find(s => s.id === selectedId) || structures[0];
    const prof = sel.type === 'vault' ? (sel.profile.half || []) : (sel.profile || []);
    const topY = prof.length ? prof[prof.length - 1].y : 2;
    orbitTarget.set(sel.x || 0, topY * 0.45, sel.z || 0);

    if (!framedOnce) {
      let maxReach = 6;
      structures.forEach(s => { maxReach = Math.max(maxReach, Math.hypot(s.x || 0, s.z || 0) + s.diameter); });
      orbitR = Math.max(8, maxReach * 2.2);
      framedOnce = true;
    }
    updateCamera();
  }

  // ── Raycast click-to-select ──────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  canvas.addEventListener('click', e => {
    if (didDrag) return;                 // ignore clicks that were orbit drags
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(structuresRoot.children, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && o.userData.structureId === undefined) o = o.parent;
      if (o && o.userData.structureId !== undefined && window.onStructurePick) {
        window.onStructurePick(o.userData.structureId);
      }
    }
  });

  // ── Visibility toggles ────────────────────────────────────────────────────
  function applyLayer(name, on) {
    layerVisible[name] = on;
    if (name === 'terrain') { terrainGroup.visible = on; return; }
    structuresRoot.traverse(() => {});
    structuresRoot.children.forEach(g => {
      // children order: [bagGroup, wireGroup, plasterGroup, ...]
      const bagGroup = g.children[0], wireGroup = g.children[1], plasterGroup = g.children[2];
      if (name === 'bags' && bagGroup) bagGroup.visible = on;
      if (name === 'wire' && wireGroup) wireGroup.visible = on;
      if (name === 'plaster' && plasterGroup) plasterGroup.visible = on;
    });
  }
  document.getElementById('layer-bags').addEventListener('change', e => applyLayer('bags', e.target.checked));
  document.getElementById('layer-wire').addEventListener('change', e => applyLayer('wire', e.target.checked));
  document.getElementById('layer-plaster').addEventListener('change', e => applyLayer('plaster', e.target.checked));
  document.getElementById('layer-terrain').addEventListener('change', e => applyLayer('terrain', e.target.checked));

  // ── View presets ──────────────────────────────────────────────────────────
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const v = btn.dataset.view;
      if (v === 'perspective') { orbitTheta = Math.PI / 4; orbitPhi = Math.PI / 4; }
      else if (v === 'top') { orbitTheta = 0; orbitPhi = 0.01; }
      else if (v === 'front') { orbitTheta = 0; orbitPhi = Math.PI / 2.1; }
      else if (v === 'section') { orbitTheta = -Math.PI / 2; orbitPhi = Math.PI / 4; }
      updateCamera();
    });
  });

  // ── Resize handler ────────────────────────────────────────────────────────
  function onResize() {
    const container = document.getElementById('viewport-container');
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);
  onResize();

  // ── Animation loop ────────────────────────────────────────────────────────
  let frameCount = 0, lastFPSTime = performance.now();
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
    if (window.PosGizmo) window.PosGizmo.frameTick(camera, renderer);
    frameCount++;
    const now = performance.now();
    if (now - lastFPSTime > 1000) {
      document.getElementById('status-fps').textContent = `${frameCount} fps`;
      frameCount = 0; lastFPSTime = now;
    }
  }
  animate();

  // ── Public API ────────────────────────────────────────────────────────────
  window.SceneBuilder = {
    buildComplex,
    focusOn(structures, id) { frameComplex(structures, id); },
    // Switch between LAYOUT (1, smooth shell), LAYERING (2, bag courses) and
    // SIMULATION (3, heat-mapped shell)
    setRenderLevel(n) {
      if (n === renderLevel) return;
      renderLevel = n;
      if (_lastStructures.length) buildComplex(_lastStructures, _lastOpts);
    },
    // Feed simulation results (per structure id) + active field. `quiet` stores
    // without rebuilding (the caller's buildComplex will paint the fresh data).
    setSimData(resultsById, field, quiet) {
      simData.resultsById = resultsById || {};
      if (field) simData.field = field;
      if (!quiet && renderLevel === 3 && _lastStructures.length) buildComplex(_lastStructures, _lastOpts);
    },
    setSimField(field) {
      simData.field = field;
      if (renderLevel === 3 && _lastStructures.length) buildComplex(_lastStructures, _lastOpts);
    },
    // Land scan: pass a window.LandScan terrain (or null to revert to the
    // procedural plane). Rebuilds so structures re-plant on the new surface.
    setTerrain(terrain) {
      customTerrain = terrain || null;
      if (_lastStructures.length) buildComplex(_lastStructures, _lastOpts);
    },
    clearTerrain() {
      customTerrain = null;
      if (_lastStructures.length) buildComplex(_lastStructures, _lastOpts);
    },
    hasTerrain() { return !!customTerrain; },
    // Live feedback while the gizmo drags a structure: move its group in X/Z and
    // drop it onto the (scanned) ground without a full rebuild.
    nudgePosition(id, x, z) {
      const g = structuresRoot.children.find(c => c.userData.structureId === id);
      if (g) g.position.set(x, groundY(x, z), z);
    },
  };

  updateCamera();
})();
