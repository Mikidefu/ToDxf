/*
 * Utilità geometriche sui percorsi. Un percorso è un array piatto [x0, y0, x1, y1, ...].
 */
(function (root) {
  'use strict';
  const NS = (root.ToDxf = root.ToDxf || {});

  // Levigatura di Taubin: toglie la "scalettatura" dei pixel senza restringere le forme.
  const TAUBIN_LAMBDA = 0.6307;
  const TAUBIN_MU = -0.6732;

  function laplacianStep(src, dst, n, closed, factor) {
    for (let i = 0; i < n; i++) {
      const x = src[2 * i], y = src[2 * i + 1];
      if (!closed && (i === 0 || i === n - 1)) {
        dst[2 * i] = x;
        dst[2 * i + 1] = y;
        continue;
      }
      const a = i === 0 ? n - 1 : i - 1;
      const b = i === n - 1 ? 0 : i + 1;
      dst[2 * i] = x + factor * ((src[2 * a] + src[2 * b]) / 2 - x);
      dst[2 * i + 1] = y + factor * ((src[2 * a + 1] + src[2 * b + 1]) / 2 - y);
    }
  }

  function smoothPath(pts, closed, iterations) {
    const n = pts.length / 2;
    if (n < 3 || iterations <= 0) return Float64Array.from(pts);
    const a = Float64Array.from(pts);
    const b = new Float64Array(a.length);
    for (let it = 0; it < iterations; it++) {
      laplacianStep(a, b, n, closed, TAUBIN_LAMBDA);
      laplacianStep(b, a, n, closed, TAUBIN_MU);
    }
    return a;
  }

  /** Ramer–Douglas–Peucker su polilinea aperta (tolleranza in pixel). */
  function simplifyOpen(pts, tol) {
    const n = pts.length / 2;
    if (n <= 2 || tol <= 0) return Float64Array.from(pts);
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const tol2 = tol * tol;
    const stack = [0, n - 1];
    while (stack.length) {
      const last = stack.pop();
      const first = stack.pop();
      const ax = pts[2 * first], ay = pts[2 * first + 1];
      const dx = pts[2 * last] - ax, dy = pts[2 * last + 1] - ay;
      const len2 = dx * dx + dy * dy;
      let maxD = -1, idx = -1;
      for (let i = first + 1; i < last; i++) {
        let px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
        if (len2 > 0) {
          let t = (px * dx + py * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          px -= t * dx;
          py -= t * dy;
        }
        const d2 = px * px + py * py;
        if (d2 > maxD) {
          maxD = d2;
          idx = i;
        }
      }
      if (maxD > tol2) {
        keep[idx] = 1;
        stack.push(first, idx, idx, last);
      }
    }
    let m = 0;
    for (let i = 0; i < n; i++) if (keep[i]) m++;
    const out = new Float64Array(2 * m);
    for (let i = 0, j = 0; i < n; i++) {
      if (!keep[i]) continue;
      out[j++] = pts[2 * i];
      out[j++] = pts[2 * i + 1];
    }
    return out;
  }

  /** RDP su poligono chiuso: lo divide in due metà dal punto più lontano dal primo. */
  function simplifyClosed(pts, tol) {
    const n = pts.length / 2;
    if (n <= 4 || tol <= 0) return Float64Array.from(pts);
    const x0 = pts[0], y0 = pts[1];
    let far = 0, best = -1;
    for (let i = 1; i < n; i++) {
      const dx = pts[2 * i] - x0, dy = pts[2 * i + 1] - y0;
      const d2 = dx * dx + dy * dy;
      if (d2 > best) {
        best = d2;
        far = i;
      }
    }
    const first = Float64Array.from(pts.slice(0, 2 * (far + 1)));
    const second = new Float64Array(2 * (n - far + 1));
    second.set(pts.slice(2 * far));
    second[second.length - 2] = x0;
    second[second.length - 1] = y0;
    const s1 = simplifyOpen(first, tol);
    const s2 = simplifyOpen(second, tol);
    const out = new Float64Array(s1.length + s2.length - 4);
    out.set(s1);
    out.set(s2.subarray(2, s2.length - 2), s1.length);
    return out;
  }

  /** Area con segno (pixel²). */
  function polygonArea(pts) {
    const n = pts.length / 2;
    let a = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      a += pts[2 * j] * pts[2 * i + 1] - pts[2 * i] * pts[2 * j + 1];
    }
    return a / 2;
  }

  function pathLength(pts, closed) {
    const n = pts.length / 2;
    let len = 0;
    for (let i = 1; i < n; i++) {
      len += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    }
    if (closed && n > 1) len += Math.hypot(pts[0] - pts[2 * n - 2], pts[1] - pts[2 * n - 1]);
    return len;
  }

  NS.smoothPath = smoothPath;
  NS.simplifyOpen = simplifyOpen;
  NS.simplifyClosed = simplifyClosed;
  NS.polygonArea = polygonArea;
  NS.pathLength = pathLength;
})(typeof window !== 'undefined' ? window : globalThis);
