/*
 * Elaborazione raster: scala di grigi, sfocatura, soglia (Otsu), pulizia macchie.
 */
(function (root) {
  'use strict';
  const NS = (root.ToDxf = root.ToDxf || {});

  /** RGBA -> luminanza 0..255; la trasparenza viene composta su bianco. */
  function toGray(rgba, w, h) {
    const n = w * h;
    const out = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const a = rgba[p + 3] / 255;
      const l = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
      out[i] = l * a + 255 * (1 - a);
    }
    return out;
  }

  function boxBlurPass(src, dst, w, h, r, horizontal) {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const step = horizontal ? 1 : w;
    const lineStep = horizontal ? w : 1;
    const norm = 1 / (2 * r + 1);
    const last = len - 1;
    for (let l = 0; l < lines; l++) {
      const base = l * lineStep;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[base + Math.min(Math.max(k, 0), last) * step];
      for (let i = 0; i < len; i++) {
        dst[base + i * step] = sum * norm;
        const add = Math.min(i + r + 1, last);
        const rem = Math.max(i - r, 0);
        sum += src[base + add * step] - src[base + rem * step];
      }
    }
  }

  /** Sfocatura quasi-gaussiana (3 passate di box blur) con raggio intero r. */
  function blur(gray, w, h, r) {
    r = Math.round(r);
    if (r <= 0) return gray;
    let a = Float32Array.from(gray);
    let b = new Float32Array(a.length);
    for (let pass = 0; pass < 3; pass++) {
      boxBlurPass(a, b, w, h, r, true);
      boxBlurPass(b, a, w, h, r, false);
    }
    return a;
  }

  /** Soglia automatica con il metodo di Otsu. */
  function otsu(gray) {
    const hist = new Float64Array(256);
    for (let i = 0; i < gray.length; i++) {
      const v = gray[i];
      hist[v < 0 ? 0 : v > 255 ? 255 : Math.round(v)]++;
    }
    const total = gray.length;
    let sumAll = 0;
    for (let t = 0; t < 256; t++) sumAll += t * hist[t];
    let sumB = 0, wB = 0, best = -1, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) {
        best = between;
        threshold = t + 0.5;
      }
    }
    return threshold;
  }

  /**
   * Campo con segno: > 0 dove il pixel è "disegno" (primo piano).
   * Normalmente il disegno è scuro su fondo chiaro; con invert il contrario.
   */
  function signedField(gray, threshold, invert) {
    const out = new Float32Array(gray.length);
    for (let i = 0; i < gray.length; i++) out[i] = invert ? gray[i] - threshold : threshold - gray[i];
    return out;
  }

  function binarize(gray, threshold, invert) {
    const out = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) {
      out[i] = (invert ? gray[i] - threshold : threshold - gray[i]) > 0 ? 1 : 0;
    }
    return out;
  }

  /**
   * Rimuove le macchie di disegno più piccole di minArea pixel e chiude
   * i buchi interni più piccoli di minArea pixel.
   */
  function despeckle(bin, w, h, minArea) {
    if (minArea <= 0) return bin;
    const n = w * h;
    const out = bin.slice();
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    const comp = new Int32Array(n);
    for (let start = 0; start < n; start++) {
      if (seen[start]) continue;
      const val = bin[start];
      let sp = 0, cn = 0, border = false;
      stack[sp++] = start;
      seen[start] = 1;
      while (sp > 0) {
        const k = stack[--sp];
        comp[cn++] = k;
        const x = k % w, y = (k - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        // disegno: 8-connesso; fondo: 4-connesso
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (!val && dx !== 0 && dy !== 0) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (!seen[q] && bin[q] === val) {
              seen[q] = 1;
              stack[sp++] = q;
            }
          }
        }
      }
      if (cn < minArea && (val === 1 || !border)) {
        const nv = val ? 0 : 1;
        for (let i = 0; i < cn; i++) out[comp[i]] = nv;
      }
    }
    return out;
  }

  /** Distanza (pixel, chamfer 1/√2) di ogni pixel di disegno dal fondo più vicino. */
  function distanceTransform(bin, w, h) {
    const D = Math.SQRT2;
    const d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = bin[i] ? 1e9 : 0;
    // fuori dall'immagine è fondo: distanza 0
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (!d[k]) continue;
        d[k] = Math.min(d[k], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + D, at(x + 1, y - 1) + D);
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const k = y * w + x;
        if (!d[k]) continue;
        d[k] = Math.min(d[k], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + D, at(x - 1, y + 1) + D);
      }
    }
    return d;
  }

  NS.distanceTransform = distanceTransform;
  NS.toGray = toGray;
  NS.blur = blur;
  NS.otsu = otsu;
  NS.signedField = signedField;
  NS.binarize = binarize;
  NS.despeckle = despeckle;
})(typeof window !== 'undefined' ? window : globalThis);
