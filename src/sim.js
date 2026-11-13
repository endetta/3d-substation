import { CB_T, SW_T, PASS_T, elemTerms } from './model.js';

class UF {
  constructor() { this.p = new Map(); }
  f(k) {
    if (!this.p.has(k)) { this.p.set(k, k); return k; }
    let r = k; while (this.p.get(r) !== r) r = this.p.get(r);
    let c = k; while (this.p.get(c) !== r) { const n = this.p.get(c); this.p.set(c, r); c = n; }
    return r;
  }
  u(a, b) { const ra = this.f(a), rb = this.f(b); if (ra !== rb) this.p.set(ra, rb); }
}

const ref = r => r; // "ID.a" atau "BUS"

export class Sim {
  constructor(model, prev) {
    this.m = model;
    this.sw = {}; this.faults = new Set();
    for (const e of model.els) if (SW_T.has(e.type)) this.sw[e.id] = e.def ?? (e.type !== 'ES');
    if (prev) {
      for (const k in prev.sw) if (k in this.sw) this.sw[k] = prev.sw[k];
      for (const f of prev.faults) if (model.map[f]) this.faults.add(f);
    }
    // adjacency link per terminal
    this.adj = new Map();
    const add = (a, b) => { if (!this.adj.has(a)) this.adj.set(a, []); this.adj.get(a).push(b); };
    for (const l of model.links) { add(ref(l.a), ref(l.b)); add(ref(l.b), ref(l.a)); }
    this.state = this.compute();
  }

  compute(sw = this.sw, faults = this.faults, killFault = true) {
    const uf = new UF();
    for (const l of this.m.links) uf.u(l.a, l.b);
    for (const e of this.m.els) {
      const t = e.type;
      if (PASS_T.has(t) || ((CB_T.has(t) || t === 'DS') && sw[e.id])) uf.u(e.id + '.a', e.id + '.b');
      else if (t === 'TR' && !faults.has(e.id)) uf.u(e.id + '.a', e.id + '.b');
    }
    const live = new Set(), earth = new Set(), dead = new Set();
    for (const e of this.m.els) {
      if (e.type === 'LINE' && !faults.has(e.id)) live.add(uf.f(e.id + '.a'));
      if (e.type === 'ES' && sw[e.id]) earth.add(uf.f(e.id + '.a'));
    }
    const flt = new Set();
    for (const f of faults) for (const k of elemTerms(this.m.map[f])) flt.add(uf.f(k));
    if (killFault) for (const r of flt) live.delete(r);
    const st = {
      uf, live, earth, flt,
      isLive: k => live.has(uf.f(k)),
      isEarth: k => earth.has(uf.f(k)),
    };
    st.loads = this.m.els.filter(e => (e.type === 'TR' && st.isLive(e.id + '.a') && st.isLive(e.id + '.b'))
      || ((e.type === 'FDR' || e.type === 'TPS') && st.isLive(e.id + '.a'))).map(e => e.id).sort().join(',');
    st.short = [...live].some(r => earth.has(r));
    return st;
  }

  elemLive(e, st = this.state) { return elemTerms(e).some(k => st.isLive(k)); }
  elemEarth(e, st = this.state) { return elemTerms(e).some(k => st.isEarth(k)); }

  feeders() {
    const f = this.m.els.filter(e => e.type === 'FDR');
    return { on: f.filter(e => this.state.isLive(e.id + '.a')).length, total: f.length };
  }

  toggle(id) {
    const e = this.m.map[id];
    const next = !this.sw[id];
    const before = this.state;
    const trial = { ...this.sw, [id]: next };
    const after = this.compute(trial);
    if (e.type === 'ES') {
      if (next && before.isLive(id + '.a')) return { ok: false, msg: id.endsWith('_ES') ? 'Sisi saluran masih bertegangan dari GI seberang. PMS tanah saluran ditutup setelah kedua ujung saluran dibebaskan.' : 'Masih bertegangan. Bebaskan dulu: buka PMT, lalu PMS.' };
    } else if (after.short) {
      return { ok: false, msg: 'Ada PMS tanah tertutup di bagian yang akan diberi tegangan. Buka PMS tanah dulu.' };
    }
    if (e.type === 'DS' && next && this.faults.size) {
      const raw = this.compute(trial, this.faults, false);
      if ([...raw.flt].some(r => raw.live.has(r))) return { ok: false, msg: 'Tidak boleh: PMS ini akan menyambung bagian bertegangan ke titik gangguan.' };
    }
    if (e.type === 'DS') {
      const a = id + '.a', b = id + '.b';
      const split = !next && after.isLive(a) && after.isLive(b) && after.uf.f(a) !== after.uf.f(b);
      const join = next && before.isLive(a) && before.isLive(b) && before.uf.f(a) !== before.uf.f(b);
      if (split) return { ok: false, msg: 'PMS tidak boleh memutus arus. Buka PMT dulu.' };
      if (join) return { ok: false, msg: 'PMS tidak boleh menyambung dua bagian bertegangan. Gunakan PMT.' };
    }
    if (e.type === 'DS' && before.loads !== after.loads) {
      return { ok: false, msg: next ? 'PMS tidak boleh menyambung beban. Tutup PMS saat PMT terbuka, lalu tutup PMT.' : 'PMS tidak boleh memutus arus beban. Buka PMT dulu.' };
    }
    this.sw = trial;
    if (CB_T.has(e.type) && next && this.faults.size) {
      const raw = this.compute(this.sw, this.faults, false);
      if ([...raw.flt].some(r => raw.live.has(r))) {
        this.sw[id] = false;
        this.state = this.compute();
        return { ok: true, msg: 'PMT trip kembali: gangguan masih ada.', trip: [id] };
      }
    }
    this.state = this.compute();
    return { ok: true };
  }

  // Gangguan: cari PMT yang membatasi daerah gangguan, trip yang mencatu gangguan.
  fault(id) {
    const e = this.m.map[id];
    this.faults.add(id);
    const seen = new Set(), cand = new Set();
    const q = [...elemTerms(e).filter(k => !k.endsWith('.n'))];
    q.forEach(k => seen.add(k));
    while (q.length) {
      const k = q.pop();
      const nb = [...(this.adj.get(k) || [])];
      const dot = k.lastIndexOf('.');
      if (dot > 0) {
        const eid = k.slice(0, dot), el = this.m.map[eid];
        if (el && el.type !== 'BUS') {
          const other = k.endsWith('.a') ? eid + '.b' : eid + '.a';
          const t = el.type;
          if (CB_T.has(t)) { if (this.sw[eid] && eid !== id) cand.add(eid); }
          else if (PASS_T.has(t) || (t === 'DS' && this.sw[eid]) || (t === 'TR' && eid === id)) nb.push(other);
        }
      }
      for (const n of nb) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    // Proteksi zona (rel 150 kV, trafo, saluran) men-trip semua PMT pembatas.
    // Rel 20 kV: hanya PMT yang mencatu (incoming/kopel) yang trip.
    let trip = [...cand];
    if (e.type === 'BUS' && e.v20) {
      const sw2 = { ...this.sw }; trip.forEach(c => { sw2[c] = false; });
      const st = this.compute(sw2);
      trip = trip.filter(c => {
        const inA = seen.has(c + '.a');
        return st.isLive(inA ? c + '.b' : c + '.a');
      });
    }
    trip.forEach(c => { this.sw[c] = false; });
    this.state = this.compute();
    return trip;
  }

  clearFault(id) { this.faults.delete(id); this.state = this.compute(); }
}
