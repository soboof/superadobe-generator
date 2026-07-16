# Super Adobe Generator

A browser-based 3D design tool for **superadobe / earthbag domed structures**. Lay out a
complex of domes, set their openings, then drop into a layer-by-layer construction model
that estimates materials, time, and an eco score.

No build step — open `index.html` on a static server (Three.js r134 is loaded from a CDN).

```
npx serve -p 3737 -s .     # then open http://localhost:3737
```

---

## Three-stage workflow

The header switches between three stages:

| Stage | Purpose | Controls shown |
|-------|---------|----------------|
| **1 · Layout** | Massing: add/position domes, set shape, openings, corridors. The 3D view shows the **unified smooth shell** (domes merged into one monolith, doorways and intersections subtracted). | Structures, Type, Dimensions, Placement, Openings |
| **2 · Layering** | Construction: the same complex shown **course by course** (capsule bags along each layer curve), plus material/time/eco results. | Bag/Course, Fill, Crew, layer toggles, course stepper |
| **3 · Simulation** | Performance: the dome **colour-mapped by stress / utilisation / bearing**, with structural / thermal / seismic / wind read-outs. | Material model, load case, field selector, verdict + checks |

The geometry is identical in all stages — only the render mode (`SceneBuilder.setRenderLevel`)
and which control panels (`data-level`) are visible change. Panels can target several stages
(e.g. `data-level="2 3"`); `levels.js` toggles a `level-N` body class.

---

## The geometry engine (`js/superadobe.js`)

Based on:

- López, González, Llauradó — *"Equations that describe the geometry of Superadobe domed structures"* (3er CIIE, UPM).
- López Gómez, M.A. — *"A study of the geometry and structural performance of Superadobe domes"* (Doctoral thesis, UPM, 2021).

**Dome profile (revolve / "spin").** A dome is a circular arc revolved about the vertical
axis, with the arc's centre offset horizontally by `a` (gives the pointed, paraboloid-like
profile — not a hemisphere):

```
x(h) = √((Rb + a)² − (h − h1)²) − a          (inner ring radius at height h)
H    = h1 + √((Rb + a)² − (Rt + a)²)          (total height)
```
`Rb` = base radius · `a` = arch offset (pointiness) · `Rt` = skylight radius · `h1` = cylindrical base height.

**Courses live only on the course-height grid.** The profile is sampled every `hs` (one ring per
bag height, §3.6.6) and **ends at the last ring that actually rests on the one below** — there is
no extra ring at the theoretical arc top, and a course whose inward step exceeds the flat bag
width `L = sw − hs` (paper eq. 8′ with F ≤ 0 — it would float) is refused, truncating the dome.
`Rt` is therefore a **lower bound** ("t_min" in the thesis); the *achieved* skylight radius —
the top ring's inner radius — is reported live under the Skylight slider.

**Geometric coherency F (paper eq. 8′).** For every pair of consecutive rings,
`F = (L − step)/L` is the fraction of the flat bag width still bearing on the ring below. The
worst pair is shown as a live green/amber/red bar (Layout **and** Layering stages, since
diameter, shape, skylight, bag width and course height all move it). `SuperAdobe.coherency`.

A dome can also be **closed at the top** ("Closed top" option): the skylight is sealed to a tiny
apex and the Stage-1 shell gets a smooth rounded cap (`buildShellGeometry`, `s.closedTop`).

A **"Conventional — rr = 2·rb + sw"** button sets the pointiness to the thesis's standard shape
(the vertical compass planted on the outer edge of the base sack, Fig. 3-28); the shape label
reads "conventional" whenever the slider is on it.

**Plane slicing is the single source of truth.** At any height, each dome is a circle; the
layer curve is each circle's arc that lies **outside every other dome** (union boundary) and
outside any opening (`sliceSpans`). Both stages consume it:

- **Stage 1 shell** lofts the slice-curves over fine height steps into one welded surface (`buildShellGeometry`).
- **Stage 2 courses** sweep a **stadium (capsule) bag section** — flat top/bottom, rounded inner/outer faces — along the same curves at course-height spacing (`buildCourseGeometries` → `sweepSection`).

---

## Construction rules (from thesis §3.6)

- **Opening quadrant rule (§3.6.9).** Max **4 openings, one per imaginary quadrant**; wall
  arc between openings ≥ **1.25 m** — evaluated **at the heights where the openings actually
  are**, on the shrinking ring radius `x(h)`, not at the base. Ideal door 1.5 × 1.8 m, window
  1.0 × 1.5 m. Violations show as warnings. `computeOpenings` / `validateOpenings`.

- **Openings snap to the course grid (§3.6.7).** Molds sit on top of a finished ring, so every
  sill and springline lands on a **course boundary**. The door mold is set once the wall reaches
  0.2–0.6 m, so whole **threshold courses run continuously under the doorway** (the strongest
  tie in the structure); the door's 1.8 m clear height is measured from the mold base and the
  head bag rests on a completed course.

- **Barbed wire — double line, toward the interior (§3.6.6).** Two strands are stitched into
  the bedding joint on top of every course, laid **astride the NEXT ring's centreline** (biased
  inward "to hold in place the next ring"). The top ring gets no wire. The calculator counts
  **2 × (perimeter + 1.25 m)** per joint; the 2D section draws the strands as **dots** (they
  cross the section plane). `buildWireGeometries`.

- **Base buttress (§3.6.8–3.6.9).** Optional real element (checkbox in Foundation): an extra
  sack wall hugging the dome's outer face up to **50 cm above the springline**, sewn on with
  double wire, cut at doorways/corridors and neighbour intersections, included in material and
  time totals. The Ø > 1.5 m advisory points to it. `buttressCourses`.

- **The intersection rule (§3.6.8).** Where two domes meet, each course alternates by
  junction: one dome's bag extends a **half-bag past** the seam (covers) while the other
  stops a **half-bag short** (butts). Roles swap diagonally between the two junctions and
  **flip every layer**. The shell uses a plain clean union (no offset). `intersectionGaps`.

- **Staggered joints / 20° spiral (§3.6.6).** A full-circle course (the perfect rings above
  the openings) is a **closed** seamless loop whose joint start rotates **20° per layer**, so
  the closures spiral up the dome and no sack ends where the one below ended. Rings already
  broken by an opening or intersection are left as-is. `buildCourseGeometries(..., courseIndex)`.

- **Interlock radius.** Courses trim against the neighbour's **centerline** (so bags reach
  each other and interlock); the shell trims against the neighbour's **outer wall** (clean
  watertight merge).

- **Ideal apse (§3.6.8).** Centre on the outer edge of the main dome's base sack; outer base
  edge → main apex at 45°; acts as a buttress. "+ Ideal Apse" button. `idealApse`.

- **Sack sizing (Table 3-1).** Recommended bag width/height by base diameter, surfaced as a
  hint. `recommendedSack`.

- **Door corridor (§3.6.7).** Optional entrance hall guided by a deep door mold: stadium-bag
  jambs + a stadium "vault" arch. `buildCorridorGeometries`.

- **No-door default.** Only the first dome gets a door; domes added after it default to none.

---

## Simulation engine (`js/simulation.js`, Stage 3)

A deterministic, closed-form analytical engine — **not** a finite-element solver — implementing
the ring-by-ring limit-state model from thesis ch. 6 (validated there against Ansys FEA in ch. 7),
combined with membrane shell theory:

- **Discrete block model** (Heyman "safe theorem"): per-ring weights, kern-bounded thrust,
  bearing area, sliding, bag tension → the limit-state PASS/FAIL checks.
- **Membrane shell theory:** meridional + hoop stress of the shell of revolution. Reproduces
  the classic result — hoop **compression** in the cap, **tension** below the neutral ring
  (~52°) — i.e. exactly where the bags + barbed wire carry the tension the earth cannot.
- **Wind** (pressure-coefficient drag, feeds global roll-over/sliding), **Seismic** (equivalent
  static base shear), **Thermal** (transient earthen wall: U-value, time lag, decrement).

Validated against the thesis FEA envelope: peak tension/compression < 1.4 MPa, shear < 0.7 MPa.
`Simulation.analyze(structure, others, env)` returns per-ring fields + global checks + verdict;
the 3D shell is painted per-vertex by the selected field. See
[`docs/SUPERADOBE-STUDY-AND-SIMULATION.md`](docs/SUPERADOBE-STUDY-AND-SIMULATION.md) for the full
study of the source books, the comparison, and the simulation research.

## Files

| File | Responsibility |
|------|----------------|
| `index.html` | Layout (3-column: controls · viewport · results), `data-level` tags per stage |
| `css/style.css` | Dark theme, CSS custom properties |
| `js/superadobe.js` | Geometry engine — profiles, slicing, shell loft, bag sweep, openings, intersection rule, corridors |
| `js/calculator.js` | Material quantities (continuous sack cut per ring + 1.25 m overcut; openings carved from every ring per paper eq. 10′), time from the thesis §3.6.12 rate (~0.1875 m of laid sack per man-hour), eco score; `aggregateComplex` for the whole site |
| `js/simulation.js` | **Structural / thermal / seismic / wind analysis (Stage 3)** — thesis ch. 6 model + membrane theory |
| `js/main.js` | Three.js scene, orbit controls, render-level switch (1/2/3), sim heat-map paint, raycast pick |
| `js/ui.js` | Structure list + per-structure controls; drives scene/calculator/layer-plan/simulation |
| `js/levels.js` | Stage 1 ↔ 2 ↔ 3 switching |
| `js/layerplan.js` | 2D cross-section drawing (oval/stadium sections + layer curve) |
| `docs/SUPERADOBE-STUDY-AND-SIMULATION.md` | Study of both source books + comparison + simulation spec |
| `.claude/launch.json` | `npx serve` config for the preview |

---

## Notes

- Script order matters: `main.js` must load **before** `ui.js` (it provides `SceneBuilder`).
- In a backgrounded dev preview the initial `requestAnimationFrame` render can sit idle and
  WebGL screenshots can hang — neither happens in a normal visible browser; any interaction
  kicks the first render.
