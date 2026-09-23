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

    const raw =
      o.mode === 'centerline'
        ? NS.traceCenterlines(bin, w, h, { prune: o.prune })
        : NS.traceContours(bin, w, h, NS.signedField(gray, threshold, o.invert));

    const paths = [];
    let points = 0;
    for (const p of raw) {
      let pts = p.pts;
      if (o.smooth > 0) pts = NS.smoothPath(pts, p.closed, Math.round(o.smooth * 3));
      if (o.simplify > 0) pts = p.closed ? NS.simplifyClosed(pts, o.simplify) : NS.simplifyOpen(pts, o.simplify);
      const n = pts.length / 2;
      if (p.closed ? n < 3 : n < 2) continue;
      if (p.closed && o.mode !== 'centerline' && Math.abs(NS.polygonArea(pts)) < o.minArea) continue;
      paths.push({ pts, closed: p.closed });
      points += n;
    }
    return { paths, points, bin, threshold, width: w, height: h };
  }

  NS.VECTORIZE_DEFAULTS = DEFAULTS;
  NS.vectorize = vectorize;
})(typeof window !== 'undefined' ? window : globalThis);
