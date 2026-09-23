/*
 * SINGOLA LINEA: linea centrale dei tratti.
 *
 * 1. Assottigliamento Zhang–Suen fino a uno scheletro largo 1 pixel.
 * 2. Rimozione dei pixel "a scalino" ridondanti (scheletro 8-connesso pulito).
 * 3. Lo scheletro diventa un grafo: nodi = estremità e incroci, archi = percorsi.
 * 4. Taglio dei rametti corti (spur).
 * 5. Agli incroci i rami che proseguono dritti vengono uniti con un raccordo
 *    morbido, così i vettori restano lunghi e continui (vedi resolveJunctions).
 * 6. Le estremità libere possono essere prolungate fino alla punta del tratto.
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

    return resolveJunctions(paths, centers, C, bin, w, h, !!(opts && opts.extendEnds));
  }

  // ------------------------------------------------------------------ incroci

  const hypot = Math.hypot;

  /** Curva di Hermite da p0 a p1 con tangenti m0, m1: restituisce i punti interni. */
  function hermite(p0x, p0y, m0x, m0y, p1x, p1y, m1x, m1y) {
    const L = hypot(p1x - p0x, p1y - p0y);
    const n = Math.max(2, Math.ceil(L));
    const out = [];
    for (let k = 1; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push(h00 * p0x + h10 * m0x + h01 * p1x + h11 * m1x, h00 * p0y + h10 * m0y + h01 * p1y + h11 * m1y);
    }
    return out;
  }

  function reversedPairs(a) {
    const out = new Array(a.length);
    for (let i = 0, n = a.length / 2; i < n; i++) {
      out[2 * i] = a[2 * (n - 1 - i)];
      out[2 * i + 1] = a[2 * (n - 1 - i) + 1];
    }
    return out;
  }

  /**
   * Vicino agli incroci lo scheletro si deforma (i rami "cadono" verso il centro).
   * Qui si tagliano i rami entro il raggio dell'incrocio, si accoppiano i rami che
   * proseguono dritti (come la penna che scrive) raccordandoli con una curva morbida,
   * e i rami rimasti soli vengono raccordati al tratto più vicino. Infine si
   * concatenano i tratti in vettori lunghi e continui.
   */
  function resolveJunctions(paths, centers, C, bin, w, h, extendEnds) {
    const dt = NS.distanceTransform(bin, w, h);
    const radiusAt = (x, y) => {
      const ix = Math.min(w - 1, Math.max(0, Math.floor(x)));
      const iy = Math.min(h - 1, Math.max(0, Math.floor(y)));
      return dt[iy * w + ix];
    };
    const inside = (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      return ix >= 0 && iy >= 0 && ix < w && iy < h && bin[iy * w + ix] === 1;
    };

    // Due strade che si incrociano di sbieco danno due incroci vicini uniti da un
    // tratto cortissimo: si fondono in un solo incrocio.
    const parent = new Int32Array(C).map((_, i) => i);
    const find = (x) => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    };
    const shortLinks = [];
    paths.forEach((p, i) => {
      if (!p.alive || p.closed || p.a >= C || p.b >= C) return;
      const len = NS.pathLength(p.pts, false);
      const r = Math.max(radiusAt(centers[2 * p.a], centers[2 * p.a + 1]), radiusAt(centers[2 * p.b], centers[2 * p.b + 1]));
      if (len < 1.5 * r + 2) shortLinks.push({ i, len });
    });
    shortLinks.sort((x, y) => x.len - y.len);
    for (const { i } of shortLinks) {
      const p = paths[i];
      p.alive = false;
      parent[find(p.a)] = find(p.b);
    }
    // centro ed estensione di ogni incrocio fuso
    const members = new Map();
    for (let c = 0; c < C; c++) {
      const r = find(c);
      if (!members.has(r)) members.set(r, []);
      members.get(r).push(c);
    }
    const nodeX = new Float64Array(C), nodeY = new Float64Array(C), nodeR = new Float64Array(C);
    members.forEach((list, r) => {
      let sx = 0, sy = 0;
      for (const c of list) {
        sx += centers[2 * c];
        sy += centers[2 * c + 1];
      }
      const x = sx / list.length, y = sy / list.length;
      let ext = radiusAt(x, y);
      for (const c of list) {
        ext = Math.max(ext, hypot(centers[2 * c] - x, centers[2 * c + 1] - y) + radiusAt(centers[2 * c], centers[2 * c + 1]));
      }
      nodeX[r] = x;
      nodeY[r] = y;
      nodeR[r] = ext;
    });

    const open = [];
    paths.forEach((p, i) => {
      if (!p.alive || p.closed) return;
      if (p.a < C) p.a = find(p.a);
      if (p.b < C) p.b = find(p.b);
      open.push(i);
    });

    // Estremità di ogni nodo di incrocio
    const ends = new Map();
    const addEnd = (node, i, end) => {
      if (node >= C || node < 0) return;
      let l = ends.get(node);
      if (!l) ends.set(node, (l = []));
      l.push({ i, end });
    };
    for (const i of open) {
      addEnd(paths[i].a, i, 0);
      addEnd(paths[i].b, i, 1);
    }

    // 1) Taglio dei tratti deformati vicino agli incroci
    const S = new Int32Array(paths.length), E = new Int32Array(paths.length);
    for (const i of open) {
      S[i] = 0;
      E[i] = paths[i].pts.length / 2 - 1;
    }
    const nodeTrim = new Map();
    ends.forEach((list, node) => {
      if (list.length < 2) return;
      const cx = nodeX[node], cy = nodeY[node];
      const trim = Math.max(2, 1.2 * nodeR[node]);
      nodeTrim.set(node, trim);
      for (const { i, end } of list) {
        const pts = paths[i].pts, n = pts.length / 2;
        if (end === 0) {
          let k = 0;
          while (k < n - 1 && hypot(pts[2 * k] - cx, pts[2 * k + 1] - cy) < trim) k++;
          S[i] = Math.max(S[i], k);
        } else {
          let k = n - 1;
          while (k > 0 && hypot(pts[2 * k] - cx, pts[2 * k + 1] - cy) < trim) k--;
          E[i] = Math.min(E[i], k);
        }
      }
    });
    for (const i of open) {
      if (E[i] - S[i] >= 1) continue;
      const n = paths[i].pts.length / 2;
      const mid = Math.max(0, Math.min(n - 2, Math.floor((S[i] + E[i]) / 2)));
      S[i] = mid;
      E[i] = mid + 1;
    }

    // Punto finale (dopo il taglio) e direzione uscente dall'incrocio di un'estremità
    function endInfo(i, end, reach) {
      const pts = paths[i].pts;
      const k0 = end === 0 ? S[i] : E[i];
      const step = end === 0 ? 1 : -1;
      const limit = end === 0 ? E[i] : S[i];
      const x = pts[2 * k0], y = pts[2 * k0 + 1];
      let k = k0, fx = x, fy = y;
      while (k !== limit && hypot(fx - x, fy - y) < reach) {
        k += step;
        fx = pts[2 * k];
        fy = pts[2 * k + 1];
      }
      let dx = fx - x, dy = fy - y;
      const l = hypot(dx, dy) || 1;
      return { x, y, dx: dx / l, dy: dy / l };
    }

    // 2) Accoppiamento dei rami per continuità di direzione e raccordi
    const link = new Map(); // chiave estremità -> {to, pts}
    const tail = new Map(); // chiave estremità -> punti di raccordo verso l'incrocio
    const key = (i, end) => i * 2 + end;
    ends.forEach((list, node) => {
      if (list.length < 2) return;
      const cx = nodeX[node], cy = nodeY[node];
      const reach = Math.max(3, nodeTrim.get(node));
      const info = list.map(({ i, end }) => Object.assign({ i, end, paired: false }, endInfo(i, end, reach)));
      const pairs = [];
      for (let u = 0; u < info.length; u++) {
        for (let v = u + 1; v < info.length; v++) {
          pairs.push({ u, v, dot: info[u].dx * info[v].dx + info[u].dy * info[v].dy });
        }
      }
      pairs.sort((a, b) => a.dot - b.dot);
      const bridges = [];
      for (const { u, v, dot } of pairs) {
        const A = info[u], B = info[v];
        if (A.paired || B.paired) continue;
        if (info.length > 2 && dot > -0.35) break; // svolta oltre ~70°: non è lo stesso tratto
        A.paired = B.paired = true;
        const L = hypot(B.x - A.x, B.y - A.y);
        const pts = hermite(A.x, A.y, -A.dx * L, -A.dy * L, B.x, B.y, B.dx * L, B.dy * L);
        link.set(key(A.i, A.end), { to: key(B.i, B.end), pts });
        link.set(key(B.i, B.end), { to: key(A.i, A.end), pts: reversedPairs(pts) });
        bridges.push([A.x, A.y].concat(pts, [B.x, B.y]));
      }
      for (const A of info) {
        if (A.paired) continue;
        let tx = cx, ty = cy, best = Infinity;
        for (const b of bridges) {
          for (let k = 0; k < b.length; k += 2) {
            const d = hypot(b[k] - A.x, b[k + 1] - A.y);
            if (d < best) {
              best = d;
              tx = b[k];
              ty = b[k + 1];
            }
          }
        }
        const L = hypot(tx - A.x, ty - A.y);
        const pts = hermite(A.x, A.y, -A.dx * L * 0.5, -A.dy * L * 0.5, tx, ty, tx - A.x, ty - A.y);
        pts.push(tx, ty);
        tail.set(key(A.i, A.end), pts);
      }
    });

    // Prolunga un'estremità libera lungo la sua direzione fino al bordo del tratto
    function extend(out, atStart) {
      const n = out.length / 2;
      if (n < 2) return;
      const k0 = atStart ? 0 : n - 1;
      const x = out[2 * k0], y = out[2 * k0 + 1];
      const r = radiusAt(x, y);
      const reach = Math.max(3, r);
      let k = k0, fx = x, fy = y;
      while (k !== (atStart ? n - 1 : 0) && hypot(fx - x, fy - y) < reach) {
        k += atStart ? 1 : -1;
        fx = out[2 * k];
        fy = out[2 * k + 1];
      }
      const l = hypot(x - fx, y - fy);
      if (l < 1) return;
      const ux = (x - fx) / l, uy = (y - fy) / l;
      const maxLen = 2 * r + 2;
      let last = 0;
      for (let t = 0.5; t <= maxLen && inside(x + ux * t, y + uy * t); t += 0.5) last = t;
      if (last < 1) return;
      const ex = x + ux * last, ey = y + uy * last;
      if (atStart) out.unshift(ex, ey);
      else out.push(ex, ey);
    }

    // 3) Concatenazione dei tratti in vettori continui
    const used = new Uint8Array(paths.length);
    const out = [];
    const appendPath = (dst, i, reversed) => {
      const pts = paths[i].pts;
      if (!reversed) for (let k = S[i]; k <= E[i]; k++) dst.push(pts[2 * k], pts[2 * k + 1]);
      else for (let k = E[i]; k >= S[i]; k--) dst.push(pts[2 * k], pts[2 * k + 1]);
    };
    for (const i0 of open) {
      if (used[i0]) continue;
      // risale all'inizio della catena
      let i = i0, entry = 0, cyclic = false;
      for (let guard = 0; ; guard++) {
        const L = link.get(key(i, entry));
        if (!L) break;
        const j = L.to >> 1, jEntry = 1 - (L.to & 1);
        if ((j === i0 && jEntry === 0) || guard > open.length * 2) {
          cyclic = true;
          break;
        }
        i = j;
        entry = jEntry;
      }
      if (cyclic) {
        i = i0;
        entry = 0;
      }
      const pts = [];
      const headTail = cyclic ? null : tail.get(key(i, entry));
      if (headTail) pts.push(...reversedPairs(headTail));
      const freeStart = !cyclic && !headTail;
      let ci = i, ce = entry, freeEnd = false, closed = false;
      for (;;) {
        used[ci] = 1;
        appendPath(pts, ci, ce === 1);
        const exit = 1 - ce;
        const L = link.get(key(ci, exit));
        if (!L) {
          const t = tail.get(key(ci, exit));
          if (t) pts.push(...t);
          else freeEnd = true;
          break;
        }
        pts.push(...L.pts);
        const j = L.to >> 1, jEntry = L.to & 1;
        if (j === i && jEntry === entry) {
          closed = true;
          break;
        }
        if (used[j]) break;
        ci = j;
        ce = jEntry;
      }
      if (extendEnds) {
        if (freeStart) extend(pts, true);
        if (freeEnd) extend(pts, false);
      }
      if (pts.length >= 4) out.push({ pts: Float64Array.from(pts), closed });
    }
    // anelli senza incroci
    for (const p of paths) {
      if (p.alive && p.closed && p.pts.length >= 6) out.push({ pts: Float64Array.from(p.pts), closed: true });
    }
    return out;
  }

  NS.skeletonize = skeletonize;
  NS.traceCenterlines = traceCenterlines;
})(typeof window !== 'undefined' ? window : globalThis);
