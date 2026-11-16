// Org chart. State lives in localStorage; see plans/PLAN.md.
'use strict';

const KEY = 'orgchart.v2', OLD_KEY = 'orgchart.v1';
// Layout runs on a grid: one x unit = UX em, one y unit = UY em. The chart scales via font-size.
const UX = .6, UY = 1.25;
const H = 4, GX = 3, GY = 3;    // box height, horizontal gap, vertical gap (grid units)
const MAX_FS = 14, MIN_FS = 5;  // chart font size range in px

const $ = s => document.querySelector(s);
const chart = $('#chart'), stage = $('#stage'), dlg = $('#dlg'), edit = $('#edit'), menu = $('#menu');
const SANS = getComputedStyle(document.documentElement).getPropertyValue('--sans');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// store holds every chart; state is the current one ({ name, people })
let store = load(), state = store.charts[store.cur], undo = [], W = 24, drag = null, short = new Map(), printing = false;
let shown = null;  // the arrangement last laid out; chartSVG() draws it for the screen and for copies
// printable area in CSS px: the smaller of Letter and A4 landscape, minus the @page margins in style.css
const PRINT_W = 960, PRINT_H = 700;

// -- state ------------------------------------------------------------------

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.charts) && s.charts.length) {
      s.cur = Math.min(Math.max(0, s.cur | 0), s.charts.length - 1);
      return s;
    }
  } catch {}
  let people = [];  // carry over a chart saved before multiple charts existed
  try { const s = JSON.parse(localStorage.getItem(OLD_KEY)); if (s && Array.isArray(s.people)) people = s.people; } catch {}
  return { cur: 0, sort: 'manual', charts: [{ name: 'org-1', people }] };
}
function save() {
  store.charts[store.cur] = state;  // undo replaces the state object
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {}
}
function commit(fn) {
  undo.push(JSON.stringify(state));
  if (undo.length > 100) undo.shift();
  fn(); fixCycles(); save(); render();
}
function doUndo() { if (undo.length) { state = JSON.parse(undo.pop()); save(); render(); } }

const byName = () => new Map(state.people.map(p => [p.name, p]));
// peers show in saved order; the Sort menu reorders them once by name, or longest tenure first (unknown dates last, ties by name)
const startTime = s => parseDate(s)?.getTime() ?? Infinity;
const nameCmp = (a, b) => a.name.localeCompare(b.name);
const SORTS = {
  name: nameCmp,
  org: (a, b) => (startTime(a.orgStart) - startTime(b.orgStart)) || nameCmp(a, b),
  role: (a, b) => (startTime(a.roleStart) - startTime(b.roleStart)) || nameCmp(a, b),
};
// move people (keeping their order) to just before the anchor, just after it, or to the end
function place(movers, anchor = null, after = false) {
  const rest = state.people.filter(p => !movers.includes(p)), i = rest.indexOf(anchor);
  rest.splice(i < 0 ? rest.length : i + after, 0, ...movers);
  state.people = rest;
}
function kidsMap(people = state.people) {
  const k = new Map();
  for (const p of people) if (p.manager) (k.get(p.manager) || k.set(p.manager, []).get(p.manager)).push(p.name);
  return k;
}
function team(id, kids = kidsMap()) {
  const out = new Set([id]), q = [id];
  while (q.length) for (const c of kids.get(q.pop()) || []) if (!out.has(c)) { out.add(c); q.push(c); }
  return out;
}
function fixCycles() {
  const P = byName();
  for (const p of state.people) {
    if (p.manager && !P.has(p.manager)) p.manager = null;
    const seen = new Set();
    for (let m = p.manager; m; m = P.get(m)?.manager) {
      if (m === p.name) { p.manager = null; break; }
      if (seen.has(m)) break;
      seen.add(m);
    }
  }
}

// -- import/export ----------------------------------------------------------

function splitRow(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c !== '"') cur += c;
      else if (line[i + 1] === '"') { cur += '"'; i++; }
      else q = false;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
function parseTable(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const rows = lines.map(l => splitRow(l, sep));
  const dated = r => parseDate(r[2]) || parseDate(r[3]);
  if (/^(name|person|employee|who)$/i.test(rows[0][0]) || (!dated(rows[0]) && rows.slice(1).some(dated))) rows.shift();
  return rows.filter(r => r[0]);
}
function importText(text) {
  const rows = parseTable(text), hasMgr = rows.some(r => r.length >= 5);
  const recs = new Map();
  for (const r of rows) if (!recs.has(r[0])) recs.set(r[0], r);
  const old = byName();
  // a removed manager's reports move up to the nearest remaining manager
  const keep = m => { for (let i = 0; m && !recs.has(m) && i < 1e4; i++) m = old.get(m)?.manager; return recs.has(m) ? m : null; };
  commit(() => {
    state.people = [...recs.values()].map(([name, role = '', roleStart = '', orgStart = '', mgr = '']) => {
      const manager = hasMgr ? (recs.has(mgr) && mgr !== name ? mgr : null) : keep(old.get(name)?.manager);
      return { name, role, roleStart, orgStart, manager };
    });
  });
}
// one row per person, shared by CSV and share links: [name, role, roleStart, orgStart, manager]
const toRows = () => state.people.map(p => [p.name, p.role, p.roleStart, p.orgStart, p.manager || '']);
function toCSV() {
  const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return ['name,role,role start,org start,manager', ...toRows().map(r => r.map(q).join(','))].join('\n');
}

// -- dates ------------------------------------------------------------------

const MONTHS = 'janfebmaraprmayjunjulaugsepoctnovdec';
function parseDate(s) {
  s = (s || '').trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?$/))) return new Date(+m[1], (m[2] || 1) - 1, m[3] || 1);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    let y = +m[3];
    if (y < 100) y += y > new Date().getFullYear() % 100 ? 1900 : 2000;
    return new Date(y, m[1] - 1, +m[2]);
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) return new Date(+m[2], m[1] - 1, 1);
  if ((m = s.match(/^([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i))) {
    const i = MONTHS.indexOf(m[1].toLowerCase());
    if (i >= 0 && i % 3 === 0) return new Date(+m[2], i / 3, 1);
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}
function since(s) {
  const d = parseDate(s);
  if (!d) return '';
  const now = new Date();
  const mo = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth() - (now.getDate() < d.getDate() ? 1 : 0);
  if (mo < 1) return mo < 0 ? 'soon' : '<1m';
  const y = Math.floor(mo / 12), r = mo % 12;
  return y ? (r ? `${y}y${r}m` : `${y}y`) : `${r}m`;
}
function tenure(p) {
  const r = since(p.roleStart), o = since(p.orgStart);
  const fmt = (t, what) => t === '<1m' ? `New ${what}` : t && `${t} ${what}`;
  return [fmt(r, 'in role'), fmt(o, 'at org')].filter(Boolean).join('  ·  ');
}

// -- boxes ------------------------------------------------------------------

// display names: first name only, plus as much of the last name as it takes to tell apart
// people who share a first name (Ada L., Ada T.; Ada Lo., Ada La.)
function shortNames() {
  const split = n => { const w = n.trim().split(/\s+/); return [w[0], w.length > 1 ? w[w.length - 1] : '']; };
  const groups = new Map();
  for (const p of state.people) {
    const [first, last] = split(p.name), k = first.toLowerCase();
    (groups.get(k) || groups.set(k, []).get(k)).push({ name: p.name, first, last });
  }
  const out = new Map();
  for (const g of groups.values()) for (const m of g) {
    if (g.length === 1) { out.set(m.name, m.first); continue; }
    const others = g.filter(o => o !== m).map(o => o.last.toLowerCase()), last = m.last.toLowerCase();
    let label = m.name;
    for (let i = 1; i <= m.last.length; i++) {
      if (others.every(o => o.slice(0, i) !== last.slice(0, i))) {
        label = `${m.first} ${m.last.slice(0, i)}${i < m.last.length ? '.' : ''}`;
        break;
      }
    }
    out.set(m.name, label);
  }
  return out;
}
const shortName = n => short.get(n) || n;

// A box is a name row (bold short name, then a role pill) over a tenure line. Sizes in em.
const NAME = 1.25, ROLE = .75, TEN = .85, LH = 1.2;  // font sizes and line height
const PAD = .8, GAP = .5, PILL = .375, TRACK = .04;  // box side padding, name-to-pill gap, pill side padding, role letter-spacing

const ctx = document.createElement('canvas').getContext('2d');
// measure near the real size--system fonts swap optical cuts at large sizes
// track: letter-spacing in em of the text, counted between characters (the trailing one is invisible)
const textEm = (t, weight, em, track = 0) => {
  ctx.font = `${weight} ${em * MAX_FS}px ${SANS}`;
  return ctx.measureText(t).width / MAX_FS + track * em * Math.max(0, [...t].length - 1);
};
// trim text with an ellipsis to fit max em
function fit(t, weight, em, max, track = 0) {
  if (textEm(t, weight, em, track) <= max) return t;
  while (t && textEm(t + '…', weight, em, track) > max) t = t.slice(0, -1);
  return t + '…';
}
// box width in grid units, sized to the widest content
function boxWidth() {
  let em = 0;
  for (const p of state.people) {
    const top = textEm(shortName(p.name), 700, NAME) + (p.role ? GAP + textEm(p.role, 600, ROLE, TRACK) + 2 * PILL : 0);
    em = Math.max(em, top, textEm(tenure(p), 400, TEN));
  }
  return Math.min(36, Math.max(16, Math.ceil((em + 2 * PAD + .4) / UX)));  // + padding and slack
}

// -- layout -----------------------------------------------------------------

// Lays out trees side by side. Returns box positions and connector segments [x1, y1, x2, y2], in grid units.
// compact: a manager whose reports are all leaves stacks them on a side rail.
function layout(compact, kids, roots) {
  const segs = [], boxes = [];
  const line = (x1, y1, x2, y2) => segs.push([x1, y1, x2, y2]);
  function measure(id) {
    const ch = (kids.get(id) || []).map(measure), n = { id, ch, w: W, h: H };
    if (!ch.length) return n;
    if (compact && ch.length > 1 && ch.every(c => !c.ch.length)) {
      n.stack = true; n.w = W + 4; n.h = H + ch.length * (H + 1);
    } else {
      n.w = Math.max(W, ch.reduce((s, c) => s + c.w, 0) + GX * (ch.length - 1));
      n.h = H + GY + Math.max(...ch.map(c => c.h));
    }
    return n;
  }
  function place(n, x, y) { // returns the box's x
    if (!n.ch.length) { boxes.push([n.id, x, y]); return x; }
    if (n.stack) {
      boxes.push([n.id, x, y]);
      let mid;
      n.ch.forEach((c, i) => {
        const cy = y + H + 1 + i * (H + 1);
        place(c, x + 4, cy);
        mid = cy + H / 2;
        line(x + 2, mid, x + 4, mid);
      });
      line(x + 2, y + H, x + 2, mid);
      return x;
    }
    const tw = n.ch.reduce((s, c) => s + c.w, 0) + GX * (n.ch.length - 1);
    let cx = x + (n.w - tw) / 2;
    const mids = n.ch.map(c => { const bx = place(c, cx, y + H + GY); cx += c.w + GX; return bx + W / 2; });
    const pc = (mids[0] + mids.at(-1)) / 2, bar = y + H + GY / 2;
    boxes.push([n.id, pc - W / 2, y]);
    line(pc, y + H, pc, bar);
    if (mids.length > 1) line(mids[0], bar, mids.at(-1), bar);
    for (const m of mids) line(m, bar, m, y + H + GY);
    return pc - W / 2;
  }
  let x = 0, h = 0;
  for (const r of roots) { const n = measure(r); place(n, x, 0); x += n.w + GX * 2; h = Math.max(h, n.h); }
  return { segs, boxes, w: Math.max(0, x - GX * 2), h };
}

// -- drawing ----------------------------------------------------------------
// The chart is one SVG, drawn at MAX_FS px per em. The screen scales it to fit and colors it from the
// theme's CSS variables; Copy as SVG/PNG take the same drawing in the print palette from style.css.

const INK = { bg: '#fff', card: '#fff', fg: '#000', line: '#999', wire: '#666', dim: '#444', accent: '#0a58b0', bug: '#e2ecf8' };
const THEME = Object.fromEntries(Object.keys(INK).map(k => [k, `var(--${k})`]));

function chartSVG(c, pad = 0, scale = 1) {
  const { segs, boxes, w, h, ty, tray } = shown, P = byName(), r2 = v => +v.toFixed(2);
  const X = v => r2(v * UX * MAX_FS), Y = v => r2(v * UY * MAX_FS), E = v => r2(v * MAX_FS);
  // textLength pins the drawn width to the measured one--Safari draws text wider when the chart is scaled down.
  // SVG collapses runs of spaces that canvas measures, and Safari scrambles the glyphs when the counts differ,
  // so all but the last space in a run become no-break spaces, which don't collapse.
  const text = (cls, x, y, t, em, weight, track = 0) => {
    t = t.replace(/ (?= )/g, ' ');
    return `<text class="${cls}" x="${r2(x)}" y="${r2(y)}" font-size="${E(em)}" dominant-baseline="central" ` +
      `textLength="${E(textEm(t, weight, em, track))}" lengthAdjust="spacing">${esc(t)}</text>`;
  };
  const out = [`<path class="wires" d="${segs.map(([a, b, c, d]) => `M${X(a)} ${Y(b)}L${X(c)} ${Y(d)}`).join('')}"/>`];
  if (tray) {
    const t = `Unassigned (${tray})`, cy = Y(ty) + E(.7);
    out.push(text('tray', 0, cy, t, 1, 600), `<path class="rule" d="M${E(textEm(t, 600, 1) + .75)} ${cy}H${X(w)}"/>`);
  }
  // the name row and tenure line, with a .35em gap between, centered in the box
  const rowH = NAME * LH, tenH = TEN * LH, top = (H * UY - rowH - .35 - tenH) / 2 + rowH / 2, ten = top + rowH / 2 + .35 + tenH / 2;
  const inner = W * UX - 2 * PAD, pillH = ROLE * (LH + .2);
  for (const [id, gx, gy] of boxes) {
    const p = P.get(id), x = X(gx), y = Y(gy), left = x + E(PAD);
    const pill = p.role ? Math.min(textEm(p.role, 600, ROLE, TRACK) + 2 * PILL, inner * .6) : 0;
    const name = fit(shortName(p.name), 700, NAME, inner - (pill && pill + GAP)), px = left + E(textEm(name, 700, NAME) + GAP);
    out.push(`<g class="box" data-id="${esc(id)}">`,
      `<rect class="card" x="${x + .5}" y="${y + .5}" width="${X(W) - 1}" height="${Y(H) - 1}" rx="6"/>`,
      text('name', left, y + E(top), name, NAME, 700),
      pill ? `<rect class="pill" x="${r2(px)}" y="${r2(y + E(top - pillH / 2))}" width="${E(pill)}" height="${E(pillH)}" rx="${E(pillH / 2)}"/>` +
        text('role', px + E(PILL), y + E(top), fit(p.role, 600, ROLE, pill - 2 * PILL, TRACK), ROLE, 600, TRACK) : '',
      text('ten', left, y + E(ten), fit(tenure(p), 400, TEN, inner), TEN, 400),
      '</g>');
  }
  const css = `.wires{fill:none;stroke:${c.wire};stroke-width:1.5px}.rule{stroke:${c.line}}.bg{fill:${c.bg}}` +
    `.card{fill:${c.card};stroke:${c.line}}.pill{fill:${c.bug}}.name{fill:${c.fg};font-weight:700}` +
    `.role{fill:${c.accent};font-weight:600;letter-spacing:${TRACK}em}.ten{fill:${c.dim}}.tray{fill:${c.dim};font-weight:600}`;
  const vw = X(w) + 2 * pad, vh = Y(h) + 2 * pad;
  return `<svg class="org" xmlns="http://www.w3.org/2000/svg" width="${r2(vw * scale)}" height="${r2(vh * scale)}" ` +
    `viewBox="${-pad} ${-pad} ${vw} ${vh}" font-family="${esc(SANS.trim())}">` +
    `<style>${css.replace(/(^|\})\./g, '$1.org .')}</style>` +
    `<rect class="bg" x="${-pad}" y="${-pad}" width="${vw}" height="${vh}"/>${out.join('')}</svg>`;
}

function renderTabs() {
  const many = store.charts.length > 1;
  $('#tabs').innerHTML = store.charts.map((c, i) =>
    `<span class="tab${i === store.cur ? ' on' : ''}"><button class="link" data-go="${i}">${esc(c.name)}</button>` +
    (many ? `<button class="link x" data-del="${i}" title="Delete ${esc(c.name)}">×</button>` : '') + '</span>'
  ).join('') + '<button class="link" data-new title="New chart">+</button>';
}

// people in saved order; roots head a tree, tray holds anyone with no manager and no reports
function arrange() {
  const people = state.people, kids = kidsMap(people);
  return {
    people, kids,
    roots: people.filter(p => !p.manager && kids.has(p.name)).map(p => p.name),
    tray: people.filter(p => !p.manager && !kids.has(p.name)).map(p => p.name),
  };
}

function render() {
  renderTabs();
  renderBell();
  short = shortNames();
  W = boxWidth();
  const { people, kids, roots, tray } = arrange();
  $('#empty').hidden = people.length > 0;
  chart.hidden = !people.length;
  shown = null;
  if (!people.length) { chart.innerHTML = ''; return; }

  const availW = printing ? PRINT_W : stage.clientWidth - 32, availH = printing ? PRINT_H : stage.clientHeight - 32;

  // try both layouts and every tray width; keep whichever allows the biggest font
  let best = null;
  for (const compact of [false, true]) {
    const L = layout(compact, kids, roots);
    for (let cols = tray.length || 1; cols >= 1; cols--) {
      const ty = L.h ? L.h + 2 : 0, rows = Math.ceil(tray.length / cols);
      const w = Math.max(L.w, tray.length ? cols * (W + GX) - GX : 0);
      const h = tray.length ? ty + 2 + rows * (H + 1) - 1 : L.h;
      const f = Math.min(MAX_FS, availW / (w * UX), availH / (h * UY));
      if (!best || f > best.f + 0.01) best = { f, L, cols, w, h, ty };
    }
  }
  const { L, cols, w, h, ty } = best;
  const fs = Math.max(printing ? 2 : MIN_FS, Math.floor(best.f * 10) / 10);  // paper can go smaller than a screen
  const boxes = [...L.boxes];
  tray.forEach((id, i) => boxes.push([id, (i % cols) * (W + GX), ty + 2 + Math.floor(i / cols) * (H + 1)]));
  shown = { segs: L.segs, boxes, w, h, ty, tray: tray.length };
  chart.innerHTML = chartSVG(THEME, 0, fs / MAX_FS);
}

// -- drag and drop ----------------------------------------------------------

function showPad(box) {
  const tid = box.dataset.id;
  if (drag.pad?.tid === tid) return;
  hidePad();
  const n = esc(shortName(tid)), el = document.createElement('div');
  el.className = 'pad';
  el.innerHTML = [['boss', `↑ manages ${n}`], ['before', '← peer'], ['replace', `⇄ replace ${n}`], ['after', 'peer →'], ['report', `↓ reports to ${n}`]]
    .map(([z, t]) => `<div class="zone" data-zone="${z}">${t}</div>`).join('');
  document.body.append(el);
  const r = box.getBoundingClientRect(), pw = el.offsetWidth, ph = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
  el.style.top = Math.max(8, Math.min(innerHeight - ph - 8, r.top + r.height / 2 - ph / 2)) + 'px';
  drag.pad = { el, tid };
}
function hidePad() { drag?.pad?.el.remove(); if (drag) drag.pad = null; }

function setOp(op, tid) {
  drag.op = op; drag.tid = tid;
  drag.pad?.el.querySelectorAll('.zone').forEach(z => z.classList.toggle('on', z.dataset.zone === op));
}

function track() {
  const e = drag.last;
  drag.ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
  drag.moving = drag.alone ? new Set([drag.id]) : team(drag.id);
  chart.querySelectorAll('.box').forEach(b => b.classList.toggle('moving', drag.moving.has(b.dataset.id)));
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const zone = el?.closest('.pad .zone'), box = el?.closest('.box');
  if (zone || el?.closest('.pad')) {
    if (drag.moving.has(drag.pad.tid)) { hidePad(); setOp('bad', null); }
    else if (zone) setOp(zone.dataset.zone, drag.pad.tid);
  } else if (box && box.dataset.id !== drag.id) {
    if (drag.moving.has(box.dataset.id)) { hidePad(); setOp('bad', box.dataset.id); }
    else { showPad(box); setOp('none', box.dataset.id); }
  } else { hidePad(); setOp(box ? null : 'detach', null); }
}

function endDrag() {
  if (!drag) return;
  hidePad();
  drag.ghost?.remove();
  chart.querySelectorAll('.moving').forEach(b => b.classList.remove('moving'));
  document.body.style.cursor = '';
  drag = null;
}

function apply(op, id, tid, alone) {
  if (op === 'detach' && !byName().get(id).manager && !(alone && kidsMap().has(id))) return;
  // everyone else stays put: the mover lands where it was dropped
  commit(() => {
    const P = byName(), x = P.get(id), t = P.get(tid);
    if (alone) {  // their reports move up into their spot
      const kids = state.people.filter(p => p.manager === id);
      kids.forEach(p => { p.manager = x.manager; });
      place(kids, x);
    }
    if (op === 'detach') { x.manager = null; place([x]); }
    else if (op === 'report') {  // after the target's other reports
      const last = state.people.findLast(p => p.manager === tid && p !== x);
      x.manager = tid;
      if (last) place([x], last, true);
    }
    else if (op === 'before' || op === 'after') { x.manager = t.manager; place([x], t, op === 'after'); }
    else if (op === 'boss') { x.manager = t.manager; t.manager = id; place([x], t); }
    else if (op === 'replace') {  // take the target's spot; the target goes to the tray
      x.manager = t.manager;
      for (const p of state.people) if (p.manager === tid) p.manager = id;
      t.manager = null;
      place([x], t);
    }
  });
}

chart.addEventListener('pointerdown', e => {
  const b = e.target.closest('.box');
  if (!b || e.button !== 0) return;
  drag = { id: b.dataset.id, x0: e.clientX, y0: e.clientY, on: false, alone: e.shiftKey, last: e };
  e.preventDefault();
});
addEventListener('pointermove', e => {
  if (!drag) return;
  drag.last = e;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.on = true;
    drag.ghost = Object.assign(document.createElement('div'), { className: 'ghost', textContent: shortName(drag.id) });
    document.body.append(drag.ghost);
    document.body.style.cursor = 'grabbing';
  }
  drag.alone = e.shiftKey;
  track();
});
addEventListener('pointerup', () => {
  const d = drag;
  endDrag();
  if (d && !d.on) openEdit(d.id);  // a click, not a drag
  else if (d?.op && d.op !== 'none' && d.op !== 'bad') apply(d.op, d.id, d.tid, d.alone);
});
addEventListener('pointercancel', endDrag);

// -- chrome -----------------------------------------------------------------

addEventListener('keydown', e => {
  if (e.key === 'Escape' && drag) { endDrag(); return; }
  if (e.key === 'Shift' && drag?.on) { drag.alone = true; track(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !$('dialog[open]')) { e.preventDefault(); doUndo(); }
});
addEventListener('keyup', e => { if (e.key === 'Shift' && drag?.on) { drag.alone = false; track(); } });

addEventListener('beforeprint', () => { printing = true; render(); });
addEventListener('afterprint', () => { printing = false; render(); });

let resizeQueued = false;
addEventListener('resize', () => {
  if (resizeQueued || drag) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; render(); });
});

function openData() {
  $('#data').value = state.people.length ? toCSV() : '';
  dlg.returnValue = '';
  dlg.showModal();
  $('#data').focus();
}
$('#btn-data').onclick = $('#btn-start').onclick = openData;
dlg.addEventListener('close', () => { if (dlg.returnValue === 'apply') importText($('#data').value); });
$('#btn-undo').onclick = doUndo;

// popovers drop down from their buttons
function dropDown(pop, btn) {
  pop.addEventListener('beforetoggle', e => {
    if (e.newState !== 'open') return;
    const r = btn.getBoundingClientRect();
    pop.style.top = r.bottom + 4 + 'px';
    pop.style.right = innerWidth - r.right + 'px';
  });
}
dropDown(menu, $('#btn-menu'));
// menu commands close it first (before any dialog or confirm),
// while Share and Copy as stay open to show "Copied", and sort stays open to compare orders
menu.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.sort) commit(() => state.people.sort(SORTS[b.dataset.sort]));
  else if (b.dataset.copy) copyAs(b);
  else menu.hidePopover();
}, true);

// -- anniversaries --------------------------------------------------------------
// The bell lists whole-year anniversaries at the org and in role, from NEAR days ago to AHEAD days out,
// and lights up when any fall within NEAR days either way.

const NEAR = 14, AHEAD = 90, bell = $('#bell'), bellBtn = $('#btn-bell');
function anniversaries() {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), out = new Map();
  for (const p of state.people) {
    for (const [key, what] of [['orgStart', 'at org'], ['roleStart', p.role ? `as ${p.role}` : 'in role']]) {
      if (/^\s*\d{4}\s*$/.test(p[key] || '')) continue;  // a bare year has no anniversary date
      const d = parseDate(p[key]);
      if (!d) continue;
      for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 1; y++) {
        const n = y - d.getFullYear(), on = new Date(y, d.getMonth(), d.getDate());
        const days = Math.round((on - today) / 864e5);  // rounded, since DST makes some days 23 or 25 hours
        if (n < 1 || days < -NEAR || days > AHEAD) continue;
        const k = `${p.name}\n${days}`;  // one entry per person per day
        if (!out.has(k)) out.set(k, { name: p.name, on, days, what: [] });
        out.get(k).what.push(`${n} year${n > 1 ? 's' : ''} ${what}`);
      }
    }
  }
  return [...out.values()].sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
}
function renderBell() {
  const near = anniversaries().filter(a => a.days <= NEAR).length;
  bellBtn.classList.toggle('alert', near > 0);
  bellBtn.title = near ? `Anniversaries (${near} within ${NEAR} days)` : 'Anniversaries';
}
dropDown(bell, bellBtn);
bell.addEventListener('beforetoggle', e => {
  if (e.newState !== 'open') return;
  renderBell();  // the day may have turned since the last render
  const list = anniversaries(), date = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const rel = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;
  bell.innerHTML = '<div class="label">Anniversaries</div>' + (list.length
    ? '<ul>' + list.map(a => `<li${a.days <= NEAR ? ' class="near"' : ''}><b>${esc(a.name)}</b><span>${date(a.on)}</span>` +
      `<span>${esc(a.what.join(' · '))}</span><span>${rel(a.days)}</span></li>`).join('') + '</ul>'
    : `<p>None from ${NEAR} days ago to ${AHEAD} days out.</p>`);
});

// -- edit one person ----------------------------------------------------------

let editing = null;  // name of the person being edited; null when adding
const iso = s => {
  const d = parseDate(s), z = n => String(n).padStart(2, '0');
  return d ? `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}` : '';
};
function openEdit(id = null) {
  editing = id;
  const p = id ? byName().get(id) : { name: '', role: '', roleStart: '', orgStart: '' };
  $('#edit-title').textContent = id ? 'Edit person' : 'Add person';
  $('#e-name').value = p.name;
  $('#e-role').value = p.role;
  $('#e-rs').value = iso(p.roleStart);
  $('#e-os').value = iso(p.orgStart);
  $('#btn-delete').hidden = !id;
  $('#edit-err').textContent = '';
  edit.showModal();
}
$('#edit-form').addEventListener('submit', e => {
  const name = $('#e-name').value.trim(), P = byName(), old = P.get(editing);
  const err = !name ? 'Name is required.' : name !== editing && P.has(name) ? `${name} already exists.` : '';
  if (err) { e.preventDefault(); $('#edit-err').textContent = err; return; }
  // keep the original date text (e.g. "Mar 2021") unless the date was changed
  const date = (sel, key) => { const v = $(sel).value; return old && v === iso(old[key]) ? old[key] : v; };
  const vals = { name, role: $('#e-role').value.trim(), roleStart: date('#e-rs', 'roleStart'), orgStart: date('#e-os', 'orgStart') };
  commit(() => {
    if (!old) return state.people.push({ ...vals, manager: null });
    const p = byName().get(editing);
    for (const q of state.people) if (q.manager === editing) q.manager = name;
    Object.assign(p, vals);
  });
});
$('#btn-cancel').onclick = () => edit.close();
$('#btn-delete').onclick = () => {
  const id = editing;
  edit.close();
  commit(() => {  // their reports move up to their manager, into their spot
    const x = byName().get(id), kids = state.people.filter(p => p.manager === id);
    kids.forEach(p => { p.manager = x.manager; });
    place(kids, x);
    state.people.splice(state.people.indexOf(x), 1);
  });
};
$('#btn-add').onclick = () => openEdit();
$('#btn-clear').onclick = () => {
  if (state.people.length && confirm('Remove everyone? (Undo can bring them back.)')) commit(() => { state.people = []; });
};

// -- multiple charts ----------------------------------------------------------

function nextName() {
  const used = new Set(store.charts.map(c => c.name));
  let i = 1;
  while (used.has(`org-${i}`)) i++;
  return `org-${i}`;
}
function switchTo(i) {
  store.cur = i; state = store.charts[i]; undo = [];
  fixCycles(); save(); render();
}
function addChart(people = []) {
  store.charts.push({ name: nextName(), people });
  switchTo(store.charts.length - 1);
}
function deleteChart(i) {
  const c = store.charts[i];
  if (store.charts.length < 2 || (c.people.length && !confirm(`Delete ${c.name}? This can't be undone.`))) return;
  store.charts.splice(i, 1);
  switchTo(i < store.cur ? store.cur - 1 : Math.min(store.cur, store.charts.length - 1));
}
$('#tabs').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.go) switchTo(+b.dataset.go);
  else if (b.dataset.del) deleteChart(+b.dataset.del);
  else if (b.hasAttribute('data-new')) addChart();
};

// -- copy as ----------------------------------------------------------------------
// Text formats use full names in the current peer order; SVG and PNG are the chart as shown.

// the hierarchy as nested { p, reports } in peer order, plus the unassigned people
function tree() {
  const { kids, roots, tray } = arrange(), P = byName();
  const node = id => ({ p: P.get(id), reports: (kids.get(id) || []).map(node) });
  return { roots: roots.map(node), tray: tray.map(id => P.get(id)) };
}
const withRole = p => p.role ? `${p.name}, ${p.role}` : p.name;

function toList() {
  const { roots, tray } = tree();
  const walk = (n, d) => [`${'  '.repeat(d)}- ${withRole(n.p)}`, ...n.reports.flatMap(c => walk(c, d + 1))];
  const blocks = roots.map(r => [withRole(r.p), ...r.reports.flatMap(c => walk(c, 0))].join('\n'));
  if (tray.length) blocks.push(['Unassigned', ...tray.map(p => `- ${withRole(p)}`)].join('\n'));
  return blocks.join('\n\n');
}

function toJSON() {
  const { roots, tray } = tree();
  const person = ({ name, role, roleStart, orgStart }) => ({ name, role, roleStart, orgStart });
  const json = n => ({ ...person(n.p), reports: n.reports.map(json) });
  return JSON.stringify({ chart: state.name, people: roots.map(json), unassigned: tray.map(person) }, null, 2);
}

function toMermaid() {
  const { roots, tray } = tree(), nodes = [], edges = [];
  const q = s => s.replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
  let n = 0;
  const node = p => { const id = `p${n++}`; return [id, `${id}["${q(p.name)}${p.role ? `<br>${q(p.role)}` : ''}"]`]; };
  const walk = (t, boss) => {
    const [id, line] = node(t.p);
    nodes.push(`  ${line}`);
    if (boss) edges.push(`  ${boss} --> ${id}`);
    t.reports.forEach(c => walk(c, id));
  };
  roots.forEach(r => walk(r));
  const out = ['flowchart TD', ...nodes, ...edges];
  if (tray.length) out.push('  subgraph unassigned["Unassigned"]', ...tray.map(p => `    ${node(p)[1]}`), '  end');
  return out.join('\n');
}

const toSVG = () => chartSVG(INK, 16);
async function toPNG() {
  const url = URL.createObjectURL(new Blob([toSVG()], { type: 'image/svg+xml' })), img = new Image();
  try {
    img.src = url;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(2, Math.sqrt(16e6 / (w * h)));  // 2x, within canvas limits
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(new Error('no image')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

const COPY = {
  link: async () => `${location.origin}${location.pathname}#share=${await pack(toRows())}`,
  list: toList, csv: toCSV, json: toJSON, mermaid: toMermaid, svg: toSVG, png: toPNG,
};
function flash(b, msg) {
  const t = b.dataset.text ||= b.textContent;
  b.textContent = msg;
  clearTimeout(b.flash);
  b.flash = setTimeout(() => { b.textContent = t; }, 2000);
}
async function copyAs(b) {
  if (!state.people.length) return flash(b, 'Nothing to copy');
  const kind = b.dataset.copy, type = kind === 'png' ? 'image/png' : 'text/plain';
  // the clipboard gets a promise, so a slow copy (PNG, share link) still counts as part of the click (Safari)
  const data = (async () => { const v = await COPY[kind](); return v instanceof Blob ? v : new Blob([v], { type }); })();
  try {
    await navigator.clipboard.write([new ClipboardItem({ [type]: data })]);
    flash(b, 'Copied');
  } catch { flash(b, "Couldn't copy"); }
}

// -- share links --------------------------------------------------------------
// The chart rides in the URL fragment (#share=...), deflated and base64url-encoded.
// Fragments never reach the server, so no logs and no URL length limit there.

async function pack(obj) {
  const s = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  let bin = '';
  for (const b of new Uint8Array(await new Response(s).arrayBuffer())) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpack(str) {
  const bytes = Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(s).text());
}
// payload: toRows()
function fromRows(rows) {
  if (!Array.isArray(rows)) throw new Error('bad share data');
  const recs = new Map();
  for (const r of rows) if (Array.isArray(r) && r[0] && !recs.has(String(r[0]))) {
    const [name, role = '', roleStart = '', orgStart = '', manager = ''] = r.map(v => String(v ?? ''));
    recs.set(name, { name, role, roleStart, orgStart, manager: manager || null });
  }
  return [...recs.values()];
}

async function openShared() {
  const m = location.hash.match(/^#share=([\w-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);  // so a reload doesn't import it again
  try {
    const people = fromRows(await unpack(m[1]));
    // a first visit has one empty chart; fill it rather than leave it behind
    if (store.charts.length === 1 && !state.people.length) { state.people = people; switchTo(0); }
    else addChart(people);
  } catch { alert('That share link is damaged or incomplete.'); }
}
addEventListener('hashchange', openShared);  // a link pasted into an already-open tab

// charts saved while peers were always shown sorted: bake that order in, once
if (store.sort !== 'manual') {
  for (const c of store.charts) c.people.sort(SORTS[store.sort] || nameCmp);
  store.sort = 'manual'; save();
}
render();
openShared();
