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

  /** Ricampiona il percorso con punti equidistanti (passo in pixel). */
  function resample(pts, closed, step) {
    const n = pts.length / 2;
    if (n < 2) return Float64Array.from(pts);
    const m = closed ? n + 1 : n;
    const px = (i) => pts[2 * (i % n)], py = (i) => pts[2 * (i % n) + 1];
    const out = [pts[0], pts[1]];
    let ax = pts[0], ay = pts[1], acc = 0;
    for (let i = 1; i < m; i++) {
      const bx = px(i), by = py(i);
      let seg = Math.hypot(bx - ax, by - ay);
      while (acc + seg >= step && seg > 0) {
        const t = (step - acc) / seg;
        ax += (bx - ax) * t;
        ay += (by - ay) * t;
        out.push(ax, ay);
        seg = Math.hypot(bx - ax, by - ay);
        acc = 0;
      }
      acc += seg;
      ax = bx;
      ay = by;
    }
    if (!closed) {
      // l'ultimo punto resta esattamente dov'era
      if (acc < step * 0.3 && out.length > 2) out.length -= 2;
      out.push(pts[2 * n - 2], pts[2 * n - 1]);
    } else if (acc < step * 0.3 && out.length > 6) {
      out.length -= 2;
    }
    return Float64Array.from(out);
  }

  /**
   * Levigatura gaussiana lungo il percorso (sigma in punti). Sui percorsi aperti
   * gli estremi restano fermi grazie alla riflessione puntuale.
   */
  function gaussianSmooth(pts, closed, sigma) {
    const n = pts.length / 2;
    if (n < 3 || sigma <= 0) return Float64Array.from(pts);
    if (closed) sigma = Math.min(sigma, n / 6);
    const rad = Math.ceil(3 * sigma);
    const wts = new Float64Array(rad + 1);
    for (let k = 0; k <= rad; k++) wts[k] = Math.exp((-k * k) / (2 * sigma * sigma));
    const x0 = pts[0], y0 = pts[1], xn = pts[2 * n - 2], yn = pts[2 * n - 1];
    const out = new Float64Array(pts.length);
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sw = 0;
      for (let k = -rad; k <= rad; k++) {
        const w = wts[k < 0 ? -k : k];
        let j = i + k, x, y;
        if (closed) {
          j = ((j % n) + n) % n;
          x = pts[2 * j];
          y = pts[2 * j + 1];
        } else if (j < 0) {
          const r = Math.min(-j, n - 1);
          x = 2 * x0 - pts[2 * r];
          y = 2 * y0 - pts[2 * r + 1];
        } else if (j > n - 1) {
          const r = Math.max(2 * (n - 1) - j, 0);
          x = 2 * xn - pts[2 * r];
          y = 2 * yn - pts[2 * r + 1];
        } else {
          x = pts[2 * j];
          y = pts[2 * j + 1];
        }
        sx += w * x;
        sy += w * y;
        sw += w;
      }
      out[2 * i] = sx / sw;
      out[2 * i + 1] = sy / sw;
    }
    return out;
  }

  // ------------------------------------------------------------------ archi
  //
  // Un arco è descritto come nei DXF: punto iniziale, punto finale e "bulge"
  // (tangente di un quarto dell'angolo al centro, con segno). Il segno qui è
  // riferito alle coordinate dell'immagine (y verso il basso).

  /** Punti lungo l'arco da (ax, ay) a (bx, by) con il bulge dato (esclusi gli estremi). */
  function arcPoints(ax, ay, bx, by, bulge, maxStep) {
    const out = [];
    if (Math.abs(bulge) < 1e-9) return out;
    const theta = 4 * Math.atan(bulge);
    const cx0 = bx - ax, cy0 = by - ay;
    const L = Math.hypot(cx0, cy0);
    if (L < 1e-12) return out;
    const alpha = theta / 2;
    // tangente iniziale = corda ruotata di -alpha
    const ca = Math.cos(-alpha), sa = Math.sin(-alpha);
    const tx = (cx0 * ca - cy0 * sa) / L, ty = (cx0 * sa + cy0 * ca) / L;
    const R = L / (2 * Math.abs(Math.sin(alpha)));
    const sgn = theta > 0 ? 1 : -1;
    const ccx = ax - ty * R * sgn, ccy = ay + tx * R * sgn;
    const rx = ax - ccx, ry = ay - ccy;
    const segs = Math.max(2, Math.ceil((Math.abs(theta) * R) / (maxStep || 2)), Math.ceil(Math.abs(theta) / 0.2));
    for (let k = 1; k < segs; k++) {
      const a = (theta * k) / segs, c = Math.cos(a), s = Math.sin(a);
      out.push(ccx + rx * c - ry * s, ccy + rx * s + ry * c);
    }
    return out;
  }

  /** Bulge dell'arco che parte da a con tangente (tx, ty) e arriva in b. */
  function bulgeFromStart(ax, ay, tx, ty, bx, by) {
    const cx = bx - ax, cy = by - ay;
    const alpha = Math.atan2(tx * cy - ty * cx, tx * cx + ty * cy);
    return Math.tan(alpha / 2);
  }

  /** Biarco tra (p1, t1) e (p2, t2) con tangenti unitarie: [xm, ym, bulge1, bulge2] o null. */
  function biarc(x1, y1, t1x, t1y, x2, y2, t2x, t2y) {
    const vx = x2 - x1, vy = y2 - y1;
    const vv = vx * vx + vy * vy;
    if (vv < 1e-12) return null;
    const tx = t1x + t2x, ty = t1y + t2y;
    const vt = vx * tx + vy * ty;
    const denom = 2 * (1 - (t1x * t2x + t1y * t2y));
    let d;
    if (denom < 1e-9) {
      const vt2 = vx * t2x + vy * t2y;
      if (Math.abs(vt2) < 1e-9) return null;
      d = vv / (4 * vt2);
    } else {
      d = (-vt + Math.sqrt(vt * vt + denom * vv)) / denom;
    }
    if (!(d > 0) || !isFinite(d)) return null;
    const xm = (x1 + d * t1x + x2 - d * t2x) / 2;
    const ym = (y1 + d * t1y + y2 - d * t2y) / 2;
    const b1 = bulgeFromStart(x1, y1, t1x, t1y, xm, ym);
    // il secondo arco si calcola al contrario (da p2 con tangente -t2) e poi si inverte
    const b2 = -bulgeFromStart(x2, y2, -t2x, -t2y, xm, ym);
    if (Math.abs(b1) > 1 || Math.abs(b2) > 1) return null; // oltre la semicirconferenza
    return [xm, ym, b1, b2];
  }

  function distToPolyline(px, py, poly) {
    let best = Infinity;
    for (let k = 0; k + 3 < poly.length; k += 2) {
      const ax = poly[k], ay = poly[k + 1];
      const dx = poly[k + 2] - ax, dy = poly[k + 3] - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /**
   * Approssima un percorso denso con archi raccordati (biarchi): curve lisce,
   * con tangente continua, entro la tolleranza data (pixel).
   * Ritorna {pts, bulges, closed}: bulges[i] è l'arco dal vertice i al successivo.
   */
  function fitArcs(pts, closed, tol) {
    let n0 = pts.length / 2;
    if (n0 < 3) return { pts: Float64Array.from(pts), bulges: new Float64Array(n0), closed };
    const P = closed ? Float64Array.from([...pts, pts[0], pts[1]]) : pts;
    const n = P.length / 2;
    // tangenti per differenze centrali
    const T = new Float64Array(2 * n);
    const K = 2;
    for (let i = 0; i < n; i++) {
      let a, b;
      if (closed) {
        a = (((i - K) % n0) + n0) % n0;
        b = (i + K) % n0;
      } else {
        a = Math.max(0, i - K);
        b = Math.min(n - 1, i + K);
      }
      let dx = P[2 * b] - P[2 * a], dy = P[2 * b + 1] - P[2 * a + 1];
      const l = Math.hypot(dx, dy) || 1;
      T[2 * i] = dx / l;
      T[2 * i + 1] = dy / l;
    }
    const V = [P[0], P[1]], B = [];
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [i, j] = stack.pop();
      const fit = biarc(P[2 * i], P[2 * i + 1], T[2 * i], T[2 * i + 1], P[2 * j], P[2 * j + 1], T[2 * j], T[2 * j + 1]);
      let ok = !!fit;
      if (ok && j - i > 1) {
        const poly = [P[2 * i], P[2 * i + 1]];
        poly.push(...arcPoints(P[2 * i], P[2 * i + 1], fit[0], fit[1], fit[2], 1));
        poly.push(fit[0], fit[1]);
        poly.push(...arcPoints(fit[0], fit[1], P[2 * j], P[2 * j + 1], fit[3], 1));
        poly.push(P[2 * j], P[2 * j + 1]);
        for (let k = i + 1; k < j && ok; k++) {
          if (distToPolyline(P[2 * k], P[2 * k + 1], poly) > tol) ok = false;
        }
      }
      if (ok) {
        B.push(fit[2], fit[3]);
        V.push(fit[0], fit[1], P[2 * j], P[2 * j + 1]);
      } else if (j - i <= 1) {
        B.push(0);
        V.push(P[2 * j], P[2 * j + 1]);
      } else {
        const m = (i + j) >> 1;
        // in pila prima la seconda metà, così si elabora prima la prima
        stack.push([m, j], [i, m]);
      }
    }
    if (closed) {
      V.length -= 2; // l'ultimo vertice coincide con il primo
    } else {
      B.push(0);
    }
    return { pts: Float64Array.from(V), bulges: Float64Array.from(B), closed };
  }

  /** Converte un percorso con archi in una polilinea densa (per l'anteprima). */
  function flattenPath(p, maxStep) {
    if (!p.bulges) return p.pts;
    const v = p.pts, n = v.length / 2, out = [v[0], v[1]];
    const segs = p.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      out.push(...arcPoints(v[2 * i], v[2 * i + 1], v[2 * j], v[2 * j + 1], p.bulges[i], maxStep));
      if (j !== 0 || !p.closed) out.push(v[2 * j], v[2 * j + 1]);
    }
    return out;
  }

  NS.resample = resample;
  NS.gaussianSmooth = gaussianSmooth;
  NS.fitArcs = fitArcs;
  NS.arcPoints = arcPoints;
  NS.flattenPath = flattenPath;
  NS.smoothPath = smoothPath;
  NS.simplifyOpen = simplifyOpen;
  NS.simplifyClosed = simplifyClosed;
  NS.polygonArea = polygonArea;
  NS.pathLength = pathLength;
})(typeof window !== 'undefined' ? window : globalThis);
