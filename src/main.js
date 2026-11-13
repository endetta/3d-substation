import { buildModel, FAULT_T } from './model.js';
import { Sim } from './sim.js';
import { View3D } from './scene3d.js';
import { SLDView } from './sld.js';
import { KIND, CONFIGS, TECH, GIS_NOTE, INTRO, FLOW } from './info.js';

const $ = s => document.querySelector(s);
const S = { cfg: 'double', tech: 'AIS', view: '3d', cam: 'orbit', key: null };
let M, sim;

// ── URL state ──
try {
  const h = new URLSearchParams(location.hash.slice(1));
  if (CONFIGS.some(c => c.id === h.get('k'))) S.cfg = h.get('k');
  if (['AIS', 'GIS'].includes(h.get('t'))) S.tech = h.get('t');
  if (['3d', 'sld'].includes(h.get('v'))) S.view = h.get('v');
} catch (_) { /* abaikan */ }
const saveHash = () => { try { history.replaceState(null, '', `#k=${S.cfg}&t=${S.tech}&v=${S.view}`); } catch (_) { } };

const v3 = new View3D($('#v3d'), ud => pick(ud ? ud.key : null, ud));
const sld = new SLDView($('#vsld'), id => pick(id));

// ── resolusi kunci → info ──
function resolve(key, ud) {
  if (!key) return null;
  const [id, part] = key.split('#');
  const e = M.map[id];
  if (e) {
    const kind = part || (e.type === 'BUS' && e.v20 ? 'BUS20' : e.type);
    const k = KIND[kind] || {};
    return { key, e, kind, k, title: part ? `${k.n} · ${e.label}` : e.label };
  }
  const kind = ud?.kind || keyKind.get(key);
  const k = KIND[kind] || { n: key };
  return { key, kind, k, title: k.n };
}
const keyKind = new Map();

// ── build ──
function rebuild(keepSim) {
  M = buildModel(S.cfg, S.tech);
  sim = new Sim(M, keepSim ? sim : null);
  v3.build(M);
  for (const objs of v3.reg.values()) for (const o of objs) if (o.userData?.kind) keyKind.set(o.userData.key, o.userData.kind);
  v3.setState(sim);
  if (!keepSim) v3.home(true);
  sld.build(M);
  sld.setState(sim);
  S.key = null; closeSheet();
  const c = CONFIGS.find(c => c.id === S.cfg);
  $('#cfgName').textContent = c.name;
  document.title = `${c.name} · GI 150/20 kV`;
  setSeg('#tech', S.tech);
  updateStatus();
  renderCfgPanel();
  saveHash();
}

function setSeg(sel, v) { document.querySelectorAll(sel + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); }

function updateStatus() {
  const f = sim.feeders();
  $('#fd').innerHTML = `Penyulang menyala<b>${f.on}/${f.total}</b>`;
  $('#resetBtn').hidden = !(sim.faults.size || Object.keys(sim.sw).some(k => sim.sw[k] !== (M.map[k].def ?? (M.map[k].type !== 'ES'))));
}

function refresh() {
  v3.setState(sim); sld.setState(sim); updateStatus();
  if (S.key) renderSheet();
}

// ── seleksi ──
function pick(key) {
  S.key = key;
  v3.select(key);
  sld.select(key ? key.split('#')[0] : null);
  if (key) renderSheet(); else closeSheet();
}

function fly(key) { if (S.cam === 'walk') setCam('orbit'); v3.flyTo(key); }

function closeSheet() { $('#sheet').hidden = true; }

function renderSheet() {
  const r = resolve(S.key);
  if (!r) return closeSheet();
  const { e, k } = r;
  const sub = [k.ab, k.en].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ');
  let h = `<div class="sh-h"><div><div class="t">${r.title}</div><div class="s">${sub}</div></div><button class="x" data-close aria-label="Tutup">×</button></div>`;
  if (k.d) h += `<p>${k.d}</p>`;
  if (e?.gis) h += `<p class="note">${GIS_NOTE}</p>`;
  const acts = [];
  if (e) {
    const tags = [];
    const isSw = e.id in sim.sw;
    if (isSw) {
      const c = sim.sw[e.id];
      tags.push(`<span class="tag ${c ? 'inv' : ''}">${e.type === 'ES' ? (c ? 'Tertutup (ditanahkan)' : 'Terbuka') : (c ? 'Tertutup' : 'Terbuka')}</span>`);
      acts.push(`<button class="pri" data-act="toggle">${c ? 'Buka' : 'Tutup'}</button>`);
    }
    if (e.type !== 'GANTRY' && e.type !== 'NGR') tags.push(`<span class="tag">${sim.elemLive(e) ? 'Bertegangan' : 'Padam'}</span>`);
    if (sim.faults.has(e.id)) tags.push('<span class="tag inv">Gangguan</span>');
    if (FAULT_T.has(e.type)) acts.push(sim.faults.has(e.id)
      ? '<button data-act="clear">Hapus gangguan</button>'
      : `<button ${isSw ? '' : 'class="pri"'} data-act="fault">Simulasikan gangguan</button>`);
    if (tags.length) h += `<div class="st">${tags.join('')}</div>`;
    if (e.sld !== false && S.view === '3d') acts.push('<button data-act="sld">Lihat di SLD</button>');
    if (S.view === 'sld') acts.push('<button data-act="3d">Lihat di 3D</button>');
  } else if (S.view === '3d') acts.push('<button data-act="fly">Dekati</button>');
  if (e && S.view === '3d') acts.push('<button data-act="fly">Dekati</button>');
  if (acts.length) h += `<div class="act">${acts.join('')}</div>`;
  const sh = $('#sheet'); sh.innerHTML = h; sh.hidden = false;
}

$('#sheet').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-close')) { pick(null); return; }
  const id = S.key.split('#')[0], e = M.map[id];
  switch (b.dataset.act) {
    case 'toggle': {
      const r = sim.toggle(id);
      if (!r.ok) toast(r.msg); else if (r.msg) toast(r.msg);
      refresh(); break;
    }
    case 'fault': {
      const trip = sim.fault(id);
      toast(trip.length ? `Gangguan ${e.label}. Trip: ${trip.map(t => M.map[t].label).join(', ')}.` : `Gangguan ${e.label}. Tidak ada PMT yang perlu trip.`, 5000);
      refresh(); break;
    }
    case 'clear': sim.clearFault(id); toast('Gangguan dihapus. PMT tetap terbuka; tutup kembali secara manual.'); refresh(); break;
    case 'sld': setView('sld'); sld.center(id); renderSheet(); break;
    case '3d': setView('3d'); fly(S.key); renderSheet(); break;
    case 'fly': fly(S.key); break;
  }
});

let tt;
function toast(msg, ms = 3600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ms);
}

// ── tampilan ──
function setView(v) {
  S.view = v; setSeg('#view', v);
  $('#v3d').hidden = v !== '3d'; $('#vsld').hidden = v !== 'sld';
  $('#tools').hidden = v !== '3d'; $('#legend').hidden = v !== 'sld';
  v3.active = v === '3d'; v3.dirty = true;
  if (v !== '3d' && S.cam === 'walk') setCam('orbit');
  if (v === 'sld') sld.fitAspect();
  saveHash();
}
function setCam(c) {
  S.cam = c === 'top' ? 'orbit' : c;
  setSeg('#cam', c === 'top' ? 'top' : c);
  v3.setMode(c);
  const w = c === 'walk';
  $('#joy').hidden = !w; $('#walkHint').hidden = !w;
  $('#status').hidden = w;
  if (w) setTimeout(() => { $('#walkHint').hidden = true; }, 4000);
  if (c === 'top') setTimeout(() => setSeg('#cam', 'orbit'), 900);
}

$('#tech').addEventListener('click', ev => { const v = ev.target.dataset.v; if (v && v !== S.tech) { S.tech = v; rebuild(true); v3.home(true); toast(TECH[v].d, 5000); } });
$('#view').addEventListener('click', ev => { const v = ev.target.dataset.v; if (v) { setView(v); if (S.key) renderSheet(); } });
$('#cam').addEventListener('click', ev => { const v = ev.target.dataset.v; if (v) setCam(v); });
$('#labelBtn').addEventListener('click', ev => { v3.showLabels = !v3.showLabels; ev.currentTarget.classList.toggle('on', v3.showLabels); v3.dirty = true; });
$('#resetBtn').addEventListener('click', () => { sim = new Sim(M); refresh(); toast('Simulasi dikembalikan ke kondisi normal.'); });

// ── panel ──
function openPanel(id) { document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== id; }); }
document.querySelectorAll('.panel').forEach(p => p.addEventListener('click', ev => { if (ev.target.closest('[data-close]')) p.hidden = true; }));
$('#cfgBtn').addEventListener('click', () => { const p = $('#cfgPanel'); if (p.hidden) openPanel('cfgPanel'); else p.hidden = true; });
$('#aboutBtn').addEventListener('click', () => { const p = $('#aboutPanel'); if (p.hidden) openPanel('aboutPanel'); else p.hidden = true; });
$('#listBtn').addEventListener('click', () => { renderList(); openPanel('listPanel'); });

function renderCfgPanel() {
  $('#cfgList').innerHTML = CONFIGS.map(c => `<li><button data-cfg="${c.id}" class="${c.id === S.cfg ? 'on' : ''}">${c.name}<span>${c.short}</span></button></li>`).join('');
  const c = CONFIGS.find(c => c.id === S.cfg);
  $('#cfgInfo').innerHTML = `<h3>${c.name}</h3><p>${c.sum}</p>
    <div class="pm"><div><h3>Kelebihan</h3><ul>${c.pro.map(x => `<li>${x}</li>`).join('')}</ul></div>
    <div><h3>Kekurangan</h3><ul>${c.con.map(x => `<li>${x}</li>`).join('')}</ul></div></div>
    <h3>Dipakai</h3><p>${c.use}</p>
    <h3>Coba</h3><ul>${c.tryit.map(x => `<li>${x}</li>`).join('')}</ul>
    <h3>AIS dan GIS</h3><p>${TECH.AIS.d}</p><p>${TECH.GIS.d}</p>`;
}
$('#cfgList').addEventListener('click', ev => {
  const b = ev.target.closest('[data-cfg]'); if (!b) return;
  if (b.dataset.cfg !== S.cfg) { S.cfg = b.dataset.cfg; rebuild(false); }
  if (window.innerWidth <= 640) $('#cfgPanel').hidden = true;
});

const GROUPS = [
  ['Switchyard 150 kV', ['LINE', 'GANTRY', 'LA', 'WT', 'CVT', 'DS', 'ES', 'CT', 'CB', 'BUS', 'PORTAL', 'GIS_HALL', 'GISDUCT', 'LCC', 'CSE']],
  ['Trafo tenaga', ['TR_TANK', 'TR_HV', 'TR_LV', 'TR_N', 'TR_CONS', 'TR_RAD', 'TR_OLTC', 'TR_MK', 'NGR']],
  ['Sisi 20 kV', ['KUB_IN', 'KUB_F', 'KUB_PS', 'KUB_PT', 'KUB_KPL', 'BUS20', 'FDR', 'TPS']],
  ['Gedung kontrol', ['BLD', 'PANEL', 'PROT', 'RTU', 'TELE', 'HMI', 'RECT', 'ACDC', 'BAT']],
  ['Pendukung', ['GENSET', 'MAST', 'TRENCH', 'YARD', 'FENCE', 'ROAD', 'GUARD', 'HUMAN']],
];
function kindIndex() {
  const idx = new Map();
  for (const [key, objs] of v3.reg) {
    const ud = objs.find(o => o.isMesh)?.userData; if (!ud || ud.key !== key) continue;
    const r = resolve(key, ud); if (!r) continue;
    if (!idx.has(r.kind)) idx.set(r.kind, { key, n: 0 });
    idx.get(r.kind).n++;
  }
  return idx;
}
function renderList() {
  const idx = kindIndex();
  $('#listBody').innerHTML = GROUPS.map(([g, kinds]) => {
    const items = kinds.filter(k => idx.has(k)).map(k => {
      const n = idx.get(k).n;
      return `<button data-key="${idx.get(k).key}">${KIND[k].n}${n > 1 && !k.startsWith('TR_') ? `<small>×${n}</small>` : ''}</button>`;
    }).join('');
    return items ? `<div class="lgrp"><h3>${g}</h3>${items}</div>` : '';
  }).join('');
}
$('#listBody').addEventListener('click', ev => {
  const b = ev.target.closest('[data-key]'); if (!b) return;
  $('#listPanel').hidden = true;
  if (S.view !== '3d') setView('3d');
  pick(b.dataset.key); fly(b.dataset.key);
});

$('#aboutBody').innerHTML = `<p>${INTRO}</p>
  <div class="flow">${FLOW.map(f => `<span>${f}</span>`).join('<i>→</i>')}</div>
  <h3>Cara pakai</h3>
  <ul class="dl">
    <li>Ketuk komponen untuk melihat nama dan fungsinya.</li>
    <li>Dari kartu info: buka/tutup PMT dan PMS, atau simulasikan gangguan.</li>
    <li>3D: geser untuk memutar, dua jari untuk zoom dan geser. <b>Jalan</b> untuk berkeliling setinggi mata.</li>
    <li>SLD: diagram satu garis. Garis hitam bertegangan, putus-putus padam.</li>
    <li>Ganti konfigurasi di menu atas untuk membandingkan.</li>
  </ul>
  <h3>Istilah</h3>
  <ul class="dl">
    <li><b>Bay</b>: satu rangkaian peralatan untuk satu saluran, trafo, atau kopel.</li>
    <li><b>PMT</b> memutus arus (termasuk gangguan). <b>PMS</b> hanya memisah tanpa arus.</li>
    <li><b>Rel</b> (busbar): titik kumpul semua bay.</li>
  </ul>
  <p class="note" style="color:var(--mut);font-size:12.5px">Dimensi mendekati nyata, disederhanakan untuk pemahaman denah.</p>`;

// ── joystick ──
(() => {
  const j = $('#joy'), k = $('#knob'); let id = null;
  const set = (x, y) => { v3.walk.jx = x; v3.walk.jy = y; k.style.transform = `translate(${x * 36}px,${y * 36}px)`; };
  const mv = ev => {
    const r = j.getBoundingClientRect();
    let x = (ev.clientX - r.left - r.width / 2) / (r.width / 2), y = (ev.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    set(x, y);
  };
  j.addEventListener('pointerdown', ev => { id = ev.pointerId; j.setPointerCapture(id); mv(ev); });
  j.addEventListener('pointermove', ev => { if (ev.pointerId === id) mv(ev); });
  const end = ev => { if (ev.pointerId === id) { id = null; set(0, 0); } };
  j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end);
})();

window.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { document.querySelectorAll('.panel').forEach(p => { p.hidden = true; }); pick(null); }
});

// ── start ──
rebuild(false);
setView(S.view);
setCam('orbit');
let seen = false;
try { seen = localStorage.getItem('gi-seen') === '1'; localStorage.setItem('gi-seen', '1'); } catch (_) { }
if (!seen) openPanel('aboutPanel');
window.__gi = { get M() { return M; }, get sim() { return sim; }, v3, sld, S };
