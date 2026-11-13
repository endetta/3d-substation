// Audit topologi semua konfigurasi: node tools/audit-topology.mjs
import { buildModel, elemTerms, CB_T, PASS_T } from '../src/model.js';
import { CONFIGS } from '../src/info.js';
import { Sim } from '../src/sim.js';

class UF {
  constructor() { this.p = new Map(); }
  f(k) { if (!this.p.has(k)) this.p.set(k, k); let r = k; while (this.p.get(r) !== r) r = this.p.get(r); this.p.set(k, r); return r; }
  u(a, b) { this.p.set(this.f(a), this.f(b)); }
}
const partition = (m, filt) => {
  const uf = new UF();
  for (const e of m.els) for (const k of elemTerms(e)) uf.f(k);
  for (const l of m.links) if (filt(l)) uf.u(l.a, l.b);
  const groups = new Map();
  for (const k of uf.p.keys()) { const r = uf.f(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); }
  return { uf, sig: [...groups.values()].map(g => g.sort().join('|')).sort() };
};

let bad = 0;
const fail = (cfg, msg) => { bad++; console.log(`✗ ${cfg}: ${msg}`); };

for (const { id } of CONFIGS) for (const tech of ['AIS', 'GIS']) {
  const tag = `${id}/${tech}`;
  const m = buildModel(id, tech);
  // 1. referensi link valid
  for (const l of m.links) for (const r of [l.a, l.b]) {
    const [eid, t] = r.split('.');
    const e = m.map[eid];
    if (!e) fail(tag, `link ke elemen tak dikenal ${r}`);
    else if (!elemTerms(e).includes(r)) fail(tag, `terminal tak dikenal ${r}`);
  }
  // 2. partisi SLD == 3D (untuk elemen yang tampil di keduanya)
  const all = partition(m, () => true);
  const s = partition(m, l => l.s !== false), t = partition(m, l => l.t !== false);
  const hidden = new Set(m.els.filter(e => e.sld === false).flatMap(elemTerms));
  for (const [name, P] of [['SLD', s], ['3D', t]]) {
    for (const e of m.els) for (const k of elemTerms(e)) {
      if (name === 'SLD' && hidden.has(k)) continue;
      for (const e2 of m.els) for (const k2 of elemTerms(e2)) {
        if (k2 <= k || (name === 'SLD' && hidden.has(k2))) continue;
        const same = all.uf.f(k) === all.uf.f(k2), sameP = P.uf.f(k) === P.uf.f(k2);
        if (same !== sameP) fail(tag, `${name}: ${k} ~ ${k2} ${same ? 'terputus' : 'tersambung lebih'}`);
      }
    }
  }
  // 3. terminal mengambang
  const used = new Set(m.links.flatMap(l => [l.a, l.b]));
  for (const e of m.els) for (const k of elemTerms(e)) if (!used.has(k)) fail(tag, `terminal tidak tersambung ${k}`);
  // 4. perangkat seri terhubung pendek oleh link
  for (const e of m.els) if (CB_T.has(e.type) || e.type === 'DS' || PASS_T.has(e.type) || e.type === 'TR') {
    if (all.uf.f(e.id + '.a') === all.uf.f(e.id + '.b')) fail(tag, `${e.id} terhubung pendek (a = b)`);
  }
  // 5. tiap PMT 150 kV bisa diisolasi: dari tiap sisi harus bertemu PMS/trafo sebelum rel, saluran, atau PMT lain
  const adj = new Map();
  for (const l of m.links) for (const [a, b] of [[l.a, l.b], [l.b, l.a]]) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
  for (const e of m.els) if (e.type === 'CB') for (const side of ['a', 'b']) {
    const seen = new Set([e.id + '.' + side]), q = [e.id + '.' + side];
    let ok = true;
    while (q.length) {
      const k = q.pop();
      for (const n of adj.get(k) || []) {
        if (seen.has(n)) continue; seen.add(n);
        const [nid, nt] = n.split('.'), ne = m.map[nid];
        if (ne.type === 'DS' || ne.type === 'TR') continue;           // terisolasi di sini
        if (ne.type === 'BUS' || ne.type === 'LINE' || CB_T.has(ne.type)) { ok = false; continue; }
        if (PASS_T.has(ne.type) && nt) { const o = nid + '.' + (nt === 'a' ? 'b' : 'a'); if (!seen.has(o)) { seen.add(o); q.push(o); } }
        q.push(n);
      }
    }
    if (!ok) fail(tag, `${e.id} sisi ${side} tidak bisa diisolasi PMS`);
  }
  // 6. urutan bay penghantar dari saluran: LINE → LA → CVT → WT → PMS line (WT di sisi GI dari CVT)
  for (const e of m.els) if (e.type === 'LINE') {
    const order = [];
    let k = e.id + '.a'; const seen = new Set();
    for (let i = 0; i < 12 && k; i++) {
      seen.add(k);
      const nbs = (adj.get(k) || []).filter(n => !seen.has(n));
      for (const n of nbs) { seen.add(n); const t = m.map[n.split('.')[0]].type; if (!order.includes(t)) order.push(t); }
      const ser = nbs.find(n => ['WT', 'DS', 'CT', 'CB'].includes(m.map[n.split('.')[0]].type));
      k = ser ? ser.split('.')[0] + '.' + (ser.endsWith('.a') ? 'b' : 'a') : null;
    }
    const i = t => order.indexOf(t);
    if (!(i('CVT') < i('WT') && i('WT') < i('DS') && i('LA') < i('WT'))) fail(tag, `${e.id}: urutan bay penghantar salah (${order.join(' → ')})`);
  }
  // 7. kondisi normal: semua penyulang menyala, tidak ada hubung singkat
  const sim = new Sim(m);
  const f = sim.feeders();
  if (f.on !== f.total) fail(tag, `kondisi normal hanya ${f.on}/${f.total} penyulang menyala`);
  if (sim.state.short) fail(tag, 'kondisi normal: PMS tanah tertutup pada bagian bertegangan');
  // 8. tiap trafo dan saluran punya CT pada jalur proteksinya (CT bersebelahan dengan PMT)
  for (const e of m.els) if (e.type === 'CB') {
    const nb = [...(adj.get(e.id + '.a') || []), ...(adj.get(e.id + '.b') || [])].map(k => m.map[k.split('.')[0]].type);
    if (!nb.includes('CT')) fail(tag, `${e.id} tanpa CT bersebelahan`);
  }
  // 9. posisi SLD tidak saling tumpang
  const pos = new Map();
  for (const e of m.els) if (e.sld !== false && e.type !== 'BUS') {
    const k = `${Math.round(e.sx)},${Math.round(e.sy)}`;
    if (pos.has(k)) fail(tag, `SLD tumpang: ${e.id} dan ${pos.get(k)}`); else pos.set(k, e.id);
  }
}
console.log(bad ? `\n${bad} masalah` : 'Topologi OK: semua konfigurasi lolos.');
process.exit(bad ? 1 : 0);
