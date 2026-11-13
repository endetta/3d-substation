import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

const lam = c => new THREE.MeshLambertMaterial({ color: c });
export const MAT = {
  body: lam(0xf2f2ef),
  porc: lam(0xc9c9c4),
  steel: lam(0xa3a39f),
  dark: lam(0x5f5f5b),
  conc: lam(0xdddcd6),
  wall: lam(0xf7f7f4),
};
export const MAT_SEL = new THREE.MeshLambertMaterial({ color: 0x1b1b1b, emissive: 0x111111 });
export const EDGE = new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.55 });
export const EDGE_SEL = new THREE.LineBasicMaterial({ color: 0xffffff });

const PH = [-3, 0, 3];

// ── kumpulan bagian → geometri gabungan per material + garis tepi ──
class Parts {
  constructor() { this.pieces = []; this.piece(null); }
  piece(kind) { this.cur = { kind, g: {}, lines: [] }; this.pieces.push(this.cur); return this; }
  add(mat, geom, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(1, 1, 1));
    geom.applyMatrix4(m);
    (this.cur.g[mat] ||= []).push(geom);
    return this;
  }
  box(mat, w, h, d, x, y, z, ry = 0) { return this.add(mat, new THREE.BoxGeometry(w, h, d), x, y, z, 0, ry, 0); }
  cyl(mat, r, h, x, y, z, rx = 0, rz = 0, seg = 10, r2 = r) {
    return this.add(mat, new THREE.CylinderGeometry(r2, r, h, seg), x, y, z, rx, 0, rz);
  }
  ins(mat, h, x, y, z, o = {}) { // isolator bersirip dari y ke atas
    return this.add(mat, insGeom(h, o.r || 0.12, o.R || 0.24), x, y, z, o.rx || 0, 0, o.rz || 0);
  }
  line(pts) { this.cur.lines.push(...pts); return this; }
  build() {
    return this.pieces.filter(p => Object.keys(p.g).length || p.lines.length).map(p => {
      const meshes = {};
      const all = [];
      for (const k in p.g) { meshes[k] = mergeGeometries(p.g[k]); all.push(meshes[k]); }
      let edges = null;
      const pos = [];
      for (const g of all) {
        const eg = new THREE.EdgesGeometry(g, 40);
        pos.push(...eg.attributes.position.array);
        eg.dispose();
      }
      pos.push(...p.lines);
      if (pos.length) {
        edges = new THREE.BufferGeometry();
        edges.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      }
      return { kind: p.kind, meshes, edges };
    });
  }
}

function insGeom(h, r, R) {
  const n = Math.max(3, Math.round(h / 0.17));
  const st = h / n;
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(r * 1.3, 0), new THREE.Vector2(r * 1.3, 0.06)];
  for (let i = 0; i < n; i++) {
    const y = i * st + 0.06 * (1 - i / n);
    pts.push(new THREE.Vector2(r, y + st * 0.15), new THREE.Vector2(R, y + st * 0.35),
      new THREE.Vector2(R * 0.97, y + st * 0.45), new THREE.Vector2(r, y + st * 0.75));
  }
  pts.push(new THREE.Vector2(r * 1.3, h - 0.06), new THREE.Vector2(r * 1.3, h), new THREE.Vector2(0.001, h));
  return new THREE.LatheGeometry(pts, 10);
}

// ── garis rangka kisi (lattice) ──
function latticeCol(P, x, z, w, h, n) {
  const o = w / 2, L = [];
  const c = [[x - o, z - o], [x + o, z - o], [x + o, z + o], [x - o, z + o]];
  for (let i = 0; i < 4; i++) { const [a, b] = c[i]; L.push(a, 0, b, a, h, b); }
  for (let k = 0; k < n; k++) {
    const y0 = k * h / n, y1 = (k + 1) * h / n;
    for (let i = 0; i < 4; i++) {
      const [a, b] = c[i], [d, e] = c[(i + 1) % 4];
      L.push(a, y0, b, d, y1, e, d, y0, e, a, y1, b, a, y1, b, d, y1, e);
    }
  }
  P.line(L);
}
// rangka balok kisi sepanjang x
function latticeBeam(P, xa, xb, y, z, w, h, n) {
  const L = [], o = w / 2, q = h / 2;
  const cs = [[-q, -o], [-q, o], [q, o], [q, -o]];
  for (const [dy, dz] of cs) L.push(xa, y + dy, z + dz, xb, y + dy, z + dz);
  for (let k = 0; k < n; k++) {
    const x0 = xa + (xb - xa) * k / n, x1 = xa + (xb - xa) * (k + 1) / n;
    for (let i = 0; i < 4; i++) {
      const [ay, az] = cs[i], [by, bz] = cs[(i + 1) % 4];
      L.push(x0, y + ay, z + az, x1, y + by, z + bz, x1, y + ay, z + az, x1, y + by, z + bz);
    }
  }
  P.line(L);
}

// ── terminal lokal per tipe (AIS / GIS) ──
// nilai: [z lokal, tinggi]; s = jarak fasa (0 = satu titik)
export const TERM = {
  AIS: {
    CB: { a: [-0.5, 5.5], b: [0.5, 4.05], s: 3 },
    DS: { a: [-1.55, 4.42], b: [1.55, 4.42], s: 3 },
    ES: { a: [1.55, 4.42], s: 3 },
    CT: { a: [-0.62, 4.6], b: [0.62, 4.6], s: 3 },
    CVT: { a: [0, 5.5], s: 3 },
    LA: { a: [0, 4.58], s: 3 },
    WT: { a: [-0.55, 4.42], b: [0.55, 4.42], s: 3 },
    GANTRY: { a: [1.95, 11.25], s: 3 },
    NGR: { a: [0, 2.95], s: 0 },
    KUB: { a: [0, 0.05], b: [0, 0.05], s: 0 },
    FDR: { a: [0, 0.05], s: 0 },
    TPS: { a: [0, 0.05], s: 0 },
  },
  GIS: {
    CB: { a: [-0.5, 2.2], b: [0.5, 2.2], s: 0 },
    DS: { a: [-0.45, 2.2], b: [0.45, 2.2], s: 0 },
    ES: { a: [0.45, 2.2], s: 0 },
    CT: { a: [-0.22, 2.2], b: [0.22, 2.2], s: 0 },
    CVT: { a: [0, 2.2], s: 0 },
  },
};
// trafo: terminal khusus (lokal x, y, z)
export const TR_TERM = {
  a: [[-1.4, 7.12, -0.85], [0, 7.12, -0.85], [1.4, 7.12, -0.85]],
  b: [[-1.9, 3.9, 2.75], [-1.1, 3.9, 2.75], [-0.3, 3.9, 2.75]],
  n: [[0.9, 5.22, 0.95]],
};
export const DS_PIVOT = { y: 4.53, z: 1.2 };     // pisau PMS (dua belahan)
export const ES_PIVOT = { y: 2.8, z: 1.75 };     // pisau PMS tanah
export const BUS_H = { AIS: 8, GIS: 3.7 };

const cache = new Map();
export function model(type, gis) {
  const key = type + (gis ? ':g' : '');
  if (!cache.has(key)) cache.set(key, (gis ? GIS_M : AIS_M)[type]().build());
  return cache.get(key);
}

const H = Math.PI / 2;
const AIS_M = {
  // PMT SF6 tipe live tank, satu ruang pemutus per kutub (150 kV), digerakkan satu mekanisme
  CB() {
    const P = new Parts();
    P.box('steel', 6.9, 0.22, 0.34, 0, 2.1, 0);
    P.cyl('steel', 0.045, 6.4, 0, 1.95, -0.26, 0, H, 6);
    P.box('dark', 0.8, 1.35, 0.6, -4.05, 0.8, 0);
    P.box('steel', 0.9, 0.08, 0.7, -4.05, 0.08, 0);
    P.cyl('steel', 0.045, 0.9, -3.6, 1.95, -0.26, 0, H, 6);
    for (const p of PH) {
      P.box('steel', 0.32, 2.0, 0.32, p, 1.0, 0);
      P.box('conc', 0.7, 0.12, 0.7, p, 0.06, 0);
      P.cyl('body', 0.24, 0.3, p, 2.36, 0, 0, 0, 12);
      P.box('dark', 0.1, 0.14, 0.1, p + 0.28, 2.3, 0);
      P.ins('porc', 1.35, p, 2.51, 0, { r: 0.15, R: 0.27 });
      P.box('body', 0.44, 0.38, 0.44, p, 4.05, 0);
      P.box('body', 0.12, 0.22, 0.3, p, 4.05, 0.36);
      P.ins('porc', 1.15, p, 4.24, 0, { r: 0.17, R: 0.28 });
      P.cyl('body', 0.22, 0.22, p, 5.5, 0, 0, 0, 12);
      P.box('body', 0.12, 0.2, 0.3, p, 5.5, -0.36);
    }
    return P;
  },
  // PMS center-break: dua isolator putar per fasa
  DS() {
    const P = new Parts();
    for (const p of PH) {
      P.box('steel', 0.3, 2.45, 0.3, p, 1.225, 0);
      P.box('conc', 0.6, 0.12, 0.6, p, 0.06, 0);
      P.box('steel', 0.26, 0.2, 3.1, p, 2.55, 0);
      for (const z of [-1.2, 1.2]) {
        P.cyl('dark', 0.16, 0.14, p, 2.72, z, 0, 0, 10);
        P.ins('porc', 1.55, p, 2.79, z, { r: 0.11, R: 0.21 });
        P.cyl('body', 0.15, 0.16, p, 4.42, z, 0, 0, 10);
        P.box('body', 0.14, 0.12, 0.34, p, 4.42, z + Math.sign(z) * 0.24);
      }
    }
    P.cyl('steel', 0.035, 6.0, 0, 2.38, -1.2, 0, H, 6);
    P.box('dark', 0.45, 0.65, 0.35, -3, 1.15, -0.35);
    P.cyl('steel', 0.03, 0.9, -3, 1.9, -0.35, 0, 0, 6);
    return P;
  },
  DS_BLADE() { // setengah pisau: pivot z=0, memanjang +z
    const P = new Parts();
    P.box('body', 0.07, 0.07, 1.16, 0, 0, 0.58);
    P.box('body', 0.12, 0.1, 0.1, 0, 0, 1.15);
    return P;
  },
  ES() {
    const P = new Parts();
    for (const p of PH) {
      P.box('dark', 0.16, 0.22, 0.2, p, 2.78, 1.75);
      P.box('body', 0.08, 0.16, 0.22, p, 4.3, 1.65);
    }
    P.cyl('steel', 0.035, 6.4, 0, 2.78, 1.75, 0, H, 6);
    P.box('dark', 0.36, 0.5, 0.28, 3.5, 1.25, 1.75);
    P.cyl('steel', 0.03, 1.3, 3.5, 2.1, 1.75, 0, 0, 6);
    return P;
  },
  ES_BLADE() { // pivot di dasar, memanjang +y
    const P = new Parts();
    P.box('dark', 0.05, 1.5, 0.05, 0, 0.75, 0);
    P.box('dark', 0.1, 0.08, 0.08, 0, 1.5, 0);
    return P;
  },
  // CT tipe kepala atas (top-core) berisi minyak
  CT() {
    const P = new Parts();
    for (const p of PH) {
      P.box('steel', 0.3, 2.25, 0.3, p, 1.125, 0);
      P.box('conc', 0.6, 0.12, 0.6, p, 0.06, 0);
      P.box('body', 0.62, 0.5, 0.62, p, 2.5, 0);
      P.box('dark', 0.26, 0.3, 0.12, p, 2.5, 0.37);
      P.ins('porc', 1.45, p, 2.75, 0, { r: 0.19, R: 0.32 });
      P.cyl('body', 0.4, 0.95, p, 4.6, 0, H, 0, 14);
      P.cyl('body', 0.22, 0.18, p, 5.09, 0, 0, 0, 12);
      P.box('body', 0.1, 0.2, 0.16, p, 4.6, 0.55);
      P.box('body', 0.1, 0.2, 0.16, p, 4.6, -0.55);
    }
    return P;
  },
  // CVT: dua unit kapasitor di atas tangki elektromagnetik (EMU)
  CVT() {
    const P = new Parts();
    for (const p of PH) {
      P.box('steel', 0.3, 1.8, 0.3, p, 0.9, 0);
      P.box('conc', 0.6, 0.12, 0.6, p, 0.06, 0);
      P.box('body', 0.78, 0.72, 0.78, p, 2.16, 0);
      P.box('dark', 0.3, 0.36, 0.14, p, 2.1, 0.46);
      P.ins('porc', 0.28, p + 0.26, 2.52, -0.26, { r: 0.04, R: 0.08 });
      P.ins('porc', 1.3, p, 2.52, 0, { r: 0.16, R: 0.28 });
      P.cyl('body', 0.21, 0.1, p, 3.87, 0, 0, 0, 12);
      P.ins('porc', 1.3, p, 3.92, 0, { r: 0.16, R: 0.28 });
      P.cyl('body', 0.22, 0.16, p, 5.3, 0, 0, 0, 12);
      P.box('body', 0.12, 0.12, 0.12, p, 5.44, 0);
    }
    return P;
  },
  // LA ZnO dua unit, ring perata, alas berisolasi + penghitung surja
  LA() {
    const P = new Parts();
    for (const p of PH) {
      P.box('steel', 0.3, 2.2, 0.3, p, 1.1, 0);
      P.box('conc', 0.6, 0.12, 0.6, p, 0.06, 0);
      P.box('steel', 0.5, 0.08, 0.5, p, 2.24, 0);
      for (const a of [0, 2.1, 4.2]) P.ins('porc', 0.16, p + 0.15 * Math.cos(a), 2.28, 0.15 * Math.sin(a), { r: 0.04, R: 0.07 });
      P.cyl('body', 0.16, 0.08, p, 2.48, 0, 0, 0, 12);
      P.ins('porc', 0.9, p, 2.52, 0, { r: 0.12, R: 0.22 });
      P.cyl('body', 0.15, 0.08, p, 3.46, 0, 0, 0, 12);
      P.ins('porc', 0.9, p, 3.5, 0, { r: 0.12, R: 0.22 });
      P.cyl('body', 0.15, 0.08, p, 4.44, 0, 0, 0, 12);
      P.add('body', new THREE.TorusGeometry(0.38, 0.03, 6, 18), p, 4.25, 0, H);
      P.box('body', 0.1, 0.1, 0.1, p, 4.53, 0);
      P.box('dark', 0.2, 0.28, 0.12, p, 1.5, 0.22);
      P.cyl('dark', 0.015, 0.8, p, 2.04, 0.22, 0, 0, 4);
    }
    return P;
  },
  // Wave trap: kumparan di atas tiga isolator tumpu (fasa luar); fasa tengah hanya isolator tumpu
  WT() {
    const P = new Parts();
    for (const p of PH) {
      P.box('steel', 0.3, 2.2, 0.3, p, 1.1, 0);
      P.box('conc', 0.6, 0.12, 0.6, p, 0.06, 0);
      P.box('steel', 0.7, 0.08, 0.7, p, 2.24, 0);
      if (p !== 0) {
        for (const a of [0.5, 2.6, 4.7]) P.ins('porc', 0.9, p + 0.26 * Math.cos(a), 2.28, 0.26 * Math.sin(a), { r: 0.06, R: 0.11 });
        P.cyl('steel', 0.5, 0.06, p, 3.21, 0, 0, 0, 18);
        P.add('body', new THREE.CylinderGeometry(0.5, 0.5, 1.1, 18, 1, true), p, 3.8, 0);
        for (let i = 0; i < 5; i++) P.add('body', new THREE.TorusGeometry(0.505, 0.025, 4, 18), p, 3.33 + i * 0.235, 0, H);
        P.box('steel', 1.04, 0.05, 0.05, p, 4.37, 0);
        P.box('steel', 0.05, 0.05, 1.04, p, 4.37, 0);
        P.box('dark', 0.25, 0.35, 0.2, p, 3.8, 0);
        P.box('body', 0.1, 0.1, 0.2, p, 4.42, 0.5);
        P.box('body', 0.1, 0.1, 0.2, p, 4.42, -0.5);
      } else {
        P.ins('porc', 2.08, p, 2.28, 0, { r: 0.1, R: 0.19 });
        P.box('body', 0.14, 0.12, 1.1, p, 4.42, 0);
      }
    }
    return P;
  },
  GANTRY() {
    const P = new Parts();
    for (const sx of [-6.3, 6.3]) {
      latticeCol(P, sx, 0, 0.8, 12, 8);
      P.box('steel', 0.1, 12, 0.1, sx, 6, 0);
      P.box('steel', 0.2, 2.8, 0.2, sx, 13.4, 0);
      P.box('conc', 1.4, 0.3, 1.4, sx, 0.15, 0);
    }
    latticeBeam(P, -6.3, 6.3, 11.6, 0, 0.8, 0.8, 10);
    P.box('steel', 12.6, 0.12, 0.12, 0, 11.6, 0);
    for (const p of PH) {
      P.box('steel', 0.1, 0.1, 0.3, p, 11.25, 0.15);
      P.ins('porc', 1.5, p, 11.25, 0.3, { r: 0.035, R: 0.13, rx: H });
      P.box('body', 0.1, 0.1, 0.15, p, 11.25, 1.88);
    }
    return P;
  },
  PORTAL() {
    const P = new Parts();
    for (const sx of [-5.5, 5.5]) {
      latticeCol(P, sx, 0, 0.7, 13.5, 9);
      P.box('steel', 0.08, 13.5, 0.08, sx, 6.75, 0);
      P.box('conc', 1.2, 0.3, 1.2, sx, 0.15, 0);
    }
    latticeBeam(P, -5.5, 5.5, 13.6, 0, 0.7, 0.7, 8);
    P.box('steel', 11, 0.1, 0.1, 0, 13.6, 0);
    return P;
  },
  LINE() { // menara SUTT
    const P = new Parts();
    const L = [], h = 30, b0 = 3.2, t0 = 0.9;
    const lv = [0, 6, 12, 17, 20, 24, 28];
    const w = y => b0 + (t0 - b0) * (y / h);
    for (let i = 0; i < lv.length - 1; i++) {
      const y0 = lv[i], y1 = lv[i + 1], a = w(y0), c = w(y1);
      const sq = (o, y) => [[-o, y, -o], [o, y, -o], [o, y, o], [-o, y, o]];
      const s0 = sq(a, y0), s1 = sq(c, y1);
      for (let k = 0; k < 4; k++) {
        L.push(...s0[k], ...s1[k]);
        L.push(...s1[k], ...s1[(k + 1) % 4]);
        L.push(...s0[k], ...s1[(k + 1) % 4], ...s1[k], ...s0[(k + 1) % 4]);
      }
    }
    for (const [y, x0, x1] of [[20, -6.2, 6.2], [24, -6.2, 0]]) {
      L.push(x0, y, -0.6, x1, y, -0.6, x0, y, 0.6, x1, y, 0.6, x0, y, -0.6, 0, y + 2, 0, x0, y, 0.6, 0, y + 2, 0);
      if (x1 > 0) L.push(x1, y, -0.6, 0, y + 2, 0, x1, y, 0.6, 0, y + 2, 0);
    }
    L.push(0, 28, 0, 0, 31, 0);
    P.line(L);
    P.box('steel', 0.5, h, 0.5, 0, h / 2, 0);
    for (const [x, y] of [[-6, 20], [6, 20], [-6, 24]]) P.ins('porc', 1.6, x, y - 1.6, 0, { r: 0.05, R: 0.15 });
    return P;
  },
  TR() {
    const P = new Parts();
    P.piece('TR_TANK');
    P.box('conc', 9.4, 0.35, 5.0, 0, 0.175, 0.2);
    for (const z of [-2.75, 3.15]) P.box('conc', 10.2, 0.45, 0.2, 0, 0.225, z);
    for (const x of [-5.0, 5.0]) P.box('conc', 0.2, 0.45, 6.1, x, 0.225, 0.2);
    for (const z of [-0.75, 0.75]) P.box('steel', 7.0, 0.1, 0.12, 0, 0.4, z);
    for (const x of [-2.4, 2.4]) for (const z of [-0.75, 0.75]) P.cyl('dark', 0.18, 0.14, x, 0.53, z, H, 0, 10);
    P.box('steel', 6.2, 0.12, 3.0, 0, 0.66, 0);
    P.box('body', 6.0, 3.3, 2.8, 0, 2.37, 0);
    for (const x of [-2.4, -1.2, 0, 1.2, 2.4]) for (const z of [-1.45, 1.45]) P.box('body', 0.12, 3.1, 0.1, x, 2.37, z);
    P.box('body', 6.2, 0.14, 3.0, 0, 4.09, 0);
    for (const x of [-2.9, 2.9]) for (const z of [-1.45, 1.45]) P.box('steel', 0.2, 0.25, 0.08, x, 3.9, z);
    P.piece('TR_HV');
    for (const x of [-1.4, 0, 1.4]) {
      P.cyl('body', 0.32, 0.45, x, 4.38, -0.85, 0, 0, 12);
      P.ins('porc', 2.3, x, 4.6, -0.85, { r: 0.16, R: 0.3 });
      P.cyl('body', 0.18, 0.2, x, 7.0, -0.85, 0, 0, 10);
      P.box('body', 0.1, 0.1, 0.2, x, 7.12, -0.85);
    }
    P.piece('TR_LV');
    for (const x of [-1.9, -1.1, -0.3]) {
      P.cyl('body', 0.2, 0.2, x, 4.26, 0.95, 0, 0, 10);
      P.ins('porc', 0.85, x, 4.36, 0.95, { r: 0.12, R: 0.22 });
      P.box('body', 0.1, 0.1, 0.12, x, 5.22, 0.95);
      // struktur terminasi kabel 20 kV di luar tangki
      P.ins('porc', 0.55, x, 3.9, 2.75, { r: 0.08, R: 0.15 });
      P.cyl('dark', 0.07, 3.85, x, 1.95, 2.75, 0, 0, 8);
      P.line([x, 5.22, 0.95, x, 5.22, 2.75, x, 5.22, 2.75, x, 4.45, 2.75]);
    }
    P.box('steel', 2.4, 0.12, 0.3, -1.1, 3.84, 2.75);
    for (const x of [-2.3, 0.1]) P.box('steel', 0.14, 3.84, 0.14, x, 1.92, 2.75);
    P.piece('TR_N');
    P.cyl('body', 0.16, 0.2, 0.9, 4.26, 0.95, 0, 0, 10);
    P.ins('porc', 0.85, 0.9, 4.36, 0.95, { r: 0.1, R: 0.2 });
    P.box('body', 0.1, 0.1, 0.12, 0.9, 5.22, 0.95);
    P.piece('TR_CONS');
    P.cyl('body', 0.6, 3.0, 2.3, 5.8, 0.1, H, 0, 14);
    P.cyl('body', 0.36, 0.7, 2.3, 5.8, -1.75, H, 0, 12);
    for (const z of [-0.9, 1.1]) P.box('steel', 0.15, 1.15, 0.15, 2.3, 4.7, z);
    P.cyl('dark', 0.06, 1.05, 1.85, 4.66, 0.1, 0, 0, 8);
    P.box('dark', 0.22, 0.18, 0.2, 1.85, 4.62, 0.1);
    P.cyl('dark', 0.03, 4.0, 3.1, 3.8, 1.2, 0, 0, 6);
    P.cyl('porc', 0.11, 0.38, 3.1, 1.65, 1.2, 0, 0, 10);
    P.piece('TR_RAD');
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 10; i++) P.box('body', 1.1, 2.7, 0.045, sx * 3.65, 2.4, -1.35 + i * 0.3);
      for (const y of [3.82, 1.0]) {
        P.cyl('steel', 0.09, 3.0, sx * 3.65, y, 0, H, 0, 8);
        P.cyl('steel', 0.09, 0.6, sx * 3.1, y, 0, 0, H, 8);
      }
      for (const z of [-0.7, 0.7]) {
        P.cyl('dark', 0.36, 0.16, sx * 4.32, 2.3, z, 0, H, 14);
        P.add('steel', new THREE.TorusGeometry(0.4, 0.02, 4, 16), sx * 4.42, 2.3, z, 0, H);
      }
    }
    P.piece('TR_OLTC');
    P.box('body', 1.1, 2.4, 0.6, -2.2, 2.75, -1.75);
    P.box('dark', 0.55, 0.85, 0.3, -2.2, 1.25, -1.65);
    P.cyl('steel', 0.03, 1.0, -2.2, 2.0, -1.65, 0, 0, 6);
    P.piece('TR_MK');
    P.box('dark', 0.9, 1.4, 0.5, 1.6, 1.35, -2.25);
    for (const x of [1.25, 1.95]) P.box('steel', 0.08, 0.65, 0.08, x, 0.33, -2.25);
    return P;
  },
  NGR() {
    const P = new Parts();
    for (const [x, z] of [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]]) P.box('steel', 0.08, 0.6, 0.08, x, 0.3, z);
    P.box('conc', 1.6, 0.12, 1.3, 0, 0.06, 0);
    P.box('body', 1.3, 1.5, 1.0, 0, 1.35, 0);
    for (let i = 0; i < 5; i++) P.box('dark', 1.32, 0.04, 1.02, 0, 0.8 + i * 0.28, 0);
    P.ins('porc', 0.85, 0, 2.1, 0, { r: 0.1, R: 0.18 });
    P.cyl('dark', 0.02, 0.6, 0.62, 0.3, 0.45, 0, 0, 4);
    return P;
  },
  // kubikel 20 kV metal-clad: kompartemen relay, PMT (truck), kabel
  KUB() {
    const P = new Parts();
    P.box('body', 0.8, 2.3, 1.5, 0, 1.15, 0);
    P.box('steel', 0.8, 0.06, 1.5, 0, 2.33, 0);
    P.box('body', 0.72, 0.6, 0.03, 0, 1.92, 0.765);
    P.box('dark', 0.22, 0.16, 0.02, -0.12, 2.0, 0.785);
    for (let i = 0; i < 3; i++) P.box('dark', 0.04, 0.04, 0.02, 0.06 + i * 0.08, 1.8, 0.785);
    P.box('dark', 0.03, 0.3, 0.015, 0.22, 1.95, 0.785);
    P.box('steel', 0.72, 0.85, 0.03, 0, 1.15, 0.765);
    P.box('dark', 0.26, 0.2, 0.02, 0, 1.32, 0.785);
    P.box('dark', 0.06, 0.06, 0.02, 0, 0.88, 0.785);
    P.box('dark', 0.03, 0.2, 0.04, 0.3, 1.15, 0.79);
    P.box('body', 0.72, 0.55, 0.03, 0, 0.4, 0.765);
    return P;
  },
  FDR() {
    const P = new Parts();
    P.cyl('conc', 0.17, 11, 0, 5.5, 0, 0, 0, 8, 0.12);
    P.box('steel', 2.2, 0.12, 0.12, 0, 10.3, 0);
    for (const x of [-0.9, 0, 0.9]) P.ins('porc', 0.3, x, 10.36, 0, { r: 0.05, R: 0.1 });
    P.box('steel', 1.6, 0.1, 0.1, 0, 8.6, 0.25);
    for (const x of [-0.6, 0, 0.6]) {
      P.ins('porc', 0.45, x, 8.66, 0.25, { r: 0.05, R: 0.1 });
      P.line([x, 9.11, 0.25, x * 1.5, 10.4, 0]);
    }
    P.cyl('dark', 0.09, 8.4, 0, 4.3, 0.25, 0, 0, 8);
    return P;
  },
  TPS() {
    const P = new Parts();
    P.box('conc', 2.4, 0.2, 1.4, 0.3, 0.1, 0);
    P.box('body', 1.2, 1.3, 0.8, 0, 0.85, 0);
    for (let i = 0; i < 5; i++) P.box('body', 0.04, 1.0, 0.25, -0.4 + i * 0.2, 0.8, 0.52);
    for (const x of [-0.35, 0, 0.35]) P.ins('porc', 0.3, x, 1.5, -0.2, { r: 0.05, R: 0.09 });
    P.box('dark', 0.6, 1.1, 0.4, 1.05, 0.75, 0);
    return P;
  },
  CSE() {
    const P = new Parts();
    P.box('steel', 7.2, 0.25, 0.4, 0, 3.6, 0);
    for (const sx of [-3.4, 3.4]) P.box('steel', 0.3, 3.6, 0.3, sx, 1.8, 0);
    for (const p of PH) { P.ins('porc', 1.6, p, 3.75, 0, { r: 0.14, R: 0.25 }); P.cyl('dark', 0.08, 3.6, p, 1.8, 0.35); }
    return P;
  },
  MAST() {
    const P = new Parts();
    latticeCol(P, 0, 0, 1.0, 22, 11);
    P.box('steel', 0.1, 22, 0.1, 0, 11, 0);
    P.cyl('steel', 0.05, 5, 0, 24.5, 0, 0, 0, 6, 0.02);
    P.box('conc', 1.6, 0.3, 1.6, 0, 0.15, 0);
    return P;
  },
  FIREWALL() {
    const P = new Parts();
    P.box('conc', 0.3, 7.5, 7.0, 0, 3.75, 0);
    return P;
  },
  HUMAN() {
    const P = new Parts();
    P.cyl('dark', 0.13, 0.85, -0.1, 0.43, 0, 0, 0, 8);
    P.cyl('dark', 0.13, 0.85, 0.1, 0.43, 0, 0, 0, 8);
    P.cyl('dark', 0.21, 0.65, 0, 1.2, 0, 0, 0, 8, 0.17);
    P.add('dark', new THREE.SphereGeometry(0.12, 10, 8), 0, 1.62, 0);
    return P;
  },
  GENSET() {
    const P = new Parts();
    P.box('conc', 4.6, 0.2, 2.2, 0, 0.1, 0);
    P.box('body', 4.2, 2.2, 1.8, 0, 1.3, 0);
    P.cyl('dark', 0.1, 0.8, 1.5, 2.8, 0.4);
    for (let i = 0; i < 6; i++) P.box('dark', 0.04, 1.2, 0.02, -1.6 + i * 0.25, 1.3, 0.91);
    return P;
  },
  GUARD() {
    const P = new Parts();
    P.box('wall', 3, 2.8, 3, 0, 1.4, 0);
    P.box('conc', 3.6, 0.15, 3.6, 0, 2.88, 0);
    P.box('dark', 1.0, 0.8, 0.02, 0.5, 1.6, 1.51);
    return P;
  },
  PANEL() {
    const P = new Parts();
    P.box('body', 0.8, 2.2, 0.6, 0, 1.1, 0);
    P.box('dark', 0.6, 1.0, 0.02, 0, 1.5, 0.31);
    for (let i = 0; i < 4; i++) P.box('steel', 0.08, 0.08, 0.02, -0.2 + i * 0.13, 0.7, 0.32);
    return P;
  },
  BAT() {
    const P = new Parts();
    P.box('steel', 3.0, 0.06, 0.6, 0, 0.5, 0);
    P.box('steel', 3.0, 0.06, 0.6, 0, 1.2, 0);
    for (const y of [0.53, 1.23]) for (let i = 0; i < 12; i++) P.box('body', 0.2, 0.36, 0.42, -1.35 + i * 0.245, y + 0.18, 0);
    for (const x of [-1.45, 1.45]) P.box('steel', 0.06, 1.3, 0.6, x, 0.65, 0);
    return P;
  },
  DESK() {
    const P = new Parts();
    P.box('body', 2.4, 0.06, 0.9, 0, 0.75, 0);
    P.box('body', 0.06, 0.72, 0.8, -1.15, 0.37, 0);
    P.box('body', 0.06, 0.72, 0.8, 1.15, 0.37, 0);
    for (const x of [-0.6, 0.1, 0.8]) { P.box('dark', 0.55, 0.36, 0.03, x, 1.05, -0.25); P.box('steel', 0.05, 0.2, 0.05, x, 0.86, -0.25); }
    return P;
  },
};

const GIS_M = {
  CB() {
    const P = new Parts();
    P.box('steel', 1.0, 0.7, 0.9, 0, 0.35, 0);
    P.cyl('body', 0.42, 2.4, 0, 1.95, 0, 0, 0, 14);
    P.cyl('body', 0.5, 0.07, 0, 0.78, 0, 0, 0, 14);
    P.cyl('body', 0.5, 0.07, 0, 3.12, 0, 0, 0, 14);
    P.box('dark', 0.35, 1.1, 0.5, 0.58, 1.3, 0);
    P.cyl('body', 0.2, 1.0, 0, 2.2, 0, Math.PI / 2, 0, 10);
    return P;
  },
  DS() {
    const P = new Parts();
    P.cyl('body', 0.26, 0.82, 0, 2.2, 0, Math.PI / 2, 0, 12);
    P.box('dark', 0.24, 0.24, 0.3, 0, 2.58, 0);
    P.box('steel', 0.12, 1.95, 0.12, 0, 0.98, 0);
    return P;
  },
  ES() {
    const P = new Parts();
    P.cyl('dark', 0.09, 0.4, 0, 2.62, 0.35, 0, 0, 8);
    P.box('dark', 0.2, 0.16, 0.2, 0, 2.88, 0.35);
    return P;
  },
  CT() {
    const P = new Parts();
    P.cyl('body', 0.36, 0.32, 0, 2.2, 0, Math.PI / 2, 0, 14);
    P.box('dark', 0.16, 0.16, 0.16, 0.42, 2.2, 0);
    return P;
  },
  CVT() {
    const P = new Parts();
    P.cyl('body', 0.3, 1.0, 0, 1.1, 0, 0, 0, 12);
    P.cyl('body', 0.15, 0.6, 0, 1.9, 0, 0, 0, 10);
    P.box('dark', 0.3, 0.3, 0.2, 0, 0.8, 0.35);
    return P;
  },
  LCC() {
    const P = new Parts();
    P.box('body', 0.8, 2.0, 0.45, 0, 1.0, 0);
    P.box('dark', 0.6, 0.8, 0.02, 0, 1.3, 0.23);
    return P;
  },
};
// tipe yang sama dengan AIS
for (const k of ['KUB', 'FDR', 'TPS']) GIS_M[k] = AIS_M[k];

// rel AIS / GIS dibuat per instans
export function busGeom(bus, gis) {
  const P = new Parts();
  const L = bus.x1 - bus.x0, cx = (bus.x0 + bus.x1) / 2;
  if (bus.v20) {
    P.box('dark', L, 0.12, 0.3, cx, 2.42, 0);
    return P.build();
  }
  if (gis) {
    const h = BUS_H.GIS;
    P.cyl('body', 0.3, L, cx, h, 0, 0, Math.PI / 2, 14);
    for (let x = bus.x0 + 0.4; x <= bus.x1; x += 3) P.box('steel', 0.14, h - 0.3, 0.14, x, (h - 0.3) / 2, 0);
    return P.build();
  }
  const h = BUS_H.AIS;
  for (const z of PH) {
    P.cyl('body', 0.1, L, cx, h, z, 0, Math.PI / 2, 8);
    for (const x of [bus.x0, bus.x1]) P.add('body', new THREE.SphereGeometry(0.17, 10, 8), x, h, z);
  }
  const xs = [];
  for (let x = bus.x0; x < bus.x1 - 2; x += 13) xs.push(x);
  xs.push(bus.x1);
  for (const x of xs) for (const z of PH) {
    P.box('steel', 0.3, 5.6, 0.3, x, 2.8, z);
    P.box('conc', 0.6, 0.12, 0.6, x, 0.06, z);
    P.ins('porc', 2.2, x, 5.6, z, { r: 0.12, R: 0.22 });
    P.box('body', 0.22, 0.14, 0.3, x, h - 0.12, z);
  }
  return P.build();
}

export function boxPiece(w, h, d, mat = 'body') {
  const P = new Parts(); P.box(mat, w, h, d, 0, h / 2, 0); return P.build();
}
export { Parts };
