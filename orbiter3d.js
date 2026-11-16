// ORBITER-1: 3D launch scene (three.js r147 classic build).
// Every visual is a function of mission time T, so the timeline can be scrubbed freely.
// Scale: 1 scene unit = 2.4 m (the rocket model is about 70 m tall).

const Orbiter3D = (() => {
  const KM = 1000 / 2.4;
  const R = 6371 * KM;
  const PAD_TOP = 3.0;
  const G_KM = 0.0098;            // km/s^2
  const DV_SPEED = { earth: 7.8, mars: 11.3, jupiter: 14.0 };

  // Playback pacing: [mission T start, T end, warp]. Slow at the big moments, fast in between.
  const SEGMENTS = [
    [-10, 0, 1], [0, 20, 2], [20, 120, 10], [120, 150, 3], [150, 170, 4], [170, 190, 3],
    [190, 500, 40], [500, 510, 3], [510, 2690, 300], [2690, 2770, 8], [2770, 3110, 100],
    [3110, 3130, 3], [3130, 3240, 30], [3240, 3300, 8], [3300, 3600, 40], [3600, 3660, 8],
    [3660, 4400, 150], [4400, 4695, 30]
  ];
  const T_MIN = -10, T_MAX = 4695;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function pOfT(T, segs = SEGMENTS) {
    let p = 0;
    for (const [a, b, w] of segs) {
      if (T <= a) break;
      p += (Math.min(T, b) - a) / w;
    }
    return p;
  }
  function tOfP(p, segs = SEGMENTS) {
    let acc = 0;
    for (const [a, b, w] of segs) {
      const len = (b - a) / w;
      if (p <= acc + len) return a + (p - acc) * w;
      acc += len;
    }
    return segs[segs.length - 1][1];
  }

  // Replace the playback speed between mission times a and b (slow motion for big moments)
  function withWarp(base, a, b, w) {
    const out = [];
    for (const [s0, s1, ww] of base) {
      if (s1 <= a || s0 >= b) { out.push([s0, s1, ww]); continue; }
      if (s0 < a) out.push([s0, a, ww]);
      out.push([Math.max(s0, a), Math.min(s1, b), w]);
      if (s1 > b) out.push([b, s1, ww]);
    }
    return out;
  }

  function fmtT(T) {
    const s = Math.round(Math.abs(T));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
    return `T${T < 0 ? '−' : '+'}${body}`;
  }

  // ---------- Flight plan ----------

  // Estimated ascent profile (not NASA telemetry): [MET s, altitude km, speed km/h]
  const PROFILE = [[0, 0, 0], [30, 2, 600], [60, 9, 1500], [70, 12, 1800], [100, 30, 3600], [135, 70, 7400],
    [180, 115, 9200], [300, 250, 15500], [504, 640, 27100], [3119, 857, 26800]];
  function lerpProf(met, col) {
    let i = 0; while (i < PROFILE.length - 2 && met > PROFILE[i + 1][0]) i++;
    const a = PROFILE[i], b = PROFILE[i + 1];
    return a[col] + (b[col] - a[col]) * clamp((met - a[0]) / (b[0] - a[0]), 0, 1);
  }
  function nominalAlt(T) {
    if (T <= 0) return 0;
    if (T <= 30) return 2 * Math.pow(T / 30, 2);   // ease-in off the pad
    return lerpProf(T, 1);
  }
  function nominalSpeed(T, mission) {                // km/s
    if (T <= 0) return 0;
    const v = lerpProf(T, 2) / 3600;
    if (mission.id !== 'earth' && T >= 2700) return lerp(v, DV_SPEED[mission.id], smooth(2700, 2760, T));
    return v;
  }
  function nominalDown(T) {
    if (T <= 0) return 0;
    if (T <= 135) return 85 * Math.pow(T / 135, 2.6);
    if (T <= 504) return 85 + 1700 * Math.pow((T - 135) / 369, 1.6);
    return 1785 + (T - 504) * 0.25;
  }
  function nominalPitch(T) {
    if (T <= 8) return 0;
    return (Math.PI / 2) * Math.pow(clamp((T - 8) / 480, 0, 1), 0.55);
  }

  const BASE_EVENTS = [
    { T: -10, label: 'T−0:10', text: 'Terminal countdown' },
    { T: -3, label: 'T−0:03', text: 'Engine ignition' },
    { T: 0, label: 'T+0:00', text: 'Liftoff' },
    { T: 70, label: '≈T+1:10', text: 'Max-Q: peak air pressure (est)' },
    { T: 135, label: 'T+2:15', text: 'Main engine cutoff, stage separation, second engine start' },
    { T: 180, label: '≈T+3:00', text: 'Fairing jettison' },
    { T: 504, label: 'T+8:24', text: 'Second engine cutoff, parking orbit' },
    { T: 2700, label: '≈T+45:00', text: 'Escape burn: second engine restarts (est, not part of SWOT)', escape: true },
    { T: 3119, label: 'T+51:59', text: 'Spacecraft separation' },
    { T: 3240, label: '≈T+54:00', text: 'Solar arrays unfold' },
    { T: 3600, label: '≈T+60:00', text: 'Antenna and boom deploy' },
    { T: 4680, label: 'T+1:18:00', text: 'First full ground contact' },
    { T: 4690, label: 'Finale', text: 'Pull back: Earth\u2019s magnetosphere and Van Allen belts' }
  ];

  // Fact cards: one at a time, with sources
  const ENV = [
    { met: 6, k: 'Liftoff \u00b7 heavy lift', t: 'NASA\u2019s SLS, which flew Artemis I on Nov 16, 2022, has 10% more thrust than Saturn V', s: 'NASA Marshall (Creech 2013) \u00b7 Artemis program' },
    { spd: 1225, k: 'Mach 1 \u00b7 \u22481,225 km/h', t: 'Breaking the sound barrier', s: 'NASA Glenn' },
    { alt: 12, k: '12 km \u00b7 Tropopause', t: 'Leaving the troposphere: almost all weather is below', s: 'NASA Science' },
    { met: 70, k: '\u2248T+1:10 \u00b7 Max-Q', t: 'Maximum aerodynamic pressure', s: 'Falcon 9 timelines' },
    { alt: 50, k: '50 km \u00b7 Stratopause', t: 'Into the mesosphere, about \u221290 \u00b0C. Meteors burn up here', s: 'NASA Science \u00b7 UCAR' },
    { alt: 80, k: '80 km \u00b7 Mesopause', t: 'Into the thermosphere. Auroras glow from about 100 km', s: 'NASA Science \u00b7 UCAR' },
    { alt: 100, k: '100 km \u00b7 K\u00e1rm\u00e1n line', t: 'You are in space: 99.99997% of the atmosphere is below', s: 'NASA Science' },
    { met: 3125, k: '857 km \u00b7 Calibration orbit', t: 'Orbiting inside the thermosphere. SWOT checked its readings here, then rose to 891 km for science', s: 'NASA JPL \u00b7 UCAR' },
    { met: 4480, k: '\u224865,000 km \u00b7 Magnetopause', t: 'Shielded by the magnetosphere', s: 'NASA Goddard' },
    { met: 4600, k: 'Magnetosphere plasma', t: 'The proposed PILOT mission would fly 34 satellites to image this plasma like a CT scan', s: 'Advanced Space \u00b7 CU Boulder LASP' }
  ];
  function factCards(f) {
    const out = [];
    for (const c of ENV) {
      let hit = null;
      for (let T = 0; T <= f.Tend; T += T < 600 ? 0.5 : 5) {
        const st = stateAt(f, T);
        if (st.lost) break;
        if ((c.spd && st.speed * 3600 >= c.spd) || (c.alt && st.alt >= c.alt) || (c.met && T >= c.met)) { hit = T; break; }
      }
      if (hit !== null) out.push({ T: hit, k: c.k, t: c.t, s: c.s });
    }
    return out.sort((a, b) => a.T - b.T);
  }

  // outcome: { kind: orbit|wobble|scrub|nothrust|explode|unstable|suborbital|stranded, reason, t, Tb, apex, engineOut }
  function makeFlight(outcome, mission) {
    const f = { outcome, mission, kind: outcome.kind, segments: SEGMENTS };
    let events = BASE_EVENTS.filter(e => !e.escape || mission.id !== 'earth');
    const cut = (T, extra) => { events = events.filter(e => e.T < T).concat(extra); };
    switch (outcome.kind) {
      case 'scrub':
        cut(-0.5, [{ T: -1, label: 'T−0:01', text: 'Scrub: ' + outcome.reason, tone: 'bad' }]);
        f.Tend = 4; break;
      case 'nothrust':
        f.te = 7.2;
        cut(0.5, [{ T: 0, label: 'T+0:00', text: 'Full thrust, but the rocket is too heavy to climb', tone: 'bad' },
          { T: 3, label: 'T+0:03', text: 'Engines falter and the rocket starts to tip over', tone: 'bad' },
          { T: 7.2, label: 'T+0:07', text: 'It falls onto the pad and explodes', tone: 'bad' }]);
        f.Tend = f.te + 24;
        f.segments = withWarp(SEGMENTS, 0, f.Tend, 1);
        break;
      case 'explode':
      case 'unstable': {
        const te = outcome.t;
        f.te = te;
        const pre = outcome.kind === 'unstable' ? [{ T: 25, label: 'T+0:25', text: 'Stability warning: the rocket is swaying', tone: 'warn' }] : [];
        cut(te, pre.concat([{ T: te, label: fmtT(te), text: 'Vehicle lost: ' + outcome.reason, tone: 'bad' }]));
        f.Tend = te + 18;
        f.segments = outcome.kind === 'unstable' ? withWarp(SEGMENTS, 22, te + 18, 2.5) : withWarp(SEGMENTS, 62, te + 18, 2);
        break;
      }
      case 'suborbital': {
        // Out of fuel: coast up, then fall back through the air. Drag slows the fall
        // (about 120 m/s near the ground) and friction heats the stage on the way down.
        const Tb = outcome.Tb;
        const altB = nominalAlt(Tb);
        const vup = Math.sqrt(Math.max(0.01, 2 * G_KM * Math.max(0.2, outcome.apex - altB)));
        const K = G_KM / (0.12 * 0.12);
        let t = 0, alt = altB, down = nominalDown(Tb), vv = vup, vx = nominalSpeed(Tb, mission) * 0.85;
        let apexT = Tb, apexAlt = alt, maxHeat = 1e-9, reT = null;
        const tab = [];
        while (t < 5000) {
          const rho = Math.exp(-Math.max(0, alt) / 7.2), v = Math.hypot(vv, vx);
          const heat = rho * v * v * v;
          tab.push([alt, down, vv, vx, heat]);
          if (heat > maxHeat && vv < 0) maxHeat = heat;
          if (alt > apexAlt) { apexAlt = alt; apexT = Tb + t; }
          const ax = -K * rho * v * vx, ay = -G_KM - K * rho * v * vv;
          vx += ax * 0.5; vv += ay * 0.5; down += vx * 0.5; alt += vv * 0.5; t += 0.5;
          if (alt <= 0) { tab.push([0, down, vv, vx, 0]); break; }
        }
        // glow builds up gradually: show heating as (heat / peak)^0.35, and mark the moment it becomes visible
        tab.forEach((row, i) => { if (reT === null && row[2] < 0 && Math.pow(row[4] / maxHeat, 0.35) > 0.12) reT = Tb + i * 0.5; });
        Object.assign(f, { Tb, tab, maxHeat, apexT, Tland: Tb + (tab.length - 1) * 0.5 });
        const re = Math.max(Tb + 1, reT || Tb + 1);
        cut(Tb, [
          { T: Tb, label: fmtT(Tb), text: outcome.reason || 'Out of fuel before reaching orbital speed', tone: 'bad' },
          { T: apexT, label: '≈' + fmtT(apexT), text: `Highest point: about ${Math.round(apexAlt)} km. Now falling back.`, tone: 'warn' },
          { T: re, label: '≈' + fmtT(re), text: 'Hits the thick air: friction heats it until it glows', tone: 'bad' },
          { T: f.Tland, label: '≈' + fmtT(f.Tland), text: 'Splashes into the ocean', tone: 'bad' }
        ]);
        const segs = [];
        for (const [a, b, w] of SEGMENTS) { if (a >= Tb) break; segs.push([a, Math.min(b, Tb), w]); }
        // slow motion for the fall: about 15 s to drop to the thick air, about 30 s through the fire to the splash
        segs.push([Tb, Math.max(Tb + 1, Math.min(re, apexT + 1)), 20]);
        if (re > apexT + 1) segs.push([apexT + 1, re, 12]);
        segs.push([segs[segs.length - 1][1], f.Tland, 4]);
        segs.push([f.Tland, f.Tland + 10, 1.5]);
        f.segments = segs;
        f.Tend = f.Tland + 10; break;
      }
      case 'stranded':
        cut(2701, [{ T: 2700, label: '≈T+45:00', text: 'Escape burn: ' + outcome.reason, tone: 'bad' }]);
        f.Tend = 2770; break;
      default:
        if (outcome.engineOut) events.push({ T: 80, label: 'T+1:20', text: 'One engine shut down early. The others burned longer to make up for it.', tone: 'warn' });
        if (outcome.kind === 'wobble') {
          events.push({ T: 30, label: 'T+0:30', text: 'Stability warning: the rocket is swaying. The engines swivel to fight it.', tone: 'warn' });
          f.segments = withWarp(SEGMENTS, 26, 118, 3);
        }
        events.sort((a, b) => a.T - b.T);
        f.Tend = T_MAX;
    }
    f.events = f.Tend >= 4690 ? events : events.filter(e => e.T < 4690);
    f.pMax = pOfT(f.Tend, f.segments);
    f.cards = factCards(f);
    return f;
  }

  // Everything about the vehicle at time T
  function stateAt(f, T) {
    const m = f.mission, k = f.kind;
    const s = { alt: nominalAlt(T), down: nominalDown(T), speed: nominalSpeed(T, m), pitch: nominalPitch(T),
      swayX: 0, swayZ: 0, lat: 0, maxq: f.kind === 'scrub' || f.kind === 'nothrust' ? 0 : Math.exp(-Math.pow((T - 70) / 9, 2)), gimbal: 0, heat: 0, wind: 0, s1: 0, s2: 0, lost: false, sep: T >= 138, fairing: T >= 180, satSep: T >= 3119,
      arrays: smooth(3240, 3290, T), antenna: smooth(3600, 3645, T), shake: 0, warn: '' };

    // engine states (0..1 thrust)
    s.s1 = T < -3 ? 0 : T < 0 ? smooth(-3, -0.4, T) : T < 135 ? 1 : 0;
    s.s2 = T >= 143 && T < 504 ? smooth(143, 145, T) : 0;
    if (m.id !== 'earth' && T >= 2700 && T < 2760) s.s2 = 1;
    s.shake = T > -3 && T < 20 ? (T < 0 ? 0.3 : 1 - T / 20) : 0;
    s.shake = Math.max(s.shake, s.maxq * 0.55);

    if (k === 'scrub') {
      Object.assign(s, { alt: 0, down: 0, speed: 0, pitch: 0, sep: false, fairing: false, satSep: false, arrays: 0, antenna: 0 });
      s.s1 = T < -3 ? 0 : T < -1.2 ? smooth(-3, -2, T) * (0.55 + 0.35 * Math.sin(T * 40)) : Math.max(0, 1 - (T + 1.2) * 2) * 0.4;
      s.shake = T > -3 && T < -1 ? 0.2 : 0;
    } else if (k === 'nothrust') {
      // Full thrust but too heavy: it lurches a few meters, the engines falter, it topples onto the pad and explodes
      const te = f.te;
      Object.assign(s, { down: 0, speed: 0, pitch: 0, sep: false, fairing: false, satSep: false, arrays: 0, antenna: 0, maxq: 0 });
      s.alt = T > 0 && T < 3 ? Math.sin((T / 3) * Math.PI) * 0.006 : 0;
      s.s1 = T < -3 ? 0 : T < 3 ? smooth(-3, -0.4, T) : T < te ? Math.max(0, (0.55 + 0.45 * Math.sin(T * 31)) * (1 - (T - 3) / 3.4)) : 0;
      s.tip = T < 3 ? 0 : (Math.PI / 2) * 0.97 * Math.pow(smooth(3, te, T), 2.2);
      s.swayX = -s.tip;                                   // falls sideways, away from the tower and the camera
      s.shake = T > -3 && T < te ? 0.6 + 0.3 * smooth(3, te, T) : 0;
      if (T >= te) {
        Object.assign(s, { lost: true, boomDt: T - te, boomPad: true, boomScale: 2.2, s1: 0, tip: (Math.PI / 2) * 0.97 });
        s.swayX = -s.tip;
        s.shake = Math.max(0, 1.4 * (1 - (T - te) / 4));
      }
    } else if (k === 'explode' || k === 'unstable') {
      if (k === 'unstable' && T > 25) {
        const g = smooth(25, f.te, T);
        s.gimbal = 1 - g * 0.6;
        s.lat = Math.sin(T * 0.5) * 0.6 * g;
        s.swayZ = Math.sin(T * 2.6) * 0.7 * g * g + g * g * 0.9;
        s.swayX = Math.cos(T * 1.9) * 0.4 * g * g;
        s.shake = 0.3 + g * 0.7;
        s.warn = 'Stability warning';
      }
      if (T >= f.te) {
        const te = f.te;
        Object.assign(s, { alt: nominalAlt(te), down: nominalDown(te), speed: 0, pitch: nominalPitch(te), s1: 0, s2: 0, lost: true, sep: false, fairing: false });
        s.boomDt = T - te; s.boomScale = 1.4;
        s.shake = T - te < 3 ? 1 - (T - te) / 3 : 0;
      }
    } else if (k === 'suborbital') {
      const Tb = f.Tb;
      if (Tb < 135) { if (T >= Tb) s.s1 = 0; s.sep = false; s.fairing = false; s.s2 = 0; }
      else if (T >= Tb) s.s2 = 0;
      if (T >= Tb) {
        const fi = (Math.min(T, f.Tland) - Tb) / 0.5, i0 = Math.floor(fi), fr = fi - i0;
        const A = f.tab[Math.min(i0, f.tab.length - 1)], B = f.tab[Math.min(i0 + 1, f.tab.length - 1)];
        const L = (k) => A[k] + (B[k] - A[k]) * fr;
        s.alt = Math.max(0, L(0)); s.down = L(1);
        const vv = L(2), vx = L(3);
        s.speed = Math.hypot(vv, vx);
        // nose follows the flight path on the way up, then the stage turns and falls engine-first
        s.pitch = Math.atan2(vx, vv) - Math.PI * smooth(f.apexT, f.apexT + 40, T);
        s.heat = clamp(Math.pow(Math.max(0, L(4)) / f.maxHeat, 0.35), 0, 1);
        s.wind = clamp(Math.exp(-s.alt / 7.2) * s.speed * 6, 0, 1);
        s.swayX = Math.sin(T * 0.9) * 0.1 * (1 - s.heat);
        s.swayZ = Math.sin(T * 1.7 + 0.6) * 0.035 * s.wind;
        s.shake = Math.max(s.shake, 0.12 + s.heat * 0.8 + s.wind * 0.35);
        if (s.heat > 0.12) s.warn = 'Reentry: air friction is heating the rocket';
        s.satSep = false; s.arrays = 0; s.antenna = 0;
        if (Tb < 180) s.fairing = false;
        if (T >= f.Tland) { s.lost = true; s.speed = 0; s.splash = T - f.Tland; }
      }
    } else if (k === 'stranded') {
      if (T >= 2700) s.s2 = T < 2716 ? (0.5 + 0.5 * Math.sin(T * 30)) * (1 - (T - 2700) / 16) : 0;
      s.satSep = false; s.arrays = 0; s.antenna = 0;
    } else if (k === 'wobble') {
      const g = smooth(26, 40, T) * (1 - smooth(100, 120, T));
      const swell = 0.75 + 0.25 * Math.sin(T * 0.23);
      s.swayZ = Math.sin(T * 1.25) * 0.14 * g * swell;
      s.swayX = Math.sin(T * 0.9 + 1.1) * 0.07 * g;
      s.gimbal = g;
      s.lat = Math.sin(T * 0.42) * 0.45 * g;
      if (g > 0.15) { s.warn = 'Stability warning'; s.shake = Math.max(s.shake, 0.6 * g); }
    }
    return s;
  }

  function stageLabel(f, s, T) {
    if (s.lost) return f.kind === 'suborbital' ? 'Fell back to Earth' : 'Vehicle lost';
    if (f.kind === 'scrub' && T > -1.2) return 'Scrubbed';
    if (T < -3) return 'On the pad';
    if (T < 0) return 'Ignition';
    if (f.kind === 'nothrust') return T < 3 ? 'Straining on the pad' : 'Toppling over';
    if (s.s1 > 0) return 'First stage';
    if (!s.sep) return f.kind === 'suborbital' ? 'Coasting, no fuel' : 'Main engine cutoff';
    if (T < 145 && f.kind !== 'suborbital') return 'Stage separation';
    if (s.s2 > 0) return 'Second stage';
    if (f.kind === 'suborbital') return s.heat > 0.12 ? 'Reentry heating' : T > f.apexT ? 'Falling back to Earth' : 'Coasting, no fuel';
    if (!s.satSep) return T < 520 ? 'Parking orbit' : 'Coasting in orbit';
    if (s.antenna >= 1) return 'Satellite fully deployed';
    if (s.arrays > 0) return 'Satellite deploying';
    return 'Satellite free';
  }

  // ---------- Textures ----------

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  function vnoise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const h = (a, b, c) => hash(a * 157 + b * 113 + c * 271);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
  }
  function fbm3(x, y, z, oct) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * vnoise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
    return s;
  }

  function earthTextures() {
    const W = 1024, H = 512;
    const land = document.createElement('canvas'); land.width = W; land.height = H;
    const cl = document.createElement('canvas'); cl.width = W; cl.height = H;
    const li = land.getContext('2d').createImageData(W, H), ci = cl.getContext('2d').createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const lat = (0.5 - y / H) * Math.PI;
      for (let x = 0; x < W; x++) {
        const lon = (x / W) * Math.PI * 2;
        const px = Math.cos(lat) * Math.cos(lon), py = Math.sin(lat), pz = Math.cos(lat) * Math.sin(lon);
        const n = fbm3(px * 2.2 + 5, py * 2.2 + 1, pz * 2.2 + 3, 5);
        const i = (y * W + x) * 4;
        const polar = Math.abs(lat) > 1.25;
        let r, g, b;
        if (polar) { r = 236; g = 240; b = 244; }
        else if (n > 0.53) {
          const d = fbm3(px * 9, py * 9, pz * 9, 3);
          const dry = Math.abs(lat) < 0.5 ? 0.6 : 0.2;
          r = lerp(70, 176, dry * d * 1.4); g = lerp(104, 150, dry * d); b = lerp(54, 96, dry * d);
        } else {
          const deep = clamp((0.53 - n) * 5, 0, 1);
          r = lerp(36, 12, deep); g = lerp(104, 48, deep); b = lerp(160, 104, deep);
        }
        li.data[i] = r; li.data[i + 1] = g; li.data[i + 2] = b; li.data[i + 3] = 255;
        const c = fbm3(px * 4 + 11, py * 6 + 7, pz * 4 + 2, 5);
        const a = clamp((c - 0.5) * 3.2, 0, 1);
        ci.data[i] = ci.data[i + 1] = ci.data[i + 2] = 255; ci.data[i + 3] = a * 235;
      }
    }
    land.getContext('2d').putImageData(li, 0, 0);
    cl.getContext('2d').putImageData(ci, 0, 0);
    const t1 = new THREE.CanvasTexture(land), t2 = new THREE.CanvasTexture(cl);
    t1.encoding = THREE.sRGBEncoding;
    return [t1, t2];
  }

  const GROUND_HALF = 30 * KM;
  function coastZ(x) { return -360 + 70 * Math.sin(x / 520) + 40 * Math.sin(x / 190 + 1.3); }

  function groundTexture() {
    const N = 1024;
    return canvasTex(N, N, (g) => {
      const img = g.createImageData(N, N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * 2 * GROUND_HALF, z = (j / N - 0.5) * 2 * GROUND_HALF;
        const k = (j * N + i) * 4;
        const n = fbm3(x / 900, z / 900, 0.5, 4);
        const cz = coastZ(x);
        let r, gg, b;
        if (z < cz - 30) { const d = clamp((cz - z) / 4000, 0, 1); r = lerp(48, 18, d); gg = lerp(110, 58, d); b = lerp(150, 110, d); }
        else if (z < cz) { r = 214; gg = 200; b = 168; }
        else { r = lerp(120, 168, n); gg = lerp(118, 150, n); b = lerp(78, 98, n); }
        img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
  }

  function softTex(inner, outer) {
    return canvasTex(128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, inner); gr.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.55)')); gr.addColorStop(1, outer);
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    });
  }

  function cloudTex() {
    return canvasTex(256, 256, (g) => {
      for (let i = 0; i < 22; i++) {
        const x = 128 + (hash(i) - 0.5) * 120, y = 128 + (hash(i + 9) - 0.5) * 60, r = 30 + hash(i + 3) * 50;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      }
    });
  }

  // ---------- Materials ----------

  function makeMaterials() {
    const weave = canvasTex(64, 64, (g) => {
      g.fillStyle = '#1b1c1f'; g.fillRect(0, 0, 64, 64);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        g.fillStyle = (x + y) % 2 ? '#26282c' : '#141518';
        g.fillRect(x * 8, y * 8, 8, 8);
      }
    });
    weave.wrapS = weave.wrapT = THREE.RepeatWrapping; weave.repeat.set(12, 30); weave.encoding = THREE.sRGBEncoding;
    const crinkle = canvasTex(256, 256, (g) => {
      const img = g.createImageData(256, 256);
      for (let i = 0; i < 256 * 256; i++) {
        const x = i % 256, y = (i / 256) | 0;
        const v = fbm3(x / 18, y / 18, 0.3, 4) * 255;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
    const cells = canvasTex(256, 256, (g) => {
      g.fillStyle = '#c9ced6'; g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) {
        g.fillStyle = '#1a2a5e'; g.fillRect(x * 42 + 3, y * 32 + 3, 37, 27);
        g.fillStyle = 'rgba(120,150,220,0.25)'; g.fillRect(x * 42 + 3, y * 32 + 3, 37, 6);
      }
    });
    cells.encoding = THREE.sRGBEncoding;
    const decal = canvasTex(128, 1024, (g) => {
      g.clearRect(0, 0, 128, 1024);
      g.save(); g.translate(64, 512); g.rotate(-Math.PI / 2);
      g.fillStyle = '#141414'; g.font = '800 92px Archivo, Arial Narrow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('ORBITER-1', 0, 0);
      g.restore();
    });
    decal.encoding = THREE.sRGBEncoding;

    const S = (o) => new THREE.MeshStandardMaterial(o);
    const named = (o) => { for (const k in o) o[k].name = k; return o; };
    return named({
      white_paint: new THREE.MeshPhysicalMaterial({ color: 0xf1f1ec, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
      carbon_black: S({ color: 0xffffff, map: weave, roughness: 0.5, metalness: 0.25 }),
      titanium: S({ color: 0x9ea4ab, roughness: 0.32, metalness: 1 }),
      copper: S({ color: 0xc07a45, roughness: 0.3, metalness: 1 }),
      nozzle_dark: S({ color: 0x2b2725, roughness: 0.55, metalness: 0.75, side: THREE.DoubleSide }),
      seam_gray: S({ color: 0x8a8e93, roughness: 0.5, metalness: 0.4 }),
      accent_red: S({ color: 0xec3013, roughness: 0.48, metalness: 0 }),
      decal: S({ map: decal, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }),
      gold_mli: S({ color: 0xd6a63c, roughness: 0.34, metalness: 1, bumpMap: crinkle, bumpScale: 0.02 }),
      silver_mli: S({ color: 0xc9cdd3, roughness: 0.28, metalness: 1, bumpMap: crinkle, bumpScale: 0.015 }),
      dish_white: S({ color: 0xf3f3ef, roughness: 0.6, metalness: 0, side: THREE.DoubleSide }),
      radiator_white: S({ color: 0xe7e9ed, roughness: 0.75 }),
      optics_glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1a2c, roughness: 0.04, metalness: 0.1, clearcoat: 1, envMapIntensity: 2 }),
      fairing_liner: S({ color: 0xd8d4c8, roughness: 0.9, side: THREE.DoubleSide }),
      solar_cell: S({ map: cells, roughness: 0.25, metalness: 0.55, side: THREE.DoubleSide }),
      _default: S({ color: 0xaaaaaa, roughness: 0.5, metalness: 0.5 })
    });
  }

  // ---------- Shaders (with logarithmic depth support) ----------

  const LOG_V = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
  const LOG_F = '#include <common>\n#include <logdepthbuf_pars_fragment>\n';

  // Exhaust plume. Geometry is a unit tube (y from 0 down to -1); the shader pins the base to the
  // nozzle exit radius (uR0) and only widens the tail (uSpread), so the plume always meets the nozzle.
  function flameMaterial(core, mid, edge) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uR0: { value: 0.2 }, uSpread: { value: 2 }, uLen: { value: 6 }, uFall: { value: 1.6 }, uDiamond: { value: 0 },
        uCore: { value: new THREE.Color(core) }, uMid: { value: new THREE.Color(mid) }, uEdge: { value: new THREE.Color(edge) } },
      vertexShader: LOG_V + `uniform float uR0; uniform float uSpread; uniform float uLen; uniform float uTime;
        varying float vAlong; varying vec3 vN; varying vec3 vV;
        void main(){
          float along = clamp(-position.y, 0.0, 1.0);
          float r = uR0 * mix(1.0, uSpread, pow(along, 0.65));
          r *= 1.0 + 0.05 * sin(along * 28.0 - uTime * 37.0) * along;
          vec3 p = vec3(position.x * r, position.y * uLen, position.z * r);
          vAlong = along;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vN = normalize(normalMatrix * vec3(position.x, 0.0, position.z));
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOG_F + `uniform float uTime; uniform float uPower; uniform float uFall; uniform float uDiamond; uniform vec3 uCore; uniform vec3 uMid; uniform vec3 uEdge;
        varying float vAlong; varying vec3 vN; varying vec3 vV;
        void main(){
          #include <logdepthbuf_fragment>
          float soft = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
          float flick = 0.86 + 0.14 * sin(uTime * 53.0 + vAlong * 25.0) * sin(uTime * 29.0 + vAlong * 11.0);
          float a = pow(1.0 - vAlong, uFall) * soft * uPower * flick;
          float diamonds = uDiamond * pow(0.5 + 0.5 * cos(vAlong * 52.0), 10.0) * (1.0 - vAlong) * soft;
          vec3 c = mix(uCore, uMid, smoothstep(0.0, 0.3, vAlong));
          c = mix(c, uEdge, smoothstep(0.3, 0.85, vAlong));
          c += vec3(1.0, 0.9, 0.7) * diamonds;
          gl_FragColor = vec4(c, clamp(a + diamonds * uPower * 0.6, 0.0, 1.0) * 0.85);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
  }

  function setU(mesh, vals) { const u = mesh.material.uniforms; for (const k in vals) u[k].value = vals[k]; }

  function particleMaterial(additive) {
    return new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: LOG_V + `attribute float size; attribute float alpha; attribute vec3 tint; varying float vA; varying vec3 vT;
        uniform float uScale;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; vA = alpha; vT = tint;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOG_F + `varying float vA; varying vec3 vT;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 c = gl_PointCoord - 0.5; float d = length(c);
          float a = smoothstep(0.5, 0.05, d) * vA;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vT, a);
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
  }

  function particles(count, additive) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(count), 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(count), 1));
    g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const pts = new THREE.Points(g, particleMaterial(additive));
    pts.frustumCulled = false;
    pts.userData.count = count;
    return pts;
  }

  // ---------- Scene ----------

  let renderer, scene, world, camMain, cams = [], controls, sun, hemi, padLight, skyMesh, starPts;
  let earthMesh, earthClouds, atmoMesh, capMesh, cloudSprites = [], tower, towerPivot;
  let smokePts, trailPts, fireballPts, boomSmokePts, debrisMesh, splashPts, sparkPts, groundFirePts, shockRing, shockSphere, flashSprite;
  let M = null; // model parts
  const EARTH = { day: null, clouds: null };
  let ready = false, building = null;
  let host = null, labelsEl = null;
  let flight = null, T = -10, P = 0, playing = false, mode = 'cinematic', lastNow = 0, raf = 0;
  let hooks = {};
  let freeMag = null;   // free camera currently circling Earth (finale) instead of the rocket
  let tmpV, tmpV2, tmpQ; // created in build(), so this file loads even if three.js is missing

  function build() {
    tmpV = new THREE.Vector3(); tmpV2 = new THREE.Vector3(); tmpQ = new THREE.Quaternion();
    rocketW = new THREE.Vector3(); localUp = new THREE.Vector3(); axis = new THREE.Vector3();
    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    scene.fog = new THREE.FogExp2(0xb9d3ea, 0);

    camMain = new THREE.PerspectiveCamera(40, 1, 0.05, 6e8);
    for (let i = 0; i < 4; i++) cams.push(new THREE.PerspectiveCamera(50, 1, 0.05, 3e7));
    controls = new THREE.OrbitControls(camMain, renderer.domElement);
    controls.enabled = false; controls.enableDamping = true; controls.minDistance = 4; controls.maxDistance = 4e5;
    const grab = () => {
      if (mode !== 'cinematic' || !flight || !host) return;
      mode = 'free'; freeMag = null; controls.enabled = true;
      camMain.fov = 45; camMain.updateProjectionMatrix();
      hooks.onMode && hooks.onMode('free');
    };
    // capture phase, so the same drag that grabs the camera also moves it
    renderer.domElement.addEventListener('pointerdown', grab, true);
    renderer.domElement.addEventListener('wheel', grab, true);

    // Lights
    sun = new THREE.DirectionalLight(0xfff3df, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 400 });
    sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);
    hemi = new THREE.HemisphereLight(0xcfe3ff, 0x8a7a5c, 0.6);
    scene.add(hemi);

    // Sky dome and stars (follow the camera)
    skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uUp: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position,0.0)).xyz); gl_Position = projectionMatrix * viewMatrix * vec4((modelMatrix*vec4(position,1.0)).xyz,1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uUp; varying vec3 vDir;
        void main(){ float h = dot(normalize(vDir), uUp); float t = pow(clamp(h,0.0,1.0), 0.45);
          vec3 c = mix(uHor, uTop, t); if (h < 0.0) c = mix(uHor, uHor*0.55, clamp(-h*3.0,0.0,1.0)); gl_FragColor = vec4(c,1.0); }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
    }));
    skyMesh.renderOrder = -10; skyMesh.frustumCulled = false; skyMesh.scale.setScalar(1000);
    scene.add(skyMesh);
    const sg = new THREE.BufferGeometry(), sp = [];
    for (let i = 0; i < 2500; i++) {
      const u = hash(i) * 2 - 1, th = hash(i + 7) * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      sp.push(rr * Math.cos(th) * 900, u * 900, rr * Math.sin(th) * 900);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    starPts = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
    starPts.renderOrder = -9; starPts.frustumCulled = false;
    scene.add(starPts);

    world = new THREE.Group();
    scene.add(world);

    // Earth: real day map and clouds when available, procedural otherwise
    let [landTex, cloudTexE] = earthTextures();
    EARTH.cloudMap = cloudTexE;
    if (window.EARTH_DAY) {
      const loader = new THREE.TextureLoader();
      EARTH.day = loader.load(window.EARTH_DAY); EARTH.day.encoding = THREE.sRGBEncoding; EARTH.day.anisotropy = 8;
      landTex = EARTH.day;
    }
    earthMesh = new THREE.Mesh(new THREE.SphereGeometry(R - 25, 256, 128), new THREE.MeshStandardMaterial({ map: landTex, roughness: 0.92, metalness: 0 }));
    earthMesh.position.set(0, -R, 0);
    earthMesh.rotation.z = Math.PI / 2;
    world.add(earthMesh);
    earthClouds = new THREE.Mesh(new THREE.SphereGeometry(R + 7 * KM, 128, 64), EARTH.clouds
      ? new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: EARTH.clouds, transparent: true, depthWrite: false, roughness: 1 })
      : new THREE.MeshStandardMaterial({ map: cloudTexE, transparent: true, depthWrite: false, roughness: 1 }));
    earthClouds.position.copy(earthMesh.position); earthClouds.rotation.z = Math.PI / 2 + 0.3;
    world.add(earthClouds);
    atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.018, 128, 64), new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: LOG_V + `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
      }`,
      fragmentShader: LOG_F + `uniform float uOpacity; varying vec3 vN; varying vec3 vV; void main(){
        #include <logdepthbuf_fragment>
        float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(vec3(0.35,0.62,1.0), f * uOpacity); }`,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    atmoMesh.position.copy(earthMesh.position);
    world.add(atmoMesh);

    // Local ground: a spherical cap that follows Earth's curve, with planar texture coordinates
    // Positions are computed in double precision relative to the pad, so the ground does not flicker.
    const capTheta = GROUND_HALF / R, WS = 160, HS = 48, rad = R + 0.4;
    const capGeo = new THREE.SphereGeometry(1, WS, HS, 0, Math.PI * 2, 0, capTheta);
    const pos = capGeo.attributes.position, uv = capGeo.attributes.uv;
    let vi = 0;
    for (let iy = 0; iy <= HS; iy++) for (let ix = 0; ix <= WS; ix++) {
      const th = (iy / HS) * capTheta, ph = (ix / WS) * Math.PI * 2;
      const x = -rad * Math.cos(ph) * Math.sin(th), z = rad * Math.sin(ph) * Math.sin(th);
      const y = 0.4 * Math.cos(th) - 2 * R * Math.sin(th / 2) ** 2;
      pos.setXYZ(vi, x, y, z);
      uv.setXY(vi, 0.5 + x / (2 * GROUND_HALF), 0.5 - z / (2 * GROUND_HALF));
      vi++;
    }
    pos.needsUpdate = true;
    const gtex = groundTexture(); gtex.encoding = THREE.sRGBEncoding;
    capMesh = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.95, transparent: true, opacity: 1 }));
    capMesh.receiveShadow = true;
    world.add(capMesh);

    buildPad();
    buildClouds();

    smokePts = particles(520, false); world.add(smokePts);
    trailPts = particles(140, false); world.add(trailPts);
    fireballPts = particles(380, true); world.add(fireballPts);
    boomSmokePts = particles(340, false); world.add(boomSmokePts);
    sparkPts = particles(300, true); world.add(sparkPts);
    groundFirePts = particles(150, true); world.add(groundFirePts);
    shockRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 128), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    shockRing.visible = false; shockRing.frustumCulled = false; world.add(shockRing);
    shockSphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), fresnelMat(0xffc27a, 2.0, 1.3));
    shockSphere.visible = false; shockSphere.frustumCulled = false; world.add(shockSphere);
    flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex('rgba(255,250,235,1)', 'rgba(255,190,90,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    flashSprite.visible = false; world.add(flashSprite);
    splashPts = particles(120, false); world.add(splashPts);
    debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.4, 0.7), new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.7, metalness: 0.4, emissive: 0xff5a14, emissiveIntensity: 0 }), 90);
    debrisMesh.frustumCulled = false; debrisMesh.visible = false;
    world.add(debrisMesh);

    padLight = new THREE.PointLight(0xff9a3c, 0, 900, 2);
    scene.add(padLight);

    buildModel();
    buildSpaceFx();
    ready = true;
  }

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function buildPad() {
    const pad = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c2b29, roughness: 0.95 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8c9196, roughness: 0.5, metalness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeeede8, roughness: 0.7 });
    const red = new THREE.MeshStandardMaterial({ color: 0xec3013, roughness: 0.6 });
    const landMat = new THREE.MeshStandardMaterial({ color: 0x6f6a45, roughness: 1, flatShading: true, envMapIntensity: 0.25 });

    const disk = new THREE.Mesh(new THREE.CylinderGeometry(70, 72, 0.6, 64), concrete);
    disk.position.y = 0.3; disk.receiveShadow = true; pad.add(disk);
    pad.add(box(70, 0.2, 7, dark, 0, 0.55, 0)); // flame trench
    const mount = new THREE.Group();
    for (const [x, z] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) mount.add(box(1.1, PAD_TOP - 0.6, 1.1, steel, x, 0.6, z));
    mount.add(box(5.6, 0.5, 0.8, steel, 0, PAD_TOP - 0.5, -2.4), box(5.6, 0.5, 0.8, steel, 0, PAD_TOP - 0.5, 2.4));
    mount.add(box(0.8, 0.5, 4.0, steel, -2.4, PAD_TOP - 0.5, 0), box(0.8, 0.5, 4.0, steel, 2.4, PAD_TOP - 0.5, 0));
    pad.add(mount);

    // Support tower (tilts back before launch)
    towerPivot = new THREE.Group();
    towerPivot.position.set(-4.4, 0.6, 0);
    tower = new THREE.Group();
    const H = 31;
    tower.add(box(0.35, H, 0.35, steel, 0, 0, -0.9), box(0.35, H, 0.35, steel, 0, 0, 0.9), box(0.35, H, 0.35, steel, -1.4, 0, -0.9), box(0.35, H, 0.35, steel, -1.4, 0, 0.9));
    const braceGeo = new THREE.BoxGeometry(0.16, 2.3, 0.16);
    const braces = new THREE.InstancedMesh(braceGeo, steel, 60);
    const mtx = new THREE.Matrix4(); let bi = 0;
    for (let k = 0; k < 15; k++) {
      const y = 1 + k * 2;
      for (const [x, z, ax] of [[0, 0, 'x'], [-1.4, 0, 'x'], [-0.7, -0.9, 'z'], [-0.7, 0.9, 'z']]) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ax === 'x' ? (k % 2 ? 0.66 : -0.66) : 0, 0, ax === 'z' ? (k % 2 ? 0.9 : -0.9) : 0));
        mtx.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
        braces.setMatrixAt(bi++, mtx);
      }
    }
    braces.castShadow = true; tower.add(braces);
    tower.add(box(3.2, 0.3, 0.5, steel, 1.4, 20, 0), box(3.2, 0.3, 0.5, steel, 1.4, 27, 0));
    tower.add(box(0.5, 1.2, 2.4, red, -0.7, H, 0));
    towerPivot.add(tower);
    pad.add(towerPivot);

    // Lightning towers and wires
    const tops = [];
    for (const [x, z] of [[-26, -26], [26, -26], [-26, 26], [26, 26]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.7, 38, 8), steel);
      t.position.set(x, 19, z); t.castShadow = true; pad.add(t);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), steel);
      tip.position.set(x, 41, z); pad.add(tip);
      tops.push(new THREE.Vector3(x, 43, z));
    }
    const wire = new THREE.BufferGeometry().setFromPoints([tops[0], tops[1], tops[3], tops[2], tops[0], new THREE.Vector3(0, 46, 0), tops[3], new THREE.Vector3(0, 46, 0), tops[1], new THREE.Vector3(0, 46, 0), tops[2]]);
    pad.add(new THREE.Line(wire, new THREE.LineBasicMaterial({ color: 0x555555 })));

    // Buildings
    pad.add(box(34, 13, 18, white, -95, 0, 30));
    pad.add(box(14, 7, 10, white, 80, 0, 60), box(22, 5, 12, white, 120, 0, -20), box(9, 18, 9, white, 60, 0, 110));
    pad.add(box(6, 4, 30, concrete, -40, 0, -70));
    const tank = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 16), white); tank.position.set(40, 14, -60); tank.castShadow = true; pad.add(tank);
    for (const [x, z] of [[37, -63], [43, -63], [37, -57], [43, -57]]) pad.add(box(0.4, 10, 0.4, steel, x, 0, z));
    const road = new THREE.Mesh(new THREE.PlaneGeometry(8, 900), new THREE.MeshStandardMaterial({ color: 0x5b5a56, roughness: 1 }));
    road.rotation.x = -Math.PI / 2; road.position.set(-60, 0.15, 480); road.receiveShadow = true; pad.add(road);

    // Hills to the east
    for (let i = 0; i < 22; i++) {
      const r = 160 + hash(i) * 420, h = 30 + hash(i + 5) * 120;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9, 1), landMat);
      hill.position.set((hash(i + 2) - 0.5) * 5000, h / 2 - 4, 500 + hash(i + 8) * 3800);
      hill.rotation.y = hash(i + 4) * 6; hill.receiveShadow = true;
      pad.add(hill);
    }
    world.add(pad);
  }

  function buildClouds() {
    const tex = cloudTex();
    for (let i = 0; i < 90; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85, fog: true });
      const s = new THREE.Sprite(mat);
      const x = -2500 + hash(i + 40) * 14000, z = (hash(i + 60) - 0.5) * 9000, y = 1000 + hash(i + 80) * 700;
      s.position.set(x, y, z);
      const sc = 500 + hash(i + 90) * 900;
      s.scale.set(sc, sc * 0.45, 1);
      s.userData.baseOpacity = 0.85;
      cloudSprites.push(s); world.add(s);
    }
  }

  // ---------- Space effects: vapor cone, shock diamonds, wind, meteors, auroras, magnetosphere ----------

  const NORTH = () => new THREE.Vector3(-0.819, 0.574, 0).normalize();   // Earth's axis (pad at about 35\u00b0 N)
  let FX = null;

  function fresnelMat(color, power, strength) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOp: { value: 0 } },
      vertexShader: LOG_V + `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
      }`,
      fragmentShader: LOG_F + `uniform vec3 uColor; uniform float uOp; varying vec3 vN; varying vec3 vV; void main(){
        #include <logdepthbuf_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), ${power.toFixed(1)}); gl_FragColor = vec4(uColor, clamp(f * ${strength.toFixed(2)} * uOp, 0.0, 1.0)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
  }

  function buildSpaceFx() {
    FX = {};
    // Max-Q vapor cone around the upper body
    FX.vapor = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 3.4, 7, 48, 1, true), new THREE.ShaderMaterial({
      uniforms: { uOp: { value: 0 }, uTime: { value: 0 } },
      vertexShader: LOG_V + `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
      }`,
      fragmentShader: LOG_F + `uniform float uOp; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){
        #include <logdepthbuf_fragment>
        float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float streak = 0.6 + 0.4 * sin(vUv.x * 80.0 + uTime * 6.0);
        float a = uOp * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.7, vUv.y) * (0.35 + 0.65 * edge) * streak;
        gl_FragColor = vec4(vec3(1.0), a * 0.55); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    }));
    FX.vapor.position.set(0, 20.5, 0); FX.vapor.renderOrder = 9; FX.vapor.name = 'vapor_cone';
    M.model.add(FX.vapor);

    // Shock diamonds: five glowing ellipsoids in the plume
    FX.diamonds = [];
    const dMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), dMat);
      d.scale.set(0.22 - i * 0.02, 0.34, 0.22 - i * 0.02);
      d.position.set(0, -1.9 - i * 0.95, 0); d.renderOrder = 7; d.name = 'shock_diamond';
      M.model.add(d); FX.diamonds.push(d);
    }
    FX.dMat = dMat;

    // Wind over the nose cone: air flows down onto the tip and slides along the sides
    const N = 90;
    FX.windPos = new Float32Array(N * 6);
    FX.windSeeds = Array.from({ length: N }, (_, i) => ({ a: hash(i + 500) * Math.PI * 2, y: 19 + hash(i + 501) * 15, off: 0.08 + hash(i + 502) * 0.55, l: 0.6 + hash(i + 503) * 0.8 }));
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(FX.windPos, 3));
    FX.noseWind = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    FX.noseWind.frustumCulled = false; FX.noseWind.name = 'nose_wind';
    M.model.add(FX.noseWind);

    // Meteors (50-80 km): thin streaks across the sky, placed in front of the camera
    FX.meteors = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 0, 0, 0]), 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      l.frustumCulled = false; l.renderOrder = 4; scene.add(l); FX.meteors.push(l);
    }

    const center = new THREE.Vector3(0, -R, 0);
    const N0 = NORTH(), axisQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), N0);

    // Aurora ovals about 23\u00b0 from each pole
    FX.auroraMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, uOp: { value: 0 } },
      vertexShader: LOG_V + `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
        #include <logdepthbuf_vertex>
      }`,
      fragmentShader: LOG_F + `uniform float time; uniform float uOp; varying vec2 vUv; void main(){
        #include <logdepthbuf_fragment>
        float wave = .55 + .45 * sin(vUv.x * 90. + time * 1.3) * sin(vUv.x * 31. - time * .6);
        float a = pow(1. - vUv.y, 1.6) * smoothstep(0., .12, vUv.y) * wave;
        vec3 c = mix(vec3(.25, 1., .55), vec3(.75, .35, 1.), smoothstep(.35, 1., vUv.y));
        gl_FragColor = vec4(c * a * 1.3, a * uOp); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    FX.auroras = new THREE.Group(); FX.auroras.name = 'aurora_ovals';
    for (const sgn of [1, -1]) {
      const h = 250 * KM, rr = R * Math.sin(23 * Math.PI / 180);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, h, 256, 1, true), FX.auroraMat);
      ring.geometry.translate(0, h / 2, 0);
      ring.position.set(0, sgn * (R * Math.cos(23 * Math.PI / 180) + 100 * KM), 0);
      if (sgn < 0) ring.rotation.x = Math.PI;
      FX.auroras.add(ring);
    }
    FX.auroras.position.copy(center); FX.auroras.quaternion.copy(axisQ);
    world.add(FX.auroras);

    // Magnetosphere: dipole field lines r = L * RE * sin^2(theta), Van Allen belts, magnetopause
    FX.mag = new THREE.Group(); FX.mag.name = 'magnetosphere';
    FX.lineMat = new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const L of [1.5, 2.2, 3.2, 4.6, 6.5, 9]) for (let j = 0; j < 12; j++) {
      const phi = j / 12 * Math.PI * 2, th0 = Math.asin(Math.sqrt(1 / L)), pts = [];
      for (let i = 0; i <= 80; i++) {
        const th = th0 + (Math.PI - 2 * th0) * i / 80, r = L * R * Math.sin(th) ** 2;
        pts.push(new THREE.Vector3(r * Math.sin(th) * Math.cos(phi), r * Math.cos(th), r * Math.sin(th) * Math.sin(phi)));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), FX.lineMat); line.frustumCulled = false;
      FX.mag.add(line);
    }
    const belt = (L1, L2, color, name) => {
      const prof = [];
      const side = (L, rev) => { const th0 = Math.asin(Math.sqrt(1 / L)), arr = []; for (let i = 0; i <= 40; i++) { const th = th0 + (Math.PI - 2 * th0) * i / 40, r = L * R * Math.sin(th) ** 2; arr.push(new THREE.Vector2(r * Math.sin(th), r * Math.cos(th))); } return rev ? arr.reverse() : arr; };
      for (const v of side(L2, false)) prof.push(v);
      for (const v of side(L1, true)) prof.push(v);
      const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), fresnelMat(color, 2.0, 0.9)); m.name = name; m.frustumCulled = false;
      return m;
    };
    FX.inner = belt(1.2, 2.4, 0xff9a3c, 'van_allen_inner'); FX.outer = belt(3.2, 7, 0xb46bff, 'van_allen_outer');
    FX.mag.add(FX.inner, FX.outer);
    FX.mag.position.copy(center); FX.mag.quaternion.copy(axisQ);
    world.add(FX.mag);
    // Magnetopause teardrop: about 10 Earth radii toward the Sun, stretched into a tail
    const sunDir = new THREE.Vector3(0.45, 0.78, 0.43).normalize();
    const mp = new THREE.SphereGeometry(1, 96, 64), mpPos = mp.attributes.position;
    for (let i = 0; i < mpPos.count; i++) {
      const d = new THREE.Vector3(mpPos.getX(i), mpPos.getY(i), mpPos.getZ(i)).normalize();
      const r = Math.min(60, 10 * Math.pow(2 / (1 + d.dot(sunDir)), 0.6)) * R;
      mpPos.setXYZ(i, d.x * r, d.y * r, d.z * r);
    }
    mp.computeVertexNormals();
    FX.pause = new THREE.Mesh(mp, fresnelMat(0x6fb8ff, 3.0, 0.7)); FX.pause.name = 'magnetopause'; FX.pause.frustumCulled = false;
    FX.pause.position.copy(center);
    world.add(FX.pause);
    FX.magOn = 0; FX.magForced = false;
  }

  function updateSpaceFx(T, s, dt) {
    const now = performance.now() / 1000;
    const kmh = s.speed * 3600, km = s.alt;
    // vapor cone at Max-Q
    FX.vapor.visible = s.maxq > 0.03 && !s.lost && M.root.visible;
    FX.vapor.material.uniforms.uOp.value = s.maxq; FX.vapor.material.uniforms.uTime.value = now;
    // shock diamonds fade out by 30 km
    const dOn = s.s1 * (1 - clamp(km / 30, 0, 1));
    FX.diamonds.forEach((d, i) => { d.visible = dOn > 0.02 && M.s1.visible; });
    FX.dMat.opacity = dOn * (0.75 + 0.25 * Math.sin(now * 40));
    // wind over the nose cone
    const q = Math.pow(kmh / 1000, 2) * Math.exp(-km / 8.5), k = clamp(q / 1.1, 0, 1);
    FX.noseWind.visible = km < 85 && kmh > 60 && k > 0.01 && !s.fairing && !s.lost && mode !== 'sat';
    if (FX.noseWind.visible) {
      FX.noseWind.material.opacity = 0.18 + 0.55 * k;
      const vel = 6 + 30 * Math.min(1, kmh / 3000), len = 0.8 + 2.6 * Math.min(1, kmh / 3000);
      const noseR = (y) => y <= 26 ? 1.3 : 1.3 * Math.pow(Math.cos(Math.min(1, (y - 26) / 3.1) * Math.PI / 2), 0.72);
      FX.windSeeds.forEach((sd, i) => {
        sd.y -= vel * dt; if (sd.y < 19) { sd.y += 15; sd.a = hash(sd.a * 13 + now) * Math.PI * 2; }
        const pnt = (y) => { const r = noseR(y) + sd.off * (1 + Math.max(0, y - 28.4) * 0.9); return [Math.cos(sd.a) * r, y, Math.sin(sd.a) * r]; };
        FX.windPos.set([...pnt(sd.y), ...pnt(sd.y + len * sd.l)], i * 6);
      });
      FX.noseWind.geometry.attributes.position.needsUpdate = true;
    }
    // auroras glow once it is dark enough to see them
    FX.auroraMat.uniforms.time.value = now;
    FX.auroraMat.uniforms.uOp.value = smooth(80, 200, km);
    // magnetosphere: shown in the final pull-back, or when switched on
    const want = FX.magForced || ((mode === 'cinematic' || mode === 'free') && T >= 4400 && flight.Tend >= 4690);
    FX.magOn = clamp(FX.magOn + (want ? dt : -dt) * 0.8, 0, 1);
    FX.mag.visible = FX.pause.visible = FX.magOn > 0.01 && mode !== 'sat';
    FX.lineMat.opacity = 0.16 * FX.magOn;
    FX.inner.material.uniforms.uOp.value = FX.outer.material.uniforms.uOp.value = FX.magOn;
    FX.pause.material.uniforms.uOp.value = FX.magOn * 0.6;
  }

  function updateMeteors(cam, s) {
    const on = s.alt > 50 && s.alt < 80 && mode !== 'sat';
    const now = performance.now() / 1000;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize(), upv = new THREE.Vector3().crossVectors(right, fwd).normalize();
    FX.meteors.forEach((l, i) => {
      l.visible = on;
      if (!on) return;
      // size everything to the camera's zoom so streaks cross the visible sky in any shot
      const ph = (now * 0.55 + i * 0.27) % 1, D = 800, half = D * Math.tan((cam.fov * Math.PI) / 360);
      const base = cam.position.clone().add(fwd.clone().multiplyScalar(D));
      const x = (hash(i + 900 + Math.floor(now * 0.55 + i * 0.27)) - 0.5) * 1.6 * half * cam.aspect, y = half * (0.9 - ph * 1.8);
      const head = base.clone().add(right.clone().multiplyScalar(x + ph * half * 0.9)).add(upv.clone().multiplyScalar(y));
      const tail = head.clone().add(right.clone().multiplyScalar(-0.16 * half)).add(upv.clone().multiplyScalar(0.2 * half));
      const a = l.geometry.attributes.position; a.setXYZ(0, head.x, head.y, head.z); a.setXYZ(1, tail.x, tail.y, tail.z); a.needsUpdate = true;
      l.material.opacity = Math.sin(ph * Math.PI);
    });
  }

  // ---------- Model ----------

  function buildModel() {
    const MATS = makeMaterials();
    const loaded = new THREE.OBJLoader().parse(window.ORBITER_OBJ);
    const meshes = [];
    loaded.traverse(o => { if (o.isMesh) meshes.push(o); });

    const root = new THREE.Group();          // positioned on the trajectory each frame
    const sway = new THREE.Group();          // wobble and spin-out
    const model = new THREE.Group();
    model.position.y = 1.32;                 // engine exits sit on the root origin
    root.add(sway); sway.add(model);
    root.name = 'ORBITER-1';

    const pivot = (parent, p, name) => { const o = new THREE.Group(); o.name = name || ''; o.userData.origin = p.clone(); const po = parent.userData.origin || new THREE.Vector3(); o.position.copy(p).sub(po); parent.add(o); return o; };
    model.userData.origin = new THREE.Vector3();
    const put = (mesh, piv) => { mesh.position.copy(piv.userData.origin).negate(); piv.add(mesh); };

    const s1 = pivot(model, new THREE.Vector3(), 'stage_1');
    const s2 = pivot(model, new THREE.Vector3(), 'stage_2');
    const fairR = pivot(model, new THREE.Vector3(1.3, 21.4, 0), 'fairing_right');
    const fairL = pivot(model, new THREE.Vector3(-1.3, 21.4, 0), 'fairing_left');
    const satO = new THREE.Vector3(0, 23, 0);
    const sat = pivot(model, satO, 'ORBITER-1_satellite');
    const fins = { pz: pivot(s1, new THREE.Vector3(0, 15.42, 1.0), 'gridfin_pz'), nz: pivot(s1, new THREE.Vector3(0, 15.42, -1.0), 'gridfin_nz'),
      px: pivot(s1, new THREE.Vector3(1.0, 15.42, 0), 'gridfin_px'), nx: pivot(s1, new THREE.Vector3(-1.0, 15.42, 0), 'gridfin_nx') };
    const imagerPiv = pivot(sat, new THREE.Vector3(0, 22.8, 0.68), 'imaging_telescope');
    const bits = {};
    const dishPiv = pivot(sat, new THREE.Vector3(0, 24.0, 0.1), 'high_gain_antenna');
    const mastPiv = pivot(sat, new THREE.Vector3(0, 23.93, 0.1), 'antenna_mast');
    const boomPiv = pivot(sat, new THREE.Vector3(0, 23.8, -0.74), 'magnetometer_boom');

    const panels = { r: [], l: [] }, yokes = [], pins = [];
    for (const m of meshes) {
      const n = m.name;
      const mn = Array.isArray(m.material) ? m.material.map(x => x.name) : [m.material.name];
      const pick = (name) => MATS[n.startsWith('solar_panel') ? 'solar_cell' : name] || MATS._default;
      m.material = Array.isArray(m.material) ? mn.map(pick) : pick(mn[0]);
      m.castShadow = true; m.receiveShadow = true;
      m.geometry.computeBoundingBox();
      const c = m.geometry.boundingBox.getCenter(new THREE.Vector3());
      m.userData.c = c;

      if (/^gridfin_(frame|bar)/.test(n)) {
        const key = c.z > 0.8 ? 'pz' : c.z < -0.8 ? 'nz' : c.x > 0.8 ? 'px' : 'nx';
        put(m, fins[key]);
      } else if (/^(s1_|engine_|gridfin_|leg_)/.test(n)) put(m, s1);
      else if (/^(s2_|payload_adapter|separation_ring)/.test(n)) put(m, s2);
      else if (n.startsWith('fairing_')) put(m, c.x > 0 ? fairR : fairL);
      else if (n.startsWith('solar_panel')) { const p = pivot(sat, c, n); put(m, p); (c.x > 0 ? panels.r : panels.l).push({ piv: p, c }); }
      else if (n.startsWith('wing_yoke')) { const p = pivot(sat, c, n); put(m, p); yokes.push({ piv: p, c }); }
      else if (n.startsWith('hinge_pin')) pins.push(m);
      else if (/^dish_/.test(n)) put(m, dishPiv);
      else if (/^mast_tube/.test(n)) put(m, mastPiv);
      else if (/^(boom_rod|magnetometer)/.test(n)) put(m, boomPiv);
      else if (/^imager_/.test(n)) put(m, imagerPiv);
      else put(m, sat);
      const bk = n.match(/^(sat_engine|omni_whip|wing_drive|mast_base|boom_hinge)/);
      if (bk) (bits[bk[1]] = bits[bk[1]] || []).push(m);
    }
    panels.r.sort((a, b) => a.c.x - b.c.x);
    panels.l.sort((a, b) => b.c.x - a.c.x);
    for (const pin of pins) {
      const c = pin.userData.c;
      let best = null, bd = 1e9;
      for (const p of panels.r.concat(panels.l)) { const d = p.c.distanceTo(c); if (d < bd) { bd = d; best = p; } }
      put(pin, best.piv);
    }

    // Engine plumes: each starts exactly at its nozzle exit
    const plumeGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 24, true); plumeGeo.translate(0, -0.5, 0);
    const s1Flames = [];
    const flameMat = flameMaterial(0xfff2cf, 0xffa63d, 0xd9471c), coreMat = flameMaterial(0xffffff, 0xfff4d6, 0xffc266);
    for (const m of meshes) if (m.name.startsWith('engine_bell')) {
      const c = m.userData.c;
      const f = new THREE.Mesh(plumeGeo, flameMat); f.position.set(c.x, -1.31, c.z); f.frustumCulled = false; f.renderOrder = 5;
      const k = new THREE.Mesh(plumeGeo, coreMat); k.position.set(c.x, -1.31, c.z); k.frustumCulled = false; k.renderOrder = 6;
      model.add(f, k); s1Flames.push(f, k);
    }
    const s2Flame = new THREE.Mesh(plumeGeo, flameMaterial(0xf4f8ff, 0xa9c8ff, 0x5b7fe0));
    const s2Core = new THREE.Mesh(plumeGeo, flameMaterial(0xffffff, 0xe3ecff, 0x9cc2ff));
    for (const fm of [s2Flame, s2Core]) { fm.position.set(0, 15.08, 0); fm.frustumCulled = false; fm.renderOrder = 5; s2.add(fm); }
    // Reentry: glowing plasma around the leading end, sparks and wind streaks
    const reFire = new THREE.Mesh(plumeGeo, flameMaterial(0xfff1c2, 0xff7a2a, 0xe0244f));
    const reGlow = new THREE.Mesh(plumeGeo, flameMaterial(0xffffff, 0xffd08a, 0xff8a3d));
    for (const fm of [reFire, reGlow]) { fm.rotation.x = Math.PI; fm.frustumCulled = false; fm.renderOrder = 7; fm.visible = false; model.add(fm); }
    const sparks = particles(180, true), wind = particles(140, false);
    model.add(sparks, wind);

    M = { root, sway, model, s1, s2, fairL, fairR, sat, satO, fins, dishPiv, mastPiv, boomPiv, imagerPiv, bits, MATS, panels, yokes,
      s1Flames, flameMat, coreMat, s2Flame, s2Core, reFire, reGlow, sparks, wind, radar: [], extra: null, dmg: {} };
    // remember stowed transforms
    for (const list of [panels.r, panels.l, yokes]) for (const p of list) { p.p0 = p.piv.position.clone(); }
    M.dish0 = dishPiv.position.clone();
    scene.add(root);
  }

  function applyDeploy(arr, ant) {
    const { panels, yokes } = M;
    const dmg = M.dmg || {};
    for (const [side, list] of [[1, panels.r], [-1, panels.l]]) {
      const A = side === 1 && dmg.halfWing ? Math.min(arr, 0.33) : arr;   // a jammed wing stays half open
      list.forEach((p, i) => {
        const q = smooth(0, 1, A * 1.5 - i * 0.16);
        const target = new THREE.Vector3(side * (1.28 + 1.05 * (i + 0.5)), 23.0, 0).sub(M.satO);
        p.piv.position.lerpVectors(p.p0, target, q);
        p.piv.rotation.set(0, (i % 2 ? 1 : -1) * side * (Math.PI / 2) * q, 0);
      });
    }
    for (const y of yokes) {
      const side = y.c.x > 0 ? 1 : -1;
      const q = smooth(0, 0.5, arr);
      const target = new THREE.Vector3(side * 1.0, y.c.y, 0).sub(M.satO);
      y.piv.position.lerpVectors(y.p0, target, q);
      y.piv.rotation.set(0, side * (Math.PI / 2) * q, 0);
      y.piv.scale.set(1, 1, 1 + 2 * q);
    }
    const antD = dmg.dishStuck ? 0 : ant;                                  // a stuck dish never rises
    const a = smooth(0, 0.6, antD), bd = smooth(0.4, 1, antD), b = smooth(0.4, 1, ant);
    M.mastPiv.scale.set(1, 1 + 11 * a, 1);
    M.dishPiv.position.copy(M.dish0).add(new THREE.Vector3(0, 1.1 * a, 0));
    M.dishPiv.rotation.set(-0.45 * bd, 0, 0);
    M.boomPiv.rotation.set((Math.PI / 2) * b, 0, 0);
    for (const r of M.radar) { r.rotation.set(0, 0, r.userData.side * (Math.PI / 2 - 0.25) * b); r.scale.set(1, 0.35 + 2.45 * b, 1); }
    if (M.karin) M.karin.scale.set(1, 1, 0.24 + 0.76 * smooth(0, 1, arr));
  }

  // ---------- Your spacecraft on the 3D satellite ----------

  function applyBuild(b, dmg) {
    if (!M) return;
    M.dmg = dmg || {};
    const n = b ? { none: 0, small: 1, medium: 2, large: 3, giant: 4 }[b.solar] : 4;
    for (const list of [M.panels.r, M.panels.l]) list.forEach((p, i) => { p.piv.visible = i < n; });
    M.yokes.forEach(y => { y.piv.visible = n > 0; });
    (M.bits.wing_drive || []).forEach(m => { m.visible = n > 0; });
    const ant = b ? b.antenna : 'hga';
    M.dishPiv.visible = M.mastPiv.visible = ant !== 'lga';
    (M.bits.mast_base || []).forEach(m => { m.visible = ant !== 'lga'; });
    M.dishPiv.scale.setScalar({ lga: 1, mga: 0.6, hga: 1, hga4: 1.6 }[ant]);
    const inst = b ? b.instruments : ['camera', 'magnetometer'];
    const hasCam = inst.includes('camera'), hasHi = inst.includes('hires');
    M.imagerPiv.visible = hasCam || hasHi;
    M.imagerPiv.scale.setScalar(hasHi ? 1.22 : 1);   // bigger telescope, still fits inside the fairing
    M.boomPiv.visible = inst.includes('magnetometer');
    (M.bits.boom_hinge || []).forEach(m => { m.visible = M.boomPiv.visible; });
    (M.bits.sat_engine || []).forEach(m => { m.visible = !b || b.engine !== 'none'; });
    M.sat.scale.setScalar(b ? { small: 0.85, medium: 1, large: 1.15 }[b.bus] : 1);
    if (M.extra) M.sat.remove(M.extra);
    M.radar = []; M.karin = null;
    M.extra = buildExtras(b, inst);
    M.sat.add(M.extra);
    // instruments that stopped working look scorched
    const lost = (M.dmg.lost || []);
    const scorch = (obj) => obj.traverse(o => { if (o.isMesh) { o.userData.mat0 = o.userData.mat0 || o.material; o.material = M.burnt; } });
    const restore = (obj) => obj.traverse(o => { if (o.isMesh && o.userData.mat0) o.material = o.userData.mat0; });
    if (!M.burnt) M.burnt = new THREE.MeshStandardMaterial({ color: 0x2a1c16, roughness: 0.9, metalness: 0.2 });
    ((lost.includes('camera') || lost.includes('hires')) ? scorch : restore)(M.imagerPiv);
    (lost.includes('magnetometer') ? scorch : restore)(M.boomPiv);
    M.extra.traverse(o => { if (o.userData.inst && lost.includes(o.userData.inst)) scorch(o); });
  }

  function buildExtras(b, inst) {
    const g = new THREE.Group(); g.name = 'selected_parts';
    if (!b) return g;
    const MAT = M.MATS;
    const at = (x, y, z) => new THREE.Vector3(x, y - 23, z);
    const add = (geo, mat, p, name, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.copy(p); m.name = name; m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
    const dark = new THREE.MeshStandardMaterial({ color: 0x34373c, roughness: 0.45, metalness: 0.8 });
    // RTGs (nuclear power) on short struts at the bottom corners
    const corners = [[-1, -1], [1, -1], [-1, 1]];
    for (let i = 0; i < b.rtg; i++) {
      const [cx, cz] = corners[i];
      const dir = new THREE.Vector3(cx, -0.35, cz).normalize();
      const base = at(cx * 0.55, 22.2, cz * 0.55);
      const rtg = new THREE.Group(); rtg.name = 'RTG_' + (i + 1);
      add(new THREE.CylinderGeometry(0.085, 0.085, 0.4, 20), dark, new THREE.Vector3(), 'rtg_body', rtg);
      for (let k = 0; k < 6; k++) {
        const ang = (k * Math.PI) / 3;
        const fin = add(new THREE.BoxGeometry(0.09, 0.34, 0.018), dark, new THREE.Vector3(Math.cos(ang) * 0.12, 0, Math.sin(ang) * 0.12), 'rtg_fin', rtg);
        fin.rotation.y = -ang;
      }
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16), MAT.copper, new THREE.Vector3(0, 0.22, 0), 'rtg_cap', rtg);
      rtg.position.copy(base).add(dir.clone().multiplyScalar(0.3));
      rtg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(rtg);
      const strut = add(new THREE.CylinderGeometry(0.014, 0.014, 0.14, 8), MAT.titanium, base.clone().add(dir.clone().multiplyScalar(0.07)), 'rtg_strut');
      strut.quaternion.copy(rtg.quaternion);
    }
    // Ice-penetrating radar: two long antennas that swing out when the satellite deploys
    if (inst.includes('radar')) for (const side of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.copy(at(side * 0.3, 22.12, -0.45)); piv.name = 'radar_antenna'; piv.userData.side = side; piv.userData.inst = 'radar';
      add(new THREE.CylinderGeometry(0.013, 0.013, 1, 8), MAT.titanium, new THREE.Vector3(0, -0.5, 0), 'radar_element', piv);
      g.add(piv); M.radar.push(piv);
    }
    // Radar altimeter (like SWOT's KaRIn): a long boom with an antenna at each end, unfolds at deploy
    if (inst.includes('altimeter')) {
      const k = new THREE.Group(); k.position.copy(at(0, 22.05, 0)); k.name = 'radar_altimeter'; k.userData.inst = 'altimeter';
      const boom = add(new THREE.CylinderGeometry(0.035, 0.035, 5, 12), MAT.carbon_black, new THREE.Vector3(), 'altimeter_boom', k);
      boom.rotation.x = Math.PI / 2;
      for (const z of [-2.5, 2.5]) add(new THREE.BoxGeometry(0.95, 0.1, 0.38), MAT.dish_white, new THREE.Vector3(0, -0.05, z), 'altimeter_antenna', k);
      g.add(k); M.karin = k;
    } else M.karin = null;
    if (inst.includes('gps')) {
      const d = add(new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.white_paint, at(0.05, 23.93, -0.25), 'precise_orbit_receiver');
      d.userData.inst = 'gps';
    }
    if (inst.includes('irspec')) {
      const box = new THREE.Group(); box.name = 'infrared_spectrometer'; box.userData.inst = 'irspec';
      add(new THREE.BoxGeometry(0.24, 0.2, 0.18), MAT.silver_mli, at(-0.42, 23.45, 0.76), 'irspec_body', box);
      const ap = add(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 20), MAT.optics_glass, at(-0.42, 23.45, 0.86), 'irspec_aperture', box);
      ap.rotation.x = Math.PI / 2;
      g.add(box);
    }
    if (inst.includes('radiometer')) {
      const r = new THREE.Group(); r.name = 'microwave_radiometer'; r.userData.inst = 'radiometer';
      add(new THREE.CylinderGeometry(0.15, 0.15, 0.07, 24), MAT.gold_mli, at(0.36, 23.97, 0.36), 'radiometer_base', r);
      add(new THREE.CylinderGeometry(0.18, 0.06, 0.09, 24, 1, true), MAT.dish_white, at(0.36, 24.05, 0.36), 'radiometer_horn', r);
      g.add(r);
    }
    if (inst.includes('particle')) {
      const pd = new THREE.Group(); pd.name = 'particle_detector'; pd.userData.inst = 'particle';
      add(new THREE.BoxGeometry(0.14, 0.12, 0.14), MAT.titanium, at(-0.38, 23.99, 0.38), 'particle_body', pd);
      add(new THREE.ConeGeometry(0.06, 0.09, 16, 1, true), MAT.nozzle_dark, at(-0.38, 24.09, 0.38), 'particle_aperture', pd);
      g.add(pd);
    }
    if (inst.includes('camera') && inst.includes('hires')) {
      const c = new THREE.Group(); c.name = 'wide_angle_camera'; c.userData.inst = 'camera';
      add(new THREE.BoxGeometry(0.15, 0.15, 0.12), MAT.white_paint, at(0.44, 22.5, 0.74), 'camera_body', c);
      const lens = add(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 16), MAT.optics_glass, at(0.44, 22.5, 0.81), 'camera_lens', c);
      lens.rotation.x = Math.PI / 2;
      g.add(c);
    }
    return g;
  }

  // ---------- Per-frame update ----------

  function worldPos(alt, down, out, lat = 0) {
    const phi = (down * KM) / R;
    const r = R + PAD_TOP + alt * KM;
    return out.set(Math.sin(phi) * r, Math.cos(phi) * r - R, lat * KM);
  }
  const upAt = (down, out) => { const phi = (down * KM) / R; return out.set(Math.sin(phi), Math.cos(phi), 0); };

  function skyColors(alt) {
    const top = new THREE.Color(), hor = new THREE.Color();
    const SKY = [[0, 0x8fbbe8], [15, 0x3d6fb4], [40, 0x0f2350], [80, 0x020409]];
    let i = 0; while (i < SKY.length - 2 && alt > SKY[i + 1][0]) i++;
    const [a0, ca] = SKY[i], [b0, cb] = SKY[i + 1];
    top.set(ca).lerp(new THREE.Color(cb), clamp((alt - a0) / (b0 - a0), 0, 1));
    hor.copy(top).lerp(new THREE.Color(0xd6e6f5), 0.55 * (1 - clamp(alt / 60, 0, 1))).lerp(new THREE.Color(0x2a4a80), clamp((alt - 40) / 60, 0, 1) * 0.35);
    return { top, hor, dark: clamp((alt - 40) / 30, 0, 1) };
  }

  let rocketW, localUp, axis;

  function update(T) {
    const f = flight, s = stateAt(f, T);
    worldPos(s.alt, s.down, rocketW, s.lat);
    upAt(s.down, localUp);
    const phi = (s.down * KM) / R;

    // Floating origin: the rocket stays near (0,0,0); the world moves around it
    world.position.copy(rocketW).negate();
    M.root.position.set(0, 0, 0);
    M.root.rotation.set(0, 0, -(phi + s.pitch));
    M.sway.rotation.set(s.swayX, 0, s.swayZ);
    axis.set(0, 1, 0).applyEuler(M.root.rotation);

    const lost = s.lost && s.boomDt !== undefined;
    M.root.visible = !(lost && s.boomDt > 0.15) && !(s.splash > 0);

    // Stages
    const sepDt = T - 138;
    if (s.sep && sepDt > 0) {
      const d = 2.2 * sepDt + 0.9 * sepDt * sepDt;
      M.s1.position.set(0, -d, 0); M.s1.rotation.set(0.0015 * sepDt * sepDt, 0, 0.002 * sepDt * sepDt);
      M.s1.visible = d < 900;
      const fin = smooth(3, 8, sepDt) * Math.PI / 2;
      M.fins.pz.rotation.set(fin, 0, 0); M.fins.nz.rotation.set(-fin, 0, 0);
      M.fins.px.rotation.set(0, 0, -fin); M.fins.nx.rotation.set(0, 0, fin);
    } else {
      M.s1.position.set(0, 0, 0); M.s1.rotation.set(0, 0, 0); M.s1.visible = true;
      for (const k in M.fins) M.fins[k].rotation.set(0, 0, 0);
    }
    const fDt = T - 180;
    if (s.fairing && fDt > 0) {
      const o = smooth(0, 3, fDt) * 0.9 + fDt * 0.02;
      M.fairR.rotation.set(0, 0, -o); M.fairL.rotation.set(0, 0, o);
      const dr = Math.max(0, fDt - 2) * 1.8 + Math.max(0, fDt - 2) ** 2 * 0.25;
      M.fairR.position.set(1.3 + dr, 21.4 - dr * 0.6, 0); M.fairL.position.set(-1.3 - dr, 21.4 - dr * 0.6, 0);
      M.fairR.visible = M.fairL.visible = dr < 600;
    } else {
      M.fairR.rotation.set(0, 0, 0); M.fairL.rotation.set(0, 0, 0);
      M.fairR.position.set(1.3, 21.4, 0); M.fairL.position.set(-1.3, 21.4, 0);
      M.fairR.visible = M.fairL.visible = true;
    }
    const sDt = T - 3119;
    if (s.satSep && sDt > 0) {
      M.sat.position.set(0, 23 + 0.035 * sDt, 0).add(new THREE.Vector3(0, 0, 0));
      M.sat.rotation.set(0, sDt * 0.0009, 0);
      M.s2.position.set(0, -0.02 * sDt, 0);
      M.s2.visible = sDt < 900;
    } else {
      M.sat.position.copy(M.satO); M.sat.rotation.set(0, 0, 0);
      M.s2.position.set(0, 0, 0); M.s2.visible = true;
    }
    applyDeploy(s.arrays, s.antenna);

    // Flames
    const now = performance.now() / 1000;
    const vac = clamp(s.alt / 45, 0, 1);
    const thr = 0.6 + 0.4 * s.s1;
    const gim = 2.4 * (s.gimbal || 0);                 // engines swivel against the sway
    for (const fl of M.s1Flames) {
      fl.visible = s.s1 > 0.01 && M.s1.visible;
      fl.rotation.set(-s.swayX * gim, 0, -s.swayZ * gim);
    }
    setU(M.s1Flames[0], { uR0: 0.19, uSpread: 1.5 + vac * 5.5, uLen: (4.5 + vac * 14) * thr, uPower: s.s1 * (0.75 - vac * 0.35), uFall: 1.3 + vac * 0.6, uTime: now });
    setU(M.s1Flames[1], { uR0: 0.15, uSpread: 0.55 + vac * 0.9, uLen: (2.2 + vac * 2) * thr, uPower: s.s1 * 0.95, uFall: 1.8, uTime: now, uDiamond: 0 });
    M.s2Flame.visible = M.s2Core.visible = s.s2 > 0.01;
    setU(M.s2Flame, { uR0: 0.78, uSpread: 1.25 + vac * 2.2, uLen: 8 + vac * 10, uPower: s.s2 * 0.5, uFall: 1.2, uTime: now });
    setU(M.s2Core, { uR0: 0.55, uSpread: 0.35, uLen: 3, uPower: s.s2 * 0.8, uFall: 2.0, uTime: now });

    // Reentry fire and wind (only when a stage falls back)
    const heat = s.heat || 0, windAmt = s.wind || 0;
    const attachY = s.sep && T > 138 ? 15.0 : -1.32;
    M.reFire.position.set(0, attachY, 0); M.reGlow.position.set(0, attachY, 0);
    M.reFire.visible = M.reGlow.visible = heat > 0.02;
    setU(M.reFire, { uR0: 1.05, uSpread: 1.9, uLen: 5 + 22 * heat, uPower: heat, uFall: 1.1, uTime: now });
    setU(M.reGlow, { uR0: 1.0, uSpread: 1.25, uLen: 2.5 + 3 * heat, uPower: heat * 0.9, uFall: 1.6, uTime: now });
    updateStreaks(heat, windAmt, attachY, now);

    // Tower tilts back during the countdown
    towerPivot.rotation.z = smooth(-9.5, -5, T) * 0.32;

    // Sky, fog, light
    const sky = skyColors(s.alt);
    skyMesh.material.uniforms.uTop.value.copy(sky.top);
    skyMesh.material.uniforms.uHor.value.copy(sky.hor);
    skyMesh.material.uniforms.uUp.value.copy(localUp);
    starPts.material.opacity = sky.dark;
    scene.fog.color.copy(sky.hor);
    scene.fog.density = 1 / (14 * KM) * (1 - clamp(s.alt / 30, 0, 1));
    hemi.intensity = 0.6 * (1 - sky.dark * 0.75);
    capMesh.material.opacity = 1 - smooth(8, 40, s.alt);
    capMesh.visible = capMesh.material.opacity > 0.01;
    atmoMesh.material.uniforms.uOpacity.value = smooth(15, 60, s.alt) * 1.4;
    earthClouds.material.opacity = smooth(5, 25, s.alt);
    for (const c of cloudSprites) c.material.opacity = c.userData.baseOpacity * (1 - smooth(6, 14, s.alt));

    const sunDir = tmpV.set(0.45, 0.78, 0.43).normalize();
    sun.position.copy(sunDir).multiplyScalar(150);
    sun.target.position.set(0, 0, 0);
    sun.position.add(axis.clone().multiplyScalar(14)); sun.target.position.add(axis.clone().multiplyScalar(14));

    padLight.intensity = s.s1 > 0 && s.alt < 1.2 ? s.s1 * 4 * (1 - s.alt / 1.2) : 0;
    padLight.position.copy(axis).multiplyScalar(-4);

    updateSpaceFx(T, s, Math.min(0.1, Math.max(0, performance.now() / 1000 - (update.last || 0))));
    update.last = performance.now() / 1000;
    updateSmoke(T, s);
    updateTrail(T, s);
    updateExplosion(s);
    updateSplash(s);
    return s;
  }

  function updateStreaks(heat, windAmt, y0, now) {
    const sp = M.sparks, wd = M.wind;
    sp.visible = heat > 0.02; wd.visible = windAmt > 0.03;
    if (sp.visible) {
      for (let i = 0; i < sp.userData.count; i++) {
        const ph = (hash(i) + now * (0.9 + hash(i + 1))) % 1, ang = hash(i + 2) * 6.283;
        const rr = 0.9 + ph * (1.5 + hash(i + 3) * 3.5) * (0.5 + heat);
        setPts(sp, i, Math.cos(ang) * rr, y0 + ph * (10 + hash(i + 4) * 30 * heat), Math.sin(ang) * rr, 0.25 + hash(i + 5) * 0.5, heat * (1 - ph) * 1.2, 1, 0.45 + 0.3 * hash(i + 6), 0.15);
      }
      flush(sp);
    }
    if (wd.visible) {
      for (let i = 0; i < wd.userData.count; i++) {
        const ph = (hash(i + 40) + now * (1.3 + hash(i + 41) * 0.8)) % 1, ang = hash(i + 42) * 6.283;
        const rr = 1.1 + ph * (2 + hash(i + 43) * 2);
        setPts(wd, i, Math.cos(ang) * rr, y0 + 2 + ph * (26 + hash(i + 44) * 20), Math.sin(ang) * rr, 0.6 + ph * 2.2, windAmt * 0.45 * (1 - ph) * Math.min(1, ph * 4), 0.92, 0.93, 0.96);
      }
      flush(wd);
    }
  }

  function setPts(pts, i, x, y, z, size, alpha, r, g, b) {
    const a = pts.geometry.attributes;
    a.position.setXYZ(i, x, y, z); a.size.setX(i, size); a.alpha.setX(i, alpha); a.tint.setXYZ(i, r, g, b);
  }
  function flush(pts) { const a = pts.geometry.attributes; a.position.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = a.tint.needsUpdate = true; }

  function updateSmoke(T, s) {
    const n = smokePts.userData.count;
    const ground = flight.kind === 'scrub' ? -1 : flight.kind === 'nothrust' ? 7 : 26;
    for (let i = 0; i < n; i++) {
      const born = -3 + hash(i) * (ground + 3);
      const age = T - born;
      if (age < 0 || age > 40 || T > 120) { setPts(smokePts, i, 0, 0, 0, 0, 0, 1, 1, 1); continue; }
      const side = hash(i + 1) < 0.5 ? -1 : 1;
      const spread = (hash(i + 2) - 0.5) * 2;
      const out = 90 * Math.pow(age, 0.55) * (0.6 + hash(i + 3) * 0.7);
      const x = spread * out * 0.35 + (hash(i + 4) - 0.5) * 6;
      const z = side * (6 + out);
      const y = 2 + Math.pow(age, 0.8) * (2 + hash(i + 5) * 5);
      const size = 7 + Math.pow(age, 0.7) * 9;
      const life = clamp(age / 0.6, 0, 1) * (1 - clamp((age - 18) / 22, 0, 1));
      const shade = 0.82 + hash(i + 6) * 0.15;
      setPts(smokePts, i, x, y, z, size, 0.55 * life, shade, shade, shade * 0.98);
    }
    flush(smokePts);
  }

  function updateTrail(T, s) {
    const n = trailPts.userData.count;
    const showTrail = !['scrub', 'nothrust'].includes(flight.kind);
    for (let i = 0; i < n; i++) {
      const tp = T - (i + 1) * 0.9;
      const st = tp > 2 && tp < 135 && showTrail ? stateAt(flight, tp) : null;
      if (!st || st.s1 <= 0 || st.lost) { setPts(trailPts, i, 0, 0, 0, 0, 0, 1, 1, 1); continue; }
      worldPos(st.alt, st.down, tmpV2, st.lat);
      const age = T - tp;
      const thin = clamp(st.alt / 40, 0, 1);
      setPts(trailPts, i, tmpV2.x, tmpV2.y - 6, tmpV2.z, 6 + age * 2.2, 0.35 * (1 - thin) * (1 - clamp(age / 120, 0, 1)), 0.93, 0.93, 0.92);
    }
    flush(trailPts);
  }

  // Explosion: layered fireball with secondary blasts, flash, shockwave, burning debris with spark trails,
  // a rising smoke column and (on the pad) a ground shock ring and fires left burning.
  function updateExplosion(s) {
    const on = s.boomDt !== undefined && s.boomDt >= 0;
    fireballPts.visible = boomSmokePts.visible = debrisMesh.visible = sparkPts.visible = on;
    shockRing.visible = shockSphere.visible = flashSprite.visible = groundFirePts.visible = false;
    if (!on) return;
    const dt = s.boomDt, S = s.boomScale || 1.3, padBlast = !!s.boomPad, now = performance.now() / 1000;
    worldPos(s.alt, s.down, tmpV2, s.lat);
    const up = localUp.clone();
    const tip = s.tip || 0;
    const E = padBlast ? tmpV2.clone().add(new THREE.Vector3(0, 2 + Math.cos(tip) * 10, -Math.sin(tip) * 12))
                       : tmpV2.clone().add(axis.clone().multiplyScalar(16));
    const ground = padBlast ? tmpV2.y - PAD_TOP + 0.8 : -Infinity;

    // fireball: three blasts along the body, white-hot cores cooling to orange and deep red
    const n = fireballPts.userData.count;
    for (let i = 0; i < n; i++) {
      const b = Math.floor(hash(i + 7) * 3), t = dt - [0, 0.35, 0.8][b];
      if (t < 0) { setPts(fireballPts, i, 0, 0, 0, 0, 0, 1, 1, 1); continue; }
      const C = padBlast ? E.clone().add(new THREE.Vector3(0, 0, -b * 7)) : E.clone().add(new THREE.Vector3((b - 1) * 6, b * 3, 0));
      const dir = new THREE.Vector3(hash(i) - 0.5, hash(i + 1) - 0.5, hash(i + 2) - 0.5).normalize();
      if (padBlast) dir.y = Math.abs(dir.y) * 0.9 + 0.15;
      const r = 34 * S * (1 - Math.exp(-2.6 * t)) * (0.35 + hash(i + 3) * 0.75) * (b === 0 ? 1 : 0.7);
      const life = clamp(1 - t / (2.2 + hash(i + 4) * 2.8), 0, 1);
      const heat = clamp(1 - t / 2.2, 0, 1);
      const rise = t * t * 1.4 * S;
      setPts(fireballPts, i, C.x + dir.x * r + up.x * rise, C.y + dir.y * r + up.y * rise, C.z + dir.z * r,
        (12 + t * 9) * S * (0.7 + hash(i + 5) * 0.6), life * 0.95, 1, 0.5 + 0.5 * heat, 0.12 + 0.7 * Math.max(0, heat - 0.55));
    }
    flush(fireballPts);

    // smoke: a mushroom column on the pad, a spreading cloud in the air; lit orange from below at first
    const m2 = boomSmokePts.userData.count;
    for (let i = 0; i < m2; i++) {
      const t = dt - 0.3 - hash(i + 60) * 1.5;
      if (t < 0) { setPts(boomSmokePts, i, 0, 0, 0, 0, 0, 1, 1, 1); continue; }
      const ang = hash(i + 61) * Math.PI * 2, h0 = hash(i + 62);
      let x, y, z;
      if (padBlast) {
        const hgt = (1 - Math.exp(-0.22 * t)) * 95 * S * (0.25 + h0 * 0.95);
        const cap = Math.max(0, h0 - 0.55) * 2.2;                       // the top spreads into a cap
        const rad = (6 + t * 2.5 + cap * 40) * S * (0.35 + hash(i + 63) * 0.8);
        x = E.x + Math.cos(ang) * rad + up.x * hgt; y = E.y + up.y * hgt; z = E.z + Math.sin(ang) * rad - 7;
      } else {
        const dir = new THREE.Vector3(hash(i + 50) - 0.5, hash(i + 51) - 0.3, hash(i + 52) - 0.5).normalize();
        const r = 46 * S * (1 - Math.exp(-0.9 * t)) * (0.5 + hash(i + 53) * 0.7);
        x = E.x + dir.x * r; y = E.y + dir.y * r + t * 1.5; z = E.z + dir.z * r;
      }
      const glow = Math.max(0, 1 - t / 1.8), sh = 0.24 + hash(i + 54) * 0.22;
      const a = clamp(t / 0.8, 0, 1) * clamp(1 - (t - 16) / 10, 0, 1);
      setPts(boomSmokePts, i, x, y, z, (18 + t * 7) * S * (0.6 + hash(i + 55) * 0.6), a * 0.5, sh + 0.55 * glow, sh + 0.25 * glow, sh + 0.05 * glow);
    }
    flush(boomSmokePts);

    // burning debris with spark trails
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const gq = tmpQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const debrisAt = (i, t, out) => {
      const v = new THREE.Vector3(hash(i + 100) - 0.5, padBlast ? 0.35 + hash(i + 101) * 0.9 : hash(i + 101) * 0.8 - 0.2, hash(i + 102) - 0.5).normalize().multiplyScalar((22 + hash(i + 103) * 40) * S * 0.8);
      out.copy(E).add(v.multiplyScalar(t)).add(new THREE.Vector3(0, -4.1 * t * t, 0).applyQuaternion(gq));
      if (out.y < ground) out.y = ground;
      return out;
    };
    const p = new THREE.Vector3();
    for (let i = 0; i < debrisMesh.count; i++) {
      debrisAt(i, dt, p);
      q.setFromEuler(new THREE.Euler(dt * (hash(i + 104) * 6), dt * (hash(i + 105) * 5), 0));
      const k = (0.4 + hash(i + 106) * 1.8) * (S > 2 ? 1.4 : 1); sc.set(k, k, k);
      mt.compose(p, q, sc); debrisMesh.setMatrixAt(i, mt);
    }
    debrisMesh.instanceMatrix.needsUpdate = true;
    debrisMesh.material.emissiveIntensity = Math.max(0, 2 - dt * 0.35);
    const ns = sparkPts.userData.count;
    for (let j = 0; j < ns; j++) {
      const i = j % debrisMesh.count, back = (Math.floor(j / debrisMesh.count) + 1) * 0.07, t = dt - back;
      if (t < 0 || dt > 7) { setPts(sparkPts, j, 0, 0, 0, 0, 0, 1, 1, 1); continue; }
      debrisAt(i, t, p);
      setPts(sparkPts, j, p.x, p.y, p.z, 1.6 * S * (1 - back * 2), clamp(1 - dt / 7, 0, 1) * (1 - back * 3), 1, 0.6, 0.2);
    }
    flush(sparkPts);

    // flash and shockwave
    const fl = Math.max(0, 1 - dt / 0.45);
    flashSprite.visible = fl > 0;
    flashSprite.position.copy(E); flashSprite.scale.setScalar(170 * S * (0.4 + dt * 3)); flashSprite.material.opacity = fl * 0.8;
    const sw = Math.max(0, 1 - dt / 0.7) * 0.7;
    shockSphere.visible = sw > 0;
    shockSphere.position.copy(E); shockSphere.scale.setScalar(8 + dt * 150 * S); shockSphere.material.uniforms.uOp.value = sw;
    if (padBlast) {
      const rw = Math.max(0, 1 - dt / 1.3);
      shockRing.visible = rw > 0;
      shockRing.position.set(E.x, ground + 0.3, E.z - 7); shockRing.quaternion.copy(gq).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
      shockRing.scale.setScalar(6 + dt * 170); shockRing.material.opacity = rw * 0.85;
      // fires left burning on the pad
      groundFirePts.visible = dt > 0.6;
      for (let i = 0; i < groundFirePts.userData.count; i++) {
        const ang = hash(i + 400) * Math.PI * 2, rr = Math.sqrt(hash(i + 401)) * 28 * S * 0.6;
        const flick = 0.55 + 0.45 * Math.sin(now * (9 + hash(i + 402) * 8) + i);
        const fade = clamp((dt - 0.6) / 1.5, 0, 1) * clamp(1 - (dt - 18) / 8, 0, 1);
        setPts(groundFirePts, i, E.x + Math.cos(ang) * rr, ground + 1 + flick * 3 * hash(i + 403), E.z - 7 + Math.sin(ang) * rr,
          (3 + hash(i + 404) * 5) * (0.7 + flick * 0.5), fade * flick * 0.9, 1, 0.45 + 0.25 * flick, 0.12);
      }
      flush(groundFirePts);
    }
    // the blast lights everything up, then the fires flicker
    padLight.position.copy(E).sub(rocketW);
    padLight.intensity = (dt < 3 ? 70 * Math.pow(1 - dt / 3, 2) : 0) + (padBlast ? 5 * (0.6 + 0.4 * Math.sin(now * 11)) * clamp(1 - (dt - 18) / 8, 0, 1) : 0);
  }

  function updateSplash(s) {
    const on = s.splash !== undefined && s.splash >= 0;
    splashPts.visible = on;
    if (!on) return;
    worldPos(0, s.down, tmpV2);
    const n = splashPts.userData.count;
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(hash(i + 300) - 0.5, hash(i + 301), hash(i + 302) - 0.5).normalize();
      const r = 30 * (1 - Math.exp(-1.5 * s.splash));
      const a = clamp(1 - s.splash / 6, 0, 1);
      setPts(splashPts, i, tmpV2.x + dir.x * r, tmpV2.y + dir.y * r, tmpV2.z + dir.z * r, 12 + s.splash * 5, a * 0.8, 0.95, 0.97, 1);
    }
    flush(splashPts);
  }

  // ---------- Cameras ----------

  function toRender(wx, wy, wz, out) { return out.set(wx, wy, wz).sub(rocketW); }
  function shakeOffset(T, amt) {
    return new THREE.Vector3(Math.sin(T * 61.3) * 0.5 + Math.sin(T * 23.1) * 0.5, Math.sin(T * 47.9) * 0.5, Math.cos(T * 37.7) * 0.5).multiplyScalar(amt);
  }
  function satCenter() { return M.sat.getWorldPosition(new THREE.Vector3()); }
  function rocketPoint(h) { return axis.clone().multiplyScalar(h); }

  function cinematic(cam, T, s) {
    const up = localUp.clone();
    let pos, look, fov = 40, closeShake = false;
    const k = flight.kind;
    const pad = (x, y, z) => toRender(x, y, z, new THREE.Vector3());
    if (FX.magForced || (T >= 4400 && flight.Tend >= 4690)) {
      // pull back to show Earth's magnetic field and the Van Allen belts
      const earthC = toRender(0, -R, 0, new THREE.Vector3());
      const k2 = FX.magForced ? 1 : smooth(4400, 4660, T);
      const dir = new THREE.Vector3(0.25, 0.35, 1).normalize();
      const dist = lerp(R * 1.25, R * 34, k2 * k2);
      pos = earthC.clone().add(dir.multiplyScalar(dist)); look = earthC.clone().lerp(satCenter(), 1 - k2); fov = 40;
    }
    else if (T < -4) { pos = pad(70, 11, 45); look = rocketPoint(13); fov = 36; }
    else if (k === 'nothrust' && T >= 2) {
      if (T < flight.te) { pos = pad(95, 12, 30); look = pad(0, 13, -8); fov = 44; }
      else { pos = pad(215, 60, 160); look = pad(0, 22, -12); fov = 50; }
    }
    else if (T < 1 || k === 'scrub' || k === 'nothrust') {
      if (T < 3 && (k !== 'nothrust' || T < 2)) { pos = pad(9, 2.2, 13); look = rocketPoint(3); fov = 52; }
      else { pos = pad(55, 3, 6); look = rocketPoint(12); fov = 44; }
    }
    else if (T < 12) { pos = pad(55, 2, 6); look = rocketPoint(12); fov = 46; }
    else if ((k === 'wobble' && T >= 28 && T < 115) || (k === 'unstable' && T >= 24 && T < flight.te)) {
      // cycle close-up, long lens (shows the S-shaped trail) and an engine close-up
      const shot = k === 'unstable' ? (T < flight.te - 8 ? 0 : 2) : Math.floor((T - 28) / 29) % 3;
      const side = new THREE.Vector3(0, 0, 1), along = new THREE.Vector3(localUp.y, -localUp.x, 0);
      if (shot === 1) {
        pos = pad(-1500, 3, -1900); look = rocketPoint(14);
        fov = clamp(2 * Math.atan(70 / pos.distanceTo(look)) * 180 / Math.PI, 0.6, 40);
        cam.up.set(0, 1, 0);
      } else if (shot === 2) {
        pos = rocketPoint(-4).add(side.multiplyScalar(15)).add(along.multiplyScalar(-6)); look = rocketPoint(0.5); fov = 55; cam.up.copy(up); closeShake = true;
      } else {
        pos = rocketPoint(15).add(side.multiplyScalar(46)).add(along.multiplyScalar(14)); look = rocketPoint(14); fov = 50; cam.up.copy(up); closeShake = true;
      }
    }
    else if (k === 'suborbital' && T >= flight.apexT - 5) {
      // chase the falling stage close up
      const mid = s.sep && T > 138 ? 18 : 10;
      if (s.splash !== undefined) {   // watch the splash from a safe distance
        pos = new THREE.Vector3(0, 0, 220).add(localUp.clone().multiplyScalar(45)); look = new THREE.Vector3(); fov = 45;
      } else {
        pos = rocketPoint(mid).add(new THREE.Vector3(0, 0, 30)).add(localUp.clone().multiplyScalar(6));
        look = rocketPoint(mid); fov = 50; closeShake = true;
      }
      cam.up.copy(up);
    }
    else if (T < 130 || ((k === 'explode' || k === 'unstable') && T >= (flight.te - 20)) || (k === 'suborbital' && T >= flight.Tb && flight.Tb < 135)) {
      pos = pad(-1500, 3, -1900);
      look = rocketPoint(14);
      const dist = pos.distanceTo(look);
      fov = clamp(2 * Math.atan(70 / dist) * 180 / Math.PI, 0.6, 40);
      if (s.lost) fov = clamp(2 * Math.atan(260 / dist) * 180 / Math.PI, 0.6, 40);
      cam.up.set(0, 1, 0);
    }
    else if (T < 200) {
      pos = new THREE.Vector3(14, 16, 26).applyEuler(M.root.rotation); look = rocketPoint(17); fov = 42;
    }
    else if (T < 510 || k === 'suborbital') {
      pos = new THREE.Vector3(38, 4, 70).applyEuler(M.root.rotation); look = rocketPoint(14); fov = 40;
    }
    else if (T < 3110) {
      const a = (T - 510) * 0.0004;
      pos = new THREE.Vector3(Math.sin(a) * 55, 18, Math.cos(a) * 55).applyEuler(M.root.rotation).add(localUp.clone().multiplyScalar(-6)); look = rocketPoint(14); fov = 42;
    }
    else {
      const c = satCenter();
      const a = (T - 3110) * 0.0012 + 0.6;
      const rr = 9 + 9 * s.arrays;
      pos = c.clone().add(new THREE.Vector3(Math.sin(a) * rr, 3 + 2 * s.arrays, Math.cos(a) * rr).applyEuler(M.root.rotation));
      look = c; fov = 40;
    }
    if (!(T >= 12 && T < 130)) cam.up.copy(up);
    const shakeK = closeShake ? 0.16 : T < 12 ? 0.25 : 0.05;
    pos.add(shakeOffset(T + performance.now() / 4000, s.shake * shakeK * (pos.distanceTo(look) / 20)));
    cam.position.copy(pos); cam.fov = fov; cam.lookAt(look); cam.updateProjectionMatrix();
  }

  function splitCams(T, s) {
    const R0 = M.root.rotation;
    const [onboard, nose, beach, space] = cams;
    // Onboard: on stage 1 looking down the body; after separation, on stage 2
    const onH = s.sep && T > 138 ? 19 : 12;
    onboard.position.copy(new THREE.Vector3(1.05, onH + 1.32, 0).applyEuler(R0).add(s.sep && T > 138 ? M.s2.position.clone().applyEuler(R0) : new THREE.Vector3()));
    onboard.up.copy(new THREE.Vector3(1, 0, 0).applyEuler(R0));
    onboard.lookAt(onboard.position.clone().add(new THREE.Vector3(0.08, -1, 0).applyEuler(R0)));
    onboard.fov = 70;
    // Nose camera: near the top of the fairing; after jettison it looks up at the satellite
    if (!s.fairing || T < 182) {
      nose.position.copy(new THREE.Vector3(1.45, 27.5, 0).applyEuler(R0));
      nose.up.copy(new THREE.Vector3(1, 0, 0).applyEuler(R0));
      nose.lookAt(nose.position.clone().add(new THREE.Vector3(0.12, -1, 0).applyEuler(R0)));
      nose.fov = 75;
    } else {
      const c = satCenter();
      nose.position.copy(new THREE.Vector3(1.0, 21.7, 0.6).applyEuler(R0).add(M.s2.position.clone().applyEuler(R0)));
      nose.up.copy(localUp);
      nose.lookAt(c); nose.fov = 60;
    }
    // Spectator on the beach
    toRender(-260, 2, coastZ(-260) - 15, beach.position);
    beach.up.set(0, 1, 0);
    const look = rocketPoint(14);
    beach.lookAt(look);
    const d = beach.position.distanceTo(look);
    beach.fov = clamp(2 * Math.atan(s.alt < 0.2 ? 30 / d : 90 / d) * 180 / Math.PI, 0.5, 50);
    // View from space
    space.position.copy(localUp).multiplyScalar(150 * KM).add(new THREE.Vector3(-30 * KM, 0, 40 * KM));
    space.up.set(1, 0, 0);
    space.lookAt(0, 0, 0);
    space.fov = 2.2;
    for (const c of cams) c.updateProjectionMatrix();
  }

  // ---------- Render loop ----------

  function resize() {
    if (!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  }

  function drawWith(cam, x, y, w, h, fogOff) {
    cam.aspect = w / h; cam.updateProjectionMatrix();
    const k = (h * renderer.getPixelRatio()) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    for (const pts of [smokePts, trailPts, fireballPts, boomSmokePts, splashPts, sparkPts, groundFirePts, M.sparks, M.wind]) pts.material.uniforms.uScale.value = k;
    const fogD = scene.fog.density;
    if (fogOff) scene.fog.density = 0;
    skyMesh.position.copy(cam.position); starPts.position.copy(cam.position);
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
    renderer.render(scene, cam);
    scene.fog.density = fogD;
  }

  let lastS = null;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (mode === 'orbitview' && host) { drawOrbitView(now); return; }
    if (mode === 'rocketview' && host) { drawRocketView(now); return; }
    if (!flight || !host) return;
    const dt = Math.max(0, Math.min(0.1, (now - lastNow) / 1000)); lastNow = Math.max(lastNow, now);
    if (playing) {
      P = Math.min(flight.pMax, P + dt);
      T = tOfP(P, flight.segments);
      if (P >= flight.pMax) { playing = false; hooks.onEnd && hooks.onEnd(); }
    }
    const s = update(T); lastS = s;
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setScissorTest(true);
    if (mode === 'sat') { drawSatView(now, w, h); return; }
    if (mode === 'split') {
      splitCams(T, s);
      const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
      drawWith(cams[0], 0, hh, hw, h - hh);
      drawWith(cams[1], hw, hh, w - hw, h - hh);
      drawWith(cams[2], 0, 0, hw, hh);
      drawWith(cams[3], hw, 0, w - hw, hh, true);
    } else {
      if (mode === 'cinematic') cinematic(camMain, T, s);
      else {
        // Free camera. On the finale it circles Earth so you can explore the magnetic field and Van Allen belts.
        const magView = FX.magForced || (T >= 4400 && flight.Tend >= 4690);
        const tgt = magView ? toRender(0, -R, 0, new THREE.Vector3()) : T >= 3110 && flight.kind !== 'stranded' ? satCenter() : rocketPoint(14);
        if (magView !== freeMag) {
          freeMag = magView;
          controls.minDistance = magView ? R * 1.15 : 4; controls.maxDistance = magView ? R * 90 : 4e5;
          controls.target.copy(tgt);
          const dd = camMain.position.distanceTo(tgt);
          if (magView && dd < R * 3) camMain.position.copy(tgt).add(new THREE.Vector3(0.25, 0.35, 1).normalize().multiplyScalar(R * 14));
          if (!magView && dd > 3000) camMain.position.copy(tgt).add(localUp.clone().multiplyScalar(18)).add(new THREE.Vector3(0, 0, 40));
        } else {
          const delta = tgt.clone().sub(controls.target);
          controls.target.copy(tgt); camMain.position.add(delta);
        }
        camMain.up.copy(localUp);
        controls.update();
      }
      updateMeteors(camMain, s);
      drawWith(camMain, 0, 0, w, h);
    }
    hooks.onTick && hooks.onTick(info());
  }

  // ---------- Orbit view: your satellite circling the real Earth, at real scale and real speed ----------
  // Units are meters. The satellite sits at the scene origin (a floating origin) and the Earth is placed
  // around it, so a few-meter satellite and a 12,742 km planet share one view without jitter.
  // Orbit physics: circular orbit, period = 2*pi*sqrt(r^3 / GM). At 891 km that is about 102.6 minutes.
  const MU = 3.986004418e14, RE_M = 6371e3, W_EARTH = 7.2921159e-5, INC = 77.6 * Math.PI / 180;   // SWOT: 77.6 degrees
  const STATIONS = [['Svalbard', 78.23, 15.39], ['Fairbanks', 64.86, -147.85], ['Wallops', 37.94, -75.46], ['McMurdo', -77.84, 166.67]];
  const NEMO = [-48.88, -123.39], SAFE_KM = 1200;        // Point Nemo: the ocean spot farthest from land
  const DEORBIT_DU = 160 * Math.PI / 180, DEORBIT_T = 2700;   // reentry about 160 degrees and 45 minutes after the burn
  const SITES = { hurricane: [21, -62, 'Hurricane, Atlantic'], wildfire: [56, -118, 'Wildfires, western Canada'],
    volcano: [-20.55, -175.39, 'Hunga Tonga volcano'], ozoneHole: [-90, 0, 'Antarctic ozone hole'], groundOutage: [78.23, 15.39, 'Svalbard station: storm damage'] };
  const llDir = (lat, lon) => { const la = lat * Math.PI / 180, lo = lon * Math.PI / 180; return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)); };
  const gcKm = (a, b) => Math.acos(clamp(a.dot(b), -1, 1)) * 6371;
  const wrapPi = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const orbitDir = (u, out) => out.set(Math.cos(u), Math.sin(u) * Math.sin(INC), -Math.sin(u) * Math.cos(INC));
  const velDir = (u, out) => out.set(-Math.sin(u), Math.cos(u) * Math.sin(INC), -Math.cos(u) * Math.cos(INC));
  const reentryAlt = (s) => 891e3 * (1 - Math.pow(clamp(s, 0, 1), 3));
  let OV = null;

  function ringTex(color, fill) {
    return canvasTex(128, 128, (g) => {
      if (fill) { g.fillStyle = fill; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill(); }
      g.strokeStyle = color; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 54, 0, 7); g.stroke();
      if (!fill) { g.fillStyle = color; g.beginPath(); g.arc(64, 64, 10, 0, 7); g.fill(); }
    });
  }
  function xTex() {
    return canvasTex(128, 128, (g) => {
      g.strokeStyle = '#ff4b3a'; g.lineWidth = 14; g.lineCap = 'round';
      g.beginPath(); g.moveTo(26, 26); g.lineTo(102, 102); g.moveTo(102, 26); g.lineTo(26, 102); g.stroke();
    });
  }
  function spiralTex() {
    return canvasTex(256, 256, (g) => {
      g.translate(128, 128);
      for (let arm = 0; arm < 3; arm++) for (let i = 0; i < 240; i++) {
        const t = i / 240, a = arm * 2.094 + t * 7.2, r = 10 + t * 110, x = Math.cos(a) * r, y = Math.sin(a) * r, s = 6 + t * 20;
        const gr = g.createRadialGradient(x, y, 0, x, y, s);
        gr.addColorStop(0, `rgba(255,255,255,${(0.16 * (1 - t * 0.75)).toFixed(3)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
      }
      const c = g.createRadialGradient(0, 0, 3, 0, 0, 46);
      c.addColorStop(0, 'rgba(255,255,255,0)'); c.addColorStop(0.2, 'rgba(255,255,255,0.95)'); c.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = c; g.beginPath(); g.arc(0, 0, 46, 0, 7); g.fill();
      g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, 0, 4.5, 0, 7); g.fill();
    });
  }
  // A flat disc bent onto the curved Earth, so a 2,000 km feature hugs the surface
  function curvedDisc(radius, mat, h) {
    const geo = new THREE.RingGeometry(1, radius, 72, 14), p = geo.attributes.position, R = RE_M + h;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), rho = Math.hypot(x, y); p.setZ(i, -(R - Math.sqrt(Math.max(0, R * R - rho * rho)))); }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }
  function placeOnEarth(obj, dir, h) {
    obj.position.copy(dir).multiplyScalar(RE_M + h);
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    return obj;
  }
  function auroraMat() {
    return new THREE.ShaderMaterial({
      uniforms: { uOp: { value: 0 }, uT: { value: 0 } },
      vertexShader: LOG_V + `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
        #include <logdepthbuf_vertex>
      }`,
      fragmentShader: LOG_F + `uniform float uOp; uniform float uT; varying vec2 vUv; void main(){
        #include <logdepthbuf_fragment>
        float wave = 0.55 + 0.45 * sin(vUv.x * 90.0 + uT * 1.7) * sin(vUv.x * 23.0 - uT * 0.8);
        float v = smoothstep(0.0, 0.1, vUv.y) * pow(1.0 - vUv.y, 2.0);
        vec3 col = mix(vec3(0.25, 1.0, 0.55), vec3(0.85, 0.3, 0.9), smoothstep(0.55, 1.0, vUv.y));
        gl_FragColor = vec4(col, v * wave * uOp); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
  }
  function makeDebrisStage() {
    // A spent upper stage: about 7.5 m long and 3 m wide, weathered after decades in orbit
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, metalness: 0.45, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.6, roughness: 0.5 });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 7.5, 28), skin));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.53, 1.53, 0.5, 28), dark); band.position.y = 2.4; g.add(band);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), skin); dome.position.y = 3.75; g.add(dome);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.15, 1.9, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x5a4a3c, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }));
    noz.position.y = -4.7; g.add(noz);
    const torn = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 2.2), skin); torn.position.set(1.7, -1, 0.3); torn.rotation.set(0.3, 0.2, 0.9); g.add(torn);
    return g;
  }

  function buildOrbitView() {
    const r0 = RE_M + 891e3;
    OV = { keys: { up: false, down: false, left: false, right: false }, r0, r: r0, rOff: 0, u: 2.15, th0: 0.55, simT: 0, warp: 1, autoWarp: null, data: 0, trackN: 1400, trackCount: 0, lastTrackT: -1e9,
      opts: {}, ev: null, evKey: null, land: null, xfer: null, destroyed: false, satHidden: false, satR: 6, offline: null, alert: '',
      cam: { az: -0.9, el: 0.4, ld: Math.log(30), azT: -0.9, elT: 0.4, ldT: Math.log(30) },
      V: () => new THREE.Vector3() };
    OV.period = 2 * Math.PI * Math.sqrt(r0 * r0 * r0 / MU); OV.n = 2 * Math.PI / OV.period;
    OV.pos = new THREE.Vector3(); OV.dir = new THREE.Vector3(); OV.vel = new THREE.Vector3(); OV.earthC = new THREE.Vector3();
    OV.qLv = new THREE.Quaternion(); OV.qF = new THREE.Quaternion(); OV.qI = new THREE.Quaternion(); OV.mLv = new THREE.Matrix4();
    const S = OV.scene = new THREE.Scene();
    S.environment = scene.environment;
    OV.cam3 = new THREE.PerspectiveCamera(40, 1, 0.3, 2e10);
    OV.sunDir = new THREE.Vector3(1, 0.18, 0.45).normalize();
    const sunL = new THREE.DirectionalLight(0xffffff, 2.8); sunL.position.copy(OV.sunDir); S.add(sunL, sunL.target);
    OV.hemi = new THREE.HemisphereLight(0x080c16, 0x3a6aa8, 0.5); S.add(OV.hemi);
    S.add(new THREE.AmbientLight(0x1a2235, 0.3));
    // stars and the Sun ride along with the camera
    OV.sky = new THREE.Group(); S.add(OV.sky);
    const sg = new THREE.BufferGeometry(), sp = [];
    for (let i = 0; i < 3500; i++) { const u = hash(i + 7000) * 2 - 1, th = hash(i + 7100) * 6.283, rr = Math.sqrt(1 - u * u); sp.push(rr * Math.cos(th) * 5e9, u * 5e9, rr * Math.sin(th) * 5e9); }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false })); stars.frustumCulled = false; OV.sky.add(stars);
    const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex('rgba(255,250,235,1)', 'rgba(255,200,120,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    sunSpr.position.copy(OV.sunDir).multiplyScalar(4e9); sunSpr.scale.setScalar(2.6e8); OV.sky.add(sunSpr);
    // Earth in the inertial frame; it turns once every sidereal day (23 h 56 min)
    OV.world = new THREE.Group(); S.add(OV.world);
    OV.earth = new THREE.Group(); OV.world.add(OV.earth);
    OV.earth.add(new THREE.Mesh(new THREE.SphereGeometry(RE_M, 192, 96), EARTH.day ? new THREE.MeshStandardMaterial({ map: EARTH.day, roughness: 0.85, metalness: 0 }) : earthMesh.material));
    OV.clouds = new THREE.Mesh(new THREE.SphereGeometry(RE_M + 12e3, 128, 64), new THREE.MeshStandardMaterial({ map: EARTH.cloudMap, transparent: true, depthWrite: false, opacity: 0.7, roughness: 1 }));
    OV.earth.add(OV.clouds);
    OV.glow = new THREE.Mesh(new THREE.SphereGeometry(RE_M * 1.014, 128, 64), fresnelMat(0x5aa8ff, 3.0, 1.5)); OV.glow.material.uniforms.uOp.value = 1; OV.world.add(OV.glow);
    // the orbit path, fixed in space while Earth turns underneath
    const ringPts = [];
    for (let i = 0; i <= 512; i++) ringPts.push(orbitDir(i / 512 * Math.PI * 2, new THREE.Vector3()).multiplyScalar(r0));
    OV.ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.3, depthWrite: false }));
    OV.ring.frustumCulled = false; OV.world.add(OV.ring);
    OV.stations = STATIONS.map(([name, lat, lon]) => {
      const dir = llDir(lat, lon);
      const g = new THREE.Group(); g.position.copy(dir).multiplyScalar(RE_M + 500); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const pin = new THREE.Mesh(new THREE.ConeGeometry(9e3, 40e3, 16), new THREE.MeshBasicMaterial({ color: 0xff5d4d })); pin.position.y = 20e3; g.add(pin);
      const ring = new THREE.Mesh(new THREE.RingGeometry(25e3, 34e3, 48), new THREE.MeshBasicMaterial({ color: 0xff5d4d, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 900; g.add(ring);
      OV.earth.add(g);
      return { name, dir, g, ring, pin };
    });
    OV.trackPos = new Float32Array(OV.trackN * 3);
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(OV.trackPos, 3)); tg.setDrawRange(0, 0);
    OV.track = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85 })); OV.track.frustumCulled = false; OV.earth.add(OV.track);
    OV.beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x8fffd8, transparent: true, opacity: 0.85 }));
    OV.beam.frustumCulled = false; S.add(OV.beam);
    // screen-size marker so you can find a 10 m satellite from 30,000 km away
    OV.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex('#3fd4ff'), transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
    OV.marker.scale.setScalar(0.045); OV.marker.renderOrder = 10; S.add(OV.marker);
    // engine plume, aimed per burn
    const pg = new THREE.ConeGeometry(0.9, 6, 20, 1, true); pg.translate(0, -3, 0);
    OV.plume = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    OV.plume.visible = false; S.add(OV.plume);
    pointerControls();
  }

  function pointerControls() {
    const el = renderer.domElement, ptr = new Map();
    let pinch = 0;
    el.addEventListener('pointerdown', (e) => { if (mode !== 'orbitview') return; ptr.set(e.pointerId, [e.clientX, e.clientY]); try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
    el.addEventListener('pointermove', (e) => {
      if (mode !== 'orbitview' || !ptr.has(e.pointerId)) return;
      const [px, py] = ptr.get(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptr.size === 1) { OV.cam.azT -= (e.clientX - px) * 0.006; OV.cam.elT = clamp(OV.cam.elT + (e.clientY - py) * 0.005, -1.45, 1.45); }
      else if (ptr.size === 2) { const [a, b] = [...ptr.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) orbitZoomBy(Math.log(pinch / dd) * 2.2); pinch = dd; }
    });
    const up = (e) => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch = 0; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { if (mode !== 'orbitview') return; e.preventDefault(); orbitZoomBy(e.deltaY * 0.0028); }, { passive: false });
  }
  function orbitZoomBy(x) { OV.cam.ldT = clamp(OV.cam.ldT + x, Math.log(OV.satR * 1.6), Math.log(6.5e7)); }
  function camTo(az, el, d) {
    OV.cam.azT = OV.cam.az + wrapPi(az - OV.cam.az); OV.cam.elT = clamp(el, -1.45, 1.45);
    if (d) OV.cam.ldT = Math.log(d);
  }
  // Point the far camera at an ECI direction (used for "look at the hurricane" and the landing zone)
  function camFacing(dirEci, d, tilt = 0.18) { camTo(Math.atan2(dirEci.x, dirEci.z), Math.asin(clamp(dirEci.y, -1, 1)) + tilt, d); }
  function earthToEci(local, out) { return out.copy(local).applyAxisAngle(new THREE.Vector3(0, 1, 0), OV.earth.rotation.y); }
  function viewPreset(v) {
    if (v === 'close') camTo(-0.9, 0.4, OV.satR * 3.2);
    else if (v === 'earth') {
      const n = new THREE.Vector3(0, Math.cos(INC), Math.sin(INC));
      camFacing(n.multiplyScalar(0.55).add(OV.dir.clone().multiplyScalar(0.85)).normalize(), 2.6e7, 0);
    }
  }

  // Predicted landing point if the deorbit burn fires at sim time t (unit vector in Earth-fixed coordinates)
  function impactAt(uImp, xr, tImp, out) {
    orbitDir(uImp, out);
    if (xr) out.applyAxisAngle(velDir(uImp, new THREE.Vector3()), xr);
    return out.applyAxisAngle(new THREE.Vector3(0, 1, 0), -(OV.th0 + W_EARTH * tImp));
  }
  function predictImpact(t, out, dU = 0, xr = 0) {
    const u = OV.u + (t - OV.simT) * OV.n;
    return impactAt(u + DEORBIT_DU + dU, xr, t + DEORBIT_T, out);
  }
  // Arrow keys: up = burn harder (comes down sooner), down = softer (farther), left/right = sideways
  function steerInput(dtR, rate) {
    const k = OV.keys, L = OV.land;
    const ud = (k.down ? 1 : 0) - (k.up ? 1 : 0), lr = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    if (!ud && !lr) return false;
    L.dU = clamp(L.dU + ud * dtR * 0.14 * rate, -0.5, 0.5);
    L.xr = clamp(L.xr + lr * dtR * 0.05 * rate, -0.13, 0.13);
    const dir = lv(-ud, 0, -lr);   // the plume points away from the push
    if (dir.lengthSq() > 0) burnFx(dir.normalize(), 0.8);
    return true;
  }
  function nextWindow() {
    const p = new THREE.Vector3(), nemo = llDir(NEMO[0], NEMO[1]), L = OV.land || {};
    for (let dt = 0; dt < OV.period * 14; dt += 30) if (gcKm(predictImpact(OV.simT + dt, p, L.dU || 0, L.xr || 0), nemo) < SAFE_KM * 0.8) return dt;
    return null;
  }

  function startLanding() {
    const L = OV.land = { stage: 'aim', g: new THREE.Group(), nemo: llDir(NEMO[0], NEMO[1]), win: null, winAt: -1, pred: new THREE.Vector3(), dU: 0, xr: 0, fuel: 1 };
    OV.earth.add(L.g);
    const zone = curvedDisc(SAFE_KM * 1000, new THREE.MeshBasicMaterial({ map: ringTex('#5ab8ff', 'rgba(60,150,255,0.22)'), transparent: true, depthWrite: false }), 3e3);
    L.g.add(placeOnEarth(zone, L.nemo, 3e3));
    L.x = new THREE.Sprite(new THREE.SpriteMaterial({ map: xTex(), transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
    L.x.scale.setScalar(0.04); L.x.renderOrder = 11; L.g.add(L.x);
    L.pathPos = new Float32Array(64 * 3);
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(L.pathPos, 3));
    L.path = new THREE.Line(pg, new THREE.LineBasicMaterial({ color: 0xff6a4d, transparent: true, opacity: 0.8 })); L.path.frustumCulled = false; L.g.add(L.path);
    OV.autoWarp = 100;
    camFacing(earthToEci(L.nemo, new THREE.Vector3()), 2.4e7);
  }

  // predicted ground path from here to the landing point
  function drawPath(L, uNow, tNow, s0 = 0) {
    const q = new THREE.Vector3();
    for (let i = 0; i < 64; i++) {
      const f = i / 63, s = s0 + (1 - s0) * f;
      const uu = L.stage === 'aim' ? uNow + (DEORBIT_DU + L.dU) * f : L.uB + (DEORBIT_DU + L.dU) * s;
      const tt = L.stage === 'aim' ? tNow + DEORBIT_T * f : L.t0 + DEORBIT_T * s;
      impactAt(uu, L.xr * (L.stage === 'aim' ? f : s), tt, q).multiplyScalar(RE_M + 8e3);
      L.pathPos.set([q.x, q.y, q.z], i * 3);
    }
    L.path.geometry.attributes.position.needsUpdate = true;
  }

  function fireDeorbit() {
    const L = OV.land;
    if (!L || L.stage !== 'aim') return null;
    const p = predictImpact(OV.simT, new THREE.Vector3(), L.dU, L.xr);
    const dist = gcKm(p, L.nemo);
    Object.assign(L, { stage: 'reentry', t0: OV.simT, uB: OV.u, impact: p.clone(), dist, inZone: dist <= SAFE_KM, rt: 0 });
    L.x.position.copy(p).multiplyScalar(RE_M + 3e3);
    OV.burn = { rt: 0, dur: 3.2, dir: 'retro' };
    OV.autoWarp = 10;
    camTo(0.45, 0.16, OV.satR * 7);      // side view, so the fiery trail streams away from you
    const la = Math.asin(p.y) * 180 / Math.PI, lo = Math.atan2(-p.z, p.x) * 180 / Math.PI;
    return { inZone: dist <= SAFE_KM, distKm: dist, lat: la, lon: lo };
  }

  function buildReentryFx() {
    const g = new THREE.Group(); OV.scene.add(g);
    // white-hot core (glows), then orange and red plasma that keeps its color even over bright clouds
    const mk = (a, b, add) => new THREE.SpriteMaterial({ map: softTex(a, b), blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, transparent: true, depthWrite: false });
    const mats = [mk('rgba(255,248,220,1)', 'rgba(255,190,90,0)', true), mk('rgba(255,130,30,1)', 'rgba(255,70,10,0)', false), mk('rgba(220,50,15,0.9)', 'rgba(90,15,5,0)', false)];
    const tail = [];
    for (let i = 0; i < 30; i++) { const s = new THREE.Sprite(mats[i < 4 ? 0 : i < 14 ? 1 : 2].clone()); g.add(s); tail.push(s); }
    return { g, tail, mats, frags: [] };
  }

  function updateLanding(dtR) {
    const L = OV.land; if (!L) return;
    if (L.stage === 'aim') {
      const steering = steerInput(dtR, 1);
      if (!steering && !OV.ev && !OV.burn) OV.plume.visible = false;
      if (steering) L.winAt = Math.min(L.winAt, 0.15);
      const p = predictImpact(OV.simT, L.pred, L.dU, L.xr);
      L.x.position.copy(p).multiplyScalar(RE_M + 3e3);
      L.dist = gcKm(p, L.nemo); L.inZone = L.dist <= SAFE_KM;
      drawPath(L, OV.u, OV.simT);
      L.winAt -= dtR;
      if (L.winAt <= 0) { L.win = nextWindow(); L.winAt = 0.8; }
      if (OV.autoWarp) OV.autoWarp = L.dist < 3000 ? 10 : 100;
      OV.alert = L.inZone ? 'Landing point inside the safe zone' : 'Aiming the deorbit burn';
      return;
    }
    if (L.stage === 'reentry') {
      L.rt += dtR;
      const s = (OV.simT - L.t0) / DEORBIT_T, h = reentryAlt(s);
      // you can still steer with the thrusters until the air gets thick (about 130 km), while fuel lasts
      L.canSteer = h > 130e3 && L.fuel > 0;
      if (L.canSteer && steerInput(dtR, 0.6)) L.fuel = Math.max(0, L.fuel - dtR * 0.16);
      else if (!OV.burn) OV.plume.visible = false;
      impactAt(L.uB + DEORBIT_DU + L.dU, L.xr, L.t0 + DEORBIT_T, L.impact);
      L.dist = gcKm(L.impact, L.nemo); L.inZone = L.dist <= SAFE_KM;
      L.x.position.copy(L.impact).multiplyScalar(RE_M + 3e3);
      L.path.visible = L.canSteer;
      if (L.canSteer) drawPath(L, L.uB + DEORBIT_DU * s + L.dU * s, OV.simT, s);
      OV.autoWarp = h > 160e3 ? (OV.keys.up || OV.keys.down || OV.keys.left || OV.keys.right ? 60 : 200) : 12;
      if (!L.fx) L.fx = buildReentryFx();
      const I = smooth(135e3, 85e3, h) * (s < 1 ? 1 : 0), broken = h < 78e3;
      if (h < 130e3 && OV.burn) { OV.burn = null; OV.plume.visible = false; }
      OV.glow.material.uniforms.uOp.value = smooth(150e3, 220e3, h);
      if (broken && !L.frags) {
        L.frags = [];
        const cols = [0xd4a640, 0x1d3c78, 0x8a8f99, 0xc9a24a, 0x2a4a8c];
        for (let i = 0; i < 9; i++) {
          const sz = OV.satR * (0.12 + hash(i + 40) * 0.25);
          const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.4, sz * 0.8), new THREE.MeshStandardMaterial({ color: cols[i % 5], metalness: 0.5, roughness: 0.5, emissive: 0x662200 }));
          L.fx.g.add(m);
          const tail = [];
          for (let k = 0; k < 9; k++) { const sp = new THREE.Sprite(L.fx.mats[k < 2 ? 0 : k < 5 ? 1 : 2].clone()); L.fx.g.add(sp); tail.push(sp); }
          L.frags.push({ m, tail, p: new THREE.Vector3(), v: new THREE.Vector3((hash(i) - 0.5) * 30, (hash(i + 9) - 0.5) * 24, (hash(i + 19) - 0.5) * 30), spin: new THREE.Vector3(hash(i + 3), hash(i + 5), hash(i + 7)) });
        }
        OV.satHidden = true;
        camTo(0.5, 0.3, OV.satR * 26);
      }
      const len = OV.satR * (2 + 9 * I), tmp = new THREE.Vector3();
      L.fx.tail.forEach((sp, i) => {
        const k = i / 30, fl = 0.75 + 0.25 * Math.sin(L.rt * 40 + i * 1.7);
        sp.visible = !broken && I > 0.01;
        sp.position.set(-k * len + OV.satR * 0.4, (hash(i + Math.floor(L.rt * 20)) - 0.5) * OV.satR * 0.3 * k, 0).applyQuaternion(OV.qLv);
        sp.scale.setScalar(OV.satR * (1.4 + k * 1.2) * (0.6 + I * 0.6) * (i < 4 ? 1.3 : 1));
        sp.material.opacity = I * (1 - k * 0.9) * fl;
      });
      if (L.frags) L.frags.forEach((f, fi) => {
        f.p.addScaledVector(f.v, dtR); f.v.x -= 5 * dtR; f.v.y -= 2.5 * dtR;
        f.m.position.copy(f.p).applyQuaternion(OV.qLv);
        f.m.rotation.x += f.spin.x * dtR * 3; f.m.rotation.y += f.spin.y * dtR * 3;
        const fI = s < 1 ? Math.max(0.35, I) : 0;
        f.m.visible = s < 1;
        f.tail.forEach((sp, k) => {
          const kk = k / 9;
          tmp.copy(f.p).add(new THREE.Vector3(-kk * OV.satR * 7, 0, 0)).applyQuaternion(OV.qLv);
          sp.position.copy(tmp); sp.scale.setScalar(OV.satR * (1.1 - kk * 0.8)); sp.visible = fI > 0.01;
          sp.material.opacity = fI * (1 - kk) * (0.7 + 0.3 * Math.sin(L.rt * 37 + fi + k));
        });
      });
      OV.alert = h > 135e3 ? 'Coasting down after the deorbit burn' : !broken ? 'Reentry: plasma at about 1,600 °C' : s < 1 ? 'Breaking apart at 78 km' : '';
      if (s >= 1) {
        L.stage = 'done'; L.doneAt = OV.simT; L.path.visible = false; L.x.visible = false;
        OV.scene.remove(L.fx.g); L.fx = null; OV.autoWarp = 1;
        L.splash = placeOnEarth(curvedDisc(260e3, new THREE.MeshBasicMaterial({ map: ringTex('#ffffff'), transparent: true, depthWrite: false }), 4e3), L.impact, 4e3);
        L.g.add(L.splash);
        camFacing(earthToEci(L.impact, new THREE.Vector3()), 1.7e7);
        OV.glow.material.uniforms.uOp.value = 1;
      }
      return;
    }
    if (L.stage === 'done' && L.splash) {
      const k = ((OV.last || 0) * 0.6) % 1;
      L.splash.scale.setScalar(0.3 + k * 1.4); L.splash.material.opacity = 1 - k;
      OV.alert = '';
    }
  }

  // ---------- Events you can see: debris, solar storms, hurricanes, fires, eruptions, the ozone hole ----------
  function startEvent(e) {
    if (e.stage === 'resolve' && OV.ev && OV.ev.id === e.id && OV.ev.stage === 'pending') {
      Object.assign(OV.ev, { stage: 'resolve', rt: 0, opt: e.opt, alive: e.alive });
      return;
    }
    endEvent();
    const ev = OV.ev = { id: e.id, stage: e.stage, rt: 0, opt: e.opt, alive: e.alive, g: new THREE.Group(), ge: new THREE.Group(), labels: [] };
    OV.scene.add(ev.g); OV.earth.add(ev.ge);
    const site = SITES[e.id];
    if (site) { ev.dir = llDir(site[0], site[1]); ev.label = site[2]; }
    if (e.id === 'debris') {
      ev.debris = makeDebrisStage(); ev.g.add(ev.debris);
      ev.miss = new THREE.Vector3(0, 35, 200); ev.vdir = new THREE.Vector3(-0.62, -0.04, -0.78).normalize(); ev.tau = -2600;
      ev.spin = new THREE.Vector3(0.21, 0.13, 0.07);
      ev.pathPos = new Float32Array(6);
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(ev.pathPos, 3));
      ev.path = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff5d4d, transparent: true, opacity: 0.55, depthWrite: false })); ev.path.frustumCulled = false; ev.g.add(ev.path);
      ev.mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex('#ff5d4d'), transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
      ev.mark.scale.setScalar(0.035); ev.mark.renderOrder = 10; ev.g.add(ev.mark);
      camTo(-2.3, 0.16, Math.max(380, OV.satR * 40));
    } else if (e.id === 'solarStorm') {
      const n = 700, pos = new Float32Array(n * 3);
      for (let i = 0; i < n * 3; i++) pos[i] = hash(i + 900) * 2 - 1;
      ev.unit = pos.slice();
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      ev.wind = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffcf8a, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      ev.wind.frustumCulled = false; ev.g.add(ev.wind);
      ev.aur = [];
      for (const sgn of [1, -1]) {
        const la = 67 * Math.PI / 180, rr = (RE_M + 100e3) * Math.cos(la);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.97, rr, 320e3, 160, 1, true), auroraMat());
        m.position.y = sgn * ((RE_M + 100e3) * Math.sin(la) + 160e3 - 40e3);
        if (sgn < 0) m.rotation.x = Math.PI;
        ev.ge.add(m); ev.aur.push(m);
      }
      camTo(OV.cam.az, OV.cam.el, Math.max(Math.exp(OV.cam.ld), 2.2e7));
      camFacing(new THREE.Vector3(0.35, 0.75, 0.55).normalize(), 2.2e7, 0);
    } else if (e.id === 'hurricane') {
      ev.disc = curvedDisc(650e3, new THREE.MeshStandardMaterial({ map: spiralTex(), transparent: true, depthWrite: false, roughness: 1, opacity: 0 }), 13e3);
      ev.spinner = new THREE.Group(); ev.spinner.add(ev.disc); ev.ge.add(placeOnEarth(ev.spinner, ev.dir, 13e3)); ev.disc.position.set(0, 0, 0);
    } else if (e.id === 'wildfire') {
      const grp = placeOnEarth(new THREE.Group(), ev.dir, 2e3); ev.ge.add(grp);
      const fm = new THREE.SpriteMaterial({ map: softTex('rgba(255,150,40,1)', 'rgba(255,60,10,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      ev.fires = [];
      for (let i = 0; i < 16; i++) { const s = new THREE.Sprite(fm.clone()); s.position.set((hash(i + 50) - 0.5) * 420e3, (hash(i + 60) - 0.5) * 300e3, 4e3); grp.add(s); ev.fires.push(s); }
      ev.smoke = curvedDisc(520e3, new THREE.MeshStandardMaterial({ map: softTex('rgba(150,140,130,0.9)', 'rgba(120,110,100,0)'), transparent: true, depthWrite: false, opacity: 0 }), 9e3);
      const sm = placeOnEarth(new THREE.Group(), llDir(53, -100), 9e3); sm.add(ev.smoke); ev.smoke.scale.set(1.6, 0.6, 1); ev.ge.add(sm);
    } else if (e.id === 'volcano') {
      ev.umb = curvedDisc(280e3, new THREE.MeshStandardMaterial({ map: softTex('rgba(235,232,228,1)', 'rgba(200,198,196,0)'), transparent: true, depthWrite: false, opacity: 0 }), 40e3);
      const ug = placeOnEarth(new THREE.Group(), ev.dir, 40e3); ug.add(ev.umb); ev.ge.add(ug);
      ev.col = new THREE.Mesh(new THREE.CylinderGeometry(22e3, 34e3, 40e3, 20), new THREE.MeshStandardMaterial({ color: 0xcfcac4, transparent: true, opacity: 0 }));
      ev.col.rotation.x = Math.PI / 2; ev.col.position.z = -20e3;
      ug.add(ev.col);
    } else if (e.id === 'ozoneHole') {
      const tex = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(140,80,255,0.75)'); gr.addColorStop(0.6, 'rgba(90,110,255,0.5)'); gr.addColorStop(1, 'rgba(60,160,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
      ev.cap = curvedDisc(2600e3, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }), 22e3);
      ev.ge.add(placeOnEarth(new THREE.Group().add(ev.cap), ev.dir, 22e3));
    } else if (e.id === 'groundOutage') {
      OV.offline = 'Svalbard';
    }
    if (site && e.stage === 'pending') camFacing(earthToEci(ev.dir, new THREE.Vector3()), e.id === 'ozoneHole' ? 2.3e7 : 2.0e7);
  }
  function endEvent() {
    const ev = OV.ev; if (!ev) return;
    OV.scene.remove(ev.g); OV.earth.remove(ev.ge);
    if (ev.id === 'groundOutage') OV.offline = null;
    OV.ev = null; OV.alert = '';
  }
  function burnFx(dirScene, power) {
    OV.plume.visible = power > 0.01;
    if (!OV.plume.visible) return;
    const ion = OV.opts.build && OV.opts.build.engine === 'ion';
    OV.plume.material.color.setHex(ion ? 0x7fb8ff : 0xffc27a);
    OV.plume.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dirScene);
    OV.plume.position.copy(dirScene).multiplyScalar(OV.satR * 0.45);
    OV.plume.scale.set(OV.satR * 0.12, OV.satR * (0.25 + 0.05 * Math.sin(OV.last * 50)), OV.satR * 0.12);
    OV.plume.material.opacity = 0.75 * power;
  }
  function lv(x, y, z) { return new THREE.Vector3(x, y, z).applyQuaternion(OV.qLv); }

  function updateEvent(dtR) {
    const ev = OV.ev; if (!ev) return;
    ev.rt += dtR;
    const res = ev.stage === 'resolve';
    let fade = res ? 1 - smooth(26, 30, ev.rt) : smooth(0, 1.5, ev.rt);
    if (ev.id === 'debris') {
      if (!res) { ev.tau = Math.min(-1100, -2600 + ev.rt * 90); OV.alert = 'Debris alert: an old rocket stage will pass within 200 m'; }
      else {
        const dodge = ev.opt === 0, hit = !ev.alive;
        if (dodge && ev.rt < 2.6) { burnFx(lv(0, 0, 1), smooth(0, 0.2, ev.rt) * (1 - smooth(2.3, 2.6, ev.rt))); ev.miss.z += dtR * 330; }
        else burnFx(null, 0);
        if (hit) ev.miss.multiplyScalar(Math.max(0, 1 - dtR * 3));
        if (!dodge || ev.rt > 1.6) ev.tau += dtR * 950;
        const before = ev.prevTau === undefined ? ev.tau : ev.prevTau; ev.prevTau = ev.tau;
        if (hit && before < 0 && ev.tau >= 0 && !ev.boom) startBoom(ev);
        OV.alert = hit ? (ev.boom ? 'Impact: the satellite broke apart' : 'Debris incoming (shown slowed down)') : dodge && ev.rt < 2.6 ? 'Dodging: thrusters firing' : ev.tau < 2400 ? 'Debris passing (shown slowed down)' : '';
        if (ev.tau > 2600 && (!ev.boom || ev.rt > 14)) { endEvent(); if (!hit) viewPreset('close'); return; }
      }
      const p = ev.vdir.clone().multiplyScalar(ev.tau).add(ev.miss);
      ev.debris.position.copy(lv(p.x, p.y, p.z));
      ev.debris.rotation.x += ev.spin.x * dtR; ev.debris.rotation.z += ev.spin.z * dtR;
      ev.debris.visible = ev.tau < 2600;
      const a = ev.vdir.clone().multiplyScalar(-3000).add(ev.miss), b = ev.vdir.clone().multiplyScalar(3000).add(ev.miss);
      const A = lv(a.x, a.y, a.z), B = lv(b.x, b.y, b.z);
      ev.pathPos.set([A.x, A.y, A.z, B.x, B.y, B.z]); ev.path.geometry.attributes.position.needsUpdate = true;
      ev.path.visible = !res; ev.mark.position.copy(ev.debris.position); ev.mark.visible = Math.exp(OV.cam.ld) > 150 && ev.tau < 0;
      ev.labels = [['deb', 'Old rocket stage · about 1,500 kg', ev.debris.position.clone(), false]];
      if (ev.boom) updateBoom(ev, dtR);
      return;
    }
    if (res && ev.rt > 30) { endEvent(); return; }
    const t = OV.last || 0;
    if (ev.id === 'solarStorm') {
      const d = Math.exp(OV.cam.ld), Lb = clamp(d * 2.5, 60, 4e7), tgt = OV.camTgt || new THREE.Vector3();
      const p = ev.wind.geometry.attributes.position, sd = OV.sunDir;
      for (let i = 0; i < p.count; i++) {
        let x = ev.unit[i * 3] - sd.x * dtR * 0.7, y = ev.unit[i * 3 + 1] - sd.y * dtR * 0.7, z = ev.unit[i * 3 + 2] - sd.z * dtR * 0.7;
        if (x < -1) x += 2; if (x > 1) x -= 2; if (y < -1) y += 2; if (y > 1) y -= 2; if (z < -1) z += 2; if (z > 1) z -= 2;
        ev.unit[i * 3] = x; ev.unit[i * 3 + 1] = y; ev.unit[i * 3 + 2] = z;
        p.setXYZ(i, tgt.x + x * Lb, tgt.y + y * Lb, tgt.z + z * Lb);
      }
      p.needsUpdate = true;
      ev.wind.material.opacity = 0.8 * fade;
      ev.aur.forEach(m => { m.material.uniforms.uOp.value = 1.4 * fade; m.material.uniforms.uT.value = t; });
      OV.alert = !res ? 'Solar storm: particles from the Sun are arriving' : ev.opt === 0 ? 'Safe mode: instruments off until the storm passes' : 'Solar storm passing';
      ev.labels = [['aur', 'Aurora (northern lights)', earthToEci(new THREE.Vector3(0, 1, 0), new THREE.Vector3()).multiplyScalar(RE_M * 1.05).add(OV.earthC), false]];
      return;
    }
    if (ev.id === 'hurricane') { ev.disc.material.opacity = 0.95 * fade; ev.disc.rotation.z = -t * 0.15; OV.alert = res ? '' : 'Hurricane forming in the Atlantic'; }
    if (ev.id === 'wildfire') {
      ev.fires.forEach((s, i) => { s.scale.setScalar((55e3 + 30e3 * Math.sin(t * 3 + i)) * fade); s.material.opacity = fade; });
      ev.smoke.material.opacity = 0.75 * fade; OV.alert = res ? '' : 'Wildfires burning in western Canada';
    }
    if (ev.id === 'volcano') {
      const grow = smooth(0, 6, ev.rt + (res ? 6 : 0));
      ev.umb.material.opacity = 0.9 * fade; ev.umb.scale.setScalar(0.3 + 0.7 * grow); ev.col.material.opacity = 0.9 * fade;
      OV.alert = res ? '' : 'Eruption: the plume reaches more than 50 km high';
    }
    if (ev.id === 'ozoneHole') { ev.cap.material.opacity = fade; OV.alert = res ? '' : 'Ozone hole opening over Antarctica'; }
    if (ev.id === 'groundOutage') {
      OV.offline = res && ev.opt === 0 ? null : 'Svalbard';
      OV.alert = OV.offline ? 'Svalbard ground station offline' : '';
    }
    if (ev.id === 'orbitDecay') {
      if (!res) { OV.rOff = Math.max(-900, OV.rOff - dtR * 300); OV.alert = 'Drag is pulling the orbit down'; }
      else if (ev.opt === 0) {
        burnFx(OV.vel.clone().negate(), ev.rt < 3 ? smooth(0, 0.2, ev.rt) * (1 - smooth(2.7, 3, ev.rt)) : 0);
        OV.rOff = Math.min(0, OV.rOff + dtR * 400); OV.alert = ev.rt < 3 ? 'Boost burn' : '';
        if (ev.rt > 5) { endEvent(); return; }
      } else if (ev.rt > 3) { endEvent(); return; }
    }
    if (ev.dir) ev.labels = [['site', ev.label, earthToEci(ev.dir, new THREE.Vector3()).multiplyScalar(RE_M + 30e3).add(OV.earthC), true]];
  }
  function startBoom(ev) {
    OV.destroyed = true;
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex('rgba(255,250,235,1)', 'rgba(255,190,90,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    ev.g.add(fl);
    const n = 500, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = new THREE.Vector3(hash(i + 1) - 0.5, hash(i + 2) - 0.5, hash(i + 3) - 0.5).normalize().multiplyScalar(4 + hash(i + 4) * 40); vel.set([v.x, v.y, v.z], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc070, size: 2.5, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false; ev.g.add(pts);
    const chunks = [], cols = [0xd4a640, 0x1d3c78, 0x8a8f99];
    for (let i = 0; i < 14; i++) {
      const s = OV.satR * (0.08 + hash(i + 70) * 0.22);
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.3, s * 0.7), new THREE.MeshStandardMaterial({ color: cols[i % 3], metalness: 0.5, roughness: 0.5 }));
      ev.g.add(m);
      chunks.push({ m, v: new THREE.Vector3(hash(i + 80) - 0.5, hash(i + 81) - 0.5, hash(i + 82) - 0.5).normalize().multiplyScalar(3 + hash(i + 83) * 12), w: new THREE.Vector3(hash(i + 84), hash(i + 85), hash(i + 86)) });
    }
    ev.boom = { t: 0, fl, pts, pos, vel, chunks };
  }
  function updateBoom(ev, dtR) {
    const B = ev.boom; B.t += dtR;
    B.fl.scale.setScalar(OV.satR * (4 + B.t * 30)); B.fl.material.opacity = Math.max(0, 1 - B.t * 1.3);
    for (let i = 0; i < B.pos.length; i++) B.pos[i] = B.vel[i] * B.t;
    B.pts.geometry.attributes.position.needsUpdate = true; B.pts.material.opacity = Math.max(0, 1 - B.t / 12);
    B.chunks.forEach(c => { c.m.position.copy(c.v).multiplyScalar(B.t); c.m.rotation.x += c.w.x * dtR * 2; c.m.rotation.y += c.w.y * dtR * 2; });
  }

  // Disposal moves that are not a landing: lower the orbit, or boost it out of the way
  function updateTransfer(dtR) {
    const X = OV.xfer; if (!X) return;
    X.rt += dtR;
    const s = clamp((OV.simT - X.t0) / X.dur, 0, 1);
    OV.r = lerp(X.from, X.to, s * s * (3 - 2 * s));
    const up = X.to > X.from;
    burnFx(up ? OV.vel.clone().negate() : OV.vel.clone(), X.rt < 3.5 ? smooth(0, 0.3, X.rt) * (1 - smooth(3.1, 3.5, X.rt)) : 0);
    OV.autoWarp = s < 1 ? 120 : null;
    OV.alert = s < 1 ? (up ? 'Boosting above 2,000 km' : 'Lowering the orbit into the upper air') : '';
    if (s >= 1 && !X.done) { X.done = true; OV.plume.visible = false; }
  }

  function setLabel(key, text, p, surface) {
    let el = OV.labelEls[key];
    if (!el) { el = OV.labelEls[key] = document.createElement('div'); el.className = 'ov-label' + (key === 'sat' ? ' sat' : key === 'deb' ? ' warn' : ''); OV.labelBox.appendChild(el); }
    if (el.textContent !== text) el.textContent = text;
    const cam = OV.cam3, w = host.clientWidth, h = host.clientHeight;
    let hidden = false;
    if (surface) hidden = p.clone().sub(OV.earthC).dot(cam.position.clone().sub(p)) < 0;
    else {   // is the Earth between the camera and the point?
      const d = p.clone().sub(cam.position), len = d.length(); d.divideScalar(len);
      const oc = OV.earthC.clone().sub(cam.position), tca = oc.dot(d);
      if (tca > 0 && tca < len && oc.lengthSq() - tca * tca < (RE_M - 5e3) * (RE_M - 5e3)) hidden = true;
    }
    const v = p.clone().project(cam);
    if (hidden || v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px)`;
    OV.labelUsed[key] = true;
  }

  function drawOrbitView(nowMs) {
    const now = nowMs / 1000, dtR = Math.min(0.1, Math.max(0, now - (OV.last || now))); OV.last = now;
    const o = OV.opts, w = host.clientWidth, h = host.clientHeight;
    const warp = OV.autoWarp || OV.warp, dts = dtR * warp;
    OV.simT += dts;
    // where the satellite is
    const L = OV.land;
    if (L && (L.stage === 'reentry' || L.stage === 'done')) {
      const s = clamp((OV.simT - L.t0) / DEORBIT_T, 0, 1);
      OV.u = L.uB + (DEORBIT_DU + L.dU) * s; OV.r = RE_M + reentryAlt(s);
    } else {
      OV.u += Math.sqrt(MU / Math.pow(OV.r + OV.rOff, 3)) * dts;
    }
    OV.n = Math.sqrt(MU / Math.pow(OV.r, 3));
    updateTransfer(dtR);
    const r = OV.r + OV.rOff;
    orbitDir(OV.u, OV.dir); velDir(OV.u, OV.vel);
    if (L && L.stage !== 'aim' && L.xr) OV.dir.applyAxisAngle(OV.vel, L.xr * clamp((OV.simT - L.t0) / DEORBIT_T, 0, 1));
    OV.pos.copy(OV.dir).multiplyScalar(r);
    OV.earthC.copy(OV.pos).negate();
    OV.world.position.copy(OV.earthC);
    const theta = OV.th0 + W_EARTH * OV.simT;
    OV.earth.rotation.y = theta;
    OV.clouds.rotation.y = OV.simT * 2e-6;
    // local frame: x along the track, y straight up, z to the side
    const Z = new THREE.Vector3().crossVectors(OV.vel, OV.dir);
    OV.mLv.makeBasis(OV.vel, OV.dir, Z); OV.qLv.setFromRotationMatrix(OV.mLv);
    OV.hemi.position.copy(OV.dir);
    // the satellite: instruments face Earth, unless it is dead and tumbling
    const sat = OV.sat, dead = !o.alive || o.disposal === 'none';
    sat.visible = !OV.satHidden && !OV.destroyed && !(L && L.stage === 'done');
    if (!dead) { sat.up.copy(OV.vel); sat.lookAt(OV.earthC); }
    else { sat.rotation.x += dtR * 0.12; sat.rotation.y += dtR * 0.07; sat.rotation.z += dtR * 0.05; }
    if (L) updateLanding(dtR);
    updateEvent(dtR);
    if (!OV.ev && !OV.xfer && !(L && (L.stage === 'reentry' || L.stage === 'aim')) && !OV.burn) OV.plume.visible = false;
    if (OV.burn) { OV.burn.rt += dtR; burnFx(OV.vel.clone(), smooth(0, 0.2, OV.burn.rt) * (1 - smooth(OV.burn.dur - 0.3, OV.burn.dur, OV.burn.rt))); if (OV.burn.rt > OV.burn.dur) { OV.burn = null; OV.plume.visible = false; } }
    // ground track: the line on the ground right under the satellite, fixed to the turning Earth
    const local = OV.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -theta);
    const flying = !(L && L.stage !== 'aim') && !OV.destroyed;
    if (flying && OV.simT - OV.lastTrackT > 30) {
      OV.lastTrackT = OV.simT;
      if (OV.trackCount >= OV.trackN) { OV.trackPos.copyWithin(0, 3); OV.trackCount = OV.trackN - 1; }
      const tp = local.clone().multiplyScalar(RE_M + 6e3);
      OV.trackPos.set([tp.x, tp.y, tp.z], OV.trackCount * 3); OV.trackCount++;
      OV.track.geometry.setDrawRange(0, OV.trackCount); OV.track.geometry.attributes.position.needsUpdate = true;
    }
    // radio contact when a ground station sees the satellite at least 5 degrees above its horizon
    let contact = null;
    if (o.alive && !dead && flying && !(L && L.stage !== 'aim')) for (const st of OV.stations) if (st.name !== OV.offline && local.dot(st.dir) > Math.cos(0.42)) { contact = st; break; }
    for (const st of OV.stations) {
      const on = st === contact, k = (now * 1.6) % 1, off = st.name === OV.offline;
      st.ring.scale.setScalar(on ? 1 + k * 3 : 1);
      st.ring.material.opacity = on ? 1 - k : off ? 0.15 : 0.55;
      st.pin.material.color.setHex(off ? 0x555b66 : 0xff5d4d);
    }
    OV.beam.visible = !!contact;
    if (contact) {
      const sp = contact.g.getWorldPosition(new THREE.Vector3());
      OV.beam.geometry.attributes.position.setXYZ(0, 0, 0, 0);
      OV.beam.geometry.attributes.position.setXYZ(1, sp.x, sp.y, sp.z);
      OV.beam.geometry.attributes.position.needsUpdate = true;
      OV.data += dts * (o.rate || 1) / 8000;                // Mbps -> GB
    }
    // camera: close up it rides with the satellite (Earth below); zoomed out it switches to a fixed view of the orbit
    const C = OV.cam, a = 1 - Math.exp(-dtR * 3.2);
    C.az += (C.azT - C.az) * a; C.el += (C.elT - C.el) * a; C.ld += (C.ldT - C.ld) * a;
    const d = Math.exp(C.ld), l10 = C.ld / Math.LN10;
    const kR = smooth(4.3, 6.8, l10), kT = smooth(6.85, 7.35, l10);
    OV.qF.copy(OV.qLv).slerp(OV.qI, kR);
    const tgt = OV.camTgt = OV.earthC.clone().multiplyScalar(kT);
    const off = new THREE.Vector3(Math.cos(C.el) * Math.sin(C.az), Math.sin(C.el), Math.cos(C.el) * Math.cos(C.az)).applyQuaternion(OV.qF).multiplyScalar(d);
    const cp = tgt.clone().add(off), rel = cp.clone().sub(OV.earthC);
    const minR = RE_M + Math.max(25e3, Math.min(d * 0.45, 4e6));      // stay well above the ground while zooming
    if (rel.length() < minR && d > 2e3) cp.copy(OV.earthC).add(rel.setLength(minR));
    const cam = OV.cam3;
    cam.position.copy(cp); cam.up.set(0, 1, 0).applyQuaternion(OV.qF); cam.lookAt(tgt);
    cam.near = clamp(d * 0.01, 0.05, 2e4); cam.aspect = w / h; cam.updateProjectionMatrix();
    OV.sky.position.copy(cam.position);
    if (!(L && L.stage === 'reentry')) OV.glow.material.uniforms.uOp.value = lerp(0.3, 1, smooth(2e5, 6e6, d));
    OV.marker.visible = sat.visible && d > 300;
    OV.marker.material.opacity = smooth(300, 1500, d);
    OV.ring.material.opacity = 0.32 * smooth(2e4, 4e5, d) * (L && L.stage !== 'aim' ? 0 : 1);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.render(OV.scene, cam);
    // labels
    OV.labelUsed = {};
    if (OV.labelBox) {
      if (OV.marker.visible) setLabel('sat', 'Your satellite', new THREE.Vector3(), false);
      if (OV.ev && OV.ev.labels) for (const [k, txt, p, surf] of OV.ev.labels) setLabel(k, txt, p, surf);
      if (L) {
        setLabel('nemo', 'Safe zone: Point Nemo', earthToEci(L.nemo, new THREE.Vector3()).multiplyScalar(RE_M + 20e3).add(OV.earthC), true);
        if (L.stage === 'aim') setLabel('x', 'Predicted landing', earthToEci(L.pred, new THREE.Vector3()).multiplyScalar(RE_M + 20e3).add(OV.earthC), true);
        if (L.stage === 'done') setLabel('x', `Splashdown · ${fmtKm(L.dist)} from Point Nemo`, earthToEci(L.impact, new THREE.Vector3()).multiplyScalar(RE_M + 20e3).add(OV.earthC), true);
      }
      for (const k in OV.labelEls) if (!OV.labelUsed[k]) OV.labelEls[k].style.display = 'none';
    }
    const ll = L && L.impact ? [Math.asin(clamp(L.impact.y, -1, 1)) * 180 / Math.PI, Math.atan2(-L.impact.z, L.impact.x) * 180 / Math.PI] : [0, 0];
    const landInfo = L ? { stage: L.stage, distKm: L.dist || 0, inZone: !!L.inZone, nextWin: L.win, alt: Math.round((OV.r - RE_M) / 1000), fuel: L.fuel, canSteer: L.stage === 'aim' || !!L.canSteer } : null;
    hooks.onTick && hooks.onTick({
      contact: contact ? contact.name : null, data: OV.data, orbit: Math.floor(OV.simT / OV.period) + 1,
      alt: Math.max(0, Math.round((r - RE_M) / 1000)), speed: Math.sqrt(MU / Math.max(r, RE_M)) / 1000, clock: OV.simT,
      warp, userWarp: OV.warp, auto: !!OV.autoWarp, period: OV.period, alert: OV.alert,
      land: landInfo, landDone: L && L.stage === 'done' ? { inZone: L.inZone, distKm: L.dist, lat: ll[0], lon: ll[1] } : null,
      ended: !!(OV.xfer && OV.xfer.done)
    });
  }
  const fmtKm = (km) => `${Math.round(km).toLocaleString('en-US')} km`;

  function leaveOrbit() {
    if (mode !== 'orbitview') return;
    mode = 'cinematic';
    if (OV && OV.labelBox && OV.labelBox.parentNode) OV.labelBox.parentNode.removeChild(OV.labelBox);
  }

  // ---------- Live view of your satellite (flight screen) ----------

  let satView = null, planets = null;

  function planetTexture(kind) {
    const W = 1024, H = 512;
    const t = canvasTex(W, H, (g) => {
      const img = g.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const lat = (0.5 - y / H) * Math.PI;
        for (let x = 0; x < W; x++) {
          const lon = (x / W) * Math.PI * 2;
          const px = Math.cos(lat) * Math.cos(lon), py = Math.sin(lat), pz = Math.cos(lat) * Math.sin(lon);
          let r, gg, b;
          if (kind === 'mars') {
            const n = fbm3(px * 3 + 2, py * 3, pz * 3, 5), d = fbm3(px * 9, py * 9, pz * 9, 3);
            r = 150 + 70 * n - 30 * d; gg = 70 + 40 * n - 20 * d; b = 40 + 20 * n;
            if (Math.abs(lat) > 1.35) { r = gg = b = 235; }
          } else if (kind === 'jupiter') {
            const turb = fbm3(px * 4, py * 14, pz * 4, 4), tt = 0.5 + 0.5 * Math.sin(lat * 14 + turb * 3.2);
            r = lerp(170, 236, tt); gg = lerp(120, 214, tt); b = lerp(80, 180, tt);
            if (Math.hypot((lon - 4.0) * 0.6, (lat + 0.38) * 2.2) < 0.18) { r = 196; gg = 92; b = 62; }
          } else {
            const n = fbm3(px * 6, py * 6, pz * 6, 4);
            r = gg = lerp(190, 235, n); b = lerp(180, 222, n);
            if (Math.abs(Math.sin(px * 30 + py * 14 + n * 6)) < 0.06) { r = 150; gg = 95; b = 60; }
          }
          const i = (y * W + x) * 4;
          img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function ensurePlanets() {
    if (planets) return planets;
    const mk = (kind, radius) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 64), new THREE.MeshStandardMaterial({ map: planetTexture(kind), roughness: 0.95 }));
      m.visible = false; scene.add(m); return m;
    };
    planets = { mars: mk('mars', 3390 * KM), jupiter: mk('jupiter', 2.0e6), europa: mk('europa', 1.1e5) };
    return planets;
  }

  function leaveSat() {
    if (mode !== 'sat') return;
    finishAssembly(); asm.prev = null; if (asm.weld) asm.weld.visible = false;
    mode = 'cinematic'; controls.autoRotate = false; satView = null;
    earthMesh.visible = earthClouds.visible = atmoMesh.visible = true;
    if (planets) for (const k in planets) planets[k].visible = false;
  }

  // ---------- Your rocket: built from the Rocket Designer settings ----------
  // Same overall size as the ORBITER-1 model (1 unit = 2.4 m), so every launch camera shot still frames it.
  const RK = { R: 0.9, FR: 1.3, FAIR_BASE: 21.4, CYL: 4.0 };
  function rocketLayout(n) {
    if (n === 1) return { tanks: [[0, 21.4]], inter: [], bells: [] , s2FlameY: 21.35 };
    if (n === 2) return { tanks: [[0, 15.0], [17.2, 21.4]], inter: [[15.0, 17.2]], bells: [[15.08, 1.45]], s2FlameY: 15.08 };
    return { tanks: [[0, 12.2], [13.9, 17.6], [18.5, 21.4]], inter: [[12.2, 13.9], [17.6, 18.5]], bells: [[12.3, 1.45], [17.62, 0.8]], s2FlameY: 12.3 };
  }
  function engineLayout(N) {
    const pts = [], ring = (count, r, a0 = 0) => { for (let i = 0; i < count; i++) { const a = a0 + i / count * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } };
    let rb;
    if (N === 1) { pts.push([0, 0]); rb = 0.42; }
    else if (N <= 4) { ring(N, 0.42, Math.PI / 4); rb = 0.3; }
    else if (N <= 9) { pts.push([0, 0]); ring(N - 1, 0.6); rb = N <= 7 ? 0.24 : 0.19; }
    else { pts.push([0, 0]); const inner = 6; ring(inner, 0.33); ring(N - 1 - inner, 0.68, 0.2); rb = Math.min(0.15, Math.PI * 0.68 / (N - 1 - inner) * 0.85); }
    return { pts, rb };
  }
  function noseProfile(type) {
    const R = RK.FR, out = [];
    const L = type === 'blunt' ? 1.5 : type === 'conical' ? 3.4 : 3.7;
    for (let i = 0; i <= 24; i++) {
      const h = i / 24 * L;
      let r;
      if (type === 'conical') r = R * (1 - h / L);
      else if (type === 'blunt') r = R * Math.sqrt(Math.max(0, 1 - Math.pow(h / L, 2)));
      else { const rho = (R * R + L * L) / (2 * R); r = Math.sqrt(Math.max(0, rho * rho - h * h)) + R - rho; }   // tangent ogive
      out.push(new THREE.Vector2(Math.max(0, r), RK.CYL + h));
    }
    return { pts: out, L };
  }
  let RKMAT = null;
  function rocketMats() {
    if (RKMAT) return RKMAT;
    const MA = M.MATS;
    RKMAT = {
      white: MA.white_paint, black: MA.carbon_black, seam: MA.seam_gray, red: MA.accent_red, nozzle: MA.nozzle_dark, copper: MA.copper, ti: MA.titanium,
      steel: new THREE.MeshStandardMaterial({ name: 'stainless_steel', color: 0xc9cdd3, roughness: 0.26, metalness: 1 }),
      fair: MA.white_paint.clone()
    };
    RKMAT.fair.side = THREE.DoubleSide;
    return RKMAT;
  }
  // Builds every visible part of the rocket. Each part is a group anchored at its base, so it can grow upward.
  function makeRocketParts(d) {
    const mt = rocketMats(), L = rocketLayout(d.stages), parts = new Map();
    const s1 = new THREE.Group(), s2 = new THREE.Group();
    s1.name = 'your_rocket_stage_1'; s2.name = 'your_rocket_upper_stages';
    const body = d.fuelType === 'methane' ? mt.steel : mt.white;
    const part = (key, parent, y) => { const g = new THREE.Group(); g.position.y = y; g.name = key; parent.add(g); parts.set(key, { g, kind: 'grow' }); return g; };
    const mesh = (geo, mat, g, y, name) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.name = name || ''; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    // engines
    const E = engineLayout(d.engines), thrustK = clamp(0.85 + d.thrust / 7000, 0.85, 1.15);
    const bellPts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; bellPts.push(new THREE.Vector2(0.42 + 0.58 * Math.pow(t, 0.7), -t * 0.72)); }
    const bellGeo = new THREE.LatheGeometry(bellPts, 28);
    const engines = [];
    E.pts.forEach(([x, z], i) => {
      const g = new THREE.Group(); g.position.set(x, -0.59, z); g.name = 'engine_' + (i + 1); s1.add(g);
      const rb = E.rb * thrustK;
      const bell = new THREE.Mesh(bellGeo, mt.nozzle); bell.scale.set(rb, 1, rb); g.add(bell);
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(rb * 0.42, rb * 0.5, 0.2, 18), mt.copper); ch.position.y = 0.1; g.add(ch);
      parts.set('eng:' + i, { g, kind: 'pop' });
      engines.push({ x, z, rb });
    });
    // thrust structure under stage 1
    const thr = part('thrust_structure', s1, -0.5);
    mesh(new THREE.CylinderGeometry(RK.R * 0.97, RK.R * 0.92, 0.5, 40), mt.black, thr, 0.25, 'thrust_structure');
    // stage tanks, with stiffening rings (more for a stronger structure)
    const rings = { light: 1, standard: 2, heavy: 4 }[d.strength] || 2;
    L.tanks.forEach(([y0, y1], k) => {
      const g = part(`tank:${k}:${d.fuelType}:${d.stages}`, k === 0 ? s1 : s2, y0), h = y1 - y0;
      mesh(new THREE.CylinderGeometry(RK.R, RK.R, h, 48), body, g, h / 2, `stage_${k + 1}_tank`);
      if (k === 0 && d.fuelType !== 'methane') mesh(new THREE.CylinderGeometry(RK.R + 0.004, RK.R + 0.004, 0.35, 48), mt.black, g, 0.6, 'base_band');
      if (d.fuelType === 'solid') for (let j = 1; j < 4; j++) mesh(new THREE.CylinderGeometry(RK.R + 0.02, RK.R + 0.02, 0.12, 48), mt.seam, g, h * j / 4, 'segment_joint');
      for (let j = 1; j <= rings; j++) mesh(new THREE.CylinderGeometry(RK.R + 0.012, RK.R + 0.012, 0.05, 48), d.fuelType === 'methane' ? mt.seam : mt.ti, g, h * j / (rings + 1), 'stiffener');
      if (k === 0) mesh(new THREE.CylinderGeometry(RK.R + 0.006, RK.R + 0.006, 0.22, 48), mt.red, g, h - 1.2, 'stripe');
    });
    // interstages (dark, like carbon) with the upper-stage engine bell inside
    L.inter.forEach(([y0, y1], k) => {
      const g = part(`inter:${k}:${d.stages}`, k === 0 ? s1 : s2, y0);
      const m = mesh(new THREE.CylinderGeometry(RK.R, RK.R, y1 - y0, 48, 1, true), d.fuelType === 'methane' ? mt.steel : mt.black, g, (y1 - y0) / 2, 'interstage');
      m.material = m.material.clone(); m.material.side = THREE.DoubleSide;
    });
    L.bells.forEach(([y0, h], k) => {
      const g = part(`vac:${k}:${d.stages}`, s2, y0);
      const vb = new THREE.Mesh(new THREE.LatheGeometry(bellPts.map(p => new THREE.Vector2(p.x * 0.75, h + p.y * (h / 0.72))), 32), mt.nozzle); vb.scale.set(0.95, 1, 0.95); g.add(vb);
      parts.get(`vac:${k}:${d.stages}`).kind = 'pop';
    });
    // payload adapter
    const pa = part('adapter', s2, 21.4);
    mesh(new THREE.CylinderGeometry(0.6, RK.R, 0.5, 40), mt.ti, pa, 0.25, 'payload_adapter');
    // fins at the base (they move the center of pressure down and keep the rocket stable)
    const span = [0, 0.55, 0.9, 1.3][d.fins] || 0, root = [0, 1.6, 2.3, 3.0][d.fins] || 0;
    if (span > 0) for (let i = 0; i < 4; i++) {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(span, 0.05); sh.lineTo(span, root * 0.4); sh.lineTo(0, root); sh.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false }); geo.translate(0, 0, -0.035);
      const g = new THREE.Group(); g.position.set(0, 0.05, 0); g.rotation.y = i * Math.PI / 2 + Math.PI / 4; g.name = 'fin_' + (i + 1); s1.add(g);
      const m = new THREE.Mesh(geo, d.fuelType === 'methane' ? mt.steel : mt.black); m.position.x = RK.R - 0.02; m.castShadow = true; g.add(m);
      parts.set(`fin:${i}:${d.fins}`, { g, kind: 'pop' });
    }
    // fairing halves: a cylinder around the satellite, topped with your nose shape
    const nose = noseProfile(d.nose);
    const prof = [new THREE.Vector2(RK.FR, 0), new THREE.Vector2(RK.FR, RK.CYL)].concat(nose.pts.slice(1));
    const halves = [0, Math.PI].map((phi, i) => {
      const geo = new THREE.LatheGeometry(prof, 40, phi, Math.PI); geo.translate(0, RK.FAIR_BASE, 0);
      const m = new THREE.Mesh(geo, mt.fair); m.name = i === 0 ? 'fairing_right' : 'fairing_left'; m.castShadow = true;
      return m;
    });
    const noseTop = RK.FAIR_BASE + RK.CYL + nose.L;
    return { s1, s2, halves, engines, parts, s2FlameY: L.s2FlameY, noseTop, noseKey: `nose:${d.nose}` };
  }

  // Swap the launch rocket for the one you designed (the satellite on top stays the same)
  function applyRocket(d) {
    if (!M) return;
    if (!M.orig) {
      M.orig = { flames: M.s1Flames.slice(), meshes: [] };
      for (const g of [M.s1, M.s2, M.fairL, M.fairR]) g.traverse(o => { if (o.isMesh && o.userData.c) M.orig.meshes.push(o); });
    }
    if (M.custom) {
      for (const [p, c] of M.custom.attach) p.remove(c);
      M.custom.flames.forEach(f => M.model.remove(f));
      M.custom = null;
    }
    const useOrig = !d;
    M.orig.meshes.forEach(o => { o.visible = useOrig; });
    M.orig.flames.forEach(f => { if (useOrig) { if (!f.parent) M.model.add(f); } else M.model.remove(f); });
    if (useOrig) { M.s1Flames = M.orig.flames; M.s2Flame.position.y = M.s2Core.position.y = 15.08; return; }
    const R = makeRocketParts(d), attach = [];
    M.s1.add(R.s1); attach.push([M.s1, R.s1]);
    M.s2.add(R.s2); attach.push([M.s2, R.s2]);
    R.halves[0].position.copy(M.fairR.userData.origin).negate(); M.fairR.add(R.halves[0]); attach.push([M.fairR, R.halves[0]]);
    R.halves[1].position.copy(M.fairL.userData.origin).negate(); M.fairL.add(R.halves[1]); attach.push([M.fairL, R.halves[1]]);
    const plumeGeo = M.orig.flames[0].geometry, flames = [];
    for (const e of R.engines) {
      const k = e.rb / 0.19;
      const f = new THREE.Mesh(plumeGeo, M.flameMat); f.position.set(e.x, -1.31, e.z); f.scale.set(k, 1, k); f.frustumCulled = false; f.renderOrder = 5;
      const c = new THREE.Mesh(plumeGeo, M.coreMat); c.position.set(e.x, -1.31, e.z); c.scale.set(k, 1, k); c.frustumCulled = false; c.renderOrder = 6;
      M.model.add(f, c); flames.push(f, c);
    }
    M.s1Flames = flames;
    M.s2Flame.position.y = M.s2Core.position.y = R.s2FlameY;
    M.custom = { attach, flames };
  }

  // ---------- Rocket Designer: a 3D preview that builds itself as you design ----------
  let RV = null;
  const rasm = { items: [], prev: null };
  function markerTex(kind) {
    return canvasTex(128, 128, (g) => {
      if (kind === 'cm') {
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fill();
        g.fillStyle = '#111'; g.beginPath(); g.moveTo(64, 64); g.arc(64, 64, 52, -Math.PI / 2, 0); g.fill();
        g.beginPath(); g.moveTo(64, 64); g.arc(64, 64, 52, Math.PI / 2, Math.PI); g.fill();
        g.strokeStyle = '#111'; g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke();
      } else {
        g.strokeStyle = '#ff5d4d'; g.lineWidth = 12; g.beginPath(); g.arc(64, 64, 46, 0, 7); g.stroke();
        g.fillStyle = '#ff5d4d'; g.beginPath(); g.arc(64, 64, 16, 0, 7); g.fill();
      }
    });
  }
  function buildRocketView() {
    RV = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(30, 1, 0.1, 3000), group: null };
    RV.scene.environment = scene.environment;
    RV.scene.background = new THREE.Color(0x03060d);
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(20, 40, 25);
    const rim = new THREE.DirectionalLight(0x7fc8ff, 1.2); rim.position.set(-25, 18, -20);
    RV.scene.add(key, rim, new THREE.AmbientLight(0x404a60, 0.6));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.4, 0.6, 64), new THREE.MeshStandardMaterial({ color: 0x1a2232, roughness: 0.85, metalness: 0.2 }));
    pad.position.y = -1.65; RV.scene.add(pad);
    const grid = new THREE.GridHelper(40, 40, 0x1f4a6a, 0x13263a); grid.position.y = -1.95; RV.scene.add(grid);
    RV.cm = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex('cm'), depthTest: false, transparent: true }));
    RV.cp = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex('cp'), depthTest: false, transparent: true }));
    RV.cm.scale.setScalar(1.5); RV.cp.scale.setScalar(1.3); RV.cm.renderOrder = RV.cp.renderOrder = 30;
    RV.scene.add(RV.cm, RV.cp);
    RV.cam.position.set(30, 22, 52);
    RV.controls = new THREE.OrbitControls(RV.cam, renderer.domElement);
    Object.assign(RV.controls, { enabled: false, enableDamping: true, enablePan: false, minDistance: 18, maxDistance: 110, autoRotate: true, autoRotateSpeed: 1.1 });
    RV.controls.target.set(0, 13.5, 0); RV.controls.update();
  }
  function rocketAssemble(parts, first) {
    const now = performance.now() / 1000;
    let delay = first ? 0.2 : 0;
    for (const [k, p] of parts) {
      if (!first && rasm.prev && rasm.prev.has(k)) continue;
      rasm.items.push({ g: p.g, kind: p.kind, s0: p.g.scale.clone(), t0: now + delay });
      if (p.kind === 'grow') p.g.scale.y = 0.001; else p.g.scale.setScalar(0.001);
      if (first) delay += p.kind === 'pop' ? 0.06 : 0.22;
    }
    rasm.prev = new Set(parts.keys());
  }
  function rocketAssembleTick(now) {
    const back = (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
    rasm.items = rasm.items.filter(it => {
      const k = clamp((now - it.t0) / (it.kind === 'grow' ? 0.5 : 0.45), 0, 1);
      if (it.kind === 'grow') it.g.scale.y = Math.max(0.001, it.s0.y * (1 - Math.pow(1 - k, 3)));
      else it.g.scale.copy(it.s0).multiplyScalar(Math.max(0.001, back(k)));
      return k < 1;
    });
  }
  function rocketLabel(key, text, p) {
    let el = RV.labels[key];
    if (!el) { el = RV.labels[key] = document.createElement('div'); el.className = 'rk-label ' + key; RV.labelBox.appendChild(el); }
    if (el.textContent !== text) el.textContent = text;
    const v = p.clone().project(RV.cam), w = host.clientWidth, h = host.clientHeight;
    const x = ((v.x + 1) / 2 * w).toFixed(1), y = ((1 - v.y) / 2 * h).toFixed(1);
    el.style.transform = key === 'cp' ? `translate(calc(${x}px - 100%), ${y}px)` : `translate(${x}px, ${y}px)`;
  }
  function drawRocketView(nowMs) {
    const now = nowMs / 1000, w = host.clientWidth, h = host.clientHeight;
    rocketAssembleTick(now);
    RV.controls.update();
    RV.cam.aspect = w / h; RV.cam.updateProjectionMatrix();
    renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
    renderer.render(RV.scene, RV.cam);
    if (RV.labelBox) { rocketLabel('cm', 'Center of mass', RV.cm.position); rocketLabel('cp', 'Center of pressure', RV.cp.position); }
  }
  function leaveRocket() {
    if (mode !== 'rocketview') return;
    mode = 'cinematic'; RV.controls.enabled = false;
    rasm.items.forEach(it => it.g.scale.copy(it.s0)); rasm.items = []; rasm.prev = null;
    if (RV.labelBox && RV.labelBox.parentNode) RV.labelBox.parentNode.removeChild(RV.labelBox);
  }

  // ---------- Build screen: each part you pick is installed on the 3D satellite ----------
  const asm = { items: [], prev: null, sat: null, weld: null };
  function partMap() {
    const out = new Map();
    [M.panels.r, M.panels.l].forEach((list, side) => list.forEach((p, i) => { if (p.piv.visible) out.set(`panel${side}_${i}`, p.piv); }));
    if (M.dishPiv.visible) out.set('dish:' + M.dishPiv.scale.x.toFixed(2), M.dishPiv);
    if (M.imagerPiv.visible) out.set('imager:' + M.imagerPiv.scale.x.toFixed(2), M.imagerPiv);
    if (M.boomPiv.visible) out.set('boom', M.boomPiv);
    const seen = {};
    M.extra.children.forEach(c => { const n = c.name || 'part'; seen[n] = (seen[n] || 0) + 1; out.set(`x:${n}:${seen[n]}`, c); });
    return out;
  }
  function finishAssembly() {
    asm.items.forEach(it => it.obj.scale.copy(it.s0)); asm.items = [];
    if (asm.sat) { M.sat.scale.setScalar(asm.sat.to); asm.sat = null; }
  }
  function startAssembly(prevScale) {
    const now = performance.now() / 1000, parts = partMap(), first = !asm.prev;
    let delay = first ? 0.45 : 0;
    for (const [k, obj] of parts) {
      if (!first && asm.prev.has(k)) continue;
      asm.items.push({ obj, s0: obj.scale.clone(), t0: now + delay });
      obj.scale.multiplyScalar(0.001);
      if (first) delay += 0.14;
    }
    asm.prev = new Set(parts.keys());
    const to = M.sat.scale.x;
    if (first) asm.sat = { from: 0.001, to, t0: now };
    else if (prevScale && Math.abs(prevScale - to) > 1e-3) asm.sat = { from: prevScale, to, t0: now };
    if (asm.sat) M.sat.scale.setScalar(asm.sat.from);
    if (!asm.weld) {
      asm.weld = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex('rgba(220,245,255,1)', 'rgba(80,180,255,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false }));
      asm.weld.renderOrder = 20; scene.add(asm.weld);
    }
  }
  function updateAssembly(now) {
    const back = (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
    let glow = null, gk = 0;
    asm.items = asm.items.filter(it => {
      const k = clamp((now - it.t0) / 0.55, 0, 1);
      it.obj.scale.copy(it.s0).multiplyScalar(Math.max(0.001, back(k)));
      if (k > 0 && k < 1) { glow = it.obj; gk = k; }
      return k < 1;
    });
    if (asm.sat) {
      const k = clamp((now - asm.sat.t0) / 0.7, 0, 1);
      M.sat.scale.setScalar(Math.max(0.001, lerp(asm.sat.from, asm.sat.to, back(k))));
      if (k >= 1) asm.sat = null;
    }
    if (asm.weld) {
      asm.weld.visible = !!glow;
      if (glow) { glow.getWorldPosition(asm.weld.position); asm.weld.scale.setScalar(2.2 + Math.sin(now * 40) * 0.4); asm.weld.material.opacity = Math.sin(gk * Math.PI); }
    }
  }

  function drawSatView(now, w, h) {
    FX.meteors.forEach(l => { l.visible = false; });
    M.s1.visible = M.s2.visible = M.fairL.visible = M.fairR.visible = false;
    const id = satView.mission.id, inOrbit = satView.phase === 'orbit';
    earthMesh.visible = earthClouds.visible = atmoMesh.visible = id === 'earth';
    const pl = ensurePlanets();
    pl.mars.visible = id === 'mars' && inOrbit;
    pl.jupiter.visible = pl.europa.visible = id === 'jupiter' && inOrbit;
    const down = localUp.clone().negate();
    pl.mars.position.copy(down).multiplyScalar(3390 * KM + 350 * KM);
    pl.jupiter.position.copy(down).multiplyScalar(9e6).add(new THREE.Vector3(0, 0, -3e6));
    pl.europa.position.copy(down).multiplyScalar(1.5e6).add(new THREE.Vector3(2.5e6, 0, 1.2e6));
    if (!satView.alive) { const t = now / 1000; M.sat.rotation.set(t * 0.21, t * 0.13, t * 0.07); }
    updateAssembly(now / 1000);
    const tgt = satCenter();
    camMain.position.add(tgt.clone().sub(controls.target));
    controls.target.copy(tgt);
    camMain.up.copy(localUp);
    controls.update();
    drawWith(camMain, 0, 0, w, h, true);
  }

  function info() {
    const s = stateAt(flight, T);
    const kmh = s.speed * 3600;
    const SOS = [[0, 1225], [11, 1062], [20, 1062], [32, 1086], [47, 1188], [51, 1188], [71, 1055], [85, 990]];
    let mach = null;
    if (s.alt < 85) { let i = 0; while (i < SOS.length - 2 && s.alt > SOS[i + 1][0]) i++; const [a0, va] = SOS[i], [b0, vb] = SOS[i + 1]; mach = kmh / (va + (vb - va) * clamp((s.alt - a0) / (b0 - a0), 0, 1)); }
    const card = (flight.cards || []).filter(c => c.T <= T).pop() || null;
    return { T, P, pMax: flight.pMax, playing, mode, clock: fmtT(T), alt: s.alt, speed: s.speed, kmh, mach, card, magForced: FX ? FX.magForced : false, stage: stageLabel(flight, s, T), warn: s.warn, lost: s.lost,
      events: flight.events, kind: flight.kind, ended: P >= flight.pMax - 1e-6, countdown: T < 0 && T >= -10 && flight.kind !== 'scrub' ? Math.ceil(-T) : (flight.kind === 'scrub' && T < -1.2 ? Math.ceil(-T) : null) };
  }

  // ---------- Public API ----------

  // The heavy files load in the background, so the first page shows right away
  const HEAVY = [
    ['vendor/three/OBJLoader.js', () => THREE.OBJLoader], ['vendor/three/OrbitControls.js', () => THREE.OrbitControls],
    ['vendor/three/RoomEnvironment.js', () => THREE.RoomEnvironment], ['vendor/three/GLTFExporter.js', () => THREE.GLTFExporter],
    ['models/orbiter-model.js', () => window.ORBITER_OBJ], ['assets/earth-textures.js', () => window.EARTH_DAY]
  ];
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src;
      s.onload = res; s.onerror = () => rej(new Error(`could not load ${src}. Keep the folders next to index.html and reload the page`));
      document.head.appendChild(s);
    });
  }
  let loading = null;
  function preload() {
    if (!loading) {
      loading = (typeof THREE !== 'undefined' ? Promise.resolve() : loadScript('vendor/three/three.min.js'))
        .then(() => Promise.all(HEAVY.filter(([, has]) => !has()).map(([src]) => loadScript(src))))
        .catch((e) => { loading = null; throw e; });
    }
    return loading;
  }
  function ensure() {
    if (ready) return Promise.resolve();
    if (!building) building = preload().then(() => new Promise((res, rej) => setTimeout(() => {
      try {
        if (typeof THREE === 'undefined' || !THREE.OBJLoader) throw new Error('the 3D engine did not load. Keep the vendor folder next to index.html and reload the page');
        if (!window.ORBITER_OBJ) throw new Error('the rocket model file (models/orbiter-model.js) is missing');
        build(); res();
      } catch (e) { rej(e); }
    }, 30))).catch((e) => { building = null; throw e; });
    return building;
  }

  return {
    fmtT, pOfT, tOfP, makeFlight,
    ensure, preload,
    get ready() { return ready; },
    open(el, fl, h = {}, startP = 0) {
      leaveSat(); leaveOrbit(); leaveRocket();
      host = el; hooks = h; flight = fl;
      applyBuild(fl.build, {});
      applyRocket(fl.design || null);      // the rocket you designed
      P = clamp(startP, 0, fl.pMax); T = tOfP(P, fl.segments);
      host.appendChild(renderer.domElement);
      renderer.domElement.className = 'orb-gl';
      resize();
      window.removeEventListener('resize', resize);
      window.addEventListener('resize', resize);
      lastNow = performance.now();
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    openSat(el, opts) {
      const fresh = host !== el;
      leaveOrbit(); leaveRocket();
      host = el; hooks = {};
      flight = makeFlight({ kind: 'orbit', lost: false }, opts.mission);
      finishAssembly();
      if (!opts.assemble) asm.prev = null;
      const prevScale = M.sat.scale.x;
      applyBuild(opts.build, opts.dmg);
      if (opts.assemble) startAssembly(prevScale);
      T = 3700; P = pOfT(T, flight.segments); playing = false;
      const wasSat = mode === 'sat';
      satView = { mission: opts.mission, phase: opts.phase, alive: opts.alive !== false };
      if (fresh) {
        host.appendChild(renderer.domElement); renderer.domElement.className = 'orb-gl'; resize();
        window.removeEventListener('resize', resize); window.addEventListener('resize', resize);
      }
      if (!wasSat) {
        mode = 'sat'; controls.autoRotate = true; controls.autoRotateSpeed = 0.7;
        update(T);
        const c = satCenter();
        camMain.up.copy(localUp);
        const zoom = opts.zoom || (opts.interactive === false ? 0.68 : 1);   // a closer look for the small front-page card
        camMain.position.copy(c).add(localUp.clone().multiplyScalar(4 * zoom)).add(new THREE.Vector3(0, 0, 14 * zoom)).add(new THREE.Vector3(localUp.y, -localUp.x, 0).multiplyScalar(6 * zoom));
        controls.target.copy(c); controls.update();
      }
      controls.enabled = opts.interactive !== false;
      controls.autoRotate = opts.interactive !== false;   // the front-page card holds still
      lastNow = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    openOrbit(el, opts) {
      const fresh = host !== el;
      leaveSat(); leaveRocket();
      host = el; hooks = { onTick: opts.onTick };
      if (!OV) buildOrbitView();
      if (opts.reset) {
        endEvent();
        if (OV.land) { OV.earth.remove(OV.land.g); if (OV.land.fx) OV.scene.remove(OV.land.fx.g); }
        Object.assign(OV, { simT: 0, u: 2.15, r: OV.r0, rOff: 0, data: 0, trackCount: 0, lastTrackT: -1e9, land: null, xfer: null, burn: null,
          destroyed: false, satHidden: false, autoWarp: null, warp: 1, evKey: null, alert: '' });
        OV.track.geometry.setDrawRange(0, 0); OV.glow.material.uniforms.uOp.value = 1;
        Object.assign(OV.cam, { az: -0.9, el: 0.4, azT: -0.9, elT: 0.4 });
      }
      // dress the satellite with your parts, unfold it, and copy it into the orbit scene at real size (meters)
      flight = makeFlight({ kind: 'orbit', lost: false }, opts.mission);
      applyBuild(opts.build, opts.dmg);
      update(3700);
      if (OV.sat) OV.scene.remove(OV.sat);
      const c = M.sat.clone(true); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.copy(M.sat.scale);
      OV.sat = new THREE.Group(); OV.sat.add(c); OV.sat.scale.setScalar(2.4); OV.scene.add(OV.sat);
      OV.sat.updateMatrixWorld(true);
      const bs = new THREE.Box3().setFromObject(OV.sat).getBoundingSphere(new THREE.Sphere());
      // center the model on the scene origin
      c.position.sub(bs.center.clone().divideScalar(2.4));
      if (opts.reset || !OV.satRSet) { OV.satR = clamp(bs.radius, 2, 30); OV.satRSet = true; OV.cam.ld = OV.cam.ldT = Math.log(OV.satR * 3.2); }
      OV.opts = opts;
      // events: a new decision starts its visual; a choice you just made plays out
      const e = opts.event, key = e ? `${e.id}:${e.stage}:${e.n || 0}` : null;
      if (key !== OV.evKey) { OV.evKey = key; if (e) startEvent(e); }
      // end of mission
      if (opts.landing === 'aim' && !OV.land) startLanding();
      if (opts.landing === 'reentry' && (!OV.land || OV.land.stage === 'aim')) {
        // reloaded mid-reentry: jump to the end
        if (!OV.land) startLanding();
        const p = llDir(opts.landingLat || NEMO[0], opts.landingLon || NEMO[1]);
        Object.assign(OV.land, { stage: 'done', impact: p, dist: opts.landingDist || 0, inZone: !!opts.landingInZone, t0: OV.simT - DEORBIT_T, uB: OV.u });
        OV.land.path.visible = false; OV.land.x.visible = false;
        OV.land.splash = placeOnEarth(curvedDisc(260e3, new THREE.MeshBasicMaterial({ map: ringTex('#ffffff'), transparent: true, depthWrite: false }), 4e3), p, 4e3);
        OV.land.g.add(OV.land.splash);
      }
      if ((opts.disposal === 'lowered' || opts.disposal === 'graveyard') && !OV.xfer)
        OV.xfer = { t0: OV.simT, rt: 0, from: OV.r, to: RE_M + (opts.disposal === 'lowered' ? 560e3 : 2050e3), dur: OV.period / 2 };
      if (fresh) {
        host.appendChild(renderer.domElement); renderer.domElement.className = 'orb-gl';
        window.removeEventListener('resize', resize); window.addEventListener('resize', resize);
      }
      if (!OV.labelBox) { OV.labelBox = document.createElement('div'); OV.labelBox.className = 'ov-labels'; OV.labelEls = {}; }
      if (OV.labelBox.parentNode !== host) host.appendChild(OV.labelBox);
      resize();
      if (mode !== 'orbitview') { mode = 'orbitview'; controls.enabled = false; }
      lastNow = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    // Rocket Designer preview: your rocket in 3D, built part by part as you change the design
    openRocket(el, opts) {
      const fresh = host !== el;
      leaveSat(); leaveOrbit();
      host = el; hooks = {};
      if (!RV) buildRocketView();
      rasm.items.forEach(it => it.g.scale.copy(it.s0)); rasm.items = [];
      if (RV.group) RV.scene.remove(RV.group);
      const R = makeRocketParts(opts.design);
      const fg = new THREE.Group(); fg.position.y = RK.FAIR_BASE; fg.name = 'fairing';
      R.halves.forEach(hm => { hm.position.y = -RK.FAIR_BASE; fg.add(hm); });
      R.parts.set(R.noseKey, { g: fg, kind: 'grow' });
      const g = new THREE.Group(); g.add(R.s1, R.s2, fg); RV.group = g; RV.scene.add(g);
      rocketAssemble(R.parts, mode !== 'rocketview' || !rasm.prev);
      RV.cm.position.set(0, clamp(opts.cm || 0.4, 0, 1) * R.noseTop, 0);
      RV.cp.position.set(0, clamp(opts.cp || 0.3, 0, 1) * R.noseTop, 0);
      if (fresh) {
        host.appendChild(renderer.domElement); renderer.domElement.className = 'orb-gl';
        window.removeEventListener('resize', resize); window.addEventListener('resize', resize);
      }
      if (!RV.labelBox) { RV.labelBox = document.createElement('div'); RV.labelBox.className = 'rk-labels'; RV.labels = {}; }
      if (RV.labelBox.parentNode !== host) host.appendChild(RV.labelBox);
      resize();
      if (mode !== 'rocketview') { mode = 'rocketview'; controls.enabled = false; RV.controls.enabled = true; }
      lastNow = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    _rasm: () => ({ items: rasm.items.length, parts: rasm.prev ? rasm.prev.size : 0 }),
    orbitWarp(w) { if (OV) { OV.warp = w; if (!OV.land || OV.land.stage === 'aim') OV.autoWarp = null; } },
    orbitView(v) { if (OV) viewPreset(v); },
    orbitZoom(dir) { if (OV) orbitZoomBy(dir === 'in' ? -1.2 : 1.2); },
    orbitSkip() {
      if (!OV || !OV.land || OV.land.stage !== 'aim') return;
      const wdt = nextWindow();
      if (wdt === null || wdt < 30) return;
      const jump = wdt - 10;
      OV.simT += jump; OV.u += OV.n * jump;
      OV.trackCount = 0; OV.track.geometry.setDrawRange(0, 0); OV.land.winAt = 0;
    },
    fireDeorbit() { return OV ? fireDeorbit() : null; },
    steer(dir, on) { if (OV && dir in OV.keys) OV.keys[dir] = !!on; },
    _ov: () => OV,
    _asm: () => ({ items: asm.items.length, minScale: asm.items.reduce((m, it) => Math.min(m, it.obj.scale.x), 9), sat: !!asm.sat }),
    _step(ms) { if (OV && host && mode === 'orbitview') drawOrbitView(((OV.last || 0) * 1000) + ms); },
    close() {
      leaveSat(); leaveOrbit(); leaveRocket();
      if (FX) FX.magForced = false;
      cancelAnimationFrame(raf); playing = false;
      window.removeEventListener('resize', resize);
      if (renderer && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      host = null;
    },
    play() { if (P >= flight.pMax) P = 0; playing = true; lastNow = performance.now(); },
    pause() { playing = false; },
    toggle() { if (playing) this.pause(); else this.play(); },
    seekP(p) { P = clamp(p, 0, flight.pMax); T = tOfP(P, flight.segments); },
    seekT(t) { this.seekP(pOfT(t, flight.segments)); },
    setMode(m) {
      if (m === 'free' && mode !== 'free') { controls.target.copy(rocketPoint(14)); freeMag = null; camMain.fov = 45; camMain.updateProjectionMatrix(); }
      mode = m; controls.enabled = m === 'free';
    },
    get mode() { return mode; },
    toggleMagnetosphere() { FX.magForced = !FX.magForced; return FX.magForced; },
    info: () => info(),
    stowed() { const t = flight.kind === 'orbit' || flight.kind === 'wobble' ? 3128 : -10; this.seekT(t); playing = false; },
    deployed() { if (flight.kind === 'orbit' || flight.kind === 'wobble') { this.seekT(3700); playing = false; return true; } return false; },
    downloadGLB() {
      const ex = new THREE.GLTFExporter();
      const flames = M.s1Flames.concat([M.s2Flame, M.s2Core, M.reFire, M.reGlow, M.sparks, M.wind]);
      flames.forEach(f => f.userData.vis = f.visible);
      flames.forEach(f => { f.visible = false; });
      ex.parse(M.root, (res) => {
        flames.forEach(f => { f.visible = f.userData.vis; });
        saveBlob(new Blob([res], { type: 'model/gltf-binary' }), 'orbiter-1.glb');
      }, (err) => { console.error(err); }, { binary: true, onlyVisible: true });
    },
    downloadOBJ() {
      const MATS = makeMaterials();
      let mtl = '# ORBITER-1 materials\n';
      for (const [name, m] of Object.entries(MATS)) {
        if (name.startsWith('_')) continue;
        const c = m.color || new THREE.Color(1, 1, 1);
        mtl += `newmtl ${name}\nKd ${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)}\nKs ${(m.metalness || 0).toFixed(2)} ${(m.metalness || 0).toFixed(2)} ${(m.metalness || 0).toFixed(2)}\nNs ${Math.round((1 - (m.roughness || 0.5)) * 400)}\nd 1\nillum 2\n\n`;
      }
      saveBlob(new Blob(['mtllib orbiter-1.mtl\n' + window.ORBITER_OBJ], { type: 'text/plain' }), 'orbiter-1.obj');
      setTimeout(() => saveBlob(new Blob([mtl], { type: 'text/plain' }), 'orbiter-1.mtl'), 400);
    }
  };

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
})();
