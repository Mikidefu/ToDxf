/*
 * DOPPIA LINEA: estrazione dei contorni chiusi con marching squares.
 *
 * Ogni cella è formata dai centri di 4 pixel. I segmenti sono orientati in modo
 * che il disegno stia sempre alla stessa mano, così ogni punto ha esattamente un
 * successore e i contorni si concatenano senza ambiguità. Nei casi a sella il
 * disegno è considerato 8-connesso. Se è disponibile il campo di grigio, il punto
 * di attraversamento viene interpolato (precisione sub-pixel).
 */
(function (root) {
  'use strict';
  const NS = (root.ToDxf = root.ToDxf || {});

  function traceContours(bin, w, h, field) {
    const W2 = w + 2, H2 = h + 2;
    const next = new Int32Array(W2 * H2 * 2).fill(-1);

    const v = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : bin[j * w + i]);
    const hKey = (i, j) => ((j + 1) * W2 + (i + 1)) * 2;
    const vKey = (i, j) => ((j + 1) * W2 + (i + 1)) * 2 + 1;

    for (let j = -1; j < h; j++) {
      for (let i = -1; i < w; i++) {
        const code = (v(i, j) << 3) | (v(i + 1, j) << 2) | (v(i + 1, j + 1) << 1) | v(i, j + 1);
        if (code === 0 || code === 15) continue;
        const T = hKey(i, j), B = hKey(i, j + 1), L = vKey(i, j), R = vKey(i + 1, j);
        switch (code) {
          case 1: next[L] = B; break;
          case 2: next[B] = R; break;
          case 3: next[L] = R; break;
          case 4: next[R] = T; break;
          case 5: next[L] = T; next[R] = B; break;
          case 6: next[B] = T; break;
          case 7: next[L] = T; break;
          case 8: next[T] = L; break;
          case 9: next[T] = B; break;
          case 10: next[T] = R; next[B] = L; break;
          case 11: next[T] = R; break;
          case 12: next[R] = L; break;
          case 13: next[R] = B; break;
          case 14: next[B] = L; break;
        }
      }
    }

    // Frazione (0..1) del punto di attraversamento tra il pixel a e il pixel b.
    function crossing(ia, ja, ib, jb) {
      if (!field || ia < 0 || ja < 0 || ib >= w || jb >= h) return 0.5;
      const ka = ja * w + ia, kb = jb * w + ib;
      const sa = field[ka], sb = field[kb];
      // usa l'interpolazione solo se il campo concorda con il binario (non ritoccato dalla pulizia)
      if ((sa > 0) !== (bin[ka] === 1) || (sb > 0) !== (bin[kb] === 1) || sa === sb) return 0.5;
      const t = sa / (sa - sb);
      return t < 0.05 ? 0.05 : t > 0.95 ? 0.95 : t;
    }

    const paths = [];
    for (let k0 = 0; k0 < next.length; k0++) {
      if (next[k0] < 0) continue;
      const pts = [];
      let k = k0;
      do {
        const idx = k >> 1;
        const ci = (idx % W2) - 1;
        const cj = ((idx / W2) | 0) - 1;
        if ((k & 1) === 0) {
          pts.push(ci + 0.5 + crossing(ci, cj, ci + 1, cj), cj + 0.5);
        } else {
          pts.push(ci + 0.5, cj + 0.5 + crossing(ci, cj, ci, cj + 1));
        }
        const nk = next[k];
        next[k] = -1;
        k = nk;
      } while (k >= 0 && k !== k0);
      if (pts.length >= 6) paths.push({ pts: Float64Array.from(pts), closed: true });
    }
    return paths;
  }

  NS.traceContours = traceContours;
})(typeof window !== 'undefined' ? window : globalThis);
