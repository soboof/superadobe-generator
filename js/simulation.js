/**
 * simulation.js
 * Structural / environmental performance engine for superadobe domes — the
 * "Level 3 · Simulation" stage.
 *
 * This is NOT a finite-element solver. It is the closed-form, ring-by-ring
 * limit-state model from:
 *   López Gómez, M.A. — "A study of the geometry and structural performance of
 *   Superadobe domes" (UPM, 2021), chapter 6 ("A model to measure structural
 *   behaviour"), validated there against Ansys FEA (chapter 7); together with
 *   Canadell/Blanco/Cavalaro, Materials & Design 2016 (thesis ref [52]).
 *
 * Two complementary mechanics are combined, each where it is strongest:
 *   • DISCRETE block model (thesis ch.6, Heyman "safe theorem"): per-ring
 *     weights, kern-bounded thrust, bearing area, sliding, bag tension. Reliable
 *     for the limit-state PASS/FAIL checks.
 *   • CONTINUOUS membrane shell theory (Heyman; Lau, MIT): meridional and hoop
 *     stresses of a shell of revolution. Gives the smooth stress field and the
 *     classic result that hoop stress is COMPRESSIVE in the cap and TENSILE
 *     below a neutral ring (~52° for a hemisphere) — exactly where the bags +
 *     barbed wire carry the tension the earth cannot.
 *
 * Plus standard engineering estimates (clearly labelled, not a CFD/FEA solve)
 * for Wind (pressure-coefficient method), Seismic (equivalent static lateral
 * force) and Thermal (transient earthen wall: U-value, time lag, decrement).
 *
 * Validation envelope from the thesis FEA (35 domes): peak tension < 1.4 MPa,
 * peak compression < 1.4 MPa, peak shear < 0.7 MPa, max deflection ~0.75 mm.
 *
 * Units: SI internally (N, Pa, m, kg, s). Results report MPa / mm / kN for UI.
 */

const Simulation = (() => {

  const G = 9.81;                 // gravity m/s²
  const TWO_PI = Math.PI * 2;
  const P_DAY = 86400;            // s, daily thermal cycle

  // ─── Material presets ────────────────────────────────────────────────────
  // E (Pa), nu, density (kg/m³), fc compressive / ft tensile strength (Pa),
  // k thermal conductivity (W/m·K), c specific heat (J/kg·K).
  const MATERIAL_PRESETS = {
    'idealized': {
      label: 'Idealized composite (thesis FEA)',
      E: 21e9, nu: 0.214, density: 2108, fc: 2.0e6, ft: 0.40e6, k: 1.1, c: 1000,
      note: 'Hardened 30/30/30/10 clay-sand-gravel-binder composite used in the thesis Ansys runs.',
    },
    'cement': {
      label: 'Cement-stabilized earth',
      E: 1.2e9, nu: 0.20, density: 1950, fc: 2.6e6, ft: 0.30e6, k: 0.95, c: 1000,
      note: '~6–10% cement. Higher strength, higher embodied carbon.',
    },
    'lime': {
      label: 'Lime-stabilized earth',
      E: 0.5e9, nu: 0.22, density: 1850, fc: 1.8e6, ft: 0.18e6, k: 0.85, c: 1000,
      note: 'Breathable, moderate strength.',
    },
    'earth': {
      label: 'Unstabilized earth (sandy-loam)',
      E: 0.18e9, nu: 0.25, density: 1800, fc: 1.2e6, ft: 0.06e6, k: 0.80, c: 1000,
      note: 'Weak in tension — the bag + barbed wire carry tensile/hoop forces.',
    },
  };

  // ─── Default environment (materials, loads, factors) ─────────────────────
  function defaultEnv() {
    const m = MATERIAL_PRESETS['earth'];
    return {
      preset: 'earth',
      material: {
        E: m.E, nu: m.nu, density: m.density, fc: m.fc, ft: m.ft, k: m.k, c: m.c,
        mu: 0.6,            // block-to-block friction (thesis used 2.0 incl. barbed wire)
        cbw: 20e3,          // cohesion of barbed-wire joint (Pa)
        tbag: 20e3,         // poly tube tensile strength (N/m)
        ttear: 15e3,        // bag tear strength per unit length (N/m)
        kp: 3.0,            // coeff of lateral (passive) earth pressure
        gammaWire: 1.5,     // barbed-wire strength reduction
        gammaBag: 2.0,      // bag strength reduction
      },
      load: {
        windPressure: 1000,     // Pa (≈130 km/h). Thesis used 2000 Pa on big domes.
        windCf: 0.5,            // dome drag/shape factor
        seismicCoef: 0.15,      // base-shear coefficient Cs (g)
        groundBearing: 150e3,   // allowable soil bearing (Pa)
        liveLoad: 0,            // extra roof load (Pa)
      },
      factors: { fs1: 1.0, fs2: 1.0, gq: 1.0 },  // safety factors (1 = like thesis)
      thermal: { Tout: 38, Tin: 24 },            // °C design swing (hot-dry default)
      Fmin: 0.25,                                 // min geometric bearing factor (¼)
    };
  }

  function applyPreset(env, key) {
    const m = MATERIAL_PRESETS[key];
    if (!m) return env;
    env.preset = key;
    Object.assign(env.material, { E: m.E, nu: m.nu, density: m.density, fc: m.fc, ft: m.ft, k: m.k, c: m.c });
    return env;
  }

  // Stadium (capsule) section area — matches calculator.js / the rendered bag.
  function sectionArea(w, h) {
    return (w >= h) ? (w - h) * h + Math.PI * (h / 2) ** 2 : (Math.PI / 4) * w * h;
  }

  // ─── Main analysis ────────────────────────────────────────────────────────
  function analyze(s, others, env) {
    others = others || [];
    env = env || defaultEnv();
    const mat = env.material, load = env.load, F = env.factors;
    if (s.type === 'vault') return analyzeVault(s, env);   // (handled simply below)

    const prof = s.profile || [];
    if (prof.length < 2) return null;

    const w = s.bagWidthCm / 100;          // wall thickness / bag width
    const hs = s.courseHeightCm / 100;     // course height
    const Asec = sectionArea(w, hs);       // m²
    const teff = Asec / w;                 // effective wall thickness for stress
    const Lflat = Math.max(0.01, w - hs);  // flat bearing width of the stadium
    const den = mat.density;
    const rb = s.diameter / 2;
    const a = (s.pointiness / 100) * rb;   // arch offset
    const rr = rb + a;                     // meridian radius of curvature
    const h1 = s.baseWallHeight || 0;
    const H = prof[prof.length - 1].y;
    const openings = SuperAdobe.computeOpenings(s, H);
    const n = prof.length;

    // ── Per-ring geometry + built fraction (openings + dome intersections) ──
    const R = prof.map((c, i) => {
      const RI = c.inner, RC = c.r, RE = RI + w;
      let gaps = SuperAdobe.openingGaps(c.y, RC, openings).slice();
      const ig = SuperAdobe.intersectionGaps(s, others, c.y, RC);
      let frac;
      if (ig === null) { frac = 0; } else { gaps = gaps.concat(ig); frac = SuperAdobe.solidFraction(gaps); }
      frac = Math.max(0, Math.min(1, frac));
      const len = TWO_PI * RC * frac;
      const mass = den * Asec * len;       // kg
      return { i, y: c.y, RI, RC, RE, frac, len, mass,
               Rkint: RC - w / 6, Rkext: RC + w / 6 };
    });

    // ── Accumulated mass + centroid of the substructure above each ring ─────
    const Wt = new Array(n), Xg = new Array(n), Zg = new Array(n);
    let mAcc = 0, sxAcc = 0, syAcc = 0;
    for (let i = n - 1; i >= 0; i--) {
      Wt[i] = mAcc;                                   // kg above ring i
      Xg[i] = mAcc > 0 ? sxAcc / mAcc : R[i].RC;
      Zg[i] = mAcc > 0 ? syAcc / mAcc : R[i].y;
      mAcc += R[i].mass; sxAcc += R[i].RC * R[i].mass; syAcc += R[i].y * R[i].mass;
    }
    const totalMass = mAcc;                           // kg

    // ── Kern-bounded horizontal thrust per ring (thesis 6.14–6.15) ──────────
    const Fhmax = new Array(n), Fhmin = new Array(n);
    for (let i = 0; i < n; i++) {
      const Nv = Wt[i] * G;                           // weight above (N)
      const denom = Zg[i] - R[i].y;
      if (Wt[i] <= 0 || denom <= 1e-3) { Fhmax[i] = 0; Fhmin[i] = 0; continue; }
      Fhmax[i] = Nv * (R[i].Rkext - Xg[i]) / denom;
      Fhmin[i] = Nv * (R[i].Rkint - Xg[i]) / denom;
    }

    // ── Contact (bearing) area below each ring + bearing factor F ───────────
    function contactBelow(i) {
      if (i === 0) return { area: TWO_PI * R[0].RC * w * R[0].frac, width: w };
      const inner = R[i].RI, outer = R[i - 1].RI + w;   // overlap of ring i on i-1
      const width = Math.max(0, outer - inner);
      const RCc = (inner + outer) / 2;
      const frac = Math.min(R[i].frac, R[i - 1].frac);
      return { area: TWO_PI * RCc * width * frac, width };
    }

    // ── Per-ring results ────────────────────────────────────────────────────
    const rings = [];
    let peak = { compression: 0, hoopTension: 0, hoopCompression: 0, shear: 0,
                 util: 0, govMode: '—', govRing: 0, minF: Infinity, deflect: 0 };
    let shorten = 0;

    for (let i = 0; i < n; i++) {
      const r = R[i];
      const below = contactBelow(i);
      const loadBelow = (Wt[i] + r.mass) * G;          // weight carried at ring base (N)

      // Vertical compression carried through the ring (Pa)
      const sigV = below.area > 1e-6 ? loadBelow / below.area : 0;
      // Eccentric bending add-on (kern, thesis 6.22): ~ weight above / (2π·RC·w)
      const sigBend = R[i].RC > 0 ? (Wt[i] * G) / (TWO_PI * r.RC * w) : 0;
      const sigCompMax = sigV + sigBend;               // peak compression (Pa)

      // Continuous-shell (membrane) stresses — smooth field, sign of hoop.
      const hc = Math.max(0.001, r.y - h1);
      const phi = Math.atan2(r.RC + a, hc);            // colatitude from apex
      const cphi = Math.cos(phi);
      const sigMeridian = -den * G * rr / (1 + cphi);  // compression (<0)
      const sigHoop = den * G * rr * (1 / (1 + cphi) - cphi); // <0 cap, >0 base

      // Bearing / geometric coherency factor (paper eq.8'): flat contact left.
      const disp = i > 0 ? (R[i - 1].RI - r.RI) : 0;   // inward step from below
      const Ffac = i > 0 ? Math.max(0, (Lflat - disp) / Lflat) : 1;

      // Shear on the bed joint from max horizontal thrust.
      const Td = Math.abs(Fhmax[i]) * F.fs1;
      const shear = below.area > 1e-6 ? Td / below.area : 0;

      // Hoop force differences between courses (thesis 6.24): tension/compression.
      const dFt = i < n - 1 ? Math.max(0, Fhmax[i + 1] - Fhmin[i]) : 0;
      const ifaceA = TWO_PI * r.RC * w * Math.max(0.05, r.frac);
      const sigHoopT_blk = ifaceA > 1e-6 ? dFt / ifaceA : 0;     // block hoop tension (Pa)

      // Use the larger/clearer of membrane vs block for the maps.
      const hoopTension = Math.max(Math.max(0, sigHoop), sigHoopT_blk);
      const hoopCompression = Math.max(0, -sigHoop);

      // ── Limit-state utilisations (demand / capacity; >1 = fail) ──────────
      const uCrush = sigCompMax / mat.fc;
      const uHoopC = hoopCompression / mat.fc;
      const uHoopT_adobe = hoopTension / mat.ft;        // earth cracks if >1 (bag then carries)
      // Sliding (thesis 6.3.7): friction + wire cohesion vs thrust.
      const slideResist = mat.cbw * below.area / mat.gammaWire + (Wt[i] * G) * mat.mu;
      const uSlide = slideResist > 1e-6 ? Td / slideResist : 0;
      // Longitudinal bag tear from hoop tension (thesis 6.3.13).
      const bagResist = mat.tbag * 2 * (w + hs) / mat.gammaBag;
      const bagDemand = hoopTension * w * hs;
      const uBagTear = bagResist > 1e-6 ? bagDemand / bagResist : 0;
      // Bag tear from horizontal force (thesis 6.3.8) — per unit length of seam:
      // the thrust not taken by friction is carried by the bag/wire in tension.
      const Lseam = r.len > 0.1 ? r.len : TWO_PI * r.RC;
      const tearDemand = Math.max(0, (Td - (Wt[i] + r.mass) * G * mat.mu) / Lseam);
      const uBagH = mat.ttear > 1e-6 ? tearDemand / mat.ttear : 0;
      // Geometric bearing: need F ≥ Fmin.
      const uBear = r.frac > 0.05 ? (env.Fmin / Math.max(0.02, Ffac)) : 0;

      // The earth cracking in tension is EXPECTED (that's why bags exist); the
      // governing structural failure is bag tear / crush / sliding / bearing.
      const checks = [
        ['Compression crush', uCrush],
        ['Hoop compression', uHoopC],
        ['Sliding', uSlide],
        ['Bag tear (hoop)', uBagTear],
        ['Bag tear (shear)', uBagH],
        ['Bearing (F factor)', uBear],
      ];
      let util = 0, govMode = '—';
      for (const [name, u] of checks) if (u > util) { util = u; govMode = name; }

      shorten += (sigCompMax / mat.E) * hs;             // axial shortening (m)

      const ring = {
        i, y: r.y, RI: r.RI, RC: r.RC, RE: r.RE, frac: r.frac, mass: r.mass,
        sigV, sigCompMax, sigMeridian, sigHoop, hoopTension, hoopCompression,
        shear, Fhmax: Fhmax[i], Fhmin: Fhmin[i], Ffac, phi: phi * 180 / Math.PI,
        util, govMode,
        u: { crush: uCrush, hoopC: uHoopC, hoopT: uHoopT_adobe, slide: uSlide,
             bagTear: uBagTear, bagH: uBagH, bear: uBear },
      };
      rings.push(ring);

      if (sigCompMax > peak.compression) peak.compression = sigCompMax;
      if (hoopTension > peak.hoopTension) peak.hoopTension = hoopTension;
      if (hoopCompression > peak.hoopCompression) peak.hoopCompression = hoopCompression;
      if (shear > peak.shear) peak.shear = shear;
      if (Ffac < peak.minF) peak.minF = Ffac;
      if (util > peak.util) { peak.util = util; peak.govMode = govMode; peak.govRing = i; }
    }
    peak.deflect = shorten;                              // m

    // ── Global stability checks (thesis 6.3.1–6.3.4) ────────────────────────
    // Wind: silhouette (projected) area + drag → total horizontal force.
    let Aproj = 0, ywSum = 0;
    rings.forEach(r => { const strip = 2 * r.RC * hs * Math.max(0.05, r.frac); Aproj += strip; ywSum += strip * r.y; });
    const yWind = Aproj > 0 ? ywSum / Aproj : H / 2;
    const Fwind = load.windPressure * load.windCf * Aproj;       // N
    const baseR = R[0].RE;
    const baseArea = TWO_PI * R[0].RC * w * R[0].frac;
    const Wforce = totalMass * G;

    const Mstab = Wforce * baseR;
    const Mover = Fwind * yWind * F.gq;
    const sigGround = baseArea > 1e-6 ? Wforce / baseArea : 0;
    const sigVmax = peak.compression;

    const global = {
      windOverturn: { name: 'Wind roll-over', ratio: Mover > 1e-6 ? Mstab / Mover : 99, demand: Mover, capacity: Mstab, unit: 'kN·m', scale: 1e-3 },
      windSlide:    { name: 'Wind sliding',   ratio: Fwind > 1e-6 ? (mat.cbw * baseArea + Wforce * mat.mu) / Fwind : 99, demand: Fwind, capacity: mat.cbw * baseArea + Wforce * mat.mu, unit: 'kN', scale: 1e-3 },
      ground:       { name: 'Ground bearing', ratio: sigGround > 1e-6 ? load.groundBearing / sigGround : 99, demand: sigGround, capacity: load.groundBearing, unit: 'kPa', scale: 1e-3 },
      buckling:     { name: 'Wall buckling',  ratio: (sigVmax * 4 * H) > 1e-6 ? (mat.E * w) / (sigVmax * 4 * H) : 99, demand: sigVmax * 4 * H, capacity: mat.E * w, unit: 'MN/m', scale: 1e-6 },
    };

    // ── Seismic (equivalent static lateral force) ───────────────────────────
    const yCg = totalMass > 0 ? rings.reduce((s2, r) => s2 + r.y * r.mass, 0) / totalMass : H / 2;
    const Vbase = load.seismicCoef * Wforce;                     // base shear (N)
    const seismic = {
      baseShear: Vbase,
      overturnRatio: (Vbase * yCg) > 1e-6 ? (Wforce * baseR) / (Vbase * yCg) : 99,
      slideRatio: Vbase > 1e-6 ? (mat.cbw * baseArea + Wforce * mat.mu) / Vbase : 99,
      period: 0.05 * Math.pow(H, 0.75),                          // s (stiff shell)
      cgHeight: yCg,
    };

    // ── Thermal (transient earthen wall) ────────────────────────────────────
    const Rsi = 0.13, Rso = 0.04;
    const Rwall = w / mat.k;
    const U = 1 / (Rsi + Rwall + Rso);                           // W/m²K
    const alpha = mat.k / (den * mat.c);                         // m²/s
    const timeLag = 0.65 * w * Math.sqrt(P_DAY / (4 * Math.PI * alpha)) / 3600; // h (calibrated to CEB data)
    const decrement = Math.exp(-w * Math.sqrt(Math.PI / (alpha * P_DAY)));
    const arealMass = den * mat.c * w / 1000;                    // kJ/m²K
    const innerSwing = (env.thermal ? (env.thermal.Tout - env.thermal.Tin) : 14) * decrement;
    const thermal = { U, R: Rsi + Rwall + Rso, timeLag, decrement, arealMass, innerSwing,
                      conductivity: mat.k };

    // ── Overall verdict ─────────────────────────────────────────────────────
    const globalRatios = Object.values(global).map(g => g.ratio);
    const minGlobal = Math.min(...globalRatios);
    // overall utilisation = max(local util, 1/min global ratio)
    const overallUtil = Math.max(peak.util, 1 / Math.max(0.01, minGlobal));
    let verdict, verdictClass;
    if (peak.minF < 0.05) { verdict = 'UNSTABLE — top courses lose bearing (rigid-body risk)'; verdictClass = 'fail'; }
    else if (overallUtil > 1) { verdict = 'FAILS — exceeds a limit state'; verdictClass = 'fail'; }
    else if (overallUtil > 0.7) { verdict = 'MARGINAL — within limits, low reserve'; verdictClass = 'warn'; }
    else { verdict = 'SAFE — all limit states satisfied'; verdictClass = 'ok'; }

    // Benchmark vs thesis FEA envelope (tension/compression/shear) + a
    // serviceability deflection limit (H/500).
    const bench = {
      tension: { val: peak.hoopTension, limit: 1.4e6 },
      compression: { val: peak.compression, limit: 1.4e6 },
      shear: { val: peak.shear, limit: 0.7e6 },
      deflect: { val: peak.deflect, limit: Math.max(1.0e-3, H / 500) },
    };

    return {
      ok: true, type: s.type, name: s.name,
      geom: { H, rb, rr, a, w, hs, nRings: n, totalMass, Aproj, baseR, yCg, Asec },
      rings, peak, global, seismic, thermal, bench,
      verdict, verdictClass, overallUtil, minGlobal,
      env,
    };
  }

  // Vault: simple membrane (barrel) estimate so the panel still works.
  function analyzeVault(s, env) {
    const arr = (s.profile && s.profile.half) || [];
    if (arr.length < 2) return null;
    const env2 = env || defaultEnv();
    const H = arr[arr.length - 1].y;
    return { ok: true, type: 'vault', name: s.name, vault: true,
      geom: { H, w: s.bagWidthCm / 100, hs: s.courseHeightCm / 100, nRings: arr.length },
      note: 'Vaults are assessed as barrel shells — use a dome for the full ring-by-ring model.',
      thermal: thermalOnly(s, env2), verdict: 'Vault — limited analysis', verdictClass: 'warn',
    };
  }

  function thermalOnly(s, env) {
    const mat = env.material, w = s.bagWidthCm / 100;
    const Rsi = 0.13, Rso = 0.04, Rwall = w / mat.k;
    const U = 1 / (Rsi + Rwall + Rso);
    const alpha = mat.k / (mat.density * mat.c);
    return { U, R: Rsi + Rwall + Rso, timeLag: 0.65 * w * Math.sqrt(P_DAY / (4 * Math.PI * alpha)) / 3600,
             decrement: Math.exp(-w * Math.sqrt(Math.PI / (alpha * P_DAY))), conductivity: mat.k,
             arealMass: mat.density * mat.c * w / 1000 };
  }

  // ─── Field accessor for the 3D heat-map (value at height y) ───────────────
  // Returns a normalised 0..1 magnitude for the chosen field, plus the signed
  // raw value, by locating the ring nearest height y.
  const FIELDS = {
    compression: { label: 'Compression', unit: 'MPa', scale: 1e-6, get: r => r.sigCompMax, signed: false },
    hoop:        { label: 'Hoop stress',  unit: 'MPa', scale: 1e-6, get: r => r.sigHoop,    signed: true },
    shear:       { label: 'Shear',        unit: 'MPa', scale: 1e-6, get: r => r.shear,      signed: false },
    utilization: { label: 'Utilisation',  unit: '',    scale: 1,    get: r => r.util,       signed: false },
    bearing:     { label: 'Bearing F',    unit: '',    scale: 1,    get: r => r.Ffac,       signed: false, invert: true },
  };

  function fieldRange(result, key) {
    const f = FIELDS[key]; let lo = Infinity, hi = -Infinity;
    result.rings.forEach(r => { const v = f.get(r) * f.scale; if (v < lo) lo = v; if (v > hi) hi = v; });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (f.signed) { const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-9); return { lo: -m, hi: m, f }; }
    if (hi - lo < 1e-9) hi = lo + 1e-9;
    return { lo, hi, f };
  }

  function ringAtHeight(result, y) {
    const rings = result.rings;
    let best = rings[0], bd = Infinity;
    for (const r of rings) { const d = Math.abs(r.y - y); if (d < bd) { bd = d; best = r; } }
    return best;
  }

  // Colour ramps → [r,g,b] 0..1.
  function heat(t) {            // 0 green → .5 yellow → 1 red (>1 deep red)
    t = Math.max(0, Math.min(1.2, t));
    if (t <= 0.5) return [0.29 + t * 1.2, 0.78 + t * 0.2, 0.30 - t * 0.2];
    if (t <= 1.0) { const u = (t - 0.5) / 0.5; return [0.95, 0.85 - u * 0.65, 0.10]; }
    const u = (t - 1.0) / 0.2; return [0.95 - u * 0.3, 0.10, 0.10];
  }
  function diverge(t) {         // -1 blue ← 0 grey → +1 red
    if (t >= 0) { const u = Math.min(1, t); return [0.55 + u * 0.4, 0.55 - u * 0.45, 0.55 - u * 0.45]; }
    const u = Math.min(1, -t); return [0.55 - u * 0.45, 0.60 - u * 0.2, 0.60 + u * 0.35];
  }

  // Colour for a given field value (already scaled to display units).
  function colorForField(key, value, range) {
    const f = FIELDS[key];
    if (key === 'utilization') return heat(value);          // 0..1+ direct
    if (key === 'bearing') return heat(1 - Math.max(0, Math.min(1, (value - 0.0) / 0.6))); // low F = red
    if (f.signed) { const m = Math.max(Math.abs(range.lo), Math.abs(range.hi), 1e-9); return diverge(value / m); }
    const t = (value - range.lo) / (range.hi - range.lo);
    return heat(t);
  }

  return {
    MATERIAL_PRESETS, defaultEnv, applyPreset, analyze, sectionArea,
    FIELDS, fieldRange, ringAtHeight, colorForField, heat, diverge,
  };

})();
