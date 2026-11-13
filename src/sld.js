// Single Line Diagram (SVG) dari model yang sama.
const NS = 'http://www.w3.org/2000/svg';
const LEN = { CB: 22, KUB_IN: 22, KUB_F: 22, KUB_PS: 22, KUB_KPL: 22, DS: 24, ES: 24, CT: 14, CVT: 30, LA: 30, WT: 20, TR: 56, NGR: 30, LINE: 24, FDR: 24, TPS: 30, KUB_PT: 30 };
const rad = d => d * Math.PI / 180;

function rot(x, y, deg) {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return { x: x * c - y * s, y: x * s + y * c };
}
const gnd = y => `M-6 ${y}H6M-4 ${y + 3}H4M-2 ${y + 6}H2`;
const SYM = {
  CB: L => `<path d="M0 ${-L / 2}V-7M0 7V${L / 2}"/><rect class="cbx" x="-7" y="-7" width="14" height="14"/>`,
  DS: () => `<path d="M0 -12V-6M-3.5 -6H3.5M0 6V12"/><line class="blade" x1="0" y1="6" x2="0" y2="-6"/><circle r="1.4" cy="6" class="dot"/>`,
  ES: () => `<path d="M0 -12V-6M-3.5 -6H3.5M0 6V9${gnd(9)}"/><line class="blade" x1="0" y1="6" x2="0" y2="-6"/><circle r="1.4" cy="6" class="dot"/>`,
  CT: () => `<path d="M0 -7V7"/><circle r="5"/>`,
  CVT: () => `<path d="M0 -15V-8M-5 -8H5M-5 -5H5M0 -5V-2M0 12V13${gnd(13)}"/><circle cy="2" r="4"/><circle cy="8" r="4"/>`,
  KUB_PT: () => `<path d="M0 -15V-7M0 11V13${gnd(13)}"/><circle cy="-2" r="4.5"/><circle cy="5" r="4.5"/>`,
  LA: () => `<path d="M0 -15V-8M0 6V10${gnd(10)}"/><rect x="-4" y="-8" width="8" height="14"/><path d="M0 -6V2M-2 0L0 3L2 0"/>`,
  WT: () => `<path d="M0 -10V-6M0 6V10M0 -6a3 3 0 0 1 0 4a3 3 0 0 1 0 4a3 3 0 0 1 0 4"/><path d="M-5 -7H5M-5 7H5" class="thin"/>`,
  TR: () => `<path d="M0 -28V-21M0 21V28M10 15.5L16 14"/><circle cy="-8" r="13"/><circle cy="8" r="13"/>`,
  NGR: () => `<path d="M0 -15V-9l4 2l-8 3l8 3l-8 3l4 2V9${gnd(9)}"/>`,
  LINE: () => `<path d="M0 -12V5"/><path class="arr" d="M-5 4L5 4L0 12Z"/>`,
  TPS: () => `<path d="M0 -15V-9M0 8V12"/><circle cy="-4" r="5"/><circle cy="3" r="5"/>`,
};
SYM.KUB_IN = SYM.KUB_F = SYM.KUB_PS = SYM.KUB_KPL = SYM.CB;
SYM.FDR = SYM.LINE;

export class SLDView {
  constructor(el, onPick) {
    this.el = el; this.onPick = onPick;
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'sld');
    el.appendChild(this.svg);
    this.bind();
    new ResizeObserver(() => this.fitAspect()).observe(el);
  }

  pos(e, t) {
    const L = LEN[e.type] || 20;
    const loc = t === 'n' ? { x: 16, y: 14 } : { x: 0, y: t === 'b' ? L / 2 : -L / 2 };
    const r = rot(loc.x, loc.y, e.srot || 0);
    return { x: e.sx + r.x, y: e.sy + r.y };
  }

  build(m) {
    this.m = m; this.wires = []; this.syms = {}; this.sel = null;
    let wires = '', buses = '', syms = '', text = '', dots = '';
    const P = r => { const [id, t] = r.split('.'); return this.pos(m.map[id], t); };
    const pts = [];
    m.links.forEach((l, i) => {
      if (l.s === false) return;
      const ea = m.map[l.a.split('.')[0]], eb = m.map[l.b.split('.')[0]];
      let path;
      if (ea.type === 'BUS' || eb.type === 'BUS') {
        const [bus, other] = ea.type === 'BUS' ? [ea, l.b] : [eb, l.a];
        const q = P(other);
        const x = Math.min(bus.sx1, Math.max(bus.sx0, q.x));
        const b = { x, y: bus.sy };
        path = x === q.x || q.y === bus.sy ? [b, q] : [b, { x: q.x, y: bus.sy }, q];
        if (x === q.x) dots += `<circle class="jn" cx="${x}" cy="${bus.sy}" r="2.4"/>`;
      } else {
        const p = P(l.a), q = P(l.b), r = l.route;
        if (Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01) path = [p, q];
        else if (r && r.vhv !== undefined) path = [p, { x: p.x, y: r.vhv }, { x: q.x, y: r.vhv }, q];
        else if (r === 'hv') path = [p, { x: q.x, y: p.y }, q];
        else path = [p, { x: p.x, y: q.y }, q];
      }
      pts.push(...path);
      wires += `<path data-w="${i}" d="M${path.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}"/>`;
    });
    for (const e of m.els) {
      if (e.sld === false) continue;
      if (e.type === 'BUS') {
        buses += `<g data-id="${e.id}" class="bus"><line class="hit" x1="${e.sx0}" y1="${e.sy}" x2="${e.sx1}" y2="${e.sy}"/><line class="bl" x1="${e.sx0}" y1="${e.sy}" x2="${e.sx1}" y2="${e.sy}"/></g>`;
        text += `<text class="tb" x="${e.sx0}" y="${e.sy - 6}">${e.tag}</text>`;
        pts.push({ x: e.sx0, y: e.sy }, { x: e.sx1, y: e.sy });
        continue;
      }
      const L = LEN[e.type] || 20, f = SYM[e.type];
      if (!f) continue;
      const w = e.type === 'TR' ? 30 : 16;
      syms += `<g data-id="${e.id}" class="sym t-${e.type}" transform="translate(${e.sx} ${e.sy}) rotate(${e.srot || 0})"><rect class="hit" x="${-w / 2 - 3}" y="${-L / 2 - 3}" width="${w + 6}" height="${L + 6}"/>${f(L)}</g>`;
      pts.push({ x: e.sx, y: e.sy });
      if (e.type === 'LINE') text += `<text class="tl" x="${e.sx}" y="${e.sy - 18}" text-anchor="middle">${e.tag}</text>`;
      if (e.type === 'TR') text += `<text class="tl" x="${e.sx + 20}" y="${e.sy - 10}">${e.tag}</text>`;
      if (e.type === 'FDR') text += `<text class="ts" x="${e.sx}" y="${e.sy + 22}" text-anchor="middle">${e.tag}</text>`;
      if (e.type === 'TPS') text += `<text class="ts" x="${e.sx}" y="${e.sy + 24}" text-anchor="middle">PS</text>`;
      if (e.tag && (e.type === 'CB' || e.type === 'KUB_KPL')) text += `<text class="ts" x="${e.sx}" y="${e.sy + 20}" text-anchor="middle">${e.tag}</text>`;
    }
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const bx0 = Math.min(...xs) - 40;
    const b150 = m.els.find(e => e.type === 'BUS' && !e.v20);
    text += `<text class="tv" x="${bx0}" y="${(b150 ? b150.sy : 0) + 4}">150 kV</text><text class="tv" x="${bx0}" y="${m.Y20 + 4}">20 kV</text>`;
    this.svg.innerHTML = `<g class="wires">${wires}</g><g class="buses">${buses}</g>${dots}<g class="syms">${syms}</g><g class="txt">${text}</g><g class="flt"></g>`;
    this.bbox = { x: bx0 - 10, y: Math.min(...ys) - 40, w: Math.max(...xs) - bx0 + 60, h: Math.max(...ys) - Math.min(...ys) + 110 };
    this.wireEls = [...this.svg.querySelectorAll('[data-w]')].map(p => ({ p, l: m.links[+p.dataset.w] }));
    this.needFit = true;
    this.fit();
  }

  setState(sim) {
    const st = sim.state;
    for (const { p, l } of this.wireEls) {
      p.setAttribute('class', l.a.endsWith('.n') || st.isLive(l.a) ? 'live' : st.isEarth(l.a) ? 'earth' : 'dead');
    }
    for (const g of this.svg.querySelectorAll('g[data-id]')) {
      const e = this.m.map[g.dataset.id];
      const live = e.type === 'NGR' || sim.elemLive(e);
      g.classList.toggle('live', live);
      g.classList.toggle('dead', !live);
      if (e.id in sim.sw) {
        const c = sim.sw[e.id];
        g.classList.toggle('closed', c);
        const bl = g.querySelector('.blade');
        if (bl) { bl.setAttribute('x2', c ? 0 : -7); bl.setAttribute('y2', c ? -6 : -3); }
      }
    }
    let f = '';
    for (const id of sim.faults) {
      const e = this.m.map[id];
      const x = e.type === 'BUS' ? (e.sx0 + e.sx1) / 2 : e.sx, y = e.type === 'BUS' ? e.sy : e.sy;
      f += `<path d="M${x + 6} ${y - 18}l-6 9h6l-6 9" class="bolt"/>`;
    }
    this.svg.querySelector('.flt').innerHTML = f;
  }

  select(id) {
    this.svg.querySelectorAll('.selbox').forEach(n => n.remove());
    this.svg.querySelectorAll('.bus.sel').forEach(n => n.classList.remove('sel'));
    if (!id) return;
    const g = this.svg.querySelector(`g[data-id="${id}"]`);
    if (!g) return;
    if (g.classList.contains('bus')) { g.classList.add('sel'); return; }
    const h = g.querySelector('.hit');
    const r = document.createElementNS(NS, 'rect');
    for (const a of ['x', 'y', 'width', 'height']) r.setAttribute(a, h.getAttribute(a));
    r.setAttribute('class', 'selbox');
    g.insertBefore(r, h);
  }

  center(id) {
    const e = this.m.map[id]; if (!e) return;
    const x = e.type === 'BUS' ? (e.sx0 + e.sx1) / 2 : e.sx;
    const v = this.vb, w = Math.min(v.w, 360), h = w * v.h / v.w;
    this.vb = { x: x - w / 2, y: e.sy - h / 2, w, h };
    this.apply();
  }

  // ── pan / zoom ──
  fit() {
    this.vb = { ...this.bbox };
    if (this.el.clientWidth) this.needFit = false;
    this.fitAspect(true);
  }
  fitAspect(grow) {
    if (this.needFit && this.el.clientWidth) return this.fit();
    const cw = this.el.clientWidth, ch = this.el.clientHeight;
    if (!cw || !ch || !this.vb) return;
    const v = this.vb, a = ch / cw;
    if (grow) {
      if (v.h / v.w > a) { const nw = v.h / a; v.x -= (nw - v.w) / 2; v.w = nw; }
      else { const nh = v.w * a; v.y -= (nh - v.h) / 2; v.h = nh; }
    } else { const nh = v.w * a; v.y += (v.h - nh) / 2; v.h = nh; }
    this.apply();
  }
  apply() { const v = this.vb; this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); }
  zoom(k, cx, cy) {
    const v = this.vb, r = this.svg.getBoundingClientRect();
    const px = v.x + (cx - r.left) / r.width * v.w, py = v.y + (cy - r.top) / r.height * v.h;
    const nw = Math.min(Math.max(v.w * k, 80), this.bbox.w * 4);
    const s = nw / v.w;
    this.vb = { x: px - (px - v.x) * s, y: py - (py - v.y) * s, w: v.w * s, h: v.h * s };
    this.apply();
  }

  bind() {
    const s = this.svg, ptrs = new Map();
    let down = null, pinch = null;
    s.addEventListener('wheel', ev => { ev.preventDefault(); this.zoom(Math.exp(ev.deltaY * 0.0015), ev.clientX, ev.clientY); }, { passive: false });
    s.addEventListener('pointerdown', ev => {
      s.setPointerCapture(ev.pointerId);
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      down = ptrs.size === 1 ? { x: ev.clientX, y: ev.clientY, t: performance.now(), target: ev.target } : null;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    s.addEventListener('pointermove', ev => {
      const p = ptrs.get(ev.pointerId); if (!p) return;
      if (ptrs.size === 1) {
        const r = s.getBoundingClientRect(), k = this.vb.w / r.width;
        this.vb.x -= (ev.clientX - p.x) * k; this.vb.y -= (ev.clientY - p.y) * k; this.apply();
      }
      p.x = ev.clientX; p.y = ev.clientY;
      if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom(pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch = d;
      }
    });
    const up = ev => {
      ptrs.delete(ev.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (down && ev.type === 'pointerup' && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 7 && performance.now() - down.t < 600) {
        const g = down.target.closest && down.target.closest('g[data-id]');
        this.onPick(g ? g.dataset.id : null);
      }
      down = null;
    };
    s.addEventListener('pointerup', up);
    s.addEventListener('pointercancel', up);
  }
}
