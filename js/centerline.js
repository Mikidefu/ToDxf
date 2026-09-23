/*
 * SINGOLA LINEA: linea centrale dei tratti.
 *
 * 1. Assottigliamento Zhang–Suen fino a uno scheletro largo 1 pixel.
 * 2. Rimozione dei pixel "a scalino" ridondanti (scheletro 8-connesso pulito).
 * 3. Lo scheletro diventa un grafo: nodi = estremità e incroci, archi = percorsi.
 * 4. Taglio dei rametti corti (spur) e unione dei percorsi che si incontrano
 *    in un nodo con esattamente due rami, per avere vettori lunghi e continui.
 */
(function (root) {
  'use strict';
  const NS = (root.ToDxf = root.ToDxf || {});

  // Vicini in ordine: N, NE, E, SE, S, SO, O, NO
  const NB_DX = [0, 1, 1, 1, 0, -1, -1, -1];
  const NB_DY = [-1, -1, 0, 1, 1, 1, 0, -1];

  // Numero di componenti 8-connesse formate dai vicini accesi, per ogni maschera a 8 bit.
  const NB_COMPONENTS = (function () {
    const table = new Uint8Array(256);
    for (let m = 0; m < 256; m++) {
      let seen = 0, comps = 0;
      for (let i = 0; i < 8; i++) {
        if (!(m & (1 << i)) || seen & (1 << i)) continue;
        comps++;
        seen |= 1 << i;
        const stack = [i];
        while (stack.length) {
          const a = stack.pop();
          for (let b = 0; b < 8; b++) {
            if (!(m & (1 << b)) || seen & (1 << b)) continue;
            if (Math.abs(NB_DX[a] - NB_DX[b]) <= 1 && Math.abs(NB_DY[a] - NB_DY[b]) <= 1) {
              seen |= 1 << b;
              stack.push(b);
            }
          }
        }
      }
      table[m] = comps;
    }
    return table;
  })();

  /** Restituisce lo scheletro su una griglia con bordo di 1 pixel (larghezza w+2). */
  function skeletonize(bin, w, h) {
    const W = w + 2, H = h + 2;
    const img = new Uint8Array(W * H);
    const list = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!bin[y * w + x]) continue;
        const k = (y + 1) * W + x + 1;
        img[k] = 1;
        list.push(k);
      }
    }
    let pixels = Int32Array.from(list);
    const toDelete = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        toDelete.length = 0;
        for (let i = 0; i < pixels.length; i++) {
          const k = pixels[i];
          if (!img[k]) continue;
          const p2 = img[k - W], p3 = img[k - W + 1], p4 = img[k + 1], p5 = img[k + W + 1];
          const p6 = img[k + W], p7 = img[k + W - 1], p8 = img[k - 1], p9 = img[k - W - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const a =
            (p2 === 0 && p3 === 1) + (p3 === 0 && p4 === 1) + (p4 === 0 && p5 === 1) +
            (p5 === 0 && p6 === 1) + (p6 === 0 && p7 === 1) + (p7 === 0 && p8 === 1) +
            (p8 === 0 && p9 === 1) + (p9 === 0 && p2 === 1);
          if (a !== 1) continue;
          if (pass === 0) {
            if (p2 && p4 && p6) continue;
            if (p4 && p6 && p8) continue;
          } else {
            if (p2 && p4 && p8) continue;
            if (p2 && p6 && p8) continue;
          }
          toDelete.push(k);
        }
        for (let i = 0; i < toDelete.length; i++) img[toDelete[i]] = 0;
        if (toDelete.length) changed = true;
      }
      pixels = pixels.filter((k) => img[k]);
    }

    // Pulizia degli scalini: toglie i pixel d'angolo che non servono alla connessione.
    const off = NB_DX.map((dx, i) => dx + NB_DY[i] * W);
    for (let i = 0; i < pixels.length; i++) {
      const k = pixels[i];
      let m = 0, b = 0;
      for (let j = 0; j < 8; j++) {
        if (img[k + off[j]]) {
          m |= 1 << j;
          b++;
        }
      }
      if (b < 2) continue;
      const n = m & 1, e = m & 4, s = m & 16, o = m & 64;
      if (!((n && e) || (e && s) || (s && o) || (o && n))) continue;
      if (NB_COMPONENTS[m] !== 1) continue;
      img[k] = 0;
    }
    return { img, W, H, pixels: pixels.filter((k) => img[k]) };
  }

  function reversePath(p) {
    const src = p.pts, n = src.length / 2, out = new Array(src.length);
    for (let i = 0; i < n; i++) {
      out[2 * i] = src[2 * (n - 1 - i)];
      out[2 * i + 1] = src[2 * (n - 1 - i) + 1];
    }
    p.pts = out;
    const t = p.a;
    p.a = p.b;
    p.b = t;
  }

  function traceCenterlines(bin, w, h, opts) {
    const prune = (opts && opts.prune) || 0;
    const { img, W, pixels } = skeletonize(bin, w, h);
    const off = NB_DX.map((dx, i) => dx + NB_DY[i] * W);
    const cx = (k) => (k % W) - 0.5;
    const cy = (k) => Math.floor(k / W) - 0.5;

    const deg = new Uint8Array(img.length);
    for (let i = 0; i < pixels.length; i++) {
      const k = pixels[i];
      let d = 0;
      for (let j = 0; j < 8; j++) if (img[k + off[j]]) d++;
      deg[k] = d;
    }

    // Raggruppa i pixel di incrocio adiacenti in un unico nodo con centro medio.
    const cluster = new Int32Array(img.length).fill(-1);
    const centers = [];
    for (let i = 0; i < pixels.length; i++) {
      const k0 = pixels[i];
      if (deg[k0] < 3 || cluster[k0] >= 0) continue;
      const id = centers.length / 2;
      const stack = [k0];
      cluster[k0] = id;
      let sx = 0, sy = 0, cnt = 0;
      while (stack.length) {
        const k = stack.pop();
        sx += cx(k);
        sy += cy(k);
        cnt++;
        for (let j = 0; j < 8; j++) {
          const q = k + off[j];
          if (img[q] && deg[q] >= 3 && cluster[q] < 0) {
            cluster[q] = id;
            stack.push(q);
          }
        }
      }
      centers.push(sx / cnt, sy / cnt);
    }
    const C = centers.length / 2;
    let nextNode = C;

    const visited = new Uint8Array(img.length);
    const paths = [];

    // Segue lo scheletro finché non arriva a un incrocio (ritorna il suo id) o a un'estremità (-1).
    function follow(prev, cur, pts) {
      for (;;) {
        const c = cluster[cur];
        if (c >= 0) {
          pts.push(centers[2 * c], centers[2 * c + 1]);
          return c;
        }
        visited[cur] = 1;
        pts.push(cx(cur), cy(cur));
        let nxt = -1;
        for (let j = 0; j < 8; j++) {
          const q = cur + off[j];
          if (q === prev || !img[q]) continue;
          if (cluster[q] >= 0) {
            nxt = q;
            break;
          }
          if (!visited[q] && nxt < 0) nxt = q;
        }
        if (nxt < 0) return -1;
        prev = cur;
        cur = nxt;
      }
    }

    // 1) rami che partono dagli incroci
    for (let i = 0; i < pixels.length; i++) {
      const k = pixels[i];
      const c = cluster[k];
      if (c < 0) continue;
      for (let j = 0; j < 8; j++) {
        const q = k + off[j];
        if (!img[q] || cluster[q] >= 0 || visited[q]) continue;
        const pts = [centers[2 * c], centers[2 * c + 1]];
        let end = follow(k, q, pts);
        if (end < 0) end = nextNode++;
        paths.push({ pts, a: c, b: end, closed: false, alive: true });
      }
    }
    // 2) tratti isolati senza incroci (da estremità a estremità)
    for (let i = 0; i < pixels.length; i++) {
      const k = pixels[i];
      if (visited[k] || deg[k] !== 1) continue;
      visited[k] = 1;
      const pts = [cx(k), cy(k)];
      let q = -1;
      for (let j = 0; j < 8; j++) if (img[k + off[j]]) q = k + off[j];
      if (!visited[q]) follow(k, q, pts);
      paths.push({ pts, a: nextNode++, b: nextNode++, closed: false, alive: true });
    }
    // 3) anelli chiusi
    for (let i = 0; i < pixels.length; i++) {
      const k = pixels[i];
      if (visited[k] || deg[k] !== 2) continue;
      visited[k] = 1;
      const pts = [cx(k), cy(k)];
      let q = -1;
      for (let j = 0; j < 8 && q < 0; j++) if (img[k + off[j]]) q = k + off[j];
      follow(k, q, pts);
      if (pts.length >= 6) paths.push({ pts, a: -1, b: -1, closed: true, alive: true });
    }

    // Incidenza nodo -> percorsi
    const inc = new Map();
    const addInc = (node, pi) => {
      let l = inc.get(node);
      if (!l) inc.set(node, (l = []));
      l.push(pi);
    };
    const removeInc = (node, pi) => {
      const l = inc.get(node);
      const idx = l.indexOf(pi);
      if (idx >= 0) l.splice(idx, 1);
    };
    paths.forEach((p, i) => {
      if (p.closed) return;
      addInc(p.a, i);
      addInc(p.b, i);
    });
    const degreeOf = (node) => inc.get(node).length;

    // Taglio dei rametti corti, dal più corto al più lungo.
    if (prune > 0) {
      for (let guard = 0; guard < 20; guard++) {
        const cand = [];
        paths.forEach((p, i) => {
          if (!p.alive || p.closed) return;
          const len = NS.pathLength(p.pts, false);
          if (len < prune) cand.push({ i, len });
        });
        cand.sort((x, y) => x.len - y.len);
        let removed = 0;
        for (const { i } of cand) {
          const p = paths[i];
          const da = degreeOf(p.a), db = degreeOf(p.b);
          const selfLoop = p.a === p.b;
          const spur = (da === 1 && db >= 3) || (db === 1 && da >= 3);
          if (!spur && !selfLoop) continue;
          p.alive = false;
          removeInc(p.a, i);
          removeInc(p.b, i);
          removed++;
        }
        if (!removed) break;
      }
    }

    // Unione dei percorsi nei nodi con esattamente due rami.
    const queue = [];
    inc.forEach((_, node) => {
      if (node < C) queue.push(node);
    });
    while (queue.length) {
      const n = queue.pop();
      const list = inc.get(n);
      if (!list || list.length !== 2) continue;
      const i = list[0], j = list[1];
      inc.set(n, []);
      if (i === j) {
        paths[i].closed = true;
        continue;
      }
      const p = paths[i], q = paths[j];
      if (p.b !== n) reversePath(p);
      if (q.a !== n) reversePath(q);
      p.pts = p.pts.concat(q.pts.slice(2));
      p.b = q.b;
      q.alive = false;
      const other = inc.get(q.b);
      const idx = other.indexOf(j);
      if (idx >= 0) other[idx] = i;
      if (q.b < C) queue.push(q.b);
    }

    const out = [];
    for (const p of paths) {
      if (!p.alive) continue;
      let pts = p.pts;
      if (p.closed && pts.length >= 4) {
        const L = pts.length;
        if (Math.abs(pts[0] - pts[L - 2]) < 1e-9 && Math.abs(pts[1] - pts[L - 1]) < 1e-9) pts = pts.slice(0, L - 2);
      }
      if (pts.length < 4) continue;
      out.push({ pts: Float64Array.from(pts), closed: p.closed });
    }
    return out;
  }

  NS.skeletonize = skeletonize;
  NS.traceCenterlines = traceCenterlines;
})(typeof window !== 'undefined' ? window : globalThis);
