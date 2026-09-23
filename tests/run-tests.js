/* Test degli algoritmi con immagini sintetiche. Avvio: node tests/run-tests.js */
'use strict';
const path = require('path');
for (const f of ['imageproc', 'geometry', 'contour', 'centerline', 'vectorize', 'dxf', 'dpi']) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
}
const NS = globalThis.ToDxf;

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function near(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg}: atteso ${b} ± ${tol}, ottenuto ${a}`);
}

/** Crea un'immagine RGBA: dark(x, y) = true -> pixel nero. */
function makeImage(w, h, dark) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = dark(x + 0.5, y + 0.5) ? 0 : 255;
      const p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const base = { blur: 0, smooth: 2, simplify: 0.3, despeckle: 0 };
const flat = (p) => Float64Array.from(NS.flattenPath(p, 0.5));

console.log('Doppia linea (contorni)');
test('quadrato pieno -> 1 contorno chiuso con area corretta', () => {
  const img = makeImage(100, 100, (x, y) => x > 30 && x < 70 && y > 30 && y < 70);
  const r = NS.vectorize(img, { ...base, mode: 'outline' });
  assert(r.paths.length === 1, 'contorni: ' + r.paths.length);
  assert(r.paths[0].closed, 'deve essere chiuso');
  near(Math.abs(NS.polygonArea(flat(r.paths[0]))), 1600, 80, 'area');
});
test('anello -> 2 contorni (esterno + foro)', () => {
  const img = makeImage(100, 100, (x, y) => {
    const d = Math.hypot(x - 50, y - 50);
    return d < 30 && d > 15;
  });
  const r = NS.vectorize(img, { ...base, mode: 'outline' });
  assert(r.paths.length === 2, 'contorni: ' + r.paths.length);
  const areas = r.paths.map((p) => Math.abs(NS.polygonArea(flat(p)))).sort((a, b) => a - b);
  near(areas[0], Math.PI * 15 * 15, 60, 'area foro');
  near(areas[1], Math.PI * 30 * 30, 120, 'area esterna');
});
test('inverti: disegno chiaro su fondo scuro', () => {
  const img = makeImage(60, 60, (x, y) => !(x > 20 && x < 40 && y > 20 && y < 40));
  const r = NS.vectorize(img, { ...base, mode: 'outline', invert: true });
  assert(r.paths.length === 1, 'contorni: ' + r.paths.length);
  near(Math.abs(NS.polygonArea(flat(r.paths[0]))), 400, 40, 'area');
});
test('pulizia: le macchie piccole spariscono', () => {
  const img = makeImage(80, 80, (x, y) => (x > 20 && x < 60 && y > 20 && y < 60) || (x > 5 && x < 8 && y > 5 && y < 8));
  const r = NS.vectorize(img, { ...base, mode: 'outline', despeckle: 20 });
  assert(r.paths.length === 1, 'contorni: ' + r.paths.length);
});

console.log('Singola linea (centrale)');
test('barra orizzontale -> 1 linea aperta al centro', () => {
  const img = makeImage(100, 40, (x, y) => x > 10 && x < 90 && y > 16 && y < 24);
  const r = NS.vectorize(img, { ...base, mode: 'centerline', prune: 8 });
  assert(r.paths.length === 1, 'linee: ' + r.paths.length);
  const p = r.paths[0];
  assert(!p.closed, 'deve essere aperta');
  const f = flat(p);
  for (let i = 1; i < f.length; i += 2) near(f[i], 20, 1.5, 'y');
  near(NS.pathLength(flat(p)), 79, 3, 'lunghezza (prolungata fino alle punte)');
});
test('anello sottile -> 1 linea chiusa', () => {
  const img = makeImage(100, 100, (x, y) => {
    const d = Math.hypot(x - 50, y - 50);
    return d < 33 && d > 27;
  });
  const r = NS.vectorize(img, { ...base, mode: 'centerline', prune: 8 });
  assert(r.paths.length === 1, 'linee: ' + r.paths.length);
  assert(r.paths[0].closed, 'deve essere chiusa');
  near(NS.pathLength(flat(r.paths[0]), true), 2 * Math.PI * 30, 10, 'circonferenza');
});
test('lettera L -> 1 linea continua', () => {
  const img = makeImage(100, 100, (x, y) => (x > 20 && x < 28 && y > 10 && y < 90) || (x > 20 && x < 80 && y > 82 && y < 90));
  const r = NS.vectorize(img, { ...base, mode: 'centerline', prune: 10 });
  assert(r.paths.length === 1, 'linee: ' + r.paths.length);
});
test('lettera T -> barra intera + gambo che la tocca', () => {
  const img = makeImage(100, 100, (x, y) => (x > 10 && x < 90 && y > 10 && y < 18) || (x > 46 && x < 54 && y > 10 && y < 90));
  const r = NS.vectorize(img, { ...base, mode: 'centerline', prune: 10 });
  assert(r.paths.length === 2, 'linee: ' + r.paths.length);
  const [bar, stem] = r.paths.map(flat).sort((a, b) => Math.abs(a[1] - a[a.length - 1]) - Math.abs(b[1] - b[b.length - 1]));
  near(NS.pathLength(bar), 79, 4, 'barra');
  const top = Math.min(stem[1], stem[stem.length - 1]);
  near(top, 14, 1.5, 'il gambo arriva alla barra');
});

test('senza prolungamento la linea si ferma prima delle punte', () => {
  const img = makeImage(100, 40, (x, y) => x > 10 && x < 90 && y > 16 && y < 24);
  const r = NS.vectorize(img, { ...base, mode: 'centerline', prune: 8, extendEnds: false });
  assert(NS.pathLength(flat(r.paths[0])) < 76, 'lunghezza ' + NS.pathLength(flat(r.paths[0])));
});
test('incrocio a X -> 2 tratti continui che si attraversano', () => {
  const img = makeImage(120, 120, (x, y) => Math.abs(x - y) < 5 && x > 10 && x < 110 || Math.abs(x + y - 120) < 5 && x > 10 && x < 110);
  const r = NS.vectorize(img, { ...base, mode: 'centerline', prune: 10 });
  assert(r.paths.length === 2, 'linee: ' + r.paths.length);
  for (const p of r.paths) near(NS.pathLength(flat(p)), 100 * Math.SQRT2, 12, 'lunghezza diagonale');
});
test('curva liscia -> pochi archi, tutti entro la tolleranza', () => {
  const img = makeImage(200, 200, (x, y) => { const d = Math.hypot(x - 100, y - 100); return d < 83 && d > 77; });
  const r = NS.vectorize(img, { ...base, mode: 'centerline', simplify: 0.3 });
  assert(r.paths.length === 1 && r.paths[0].closed, 'un anello chiuso');
  assert(r.arcs > 0 && r.arcs <= 60, 'archi: ' + r.arcs);
  const f = flat(r.paths[0]);
  for (let i = 0; i < f.length; i += 2) near(Math.hypot(f[i] - 100, f[i + 1] - 100), 80, 1, 'raggio');
});
test('polilinee: nessun arco', () => {
  const img = makeImage(100, 100, (x, y) => { const d = Math.hypot(x - 50, y - 50); return d < 30 && d > 15; });
  const r = NS.vectorize(img, { ...base, mode: 'outline', curves: 'lines' });
  assert(r.paths.length === 2 && r.arcs === 0 && r.paths.every((p) => !p.bulges), 'solo polilinee');
});

console.log('DXF');
test('DXF con archi: bulge scritti e verso corretto (asse Y ribaltato)', () => {
  const img = makeImage(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 30);
  const r = NS.vectorize(img, { ...base, mode: 'outline' });
  const lines = NS.buildDxf(r.paths, { scale: 1, height: 100 }).split('\r\n');
  const verts = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    if (lines[i] === '0' && lines[i + 1] === 'VERTEX') verts.push({ x: +lines[i + 5], y: +lines[i + 7], b: 0 });
    if (lines[i] === '42') verts[verts.length - 1].b = +lines[i + 1];
  }
  assert(verts.some((v) => v.b !== 0), 'nessun bulge');
  // ricostruisce il cerchio dai bulge in coordinate DXF e ne controlla il raggio
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const mid = NS.arcPoints(a.x, a.y, b.x, b.y, a.b, 100);
    for (let k = 0; k < mid.length; k += 2) near(Math.hypot(mid[k] - 50, mid[k + 1] - 50), 30, 1, 'raggio in DXF');
  }
});
test('DXF R12 valido con unità e coordinate in mm', () => {
  const img = makeImage(100, 50, (x, y) => x > 10 && x < 90 && y > 10 && y < 40);
  const r = NS.vectorize(img, { ...base, mode: 'outline' });
  const dxf = NS.buildDxf(r.paths, { scale: 2, height: 50, layer: 'doppia linea' });
  const lines = dxf.split('\r\n');
  assert(lines.includes('AC1009'), 'versione');
  assert(lines.includes('DOPPIA_LINEA'), 'layer normalizzato');
  assert(lines.filter((l) => l === 'POLYLINE').length === r.paths.length, 'polilinee');
  assert(lines.filter((l) => l === 'SEQEND').length === r.paths.length, 'seqend');
  assert(lines[lines.length - 2] === 'EOF', 'EOF');
  const xs = [], ys = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    if (lines[i] === '10' && lines[i + 1] !== '0.0') xs.push(+lines[i + 1]);
    if (lines[i] === '20' && lines[i + 1] !== '0.0') ys.push(+lines[i + 1]);
  }
  near(Math.min(...xs), 20, 1.5, 'x min mm');
  near(Math.max(...xs), 180, 1.5, 'x max mm');
  near(Math.min(...ys), 20, 1.5, 'y min mm (asse Y verso l\'alto)');
  near(Math.max(...ys), 80, 1.5, 'y max mm');
});

console.log('DPI');
test('PNG con pHYs a 300 dpi', () => {
  const b = Buffer.alloc(8 + 25 + 21 + 12);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(9, 33); b.write('pHYs', 37, 'latin1');
  b.writeUInt32BE(11811, 41); b.writeUInt32BE(11811, 45); b[49] = 1;
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  assert(NS.detectDpi(ab) === 300, 'dpi: ' + NS.detectDpi(ab));
});
test('JPEG JFIF a 200 dpi', () => {
  const b = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0xc8, 0x00, 0xc8, 0x00, 0x00, 0xff, 0xd9]);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  assert(NS.detectDpi(ab) === 200, 'dpi: ' + NS.detectDpi(ab));
});

console.log(failed ? `\n${failed} test falliti` : '\nTutti i test superati');
process.exit(failed ? 1 : 0);
