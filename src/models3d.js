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
        const eg = new THREE.EdgesGeometry(g, 35);
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
  for (let i = 0; i < 4; i++) { const [a, b] = c[i], [d, e] = c[(i + 1) % 4]; L.push(a, 0, b, a, h, b); }
  for (let k = 0; k < n; k++) {
    const y0 = k * h / n, y1 = (k + 1) * h / n;
    for (let i = 0; i < 4; i++) {
      const [a, b] = c[i], [d, e] = c[(i + 1) % 4];
      L.push(a, y0, b, d, y1, e, d, y0, e, a, y1, b, a, y1, b, d, y1, e);
    }
  }
  P.line(L);
}

// ── terminal lokal per tipe (AIS / GIS) ──
// nilai: [z lokal, tinggi, jarak fasa]
export const TERM = {
  AIS: {
    CB: { a: [-1.0, 4.6], b: [1.0, 4.6], s: 3 },
    DS: { a: [-1.4, 4.62], b: [1.4, 4.62], s: 3 },
    ES: { a: [1.4, 4.62], s: 3 },
    CT: { a: [-0.45, 4.55], b: [0.45, 4.55], s: 3 },
    CVT: { a: [0, 5.1], s: 3 },
    LA: { a: [0, 4.35], s: 3 },
    WT: { a: [-0.5, 4.6], b: [0.5, 4.6], s: 3 },
    GANTRY: { a: [1.9, 11.25], s: 3 },
    LINE: { a: [0, 20], s: 0, custom: true },
    TR: { a: [-0.9, 6.55], b: [0.95, 4.95], n: [0.95, 4.95], s: 1.4, custom: true },
    NGR: { a: [0, 3.0], s: 0 },
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
export const BUS_H = { AIS: 8, GIS: 3.7 };

const cache = new Map();
export function model(type, gis) {
  const key = type + (gis ? ':g' : '');
  if (!cache.has(key)) cache.set(key, (gis ? GIS_M : AIS_M)[type]().build());
  return cache.get(key);
}

const AIS_M = {
  CB() {
    const P = new Parts();
    P.box('steel', 6.8, 0.25, 0.3, 0, 2.4, 0);
    for (const p of PH) {
      P.box('steel', 0.3, 2.3, 0.3, p, 1.15, 0);
      P.box('dark', 0.5, 0.75, 0.4, p, 1.6, -0.42);
      P.ins('porc', 1.75, p, 2.5, 0, { r: 0.14, R: 0.27 });
      P.box('body', 0.46, 0.46, 0.46, p, 4.45, 0);
      P.ins('porc', 0.72, p, 4.6, 0.22, { r: 0.13, R: 0.21, rx: Math.PI / 2 });
      P.ins('porc', 0.72, p, 4.6, -0.22, { r: 0.13, R: 0.21, rx: -Math.PI / 2 });
      P.box('body', 0.14, 0.24, 0.12, p, 4.6, 1.0);
      P.box('body', 0.14, 0.24, 0.12, p, 4.6, -1.0);
    }
    return P;
  },
  DS() {
    const P = new Parts();
    for (const p of PH) {
      P.box('steel', 0.28, 2.5, 0.28, p, 1.25, 0);
      P.box('steel', 0.24, 0.22, 3.2, p, 2.6, 0);
      P.ins('porc', 1.7, p, 2.71, -1.4, { r: 0.11, R: 0.21 });
      P.ins('porc', 1.7, p, 2.71, 1.4, { r: 0.11, R: 0.21 });
      P.box('body', 0.22, 0.18, 0.34, p, 4.5, -1.4);
      P.box('body', 0.22, 0.18, 0.34, p, 4.5, 1.4);
    }
    P.box('dark', 0.36, 0.55, 0.3, -3, 1.0, 0.3);
    return P;
  },
  DS_BLADE() { // pisau PMS, pivot di z=0, memanjang +z
    const P = new Parts();
    P.box('body', 0.08, 0.08, 2.8, 0, 0, 1.4);
    return P;
  },
  ES() {
    const P = new Parts();
    for (const p of PH) P.box('dark', 0.16, 0.3, 0.16, p + 0.32, 2.85, 1.4);
    P.box('dark', 0.3, 0.4, 0.25, 3.35, 1.6, 1.4);
    P.box('steel', 6.4, 0.06, 0.06, 0.3, 2.72, 1.55);
    return P;
  },
  ES_BLADE() { // pivot di dasar, memanjang +y
    const P = new Parts();
    P.box('dark', 0.05, 1.8, 0.05, 0, 0.9, 0);
    return P;
  },
  CT() {
    const P = new Parts();
    for (const p of PH) {
      P.box('steel', 0.3, 2.3, 0.3, p, 1.15, 0);
      P.box('dark', 0.55, 0.32, 0.55, p, 2.45, 0);
      P.ins('porc', 1.7, p, 2.6, 0, { r: 0.2, R: 0.32 });
      P.cyl('body', 0.34, 0.8, p, 4.55, 0, Math.PI / 2);
      P.box('body', 0.1, 0.2, 0.14, p, 4.55, 0.45);
      P.box('body', 0.1, 0.2, 0.14, p, 4.55, -0.45);
    }
    return P;
  },
  CVT() {
    const P = new Parts();
    for (const p of PH) {
      P.box('steel', 0.3, 2.0, 0.3, p, 1.0, 0);
      P.box('body', 0.66, 0.55, 0.66, p, 2.27, 0);
      P.ins('porc', 2.4, p, 2.55, 0, { r: 0.16, R: 0.29 });
      P.cyl('body', 0.2, 0.15, p, 5.02, 0);
    }
    return P;
  },
  LA() {
    const P = new Parts();
    for (const p of PH) {
      P.box('steel', 0.28, 2.4, 0.28, p, 1.2, 0);
      P.box('dark', 0.18, 0.26, 0.12, p, 1.5, 0.22);
      P.ins('porc', 1.85, p, 2.4, 0, { r: 0.11, R: 0.22 });
      P.add('body', new THREE.TorusGeometry(0.32, 0.03, 6, 16), p, 4.12, 0, Math.PI / 2);
    }
    return P;
  },
  WT() {
    const P = new Parts();
    for (const p of PH) {
      P.box('steel', 0.28, 2.4, 0.28, p, 1.2, 0);
      P.ins('porc', 1.4, p, 2.4, 0, { r: 0.1, R: 0.2 });
      if (p !== 0) P.cyl('body', 0.46, 1.0, p, 4.3, 0, 0, 0, 14);
      else P.box('body', 0.2, 0.2, 1.0, p, 4.6, 0);
    }
    return P;
  },
  GANTRY() {
    const P = new Parts();
    for (const sx of [-6.3, 6.3]) {
      P.box('steel', 0.08, 12, 0.08, sx, 6, 0);
      latticeCol(P, sx, 0, 0.7, 12, 8);
      P.box('steel', 0.2, 2.6, 0.2, sx, 13.3, 0);
    }
    P.box('steel', 13.3, 0.7, 0.7, 0, 11.6, 0);
    for (const p of PH) P.ins('porc', 1.6, p, 11.25, 0.3, { r: 0.07, R: 0.16, rx: Math.PI / 2 });
    return P;
  },
  PORTAL() {
    const P = new Parts();
    for (const sx of [-1, 1]) { P.box('steel', 0.08, 13.5, 0.08, sx * 5.5, 6.75, 0); latticeCol(P, sx * 5.5, 0, 0.6, 13.5, 9); }
    P.box('steel', 11.6, 0.6, 0.6, 0, 13.6, 0);
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
    P.box('steel', 0.5, h, 0.5, 0, h / 2, 0); // inti untuk klik
    for (const [x, y] of [[-6, 20], [6, 20], [-6, 24]]) P.ins('porc', 1.6, x, y - 1.6, 0, { r: 0.07, R: 0.16 });
    return P;
  },
  TR() {
    const P = new Parts();
    P.piece('TR_TANK');
    P.box('conc', 8.4, 0.4, 4.4, 0, 0.2, 0);
    P.box('body', 6.4, 3.4, 3.0, 0, 2.1, 0);
    P.box('body', 6.6, 0.15, 3.2, 0, 3.87, 0);
    P.piece('TR_HV');
    for (const x of [-1.4, 0, 1.4]) {
      P.cyl('body', 0.3, 0.4, x, 4.1, -0.9);
      P.ins('porc', 2.15, x, 4.3, -0.9, { r: 0.16, R: 0.3 });
    }
    P.piece('TR_LV');
    for (const x of [-1.9, -1.1, -0.3]) P.ins('porc', 0.95, x, 3.95, 0.95, { r: 0.13, R: 0.24 });
    P.piece('TR_N');
    P.ins('porc', 0.95, 0.95, 3.95, 0.95, { r: 0.11, R: 0.2 });
    P.piece('TR_CONS');
    P.cyl('body', 0.55, 2.8, 2.6, 5.5, 0.2, Math.PI / 2);
    P.box('steel', 0.15, 1.2, 0.15, 2.6, 4.5, -0.8);
    P.box('steel', 0.15, 1.2, 0.15, 2.6, 4.5, 1.2);
    P.cyl('dark', 0.06, 1.5, 2.0, 4.6, 0.5, 0, Math.PI / 2);
    P.piece('TR_RAD');
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 8; i++) P.box('body', 1.0, 2.6, 0.05, sx * 3.85, 2.2, -1.2 + i * 0.34);
      P.cyl('steel', 0.08, 2.6, sx * 3.85, 3.55, 0, Math.PI / 2);
      P.cyl('steel', 0.08, 2.6, sx * 3.85, 0.85, 0, Math.PI / 2);
      for (const z of [-0.7, 0.7]) P.cyl('dark', 0.35, 0.2, sx * 3.85, 0.6, z, 0, 0, 12);
    }
    P.piece('TR_OLTC');
    P.box('body', 1.1, 2.6, 0.7, -2.3, 2.2, -1.85);
    P.box('dark', 0.5, 0.8, 0.3, -2.3, 1.2, -2.35);
    P.piece('TR_MK');
    P.box('dark', 0.9, 1.6, 0.5, 1.8, 1.2, -1.9);
    return P;
  },
  NGR() {
    const P = new Parts();
    for (const [x, z] of [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]]) P.box('steel', 0.08, 0.6, 0.08, x, 0.3, z);
    P.box('body', 1.3, 1.5, 1.0, 0, 1.35, 0);
    for (let i = 0; i < 5; i++) P.box('dark', 1.32, 0.04, 1.02, 0, 0.8 + i * 0.28, 0);
    P.ins('porc', 0.85, 0, 2.1, 0, { r: 0.1, R: 0.18 });
    return P;
  },
  KUB() {
    const P = new Parts();
    P.box('body', 0.84, 2.3, 1.5, 0, 1.15, 0);
    P.box('dark', 0.6, 0.55, 0.02, 0, 1.9, 0.76);
    P.box('steel', 0.62, 1.0, 0.02, 0, 0.75, 0.76);
    P.box('dark', 0.16, 0.16, 0.02, 0.15, 0.95, 0.775);
    return P;
  },
  FDR() {
    const P = new Parts();
    P.cyl('conc', 0.17, 11, 0, 5.5, 0, 0, 0, 8, 0.12);
    P.box('steel', 2.2, 0.12, 0.12, 0, 10.3, 0);
    for (const x of [-0.9, 0, 0.9]) P.ins('porc', 0.3, x, 10.36, 0, { r: 0.05, R: 0.1 });
    P.cyl('dark', 0.07, 9.5, 0.2, 4.8, 0);
    return P;
  },
  TPS() {
    const P = new Parts();
    P.box('conc', 1.8, 0.2, 1.4, 0, 0.1, 0);
    P.box('body', 1.2, 1.3, 0.8, 0, 0.85, 0);
    for (let i = 0; i < 5; i++) P.box('body', 0.04, 1.0, 0.25, -0.4 + i * 0.2, 0.8, 0.52);
    for (const x of [-0.35, 0, 0.35]) P.ins('porc', 0.3, x, 1.5, -0.2, { r: 0.05, R: 0.09 });
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
  for (const z of PH) P.cyl('body', 0.1, L, cx, h, z, 0, Math.PI / 2, 8);
  const xs = [];
  for (let x = bus.x0; x < bus.x1 - 2; x += 13) xs.push(x);
  xs.push(bus.x1);
  for (const x of xs) for (const z of PH) {
    P.box('steel', 0.3, 5.6, 0.3, x, 2.8, z);
    P.ins('porc', 2.2, x, 5.6, z, { r: 0.12, R: 0.22 });
  }
  return P.build();
}

export function boxPiece(w, h, d, mat = 'body') {
  const P = new Parts(); P.box(mat, w, h, d, 0, h / 2, 0); return P.build();
}
export { Parts };
