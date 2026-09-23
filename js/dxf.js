/*
 * Scrittura DXF R12 (AC1009): il formato più compatibile con ArtCAM 2016.
 * Unità: millimetri. Origine in basso a sinistra, asse Y verso l'alto.
 */
(function (root) {
  'use strict';
  const NS = (root.ToDxf = root.ToDxf || {});

  function num(v) {
    const r = Math.round(v * 10000) / 10000;
    return Object.is(r, -0) ? '0.0' : Number.isInteger(r) ? r.toFixed(1) : String(r);
  }

  /**
   * @param paths   [{pts: [x0,y0,...] in pixel, closed}]
   * @param options {scale: mm per pixel, height: altezza immagine in pixel, layer, color}
   */
  function buildDxf(paths, options) {
    const s = options.scale;
    const H = options.height;
    const layer = (options.layer || 'VETTORI').toUpperCase().replace(/[^A-Z0-9_\-$]/g, '_');
    const color = options.color || 7;
    const X = (x) => x * s;
    const Y = (y) => (H - y) * s;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of paths) {
      const flat = NS.flattenPath ? NS.flattenPath(p, 2) : p.pts;
      for (let i = 0; i < flat.length; i += 2) {
        const x = X(flat[i]), y = Y(flat[i + 1]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!isFinite(minX)) minX = minY = maxX = maxY = 0;

    const out = [];
    const g = (code, value) => out.push(String(code), String(value));

    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$INSBASE'); g(10, '0.0'); g(20, '0.0'); g(30, '0.0');
    g(9, '$EXTMIN'); g(10, num(minX)); g(20, num(minY)); g(30, '0.0');
    g(9, '$EXTMAX'); g(10, num(maxX)); g(20, num(maxY)); g(30, '0.0');
    g(9, '$LIMMIN'); g(10, '0.0'); g(20, '0.0');
    g(9, '$LIMMAX'); g(10, num(maxX)); g(20, num(maxY));
    g(9, '$MEASUREMENT'); g(70, 1);
    g(9, '$INSUNITS'); g(70, 4);
    g(0, 'ENDSEC');

    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, 2);
    g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
    g(0, 'LAYER'); g(2, layer); g(70, 0); g(62, color); g(6, 'CONTINUOUS');
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');

    g(0, 'SECTION'); g(2, 'BLOCKS'); g(0, 'ENDSEC');

    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const p of paths) {
      const n = p.pts.length / 2;
      if (n < 2) continue;
      g(0, 'POLYLINE'); g(8, layer); g(66, 1);
      g(10, '0.0'); g(20, '0.0'); g(30, '0.0');
      g(70, p.closed ? 1 : 0);
      for (let i = 0; i < n; i++) {
        g(0, 'VERTEX'); g(8, layer);
        g(10, num(X(p.pts[2 * i]))); g(20, num(Y(p.pts[2 * i + 1]))); g(30, '0.0');
        // bulge = arco verso il vertice successivo; l'asse Y ribaltato inverte il verso
        const b = p.bulges ? p.bulges[i] : 0;
        if (b && Math.abs(b) > 1e-7) g(42, (-b).toFixed(8).replace(/0+$/, '').replace(/\.$/, '.0'));
      }
      g(0, 'SEQEND'); g(8, layer);
    }
    g(0, 'ENDSEC');
    g(0, 'EOF');
    return out.join('\r\n') + '\r\n';
  }

  NS.buildDxf = buildDxf;
})(typeof window !== 'undefined' ? window : globalThis);
