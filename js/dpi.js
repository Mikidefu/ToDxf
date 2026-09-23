/*
 * Lettura dei DPI salvati nel file (PNG pHYs, JPEG JFIF/EXIF). Ritorna null se assenti.
 */
(function (root) {
  'use strict';
  const NS = (root.ToDxf = root.ToDxf || {});

  function ascii(b, start, len) {
    let s = '';
    for (let i = 0; i < len && start + i < b.length; i++) s += String.fromCharCode(b[start + i]);
    return s;
  }

  function fromPng(b, dv) {
    let p = 8;
    while (p + 12 <= b.length) {
      const len = dv.getUint32(p);
      const type = ascii(b, p + 4, 4);
      if (type === 'pHYs' && len >= 9) {
        const ppm = dv.getUint32(p + 8);
        return b[p + 16] === 1 && ppm > 0 ? Math.round(ppm * 0.0254) : null;
      }
      if (type === 'IDAT' || type === 'IEND') break;
      p += 12 + len;
    }
    return null;
  }

  function fromExif(dv, tiff) {
    const le = dv.getUint16(tiff) === 0x4949;
    const ifd = tiff + dv.getUint32(tiff + 4, le);
    const count = dv.getUint16(ifd, le);
    let res = null, unit = 2;
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      const tag = dv.getUint16(e, le);
      if (tag === 0x011a) {
        const o = tiff + dv.getUint32(e + 8, le);
        const den = dv.getUint32(o + 4, le);
        if (den) res = dv.getUint32(o, le) / den;
      } else if (tag === 0x0128) {
        unit = dv.getUint16(e + 8, le);
      }
    }
    if (!res) return null;
    if (unit === 3) return Math.round(res * 2.54);
    return unit === 2 ? Math.round(res) : null;
  }

  function fromJpeg(b, dv) {
    let p = 2, exif = null;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xff) break;
      const marker = b[p + 1];
      if (marker === 0xff) { p++; continue; }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
      if (marker === 0xda || marker === 0xd9) break;
      const len = dv.getUint16(p + 2);
      const seg = p + 4;
      if (marker === 0xe0 && ascii(b, seg, 5) === 'JFIF\0') {
        const units = b[seg + 7];
        const xd = dv.getUint16(seg + 8);
        if (units === 1 && xd > 0) return xd;
        if (units === 2 && xd > 0) return Math.round(xd * 2.54);
      } else if (marker === 0xe1 && ascii(b, seg, 6) === 'Exif\0\0' && exif === null) {
        try { exif = fromExif(dv, seg + 6); } catch (e) { exif = null; }
      }
      p += 2 + len;
    }
    return exif;
  }

  function detectDpi(buffer) {
    try {
      const b = new Uint8Array(buffer);
      const dv = new DataView(buffer);
      if (b.length > 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return fromPng(b, dv);
      if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) return fromJpeg(b, dv);
    } catch (e) {
      /* file troncato o anomalo: DPI sconosciuti */
    }
    return null;
  }

  NS.detectDpi = detectDpi;
})(typeof window !== 'undefined' ? window : globalThis);
