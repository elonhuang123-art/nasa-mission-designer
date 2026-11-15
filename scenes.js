// Illustrations: planets, the launch sequence, the journey map and the mission patch.

const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function mix(a, b, f) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * f).toString(16).padStart(2, '0')).join('');
}

// ---------- Planets ----------

function planet(kind, cx, cy, r, uid) {
  const id = `${kind}-${uid}`;
  const sw = (k) => Math.max(0.8, r * k);
  const clip = `<clipPath id="c-${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`;
  const shade = `<radialGradient id="s-${id}" cx="34%" cy="30%" r="78%"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.62"/></radialGradient>`;
  let grad = '', inner = '', extra = '', glow = '';

  if (kind === 'earth') {
    grad = `<radialGradient id="g-${id}" cx="38%" cy="35%" r="70%"><stop offset="0" stop-color="#5FB4EE"/><stop offset="0.65" stop-color="#2367B5"/><stop offset="1" stop-color="#0F376E"/></radialGradient>`;
    glow = `<circle cx="${cx}" cy="${cy}" r="${r * 1.07}" fill="none" stroke="#7CC4F5" stroke-opacity="0.35" stroke-width="${sw(0.08)}"/>`;
    inner = `<path d="M-0.62,-0.52 C-0.3,-0.72 0.1,-0.56 0.05,-0.3 C0,-0.1 -0.25,-0.04 -0.3,0.16 C-0.36,0.36 -0.56,0.3 -0.62,0.05 C-0.7,-0.2 -0.76,-0.36 -0.62,-0.52Z" fill="#5E9B4F"/>
      <path d="M0.24,-0.12 C0.46,-0.22 0.72,-0.06 0.66,0.2 C0.6,0.46 0.4,0.62 0.3,0.46 C0.2,0.3 0.14,0.04 0.24,-0.12Z" fill="#7FA35A"/>
      <path d="M-0.1,0.42 C0,0.36 0.12,0.48 0.06,0.6 C0,0.7 -0.14,0.6 -0.1,0.42Z" fill="#C2A46B"/>
      <ellipse cx="0" cy="-0.98" rx="0.55" ry="0.16" fill="#F2F6FA"/>
      <path d="M-0.85,0.32 q0.3,-0.14 0.6,0 t0.55,0" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-linecap="round" stroke-width="${sw(0.07)}" vector-effect="non-scaling-stroke"/>
      <path d="M-0.2,-0.62 q0.25,-0.1 0.5,0 t0.45,0" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-linecap="round" stroke-width="${sw(0.06)}" vector-effect="non-scaling-stroke"/>
      <path d="M0.1,0.05 q0.2,-0.1 0.42,0" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-linecap="round" stroke-width="${sw(0.05)}" vector-effect="non-scaling-stroke"/>`;
  } else if (kind === 'mars') {
    grad = `<radialGradient id="g-${id}" cx="38%" cy="35%" r="70%"><stop offset="0" stop-color="#EA9562"/><stop offset="0.6" stop-color="#C25A31"/><stop offset="1" stop-color="#7A2C15"/></radialGradient>`;
    glow = `<circle cx="${cx}" cy="${cy}" r="${r * 1.05}" fill="none" stroke="#F0A57A" stroke-opacity="0.2" stroke-width="${sw(0.05)}"/>`;
    inner = `<path d="M-0.7,-0.1 C-0.4,-0.3 -0.1,-0.05 0.2,-0.15 C0.45,-0.22 0.7,0 0.8,0.1 C0.5,0.2 0.2,0.1 -0.1,0.18 C-0.4,0.25 -0.6,0.1 -0.7,-0.1Z" fill="#8E3A1E" fill-opacity="0.55"/>
      <path d="M-0.3,0.45 C-0.1,0.38 0.15,0.5 0.1,0.62 C-0.05,0.7 -0.3,0.6 -0.3,0.45Z" fill="#8E3A1E" fill-opacity="0.45"/>
      <ellipse cx="0" cy="-0.97" rx="0.42" ry="0.13" fill="#F6EEE6"/>
      <circle cx="0.35" cy="-0.45" r="0.07" fill="none" stroke="#7A2C15" stroke-opacity="0.6" stroke-width="${sw(0.025)}" vector-effect="non-scaling-stroke"/>
      <circle cx="-0.45" cy="0.35" r="0.05" fill="none" stroke="#7A2C15" stroke-opacity="0.6" stroke-width="${sw(0.025)}" vector-effect="non-scaling-stroke"/>`;
  } else if (kind === 'jupiter') {
    grad = `<radialGradient id="g-${id}" cx="38%" cy="35%" r="70%"><stop offset="0" stop-color="#EBD3B0"/><stop offset="1" stop-color="#B98A5E"/></radialGradient>`;
    const bands = [[-0.75, 0.12, '#C29468'], [-0.48, 0.16, '#A8724A'], [-0.18, 0.1, '#E9D6B8'], [0.02, 0.18, '#B07A50'], [0.32, 0.1, '#DFC39C'], [0.5, 0.14, '#A36E46'], [0.76, 0.12, '#C49A70']];
    inner = bands.map(([y, h, c]) => `<rect x="-1.1" y="${y}" width="2.2" height="${h}" fill="${c}"/>`).join('') +
      `<ellipse cx="0.32" cy="0.3" rx="0.2" ry="0.1" fill="#C0603E"/><ellipse cx="0.32" cy="0.3" rx="0.12" ry="0.05" fill="#D27A55"/>`;
    const er = r * 0.2, ex = cx + r * 1.42, ey = cy - r * 0.62;
    extra = `<circle cx="${ex}" cy="${ey}" r="${er}" fill="#E8DCC8"/>
      <path d="M${ex - er * 0.7},${ey - er * 0.2} l${er * 0.6},${er * 0.3} l${er * 0.5},-${er * 0.5} M${ex - er * 0.3},${ey + er * 0.6} l${er * 0.5},-${er * 0.4} l${er * 0.4},${er * 0.2}" fill="none" stroke="#9C6A45" stroke-width="${Math.max(0.6, er * 0.08)}"/>
      <circle cx="${ex}" cy="${ey}" r="${er}" fill="url(#s-${id})"/>`;
  }

  return `<defs>${grad}${shade}${clip}</defs>${glow}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#g-${id})"/>
    <g clip-path="url(#c-${id})"><g transform="translate(${cx} ${cy}) scale(${r})">${inner}</g></g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#s-${id})"/>${extra}`;
}

function planetBadge(kind, size = 96) {
  const pad = kind === 'jupiter' ? 0.3 : 0.08;
  const r = size / 2 / (1 + pad);
  const cx = kind === 'jupiter' ? r * 1.06 : size / 2;
  return `<svg viewBox="0 0 ${size} ${size}" class="planet-svg" aria-hidden="true">${planet(kind, cx, size / 2 + (kind === 'jupiter' ? r * 0.18 : 0), r, 'badge')}</svg>`;
}

function miniCraft(x, y, s, rot = 0) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <rect x="-16" y="-3" width="11" height="6" fill="#2F5BA6" stroke="#8FB0E0" stroke-width="0.6"/>
    <rect x="5" y="-3" width="11" height="6" fill="#2F5BA6" stroke="#8FB0E0" stroke-width="0.6"/>
    <rect x="-5" y="-5" width="10" height="10" rx="1" fill="#D9A93A" stroke="#8A6418" stroke-width="0.6"/>
    <path d="M-4,-5 Q0,-9 4,-5" fill="none" stroke="#E9EEF4" stroke-width="1.2"/>
  </g>`;
}

// ---------- Mission screen hero ----------

function heroArt() {
  const motion = REDUCED ? '' : `<animateMotion dur="11s" repeatCount="indefinite" rotate="auto" path="M120,252 Q320,330 466,132"/>`;
  return `<svg viewBox="0 0 560 380" class="hero-svg" role="img" aria-label="Paths from Earth to Mars and Jupiter">
    <g fill="none" stroke="#C9C6BD" stroke-width="1.5">
      <circle cx="-200" cy="430" r="370"/><circle cx="-200" cy="430" r="505"/><circle cx="-200" cy="430" r="770"/>
    </g>
    <path d="M120,252 Q150,150 190,104" fill="none" stroke="#EC3013" stroke-width="2" stroke-dasharray="5 6"/>
    <path d="M120,252 Q320,330 466,132" fill="none" stroke="#EC3013" stroke-width="2" stroke-dasharray="5 6"/>
    ${planet('earth', 120, 252, 22, 'hero')}
    ${planet('mars', 190, 104, 14, 'hero')}
    ${planet('jupiter', 466, 132, 46, 'hero')}
    <g>${miniCraft(0, 0, 0.9)}${motion}</g>
  </svg>`;
}

// ---------- Journey map on the flight screen ----------

function journeyMap(sim) {
  const m = sim.mission;
  const done = simDone(sim);
  const W = 600, H = 150;
  const o = [];
  const lost = !sim.alive;

  if (m.id === 'earth') {
    const cx = 300, cy = 78, rx = 150, ry = 40;
    const frac = done ? 1 : sim.stepIndex / sim.steps.length;
    const a = -Math.PI / 2 + frac * Math.PI * 4;
    const mx = cx + rx * Math.cos(a), my = cy + ry * Math.sin(a);
    const behind = Math.sin(a) < 0;
    o.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#EC3013" stroke-width="1.5" stroke-dasharray="4 5"/>`);
    if (behind) o.push(marker(mx, my, lost));
    o.push(planet('earth', cx, cy, 46, 'journey'));
    if (!behind) o.push(marker(mx, my, lost));
  } else {
    const P0 = [70, 110], P1 = [300, -20], P2 = [520, 80];
    const arrival = sim.steps.indexOf('arrival');
    const f = done && sim.captured ? 1 : Math.min(1, sim.stepIndex / arrival);
    const pt = (t) => [0, 1].map(i => (1 - t) ** 2 * P0[i] + 2 * (1 - t) * t * P1[i] + t * t * P2[i]);
    const path = `M${P0} Q${P1} ${P2}`;
    const trail = Array.from({ length: 31 }, (_, i) => pt((i / 30) * f).map(v => v.toFixed(1)).join(',')).join(' ');
    o.push(`<path d="${path}" fill="none" stroke="#2A4263" stroke-width="1.5" stroke-dasharray="4 5"/>`);
    o.push(`<polyline points="${trail}" fill="none" stroke="#EC3013" stroke-width="2.5"/>`);
    o.push(planet('earth', P0[0], P0[1], 20, 'journey'));
    o.push(planet(m.id, P2[0], P2[1], m.id === 'mars' ? 18 : 34, 'journey'));
    let [mx, my] = pt(f);
    if (sim.stepIndex > arrival && sim.captured) {
      const a = sim.stepIndex * 1.3;
      const rr = m.id === 'mars' ? 40 : 58;
      o.push(`<ellipse cx="${P2[0]}" cy="${P2[1]}" rx="${rr}" ry="${rr * 0.42}" fill="none" stroke="#EC3013" stroke-width="1.2" stroke-dasharray="3 4"/>`);
      mx = P2[0] + rr * Math.cos(a); my = P2[1] + rr * 0.42 * Math.sin(a);
    } else if (!sim.captured) {
      mx = P2[0] + 50; my = P2[1] - 40;
    }
    o.push(marker(mx, my, lost));
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="journey-svg" role="img" aria-label="Where your spacecraft is now">${o.join('')}</svg>`;
}

function marker(x, y, lost) {
  if (lost) return `<g stroke="#EF6A4C" stroke-width="2.5"><line x1="${x - 6}" y1="${y - 6}" x2="${x + 6}" y2="${y + 6}"/><line x1="${x + 6}" y1="${y - 6}" x2="${x - 6}" y2="${y + 6}"/></g>`;
  return `<circle cx="${x}" cy="${y}" r="10" fill="#EC3013" fill-opacity="0.25"/>${miniCraft(x, y, 0.6)}`;
}

// ---------- Mission patch ----------

function starPath(cx, cy, R) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? R * 0.45 : R;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(' L')}Z`;
}

function missionPatch(m, rocket, stars) {
  const starsSvg = Array.from({ length: 5 }, (_, i) => {
    const x = 72 + i * 24, y = 180 + Math.abs(i - 2) * 3;
    return `<path d="${starPath(x, y, 8)}" fill="${i < stars ? '#EC3013' : 'none'}" stroke="#EC3013" stroke-width="1.2"/>`;
  }).join('');
  return `<svg viewBox="0 0 240 240" class="patch-svg" role="img" aria-label="Mission patch for ${m.name}, ${stars} of 5 stars">
    <defs>
      <path id="arc-top" d="M38,120 A82,82 0 0 1 202,120"/>
      <path id="arc-bot" d="M30,128 A90,90 0 0 0 210,128"/>
      <radialGradient id="patch-bg" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="#262626"/><stop offset="1" stop-color="#0E0E0E"/></radialGradient>
    </defs>
    <circle cx="120" cy="120" r="114" fill="url(#patch-bg)" stroke="#EC3013" stroke-width="8"/>
    <circle cx="120" cy="120" r="102" fill="none" stroke="#F4F2EC" stroke-opacity="0.35" stroke-width="1"/>
    <text class="patch-title"><textPath href="#arc-top" startOffset="50%" text-anchor="middle">${m.name}</textPath></text>
    ${planet(m.id, m.id === 'jupiter' ? 108 : 120, 122, m.id === 'jupiter' ? 34 : 38, 'patch')}
    <ellipse cx="120" cy="122" rx="62" ry="18" fill="none" stroke="#E9EEF4" stroke-opacity="0.7" stroke-width="1" transform="rotate(-14 120 122)"/>
    ${miniCraft(176, 106, 0.9, -14)}
    ${starsSvg}
    <text class="patch-sub" x="120" y="212" text-anchor="middle">${m.target}</text>
  </svg>`;
}
