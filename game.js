'use strict';
/*
 * REVOADA — jogo original de tiro ao pato ao entardecer.
 * Canvas em pixel art com resolução lógica dinâmica (preenche qualquer tela),
 * sons sintetizados via Web Audio.
 */
(() => {
  // Dimensões lógicas: recalculadas em layout() conforme a proporção da tela.
  // Altura mínima 200 (telas largas) ou largura mínima 320 (telas altas / retrato).
  let W = 320, H = 200, HORIZON = 120, BANK = 162;
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const COARSE = window.matchMedia ? matchMedia('(pointer: coarse)').matches : false;
  const BTN = COARSE ? 17 : 13;   // botões maiores no toque
  const TOP_Y = BTN + 11;         // patos não voam por baixo dos botões
  let COMPACT = false;            // HUD em duas linhas para telas estreitas
  let SPEED_K = 1;                // campo mais estreito => patos um pouco mais lentos

  // ---------------------------------------------------------------- utils
  const rand = (a, b) => a + Math.random() * (b - a);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const seeded = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } },
  };

  // ---------------------------------------------------------------- áudio
  const Sfx = (() => {
    let ac = null, master = null, noiseBuf = null;
    let muted = store.get('revoada.mute', false);
    const SEMI = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 };
    const nf = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return 440 * Math.pow(2, (SEMI[m[1]] + (m[2] - 4) * 12) / 12); };

    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.45; master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const ready = () => ac && !muted;

    function tone(f, t, dur, type = 'square', vol = 0.15, f2) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    }
    function noise(t, dur, vol, f1, f2, type = 'lowpass') {
      const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noiseBuf; fl.type = type; fl.frequency.setValueAtTime(f1, t);
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
    }
    function seq(notes, type, vol) {
      let t = ac.currentTime + 0.03;
      for (const [n, d] of notes) { if (n !== '-') tone(nf(n), t, d * 0.92, type, vol); t += d; }
    }

    const JINGLES = {
      title: {
        lead: [['E5', .14], ['G5', .14], ['A5', .14], ['B5', .28], ['A5', .14], ['G5', .14], ['E5', .14], ['D5', .14], ['E5', .42]],
        bass: [['E3', .42], ['C3', .42], ['D3', .42], ['E3', .42]],
      },
      round: {
        lead: [['C5', .1], ['E5', .1], ['G5', .1], ['C6', .2], ['G5', .1], ['C6', .4]],
        bass: [['C3', .3], ['G3', .3], ['C3', .4]],
      },
      clear: {
        lead: [['G4', .1], ['C5', .1], ['E5', .1], ['D5', .1], ['G5', .35]],
        bass: [['C3', .2], ['G3', .2], ['C3', .35]],
      },
      perfect: {
        lead: [['C5', .08], ['E5', .08], ['G5', .08], ['C6', .08], ['E6', .08], ['G6', .16], ['E6', .08], ['G6', .45]],
        bass: [['C3', .32], ['G3', .32], ['C4', .45]],
      },
      over: {
        lead: [['E4', .22], ['D#4', .22], ['D4', .22], ['C#4', .6]],
        bass: [['A2', .66], ['A2', .6]],
      },
    };

    return {
      init,
      get muted() { return muted; },
      toggleMute() { muted = !muted; store.set('revoada.mute', muted); return muted; },
      shot() {
        if (!ready()) return; const t = ac.currentTime;
        noise(t, 0.35, 0.7, 3200, 180);
        tone(150, t, 0.16, 'sine', 0.5, 45);
      },
      quack(p = 1) {
        if (!ready()) return; const t = ac.currentTime;
        for (const [dt, f] of [[0, 560], [0.13, 520]]) {
          const o = ac.createOscillator(), fl = ac.createBiquadFilter(), g = ac.createGain();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(f * p, t + dt);
          o.frequency.exponentialRampToValueAtTime(f * p * 0.7, t + dt + 0.1);
          fl.type = 'bandpass'; fl.frequency.value = 1200 * p; fl.Q.value = 3;
          g.gain.setValueAtTime(0.0001, t + dt);
          g.gain.exponentialRampToValueAtTime(0.22, t + dt + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.11);
          o.connect(fl); fl.connect(g); g.connect(master);
          o.start(t + dt); o.stop(t + dt + 0.15);
        }
      },
      hit() { if (!ready()) return; const t = ac.currentTime; tone(880, t, 0.06, 'square', 0.1); tone(1320, t + 0.05, 0.08, 'square', 0.08); },
      fall() { if (!ready()) return; tone(1400, ac.currentTime, 0.9, 'triangle', 0.12, 180); },
      thud() { if (!ready()) return; noise(ac.currentTime, 0.18, 0.5, 700, 80); },
      escape() {
        if (!ready()) return; const t = ac.currentTime;
        tone(660, t, 0.1, 'square', 0.08); tone(520, t + 0.1, 0.1, 'square', 0.08); tone(390, t + 0.2, 0.25, 'square', 0.08);
        noise(t, 0.4, 0.15, 900, 2400, 'bandpass');
      },
      jingle(name) {
        if (!ready()) return; const j = JINGLES[name];
        seq(j.lead, 'square', 0.09); seq(j.bass, 'triangle', 0.18);
      },
    };
  })();

  // ---------------------------------------------------------------- sprites
  const SW = 16, SH = 14;
  const BASE = [
    '................',
    '................',
    '................',
    '...........kkk..',
    '..........khhhk.',
    '..........khehk.',
    'kk..kkkkkkkhhhyy',
    'kbkkbbbbbbbbhkyy',
    '.kbbbbbbbbbbbk..',
    '..kbbbbbbbbbbk..',
    '...kkbbbbbbkk...',
    '.....kkkkkk.....',
    '................',
    '................',
  ];
  const WINGS = {
    up: { x: 3, y: 0, r: ['......kk', '.....kwk', '....kwwk', '...kwwk.', '..kwwwk.', '.kwwwk..', '.kwwk...'] },
    mid: { x: 2, y: 6, r: ['kkkkkkkk', 'kwwwwwwk', '.kkkkkk.'] },
    down: { x: 4, y: 8, r: ['.kwwwk', '.kwwwk', '..kwwk', '..kwwk', '...kk.'] },
  };
  function grid(wing, eye) {
    const g = BASE.map(r => r.padEnd(SW, '.').slice(0, SW).split(''));
    const w = WINGS[wing];
    w.r.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch !== '.' && g[w.y + j] && w.x + i < SW) g[w.y + j][w.x + i] = ch;
    }));
    if (eye) g.forEach(row => row.forEach((c, i) => { if (c === 'e') row[i] = eye; }));
    return g;
  }
  function paint(g, pal) {
    const c = mk(SW, SH), x = c.getContext('2d');
    g.forEach((row, y) => row.forEach((ch, i) => {
      if (ch !== '.' && pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i, y, 1, 1); }
    }));
    return c;
  }
  function flip(src, h, v) {
    const c = mk(src.width, src.height), x = c.getContext('2d');
    x.translate(h ? src.width : 0, v ? src.height : 0); x.scale(h ? -1 : 1, v ? -1 : 1); x.drawImage(src, 0, 0);
    return c;
  }

  const OUT = '#140c1c';
  const TYPES = [
    { pts: 100, speed: 62, quack: 1.0, pal: { k: OUT, b: '#6b4a2f', w: '#a07a4d', h: '#2f8a52', e: '#f4f0e8', y: '#f2a93b', x: '#ff4040' } },
    { pts: 250, speed: 82, quack: 1.15, pal: { k: OUT, b: '#3f4f86', w: '#8fa3d8', h: '#e9e6f2', e: OUT, y: '#f2a93b', x: '#ff4040' } },
    { pts: 500, speed: 108, quack: 1.3, pal: { k: OUT, b: '#c98a1f', w: '#f4d675', h: '#b8322a', e: '#f4f0e8', y: '#f7e0a0', x: '#40ff80' } },
  ];
  const SPR = TYPES.map(T => {
    const fly = ['up', 'mid', 'down', 'mid'].map(w => paint(grid(w), T.pal));
    const hit = paint(grid('up', 'x'), T.pal);
    const fall = paint(grid('mid', 'x'), T.pal);
    return {
      fly, flyL: fly.map(f => flip(f, true, false)),
      hit, hitL: flip(hit, true, false),
      fallA: flip(fall, false, true), fallB: flip(fall, true, true),
    };
  });

  // ---------------------------------------------------------------- cenário
  let BG = null, FG = null, SUN_X = 236;

  function buildBG() {
    const c = mk(W, H), g = c.getContext('2d');
    const img = g.createImageData(W, H), d = img.data;
    const sky = ['#1a0f33', '#2b1850', '#47216a', '#6f2b74', '#a33a72', '#d65a64', '#f08452', '#f7ae5c'];
    const skyRGB = sky.map(hex);
    const lake = ['#5a3474', '#3a265e', '#281c4a', '#1b1338', '#120c28'].map(hex);
    const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const put = (x, y, col) => { const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; };
    const band = (pal, y, t) => {
      const i = Math.floor(t), f = t - i;
      for (let x = 0; x < W; x++) {
        const th = (B[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        put(x, y, f > th ? pal[Math.min(i + 1, pal.length - 1)] : pal[i]);
      }
    };
    for (let y = 0; y < HORIZON; y++) band(skyRGB, y, y / (HORIZON - 1) * (sky.length - 1));
    for (let y = HORIZON; y < H; y++) band(lake, y, Math.min(lake.length - 1, (y - HORIZON) / (BANK - HORIZON) * (lake.length - 1)));
    g.putImageData(img, 0, 0);

    const rnd = seeded(7);
    const starH = Math.max(42, HORIZON * 0.38);
    const nStars = Math.round(W * starH / 300);
    for (let i = 0; i < nStars; i++) {
      g.fillStyle = rnd() < 0.3 ? '#ffffff' : '#b9a6e6';
      g.fillRect(rnd() * W | 0, rnd() * starH | 0, 1, 1);
    }
    // nuvens: cor segue a faixa do céu onde estão
    const nClouds = Math.max(5, Math.round(W * HORIZON / 6500));
    for (let i = 0; i < nClouds; i++) {
      const y = Math.round(HORIZON * 0.3 + rnd() * (HORIZON * 0.7 - 34));
      const w = 34 + (rnd() * 60 | 0), x = Math.round(rnd() * (W + 40) - 20);
      const idx = Math.min(sky.length - 1, Math.round(y / HORIZON * (sky.length - 1)) + 1);
      g.fillStyle = sky[idx];
      g.fillRect(x + 6, y, w - 12, 1); g.fillRect(x, y + 1, w, 2); g.fillRect(x + 10, y + 3, w - 24, 1);
    }
    // sol listrado
    SUN_X = Math.round(W * 0.74);
    const sx = SUN_X, sy = HORIZON - 16, sr = 24;
    for (let y = sy - sr; y <= sy + sr; y++) {
      if (y > sy - 6 && ((y - sy + 6) % 5) < Math.min(3, 1 + (y - sy + 6) / 9)) continue;
      for (let x = sx - sr; x <= sx + sr; x++) {
        const dx = x - sx, dy = y - sy;
        if (dx * dx + dy * dy > sr * sr) continue;
        const rel = (y - (sy - sr)) / (2 * sr);
        g.fillStyle = rel < 0.3 ? '#fff0a8' : rel < 0.55 ? '#ffd27a' : '#ffa25a';
        g.fillRect(x, y, 1, 1);
      }
    }
    // montanhas
    const far = x => Math.round(HORIZON - 30 + 9 * Math.sin(x * 0.028 + 1.3) + 6 * Math.sin(x * 0.067 + 0.4) + 3 * Math.sin(x * 0.19));
    const near = x => Math.round(HORIZON - 14 + 5 * Math.sin(x * 0.041 + 2.2) + 3 * Math.sin(x * 0.13 + 1));
    for (let x = 0; x < W; x++) { const h = far(x); g.fillStyle = '#4e2560'; g.fillRect(x, h, 1, HORIZON - h); g.fillStyle = '#6a3470'; g.fillRect(x, h, 1, 1); }
    for (let x = 0; x < W; x++) { const h = near(x); g.fillStyle = '#2a173f'; g.fillRect(x, h, 1, HORIZON - h); }
    g.fillStyle = '#1c0f2e';
    const nPines = Math.round(W / 8);
    for (let i = 0; i < nPines; i++) {
      const x = rnd() * W | 0, base = near(x) + 2, ht = 6 + (rnd() * 9 | 0);
      for (let j = 0; j < ht; j++) { const hw = Math.floor(j * 0.4); g.fillRect(x - hw, base - ht + j, hw * 2 + 1, 1); }
    }
    g.fillStyle = '#7a4a86'; g.fillRect(0, HORIZON, W, 1);
    // vitórias-régias
    const nPads = Math.round(W / 36);
    for (let i = 0; i < nPads; i++) {
      const x = rnd() * W | 0, y = HORIZON + 4 + (rnd() * 16 | 0);
      g.fillStyle = '#24463a'; g.fillRect(x, y, 6, 2); g.fillRect(x + 1, y - 1, 4, 1);
      g.fillStyle = '#3a6a4a'; g.fillRect(x + 1, y - 1, 2, 1);
      g.fillStyle = '#120c28'; g.fillRect(x + 3, y, 1, 1);
    }
    return c;
  }

  function buildFG() {
    const c = mk(W, H), g = c.getContext('2d'), rnd = seeded(42);
    const reed = (x, base, ht, lean, col, head) => {
      let tx = x;
      g.fillStyle = col;
      for (let j = 0; j < ht; j++) { tx = Math.round(x + lean * Math.pow(j / ht, 2) * 6); g.fillRect(tx, base - j, 1, 1); }
      if (rnd() < 0.5) { // folha
        const dir = rnd() < 0.5 ? -1 : 1, len = ht * 0.6 | 0;
        for (let j = 0; j < len; j++) g.fillRect(Math.round(x + dir * j * j * 0.012 * ht / 10 + dir * j * 0.15), base - j, 1, 1);
      }
      if (head) {
        const top = base - ht;
        g.fillStyle = '#5b3320'; g.fillRect(tx - 1, top + 2, 3, 7);
        g.fillStyle = '#8a5230'; g.fillRect(tx - 1, top + 3, 1, 4);
        g.fillStyle = col; g.fillRect(tx, top - 1, 1, 3);
      }
    };
    const k = W / 320;
    for (let i = 0; i < 60 * k; i++) reed(rnd() * W | 0, BANK - 10 + (rnd() * 6 | 0), 16 + (rnd() * 22 | 0), rnd() * 2 - 1, rnd() < 0.5 ? '#1d3322' : '#183020', rnd() < 0.35);
    // faixa densa de capim
    for (let x = 0; x < W; x++) {
      const top = Math.round(BANK - 14 + 2.5 * Math.sin(x * 0.7) + 2 * Math.sin(x * 0.23) + rnd() * 3);
      g.fillStyle = '#1a2e1e'; g.fillRect(x, top, 1, BANK + 4 - top);
      g.fillStyle = '#2f5a34'; g.fillRect(x, top, 1, 1);
    }
    // margem de lama
    for (let x = 0; x < W; x++) {
      const top = Math.round(BANK + Math.sin(x * 0.15) * 1.5 + rnd());
      g.fillStyle = '#2a1a14'; g.fillRect(x, top, 1, H - top);
      g.fillStyle = '#3b2619'; g.fillRect(x, top, 1, 1);
    }
    for (let i = 0; i < 160 * k; i++) { g.fillStyle = rnd() < 0.5 ? '#3b2619' : '#1d120e'; g.fillRect(rnd() * W | 0, BANK + 2 + (rnd() * (H - BANK) | 0), 1, 1); }
    for (let i = 0; i < 26 * k; i++) reed(rnd() * W | 0, BANK + (rnd() * 2 | 0), 20 + (rnd() * 24 | 0), rnd() * 2 - 1, rnd() < 0.5 ? '#2c4f2f' : '#3a6a3a', rnd() < 0.45);
    return c;
  }

  // ---------------------------------------------------------------- patos
  const randomAngle = () => { const a = rand(0.35, 1.15); return [a, Math.PI - a, -a, Math.PI + a][Math.random() * 4 | 0]; };

  class Bird {
    constructor(type, idx, round, deco = false) {
      this.type = type; this.T = TYPES[type]; this.idx = idx; this.deco = deco;
      this.speed = this.T.speed * Math.min(2, 1 + 0.07 * (round - 1)) * SPEED_K;
      this.x = rand(60, W - 60);
      this.y = deco ? rand(TOP_Y + 10, HORIZON - 20) : BANK - 2;
      const a = deco ? randomAngle() : rand(-Math.PI * 0.78, -Math.PI * 0.22);
      this.vx = Math.cos(a) * this.speed; this.vy = Math.sin(a) * this.speed;
      this.state = 'fly'; this.rising = !deco; this.anim = rand(0, 4);
      this.turnT = rand(0.7, 1.4); this.t = 0; this.quackT = rand(0.3, 1.5); this.dead = false;
    }
    update(dt) {
      this.t += dt;
      switch (this.state) {
        case 'fly':
          this.x += this.vx * dt; this.y += this.vy * dt; this.anim += dt * (8 + this.speed / 20);
          if (this.rising) { if (this.y < HORIZON - 12) this.rising = false; }
          else {
            if (this.y > HORIZON - 8) { this.y = HORIZON - 8; this.vy = -Math.abs(this.vy); }
            if (this.y < TOP_Y) { this.y = TOP_Y; this.vy = Math.abs(this.vy); }
            if ((this.turnT -= dt) <= 0) {
              this.turnT = rand(0.5, 1.5);
              const a = randomAngle(); this.vx = Math.cos(a) * this.speed; this.vy = Math.sin(a) * this.speed;
            }
          }
          if (this.x < 10) { this.x = 10; this.vx = Math.abs(this.vx); }
          if (this.x > W - 10) { this.x = W - 10; this.vx = -Math.abs(this.vx); }
          if (!this.deco && (this.quackT -= dt) <= 0) { this.quackT = rand(1.2, 2.6); Sfx.quack(this.T.quack); }
          break;
        case 'hit':
          if (this.t >= 0.45) { this.state = 'fall'; this.t = 0; this.vy = 10; Sfx.fall(); }
          break;
        case 'fall':
        { // queda proporcional à altura da tela (céu alto no celular em pé)
          const vmax = Math.max(150, BANK * 0.9);
          this.vy = Math.min(vmax, this.vy + vmax * 1.75 * dt); this.y += this.vy * dt;
        }
          if (this.y > BANK + 10) { this.dead = true; Sfx.thud(); }
          break;
        case 'escape':
          this.anim += dt * 16; this.x += this.vx * dt; this.y += this.vy * dt;
          if (this.y < -20) this.dead = true;
          break;
      }
    }
    hit() { this.state = 'hit'; this.t = 0; }
    escape() { this.state = 'escape'; this.vy = -Math.max(this.speed * 1.3 + 40, HORIZON * 1.1); this.vx = Math.sign(this.vx || 1) * this.speed * 0.35; }
    draw(g) {
      const S = SPR[this.type], left = this.vx < 0;
      let img;
      if (this.state === 'fly' || this.state === 'escape') img = (left ? S.flyL : S.fly)[Math.floor(this.anim) % 4];
      else if (this.state === 'hit') img = left ? S.hitL : S.hit;
      else img = Math.floor(this.t * 8) % 2 ? S.fallA : S.fallB;
      g.drawImage(img, Math.round(this.x - SW / 2), Math.round(this.y - SH / 2));
    }
  }

  // ---------------------------------------------------------------- estado
  const G = {
    state: 'title', mode: 1, round: 1, score: 0, hi: store.get('revoada.hi', 0), newHi: false,
    results: [], next: 0, birds: [], shots: 3, waveT: 0, timer: 0, escaped: false, noShotT: -1,
    msg: null, escFlash: 0, shake: 0, muzzle: null, parts: [], pops: [], paused: false,
    mouse: { x: W / 2, y: 70, on: false }, hover: -1, deco: [], time: 0, pass: false,
  };
  const required = r => Math.min(10, 6 + Math.floor((r - 1) / 3));
  const waveLimit = r => Math.max(4, 7 - 0.25 * (r - 1));
  const playing = () => G.state !== 'title' && G.state !== 'gameOver';
  function pickType(r) {
    const x = Math.random(), pc = Math.min(0.25, 0.08 + 0.02 * (r - 1)), pb = Math.min(0.4, 0.27 + 0.015 * (r - 1));
    return x < pc ? 2 : x < pc + pb ? 1 : 0;
  }

  // ---------------------------------------------------------------- tela cheia
  const root = document.documentElement;
  const canFS = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function toggleFS() {
    try {
      if (!isFS()) {
        const req = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen?.();
        req?.catch?.(() => {});
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      }
    } catch { /* navegador sem suporte */ }
  }

  function toTitle() {
    G.state = 'title'; G.msg = null; G.birds = []; G.newHi = false; G.paused = false;
    G.deco = [new Bird(0, 0, 1, true), new Bird(1, 0, 1, true)];
    Sfx.jingle('title');
  }
  function newGame(mode) {
    Sfx.init(); G.mode = mode; G.round = 1; G.score = 0; G.newHi = false; G.deco = [];
    if (COARSE && canFS && !isFS()) toggleFS(); // celular: entra em tela cheia ao começar
    startRound();
  }
  function startRound() {
    G.results = new Array(10).fill(null); G.next = 0; G.birds = [];
    G.state = 'roundIntro'; G.timer = 2.2;
    G.msg = { lines: ['RODADA ' + G.round, 'META ' + required(G.round) + '/10'] };
    Sfx.jingle('round');
  }
  function startWave() {
    const n = Math.min(G.mode, 10 - G.next);
    G.birds = [];
    for (let i = 0; i < n; i++) G.birds.push(new Bird(pickType(G.round), G.next++, G.round));
    G.shots = 3; G.waveT = waveLimit(G.round); G.escaped = false; G.noShotT = -1; G.msg = null;
    G.state = 'wave';
  }
  function triggerEscape() {
    G.escaped = true;
    let any = false;
    for (const b of G.birds) if (b.state === 'fly') { b.escape(); G.results[b.idx] = 'miss'; any = true; }
    if (any) { G.escFlash = 1.1; G.msg = { lines: ['FUGIU!'], t: 1.4 }; Sfx.escape(); }
  }
  function saveHi() {
    if (G.score > G.hi) { G.hi = G.score; G.newHi = true; store.set('revoada.hi', G.hi); }
  }
  function tally() {
    const hits = G.results.filter(r => r === 'hit').length;
    G.state = 'tally'; G.timer = 3.0;
    G.pass = hits >= required(G.round);
    if (G.pass) {
      const lines = ['ACERTOS ' + hits + '/10'];
      if (hits === 10) { G.score += 5000; lines.push('PERFEITO!', 'BONUS +5000'); Sfx.jingle('perfect'); }
      else { lines.push('RODADA CONCLUIDA'); Sfx.jingle('clear'); }
      G.msg = { lines };
    } else {
      G.msg = { lines: ['ACERTOS ' + hits + '/10', 'META NAO ATINGIDA'] };
      Sfx.jingle('over'); saveHi();
    }
  }
  function feathers(b) {
    for (let i = 0; i < 9; i++) G.parts.push({
      x: b.x + rand(-4, 4), y: b.y + rand(-3, 3), vx: rand(-32, 32), vy: rand(-40, 0),
      t: rand(0.8, 1.4), c: Math.random() < 0.5 ? b.T.pal.w : b.T.pal.b,
    });
  }

  // ---------------------------------------------------------------- layout de UI
  const titleY = () => Math.max(22, Math.round(HORIZON / 2 - 60));
  const menuItems = () => { const ty = titleY(); return [{ y: ty + 60, label: '1 PATO' }, { y: ty + 76, label: '2 PATOS' }]; };
  const menuAt = (x, y) => menuItems().findIndex(m => x >= W / 2 - 70 && x <= W / 2 + 70 && y >= m.y - 4 && y <= m.y + 12);
  const msgY = () => Math.round(HORIZON / 2 - 10);

  // Botões no canto superior direito: tela cheia, som, pausa.
  function buttons() {
    const list = [], step = BTN + 3; let x = W - BTN - 4;
    if (canFS) { list.push({ id: 'fs', x, y: 4 }); x -= step; }
    list.push({ id: 'snd', x, y: 4 }); x -= step;
    if (playing()) list.push({ id: 'pause', x, y: 4 });
    return list;
  }
  function buttonAt(x, y, touch) {
    const pad = touch ? 6 : 1;
    return buttons().find(b => x >= b.x - pad && x <= b.x + BTN + pad && y >= b.y - pad && y <= b.y + BTN + pad);
  }

  function shoot(x, y, touch = false) {
    Sfx.init();
    const btn = buttonAt(x, y, touch);
    if (btn) {
      if (btn.id === 'fs') toggleFS();
      else if (btn.id === 'snd') Sfx.toggleMute();
      else if (btn.id === 'pause') G.paused = !G.paused;
      return;
    }
    if (G.paused) { G.paused = false; return; }
    if (G.state === 'title') { const m = menuAt(x, y); if (m >= 0) newGame(m + 1); else Sfx.shot(); return; }
    if (G.state === 'gameOver') { if (G.timer <= 0) toTitle(); return; }
    if (G.state !== 'wave' || G.shots <= 0) return;
    G.shots--; Sfx.shot(); G.muzzle = { x, y, t: 0.07 }; G.shake = 0.06;
    // dedo é menos preciso que mouse: área de acerto maior no toque
    const tx = touch ? 16 : 10, ty = touch ? 14 : 9;
    let best = null, bd = Infinity;
    for (const b of G.birds) {
      if (b.state !== 'fly') continue;
      const dx = Math.abs(x - b.x), dy = Math.abs(y - b.y);
      if (dx <= tx && dy <= ty && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = b; }
    }
    if (best) {
      best.hit(); G.results[best.idx] = 'hit'; G.score += best.T.pts;
      G.pops.push({ x: best.x, y: best.y - 12, txt: String(best.T.pts), t: 1 });
      feathers(best); Sfx.hit();
    }
    if (G.shots === 0) G.noShotT = 0.6;
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    G.time += dt;
    G.escFlash = Math.max(0, G.escFlash - dt);
    G.shake = Math.max(0, G.shake - dt);
    if (G.muzzle && (G.muzzle.t -= dt) <= 0) G.muzzle = null;
    if (G.msg && G.msg.t !== undefined && (G.msg.t -= dt) <= 0) G.msg = null;
    for (const p of G.parts) {
      p.vy = Math.min(18, p.vy + 50 * dt); p.vx *= 0.96;
      p.x += p.vx * dt + Math.sin(G.time * 6 + p.y) * 0.3; p.y += p.vy * dt; p.t -= dt;
    }
    G.parts = G.parts.filter(p => p.t > 0);
    for (const p of G.pops) { p.y -= 12 * dt; p.t -= dt; }
    G.pops = G.pops.filter(p => p.t > 0);

    switch (G.state) {
      case 'title':
        for (const b of G.deco) b.update(dt);
        break;
      case 'roundIntro':
        if ((G.timer -= dt) <= 0) startWave();
        break;
      case 'wave': {
        G.waveT -= dt;
        if (G.noShotT > 0) G.noShotT -= dt;
        const flying = G.birds.some(b => b.state === 'fly');
        if (!G.escaped && flying && (G.waveT <= 0 || (G.shots === 0 && G.noShotT <= 0))) triggerEscape();
        for (const b of G.birds) b.update(dt);
        G.birds = G.birds.filter(b => !b.dead);
        if (G.birds.length === 0) { G.state = 'waveOver'; G.timer = 0.9; }
        break;
      }
      case 'waveOver':
        if ((G.timer -= dt) <= 0) { if (G.next >= 10) tally(); else startWave(); }
        break;
      case 'tally':
        if ((G.timer -= dt) <= 0) {
          if (G.pass) { G.round++; startRound(); }
          else { G.state = 'gameOver'; G.timer = 1.2; G.msg = null; }
        }
        break;
      case 'gameOver':
        G.timer -= dt;
        break;
    }
  }

  // ---------------------------------------------------------------- render
  function text(str, x, y, color = '#ffffff', align = 'left', size = 8) {
    ctx.font = size + 'px "Press Start 2P", monospace';
    ctx.textAlign = align; ctx.textBaseline = 'top';
    ctx.fillStyle = OUT; ctx.fillText(str, x + 1, y + 1);
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  function box(x, y, w, h) {
    ctx.fillStyle = OUT; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#4a3458'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = '#1e1428'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  }
  function pattern(rows, x, y, col) {
    ctx.fillStyle = col;
    rows.forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') ctx.fillRect(x + i, y + j, 1, 1); }));
  }
  function shell(x, y, live) {
    ctx.fillStyle = live ? '#c23a2a' : '#3a2a3a'; ctx.fillRect(x, y + 1, 4, 6); ctx.fillRect(x + 1, y, 2, 1);
    ctx.fillStyle = live ? '#ff7a62' : '#4a3a4a'; ctx.fillRect(x + 1, y + 1, 1, 4);
    ctx.fillStyle = live ? '#e8b04a' : '#4a3a4a'; ctx.fillRect(x, y + 6, 4, 2);
  }
  const ICON = ['....##.', '...####', '#.####.', '#####..', '.###...'];

  const IC = {
    fsIn: ['###...###', '#.......#', '#.......#', '.........', '.........', '.........', '#.......#', '#.......#', '###...###'],
    fsOut: ['..#...#..', '..#...#..', '###...###', '.........', '.........', '.........', '###...###', '..#...#..', '..#...#..'],
    spk: ['...#', '..##', '####', '####', '####', '####', '####', '..##', '...#'],
    waves: ['.........', '.......#.', '.....#..#', '.....#..#', '.....#..#', '.....#..#', '.....#..#', '.......#.', '.........'],
    mute: ['.........', '.........', '....#...#', '.....#.#.', '......#..', '.....#.#.', '....#...#', '.........', '.........'],
    pause: ['.........', '.###.###.', '.###.###.', '.###.###.', '.###.###.', '.###.###.', '.###.###.', '.###.###.', '.........'],
    play: ['.........', '..#......', '..###....', '..#####..', '..######.', '..#####..', '..###....', '..#......', '.........'],
  };
  function drawButtons() {
    for (const b of buttons()) {
      box(b.x, b.y, BTN, BTN);
      const off = Math.floor((BTN - 9) / 2), ix = b.x + off, iy = b.y + off;
      if (b.id === 'fs') pattern(isFS() ? IC.fsOut : IC.fsIn, ix, iy, '#e9e6f2');
      else if (b.id === 'snd') {
        pattern(IC.spk, ix, iy, '#e9e6f2');
        if (Sfx.muted) pattern(IC.mute, ix, iy, '#ff4a4a'); else pattern(IC.waves, ix, iy, '#ffd27a');
      } else if (b.id === 'pause') pattern(G.paused ? IC.play : IC.pause, ix, iy, '#e9e6f2');
    }
  }

  function drawLake() {
    const t = G.time;
    for (let y = HORIZON + 2; y < BANK - 12; y += 2) {
      const k = y - HORIZON;
      const w = Math.max(2, 34 - k * 1.1 + Math.sin(t * 2.2 + y * 0.9) * 4);
      const off = Math.sin(t * 1.3 + y * 0.5) * 2;
      ctx.fillStyle = (y / 2) % 2 ? '#f7ae5c' : '#d65a64';
      ctx.fillRect(Math.round(SUN_X - w / 2 + off), y, Math.round(w), 1);
    }
    ctx.fillStyle = '#7a5a9a';
    const n = Math.round(W / 53);
    for (let i = 0; i < n; i++) {
      const x = (i * 57 + Math.floor(t * 8 + i * 13)) % W, y = HORIZON + 4 + ((i * 7) % 20);
      if (Math.sin(t * 3 + i) > 0.3) ctx.fillRect(x, y, 3, 1);
    }
  }

  function drawHUD() {
    const hy = H - 33;
    if (G.state === 'title') {
      const bw = Math.min(240, W - 8);
      box(Math.round(W / 2 - bw / 2), hy, bw, 30);
      text('RECORDE ' + String(G.hi).padStart(6, '0'), W / 2, hy + 4, '#ffd27a', 'center');
      const hint = !COARSE ? 'M SOM  P PAUSA  F TELA' : COMPACT ? 'TOQUE NO PATO' : 'TOQUE NO PATO P/ ATIRAR';
      text(hint, W / 2, hy + 17, '#b9a6e6', 'center');
      return;
    }
    // compacto: linha de acertos em cima, rodada/tiros e pontos embaixo
    const ay = COMPACT ? hy - 32 : hy;
    const half = Math.floor((W - 12) / 2);
    const lw = COMPACT ? half : 76, rx = COMPACT ? W - 4 - half : W - 80, rw = COMPACT ? half : 76;

    box(4, hy, lw, 30);
    text('RODADA', 8, hy + 4, '#f7ae5c');
    text(String(G.round), 58, hy + 4, '#ffffff');
    for (let i = 0; i < 3; i++) shell(9 + i * 7, hy + 16, i < G.shots);
    text('TIRO', 34, hy + 17, '#b9a6e6');

    box(rx, hy, rw, 30);
    text(String(G.score).padStart(6, '0'), rx + 8, hy + 4, '#ffffff');
    text('PONTOS', rx + 8, hy + 17, '#f7ae5c');

    if (COMPACT) box(4, ay, W - 8, 30); else box(84, ay, W - 168, 30);
    drawHits(ay);
  }

  function drawHits(hy) {
    const ix = Math.round(W / 2 - 64);
    const active = new Set(G.state === 'wave' ? G.birds.filter(b => b.state === 'fly').map(b => b.idx) : []);
    for (let i = 0; i < 10; i++) {
      const r = G.results[i];
      let col = r === 'hit' ? '#ff4a4a' : r === 'miss' ? '#5a4a6a' : '#e9e6f2';
      if (active.has(i) && Math.floor(G.time * 6) % 2) col = '#ffd27a';
      pattern(ICON, ix + i * 13, hy + 4, col);
    }
    ctx.fillStyle = '#f7ae5c'; ctx.fillRect(ix, hy + 11, required(G.round) * 13 - 6, 1);
    const hits = G.results.filter(r => r === 'hit').length;
    text('ACERTO ' + hits + ' META ' + required(G.round), ix, hy + 17, '#b9a6e6');
  }

  function msgBox(lines, y, colors = []) {
    const w = Math.max(...lines.map(l => l.length)) * 8 + 20, h = lines.length * 13 + 9;
    const x = Math.round(W / 2 - w / 2);
    box(x, y, w, h);
    lines.forEach((l, i) => text(l, W / 2, y + 6 + i * 13, colors[i] || (i === 0 ? '#ffd27a' : '#ffffff'), 'center'));
  }

  function drawTitle() {
    const ty = titleY(), cx = W / 2;
    ctx.font = '24px "Press Start 2P", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = OUT; ctx.fillText('REVOADA', cx + 3, ty + 3);
    ctx.fillStyle = '#a33a72'; ctx.fillText('REVOADA', cx + 2, ty + 2);
    ctx.fillStyle = '#ffd27a'; ctx.fillText('REVOADA', cx, ty);
    text('TIRO AO PATO', cx, ty + 32, '#f4d6ff', 'center');
    menuItems().forEach((m, i) => {
      const on = G.hover === i;
      text((on ? '> ' : '  ') + m.label + '  ', cx, m.y, on ? '#ffd27a' : '#ffffff', 'center');
    });
    if (Math.floor(G.time * 2) % 2) text('ESCOLHA UM MODO', cx, ty + 102, '#b9a6e6', 'center');
  }

  function drawCrosshair() {
    const { muzzle } = G;
    if (muzzle) {
      ctx.fillStyle = '#fff6c0';
      const mx = Math.round(muzzle.x), my = Math.round(muzzle.y);
      for (const [dx, dy] of [[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3], [-2, -2], [2, 2], [-2, 2], [2, -2]]) ctx.fillRect(mx + dx, my + dy, 1, 1);
    }
    if (!G.mouse.on) return;
    const rx = Math.round(G.mouse.x), ry = Math.round(G.mouse.y);
    for (const [c, o] of [[OUT, 1], ['#ffffff', 0]]) {
      ctx.fillStyle = c;
      ctx.fillRect(rx - 6 + o, ry + o, 4, 1); ctx.fillRect(rx + 3 + o, ry + o, 4, 1);
      ctx.fillRect(rx + o, ry - 6 + o, 1, 4); ctx.fillRect(rx + o, ry + 3 + o, 1, 4);
    }
    ctx.fillStyle = '#ff4a4a'; ctx.fillRect(rx, ry, 1, 1);
  }

  function draw() {
    ctx.save();
    if (G.shake > 0) ctx.translate(Math.round(rand(-1, 1)), Math.round(rand(-1, 1)));
    ctx.drawImage(BG, 0, 0);
    drawLake();
    if (G.escFlash > 0 && Math.floor(G.escFlash * 8) % 2 === 0) { ctx.fillStyle = 'rgba(255,110,150,0.28)'; ctx.fillRect(0, 0, W, HORIZON); }
    for (const b of (G.state === 'title' ? G.deco : G.birds)) b.draw(ctx);
    ctx.drawImage(FG, 0, 0);
    for (const p of G.parts) { ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); }
    for (const p of G.pops) text(p.txt, Math.round(p.x), Math.round(p.y), '#ffffff', 'center');
    ctx.restore();

    drawHUD();
    if (G.state === 'title') drawTitle();
    if (G.msg && !G.paused) msgBox(G.msg.lines, msgY());
    if (G.state === 'gameOver') {
      const lines = ['FIM DE JOGO', 'PONTOS ' + G.score];
      if (G.newHi) lines.push('NOVO RECORDE!');
      lines.push(G.timer <= 0 && Math.floor(G.time * 2) % 2 ? (COARSE ? 'TOQUE PARA VOLTAR' : 'CLIQUE PARA VOLTAR') : '');
      msgBox(lines, msgY() - 8, ['#ff6a5a', '#ffffff', '#ffd27a', '#b9a6e6']);
    }
    if (G.paused) msgBox(['PAUSA', COARSE ? 'TOQUE PARA SEGUIR' : 'CLIQUE OU P'], msgY());
    drawButtons();
    drawCrosshair();
  }

  // ---------------------------------------------------------------- layout responsivo
  // A tela inteira vira área de jogo: a menor dimensão fica fixa (200 de altura
  // ou 320 de largura) e a outra estica para casar com a proporção da tela.
  function layout() {
    const cw = cv.clientWidth || innerWidth || 320, ch = cv.clientHeight || innerHeight || 200;
    const a = cw / ch;
    let w, h;
    if (a >= 1.6) { h = 200; w = Math.round(200 * a); }
    else {
      // celular em pé: largura lógica ~metade dos px CSS => escala ~2x (patos e textos maiores)
      w = COARSE ? Math.round(Math.min(320, Math.max(200, cw / 2))) : 320;
      h = Math.round(w / a);
    }
    if (w === W && h === H && BG) return;
    W = w; H = h;
    COMPACT = W < 300;
    SPEED_K = Math.min(1, Math.max(0.7, W / 320));
    BANK = H - (COMPACT ? 70 : 38); HORIZON = BANK - 42;
    cv.width = W; cv.height = H;
    ctx.imageSmoothingEnabled = false;
    BG = buildBG(); FG = buildFG();
    for (const b of [...G.birds, ...G.deco]) {
      b.x = Math.min(Math.max(b.x, 10), W - 10);
      if (b.state === 'fly' && !b.rising) b.y = Math.min(Math.max(b.y, TOP_Y), HORIZON - 8);
    }
  }
  if (window.ResizeObserver) new ResizeObserver(() => layout()).observe(cv);
  addEventListener('resize', layout);
  addEventListener('orientationchange', () => setTimeout(layout, 150));

  // ---------------------------------------------------------------- input
  const toLogical = e => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  };
  cv.addEventListener('pointermove', e => {
    const p = toLogical(e);
    G.mouse.x = p.x; G.mouse.y = p.y; G.mouse.on = e.pointerType === 'mouse';
    G.hover = G.state === 'title' ? menuAt(p.x, p.y) : -1;
  });
  cv.addEventListener('pointerleave', () => { G.mouse.on = false; });
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = toLogical(e);
    G.mouse.x = p.x; G.mouse.y = p.y; G.mouse.on = e.pointerType === 'mouse';
    shoot(p.x, p.y, e.pointerType !== 'mouse');
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  // bloqueia zoom/rolagem por gesto (iOS)
  for (const ev of ['touchstart', 'touchmove', 'touchend']) cv.addEventListener(ev, e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'm') { Sfx.init(); Sfx.toggleMute(); }
    else if (k === 'p' || k === 'escape') { if (playing()) G.paused = !G.paused; }
    else if (k === 'f') toggleFS();
    else if (G.state === 'title' && (k === '1' || k === '2')) newGame(+k);
    else if (k === ' ') { e.preventDefault(); shoot(G.mouse.x, G.mouse.y); }
    else if (k === 'enter' && G.state === 'gameOver' && G.timer <= 0) toTitle();
  });
  const autoPause = () => { if (playing()) G.paused = true; };
  addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });

  // ---------------------------------------------------------------- loop
  let last = 0, started = false;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!G.paused) update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  const go = () => {
    if (started) return; started = true;
    layout(); toTitle();
    requestAnimationFrame(t => { last = t; frame(t); });
  };
  layout();
  if (document.fonts && document.fonts.load) { document.fonts.load('8px "Press Start 2P"').then(go, go); setTimeout(go, 1500); }
  else go();

  window.__revoada = G; // depuração
})();
