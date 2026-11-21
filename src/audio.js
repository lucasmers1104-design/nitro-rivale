// Synthetischer Sound für den Prototyp (Web Audio).
// Im fertigen Spiel ersetzen echte RPM-Sample-Loops den Motor-Synth; die Steuerlogik bleibt gleich.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class GameAudio {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.85;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    // Gegen Schärfe: Höhen ab 6 kHz leicht zurück, ganz oben sanft abschneiden
    this.hs = c.createBiquadFilter(); this.hs.type = 'highshelf'; this.hs.frequency.value = 6000; this.hs.gain.value = -3;
    this.lpMaster = c.createBiquadFilter(); this.lpMaster.type = 'lowpass'; this.lpMaster.frequency.value = 12500; this.lpMaster.Q.value = 0.5;
    this.master.connect(this.hs).connect(this.lpMaster).connect(this.comp).connect(c.destination);
    this.muted = false;
    // Rauschpuffer
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const bd = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    this.engine = null;
    this.banks = {};
    this.buildAmbience();
  }

  // Echte Motor-Samples laden: sounds/manifest.json beschreibt pro Motor die RPM-Loops
  // { "v8": { "loops": [ { "rpm": 1000, "on": "v8_on_1000.mp3", "off": "v8_off_1000.mp3" }, ... ] } }
  async loadBanks(base = 'sounds/') {
    try {
      const r = await fetch(base + 'manifest.json');
      if (!r.ok) return false;
      const man = await r.json();
      const dec = async (f) => (f ? this.ctx.decodeAudioData(await (await fetch(base + f)).arrayBuffer()) : null);
      for (const [name, bank] of Object.entries(man)) {
        const loops = [];
        for (const L of bank.loops) loops.push({ rpm: L.rpm, on: await dec(L.on), off: await dec(L.off) });
        loops.sort((a, b) => a.rpm - b.rpm);
        this.banks[name] = { loops, gain: bank.gain ?? 1 };
      }
      return Object.keys(this.banks).length > 0;
    } catch { return false; }
  }

  createSampleEngine(preset, bank) {
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = 0;
    const offLp = c.createBiquadFilter(); offLp.type = 'lowpass'; offLp.frequency.value = 1400;
    out.connect(this.master);
    offLp.connect(out);
    const voices = bank.loops.map((L) => {
      const mk = (buf, dest) => {
        const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
        const g = c.createGain(); g.gain.value = 0;
        s.connect(g).connect(dest); s.start(0, Math.random() * buf.duration);
        return { s, g };
      };
      return { rpm: L.rpm, on: mk(L.on || L.off, out), off: mk(L.off || L.on, L.off ? out : offLp) };
    });
    this.engine = { kind: 'sample', E: preset.engine, voices, out, bank, load: 0 };
    return this.engine;
  }
  resume() { return this.ctx.resume(); }

  async loadManifest(base = 'sounds/') {
    this.base = base;
    this.buffers = this.buffers || {};
    try {
      const r = await fetch(base + 'manifest.json');
      if (!r.ok) return null;
      this.manifest = await r.json();
      return this.manifest;
    } catch { return null; }
  }
  async getBuffer(id) {
    if (!this.manifest || !this.manifest[id]) return null;
    if (!this.buffers[id]) {
      this.buffers[id] = (async () => {
        const r = await fetch(this.base + this.manifest[id].file);
        return this.ctx.decodeAudioData(await r.arrayBuffer());
      })();
    }
    try { return await this.buffers[id]; } catch { delete this.buffers[id]; return null; }
  }
  // Echten Motor einsetzen (asynchron); bis dahin läuft der Synth weiter
  async useSound(preset, id, startNow = false) {
    this.wantSound = id;
    const buf = await this.getBuffer(id);
    if (!buf || this.wantSound !== id) return false;
    if (this.engine) this.disposeEngine();
    this.engine = new LoopEngine(this, this.manifest[id], buf, preset);
    if (startNow) this.engine.start();
    return true;
  }
  async preview(id) {
    const buf = await this.getBuffer(id);
    if (!buf) return;
    const r = this.manifest[id].regions.rev;
    if (this.previewSrc) try { this.previewSrc.stop(); } catch { /* */ }
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = 0.9;
    src.connect(g).connect(this.master);
    const st = this.manifest[id].regions.start;
    src.start(this.ctx.currentTime + 0.02, st[0], st[1]);
    const src2 = this.ctx.createBufferSource(); src2.buffer = buf; src2.connect(g);
    src2.start(this.ctx.currentTime + 0.02 + st[1] - 0.15, r[0], r[1]);
    this.previewSrc = src2;
  }
  setMuted(m) { this.muted = m; this.master.gain.setTargetAtTime(m ? 0 : 0.85 * (this.vol ?? 1), this.ctx.currentTime, 0.05); }

  loop(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.loop = true;
    s.loopStart = Math.random(); s.start(0, Math.random() * 1.5);
    return s;
  }

  buildAmbience() {
    const c = this.ctx;
    // Fahrtwind
    this.wind = c.createGain(); this.wind.gain.value = 0;
    const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 650;
    this.loop(this.noise).connect(wf).connect(this.wind).connect(this.master);
    this.windF = wf;
    // Reifenquietschen: Rauschbänder (Gummi auf Asphalt) mit leicht tonalem Anteil – nicht pfeifend
    this.squeal = c.createGain(); this.squeal.gain.value = 0;
    const sqLp = c.createBiquadFilter(); sqLp.type = 'lowpass'; sqLp.frequency.value = 3400; sqLp.Q.value = 0.4;
    this.sqBand = c.createBiquadFilter(); this.sqBand.type = 'bandpass'; this.sqBand.frequency.value = 1050; this.sqBand.Q.value = 4;
    const sqG1 = c.createGain(); sqG1.gain.value = 1.4;
    this.loop(this.noise).connect(this.sqBand).connect(sqG1).connect(sqLp);
    this.sqBand2 = c.createBiquadFilter(); this.sqBand2.type = 'bandpass'; this.sqBand2.frequency.value = 2150; this.sqBand2.Q.value = 6;
    const sqG2 = c.createGain(); sqG2.gain.value = 0.45;
    this.loop(this.noise).connect(this.sqBand2).connect(sqG2).connect(sqLp);
    // ganz leiser Ton für den typischen "Singen"-Charakter, mit langsamem Wabern
    this.sqTone = c.createOscillator(); this.sqTone.type = 'sine'; this.sqTone.frequency.value = 1000;
    const vib = c.createOscillator(); vib.frequency.value = 5.3;
    const vibG = c.createGain(); vibG.gain.value = 14;
    vib.connect(vibG).connect(this.sqTone.frequency);
    const sqTg = c.createGain(); sqTg.gain.value = 0.05;
    this.sqTone.connect(sqTg).connect(sqLp);
    this.sqTone.start(); vib.start();
    // ungleichmäßiges Rattern des Gummis (Amplitude moduliert)
    this.sqAm = c.createGain(); this.sqAm.gain.value = 0.75;
    const am = c.createOscillator(); am.frequency.value = 23; const amG = c.createGain(); amG.gain.value = 0.25;
    am.connect(amG).connect(this.sqAm.gain); am.start();
    sqLp.connect(this.sqAm).connect(this.squeal).connect(this.master);
    // Schotter/Gras-Rumpeln
    this.rumble = c.createGain(); this.rumble.gain.value = 0;
    const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 380;
    this.loop(this.brown).connect(rf).connect(this.rumble).connect(this.master);
  }

  // Motor-Synth: PeriodicWave mit Zündfrequenz-Obertönen. Grundton = Drehzahl/120
  // (ein Arbeitsspiel), die Zylinderzahl bestimmt, welche Obertöne dominieren.
  createEngine(preset) {
    if (this.engine) this.disposeEngine();
    const bank = this.banks[preset.engine.sound || preset.engine.type.toLowerCase()] || this.banks.default;
    if (bank) return this.createSampleEngine(preset, bank);
    const c = this.ctx;
    const E = preset.engine;
    const N = 64;
    const real = new Float32Array(N), imag = new Float32Array(N);
    let seed = E.cyl * 977 + E.redline;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const half = E.cyl / 2;
    for (let n = 1; n < N; n++) {
      let a;
      if (n % E.cyl === 0) a = 1 / Math.pow(n / E.cyl, 0.75);
      else if (n % half === 0) a = (0.25 + E.lump) / Math.pow(n / half, 0.9);
      else a = rnd() * (0.05 + E.lump * 0.6) / Math.pow(n / E.cyl, 0.6);
      if (n < E.cyl) a *= 0.6 + E.bass * 0.8;
      const ph = rnd() * Math.PI * 2;
      real[n] = a * Math.cos(ph); imag[n] = a * Math.sin(ph);
    }
    const wave = c.createPeriodicWave(real, imag, { disableNormalization: false });
    const out = c.createGain(); out.gain.value = 0;
    const osc1 = c.createOscillator(); osc1.setPeriodicWave(wave);
    const osc2 = c.createOscillator(); osc2.setPeriodicWave(wave);
    const g2 = c.createGain(); g2.gain.value = 0.45;
    const shaper = c.createWaveShaper();
    shaper.curve = makeDrive(2.2 + E.lump * 4);
    shaper.oversample = '2x';
    const pre = c.createGain(); pre.gain.value = 0.9;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 110 + (1 - E.bass) * 120; body.gain.value = 4 + E.bass * 5; body.Q.value = 0.9;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 28;
    osc1.connect(pre); osc2.connect(g2).connect(pre);
    // Ansaug-/Auspuffrauschen
    const nsrc = this.loop(this.noise);
    const nbp = c.createBiquadFilter(); nbp.type = 'bandpass'; nbp.Q.value = 1.4;
    const ng = c.createGain(); ng.gain.value = 0;
    nsrc.connect(nbp).connect(ng).connect(pre);
    pre.connect(shaper).connect(body).connect(lp).connect(hp).connect(out).connect(this.master);
    osc1.start(); osc2.start();
    // Turbo
    let turbo = null;
    if (E.turbo > 0) {
      const to = c.createOscillator(); to.type = 'sine'; to.frequency.value = 2000;
      const tg = c.createGain(); tg.gain.value = 0;
      to.connect(tg).connect(this.master); to.start();
      const whf = c.createBiquadFilter(); whf.type = 'bandpass'; whf.frequency.value = 3000; whf.Q.value = 3;
      const whg = c.createGain(); whg.gain.value = 0;
      this.loop(this.noise).connect(whf).connect(whg).connect(this.master);
      turbo = { to, tg, whf, whg };
    }
    this.engine = { kind: 'synth', E, osc1, osc2, lp, out, ng, nbp, nsrc, turbo, shaper };
    return this.engine;
  }
  disposeEngine() {
    const e = this.engine;
    if (!e) return;
    if (e.kind === 'loops') { e.dispose(); this.engine = null; return; }
    const t = this.ctx.currentTime;
    e.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => {
      try {
        if (e.kind === 'sample') for (const v of e.voices) { v.on.s.stop(); v.off.s.stop(); }
        else { e.osc1.stop(); e.osc2.stop(); e.nsrc.stop(); e.turbo?.to.stop(); }
      } catch { /* schon gestoppt */ }
    }, 300);
    this.engine = null;
  }

  // Jeden Frame vom Spieler-Auto füttern
  update(car, active, dt = 1 / 60) {
    const c = this.ctx, t = c.currentTime, e = this.engine;
    const k = 0.035;
    if (e && e.kind === 'loops') {
      e.update(car, active, dt);
    } else if (e && e.kind === 'sample') {
      const rpm = car.rpm, vs = e.voices;
      const loadT = car.limiterCut ? 0.2 : car.input.throttle > 0.05 || (car.gear === -1 && car.input.brake > 0.05) ? 1 : 0;
      e.load += (loadT - e.load) * 0.25;
      // Gewichte: lineare Überblendung zwischen den zwei nächsten Drehzahl-Loops
      let i = vs.findIndex((v) => v.rpm >= rpm);
      if (i < 0) i = vs.length - 1;
      const w = vs.map(() => 0);
      if (i === 0) w[0] = 1;
      else { const a = vs[i - 1], b = vs[i]; const f = Math.min(1, Math.max(0, (rpm - a.rpm) / (b.rpm - a.rpm))); w[i - 1] = Math.cos(f * Math.PI / 2); w[i] = Math.sin(f * Math.PI / 2); }
      const health = 0.75 + 0.25 * (car.engineHp / 100);
      vs.forEach((v, k2) => {
        const rate = Math.min(2.2, Math.max(0.45, rpm / v.rpm));
        v.on.s.playbackRate.setTargetAtTime(rate, t, 0.02);
        v.off.s.playbackRate.setTargetAtTime(rate, t, 0.02);
        v.on.g.gain.setTargetAtTime(w[k2] * Math.sqrt(e.load), t, 0.03);
        v.off.g.gain.setTargetAtTime(w[k2] * Math.sqrt(1 - e.load) * 0.8, t, 0.03);
      });
      e.out.gain.setTargetAtTime(active ? 0.75 * e.bank.gain * health : 0, t, 0.05);
    } else if (e) {
      const E = e.E;
      const rpm = car.rpm;
      const x = rpm / E.redline;
      const load = car.limiterCut ? 0.15 : car.input.throttle > 0.05 || (car.gear === -1 && car.input.brake > 0.05) ? 1 : 0;
      const base = rpm / 120;
      e.osc1.frequency.setTargetAtTime(base, t, 0.02);
      e.osc2.frequency.setTargetAtTime(base * 1.006, t, 0.02);
      const cutoff = load ? 500 + 5200 * x * x + 700 : 320 + 1300 * x;
      e.lp.frequency.setTargetAtTime(cutoff, t, 0.04);
      e.nbp.frequency.setTargetAtTime(base * E.cyl * 2.2, t, k);
      e.ng.gain.setTargetAtTime((0.05 + 0.25 * x) * (load ? 1 : 0.35), t, k);
      const health = car.engineHp / 100;
      const vol = active ? (0.22 + 0.2 * x + (load ? 0.16 : 0)) * (0.75 + 0.25 * health) : 0;
      e.out.gain.setTargetAtTime(vol, t, 0.04);
      if (e.turbo) {
        e.turbo.to.frequency.setTargetAtTime(1600 + 5200 * car.boost, t, 0.05);
        e.turbo.tg.gain.setTargetAtTime(active ? car.boost * car.boost * 0.035 : 0, t, 0.05);
        e.turbo.whf.frequency.setTargetAtTime(1500 + 3500 * car.boost, t, 0.05);
        e.turbo.whg.gain.setTargetAtTime(active ? car.boost * 0.07 : 0, t, 0.05);
      }
    }
    const sp = car.speedMs || 0;
    const onGrass = car.onGrass;
    const sq = active && !onGrass ? clamp((car.slipMax - 3.5) / 10, 0, 1) : 0;
    this.squeal.gain.setTargetAtTime(sq * sq * 0.2 + sq * 0.05, t, 0.07);
    this.sqBand.frequency.setTargetAtTime(900 + sq * 320, t, 0.12);
    this.sqBand2.frequency.setTargetAtTime(1900 + sq * 500, t, 0.12);
    this.sqTone.frequency.setTargetAtTime(880 + sq * 260, t, 0.15);
    this.rumble.gain.setTargetAtTime(active && onGrass ? clamp(sp / 25, 0, 1) * 0.35 : 0, t, 0.06);
    this.wind.gain.setTargetAtTime(active ? clamp(sp / 70, 0, 1) ** 2 * 0.3 : 0, t, 0.1);
    this.windF.frequency.setTargetAtTime(400 + sp * 12, t, 0.1);
  }

  burst({ dur = 0.2, freq = 1000, type = 'lowpass', q = 0.7, gain = 0.5, delay = 0, sweepTo = null, buffer = null }) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = buffer || this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5, dur + 0.05);
    return g;
  }
  tone({ freq = 100, to = null, dur = 0.3, gain = 0.4, type = 'sine', delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  pop(strength = 1) {
    this.burst({ dur: 0.06 + Math.random() * 0.05, freq: 900 + Math.random() * 900, type: 'bandpass', q: 0.8, gain: 0.45 * strength });
    this.tone({ freq: 90 + Math.random() * 40, to: 45, dur: 0.09, gain: 0.5 * strength });
  }
  blowoff(amount = 1, flutter = false) {
    const g = this.burst({ dur: 0.45, freq: 3800, sweepTo: 900, type: 'bandpass', q: 1.6, gain: 0.32 * amount });
    if (flutter) {
      const c = this.ctx, lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 17; lg.gain.value = 0.12 * amount;
      lfo.connect(lg).connect(g.gain);
      lfo.start(); lfo.stop(c.currentTime + 0.45);
    }
  }
  shift(up) {
    if (this.engine?.kind === 'loops') this.engine.shift(up);
    this.burst({ dur: 0.05, freq: 220, gain: 0.16 });
    if (!up) this.tone({ freq: 70, to: 110, dur: 0.12, gain: 0.12, type: 'sawtooth' });
  }
  crash(s = 1) {
    s = clamp(s, 0.1, 1.3);
    this.burst({ dur: 0.18 + 0.45 * s, freq: 1400 + 3000 * s, gain: 0.55 + 0.35 * s, sweepTo: 300 });
    this.tone({ freq: 70, to: 32, dur: 0.3 + 0.2 * s, gain: 0.8 * Math.min(1, s + 0.2) });
    const n = 3 + Math.round(s * 3);
    for (let i = 0; i < n; i++) this.tone({ freq: 260 + Math.random() * 900, dur: 0.35 + Math.random() * 0.9 * s, gain: 0.035 * s + 0.01, type: 'triangle', delay: Math.random() * 0.05 });
    for (let i = 0; i < 2 + s * 5; i++) this.burst({ dur: 0.04, freq: 2500 + Math.random() * 3000, type: 'bandpass', q: 2, gain: 0.12 * s, delay: 0.06 + Math.random() * 0.45 });
  }
  bump(s = 0.4) {
    this.burst({ dur: 0.08, freq: 700, gain: 0.25 * s + 0.08 });
    this.tone({ freq: 160 + Math.random() * 120, to: 90, dur: 0.12, gain: 0.25 * s + 0.08, type: 'triangle' });
  }
  glass() {
    for (let i = 0; i < 12; i++) {
      this.burst({ dur: 0.05 + Math.random() * 0.1, freq: 5000 + Math.random() * 4000, type: 'highpass', gain: 0.18, delay: Math.random() * 0.35 });
      this.tone({ freq: 3000 + Math.random() * 4000, dur: 0.15, gain: 0.03, delay: Math.random() * 0.4 });
    }
  }
  scrape() {
    if (this._scrapeT && this.ctx.currentTime - this._scrapeT < 0.08) return;
    this._scrapeT = this.ctx.currentTime;
    this.burst({ dur: 0.1, freq: 2600, type: 'bandpass', q: 3, gain: 0.08 });
  }
  ui() { this.tone({ freq: 880, to: 1320, dur: 0.08, gain: 0.08, type: 'triangle' }); }
  // Motoren der Gegner in der Nähe: echte Aufnahmen, leiser und dumpfer mit Abstand
  rivalUpdate(list, dt) {
    this.rivals = this.rivals || new Map();
    const now = this.ctx.currentTime, keep = new Set();
    for (const r of list) {
      keep.add(r.car);
      let R = this.rivals.get(r.car);
      if (!R) {
        R = { pending: true };
        this.rivals.set(r.car, R);
        this.getBuffer(r.id).then((buf) => {
          if (!buf || this.rivals.get(r.car) !== R) return;
          const g = this.ctx.createGain(); g.gain.value = 0;
          const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000;
          g.connect(lp).connect(this.master);
          R.g = g; R.lp = lp; R.eng = new LoopEngine(this, this.manifest[r.id], buf, r.car.p, g);
        }).catch(() => {});
      }
      if (R.eng) {
        const k = Math.max(0, 1 - r.d / 120);
        R.g.gain.setTargetAtTime(k * k * 0.55, now, 0.1);
        R.lp.frequency.setTargetAtTime(600 + 5800 * k, now, 0.1);
        R.eng.update(r.car, true, dt);
      }
    }
    for (const [car, R] of this.rivals) {
      if (keep.has(car)) continue;
      if (R.eng) { R.eng.dispose(); const g = R.g; setTimeout(() => g.disconnect(), 700); }
      this.rivals.delete(car);
    }
  }
  rivalsClear() { this.rivalUpdate([], 0); }
  setVolume(v) { this.vol = v; if (!this.muted) this.master.gain.setTargetAtTime(0.85 * v, this.ctx.currentTime, 0.05); }
  // Rennen + Power-ups (synthetisch)
  sfx(name, k = 1) {
    const t = (o) => this.tone(o), b = (o) => this.burst(o);
    switch (name) {
      case 'beep': t({ freq: 440, dur: 0.34, gain: 0.26, type: 'triangle' }); t({ freq: 880, dur: 0.3, gain: 0.06, type: 'sine' }); t({ freq: 220, dur: 0.3, gain: 0.08, type: 'sine' }); break;
      case 'go': t({ freq: 880, dur: 0.8, gain: 0.26, type: 'triangle' }); t({ freq: 440, dur: 0.8, gain: 0.12, type: 'triangle' }); t({ freq: 1760, dur: 0.6, gain: 0.04, type: 'sine' }); break;
      case 'pickup': [660, 990, 1320].forEach((f, i) => t({ freq: f, dur: 0.12, gain: 0.09, type: 'triangle', delay: i * 0.05 })); b({ dur: 0.25, freq: 6000, type: 'highpass', gain: 0.12 }); break;
      case 'tick': t({ freq: 1100 + Math.random() * 300, dur: 0.035, gain: 0.05, type: 'triangle' }); break;
      case 'got': t({ freq: 523, to: 1046, dur: 0.18, gain: 0.12, type: 'triangle' }); t({ freq: 784, dur: 0.25, gain: 0.07, type: 'sine', delay: 0.1 }); break;
      case 'nitro': b({ dur: 1.5, freq: 700, sweepTo: 2600, type: 'bandpass', q: 0.8, gain: 0.4 }); b({ dur: 1.2, freq: 260, type: 'lowpass', gain: 0.35 }); t({ freq: 70, to: 120, dur: 1.2, gain: 0.22, type: 'triangle' }); break;
      case 'jump': t({ freq: 180, to: 720, dur: 0.35, gain: 0.25, type: 'triangle' }); b({ dur: 0.2, freq: 1500, gain: 0.25 }); break;
      case 'drop': t({ freq: 220, to: 110, dur: 0.18, gain: 0.25, type: 'triangle' }); b({ dur: 0.12, freq: 900, gain: 0.2 }); break;
      case 'oil': b({ dur: 0.5, freq: 500, type: 'lowpass', gain: 0.35 }); t({ freq: 300, to: 120, dur: 0.6, gain: 0.12, type: 'sine' }); break;
      case 'rocket': b({ dur: 1.2, freq: 1200, sweepTo: 400, type: 'bandpass', q: 1.2, gain: 0.4 }); t({ freq: 900, to: 300, dur: 1.0, gain: 0.05, type: 'sawtooth' }); break;
      case 'boom': {
        const s = Math.max(0.15, Math.min(1.4, k));
        b({ dur: 0.9 * s + 0.3, freq: 2400, sweepTo: 120, gain: 0.8 * s });
        t({ freq: 58, to: 24, dur: 0.9 * s + 0.2, gain: 0.95 * s, type: 'sine' });
        t({ freq: 110, to: 40, dur: 0.4, gain: 0.4 * s, type: 'triangle' });
        for (let i = 0; i < 6; i++) b({ dur: 0.05, freq: 3000 + Math.random() * 3000, type: 'bandpass', q: 2, gain: 0.12 * s, delay: 0.1 + Math.random() * 0.6 });
        break;
      }
      case 'shock': t({ freq: 140, to: 40, dur: 0.6, gain: 0.7, type: 'sine' }); b({ dur: 0.6, freq: 300, sweepTo: 5000, type: 'bandpass', q: 0.7, gain: 0.35 }); break;
      case 'armor': [392, 523, 659, 784].forEach((f, i) => t({ freq: f, dur: 0.25, gain: 0.09, type: 'triangle', delay: i * 0.06 })); t({ freq: 1500, dur: 0.6, gain: 0.05, type: 'sine', delay: 0.25 }); break;
      case 'repair': for (let i = 0; i < 6; i++) b({ dur: 0.03, freq: 3500, type: 'bandpass', q: 4, gain: 0.18, delay: i * 0.07 }); [523, 659, 784, 1046].forEach((f, i) => t({ freq: f, dur: 0.18, gain: 0.08, type: 'triangle', delay: 0.45 + i * 0.07 })); break;
      case 'miniturbo': b({ dur: 0.55 + k * 0.12, freq: 500, sweepTo: 2400, type: 'bandpass', q: 0.9, gain: 0.22 + k * 0.06 }); b({ dur: 0.3, freq: 180, type: 'lowpass', gain: 0.3 }); break;
      case 'charge': t({ freq: [0, 660, 880, 1175][k] || 880, dur: 0.12, gain: 0.06, type: 'triangle' }); break;
      case 'lap': [784, 988].forEach((f, i) => t({ freq: f, dur: 0.16, gain: 0.1, type: 'triangle', delay: i * 0.12 })); break;
      case 'final': [659, 784, 988, 1318].forEach((f, i) => t({ freq: f, dur: 0.2, gain: 0.13, type: 'triangle', delay: i * 0.1 })); break;
      case 'finish': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => t({ freq: f, dur: i === 5 ? 0.8 : 0.17, gain: 0.14, type: 'triangle', delay: i * 0.13 })); break;
      case 'wrong': t({ freq: 330, dur: 0.2, gain: 0.15, type: 'triangle' }); t({ freq: 247, dur: 0.28, gain: 0.15, type: 'triangle', delay: 0.2 }); break;
      case 'error': t({ freq: 220, to: 180, dur: 0.25, gain: 0.18, type: 'triangle' }); break;
    }
  }
}

function makeDrive(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}


// ---------------------------------------------------------------------------
// Loop-Motor-Engine: wie professionelle Renn-Sound-Engines. Pro Drehzahlpunkt ein echter,
// auf konstante Tonhöhe geglätteter Loop aus den Aufnahmen (unter Last + im Schub).
// Alle Loops laufen durchgehend; Lautstärke und Tonhöhe werden zwischen den zwei
// passenden Loops überblendet. Leerlauf ist ein langer Original-Loop (Blubbern bleibt).
// ---------------------------------------------------------------------------
const sstep = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export class LoopEngine {
  constructor(audio, bank, buffer, preset, dest = null) {
    this.quiet = !!dest;
    this.a = audio; this.ctx = audio.ctx; this.bank = bank; this.buf = buffer; this.E = preset.engine;
    this.kind = 'loops';
    const c = this.ctx;
    this.out = c.createGain(); this.out.gain.value = 0;
    this.gain = bank.gain ?? 1;          // Lautheit der Aufnahme angeglichen (sonst ist z. B. der Turbo viel lauter)
    this.liftGain = bank.liftGain ?? 0.55;
    // Klang: etwas mehr Bass (Blubbern), harte Mitten zurück, Höhen je nach Aufnahme gezähmt
    const low = c.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 160; low.gain.value = 4.5;
    const mid = c.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 3200; mid.Q.value = 0.8; mid.gain.value = -3;
    const shelf = c.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 2800; shelf.gain.value = bank.shelf ?? -1.5;
    this.tone = c.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 9000; this.tone.Q.value = 0.5;
    this.out.connect(low).connect(mid).connect(shelf).connect(this.tone).connect(dest || audio.master);
    this.voices = [];
    const mk = (L, x, kind) => {
      const src = c.createBufferSource();
      src.buffer = buffer; src.loop = true; src.loopStart = L.s; src.loopEnd = L.s + L.d;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(g).connect(this.out);
      src.start(0, L.s + Math.random() * L.d * 0.9);
      const v = { x, src, g, kind, w: 0 };
      this.voices.push(v);
      return v;
    };
    this.on = bank.on.map((L) => mk(L, L.x, 'on'));
    this.off = bank.off.map((L) => mk(L, L.x, 'off'));
    this.idle = mk(bank.idle, this.E.idle / this.E.redline, 'idle');
    this.lim = mk(bank.limiter, 1, 'lim');
    this.load = 0; this.prevThrottle = 0; this.duckOff = 0; this.duckIdle = 0;
    this.heldT = 0; this.lastLift = -9; this.cut = 0;
  }
  // Hochschalten unter Last: Zündung kurz unterbrochen ("bap") wie beim echten Gangwechsel
  shift(up) { if (up && this.load > 0.5) this.cut = 0.085; }
  oneShot(region, gain = 1, rate = 1, when = null, viaEngine = false) {
    const r = this.bank.regions[region];
    if (!r) return 0;
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.buf; src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = gain;
    // über die Motor-Filter (gleiche Klangfarbe, folgt der Motorlautstärke)
    src.connect(g).connect(viaEngine ? this.out : this.a.master);
    src.start((when ?? c.currentTime) + 0.01, r[0], r[1]);
    return r[1] / rate;
  }
  start(when = null) { this.duckIdle = this.oneShot('start', 0.85 * this.gain, 1, when) * 0.85; }
  // Gewichte für eine Loop-Gruppe: die zwei Loops links/rechts von x, gleichleistungs-überblendet
  spread(list, x, total, out) {
    if (!list.length) return;
    let i = list.findIndex((v) => v.x >= x);
    if (i === -1) { out.set(list[list.length - 1], total); return; }
    if (i === 0) { out.set(list[0], total); return; }
    const a = list[i - 1], b = list[i], f = (x - a.x) / (b.x - a.x);
    out.set(a, total * Math.cos(f * Math.PI / 2));
    out.set(b, total * Math.sin(f * Math.PI / 2));
  }
  update(car, active, dt, tNow = null) {
    const c = this.ctx, now = tNow ?? c.currentTime;
    const E = this.E;
    const x = Math.max(0.05, car.rpm / E.redline);
    const xIdle = E.idle / E.redline;
    const thr = car.gear === -1 ? car.input.brake : car.input.throttle;
    this.cut = Math.max(0, this.cut - dt);
    let loadT = car.limiterCut ? 0.9 : thr > 0.05 ? Math.min(1, 0.55 + thr * 0.45) : 0;
    if (this.cut > 0) loadT = 0.12;
    this.load += (loadT - this.load) * Math.min(1, dt * (loadT > this.load ? 22 : this.cut > 0 ? 40 : 12));
    this.heldT = thr > 0.5 ? this.heldT + dt : 0;
    // Gas weg: Abblasen/Nachbrennen nur nach echtem Vollgas-Zug und nicht im Sekundentakt
    if (active && !this.quiet && this.prevThrottle > 0.5 && thr < 0.1 && x > 0.6 && this.heldTPrev > 0.45 && now - this.lastLift > 1.6) {
      const d = this.oneShot('lift', this.liftGain * 0.9, 0.96 + Math.random() * 0.08, now, true);
      this.lastLift = now;
      this.duckOff = Math.max(this.duckOff, d * 0.5);
    }
    this.heldTPrev = this.heldT;
    this.prevThrottle = thr;
    this.duckOff = Math.max(0, this.duckOff - dt);
    this.duckIdle = Math.max(0, this.duckIdle - dt);
    const health = 0.82 + 0.18 * (car.engineHp / 100);
    this.out.gain.setTargetAtTime(active ? 1.1 * health * this.gain : 0, now, 0.08);
    // weniger Last = dumpfer (Schub klingt gedeckter, Vollgas offen)
    this.tone.frequency.setTargetAtTime(5200 + 4800 * this.load, now, 0.06);
    const target = new Map();
    const wIdle = 1 - sstep(x, xIdle + 0.03, xIdle + 0.15);
    const base = 1 - wIdle;
    const atLim = x > 0.975 && thr > 0.5;
    const onW = base * Math.sqrt(this.load) * (atLim ? 0.55 : 1);
    const offW = base * Math.sqrt(1 - this.load) * (this.duckOff > 0 ? 0.35 : 1) * 1.7;
    this.spread(this.on, x, onW, target);
    this.spread(this.off, x, offW, target);
    target.set(this.idle, wIdle * 2.1 * (this.duckIdle > 0 ? 0.2 : 1));
    target.set(this.lim, atLim ? base * this.load * 0.8 : 0);
    for (const v of this.voices) {
      const w = active ? target.get(v) || 0 : 0;
      if (Math.abs(w - v.w) > 0.002) { v.g.gain.setTargetAtTime(w, now, 0.035); v.w = w; }
      let rate = 1;
      if (v.kind === 'on' || v.kind === 'off') rate = Math.min(1.6, Math.max(0.5, x / v.x));
      else if (v.kind === 'idle') rate = Math.min(1.3, Math.max(0.9, x / v.x)); // nie Micky-Maus-Leerlauf
      if (w > 0.001 || v.lastRate === undefined) { v.src.playbackRate.setTargetAtTime(rate, now, 0.02); v.lastRate = rate; }
    }
  }
  dispose() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => { for (const v of this.voices) { try { v.src.stop(); } catch { /* */ } } this.out.disconnect(); }, 400);
  }
}
