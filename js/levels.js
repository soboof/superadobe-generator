/**
 * levels.js
 * Three-level workflow:
 *   Level 1 — LAYOUT:      assemble & position domes, set openings (massing).
 *   Level 2 — LAYERING:    sack courses, materials, crew, quantities (technical).
 *   Level 3 — SIMULATION:  structural / thermal / seismic / wind performance.
 *
 * Purely a view layer: it toggles a `level-N` class on <body>; CSS hides any
 * element whose `data-level` doesn't include the active level. Elements with no
 * `data-level` show in every stage; an element can list several (e.g.
 * data-level="2 3"). The 3D scene and control bindings (ui.js) are untouched —
 * controls just hide/show and the render mode switches.
 */
(function () {
  const body = document.body;
  const tabs = Array.from(document.querySelectorAll('#step-tabs .step-tab'));
  const cta = document.getElementById('btn-level-cta');
  const ctaHint = document.getElementById('level-cta-hint');

  const STEPS = {
    1: {
      forward: { go: 2, text: 'Continue to Layering →' },
      back: null,
      hint: 'Assemble and position your domes, set openings, then continue to configure the courses and materials.',
    },
    2: {
      forward: { go: 3, text: 'Continue to Simulation →' },
      back:    { go: 1, text: '← Back to Layout' },
      hint: 'Tune sack courses, fill material and crew. Use the layer toggles and course stepper to inspect construction.',
    },
    3: {
      forward: null,
      back:    { go: 2, text: '← Back to Layering' },
      hint: 'Set materials and loads, then read structural / thermal / seismic / wind performance. Pick a field to colour-map the dome.',
    },
  };

  const back = document.getElementById('btn-level-back');
  let level = 1;

  function setLevel(n) {
    level = n;
    body.classList.toggle('level-1', n === 1);
    body.classList.toggle('level-2', n === 2);
    body.classList.toggle('level-3', n === 3);

    tabs.forEach(t => t.classList.toggle('active', parseInt(t.dataset.level) === n));

    const s = STEPS[n];
    if (cta) {
      if (s.forward) {
        cta.dataset.go = s.forward.go;
        cta.textContent = s.forward.text;
        cta.style.display = '';
      } else {
        cta.style.display = 'none';
      }
    }
    if (back) {
      if (s.back) {
        back.dataset.go = s.back.go;
        back.textContent = s.back.text;
        back.style.display = '';
      } else {
        back.style.display = 'none';
      }
    }
    if (ctaHint) ctaHint.textContent = s.hint;

    // Switch the 3D engine: 1 = shell, 2 = bag courses, 3 = heat-map.
    if (window.SceneBuilder && window.SceneBuilder.setRenderLevel) {
      window.SceneBuilder.setRenderLevel(n);
    }
    // Let ui.js (re)compute the analysis when entering the Simulation stage.
    if (n === 3 && window.onEnterSimulation) window.onEnterSimulation();
  }

  tabs.forEach(t => t.addEventListener('click', () => setLevel(parseInt(t.dataset.level))));
  if (cta)  cta.addEventListener('click',  () => setLevel(parseInt(cta.dataset.go)));
  if (back) back.addEventListener('click', () => setLevel(parseInt(back.dataset.go)));

  // start on Level 1 (Layout)
  setLevel(1);

  // optional: expose for debugging / external triggers
  window.AppLevels = { setLevel, get level() { return level; } };
})();
