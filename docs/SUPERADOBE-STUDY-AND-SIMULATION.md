# Superadobe — Study of the Source Books, Comparison with the App, and the Simulation Level

This document is the engineering reference behind the Super Adobe Generator. It distils
the two source works, maps every concept onto what the app already implements, identifies
the gaps, and specifies the new **Simulation** stage (Level 3).

**Sources**
- **[P]** López, M.; González, M.N.; Llauradó, N. — *Equations that describe the geometry
  of Superadobe domed structures* (3er CIIE, ETSEM–UPM). *(the "equations paper", 20 pp.)*
- **[T]** López Gómez, M.A. — *A study of the geometry and structural performance of
  Superadobe domes* (Doctoral thesis, ETSEM–UPM, 2021, 365 pp.). *(the "thesis")*
- Supporting literature (web): Canadell, Blanco, Cavalaro, *Comprehensive design method
  for earthbag and superadobe structures* (Materials & Design, 2016) = thesis ref **[52]**;
  Heyman / Lau, *Equilibrium analysis of masonry domes* (MIT); CEB wall thermal datasets.

---

## PART A — The geometry model (paper [P], thesis ch. 5)

A superadobe dome is **a circular arc revolved about the vertical axis**. The arc's centre
is offset horizontally by `a`, which makes the profile a pointed/paraboloid shape rather
than a hemisphere.

### Independent ("constructive") parameters
| Symbol | Meaning | App field |
|--------|---------|-----------|
| `sw` | sack (bag) width, ≈0.4 m | `bagWidthCm/100` |
| `hs` | sack (course) height, ≈0.2 m | `courseHeightCm/100` |
| `Extf`=`Extb` | the curved part of the section that does **not** rest on the course below | derived from the stadium section (≈ `min(sw, hs)`) |
| `rb` | base radius (inner compass) | `diameter/2` |
| `rr` | roof radius = radius of curvature of the meridian arc | `rb + a` |
| `a` | arch offset = `rr − rb` (pointiness) | `(pointiness/100)·rb` |
| `tr`/`tmin` | skylight (top) radius | `skylightRadius` |
| `h1` | height of a cylindrical base | `baseWallHeight` |

### Core equations
- **Meridian / variable radius** (paper eq. 1″, thesis 5.1″):
  ```
  x(h) = rb                                         0 ≤ h ≤ h1     (cylindrical base)
  x(h) = √(rr² − (h − h1)²) + rb − rr               h1 < h ≤ H     (revolved arc)
       ≡ √((rb+a)² − (h − h1)²) − a
  ```
- **Total height** (eq. 3′): `H = h1 + √(rr² − (tr + rr − rb)²)`
- **Geometric-coherency factor F** (eq. 8′) — the *fraction of a bag's flat width that
  still rests on the course below*, evaluated at the worst (top) joint:
  ```
  F = 1 − ( √((tr+rr−rb)² + 2·√(rr²−(tr+rr−rb)²)·hs − hs²) + rb − rr − tr ) / (sw − Extf)
  ```
  `F` is a **pure-geometry stability indicator**. Set a minimum (¼ or ½); if the real dome
  falls below it the top blocks "float" with almost no bearing → peak shear, rigid-body
  motion, collapse (paper Figs 9–11). This is the geometric precursor to the structural
  checks.
- **Habitable area** (eq. 9′): `A = Σ π·x(3i)²` over `⌈H/3⌉` 3-m-spaced floors.
- **Wall volume** (eq. 10′): `V = Σ Lᵢ·sw·hs`, `Lᵢ` = ring length minus opening arcs.

### Conventional vs. unrestricted domes
- *Conventional*: `sw = rb/6`, `rr = 2rb + sw` ⇒ `rr = 13·sw`, `rb = 6rr/13`.
- *Unrestricted* (what the app supports): only `rr ≥ rb`; every parameter is free.

---

## PART B — Construction rules (thesis ch. 3.6)

These are the empirical "compass + mold" rules. **Most are already in the app.**
- **§3.6.5–6 Compasses / main procedure** — concentric rings of decreasing radius.
- **§3.6.7 Molds** for door/window openings (deep mold guides a corridor).
- **§3.6.8 Buttresses & apses** — overlapping domes are sewn at the intersection; the
  *ideal apse* is centred on the outer edge of the main dome's base sack with its outer
  base edge → main apex at 45° (acts as a buttress).
- **§3.6.9 Empirical design rules** — max 4 openings, one per imaginary quadrant; wall arc
  between openings ≥ 1.25 m; ideal door 1.5×1.8 m, window 1.0×1.5 m; Table 3-1 sack sizes.
- **§3.6.11 Waterproofing**, **§3.6.12 time & costs** (0.1875 m of sack ≈ 1 man-hour;
  a 3.8 m, 34 t, 20 m³ dome with 250 m of sack ≈ 1500 man-hours ≈ 40 days for a crew of 5).

---

## PART C — The structural model (thesis ch. 6) — **the spec for the Simulation level**

The thesis builds a **closed-form, ring-by-ring limit-state model** (its "dome calculator",
a Python script) and validates it against Ansys FEA in ch. 7. This is *exactly* the right
model for a browser: no mesh, no solver, deterministic, fast. The core assumption
(fig. 6-1) is Heyman/funicular: **the resultant force on each ring is bounded by the kern
(middle-third) limits of the section** — if a thrust line fits inside the wall, the dome is
safe (the "safe theorem").

### C.1 Per-ring geometry (eqs 6.1–6.9)
For each ring `i` (`i=1…n`, `n = ⌊H/hs⌋`), with `w = sw`, `x = Extf`:
```
RIi   = x(h(i))                 inner radius (profile.inner)
RCi   = RIi + w/2               mid radius   (profile.r)
REi   = RIi + w                 outer radius
Rkl,int,i = RCi − w/6           inner kern limit
Rkl,ext,i = RCi + w/6           outer kern limit
contact strip i↔i+1  = [RIi , REi+1]      (overlap of consecutive rings)
Az,ef,i = 2π·RCcontact·width·solidFrac    bearing/contact area (minus openings)
```

### C.2 Masses, centroid, forces (eqs 6.10–6.18)
```
Wi   = den · (2π·RCi·solidFrac) · A_section          ring mass
Wti  = Σ_{j>i} Wj                                    accumulated mass above i
Xgi  = Σ RCj·Wj / Wti ,  Zgi = Σ h(j)·Wj / Wti       centroid of substructure above i
Fhmax,i = Wti·(Rkl,ext,i − Xgi)/(Zgi − h(i))         max horizontal force (thrust → outer kern)
Fhmin,i = Wti·(Rkl,int,i − Xgi)/(Zgi − h(i))         min horizontal force (thrust → inner kern)
Nd,v,i = Wti·fs1   Td,i = Fhmax·fs1   Tk,i = Fhmin·fs2
```

### C.3 Moments & stresses (eqs 6.19–6.24‴)
```
Md,max = Nd,v·(w/6)        Md,min = −Nd,v·(w/6)
σv,i      = Nd,v,i / Az,ef,i                                  vertical compression
σext,max  = σv + 3·Md,max/(π·RCi·w²)                          peak compression (incl. bending)
σh,i      = σv,i / kp                                          lateral (confined) pressure
ΔFhc = Fhmin,i+1 − Fhmax,i   →  σθ,c,int = ΔFhc/(2π·RCi·w),  σθ,c,adobe = ΔFhc/(w·hs)   hoop compression
ΔFht = Fhmax,i+1 − Fhmin,i   →  σθ,t,int = ΔFht/(2π·RCi·w),  σθ,t,adobe = ΔFht/(w·hs)   hoop tension
```

### C.4 The 13 safety criteria (§6.3) — each is a pass/fail inequality
**Global (whole dome):**
1. **Wind roll-over:** `Wt·fs1·RE1 ≥ qwind·H²·γq2/2`
2. **Wind slipping:** `cbw·Az,base + Nground·μ ≥ qwind·H·γq2`
3. **Ground bearing:** `fground ≥ −σd,v,0`
4. **Buckling:** `Eadobe·w ≥ −σd,v,max·4H`

**Local (per ring):**
5. **Outward roll-over:** `Nk,v·(Rkl,ext−REi) + Wi·w·fs1/2 ≥ Td·hs`
6. **Inward roll-over:** kern-arm comparison (3 cases by position of `RI(i−1)`).
7. **Sliding:** `cbw·Az,ef/γwire + Nk,v·μ ≥ Td`
8. **Bag tear (horizontal):** `ttear ≥ Td − Nd·μ`
9. **Adobe crush (vertical):** `fadobe ≥ −σext,max`
10. **Adobe crush (hoop):** `fadobe ≥ −σθ,c,int` and `≥ −σθ,c,adobe`
11. **Adobe split (hoop tension):** `fadobet ≥ σθ,t,int` and `≥ σθ,t,adobe`
12. **Lateral bag tear:** `tbag/γbag ≥ −σext,max·hs/(2·kp)`
13. **Longitudinal bag tear:** `tbag·2(w+hs)/γbag ≥ σθ,t,adobe·w·hs`

A design that satisfies all 13 (for every ring) is "structurally sound on the safe side".

---

## PART D — FEA validation & material data (thesis ch. 7)

Ansys Workbench static structural, 35 of 40 models converged. **Non-convergence = rigid-body
motion = real instability** (the 3 biggest "blue" domes; 2 biggest "brown" exceeded body
count). The validated material and result data the Simulation level uses as defaults and
benchmarks:

### Idealized Superadobe composite (rule of mixtures: 30% clay, 30% sand, 30% gravel, 10% binder)
| Property | Value | Notes |
|----------|-------|-------|
| Young's modulus `E` | **21.4 GPa** (used 20–21) | idealized hardened composite (≈concrete−30%) |
| Poisson's ratio `ν` | **0.214** | |
| Density `den` | **2108 kg/m³** | ≈ concrete −10% |
| Bulk / shear modulus | 12 / 8.7 GPa | auto-derived by Ansys |
| Contact friction `μ` | **2.0** | barbed-wire effect, ref [55] |
| Wind pressure | **2 kPa** | from the most dangerous angle |
| Ground bearing `fground` | ~2000 kg/m² (~20 kPa) | |

### Validated result envelope (across all 35 domes)
- **Max tensile (principal) stress < 1.4 MPa**, located at the **mid-span of the course over
  the main entrance** (modelled as a simply-supported beam → easy rebar/lintel fix).
- **Max compressive stress < 1.4 MPa** (≪ concrete 20–40 MPa).
- **Max shear stress < 0.7 MPa** (≪ concrete 6–17 MPa).
- **Max total deformation ≈ 0.75 mm**, in the uppermost courses.
- Stress is **not monotonic with size** — "fine-tuning" `rb, rr, sw` matters: better configs
  had **50 % lower** peak tension. The ring-by-ring calculator predicts this better than a
  rule of thumb.
- A **steel door frame** roughly halves the peak tensile stress (0.79 → 0.33 MPa).

### Future work the thesis itself proposes (ch. 8–9) — our roadmap
- **Proposition 2:** dynamic (seismic) simulations, non-linear wire/bag/adobe interaction,
  realistic vault openings, broader load spectrum.
- **Proposition 9:** *"a tool like CICERO that produces material quantities and visualisations
  from input parameters, integrated with a structural-assessment tool that predicts safety
  ring by ring."* — **this app is exactly that tool.** Adding the Simulation level realises it.
- **Corbelling theory** (eqs 9.1–9.2): inward roll-over moment of a dome wedge — an alternative
  collapse check.

---

## PART E — Comparison: the books vs. what the app implements

| Concept (source) | In the app? | Where / notes |
|---|---|---|
| Revolved offset-arc meridian `x(h)` ([P]1″) | ✅ | `domeProfile` in superadobe.js |
| Total height `H` ([P]3′) | ✅ | `domeHeight` |
| Geometric factor `F` ([P]8′) | ⚠️ **partial** | implied by profile but never computed/shown → **added in Simulation** |
| Habitable area `A`, volume `V` | ✅ (V via material calc) | calculator.js |
| Table 3-1 sack sizing | ✅ | `recommendedSack` + hint |
| Quadrant opening rule, ≥1.25 m wall | ✅ | `validateOpenings` |
| Apse / intersection sewing, 45° ideal apse | ✅ | `intersectionGaps`, `idealApse` |
| Door molds / corridors, head curves | ✅ | `buildCorridorGeometries` |
| Plane-slice "spin + boolean" engine | ✅ | `sliceSpans`, `buildShellGeometry` |
| Material quantities, time, eco | ✅ | calculator.js |
| **Ring-by-ring forces & stresses (ch. 6)** | ❌ → ✅ **NEW** | `simulation.js` |
| **13 limit-state safety checks (§6.3)** | ❌ → ✅ **NEW** | `simulation.js` |
| **FEA-validated stress envelope, μ, E, den** | ❌ → ✅ **NEW** | sim defaults + benchmarks |
| **Thermal / seismic / wind performance** | ❌ → ✅ **NEW** | research-based sim modules |

**Conclusion:** the app already nails geometry, construction rules and quantities (Propositions
9's "geometry + quantities" half). The missing half is *structural performance prediction* —
which the thesis hands us as a ready-to-code closed-form model. That is the Simulation level.

---

## PART F — Research: 3D engineering simulation methods & what fits a browser

| Method | What it does | Browser feasibility | Verdict for this app |
|---|---|---|---|
| **Full 3D FEA** (Ansys/Abaqus) | meshes the solid, solves stiffness `K·u=f` | heavy; possible via WASM but 32k-DOF caps & minutes of solve | **No** as the core — used by the thesis offline to *validate* |
| **Analytical limit-state / thrust-line** (Heyman safe theorem; thesis ch. 6; Canadell [52]) | closed-form ring forces, kern check, 13 limit states | trivial, ms-fast, deterministic | **YES — the reliable core** |
| **Membrane shell theory** | meridional + hoop stress of a shell of revolution; hoop turns tensile below the neutral point (~52° for a hemisphere) | closed-form | **YES — adds the hoop-tension map** that explains why bags+wire matter |
| **Corbelling wedge theory** (thesis 9.1–9.2) | inward overturning of a dome wedge | closed-form integral | optional advanced check |
| **CFD (Navier–Stokes)** | full wind flow field | not reliably real-time in JS | **No** — use code pressure coefficients (`Cp`) + a schematic flow viz instead |
| **Wind via pressure coefficients** (Eurocode/ASCE for domes) | windward/leeward/uplift `Cp`, net drag & uplift | trivial | **YES — feeds the global wind checks** |
| **Seismic — equivalent static lateral force** | base shear `V = Cs·W`, overturning vs. stabilising | trivial | **YES** |
| **Thermal — 1-D transient wall** (U-value, thermal mass, time lag, decrement) | steady + periodic heat flow through the earthen wall | trivial | **YES — earth's headline benefit** |

**Chosen architecture:** a deterministic analytical engine (`simulation.js`) with four modules —
**Structural** (faithful to thesis ch. 6 + membrane hoop), **Wind** (Cp method feeding the global
checks), **Seismic** (equivalent static), **Thermal** (transient earthen wall) — each clearly
labelled by fidelity, validated against the thesis FEA envelope (tension < 1.4 MPa, deflection
< ~1 mm) and the literature (CEB U-values/time-lags, 2.3–3.0 MPa earthbag strength).

---

## PART G — Simulation level (Level 3) design

- **Workflow:** header gains a 3rd tab `3 · Simulation` after Layering. `levels.js` extends to
  3 states; CSS uses `[data-level~="N"]` so panels can target one or several stages.
- **Inputs (left, `data-level="3"`):** material preset + E, ν, density, compressive `fadobe`,
  tensile `fadobet`, friction `μ`, bag tensile `tbag`; load case — wind pressure, seismic
  coefficient, ground bearing, live/snow; analysis toggles (Structural / Wind / Seismic / Thermal).
- **Viewport:** the dome is **colour-mapped** by the selected field (vertical compression, hoop
  tension, hoop compression, shear, utilisation, or bearing factor F), with a colour-bar legend
  and a field selector. Critical ring highlighted.
- **Results (right, `data-level="3"`):** overall verdict + governing check & safety factor; the
  4 global checks (pass/fail + margin); worst-ring summary of the 9 local checks; per-field peak
  values **benchmarked against the thesis FEA envelope**; thermal (U-value, R, time lag, decrement,
  comfort rating) and seismic (base shear, overturning ratio, period) read-outs.
- **Engine reuse:** consumes the existing per-structure `profile` (`{y,r,inner}`) and `solidFrac`
  exactly as the material calculator does, so geometry and analysis always agree.

*Fidelity note shown in-app:* the Structural core reproduces the thesis's safe-side limit-state
method (validated vs. Ansys); Wind/Seismic/Thermal are standard engineering estimates, not a
CFD/FEA solve.

---

## PART H — Detailed study: opening rules (§3.6.7 & §3.6.9) and how the app enforces them

The openings (doors/windows) are governed by two thesis sections. Below is the verbatim
substance and the exact limits the app now applies.

### H.1 §3.6.7 — Mold placement, sizes and sills
- **Mold heights / sills.** The door mold is set after the wall reaches **0.2–0.6 m** (a low
  threshold; the doorway itself runs from the floor). The window mold (and therefore the window
  **sill**) sits at **1.0–1.5 m** above ground.
- **Ideal sizes.** *Ideal door = 1.5 m wide × 1.8 m high. Ideal window = 1.0 m wide × 1.5 m high.*
  Wider/taller needs a lintel or buttress.
- **Self-supporting arch.** When 2–3 courses remain below the mold top, the sack is carried
  **over** the mold and shaped into a self-sustaining arch (the dome's own corbelling forms the
  head). The mold must stand **~40 cm inside** the dome to follow the closing radii.
- **Compass sweep.** Within a door frame the vertical compass sweeps θ ≈ 124° (≈4 m at the base) —
  *"more than enough to encompass any window or door frame"*. So a single opening must span **≤ ~124°**
  of arc; beyond that it cannot be laid against one mold.
- **Orientation.** Molds are set on a **solar axis** (room orientation) — in the app, the per-dome
  facing + quadrant slots.

### H.2 §3.6.9 — Empirical design rules (the limits)
1. Material compressive resistance **60–80 kg/cm²** is safe for a dome **≤ 5 m** diameter.
2. **Quadrant rule:** divide the dome into 4 imaginary quadrants; **only one opening (door OR
   window) per quadrant** (so ≤ 4 total), and the **curved wall arc left between adjacent openings
   must be ≥ 1.25 m**.
3. **Ø > 1.5 m → buttresses/apses** are required for safety (apse 45° rule, §3.6.8).
4. **Table 3-1 sack sizes** by internal base diameter (filling reduces nominal width 7–12 cm):

   | Base Ø (m) | sack width (m) | sack height (m) |
   |---|---|---|
   | 0–3 | 0.30 | 0.085 |
   | 3–3.5 | 0.35 | 0.095 |
   | 3.5–4 | 0.40 | 0.10 |
   | 4–4.5 | 0.45 | 0.13 |
   | 4.5–5 | 0.50 | 0.14 |
5. Foundation trench **1 m × 1 m** for structures ≤ 35 t.
6. Conventional triple relation `rr = 2·rb + sw`.

### H.3 How the app enforces these (code)
`SuperAdobe.OPENING_RULES` holds the limits; `computeOpenings` clamps geometry to them and
`validateOpenings(p, baseRadius, {domeHeight, hasButtress})` returns specific violations:

| Rule (source) | Enforcement |
|---|---|
| ≤ 4 openings, one/quadrant (§3.6.9) | `computeOpenings` builds at most 4, placed at facing + k·90°; >4 ⇒ warning |
| Wall arc ≥ 1.25 m (§3.6.9) | `validateOpenings` finds the worst adjacent gap; if < 1.25 m it warns **and suggests the diameter** that would satisfy it |
| Ideal door 1.5 × 1.8 m (§3.6.7) | door width **capped at 1.5 m** and clear height at **1.8 m** in `computeOpenings`; over-wide ⇒ warning |
| Ideal window 1.0 × 1.5 m, sill 1.0–1.5 m (§3.6.7) | windows fixed to **1.0 × 1.5 m** with sill clamped to **~1.0 m** |
| Opening fits the dome — sweep ≤ 124° (§3.6.7) | warns if `width / R` exceeds 124° (opening too wide for that dome) |
| Dome tall enough for a 1.8 m door (§3.6.7) | warns if `H·0.82 < 1.8 m`, reporting the limited clear height |
| Ø > 1.5 m → buttresses (§3.6.9) | advisory hint when no adjoining dome/apse buttresses it |
| Table 3-1 sack size (§3.6.9) | `recommendedSack` hint, off-spec flagged |

`SuperAdobe.maxDoorWidth(p, baseRadius)` returns the widest door that still leaves ≥ 1.25 m walls
for the current layout — shown live in the Openings hint so the user designs within the rule.
