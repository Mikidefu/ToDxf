/*
 * Pipeline completa: immagine (ImageData) -> percorsi vettoriali in pixel.
 */
(function (root) {
  'use strict';
  const NS = (root.ToDxf = root.ToDxf || {});

  const DEFAULTS = {
    mode: 'outline', // 'outline' = doppia linea, 'centerline' = singola linea
    autoThreshold: true,
    threshold: 128,
    invert: false,
    blur: 1,
    despeckle: 20,
    smooth: 3,
    simplify: 0.5,
    prune: 10,
    extendEnds: true, // singola linea: prolunga le estremità fino alla punta del tratto
    curves: 'arcs', // 'arcs' = archi raccordati (curve lisce), 'lines' = polilinee
    minArea: 2,
  };

  function vectorize(imageData, options) {
    const o = Object.assign({}, DEFAULTS, options);
    const w = imageData.width, h = imageData.height;
    let gray = NS.toGray(imageData.data, w, h);
    if (o.blur > 0) gray = NS.blur(gray, w, h, o.blur);
    const threshold = o.autoThreshold ? NS.otsu(gray) : o.threshold;
    let bin = NS.binarize(gray, threshold, o.invert);
    if (o.despeckle > 0) bin = NS.despeckle(bin, w, h, o.despeckle);

    const centerline = o.mode === 'centerline';
    const raw = centerline
      ? NS.traceCenterlines(bin, w, h, { prune: o.prune, extendEnds: o.extendEnds })
      : NS.traceContours(bin, w, h, NS.signedField(gray, threshold, o.invert));

    const paths = [];
    let points = 0, arcs = 0;
    for (const p of raw) {
      let pts = p.pts;
      if (centerline) {
        // lo scheletro è "a gradini": ricampionamento e levigatura gaussiana lungo il tratto
        pts = NS.resample(pts, p.closed, 1);
        if (o.smooth > 0) pts = NS.gaussianSmooth(pts, p.closed, 0.5 + o.smooth * 0.9);
      } else if (o.smooth > 0) {
        pts = NS.smoothPath(pts, p.closed, Math.round(o.smooth * 3));
      }
      if (p.closed && !centerline && Math.abs(NS.polygonArea(pts)) < o.minArea) continue;

      let path;
      if (o.curves === 'arcs') {
        path = NS.fitArcs(NS.resample(pts, p.closed, 1), p.closed, Math.max(0.05, o.simplify));
        for (let i = 0; i < path.bulges.length; i++) if (path.bulges[i]) arcs++;
      } else {
        if (o.simplify > 0) pts = p.closed ? NS.simplifyClosed(pts, o.simplify) : NS.simplifyOpen(pts, o.simplify);
        path = { pts, closed: p.closed, bulges: null };
      }
      const n = path.pts.length / 2;
      if (n < 2) continue;
      paths.push(path);
      points += n;
    }
    return { paths, points, arcs, bin, threshold, width: w, height: h };
  }

  NS.VECTORIZE_DEFAULTS = DEFAULTS;
  NS.vectorize = vectorize;
})(typeof window !== 'undefined' ? window : globalThis);
