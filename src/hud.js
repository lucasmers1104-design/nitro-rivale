// Analoger Tacho + Schadensanzeige (Canvas 2D)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function setupCanvas(cv, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ---------------------------------------------------------------------------
// Kombiinstrument im Stil klassischer deutscher Oberklasse-Limousinen.
// Statischer Teil (Gehäuse, Ringe, Skalen) wird einmal vorgerendert,
// pro Frame kommen nur Nadeln, Display und Warnleuchten dazu.
// ---------------------------------------------------------------------------
const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
const FONT = '"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif';
function chromeRing(ctx, cx, cy, r, w) {
  let g;
  if (ctx.createConicGradient) {
    g = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    const st = [[0, '#f4f5f7'], [0.08, '#9ea3ab'], [0.18, '#e9ebee'], [0.3, '#7d828a'], [0.42, '#d7dade'], [0.5, '#f7f8fa'], [0.6, '#8b9098'], [0.72, '#e3e5e8'], [0.85, '#767b83'], [1, '#f4f5f7']];
    for (const [o, c] of st) g.addColorStop(o, c);
  } else {
    g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#f2f3f5'); g.addColorStop(0.5, '#8f949c'); g.addColorStop(1, '#e6e8eb');
  }
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.lineWidth = w; ctx.strokeStyle = g; ctx.stroke();
  // Fasen
  ctx.beginPath(); ctx.arc(cx, cy, r + w / 2, 0, Math.PI * 2); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r - w / 2, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
}
function tube(ctx, cx, cy, r) {
  // vertiefte Röhre: dunkler Innenschatten zum Rand hin
  const f = ctx.createRadialGradient(cx, cy + r * 0.08, r * 0.2, cx, cy, r);
  f.addColorStop(0, '#16171a'); f.addColorStop(0.82, '#0d0e10'); f.addColorStop(1, '#030304');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = f; ctx.fill();
}
function scale(ctx, cx, cy, r, o) {
  const ang = (v) => A0 + (Math.min(Math.max(v, 0), o.max) / o.max) * (A1 - A0);
  if (o.red != null) {
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.885, ang(o.red), A1); ctx.lineWidth = r * 0.06; ctx.strokeStyle = '#b8231a'; ctx.stroke();
  }
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.35)'; ctx.shadowBlur = 1.5;
  for (let v = 0; v <= o.max + 1e-6; v += o.minor) {
    const a = ang(v);
    const maj = Math.abs(v / o.major - Math.round(v / o.major)) < 1e-6;
    const mid = !maj && o.mid && Math.abs(v / o.mid - Math.round(v / o.mid)) < 1e-6;
    const r1 = r * (maj ? 0.79 : mid ? 0.845 : 0.875), r2 = r * 0.92;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.lineWidth = maj ? 2.8 : mid ? 1.7 : 1.0;
    ctx.strokeStyle = o.red != null && v > o.red + 1e-6 ? '#ff5a48' : '#f3f3f1';
    ctx.stroke();
    const lab = maj && Math.abs(v / (o.labelEvery || o.major) - Math.round(v / (o.labelEvery || o.major))) < 1e-6;
    if (lab) {
      ctx.fillStyle = '#f6f6f4';
      ctx.font = `500 ${Math.round(r * o.fs)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const rr = r * (o.numR || 0.655);
      ctx.fillText(o.label(v), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr + 1);
    }
  }
  ctx.restore();
  ctx.fillStyle = '#d6d6d2'; ctx.font = `500 ${Math.round(r * 0.08)}px ${FONT}`; ctx.textAlign = 'center';
  ctx.fillText(o.unit, cx, cy - r * 0.3);
}
const subAng = (f) => Math.PI * (0.92 - 0.84 * f);
function subScale(ctx, sx, sy, sr, labels, title, redLow) {
  for (let k = 0; k <= 8; k++) {
    const a = subAng(k / 8), r1 = sr * (k % 4 === 0 ? 0.74 : 0.86);
    ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1); ctx.lineTo(sx + Math.cos(a) * sr, sy + Math.sin(a) * sr);
    ctx.lineWidth = k % 4 === 0 ? 1.8 : 1; ctx.strokeStyle = redLow && k === 0 ? '#e0392f' : '#ececea'; ctx.stroke();
  }
  ctx.fillStyle = '#ececea'; ctx.font = `500 ${Math.round(sr * 0.36)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  labels.forEach((l, k) => { const a = subAng(k / (labels.length - 1)); ctx.fillText(l, sx + Math.cos(a) * sr * 1.36, sy + Math.sin(a) * sr * 1.36); });
  if (title === 'fuel') {
    // Zapfsäulen-Symbol
    const x = sx + sr * 0.55, y = sy - sr * 0.5;
    ctx.fillStyle = '#d8d8d4'; ctx.fillRect(x - 5, y - 6, 7, 11); ctx.fillStyle = '#0d0e10'; ctx.fillRect(x - 3.5, y - 4.5, 4, 3);
    ctx.strokeStyle = '#d8d8d4'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + 2, y - 3); ctx.lineTo(x + 5, y); ctx.lineTo(x + 5, y + 4); ctx.stroke();
  } else {
    ctx.font = `500 ${Math.round(sr * 0.3)}px ${FONT}`; ctx.fillStyle = '#c4c4c0'; ctx.fillText(title, sx, sy - sr * 0.52);
  }
}
function needle(ctx, cx, cy, len, tail, w, a, col = '#f2f3f1') {
  ctx.save();
  // Schatten (Nadel schwebt über dem Blatt)
  ctx.translate(cx + 2.2, cy + 3.2); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(-tail, -w * 0.9); ctx.lineTo(len, -w * 0.2); ctx.lineTo(len, w * 0.2); ctx.lineTo(-tail, w * 0.9); ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.filter = 'blur(1.5px)'; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(a);
  const g = ctx.createLinearGradient(0, -w, 0, w);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, col); g.addColorStop(1, '#b9bcc0');
  ctx.beginPath(); ctx.moveTo(-tail, -w * 0.9); ctx.lineTo(len, -w * 0.2); ctx.lineTo(len, w * 0.2); ctx.lineTo(-tail, w * 0.9); ctx.closePath();
  ctx.shadowColor = 'rgba(255,240,220,0.5)'; ctx.shadowBlur = 3;
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
}
function hub(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
  g.addColorStop(0, '#5a5e66'); g.addColorStop(0.45, '#1a1c20'); g.addColorStop(1, '#030304');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.1, Math.PI * 1.65); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.stroke();
}
function lcdBox(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#1a0505'); g.addColorStop(1, '#0d0202');
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#050101'; ctx.stroke();
}
function seg(ctx, text, x, y, size, align = 'center', ghost = null) {
  ctx.save();
  ctx.font = `${size}px "Share Tech Mono", "Courier New", monospace`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (ghost) { ctx.fillStyle = 'rgba(255,60,30,0.07)'; ctx.fillText(ghost, x, y); }
  ctx.shadowColor = 'rgba(255,50,20,0.85)'; ctx.shadowBlur = 5;
  ctx.fillStyle = '#ff4224'; ctx.fillText(text, x, y);
  ctx.restore();
}
function lamp(ctx, kind, x, y, s, on, color) {
  if (!on) return; // ohne Gehäuse nur leuchtende Lampen zeigen
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = color;
  if (on) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
  ctx.lineWidth = 1.7;
  if (kind === 'brake') {
    ctx.beginPath(); ctx.arc(x, y, s * 0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, s * 0.6, -0.75, 0.75); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * 0.6, Math.PI - 0.75, Math.PI + 0.75); ctx.stroke();
    ctx.font = `600 ${s * 0.52}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('P', x, y + 1);
  } else if (kind === 'belt') {
    ctx.beginPath(); ctx.arc(x, y - s * 0.36, s * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - s * 0.22, y + s * 0.42); ctx.quadraticCurveTo(x - s * 0.24, y - s * 0.16, x, y - s * 0.16); ctx.quadraticCurveTo(x + s * 0.24, y - s * 0.16, x + s * 0.22, y + s * 0.42); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - s * 0.2, y - s * 0.1); ctx.lineTo(x + s * 0.16, y + s * 0.3); ctx.stroke();
  } else if (kind === 'engine') {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.42, y - s * 0.05); ctx.lineTo(x - s * 0.3, y - s * 0.05); ctx.lineTo(x - s * 0.3, y - s * 0.22); ctx.lineTo(x + s * 0.18, y - s * 0.22);
    ctx.lineTo(x + s * 0.3, y - s * 0.1); ctx.lineTo(x + s * 0.44, y - s * 0.1); ctx.lineTo(x + s * 0.44, y + s * 0.22); ctx.lineTo(x + s * 0.3, y + s * 0.22);
    ctx.lineTo(x + s * 0.18, y + s * 0.3); ctx.lineTo(x - s * 0.3, y + s * 0.3); ctx.lineTo(x - s * 0.3, y + s * 0.12); ctx.lineTo(x - s * 0.42, y + s * 0.12); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * 0.12, y - s * 0.22); ctx.lineTo(x - s * 0.12, y - s * 0.34); ctx.moveTo(x - s * 0.22, y - s * 0.34); ctx.lineTo(x - s * 0.02, y - s * 0.34); ctx.stroke();
  } else if (kind === 'tc') {
    ctx.beginPath(); ctx.moveTo(x - s * 0.3, y + s * 0.2); ctx.lineTo(x - s * 0.18, y - s * 0.3); ctx.lineTo(x + s * 0.18, y - s * 0.3); ctx.lineTo(x + s * 0.3, y + s * 0.2); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * 0.4, y + s * 0.42); ctx.quadraticCurveTo(x - s * 0.2, y + s * 0.3, x, y + s * 0.42); ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.54, x + s * 0.4, y + s * 0.42); ctx.stroke();
  } else if (kind === 'arrowL' || kind === 'arrowR') {
    const d = kind === 'arrowL' ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(x + d * s * 0.45, y); ctx.lineTo(x, y - s * 0.32); ctx.lineTo(x, y - s * 0.12); ctx.lineTo(x - d * s * 0.4, y - s * 0.12);
    ctx.lineTo(x - d * s * 0.4, y + s * 0.12); ctx.lineTo(x, y + s * 0.12); ctx.lineTo(x, y + s * 0.32); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

export class Cluster {
  constructor(cv) {
    this.cv = cv;
    this.w = 524; this.h = 280; // nur die zwei Rundinstrumente, eng nebeneinander
    this.ctx = setupCanvas(cv, this.w, this.h);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.n = { rpm: 0, rpmV: 0, spd: 0, spdV: 0, fuel: 0.86, cons: 20 };
    this.fuel = 0.86; this.cons = 20; this.odo = 95395; this.trip = 25; this.t = 0;
    this.bgKey = null;
    this.R = 118; this.cy = 156; this.lx = 130; this.rx = this.w - 130;
  }
  renderBg(maxK, red) {
    const W = this.w, H = this.h, R = this.R, cy = this.cy;
    const cv = document.createElement('canvas');
    cv.width = W * this.dpr; cv.height = H * this.dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Kein Gehäuse mehr: nur die Rundinstrumente schweben über dem Bild
    for (const cx of [this.lx, this.rx]) {
      tube(ctx, cx, cy, R * 1.06);
    }
    scale(ctx, this.lx, cy, R, { max: 280, major: 20, labelEvery: 40, minor: 5, mid: 10, fs: 0.15, numR: 0.64, label: (v) => String(v), unit: 'km/h' });
    scale(ctx, this.rx, cy, R, { max: maxK, major: 1, minor: maxK > 8 ? 0.25 : 0.2, mid: 0.5, fs: 0.2, numR: 0.64, red, label: (v) => String(Math.round(v)), unit: '1/min x 1000' });
    const sr = R * 0.24;
    subScale(ctx, this.lx, cy + R * 0.47, sr, ['0', '½', '1'], 'fuel', true);
    subScale(ctx, this.rx, cy + R * 0.47, sr, ['0', '10', '20'], 'l/100 km', false);
    for (const cx of [this.lx, this.rx]) chromeRing(ctx, cx, cy, R * 1.0, R * 0.075);
    return cv;
  }
  glass(ctx, cx, cy, R) {
    const gl = ctx.createLinearGradient(cx - R, cy - R, cx + R * 0.3, cy);
    gl.addColorStop(0, 'rgba(255,255,255,0.07)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.02)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * 0.96, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.ellipse(cx - R * 0.25, cy - R * 0.55, R * 0.95, R * 0.45, -0.35, 0, Math.PI * 2); ctx.fillStyle = gl; ctx.fill();
    ctx.restore();
  }
  draw(car, dt) {
    const E = car.p.engine;
    const ctx = this.ctx, W = this.w, H = this.h, R = this.R, cy = this.cy;
    const maxK = Math.max(7, Math.ceil(E.redline / 1000) + 1);
    const key = maxK + ':' + E.redline;
    if (key !== this.bgKey) { this.bg = this.renderBg(maxK, E.redline / 1000); this.bgKey = key; }
    this.t += dt;
    // Nadeln mit Feder-Dämpfer (leichtes Nachschwingen wie echte Schrittmotoren)
    const n = this.n;
    n.rpmV += ((car.rpm - n.rpm) * 260 - n.rpmV * 26) * dt; n.rpm += n.rpmV * dt;
    n.spdV += ((car.speed - n.spd) * 170 - n.spdV * 24) * dt; n.spd += n.spdV * dt;
    const thr = car.input.throttle;
    const consT = car.speed > 3 ? clamp((2 + thr * 34 * (car.rpm / E.redline)) * (60 / Math.max(car.speed, 20)), 2, 20) : 20;
    this.cons += (consT - this.cons) * Math.min(1, dt * 2.5);
    this.fuel = Math.max(0.03, this.fuel - thr * dt * 0.0006 * (car.rpm / E.redline));
    const km = (car.speed / 3600) * dt;
    this.odo += km; this.trip += km;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.bg, 0, 0, W, H);
    const ang = (v, max) => A0 + (clamp(v, -0.02 * max, max * 1.01) / max) * (A1 - A0);
    const sr = R * 0.24;
    needle(ctx, this.lx, cy + R * 0.47, sr * 0.95, sr * 0.18, sr * 0.1, subAng(this.fuel));
    hub(ctx, this.lx, cy + R * 0.47, sr * 0.2);
    needle(ctx, this.rx, cy + R * 0.47, sr * 0.95, sr * 0.18, sr * 0.1, subAng(this.cons / 20));
    hub(ctx, this.rx, cy + R * 0.47, sr * 0.2);
    needle(ctx, this.lx, cy, R * 0.86, R * 0.2, R * 0.05, ang(n.spd, 280));
    hub(ctx, this.lx, cy, R * 0.13);
    needle(ctx, this.rx, cy, R * 0.86, R * 0.2, R * 0.05, ang(n.rpm / 1000, maxK));
    hub(ctx, this.rx, cy, R * 0.13);
    this.glass(ctx, this.lx, cy, R); this.glass(ctx, this.rx, cy, R);
  }
}

// Schadensanzeige: Draufsicht auf das Auto, jedes Teil farbig
const COLS = { ok: '#4fd17f', warn: '#f2c43a', bad: '#f07a2e', crit: '#e0392f' };
const stateCol = (f) => (f > 0.75 ? COLS.ok : f > 0.5 ? COLS.warn : f > 0.25 ? COLS.bad : COLS.crit);
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export class DamageView {
  constructor(cv) {
    this.cv = cv;
    this.w = 230; this.h = 318;
    this.ctx = setupCanvas(cv, this.w, this.h);
    this.flash = 0;
    this.lastBody = 100;
  }
  draw(car, dt) {
    const ctx = this.ctx, W = this.w;
    if (car.bodyHp < this.lastBody - 0.5) this.flash = 1;
    this.lastBody = car.bodyHp;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    ctx.clearRect(0, 0, W, this.h);
    const part = (id) => car.parts.find((p) => p.id === id);
    const pf = (id) => { const p = part(id); if (!p) return null; return p.state === 'gone' ? -1 : p.state === 'loose' ? Math.min(0.3, p.hp / p.maxHp) : p.hp / p.maxHp; };
    const fillPart = (f, draw) => {
      if (f === null) return;
      draw();
      if (f < 0) { ctx.setLineDash([4, 3]); ctx.strokeStyle = COLS.crit; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
      else { ctx.fillStyle = stateCol(f); ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke(); }
    };
    const ox = 70, oy = 18, cw = 90, ch = 176; // Auto-Rahmen
    // Grundkörper
    const bodyF = car.bodyHp / 100;
    rr(ctx, ox, oy + 8, cw, ch - 16, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
    ctx.strokeStyle = this.flash > 0 ? `rgba(255,70,50,${0.4 + this.flash * 0.6})` : stateCol(bodyF); ctx.lineWidth = 2.5; ctx.stroke();
    // Räder
    const wh = { FL: [ox - 9, oy + 26], FR: [ox + cw - 3, oy + 26], RL: [ox - 9, oy + ch - 58], RR: [ox + cw - 3, oy + ch - 58] };
    for (const w of car.wheels) {
      const [x, y] = wh[w.id];
      fillPart(w.lost ? -1 : 1 - w.bend / 0.28, () => rr(ctx, x, y, 12, 32, 3));
    }
    fillPart(pf('bullbar'), () => rr(ctx, ox + 6, oy - 8, cw - 12, 7, 3));
    fillPart(pf('bumperF'), () => rr(ctx, ox + 2, oy, cw - 4, 12, 5));
    fillPart(pf('hood'), () => rr(ctx, ox + 10, oy + 16, cw - 20, 38, 6));
    // Scheiben + Dach
    const gS = car.glassStage || 0;
    ctx.fillStyle = gS === 0 ? '#5b7fa6' : gS === 1 ? '#b7c6d4' : '#e8eef4';
    rr(ctx, ox + 14, oy + 58, cw - 28, 16, 4); ctx.fill();
    rr(ctx, ox + 14, oy + 118, cw - 28, 12, 4); ctx.fill();
    fillPart(bodyF, () => rr(ctx, ox + 16, oy + 76, cw - 32, 40, 5));
    fillPart(pf('doorL'), () => rr(ctx, ox - 2, oy + 62, 9, 52, 3));
    fillPart(pf('doorR'), () => rr(ctx, ox + cw - 7, oy + 62, 9, 52, 3));
    fillPart(pf('mirrorL'), () => rr(ctx, ox - 9, oy + 60, 7, 6, 2));
    fillPart(pf('mirrorR'), () => rr(ctx, ox + cw + 2, oy + 60, 7, 6, 2));
    fillPart(pf('trunk'), () => rr(ctx, ox + 10, oy + 133, cw - 20, 24, 6));
    fillPart(pf('spoiler'), () => rr(ctx, ox + 6, oy + 156, cw - 12, 6, 2));
    fillPart(pf('bumperR'), () => rr(ctx, ox + 2, oy + ch - 12, cw - 4, 12, 5));
    // Motor-Symbol im Bug
    const eF = car.engineHp / 100;
    ctx.beginPath(); ctx.arc(ox + cw / 2, oy + 35, 8, 0, Math.PI * 2); ctx.fillStyle = stateCol(eF); ctx.fill();
    ctx.fillStyle = '#16171b'; ctx.font = 'bold 9px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('M', ox + cw / 2, oy + 35.5);
    // Werte
    const st = car.stats;
    const rows = [
      ['Karosserie', Math.round(st.body) + '%', stateCol(bodyF)],
      ['Motorleistung', Math.round(st.power) + '%', stateCol(eF)],
      ['Lenkung', Math.abs(st.pull) < 0.3 ? 'gerade' : `zieht ${Math.abs(st.pull).toFixed(1).replace('.', ',')}° ${st.pull > 0 ? 'links' : 'rechts'}`, Math.abs(st.pull) < 1 ? COLS.ok : Math.abs(st.pull) < 3 ? COLS.warn : COLS.crit],
      ['Räder', `${4 - st.wheelsLost}/4`, st.wheelsLost ? COLS.crit : COLS.ok],
      ['Scheiben', ['intakt', 'gerissen', 'zersplittert'][st.glass], [COLS.ok, COLS.warn, COLS.crit][st.glass]],
    ];
    let y = oy + ch + 22;
    ctx.textBaseline = 'middle';
    for (const [k, v, c] of rows) {
      ctx.fillStyle = '#a9a6a0'; ctx.font = '500 12px Fredoka, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(k, 14, y);
      ctx.fillStyle = c; ctx.font = '600 12.5px Fredoka, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(v, W - 14, y);
      y += 19;
    }
  }
}
