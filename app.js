// Org chart. State lives in localStorage; see plans/PLAN.md.
'use strict';

const KEY = 'orgchart.v1';
// Layout runs on a grid: one x unit = UX em, one y unit = UY em. The chart scales via font-size.
const UX = .6, UY = 1.25;
const H = 4, GX = 3, GY = 3;    // box height, horizontal gap, vertical gap (grid units)
const MAX_FS = 14, MIN_FS = 5;  // chart font size range in px

const $ = s => document.querySelector(s);
const chart = $('#chart'), stage = $('#stage'), dlg = $('#dlg'), edit = $('#edit');
const SANS = getComputedStyle(document.documentElement).getPropertyValue('--sans');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let state = load(), undo = [], W = 24, fs = 14, drag = null, short = new Map(), printing = false;
// printable area in CSS px: the smaller of Letter and A4 landscape, minus the @page margins in style.css
const PRINT_W = 960, PRINT_H = 700;

// -- state ------------------------------------------------------------------

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.people)) return s;
  } catch {}
  return { people: [] };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
function commit(fn) {
  undo.push(JSON.stringify(state));
  if (undo.length > 100) undo.shift();
  fn(); fixCycles(); save(); render();
}
function doUndo() { if (undo.length) { state = JSON.parse(undo.pop()); save(); render(); } }

const byName = () => new Map(state.people.map(p => [p.name, p]));
// longest at the org first; unknown dates last
const orgTime = p => parseDate(p.orgStart)?.getTime() ?? Infinity;
const byOrg = (a, b) => orgTime(a) - orgTime(b);
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
function toCSV() {
  const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return ['name,role,role start,org start,manager',
    ...state.people.map(p => [p.name, p.role, p.roleStart, p.orgStart, p.manager || ''].map(q).join(','))].join('\n');
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

// box width in grid units, sized to the widest content (em sizes must match .box rules in style.css)
const ctx = document.createElement('canvas').getContext('2d');
// measure near the real size--system fonts swap optical cuts at large sizes
const textEm = (t, weight, em) => { ctx.font = `${weight} ${em * MAX_FS}px ${SANS}`; return ctx.measureText(t).width / MAX_FS; };
function boxWidth() {
  let em = 0;
  for (const p of state.people) {
    const top = textEm(shortName(p.name), 700, 1.25) + (p.role ? .5 + textEm(p.role, 600, .75) + .75 : 0);
    em = Math.max(em, top, textEm(tenure(p), 400, .85));
  }
  return Math.min(36, Math.max(16, Math.ceil((em + 2) / UX)));  // + padding, border, slack
}
function boxHTML(p) {
  return `<div class="top"><span class="name">${esc(shortName(p.name))}</span>${p.role ? `<span class="role">${esc(p.role)}</span>` : ''}</div>` +
    `<div class="ten">${esc(tenure(p))}</div>`;
}

// -- layout -----------------------------------------------------------------

// Lays out trees side by side. Returns box positions and connector paths, in grid units.
// compact: a manager whose reports are all leaves stacks them on a side rail.
function layout(compact, kids, roots) {
  const segs = [], boxes = [];
  const line = (x1, y1, x2, y2) => segs.push(`M${x1} ${y1}L${x2} ${y2}`);
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

function render() {
  short = shortNames();
  W = boxWidth();
  const people = [...state.people].sort(byOrg), kids = kidsMap(people);
  $('#empty').hidden = people.length > 0;
  chart.hidden = !people.length;
  if (!people.length) { chart.innerHTML = ''; return; }

  const roots = people.filter(p => !p.manager && kids.has(p.name)).map(p => p.name);
  const tray = people.filter(p => !p.manager && !kids.has(p.name)).map(p => p.name);
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
  fs = Math.max(printing ? 2 : MIN_FS, Math.floor(best.f * 10) / 10);  // paper can go smaller than a screen
  const boxes = [...L.boxes];
  tray.forEach((id, i) => boxes.push([id, (i % cols) * (W + GX), ty + 2 + Math.floor(i / cols) * (H + 1)]));

  const P = byName();
  chart.style.fontSize = fs + 'px';
  chart.style.width = w * UX + 'em';
  chart.style.height = h * UY + 'em';
  chart.innerHTML =
    `<svg class="wires" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${L.segs.join('')}"/></svg>` +
    (tray.length ? `<div class="tray" style="top:${ty * UY}em">Unassigned (${tray.length})</div>` : '') +
    boxes.map(([id, x, y]) => `<div class="box" data-id="${esc(id)}" style="left:${x * UX}em;top:${y * UY}em;width:${W * UX}em;height:${H * UY}em">${boxHTML(P.get(id))}</div>`).join('');
}

// -- drag and drop ----------------------------------------------------------

function showPad(box) {
  const tid = box.dataset.id;
  if (drag.pad?.tid === tid) return;
  hidePad();
  const n = esc(shortName(tid)), el = document.createElement('div');
  el.className = 'pad';
  el.innerHTML = [['boss', `↑ manages ${n}`], ['peer', '← peer'], ['replace', `⇄ replace ${n}`], ['peer', 'peer →'], ['report', `↓ reports to ${n}`]]
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
  commit(() => {
    const P = byName(), x = P.get(id), t = P.get(tid);
    if (alone) state.people.forEach(p => { if (p.manager === id) p.manager = x.manager; });
    if (op === 'detach') x.manager = null;
    else if (op === 'report') x.manager = tid;
    else if (op === 'peer') x.manager = t.manager;
    else if (op === 'boss') { x.manager = t.manager; t.manager = id; }
    else if (op === 'replace') {  // take the target's spot; the target goes to the tray
      x.manager = t.manager;
      for (const p of state.people) if (p.manager === tid) p.manager = id;
      t.manager = null;
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
  commit(() => {  // their reports move up to their manager
    const x = byName().get(id);
    for (const p of state.people) if (p.manager === id) p.manager = x.manager;
    state.people.splice(state.people.indexOf(x), 1);
  });
};
$('#btn-add').onclick = () => openEdit();
$('#btn-clear').onclick = () => {
  if (state.people.length && confirm('Remove everyone? (Undo can bring them back.)')) commit(() => { state.people = []; });
};

render();
