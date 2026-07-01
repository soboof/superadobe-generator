/**
 * calculator.js
 * Material quantities, time estimates, and eco scoring for superadobe structures.
 *
 * References:
 *  - Cal-Earth Institute construction guidelines
 *  - Nader Khalili "Ceramic Houses and Earth Architecture"
 *  - UNHCR emergency earthbag shelter guidelines
 */

const Calculator = (() => {

  // ─── Core quantities ───────────────────────────────────────────────────────
  function compute(params) {
    const {
      type,           // 'dome' | 'vault' | 'cylinder'
      diameter,       // inner diameter m
      wallHeight,     // cylinder wall height m (for cylinder)
      vaultLength,    // m (for vault)
      bagWidthCm,     // cm
      courseHeightCm, // cm
      doors,
      windows,
      doorWidthCm,
      fillType,
      cementPct,
      workers,
      hoursPerDay,
      skillLevel,
      profile,        // computed profile array
    } = params;

    const innerR = diameter / 2;
    const bw = bagWidthCm / 100;
    const ch = courseHeightCm / 100;

    // Bag cross-section area = stadium/capsule (rect + two semicircle caps).
    const bagSectionArea = (bw >= ch)
      ? (bw - ch) * ch + Math.PI * (ch / 2) ** 2
      : (Math.PI / 4) * bw * ch;

    // ── Bag length: standard tube bags are 50–60m rolls, cut to ~1m lengths ──
    const bagLengthM = 1.0; // 1 m standard cut

    let totalBagCount = 0;
    let totalBagLengthM = 0;
    let totalWireM = 0;
    let totalFillM3 = 0;
    let surfaceAreaOuterM2 = 0;
    let surfaceAreaInnerM2 = 0;
    let floorAreaM2 = 0;

    // Per-course built fraction (rings cut at neighbor-dome intersections)
    const solidFrac = params.courseSolidFrac || null;
    const fracAt = i => (solidFrac && solidFrac[i] != null) ? solidFrac[i] : 1;

    if (type === 'dome') {
      profile.forEach(({ y, r }, i) => {
        const frac = fracAt(i);
        if (frac <= 0) return;
        const circ = 2 * Math.PI * r * frac;
        const bagsThisCourse = Math.ceil(circ / bw);
        const actualBagLen = circ / Math.max(1, bagsThisCourse);
        totalBagCount += bagsThisCourse;
        totalBagLengthM += circ;
        totalWireM += circ + 0.5; // overlap at ends
        // Fill: cross-section of bag ≈ ellipse bw × ch
        totalFillM3 += bagSectionArea * circ;
        // Outer surface area (frustum strip between courses)
        if (i < profile.length - 1) {
          const rNext = profile[i + 1].r;
          const dy = profile[i + 1].y - y;
          const slant = Math.sqrt((r - rNext) ** 2 + dy ** 2);
          surfaceAreaOuterM2 += Math.PI * (r + rNext) * slant * frac;
          surfaceAreaInnerM2 += Math.PI * (Math.max(0, r - bw) + Math.max(0, rNext - bw)) * slant * frac;
        }
      });
      floorAreaM2 = Math.PI * innerR ** 2;
    }

    if (type === 'cylinder') {
      profile.forEach(({ y, r }, i) => {
        const frac = fracAt(i);
        if (frac <= 0) return;
        const circ = 2 * Math.PI * r * frac;
        const bagsThisCourse = Math.ceil(circ / bw);
        totalBagCount += bagsThisCourse;
        totalBagLengthM += circ;
        totalWireM += circ + 0.5;
        totalFillM3 += bagSectionArea * circ;
      });
      surfaceAreaOuterM2 = 2 * Math.PI * (innerR + bw) * (profile.length * ch);
      surfaceAreaInnerM2 = 2 * Math.PI * innerR * (profile.length * ch);
      floorAreaM2 = Math.PI * innerR ** 2;
    }

    // ── Entrance corridor (door hall, §3.6.7-3.6.8) ───────────────────────
    if (type === 'dome' && params.corridor && doors > 0) {
      const corrLen = params.corridorLen || 1.2;
      const w = doorWidthCm / 100;
      const wallH = 1.85;                       // walls to the arch springline
      const wallCourses = Math.ceil(wallH / ch);
      const archArc = Math.PI * (w / 2 + bw / 2);
      const archSlices = Math.ceil(corrLen / bw);
      const corrBagLen = doors * (2 * wallCourses * corrLen + archSlices * archArc);
      totalBagCount += Math.ceil(corrBagLen);
      totalBagLengthM += corrBagLen;
      totalWireM += doors * 2 * wallCourses * corrLen;
      totalFillM3 += bagSectionArea * corrBagLen;
      surfaceAreaOuterM2 += doors * corrLen * (2 * wallH + archArc);
      surfaceAreaInnerM2 += doors * corrLen * (2 * wallH + Math.PI * w / 2);
      floorAreaM2 += doors * corrLen * w;
    }

    if (type === 'vault') {
      const { half, length } = profile;
      const L = length;
      half.forEach(({ y, r }) => {
        // Arc for a semicircle: circumference = π * r
        const arcLen = Math.PI * r;
        const bagsAcross = Math.ceil(arcLen / bw); // bags across the arch per layer
        const bagsAlong = Math.ceil(L / bw);        // bags along the length
        totalBagCount += bagsAcross * bagsAlong;
        totalBagLengthM += bagsAcross * bagsAlong * bw;
        totalWireM += (arcLen + L) * 2 + 2; // two runs of wire
        const bagFillM3 = bagSectionArea * bw;
        totalFillM3 += bagsAcross * bagsAlong * bagFillM3;
      });
      surfaceAreaOuterM2 = Math.PI * (innerR + bw) * L + 2 * (Math.PI * (innerR + bw) ** 2 / 2);
      surfaceAreaInnerM2 = Math.PI * innerR * L + 2 * (Math.PI * innerR ** 2 / 2);
      floorAreaM2 = diameter * L;
    }

    // ── Subtract openings (ideal door 1.5×1.8, window 1.0×1.5 — §3.6.7) ───
    const builtOpenings = Math.min(4, doors + windows); // quadrant rule
    const builtDoors = Math.min(doors, builtOpenings);
    const builtWindows = builtOpenings - builtDoors;
    const doorH = 1.85;
    const winH = 1.5;
    const doorArea = builtDoors * (doorWidthCm / 100) * doorH;
    const winArea = builtWindows * 1.0 * winH;
    const openingArea = doorArea + winArea;
    surfaceAreaInnerM2 = Math.max(0, surfaceAreaInnerM2 - openingArea);
    surfaceAreaOuterM2 = Math.max(0, surfaceAreaOuterM2 - openingArea);

    // Opening bag deductions (rough)
    const openingBagDeduction = Math.floor(openingArea / (bw * ch) * 0.85);
    totalBagCount = Math.max(0, totalBagCount - openingBagDeduction);

    // ── Plaster areas ──────────────────────────────────────────────────────
    // 3 coats: scratch, brown, finish — total ~3cm
    // Inner: earth plaster or lime; Outer: lime + cement
    const plasterOuterM2 = surfaceAreaOuterM2;
    const plasterInnerM2 = surfaceAreaInnerM2 + floorAreaM2; // includes floor

    // Plaster material: ~15 kg/m² per coat, 3 coats
    const plasterOuterKg = plasterOuterM2 * 45;
    const plasterInnerKg = plasterInnerM2 * 40;

    // ── Foundation ─────────────────────────────────────────────────────────
    // Rubble trench: 1 m wide × 1 m deep × circumference (thesis §3.6.4)
    const foundCirc = 2 * Math.PI * (innerR + bw / 2);
    const foundVolM3 = foundCirc * 1.0 * 1.0;
    const gravelM3 = foundVolM3 * 0.7;
    // Foundation bag courses = user-set stem-wall rows (min 2 for the gravel
    // trench base bags placed at grade before building begins).
    const foundRows = Math.max(2, Math.round(params.foundationRows || 0));
    const foundBagsCount = Math.ceil(foundCirc / bw) * foundRows;

    // ── Wire ──────────────────────────────────────────────────────────────
    // 4-point barbed wire, one strand between each course, +10% waste
    const wireRollM = 400; // standard roll = 400m
    const wireRollsNeeded = Math.ceil(totalWireM * 1.1 / wireRollM);

    // ── Fill material volume with cement ──────────────────────────────────
    const cementFraction = cementPct / 100;
    const cementBags50kg = Math.ceil(totalFillM3 * cementFraction * 1800 / 50); // ~1800kg/m³ density

    // ── Fill material bulk ─────────────────────────────────────────────────
    // 1.5× factor for loose fill vs compacted
    const fillLooseM3 = totalFillM3 * 1.5;

    // ── Bag rolls ─────────────────────────────────────────────────────────
    // Poly tube sold in 100m rolls; each bag ~1m + ties
    const bagRolls100m = Math.ceil(totalBagLengthM * 1.05 / 100);

    // ── Time estimate ──────────────────────────────────────────────────────
    const skillFactor = { novice: 0.45, intermediate: 0.7, expert: 1.0 }[skillLevel] || 0.7;
    const bagsPerWorkerPerDay = 25 * skillFactor; // bags filled, tamped, placed
    const totalBagDays = totalBagCount / (workers * bagsPerWorkerPerDay);

    const foundationDays = Math.ceil(3 / workers * (1 / skillFactor));
    const plasterDays = Math.ceil((plasterOuterM2 + plasterInnerM2) / (workers * 20 * skillFactor));
    const openingsDays = Math.ceil((doors + windows) * 1.5 / workers);
    const roofDays = type === 'dome' ? 0 : Math.ceil(2 / workers);
    const dryingDays = 14; // plaster curing

    const constructionDays = Math.ceil(totalBagDays);
    const totalDays = foundationDays + constructionDays + plasterDays + openingsDays + roofDays;
    const totalCalendarDays = totalDays + dryingDays;

    // ── Eco score ──────────────────────────────────────────────────────────
    let ecoScore = 90;
    ecoScore -= cementPct * 3;               // cement lowers eco score
    if (fillType === 'sandy-loam') ecoScore += 5;
    if (fillType === 'volcanic') ecoScore += 3;
    if (fillType === 'sand-cement') ecoScore -= 10;
    if (type === 'dome') ecoScore += 5;       // dome = most material-efficient
    ecoScore = Math.min(100, Math.max(0, ecoScore));

    return {
      // Bags
      totalBagCount,
      totalBagLengthM: Math.round(totalBagLengthM),
      bagRolls100m,
      foundationBags: foundBagsCount,

      // Wire
      totalWireM: Math.round(totalWireM),
      wireRollsNeeded,

      // Fill
      totalFillM3: parseFloat(totalFillM3.toFixed(2)),
      fillLooseM3: parseFloat(fillLooseM3.toFixed(2)),
      cementBags50kg,

      // Plaster
      plasterOuterM2: parseFloat(plasterOuterM2.toFixed(1)),
      plasterInnerM2: parseFloat(plasterInnerM2.toFixed(1)),
      plasterOuterKg: Math.round(plasterOuterKg),
      plasterInnerKg: Math.round(plasterInnerKg),

      // Foundation
      foundVolM3: parseFloat(foundVolM3.toFixed(2)),
      gravelM3: parseFloat(gravelM3.toFixed(2)),

      // Area
      floorAreaM2: parseFloat(floorAreaM2.toFixed(1)),
      surfaceAreaOuterM2: parseFloat(surfaceAreaOuterM2.toFixed(1)),
      surfaceAreaInnerM2: parseFloat(surfaceAreaInnerM2.toFixed(1)),

      // Time
      foundationDays,
      constructionDays,
      plasterDays,
      openingsDays,
      dryingDays,
      totalDays,
      totalCalendarDays,

      // Openings (for complex aggregation; quadrant rule caps at 4)
      openingsCount: builtOpenings,

      // Eco
      ecoScore,
    };
  }

  // ─── Aggregate per-structure results into one complex (one crew) ──────────
  function aggregateComplex(results, shared, structureCount) {
    const sum = (key) => results.reduce((a, r) => a + (r[key] || 0), 0);

    const totalBagCount = sum('totalBagCount');
    const totalBagLengthM = sum('totalBagLengthM');
    const totalWireM = sum('totalWireM');
    const totalFillM3 = sum('totalFillM3');
    const fillLooseM3 = sum('fillLooseM3');
    const plasterOuterM2 = sum('plasterOuterM2');
    const plasterInnerM2 = sum('plasterInnerM2');
    const floorAreaM2 = sum('floorAreaM2');
    const foundationBags = sum('foundationBags');
    const gravelM3 = sum('gravelM3');
    const foundVolM3 = sum('foundVolM3');

    // Rolls / bagged materials recomputed from totals (whole-job procurement)
    const bagRolls100m = Math.ceil(totalBagLengthM * 1.05 / 100);
    const wireRollsNeeded = Math.ceil(totalWireM * 1.1 / 400);
    const cementFraction = (shared.cementPct || 0) / 100;
    const cementBags50kg = Math.ceil(totalFillM3 * cementFraction * 1800 / 50);
    const plasterOuterKg = Math.round(plasterOuterM2 * 45);
    const plasterInnerKg = Math.round(plasterInnerM2 * 40);

    // Time: one crew builds everything sequentially
    const skillFactor = { novice: 0.45, intermediate: 0.7, expert: 1.0 }[shared.skillLevel] || 0.7;
    const bagsPerWorkerPerDay = 25 * skillFactor;
    const workers = shared.workers || 3;
    const constructionDays = Math.ceil(totalBagCount / (workers * bagsPerWorkerPerDay));
    const foundationDays = Math.ceil(structureCount * 3 / workers * (1 / skillFactor));
    const plasterDays = Math.ceil((plasterOuterM2 + plasterInnerM2) / (workers * 20 * skillFactor));
    const totalOpenings = sum('openingsCount');
    const openingsDays = Math.ceil(Math.max(1, totalOpenings) * 1.5 / workers);
    const dryingDays = 14;
    const totalDays = foundationDays + constructionDays + plasterDays + openingsDays;
    const totalCalendarDays = totalDays + dryingDays;

    // Eco score (whole-complex average), domes are the most efficient form
    let ecoScore = 90;
    ecoScore -= (shared.cementPct || 0) * 3;
    if (shared.fillType === 'sandy-loam') ecoScore += 5;
    if (shared.fillType === 'volcanic') ecoScore += 3;
    if (shared.fillType === 'sand-cement') ecoScore -= 10;
    ecoScore += 5; // domed/earthbag construction
    ecoScore = Math.min(100, Math.max(0, Math.round(ecoScore)));

    return {
      structureCount,
      totalBagCount,
      totalBagLengthM: Math.round(totalBagLengthM),
      bagRolls100m,
      foundationBags,
      totalWireM: Math.round(totalWireM),
      wireRollsNeeded,
      totalFillM3: parseFloat(totalFillM3.toFixed(2)),
      fillLooseM3: parseFloat(fillLooseM3.toFixed(2)),
      cementBags50kg,
      plasterOuterM2: parseFloat(plasterOuterM2.toFixed(1)),
      plasterInnerM2: parseFloat(plasterInnerM2.toFixed(1)),
      plasterOuterKg,
      plasterInnerKg,
      foundVolM3: parseFloat(foundVolM3.toFixed(2)),
      gravelM3: parseFloat(gravelM3.toFixed(2)),
      floorAreaM2: parseFloat(floorAreaM2.toFixed(1)),
      foundationDays, constructionDays, plasterDays, openingsDays, dryingDays,
      totalDays, totalCalendarDays, ecoScore,
    };
  }

  // ─── Eco score description ─────────────────────────────────────────────────
  function ecoDesc(score, fillType, cementPct) {
    if (score >= 90) return 'Excellent — nearly zero-carbon, fully local materials, minimum waste.';
    if (score >= 75) return 'Very good — low embodied energy, minor cement stabilization.';
    if (score >= 60) return 'Good — mostly natural, consider reducing cement for higher score.';
    return 'Moderate — high cement content increases carbon footprint significantly.';
  }

  return { compute, aggregateComplex, ecoDesc };

})();
