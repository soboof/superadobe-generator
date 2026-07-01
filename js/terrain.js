/**
 * terrain.js — window.LandScan
 *
 * Loads a SCANNED POINT CLOUD of the user's land (.ply or .xyz, from a phone
 * LiDAR / photogrammetry app or a survey) and turns it into a continuous ground
 * heightfield so the superadobe structures can sit on the REAL surface.
 *
 * Dependency-free: PLY (ascii + binary little/big-endian) and XYZ are parsed by
 * hand, matching this project's no-build, no-deps style (cf. the hand-rolled
 * orbit controls in main.js). Only the global `THREE` is required.
 *
 * Pipeline:  parse → normalize (up-axis, scale, centre) → grid (median per cell,
 *            fill gaps, smooth) → mesh + bilinear height sampler.
 *
 * API:
 *   LandScan.loadFile(file, opts) -> Promise<terrain>
 *       opts: { upAxis:'auto'|'x'|'y'|'z', scale:Number }   (both optional)
 *   terrain = {
 *     field:    { nx, nz, minX, minZ, dx, dz, heights:Float32Array, colors:Float32Array|null },
 *     info:     { points, sizeX, sizeZ, sizeY, nx, nz, upAxis, hasColor },
 *     heightAt(x, z) -> Number,          // bilinear, clamps to bounds
 *     buildMesh()   -> THREE.Mesh,       // fresh ground mesh (receiveShadow)
 *   }
 *   LandScan.current  — last loaded terrain, or null
 *   LandScan.clear()
 */
window.LandScan = (function () {
  'use strict';

  // Subsample huge clouds so parsing/gridding stays snappy in the browser.
  const MAX_POINTS = 1200000;

  // ── Public: load a File object ─────────────────────────────────────────────
  function loadFile(file, opts) {
    opts = opts || {};
    const name = (file.name || '').toLowerCase();
    const isXYZ = name.endsWith('.xyz') || name.endsWith('.txt') || name.endsWith('.asc') || name.endsWith('.pts');
    return readArrayBuffer(file).then(buf => {
      const pts = isXYZ ? parseXYZ(buf) : parsePLY(buf);
      if (!pts || pts.count === 0) {
        throw new Error('No 3-D points found in this file. Expected a .ply or .xyz point cloud.');
      }
      const terrain = build(pts, opts);
      _current = terrain;
      return terrain;
    });
  }

  let _current = null;

  function readArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('Could not read the file.'));
      fr.readAsArrayBuffer(file);
    });
  }

  // ── XYZ parser ──────────────────────────────────────────────────────────────
  // Plain text, one point per line: "x y z [r g b]" (space / comma / tab).
  function parseXYZ(buf) {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
    const lines = text.split(/\r?\n/);
    const x = [], y = [], z = [], col = [];
    let hasColor = false;
    const stride = Math.max(1, Math.ceil(lines.length / MAX_POINTS));
    for (let li = 0; li < lines.length; li += stride) {
      const line = lines[li].trim();
      if (!line || line[0] === '#' || line[0] === '/') continue;
      const t = line.split(/[\s,;]+/);
      if (t.length < 3) continue;
      const px = +t[0], py = +t[1], pz = +t[2];
      if (!isFinite(px) || !isFinite(py) || !isFinite(pz)) continue;
      x.push(px); y.push(py); z.push(pz);
      if (t.length >= 6) {
        hasColor = true;
        col.push(normChannel(+t[3]), normChannel(+t[4]), normChannel(+t[5]));
      } else if (hasColor) {
        col.push(0.6, 0.5, 0.4);
      }
    }
    return { x, y, z, color: hasColor ? col : null, count: x.length };
  }

  function normChannel(v) {
    if (!isFinite(v)) return 0.5;
    return v > 1.0001 ? Math.min(1, v / 255) : Math.max(0, v);
  }

  // ── PLY parser (ascii + binary little/big endian) ────────────────────────────
  function parsePLY(buf) {
    const bytes = new Uint8Array(buf);
    // Header is ASCII and ends with a line "end_header".
    const headerEnd = findHeaderEnd(bytes);
    if (headerEnd < 0) throw new Error('Not a valid PLY file (no end_header).');
    const headerText = new TextDecoder('ascii').decode(bytes.subarray(0, headerEnd));
    const lines = headerText.split(/\r?\n/);

    let format = 'ascii';
    let vertexCount = 0;
    let props = [];          // [{name, type}]
    let inVertex = false;
    for (const raw of lines) {
      const l = raw.trim();
      if (l.startsWith('format')) {
        if (l.indexOf('binary_little_endian') >= 0) format = 'le';
        else if (l.indexOf('binary_big_endian') >= 0) format = 'be';
        else format = 'ascii';
      } else if (l.startsWith('element')) {
        const p = l.split(/\s+/);
        inVertex = p[1] === 'vertex';
        if (inVertex) vertexCount = parseInt(p[2], 10) || 0;
      } else if (l.startsWith('property') && inVertex) {
        const p = l.split(/\s+/);
        // "property <type> <name>"  (list properties are faces — ignore)
        if (p[1] !== 'list') props.push({ type: p[1], name: p[p.length - 1] });
      }
    }
    if (!vertexCount) throw new Error('PLY has no vertex element.');

    const idx = nameIndex(props);
    if (idx.x < 0 || idx.y < 0 || idx.z < 0) throw new Error('PLY vertices have no x/y/z.');
    const hasColor = idx.r >= 0 && idx.g >= 0 && idx.b >= 0;

    return format === 'ascii'
      ? parsePLYAscii(bytes, headerEnd, vertexCount, props, idx, hasColor)
      : parsePLYBinary(buf, headerEnd, vertexCount, props, idx, hasColor, format === 'le');
  }

  function findHeaderEnd(bytes) {
    // Locate "end_header" then advance past its trailing newline.
    const needle = 'end_header';
    for (let i = 0; i < bytes.length - needle.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) {
        if (bytes[i + j] !== needle.charCodeAt(j)) { ok = false; break; }
      }
      if (ok) {
        let k = i + needle.length;
        while (k < bytes.length && bytes[k] !== 0x0a) k++; // to end of line
        return k + 1;
      }
    }
    return -1;
  }

  function nameIndex(props) {
    const find = names => props.findIndex(p => names.indexOf(p.name.toLowerCase()) >= 0);
    return {
      x: find(['x']), y: find(['y']), z: find(['z']),
      r: find(['red', 'r', 'diffuse_red']),
      g: find(['green', 'g', 'diffuse_green']),
      b: find(['blue', 'b', 'diffuse_blue']),
    };
  }

  const TYPE_SIZE = {
    char: 1, uchar: 1, int8: 1, uint8: 1,
    short: 2, ushort: 2, int16: 2, uint16: 2,
    int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4,
    double: 8, float64: 8,
  };

  function isByteColor(type) { return type === 'uchar' || type === 'uint8' || type === 'char' || type === 'int8'; }

  function parsePLYAscii(bytes, offset, count, props, idx, hasColor) {
    const text = new TextDecoder('ascii').decode(bytes.subarray(offset));
    const lines = text.split(/\r?\n/);
    const x = [], y = [], z = [], col = hasColor ? [] : null;
    const stride = Math.max(1, Math.ceil(count / MAX_POINTS));
    let read = 0;
    for (let li = 0; li < lines.length && read < count; li++) {
      const line = lines[li].trim();
      if (!line) continue;
      const isSample = (read % stride === 0);
      read++;
      if (!isSample) continue;
      const t = line.split(/\s+/);
      const px = +t[idx.x], py = +t[idx.y], pz = +t[idx.z];
      if (!isFinite(px) || !isFinite(py) || !isFinite(pz)) continue;
      x.push(px); y.push(py); z.push(pz);
      if (hasColor) {
        const byteCol = isByteColor(props[idx.r].type);
        col.push(chan(+t[idx.r], byteCol), chan(+t[idx.g], byteCol), chan(+t[idx.b], byteCol));
      }
    }
    return { x, y, z, color: col, count: x.length };
  }

  function chan(v, byteCol) {
    if (!isFinite(v)) return 0.5;
    return byteCol ? Math.min(1, Math.max(0, v / 255)) : Math.min(1, Math.max(0, v));
  }

  function parsePLYBinary(buf, offset, count, props, idx, hasColor, little) {
    const dv = new DataView(buf, offset);
    // Per-vertex byte layout.
    const sizes = props.map(p => TYPE_SIZE[p.type] || 4);
    const off = []; let stride = 0;
    for (let i = 0; i < props.length; i++) { off.push(stride); stride += sizes[i]; }

    const sample = Math.max(1, Math.ceil(count / MAX_POINTS));
    const x = [], y = [], z = [], col = hasColor ? [] : null;
    const byteCol = hasColor && isByteColor(props[idx.r].type);

    const readProp = (base, i) => readNum(dv, base + off[i], props[i].type, little);

    for (let v = 0; v < count; v++) {
      const base = v * stride;
      if (base + stride > dv.byteLength) break;
      if (v % sample !== 0) continue;
      x.push(readProp(base, idx.x));
      y.push(readProp(base, idx.y));
      z.push(readProp(base, idx.z));
      if (hasColor) {
        col.push(
          chan(readProp(base, idx.r), byteCol),
          chan(readProp(base, idx.g), byteCol),
          chan(readProp(base, idx.b), byteCol),
        );
      }
    }
    return { x, y, z, color: col, count: x.length };
  }

  function readNum(dv, at, type, little) {
    switch (type) {
      case 'char': case 'int8': return dv.getInt8(at);
      case 'uchar': case 'uint8': return dv.getUint8(at);
      case 'short': case 'int16': return dv.getInt16(at, little);
      case 'ushort': case 'uint16': return dv.getUint16(at, little);
      case 'int': case 'int32': return dv.getInt32(at, little);
      case 'uint': case 'uint32': return dv.getUint32(at, little);
      case 'double': case 'float64': return dv.getFloat64(at, little);
      default: return dv.getFloat32(at, little);
    }
  }

  // ── Build heightfield + samplers from raw points ─────────────────────────────
  function build(pts, opts) {
    const n = pts.count;
    // 1. Up-axis: smallest-range axis is "up" for a roughly-flat plot of land.
    const rng = axisRanges(pts);
    let up = opts.upAxis && opts.upAxis !== 'auto' ? opts.upAxis : smallestAxis(rng);

    // 2. Map cloud axes → world (X, ground-east) (Y, up) (Z, ground-north).
    const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
    const wx = new Float64Array(n), wy = new Float64Array(n), wz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let gx, gy, gz; // ground-x, vertical, ground-z
      if (up === 'z') { gx = pts.x[i]; gy = pts.z[i]; gz = pts.y[i]; }
      else if (up === 'x') { gx = pts.y[i]; gy = pts.x[i]; gz = pts.z[i]; }
      else { gx = pts.x[i]; gy = pts.y[i]; gz = pts.z[i]; } // y-up
      wx[i] = gx * scale; wy[i] = gy * scale; wz[i] = gz * scale;
    }

    // 3. Centre horizontally at origin; drop lowest point to y = 0.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (wx[i] < minX) minX = wx[i]; if (wx[i] > maxX) maxX = wx[i];
      if (wz[i] < minZ) minZ = wz[i]; if (wz[i] > maxZ) maxZ = wz[i];
      if (wy[i] < minY) minY = wy[i]; if (wy[i] > maxY) maxY = wy[i];
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    for (let i = 0; i < n; i++) { wx[i] -= cx; wz[i] -= cz; wy[i] -= minY; }
    const sizeX = maxX - minX, sizeZ = maxZ - minZ, sizeY = maxY - minY;
    const gMinX = -sizeX / 2, gMinZ = -sizeZ / 2;

    // 4. Grid resolution: ~√points, biased to aspect ratio, clamped.
    const base = Math.max(24, Math.min(180, Math.round(Math.sqrt(n))));
    const aspect = sizeX > 0 && sizeZ > 0 ? Math.sqrt(sizeX / sizeZ) : 1;
    const nx = clampInt(Math.round(base * aspect), 12, 220);
    const nz = clampInt(Math.round(base / aspect), 12, 220);
    const dx = sizeX > 0 ? sizeX / (nx - 1) : 1;
    const dz = sizeZ > 0 ? sizeZ / (nz - 1) : 1;

    // 5. Bin points → median height per cell (robust to scan flyers).
    const cells = new Array(nx * nz);
    const colSum = pts.color ? new Float32Array(nx * nz * 3) : null;
    const colCnt = pts.color ? new Uint32Array(nx * nz) : null;
    for (let i = 0; i < n; i++) {
      const gi = clampInt(Math.round((wx[i] - gMinX) / dx), 0, nx - 1);
      const gj = clampInt(Math.round((wz[i] - gMinZ) / dz), 0, nz - 1);
      const ci = gj * nx + gi;
      (cells[ci] || (cells[ci] = [])).push(wy[i]);
      if (colSum) {
        colSum[ci * 3] += pts.color[i * 3];
        colSum[ci * 3 + 1] += pts.color[i * 3 + 1];
        colSum[ci * 3 + 2] += pts.color[i * 3 + 2];
        colCnt[ci]++;
      }
    }
    const heights = new Float32Array(nx * nz).fill(NaN);
    for (let c = 0; c < cells.length; c++) {
      if (cells[c]) heights[c] = median(cells[c]);
    }

    // 6. Fill empty cells from neighbours, then a light smoothing pass.
    fillGaps(heights, nx, nz);
    smooth(heights, nx, nz);

    // Colours per vertex: scan colour if present, else an earth gradient.
    const colors = buildColors(heights, nx, nz, colSum, colCnt);

    const field = { nx, nz, minX: gMinX, minZ: gMinZ, dx, dz, heights, colors };
    return {
      field,
      info: { points: n, sizeX, sizeZ, sizeY, nx, nz, upAxis: up, hasColor: !!pts.color },
      heightAt: (x, z) => sampleHeight(field, x, z),
      buildMesh: () => buildMesh(field),
    };
  }

  function axisRanges(pts) {
    const r = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
    for (let i = 0; i < pts.count; i++) {
      if (pts.x[i] < r.x[0]) r.x[0] = pts.x[i]; if (pts.x[i] > r.x[1]) r.x[1] = pts.x[i];
      if (pts.y[i] < r.y[0]) r.y[0] = pts.y[i]; if (pts.y[i] > r.y[1]) r.y[1] = pts.y[i];
      if (pts.z[i] < r.z[0]) r.z[0] = pts.z[i]; if (pts.z[i] > r.z[1]) r.z[1] = pts.z[i];
    }
    return { x: r.x[1] - r.x[0], y: r.y[1] - r.y[0], z: r.z[1] - r.z[0] };
  }

  function smallestAxis(rng) {
    if (rng.y <= rng.x && rng.y <= rng.z) return 'y';
    if (rng.z <= rng.x && rng.z <= rng.y) return 'z';
    return 'x';
  }

  function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function median(arr) {
    if (arr.length === 1) return arr[0];
    arr.sort((a, b) => a - b);
    const m = arr.length >> 1;
    return arr.length & 1 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
  }

  // Iterative neighbour fill for cells that caught no points.
  function fillGaps(h, nx, nz) {
    let remaining = 0;
    for (let i = 0; i < h.length; i++) if (isNaN(h[i])) remaining++;
    let guard = 0;
    while (remaining > 0 && guard++ < 64) {
      const next = h.slice();
      let filled = 0;
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const c = j * nx + i;
          if (!isNaN(h[c])) continue;
          let sum = 0, cnt = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              if (!di && !dj) continue;
              const ni = i + di, nj = j + dj;
              if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
              const v = h[nj * nx + ni];
              if (!isNaN(v)) { sum += v; cnt++; }
            }
          }
          if (cnt) { next[c] = sum / cnt; filled++; }
        }
      }
      for (let i = 0; i < h.length; i++) h[i] = next[i];
      remaining -= filled;
      if (!filled) break; // disconnected — bail (shouldn't happen for a plot)
    }
    // Any stragglers → 0 (flat).
    for (let i = 0; i < h.length; i++) if (isNaN(h[i])) h[i] = 0;
  }

  // One gentle box blur to take the edge off scan noise / stair-stepping.
  function smooth(h, nx, nz) {
    const src = h.slice();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let sum = 0, cnt = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
            const w = (di === 0 && dj === 0) ? 4 : 1;
            sum += src[nj * nx + ni] * w; cnt += w;
          }
        }
        h[j * nx + i] = sum / cnt;
      }
    }
  }

  function buildColors(h, nx, nz, colSum, colCnt) {
    const colors = new Float32Array(nx * nz * 3);
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < h.length; i++) { if (h[i] < minH) minH = h[i]; if (h[i] > maxH) maxH = h[i]; }
    const span = (maxH - minH) || 1;
    for (let c = 0; c < nx * nz; c++) {
      if (colSum && colCnt[c] > 0) {
        colors[c * 3] = colSum[c * 3] / colCnt[c];
        colors[c * 3 + 1] = colSum[c * 3 + 1] / colCnt[c];
        colors[c * 3 + 2] = colSum[c * 3 + 2] / colCnt[c];
      } else {
        // Earth gradient: low = darker soil, high = sandy.
        const t = (h[c] - minH) / span;
        colors[c * 3] = 0.42 + 0.30 * t;
        colors[c * 3 + 1] = 0.34 + 0.26 * t;
        colors[c * 3 + 2] = 0.22 + 0.16 * t;
      }
    }
    return colors;
  }

  // ── Bilinear height sampler ───────────────────────────────────────────────────
  function sampleHeight(field, x, z) {
    const { nx, nz, minX, minZ, dx, dz, heights } = field;
    let gx = (x - minX) / dx, gz = (z - minZ) / dz;
    gx = Math.max(0, Math.min(nx - 1, gx));
    gz = Math.max(0, Math.min(nz - 1, gz));
    const i0 = Math.floor(gx), j0 = Math.floor(gz);
    const i1 = Math.min(nx - 1, i0 + 1), j1 = Math.min(nz - 1, j0 + 1);
    const fx = gx - i0, fz = gz - j0;
    const h00 = heights[j0 * nx + i0], h10 = heights[j0 * nx + i1];
    const h01 = heights[j1 * nx + i0], h11 = heights[j1 * nx + i1];
    const a = h00 * (1 - fx) + h10 * fx;
    const b = h01 * (1 - fx) + h11 * fx;
    return a * (1 - fz) + b * fz;
  }

  // ── Mesh builder (fresh each call so main.js can dispose freely) ───────────────
  function buildMesh(field) {
    const { nx, nz, minX, minZ, dx, dz, heights, colors } = field;
    const verts = nx * nz;
    const pos = new Float32Array(verts * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        pos[c * 3] = minX + i * dx;
        pos[c * 3 + 1] = heights[c];
        pos[c * 3 + 2] = minZ + j * dz;
      }
    }
    const idxArr = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
        idxArr[p++] = a; idxArr[p++] = d; idxArr[p++] = b;
        idxArr[p++] = b; idxArr[p++] = d; idxArr[p++] = e;
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (colors) geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(new THREE.BufferAttribute(idxArr, 1));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: !!colors, color: colors ? 0xffffff : 0x6b5a3e,
      roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  return {
    loadFile,
    clear() { _current = null; },
    get current() { return _current; },
  };
})();
