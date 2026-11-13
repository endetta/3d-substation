// Audit geometri wiring 3D (dijalankan di browser):
//   const a = await import('/tools/audit3d.js'); a.audit(__gi.v3)
import * as THREE from 'three';

const CLEAR = 1.3;          // jarak bebas minimum 150 kV (m)
const NEAR_TERM = 1.2;      // abaikan titik di dekat terminal (konduktor memang bertemu di sana)
const SKIP_KIND = new Set(['YARD', 'ROAD', 'TRENCH', 'FENCE', 'GIS_HALL', 'GISDUCT', 'CSE']);

function segDist(a, b, c, d) { // jarak minimum dua segmen
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const A = u.dot(u), B = u.dot(v), C = v.dot(v), D = u.dot(w), E = v.dot(w), den = A * C - B * B;
  let sN, sD = den, tN, tD = den;
  if (den < 1e-9) { sN = 0; sD = 1; tN = E; tD = C; }
  else { sN = B * E - C * D; tN = A * E - B * D; if (sN < 0) { sN = 0; tN = E; tD = C; } else if (sN > sD) { sN = sD; tN = E + B; tD = C; } }
  if (tN < 0) { tN = 0; sN = Math.min(Math.max(-D, 0), A); sD = A; }
  else if (tN > tD) { tN = tD; sN = Math.min(Math.max(B - D, 0), A); sD = A; }
  const sc = Math.abs(sN) < 1e-9 ? 0 : sN / sD, tc = Math.abs(tN) < 1e-9 ? 0 : tN / tD;
  return w.add(u.multiplyScalar(sc)).sub(v.multiplyScalar(tc)).length();
}

export function audit(v3) {
  const m = v3.m, out = [];
  const elemOf = r => r.split('.')[0];
  // node berdasarkan link saja
  const par = new Map();
  const f = k => { if (!par.has(k)) par.set(k, k); let r = k; while (par.get(r) !== r) r = par.get(r); return r; };
  for (const l of m.links) par.set(f(l.a), f(l.b));
  const wires = v3.wires.filter(w => w.style !== 'cable');
  const terms = [];
  for (const w of v3.wires) for (const p of w.paths) { terms.push(p[0], p[p.length - 1]); }
  const nearTerm = q => terms.some(t => t.distanceTo(q) < NEAR_TERM);

  // 1. konduktor menembus peralatan
  const ray = new THREE.Raycaster();
  for (const w of v3.wires) {
    const own = new Set([elemOf(w.link.a), elemOf(w.link.b)]);
    for (const path of w.paths) for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], len = a.distanceTo(b);
      if (len < 0.6) continue;
      ray.set(a, b.clone().sub(a).normalize()); ray.near = 0.3; ray.far = len - 0.3;
      for (const h of ray.intersectObjects(v3.pick, false)) {
        const ud = h.object.userData;
        if (SKIP_KIND.has(ud.kind) || own.has(ud.elem) || ud.key === 'portal') continue;
        if (w.style === 'cable' && (ud.elem && /^(KUB|TR)/.test(m.map[ud.elem]?.type || '') || ud.key === 'bld')) continue;
        out.push(`menembus: ${w.link.a}–${w.link.b} melewati ${ud.elem || ud.key}`);
        break;
      }
    }
  }
  // 2. tinggi dari tanah (konduktor udara)
  for (const w of wires) for (const path of w.paths) for (const q of path) {
    if (q.y < 4.0 && !nearTerm(q) && !w.link.a.endsWith('.n')) { out.push(`rendah: ${w.link.a}–${w.link.b} y=${q.y.toFixed(2)}`); break; }
  }
  // 3. persilangan fasa dalam satu link (tampak atas) dan jarak fasa–fasa
  for (const w of wires) {
    const P = w.paths; if (P.length < 3) continue;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      let dmin = 1e9;
      for (let a = 0; a < P[i].length - 1; a++) for (let b = 0; b < P[j].length - 1; b++) {
        const pa = P[i][a], pb = P[i][a + 1], qa = P[j][b], qb = P[j][b + 1];
        // abaikan ruas yang berujung di terminal yang rapat (bushing trafo, terminal tunggal)
        const d = segDist(pa, pb, qa, qb);
        const mid = pa.clone().add(pb).multiplyScalar(0.5), mid2 = qa.clone().add(qb).multiplyScalar(0.5);
        if (nearTerm(mid) || nearTerm(mid2)) continue;
        dmin = Math.min(dmin, d);
      }
      if (dmin < CLEAR) out.push(`fasa rapat/bersilang: ${w.link.a}–${w.link.b} fasa ${i}/${j} jarak ${dmin.toFixed(2)} m`);
    }
  }
  // 4. jarak bebas antar node berbeda (termasuk rel)
  const segs = [];
  for (const w of wires) for (const path of w.paths) for (let i = 0; i < path.length - 1; i++) segs.push({ a: path[i], b: path[i + 1], n: f(w.link.a), id: `${w.link.a}–${w.link.b}` });
  for (const e of m.els) if (e.type === 'BUS' && !e.v20 && !e.gis) for (const dz of [-3, 0, 3])
    segs.push({ a: new THREE.Vector3(e.x0, 8, e.z + dz), b: new THREE.Vector3(e.x1, 8, e.z + dz), n: f(e.id), id: e.id });
  const seen = new Set();
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s1 = segs[i], s2 = segs[j];
    if (s1.n === s2.n) continue;
    const d = segDist(s1.a, s1.b, s2.a, s2.b);
    if (d >= CLEAR) continue;
    // titik terdekat di dekat terminal perangkat (mis. dua sisi PMS) bukan pelanggaran
    const mids = [s1.a, s1.b, s2.a, s2.b];
    if (mids.some(q => [s1, s2].some(s => segDist(q, q, s.a, s.b) < 0.05) && nearTerm(q))) continue;
    const k = [s1.id, s2.id].sort().join(' × ');
    if (!seen.has(k)) { seen.add(k); out.push(`jarak antar node ${d.toFixed(2)} m: ${k}`); }
  }
  return out;
}
