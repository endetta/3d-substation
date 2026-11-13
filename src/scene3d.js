import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { MAT, MAT_SEL, EDGE, EDGE_SEL, TERM, TR_TERM, DS_PIVOT, ES_PIVOT, BUS_H, model, busGeom, Parts } from './models3d.js';

const BG = 0xefefeb;
const W_LIVE = new THREE.LineBasicMaterial({ color: 0x161616 });
const W_DEAD = new THREE.LineBasicMaterial({ color: 0xb4b4ae });
const W_EARTH = new THREE.LineBasicMaterial({ color: 0x8a8a84 });
const DECO_LINE = new THREE.LineBasicMaterial({ color: 0x8c8c86, transparent: true, opacity: 0.6 });
const GRID_LINE = new THREE.LineBasicMaterial({ color: 0xc9c9c2 });
const GHOST = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.0, depthWrite: false });
const GLASS = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
const PH = [-3, 0, 3];
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const tk = t => t.startsWith('KUB') ? 'KUB' : t;

export class View3D {
  constructor(el, onPick) {
    this.el = el; this.onPick = onPick;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 180, 520);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 2500);
    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = 0.12; c.maxPolarAngle = 1.53;
    c.minDistance = 2; c.maxDistance = 420; c.screenSpacePanning = false;
    c.addEventListener('change', () => { this.dirty = true; });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8f8f8a, 1.9));
    const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(70, 120, 40); this.scene.add(d);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: 0xe7e7e2 }));
    ground.rotation.x = -Math.PI / 2; this.scene.add(ground);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.labelEl = document.createElement('div'); this.labelEl.className = 'labels3d'; el.appendChild(this.labelEl);
    this.showLabels = true;
    this.ray = new THREE.Raycaster();
    this.walk = { on: false, yaw: 0, pitch: 0, keys: new Set(), jx: 0, jy: 0 };
    this.active = true;
    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    this.last = performance.now();
    const loop = t => { requestAnimationFrame(loop); this.tick(t); };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  // ───────────────────────── build ─────────────────────────
  build(m) {
    this.root.traverse(o => { if (o.userData.own) { o.geometry?.dispose(); } });
    this.root.clear();
    this.m = m; this.reg = new Map(); this.pick = []; this.wires = []; this.blades = {}; this.labels = [];
    this.sel = null;
    for (const e of m.els) this.addElem(e);
    for (const l of m.links) if (l.t !== false && !l.internal) this.addLink(l);
    this.addDecor();
    this.buildLabels();
    this.dirty = true;
  }

  regAdd(keys, obj) { for (const k of keys) { if (!this.reg.has(k)) this.reg.set(k, []); this.reg.get(k).push(obj); } }

  addPieces(pieces, group, key, info) {
    for (const pc of pieces) {
      const keys = pc.kind ? [key + '#' + pc.kind, key] : [key];
      for (const mk in pc.meshes) {
        const mesh = new THREE.Mesh(pc.meshes[mk], MAT[mk]);
        mesh.userData = { key: keys[0], mat: MAT[mk], ...info };
        group.add(mesh); this.pick.push(mesh); this.regAdd(keys, mesh);
      }
      if (pc.edges) {
        const ln = new THREE.LineSegments(pc.edges, EDGE);
        ln.userData = { edge: true }; group.add(ln); this.regAdd(keys, ln);
      }
    }
  }

  addElem(e) {
    const g = new THREE.Group();
    if (e.type === 'BUS') {
      g.position.set(0, 0, e.z);
      const pcs = busGeom(e, e.gis);
      this.addPieces(pcs, g, e.id, { elem: e.id });
      g.traverse(o => { if (o.isMesh || o.isLineSegments) o.userData.own = true; });
      this.root.add(g); return;
    }
    g.position.set(e.x, 0, e.z); g.rotation.y = e.rot || 0;
    const gis = !!e.gis;
    this.addPieces(model(tk(e.type), gis), g, e.id, { elem: e.id });
    if (!gis && e.type === 'DS') {
      // dua belahan pisau per fasa, berputar horizontal di atas isolator
      const bp = model('DS_BLADE', false);
      this.blades[e.id] = PH.flatMap(p => [-1, 1].map(side => {
        const pv = new THREE.Group();
        pv.position.set(p, DS_PIVOT.y, side * DS_PIVOT.z);
        pv.userData.side = side;
        this.addPieces(bp, pv, e.id, { elem: e.id });
        g.add(pv); return pv;
      }));
    }
    if (!gis && e.type === 'ES') {
      const bp = model('ES_BLADE', false);
      this.blades[e.id] = PH.map(p => {
        const pv = new THREE.Group();
        pv.position.set(p, ES_PIVOT.y, ES_PIVOT.z);
        this.addPieces(bp, pv, e.id, { elem: e.id });
        g.add(pv); return pv;
      });
    }
    if (gis && e.type === 'CB') {
      const lc = new THREE.Group(); lc.position.set(1.3, 0, 0);
      this.addPieces(model('LCC', true), lc, 'lcc:' + e.id, { kind: 'LCC' });
      g.add(lc);
    }
    this.root.add(g);
  }

  // terminal dunia (array titik)
  term(e, t) {
    const c = Math.cos(e.rot || 0), s = Math.sin(e.rot || 0);
    const W = (lx, y, lz) => V(e.x + c * lx + s * lz, y, e.z - s * lx + c * lz);
    // SUTT: urutan dipilih agar konduktor dari gantry (x -3, 0, 3) tidak bersilangan
    if (e.type === 'LINE') return [W(-6, 18.4, 0), W(-6, 22.4, 0), W(6, 18.4, 0)];
    let pts;
    if (e.type === 'TR') pts = TR_TERM[t].map(([x, y, z]) => W(x, y, z));
    else {
      const T = (e.gis && TERM.GIS[tk(e.type)]) || TERM.AIS[tk(e.type)];
      const [lz, h] = T[t] || T.a;
      pts = T.s ? PH.map(p => W(p * T.s / 3, h, lz)) : [W(0, h, lz)];
    }
    return phaseSort(pts);
  }

  endPts(ref, other) {
    if (ref.includes('.')) { const [id, t] = ref.split('.'); return this.term(this.m.map[id], t); }
    const b = this.m.map[ref];
    const cl = x => Math.min(b.x1, Math.max(b.x0, x));
    if (b.gis) return other.slice(0, 1).map(p => V(cl(p.x), BUS_H.GIS, b.z));
    const H = BUS_H.AIS;
    if (other.length === 1) return [V(cl(other[0].x), H, b.z)];
    const alongX = Math.abs(other[0].x - other[2].x) >= Math.abs(other[0].z - other[2].z);
    const idx = [0, 1, 2].sort((i, j) => alongX ? other[i].x - other[j].x : other[i].z - other[j].z);
    const out = [];
    idx.forEach((i, r) => { out[i] = V(cl(other[i].x), H, b.z + PH[r]); });
    return out;
  }

  addLink(l) {
    const ea = this.m.map[l.a.split('.')[0]], eb = this.m.map[l.b.split('.')[0]];
    let A, B;
    if (ea.type === 'BUS') { B = this.endPts(l.b); A = this.endPts(l.a, B); }
    else { A = this.endPts(l.a); B = this.endPts(l.b, A); }
    const isMV = e => /^(KUB|FDR|TPS)/.test(e.type) || (e.type === 'BUS' && e.v20);
    const hall = e => !!e.gis;
    let paths = [];
    let style = 'line';
    if (isMV(ea) || isMV(eb)) {
      style = 'cable';
      // kabel 20 kV lewat jalur parit: depan gedung (dari trafo) atau belakang gedung (ke penyulang / trafo PS)
      const y = 0.08, q = B[0], Bd = this.m.building;
      const p = A.length > 1 ? A[1] : A[0];
      if (A.length > 1) for (const a of A) paths.push([a, V(a.x, y, a.z), V(p.x, y, p.z)]);
      const lane = /^(FDR|TPS)/.test(eb.type) ? Bd.z0 - 2 : Bd.z1 + 1.2;
      paths.push([p, V(p.x, y, p.z), V(p.x, y, lane), V(q.x, y, lane), V(q.x, y, q.z), q]);
    } else if (hall(ea) && hall(eb)) {
      this.addTube(A[0], B[0], l.over ? 4.8 : null); return;
    } else if (hall(ea) !== hall(eb)) {
      const [H_, O_] = hall(ea) ? [A, B] : [B, A];
      const q = O_[0], dir = Math.sign(H_[0].z - q.z) || 1;
      const cz = q.z + dir * 4.5;
      const cse = new THREE.Group(); cse.position.set(q.x, 0, cz);
      this.addPieces(model('CSE', false), cse, 'cse:' + l.a + l.b, { kind: 'CSE' });
      this.root.add(cse);
      // kabel tegangan tinggi dari GIS lewat parit kabel ke terminasi (CSE)
      const h = H_[0], y = 0.22;
      this.pushWire([[h, V(h.x, y, h.z), V(h.x, y, cz), V(q.x, y, cz)]], l, 'cable');
      const tw = 0.35;
      this.addFlat('TRENCH', 'trench', h.x - tw, h.x + tw, Math.min(h.z, cz), Math.max(h.z, cz), 0.1, 'conc', { h: 0.2 });
      this.addFlat('TRENCH', 'trench', Math.min(h.x, q.x) - tw, Math.max(h.x, q.x) + tw, cz - tw, cz + tw, 0.1, 'conc', { h: 0.2 });
      const tops = PH.map(p => V(q.x + p, 5.35, cz));
      O_.forEach((pt, i) => paths.push([tops[i] || tops[0], pt]));
    } else {
      // pasangan fasa: pilih urutan (lurus/terbalik) dengan jarak antarfasa terbesar
      if (A.length === 3 && B.length === 3 && !l.span) {
        const gap = Bq => Math.min(...[[0, 1], [1, 2], [0, 2]].map(([i, j]) => segDist(A[i], Bq[i], A[j], Bq[j])));
        const R = [...B].reverse();
        if (gap(R) > gap(B) + 0.05) B = R;
      }
      const n = Math.max(A.length, B.length);
      for (let i = 0; i < n; i++) {
        const p = A[Math.min(i, A.length - 1)], q = B[Math.min(i, B.length - 1)];
        if (l.span) paths.push(sag(p, q, 2.2));
        else if (l.over) paths.push([p, V(p.x, 13.3, p.z), V(q.x, 13.3, q.z), q]);
        else if (l.via) paths.push([p, V(p.x, l.via, p.z), V(q.x, l.via, q.z), q]);
        else paths.push([p, q]);
      }
      if (l.over) for (const z of [A[0].z, B[0].z]) {
        const xs = [...A, ...B].map(p => p.x);
        const pg = new THREE.Group(); pg.position.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, z);
        this.addPieces(model('PORTAL', false), pg, 'portal', { kind: 'PORTAL' });
        this.root.add(pg);
      }
    }
    this.pushWire(paths, l, style);
  }

  pushWire(paths, l, style) {
    const pos = [];
    for (const p of paths) for (let i = 0; i < p.length - 1; i++) pos.push(p[i].x, p[i].y, p[i].z, p[i + 1].x, p[i + 1].y, p[i + 1].z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const obj = new THREE.LineSegments(geo, W_LIVE);
    obj.userData.own = true;
    this.root.add(obj);
    this.wires.push({ obj, ref: l.a, style, paths, link: l });
  }

  addTube(p, q, overH) {
    const pts = overH ? [p, V(p.x, overH, p.z), V(q.x, overH, q.z), q] : [p, V(p.x, p.y, q.z), V(q.x, p.y, q.z), q];
    const P = new Parts();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = a.distanceTo(b);
      if (len < 0.05) continue;
      const g = new THREE.CylinderGeometry(0.17, 0.17, len, 10);
      const dir = b.clone().sub(a).normalize();
      const qn = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      g.applyQuaternion(qn); g.translate(mid.x, mid.y, mid.z);
      (P.cur.g.body ||= []).push(g);
    }
    const pcs = P.build();
    if (!pcs.length) return;
    const grp = new THREE.Group();
    this.addPieces(pcs, grp, 'tube', { kind: 'GISDUCT' });
    grp.traverse(o => { o.userData.own = true; });
    this.root.add(grp);
  }

  // ───────────────────────── dekor ─────────────────────────
  deco(name, kind, x, z, rot = 0, mdl, gis = false) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    this.addPieces(model(mdl || kind, gis), g, name, { kind });
    this.root.add(g); return g;
  }

  addFlat(kind, key, x0, x1, z0, z1, y, mat, opts = {}) {
    const P = new Parts();
    P.box(mat, x1 - x0, opts.h || 0.04, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2);
    const g = new THREE.Group();
    const pcs = P.build();
    if (opts.noEdge) pcs.forEach(p => { p.edges = null; });
    this.addPieces(pcs, g, key, { kind });
    g.traverse(o => { o.userData.own = true; });
    this.root.add(g); return g;
  }

  addDecor() {
    const m = this.m, B = m.building;
    // batas switchyard
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    for (const e of m.els) {
      if (e.type === 'LINE' || e.type === 'FDR') continue;
      if (e.type === 'BUS') { grow(e.x0, e.z); grow(e.x1, e.z); } else grow(e.x, e.z);
    }
    const yard = { x0: x0 - 7, x1: x1 + 7, z0: B.z1 + 1, z1: z1 + 4 };
    const F = { x0: Math.min(yard.x0, B.x0 - 8), x1: Math.max(yard.x1, B.x1 + 12), z0: B.z0 - 4, z1: yard.z1 + 2 };
    this.bounds = F;
    // halaman kerikil + grid pentanahan
    this.addFlat('YARD', 'yard', F.x0, F.x1, F.z0, F.z1, 0.02, 'conc', { noEdge: true });
    const gl = [];
    for (let x = Math.ceil(F.x0 / 6) * 6; x < F.x1; x += 6) gl.push(x, 0.05, F.z0, x, 0.05, F.z1);
    for (let z = Math.ceil(F.z0 / 6) * 6; z < F.z1; z += 6) gl.push(F.x0, 0.05, z, F.x1, 0.05, z);
    this.addLines(gl, GRID_LINE);
    // pagar dengan gerbang di sisi -x
    const roadZ = B.z1 + 4;
    const fl = [], post = [];
    const seg = (ax, az, bx, bz) => {
      fl.push(ax, 2.4, az, bx, 2.4, bz, ax, 1.2, az, bx, 1.2, bz);
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 3);
      for (let i = 0; i <= n; i++) { const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; post.push(x, 0, z, x, 2.5, z); }
    };
    seg(F.x0, F.z0, F.x1, F.z0); seg(F.x1, F.z0, F.x1, F.z1); seg(F.x1, F.z1, F.x0, F.z1);
    seg(F.x0, F.z1, F.x0, roadZ + 3); seg(F.x0, roadZ - 3, F.x0, F.z0);
    this.addLines([...fl, ...post], DECO_LINE);
    const fw = 0.06;
    for (const [a, b, c, d] of [[F.x0, F.x1, F.z0 - fw, F.z0 + fw], [F.x0, F.x1, F.z1 - fw, F.z1 + fw], [F.x1 - fw, F.x1 + fw, F.z0, F.z1], [F.x0 - fw, F.x0 + fw, F.z0, F.z1]]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b - a, 2.5, d - c), GHOST);
      mesh.position.set((a + b) / 2, 1.25, (c + d) / 2);
      mesh.userData = { key: 'fence', kind: 'FENCE', own: true };
      this.root.add(mesh); this.pick.push(mesh); this.regAdd(['fence'], mesh);
    }
    // jalan
    this.addFlat('ROAD', 'road', F.x0 - 25, F.x1 - 4, roadZ - 2, roadZ + 2, 0.05, 'steel', { h: 0.06, noEdge: true });
    this.deco('guard', 'GUARD', F.x0 + 3.5, roadZ + 6.5, 0);
    this.deco('human', 'HUMAN', B.bx - 2, roadZ + 0.5, 0.6);
    // saluran kabel
    const trZ = roadZ + 2.7;
    this.addFlat('TRENCH', 'trench', yard.x0 + 2, yard.x1 - 2, trZ - 0.4, trZ + 0.4, 0.1, 'conc', { h: 0.2 });
    this.addFlat('TRENCH', 'trench', B.bx - 0.4, B.bx + 0.4, B.z1, roadZ - 2, 0.1, 'conc', { h: 0.2 });
    const cols = new Map();
    for (const e of m.els) if (e.type === 'CB' && !e.gis && e.z > trZ) {
      const cx = Math.round(e.x);
      cols.set(cx, Math.max(cols.get(cx) ?? -1e9, e.z));
    }
    for (const [cx, z] of cols) {
      const x = cx + 4.6;
      if (x < yard.x1 - 1) this.addFlat('TRENCH', 'trench', x - 0.35, x + 0.35, trZ, z, 0.1, 'conc', { h: 0.2 });
    }
    // tiang penangkal petir
    const mz0 = trZ + 6, mz1 = yard.z1 - 3;
    [[yard.x0 + 1, mz0], [yard.x1 - 1, mz0], [yard.x0 + 1, mz1], [yard.x1 - 1, mz1]].forEach(([x, z], i) => this.deco('mast' + i, 'MAST', x, z));
    // dinding api di antara trafo yang berdekatan
    const trs = m.els.filter(e => e.type === 'TR').sort((a, b) => a.x - b.x);
    for (let i = 0; i < trs.length - 1; i++) {
      const a = trs[i], b = trs[i + 1];
      if (Math.abs(a.z - b.z) < 3 && b.x - a.x < 20) this.deco('fw' + i, 'FIREWALL', (a.x + b.x) / 2, (a.z + b.z) / 2, 0);
    }
    // gedung kontrol
    this.addBuilding(B);
    this.deco('genset', 'GENSET', B.x1 + 8.5, B.z1 - 11.5, Math.PI / 2);
    // gedung GIS
    if (m.hall) this.addHall(m.hall);
    // kawat tanah & lanjutan saluran
    const sl = [];
    for (const e of m.els) if (e.type === 'LINE') {
      const gt = m.map[e.id + '_GT'];
      for (const sx of [-6.3, 6.3]) sl.push(gt.x + sx, 14.6, gt.z, e.x, 31, e.z);
      for (const p of this.term(e, 'a')) sl.push(p.x, p.y, p.z, p.x, p.y + 3, p.z + 120);
      sl.push(e.x, 31, e.z, e.x, 31, e.z + 120);
    }
    this.addLines(sl, DECO_LINE);
  }

  addLines(arr, mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const o = new THREE.LineSegments(g, mat); o.userData.own = true; this.root.add(o);
  }

  addBuilding(B) {
    const P = new Parts().piece(null);
    const T = 0.25, Hh = 3.8, bx = B.bx;
    P.box('conc', B.x1 - B.x0 + 1, 0.3, B.z1 - B.z0 + 1, (B.x0 + B.x1) / 2, 0.15, (B.z0 + B.z1) / 2);
    const wallX = (xa, xb, z) => { if (xb - xa > 0.05) P.box('wall', xb - xa, Hh, T, (xa + xb) / 2, Hh / 2 + 0.3, z); };
    const wallZ = (za, zb, x) => { if (zb - za > 0.05) P.box('wall', T, Hh, zb - za, x, Hh / 2 + 0.3, (za + zb) / 2); };
    wallX(B.x0, B.x1, B.z0); wallZ(B.z0, B.z1, B.x0); wallZ(B.z0, B.z1, B.x1);
    const doors = [bx - 12, bx + 6, bx + 15.5];
    let xa = B.x0;
    for (const d of doors) { wallX(xa, d - 0.9, B.z1); xa = d + 0.9; }
    wallX(xa, B.x1, B.z1);
    for (const x of [bx + 2, bx + 13]) { wallZ(B.z0, B.z1 - 3, x); wallZ(B.z1 - 1.2, B.z1, x); }
    const g = new THREE.Group();
    this.addPieces(P.build(), g, 'bld', { kind: 'BLD' });
    g.traverse(o => { o.userData.own = true; });
    this.root.add(g);
    // isi ruang kontrol
    const kinds = ['PANEL', 'PANEL', 'PANEL', 'PANEL', 'PROT', 'PROT', 'PROT', 'PROT', 'RTU', 'TELE'];
    kinds.forEach((k, i) => this.deco('pnl' + i, k, bx + 3.2 + i * 0.84, B.z0 + 0.6, 0, 'PANEL'));
    ['RECT', 'RECT', 'ACDC'].forEach((k, i) => this.deco('dc' + i, k, bx + 12.4, B.z0 + 6.5 + i * 0.84, -Math.PI / 2, 'PANEL'));
    this.deco('hmi', 'HMI', bx + 7.5, B.z0 + 6.5, Math.PI, 'DESK');
    this.deco('bat0', 'BAT', bx + 15.5, B.z0 + 2.5, 0);
    this.deco('bat1', 'BAT', bx + 15.5, B.z0 + 5.0, 0);
  }

  addHall(h) {
    const P = new Parts();
    P.box('conc', h.x1 - h.x0, 0.2, h.z1 - h.z0, (h.x0 + h.x1) / 2, 0.1, (h.z0 + h.z1) / 2);
    for (const z of [h.z0 + 0.5, h.z1 - 0.5]) P.box('steel', h.x1 - h.x0, 0.3, 0.3, (h.x0 + h.x1) / 2, 7.2, z);
    P.box('dark', 0.5, 0.6, h.z1 - h.z0 - 1, h.x0 + 3, 7.6, (h.z0 + h.z1) / 2);
    const g = new THREE.Group();
    this.addPieces(P.build(), g, 'hall', { kind: 'GIS_HALL' });
    // dinding transparan
    const W = h.x1 - h.x0, D = h.z1 - h.z0, Hh = 8.5;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, D), GLASS);
    walls.position.set((h.x0 + h.x1) / 2, Hh / 2, (h.z0 + h.z1) / 2);
    walls.renderOrder = 2;
    const eg = new THREE.LineSegments(new THREE.EdgesGeometry(walls.geometry), EDGE);
    eg.position.copy(walls.position);
    g.add(walls, eg);
    g.traverse(o => { o.userData.own = true; });
    this.root.add(g);
  }

  buildLabels() {
    this.labelEl.innerHTML = '';
    const L = (text, p) => {
      const d = document.createElement('div'); d.className = 'lb'; d.textContent = text;
      this.labelEl.appendChild(d); this.labels.push({ d, p });
    };
    for (const e of this.m.els) {
      if (e.type === 'LINE') L(e.tag, V(e.x, 33, e.z));
      else if (e.type === 'TR') L(e.label, V(e.x, 9, e.z));
      else if (e.type === 'BUS' && !e.v20) L(e.label, V(e.x0, (e.gis ? BUS_H.GIS : BUS_H.AIS) + 1.6, e.z));
    }
    const B = this.m.building;
    L('Gedung kontrol & kubikel 20 kV', V(B.bx, 5.5, B.z1));
    if (this.m.hall) L('Gedung GIS', V((this.m.hall.x0 + this.m.hall.x1) / 2, 9.5, this.m.hall.z1));
  }

  updateLabels() {
    const w = this.el.clientWidth, h = this.el.clientHeight, v = new THREE.Vector3();
    const show = this.showLabels && !this.walk.on;
    this.labelEl.style.display = show ? '' : 'none';
    if (!show) return;
    for (const { d, p } of this.labels) {
      v.copy(p).project(this.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      d.style.display = vis ? '' : 'none';
      if (vis) d.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px,${((1 - v.y) / 2 * h).toFixed(1)}px)`;
    }
  }

  // ───────────────────────── status simulasi ─────────────────────────
  setState(sim) {
    const st = sim.state;
    for (const w of this.wires) {
      w.obj.material = w.ref.endsWith('.n') || st.isLive(w.ref) ? W_LIVE : st.isEarth(w.ref) ? W_EARTH : W_DEAD;
    }
    for (const id in this.blades) {
      const e = this.m.map[id], closed = sim.sw[id];
      for (const b of this.blades[id]) {
        // PMS: belahan sisi -z menghadap +z, sisi +z menghadap -z; terbuka = keduanya berputar 90° ke +x
        if (e.type === 'DS') b.rotation.y = closed ? (b.userData.side < 0 ? 0 : Math.PI) : Math.PI / 2;
        else b.rotation.x = closed ? 0 : Math.PI / 2;
      }
    }
    this.dirty = true;
  }

  // ───────────────────────── seleksi ─────────────────────────
  select(key) {
    if (this.sel) for (const o of this.reg.get(this.sel) || []) {
      if (o.isMesh) o.material = o.userData.mat; else o.material = EDGE;
    }
    this.sel = key && this.reg.has(key) ? key : null;
    if (this.sel) for (const o of this.reg.get(this.sel)) {
      if (o.isMesh) o.material = MAT_SEL; else o.material = EDGE_SEL;
    }
    this.dirty = true;
  }

  boxOf(key) {
    const b = new THREE.Box3();
    for (const o of this.reg.get(key) || []) if (o.isMesh) b.expandByObject(o);
    return b;
  }

  flyTo(key) {
    const b = this.boxOf(key);
    if (b.isEmpty()) return;
    if (this.walk.on) this.setMode('orbit');
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.25) { dir.y = 0.35; dir.normalize(); }
    this.animTo(c.clone().add(dir.multiplyScalar(Math.max(8, s * 1.8))), c);
  }

  animTo(pos, target, ms = 700) {
    this.anim = { t0: performance.now(), ms, p0: this.camera.position.clone(), t0v: this.controls.target.clone(), p1: pos, t1: target };
  }

  home(instant) {
    const F = this.bounds;
    const cx = (F.x0 + F.x1) / 2, cz = (F.z0 + F.z1) / 2;
    const S = Math.max(F.x1 - F.x0, F.z1 - F.z0) * (this.camera.aspect < 1 ? Math.min(1.9, 1 / this.camera.aspect) : 1);
    const tgt = V(cx, 0, cz), pos = V(cx + S * 0.55, S * 0.55, cz + S * 0.62);
    if (instant) { this.camera.position.copy(pos); this.controls.target.copy(tgt); this.controls.update(); this.dirty = true; }
    else this.animTo(pos, tgt);
  }

  setMode(mode) {
    const w = this.walk;
    if (mode === 'walk') {
      if (w.on) return;
      w.on = true; this.controls.enabled = false;
      const d = this.controls.target.clone().sub(this.camera.position);
      w.yaw = Math.atan2(-d.x, -d.z); w.pitch = 0;
      const F = this.bounds;
      const p = this.camera.position;
      if (p.y > 30) { p.set(F.x0 + 6, 1.7, this.m.building.z1 + 4); w.yaw = -Math.PI / 2 - 0.3; }
      p.y = 1.7;
      this.anim = null;
    } else {
      if (w.on) {
        w.on = false; this.controls.enabled = true;
        const d = this.lookDir();
        this.controls.target.copy(this.camera.position.clone().add(d.multiplyScalar(12)));
        this.controls.target.y = Math.max(0, this.controls.target.y);
      }
      if (mode === 'top') {
        const F = this.bounds, cx = (F.x0 + F.x1) / 2, cz = (F.z0 + F.z1) / 2;
        const h = Math.max(F.z1 - F.z0, (F.x1 - F.x0) / this.camera.aspect) / 0.93 * 1.08;
        this.animTo(V(cx, h, cz + 0.5), V(cx, 0, cz));
      }
    }
    this.dirty = true;
  }

  lookDir() {
    const { yaw, pitch } = this.walk;
    return V(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  }

  // ───────────────────────── input ─────────────────────────
  bindEvents() {
    const cv = this.renderer.domElement;
    let down = null; const ptrs = new Map();
    cv.addEventListener('pointerdown', ev => {
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      down = ptrs.size === 1 ? { x: ev.clientX, y: ev.clientY, t: performance.now() } : null;
      if (this.walk.on) cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener('pointermove', ev => {
      const p = ptrs.get(ev.pointerId);
      if (this.walk.on && p) {
        this.walk.yaw -= (ev.clientX - p.x) * 0.005;
        this.walk.pitch = Math.max(-1.2, Math.min(1.2, this.walk.pitch - (ev.clientY - p.y) * 0.005));
        this.dirty = true;
      }
      if (p) { p.x = ev.clientX; p.y = ev.clientY; }
    });
    const up = ev => {
      ptrs.delete(ev.pointerId);
      if (down && ev.type === 'pointerup' && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 7 && performance.now() - down.t < 600) this.doPick(ev);
      down = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    window.addEventListener('keydown', ev => {
      if (!this.walk.on || ev.target.tagName === 'INPUT') return;
      this.walk.keys.add(ev.key.toLowerCase());
    });
    window.addEventListener('keyup', ev => this.walk.keys.delete(ev.key.toLowerCase()));
    window.addEventListener('blur', () => this.walk.keys.clear());
  }

  doPick(ev) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hit = this.ray.intersectObjects(this.pick, false)[0];
    this.onPick(hit ? hit.object.userData : null);
  }

  // ───────────────────────── loop ─────────────────────────
  tick(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
    if (!this.active) return;
    let ch = false;
    if (this.anim) {
      const a = this.anim, k = Math.min(1, (t - a.t0) / a.ms), e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(a.p0, a.p1, e);
      this.controls.target.lerpVectors(a.t0v, a.t1, e);
      if (k >= 1) this.anim = null;
      ch = true;
    }
    if (this.walk.on) {
      const w = this.walk, K = w.keys;
      let f = -w.jy, s = w.jx;
      if (K.has('w') || K.has('arrowup')) f += 1;
      if (K.has('s') || K.has('arrowdown')) f -= 1;
      if (K.has('a') || K.has('arrowleft')) s -= 1;
      if (K.has('d') || K.has('arrowright')) s += 1;
      const sp = (K.has('shift') ? 12 : 5) * dt;
      if (f || s) {
        const p = this.camera.position;
        p.x += (-Math.sin(w.yaw) * f + Math.cos(w.yaw) * s) * sp;
        p.z += (-Math.cos(w.yaw) * f - Math.sin(w.yaw) * s) * sp;
        ch = true;
      }
      this.camera.position.y = 1.7;
      this.camera.lookAt(this.camera.position.clone().add(this.lookDir()));
    } else if (this.controls.update()) ch = true;
    if (ch || this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
      this.dirty = false;
    }
  }
}

function sag(p, q, s) {
  const out = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    out.push(V(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t - 4 * s * t * (1 - t), p.z + (q.z - p.z) * t));
  }
  return out;
}

// urutan fasa konsisten (R-S-T) menurut posisi dunia, sehingga perangkat yang diputar 180° tidak membuat konduktor bersilang
function phaseSort(pts) {
  if (pts.length < 3) return pts;
  const dx = Math.abs(pts[0].x - pts[2].x), dz = Math.abs(pts[0].z - pts[2].z);
  return [...pts].sort((a, b) => dx >= dz ? a.x - b.x : a.z - b.z);
}

// jarak minimum dua segmen 3D
function segDist(a, b, c, d) {
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const A = u.dot(u), B = u.dot(v), C = v.dot(v), D = u.dot(w), E = v.dot(w), den = A * C - B * B;
  let sN, sD = den, tN, tD = den;
  if (den < 1e-9) { sN = 0; sD = 1; tN = E; tD = C; }
  else { sN = B * E - C * D; tN = A * E - B * D; if (sN < 0) { sN = 0; tN = E; tD = C; } else if (sN > sD) { sN = sD; tN = E + B; tD = C; } }
  if (tN < 0) { tN = 0; sN = Math.min(Math.max(-D, 0), A); sD = A; } else if (tN > tD) { tN = tD; sN = Math.min(Math.max(B - D, 0), A); sD = A; }
  const sc = Math.abs(sN) < 1e-9 ? 0 : sN / sD, tc = Math.abs(tN) < 1e-9 ? 0 : tN / tD;
  return w.add(u.multiplyScalar(sc)).sub(v.multiplyScalar(tc)).length();
}
