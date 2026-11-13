// Satu sumber data untuk 3D, SLD dan simulasi.
// Elemen: posisi 3D (x, z, rot) dalam meter + posisi SLD (sx, sy, srot derajat).
// Link: menyambung terminal ("ID.a" / "ID.b" / "ID.n") atau rel ("BUSID").
// Topologi (node listrik) diturunkan dari link.

export const CB_T = new Set(['CB', 'KUB_IN', 'KUB_F', 'KUB_PS', 'KUB_KPL']);
export const SW_T = new Set([...CB_T, 'DS', 'ES']);
export const PASS_T = new Set(['CT', 'WT']);
export const FAULT_T = new Set(['BUS', 'LINE', 'TR', 'FDR']);
export const OUTDOOR_GIS = new Set(['LA', 'GANTRY', 'LINE', 'WT', 'TR', 'NGR']);

const PI = Math.PI, H = Math.PI / 2;
const rad = d => d * PI / 180;

class Builder {
  constructor() { this.els = []; this.map = {}; this.links = []; }
  el(type, id, label, o = {}) {
    const e = { type, id, label, x: 0, z: 0, rot: 0, sx: 0, sy: 0, srot: 0, ...o };
    this.els.push(e); this.map[id] = e; return e;
  }
  bus(id, label, o) { return this.el('BUS', id, label, o); }
  link(a, b, o = {}) { this.links.push({ a, b, ...o }); }
}

// posisi pada sumbu rantai: d meter (3D), s px (SLD)
function at(o, d, s, side = 0) {
  return {
    x: o.x + Math.sin(o.rot || 0) * d,
    z: o.z + Math.cos(o.rot || 0) * d,
    sx: o.sx - Math.sin(rad(o.srot || 0)) * s + side,
    sy: o.sy + Math.cos(rad(o.srot || 0)) * s,
    rot: o.rot || 0, srot: o.srot || 0,
  };
}

// Rantai seri; item: [type, id, label, d, s, extra]
function chain(b, o, items) {
  let prev = null;
  for (const [t, id, label, d, s, extra] of items) {
    b.el(t, id, label, { ...at(o, d, s), ...(extra || {}) });
    if (prev) b.link(prev + '.b', id + '.a');
    prev = id;
  }
  return { a: items[0][1] + '.a', b: prev + '.b' };
}

// Grup PMT: PMS - PMT - CT - PMS (dipakai 1½, ring, double breaker, H, seksi)
function grp(b, id, name, o, defCB = true) {
  return chain(b, o, [
    ['DS', id + '_DS1', 'PMS 1 ' + name, -5.5, -42],
    ['CB', id + '_CB', 'PMT ' + name, -1.5, -12, { def: defCB }],
    ['CT', id + '_CT', 'CT ' + name, 1.8, 14],
    ['DS', id + '_DS2', 'PMS 2 ' + name, 5.2, 40],
  ]);
}

// Ujung bay penghantar: PMS line + PMS tanah, CVT, WT, LA, gantry, SUTT. Arah +z / ke atas SLD.
function lineTail(b, id, name, o, from) {
  const t = { ...o, rot: 0, srot: 180 };
  b.el('DS', id + '_DSL', 'PMS Line ' + name, at(t, 1.6, 16));
  b.el('ES', id + '_ES', 'PMS Tanah ' + name, { ...at(t, 1.6, 40, 26), srot: -90 });
  b.el('CVT', id + '_CVT', 'CVT ' + name, { ...at(t, 5.2, 62, 28), srot: -90 });
  b.el('WT', id + '_WT', 'Wave Trap ' + name, at(t, 7.8, 84));
  b.el('LA', id + '_LA', 'LA ' + name, { ...at(t, 10.6, 108, -28), srot: 90 });
  b.el('GANTRY', id + '_GT', 'Gantry ' + name, { ...at(t, 13.6, 0), sld: false });
  b.el('LINE', id, 'SUTT ' + name, { ...at(t, 44, 146), tag: name });
  if (from) b.link(from.ref, id + '_DSL.a', from.o);
  b.link(id + '_DSL.b', id + '_ES.a', { route: 'vh', t: false });
  b.link(id + '_DSL.b', id + '_CVT.a', { route: 'vh' });
  b.link(id + '_CVT.a', id + '_WT.a', { s: false });
  b.link(id + '_DSL.b', id + '_WT.a', { t: false });
  b.link(id + '_WT.b', id + '_LA.a', { route: 'vh' });
  b.link(id + '_LA.a', id + '_GT.a', { s: false });
  b.link(id + '_GT.a', id + '.a', { s: false, span: true });
  b.link(id + '_WT.b', id + '.a', { t: false });
}

// Ujung bay trafo: [PMS], LA, Trafo, NGR. Arah -z / ke bawah SLD.
function trafoTail(b, id, name, o, from, withDS) {
  const t = { ...o, rot: PI, srot: 0 };
  let d = 0, s = 0, prev = from && from.ref;
  if (withDS) {
    b.el('DS', id + '_DST', 'PMS ' + name, at(t, 1.6, 16));
    if (from) b.link(from.ref, id + '_DST.a', from.o);
    prev = id + '_DST.b'; d = 2.6; s = 28;
  }
  b.el('LA', id + '_LA', 'LA ' + name, { ...at(t, d + 1.6, s + 16, -28), srot: 90 });
  const tp = at(t, d + 8.2, s + 52);
  b.el('TR', id, name, { ...tp, tag: name + ' · 60 MVA' });
  // NGR di samping trafo
  const lx = 5.2, lz = 1.6;
  b.el('NGR', id + '_NGR', 'NGR ' + name, {
    x: tp.x + Math.cos(tp.rot) * lx + Math.sin(tp.rot) * lz,
    z: tp.z - Math.sin(tp.rot) * lx + Math.cos(tp.rot) * lz,
    rot: tp.rot, sx: tp.sx + 40, sy: tp.sy + 34, srot: 0,
  });
  if (prev) b.link(prev, id + '_LA.a', { route: 'vh', ...(!withDS && from.o ? from.o : {}) });
  b.link(id + '_LA.a', id + '.a', { s: false });
  if (prev) b.link(prev, id + '.a', { t: false });
  b.link(id + '.n', id + '_NGR.a', { route: 'hv' });
  return id;
}

// Bay penghantar standar mulai dari z0 (sisi rel): PMT, CT, [PMS keluar], ujung.
function lineBay(b, id, name, o, from, outDS) {
  const t = { ...o, rot: 0, srot: 180 };
  const items = [
    ['CB', id + '_CB', 'PMT ' + name, 2.4, 14],
    ['CT', id + '_CT', 'CT ' + name, 5.8, 40],
  ];
  if (outDS) items.push(['DS', id + '_DSO', 'PMS Keluar ' + name, 8.8, 66]);
  const c = chain(b, t, items);
  if (from) b.link(from.ref, c.a, from.o);
  const k = outDS ? 3.0 : 0, ks = outDS ? 26 : 0;
  lineTail(b, id, name, { ...at(t, 7.2 + k, 52 + ks), rot: 0, srot: 180 }, { ref: c.b });
  return c.b;
}

function trafoBay(b, id, name, o, from, outDS) {
  const t = { ...o, rot: PI, srot: 0 };
  const items = [
    ['CB', id + '_CB', 'PMT ' + name, 2.4, 14],
    ['CT', id + '_CT', 'CT ' + name, 5.8, 40],
  ];
  if (outDS) items.push(['DS', id + '_DSO', 'PMS Keluar ' + name, 8.8, 66]);
  const c = chain(b, t, items);
  if (from) b.link(from.ref, c.a, from.o);
  const k = outDS ? 3.0 : 0, ks = outDS ? 26 : 0;
  trafoTail(b, id, name, { ...at(t, 7.2 + k, 52 + ks) }, { ref: c.b }, false);
  return c.b;
}

function busDS(b, id, label, bus, p, def = true) {
  b.el('DS', id, label, { ...p, def });
  b.link(bus, id + '.a');
}

// ───────────────────────────── konfigurasi ─────────────────────────────

const CFG = {};

CFG.single = b => {
  b.bus('B1', 'Rel 150 kV', { x0: -7, x1: 20, z: 0, sx0: -60, sx1: 160, sy: 0, tag: 'Rel 150 kV' });
  [[1, 0, 0], [2, 13, 100]].forEach(([k, x, sx]) => {
    busDS(b, `L${k}_DSR`, `PMS Rel Penghantar ${k}`, 'B1', { x, z: 4, rot: 0, sx, sy: -16, srot: 180 });
    lineBay(b, `L${k}`, `Penghantar ${k}`, { x, z: 5.4, sx, sy: -28 }, { ref: `L${k}_DSR.b` });
    busDS(b, `T${k}_DSR`, `PMS Rel Trafo ${k}`, 'B1', { x, z: -4, rot: PI, sx, sy: 16, srot: 0 });
    trafoBay(b, `T${k}`, `Trafo ${k}`, { x, z: -5.4, sx, sy: 28 }, { ref: `T${k}_DSR.b` });
  });
};

CFG['single-sect'] = b => {
  b.bus('B1A', 'Rel A', { x0: -7, x1: 10, z: 0, sx0: -60, sx1: 80, sy: 0, tag: 'Rel A' });
  b.bus('B1B', 'Rel B', { x0: 28, x1: 44, z: 0, sx0: 220, sx1: 340, sy: 0, tag: 'Rel B' });
  const g = grp(b, 'SEC', 'Seksi', { x: 19.5, z: 0, rot: H, sx: 150, sy: 0, srot: -90 });
  b.link('B1A', g.a); b.link('B1B', g.b);
  [[1, 0, 0, 'B1A'], [2, 37, 280, 'B1B']].forEach(([k, x, sx, bus]) => {
    busDS(b, `L${k}_DSR`, `PMS Rel Penghantar ${k}`, bus, { x, z: 4, rot: 0, sx, sy: -16, srot: 180 });
    lineBay(b, `L${k}`, `Penghantar ${k}`, { x, z: 5.4, sx, sy: -28 }, { ref: `L${k}_DSR.b` });
    busDS(b, `T${k}_DSR`, `PMS Rel Trafo ${k}`, bus, { x, z: -4, rot: PI, sx, sy: 16, srot: 0 });
    trafoBay(b, `T${k}`, `Trafo ${k}`, { x, z: -5.4, sx, sy: 28 }, { ref: `T${k}_DSR.b` });
  });
};

CFG['main-transfer'] = b => {
  b.bus('B1', 'Rel Utama', { x0: -7, x1: 61, z: 5, sx0: -60, sx1: 460, sy: 0, tag: 'Rel Utama' });
  b.bus('BT', 'Rel Transfer', { x0: -7, x1: 61, z: -5, sx0: -60, sx1: 460, sy: 40, tag: 'Rel Transfer' });
  const line = (k, x, sx) => {
    busDS(b, `L${k}_DSR`, `PMS Rel Penghantar ${k}`, 'B1', { x, z: 5, rot: 0, sx, sy: -16, srot: 180 });
    lineBay(b, `L${k}`, `Penghantar ${k}`, { x, z: 6.4, sx, sy: -28 }, { ref: `L${k}_DSR.b` }, true);
    busDS(b, `L${k}_DSB`, `PMS Bypass Penghantar ${k}`, 'BT', { x: x + 5.5, z: -5, rot: 0, sx: sx + 38, sy: -50, srot: 180 }, false);
    b.link(`L${k}_DSB.b`, `L${k}_DSO.b`, { over: true, route: 'vh' });
  };
  const trafo = (k, x, sx) => {
    busDS(b, `T${k}_DSR`, `PMS Rel Trafo ${k}`, 'B1', { x, z: 5, rot: PI, sx, sy: 66, srot: 0 });
    trafoBay(b, `T${k}`, `Trafo ${k}`, { x, z: -9.2, sx, sy: 78 }, { ref: `T${k}_DSR.b`, o: { via: 6.4 } }, true);
    busDS(b, `T${k}_DSB`, `PMS Bypass Trafo ${k}`, 'BT', { x: x + 5.5, z: -5, rot: PI, sx: sx + 38, sy: 66, srot: 0 }, false);
    b.link(`T${k}_DSB.b`, `T${k}_DSO.b`, { route: 'vh' });
  };
  line(1, 0, 0); trafo(1, 13, 100);
  // kopel transfer
  busDS(b, 'TC_DS1', 'PMS 1 PMT Transfer', 'B1', { x: 26, z: 5, rot: PI, sx: 175, sy: 66, srot: 0 });
  b.el('CB', 'TC_CB', 'PMT Transfer', { x: 26, z: 0, rot: PI, sx: 200, sy: 92, srot: -90, def: false, tag: 'Transfer' });
  b.el('DS', 'TC_DS2', 'PMS 2 PMT Transfer', { x: 26, z: -5, rot: 0, sx: 225, sy: 66, srot: 0 });
  b.link('TC_DS1.b', 'TC_CB.a', { route: 'vh' });
  b.link('TC_CB.b', 'TC_DS2.b', { route: 'hv' });
  b.link('BT', 'TC_DS2.a');
  trafo(2, 39, 300); line(2, 52, 400);
};

CFG.double = b => {
  b.bus('B1', 'Rel 1', { x0: -7, x1: 61, z: 5, sx0: -60, sx1: 460, sy: 0, tag: 'Rel 1' });
  b.bus('B2', 'Rel 2', { x0: -7, x1: 61, z: -5, sx0: -60, sx1: 460, sy: 40, tag: 'Rel 2' });
  const line = (k, x, sx, onB1) => {
    busDS(b, `L${k}_DS1`, `PMS Rel 1 Penghantar ${k}`, 'B1', { x, z: 5, rot: 0, sx: sx - 15, sy: -18, srot: 180 }, onB1);
    busDS(b, `L${k}_DS2`, `PMS Rel 2 Penghantar ${k}`, 'B2', { x, z: -5, rot: 0, sx: sx + 15, sy: -18, srot: 180 }, !onB1);
    b.link(`L${k}_DS2.b`, `L${k}_DS1.b`, { via: 6.6, s: false });
    lineBay(b, `L${k}`, `Penghantar ${k}`, { x, z: 6.4, sx, sy: -44 });
    b.link(`L${k}_DS1.b`, `L${k}_CB.a`, { route: { vhv: -40 } });
    b.link(`L${k}_DS2.b`, `L${k}_CB.a`, { route: { vhv: -40 }, t: false });
  };
  const trafo = (k, x, sx, onB1) => {
    busDS(b, `T${k}_DS1`, `PMS Rel 1 Trafo ${k}`, 'B1', { x, z: 5, rot: PI, sx: sx - 15, sy: 58, srot: 0 }, onB1);
    busDS(b, `T${k}_DS2`, `PMS Rel 2 Trafo ${k}`, 'B2', { x, z: -5, rot: PI, sx: sx + 15, sy: 58, srot: 0 }, !onB1);
    b.link(`T${k}_DS1.b`, `T${k}_DS2.b`, { via: 6.6, s: false });
    trafoBay(b, `T${k}`, `Trafo ${k}`, { x, z: -6.4, sx, sy: 84 });
    b.link(`T${k}_DS2.b`, `T${k}_CB.a`, { route: { vhv: 80 } });
    b.link(`T${k}_DS1.b`, `T${k}_CB.a`, { route: { vhv: 80 }, t: false });
  };
  line(1, 0, 0, true); trafo(1, 13, 100, true);
  busDS(b, 'CP_DS1', 'PMS Rel 1 Kopel', 'B1', { x: 26, z: 5, rot: PI, sx: 175, sy: 66, srot: 0 });
  b.el('CB', 'CP_CB', 'PMT Kopel 150 kV', { x: 26, z: 0, rot: PI, sx: 200, sy: 92, srot: -90, tag: 'Kopel' });
  b.el('DS', 'CP_DS2', 'PMS Rel 2 Kopel', { x: 26, z: -5, rot: 0, sx: 225, sy: 66, srot: 0 });
  b.link('CP_DS1.b', 'CP_CB.a', { route: 'vh' });
  b.link('CP_CB.b', 'CP_DS2.b', { route: 'hv' });
  b.link('B2', 'CP_DS2.a');
  trafo(2, 39, 300, false); line(2, 52, 400, false);
};

CFG['one-half'] = b => {
  b.bus('B1', 'Rel 1', { x0: -7, x1: 20, z: 24, sx0: -60, sx1: 260, sy: 0, tag: 'Rel 1' });
  b.bus('B2', 'Rel 2', { x0: -7, x1: 20, z: -24, sx0: -60, sx1: 260, sy: 350, tag: 'Rel 2' });
  [[1, 0, 0], [2, 13, 150]].forEach(([k, x, sx]) => {
    const n = `Diameter ${k}`;
    const g1 = grp(b, `D${k}A`, `Rel 1 ${n}`, { x, z: 15.6, rot: PI, sx, sy: 70, srot: 0 });
    const g2 = grp(b, `D${k}B`, `Tengah ${n}`, { x, z: 0, rot: PI, sx, sy: 180, srot: 0 });
    const g3 = grp(b, `D${k}C`, `Rel 2 ${n}`, { x, z: -15.6, rot: PI, sx, sy: 290, srot: 0 });
    b.link('B1', g1.a); b.link(g1.b, g2.a); b.link(g2.b, g3.a); b.link('B2', g3.b);
    lineTail(b, `L${k}`, `Penghantar ${k}`, { x, z: 29, sx: sx + 45, sy: -12 }, { ref: g1.b, o: { over: true, route: 'hv' } });
    trafoTail(b, `T${k}`, `Trafo ${k}`, { x, z: -29, sx: sx + 45, sy: 362 }, { ref: g2.b, o: { over: true, route: 'hv' } }, true);
  });
};

CFG['double-breaker'] = b => {
  b.bus('B1', 'Rel 1', { x0: -7, x1: 46, z: 16, sx0: -60, sx1: 520, sy: 0, tag: 'Rel 1' });
  b.bus('B2', 'Rel 2', { x0: -7, x1: 46, z: -16, sx0: -60, sx1: 520, sy: 230, tag: 'Rel 2' });
  [['L1', 0, 0], ['T1', 13, 130], ['L2', 26, 260], ['T2', 39, 390]].forEach(([id, x, sx]) => {
    const isL = id[0] === 'L', k = id[1];
    const name = (isL ? 'Penghantar ' : 'Trafo ') + k;
    const g1 = grp(b, id + 'A', `Rel 1 ${name}`, { x, z: 8, rot: PI, sx, sy: 64, srot: 0 });
    const g2 = grp(b, id + 'B', `Rel 2 ${name}`, { x, z: -8, rot: PI, sx, sy: 170, srot: 0 });
    b.link('B1', g1.a); b.link(g1.b, g2.a); b.link('B2', g2.b);
    if (isL) lineTail(b, id, name, { x, z: 21, sx: sx + 45, sy: -12 }, { ref: g1.b, o: { over: true, route: 'hv' } });
    else trafoTail(b, id, name, { x, z: -21, sx: sx + 45, sy: 242 }, { ref: g1.b, o: { over: true, route: 'hv' } }, true);
  });
};

CFG.ring = b => {
  const top = grp(b, 'R12', 'Ring P1–P2', { x: 13, z: 8, rot: H, sx: 110, sy: 0, srot: -90 });
  const right = grp(b, 'R23', 'Ring P2–T2', { x: 26, z: 0, rot: PI, sx: 220, sy: 90, srot: 0 });
  const bot = grp(b, 'R34', 'Ring T2–T1', { x: 13, z: -8, rot: -H, sx: 110, sy: 180, srot: 90 });
  const left = grp(b, 'R41', 'Ring T1–P1', { x: 0, z: 0, rot: 0, sx: 0, sy: 90, srot: 180 });
  b.link(left.b, top.a, { route: 'vh' });
  b.link(top.b, right.a, { route: 'hv' });
  b.link(right.b, bot.a, { route: 'vh' });
  b.link(bot.b, left.a, { route: 'hv' });
  lineTail(b, 'L1', 'Penghantar 1', { x: 0, z: 12, sx: 0, sy: -10 }, { ref: left.b });
  lineTail(b, 'L2', 'Penghantar 2', { x: 26, z: 12, sx: 220, sy: -10 }, { ref: right.a, o: { route: 'vh' } });
  trafoTail(b, 'T1', 'Trafo 1', { x: 0, z: -12, sx: 0, sy: 190 }, { ref: bot.b, o: { route: 'hv' } }, true);
  trafoTail(b, 'T2', 'Trafo 2', { x: 26, z: -12, sx: 220, sy: 190 }, { ref: right.b }, true);
};

CFG.h = b => {
  [[1, 0, 0], [2, 22, 240]].forEach(([k, x, sx]) => {
    lineBay(b, `L${k}`, `Penghantar ${k}`, { x, z: 0, sx, sy: 0 });
    trafoTail(b, `T${k}`, `Trafo ${k}`, { x, z: -1, sx, sy: 6 }, null, true);
  });
  const g = grp(b, 'BR', 'Jembatan', { x: 11, z: 0, rot: H, sx: 120, sy: 0, srot: -90 });
  b.link(g.a, 'L1_CB.a', { route: 'hv' });
  b.link(g.a, 'T1_DST.a', { route: 'hv' });
  b.link(g.b, 'L2_CB.a', { route: 'hv' });
  b.link(g.b, 'T2_DST.a', { route: 'hv' });
};

// ───────────────────────────── GIS mapping ─────────────────────────────
function mapGIS(b) {
  const xs = [], zs = [];
  for (const e of b.els) {
    if (e.type === 'BUS') { xs.push(e.x0, e.x1); zs.push(e.z); } else { xs.push(e.x); zs.push(e.z); }
  }
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const kx = 0.22, kz = 0.34;
  const mx = x => cx + (x - cx) * kx, mz = z => cz + (z - cz) * kz;
  let hMax = -1e9, hMin = 1e9;
  for (const e of b.els) {
    if (OUTDOOR_GIS.has(e.type)) continue;
    e.gis = true;
    if (e.type === 'BUS') { e.x0 = mx(e.x0); e.x1 = mx(e.x1); }
    else e.x = mx(e.x);
    e.z = mz(e.z);
    hMax = Math.max(hMax, e.z); hMin = Math.min(hMin, e.z);
  }
  const out = b.els.filter(e => OUTDOOR_GIS.has(e.type));
  const pos = out.filter(e => e.z > cz), neg = out.filter(e => e.z <= cz);
  const pMin = Math.min(...pos.map(e => e.z)), nMax = Math.max(...neg.map(e => e.z));
  pos.forEach(e => { e.z = hMax + 9 + (e.z - pMin); });
  neg.forEach(e => { e.z = hMin - 9 - (nMax - e.z); });
  b.hall = { x0: mx(Math.min(...xs)) - 2.5, x1: mx(Math.max(...xs)) + 2.5, z0: hMin - 2.5, z1: hMax + 2.5 };
}

// ───────────────────────────── sisi 20 kV ─────────────────────────────
const NF = 6; // penyulang per seksi
function mv(b) {
  const trs = b.els.filter(e => e.type === 'TR').sort((p, q) => p.sx - q.sx);
  const bx = (trs[0].x + trs[1].x) / 2;
  const front = Math.min(...trs.map(t => t.z)) - 9.5;
  const back = front - 14;
  b.building = { x0: bx - 18, x1: bx + 18, z0: back, z1: front, bx };
  const c = (trs[0].sx + trs[1].sx) / 2;
  const Y = Math.max(...trs.map(t => t.sy)) + 28 + 80;
  b.Y20 = Y;
  // urutan kubikel 3D (kiri ke kanan)
  const order = [];
  for (let j = 1; j <= NF; j++) order.push(['F', 1, j]);
  order.push(['PS', 1], ['PT', 1], ['IN', 1], ['KPL'], ['IN', 2], ['PT', 2], ['PS', 2]);
  for (let j = NF + 1; j <= 2 * NF; j++) order.push(['F', 2, j]);
  const pitch = 0.9, rowZ = back + 2.3;
  const x0 = bx - 8 - (order.length - 1) * pitch / 2;
  const kx = {}; order.forEach((o, i) => { kx[o.join('_')] = x0 + i * pitch; });
  const kpos = key => ({ x: kx[key], z: rowZ, rot: 0 });
  const sx = (sec, i) => sec === 1 ? c - 40 - i * 26 : c + 40 + i * 26;

  for (const sec of [1, 2]) {
    const tr = trs[sec - 1];
    const bus = 'B20_' + sec;
    const xs = order.filter(o => o[1] === sec).map(o => kx[o.join('_')]);
    b.bus(bus, `Rel 20 kV Seksi ${sec}`, {
      v20: true, x0: Math.min(...xs) - 0.45, x1: Math.max(...xs) + 0.45, z: rowZ,
      sx0: sec === 1 ? sx(1, NF + 2) - 14 : c + 24, sx1: sec === 1 ? c - 24 : sx(2, NF + 2) + 14, sy: Y,
      tag: `Rel 20 kV ${sec}`,
    });
    b.el('KUB_IN', `IN${sec}`, `Incoming 20 kV ${tr.label}`, { ...kpos(`IN_${sec}`), sx: sx(sec, 0), sy: Y - 24 });
    b.link(tr.id + '.b', `IN${sec}.a`, { route: { vhv: Y - 54 } });
    b.link(`IN${sec}.b`, bus, { t: false });
    b.el('KUB_PT', `PT${sec}`, `Kubikel PT Seksi ${sec}`, { ...kpos(`PT_${sec}`), sx: sx(sec, 1), sy: Y + 30 });
    b.link(bus, `PT${sec}.a`, { t: false });
    b.el('KUB_PS', `PS${sec}`, `Kubikel PS ${sec}`, { ...kpos(`PS_${sec}`), sx: sx(sec, 2), sy: Y + 24 });
    b.link(bus, `PS${sec}.a`, { t: false });
    b.el('TPS', `TPS${sec}`, `Trafo PS ${sec}`, {
      x: b.building.x1 + 3.5, z: front - 3 - (sec - 1) * 4, rot: 0, sx: sx(sec, 2), sy: Y + 66, tag: `Trafo PS ${sec}`,
    });
    b.link(`PS${sec}.b`, `TPS${sec}.a`);
    for (let i = 0; i < NF; i++) {
      const j = (sec - 1) * NF + i + 1;
      b.el('KUB_F', `KF${j}`, `Kubikel Penyulang ${j}`, { ...kpos(`F_${sec}_${j}`), sx: sx(sec, 3 + (sec === 1 ? NF - 1 - i : i)), sy: Y + 24 });
      b.link(bus, `KF${j}.a`, { t: false });
      b.el('FDR', `F${j}`, `Penyulang ${j}`, {
        x: bx - 16.5 + (j - 1) * 3, z: back - 9, rot: 0, sx: sx(sec, 3 + (sec === 1 ? NF - 1 - i : i)), sy: Y + 62, tag: `${j}`,
      });
      b.link(`KF${j}.b`, `F${j}.a`);
    }
  }
  b.el('KUB_KPL', 'KPL20', 'Kopel 20 kV', { ...kpos('KPL'), sx: c, sy: Y, srot: -90, def: false });
  b.link('B20_1', 'KPL20.a', { t: false });
  b.link('KPL20.b', 'B20_2', { t: false });
}

export function buildModel(cfgId, tech) {
  const b = new Builder();
  CFG[cfgId](b);
  if (tech === 'GIS') mapGIS(b);
  mv(b);
  b.cfg = cfgId; b.tech = tech;
  return b;
}

export function elemTerms(e) {
  if (e.type === 'BUS') return [e.id];
  if (['LA', 'CVT', 'ES', 'KUB_PT', 'NGR', 'GANTRY', 'LINE', 'FDR', 'TPS'].includes(e.type)) return [e.id + '.a'];
  if (e.type === 'TR') return [e.id + '.a', e.id + '.b', e.id + '.n'];
  return [e.id + '.a', e.id + '.b'];
}
