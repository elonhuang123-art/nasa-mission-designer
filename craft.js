// Draws the spacecraft as SVG from the current build.

function drawCraft(build, opts = {}) {
  const bus = byId(BUSES, build.bus);
  const solar = byId(SOLAR, build.solar);
  const antenna = byId(ANTENNAS, build.antenna);
  const engine = byId(ENGINES, build.engine);
  const shield = byId(SHIELDS, build.shield);
  const lost = opts.lost || [];
  const halfWing = opts.halfWing;

  const W = 420, H = 320, cx = 210, cy = 170;
  const size = { small: [70, 58], medium: [92, 78], large: [122, 100] }[bus.id];
  const [bw, bh] = size;
  const bx = cx - bw / 2, by = cy - bh / 2;
  const parts = [];

  // Stars (fixed positions so they don't jump on redraw)
  const stars = [[22,30],[61,280],[110,48],[150,300],[300,26],[342,288],[390,70],[402,210],[18,170],[260,300],[370,140],[90,120]];
  for (const [x, y] of stars) parts.push(`<circle cx="${x}" cy="${y}" r="1.1" class="star"/>`);

  // Solar wings
  const span = { none: 0, small: 52, medium: 78, large: 104, giant: 124 }[solar.id];
  if (span > 0) {
    const wh = { small: 30, medium: 40, large: 48, giant: 56 }[solar.id];
    const wing = (x0, dir, folded) => {
      const len = folded ? span * 0.35 : span;
      const x = dir < 0 ? x0 - 14 - len : x0 + 14;
      let s = `<line x1="${x0}" y1="${cy}" x2="${dir < 0 ? x + len : x}" y2="${cy}" class="yoke"/>`;
      s += `<rect x="${x}" y="${cy - wh / 2}" width="${len}" height="${wh}" class="panel"/>`;
      const cells = Math.max(2, Math.round(len / 16));
      for (let i = 1; i < cells; i++) {
        const lx = x + (len / cells) * i;
        s += `<line x1="${lx}" y1="${cy - wh / 2}" x2="${lx}" y2="${cy + wh / 2}" class="cell"/>`;
      }
      s += `<line x1="${x}" y1="${cy}" x2="${x + len}" y2="${cy}" class="cell"/>`;
      return s;
    };
    parts.push(wing(bx, -1, false));
    parts.push(wing(bx + bw, 1, halfWing));
  }

  // RTGs on a boom, lower left
  for (let i = 0; i < build.rtg; i++) {
    const x = bx - 8 - i * 20, y = by + bh + 14 + i * 12;
    parts.push(`<line x1="${bx + 6}" y1="${by + bh - 4}" x2="${x + 6}" y2="${y + 4}" class="boom"/>`);
    parts.push(`<g transform="rotate(-35 ${x + 6} ${y + 10})"><rect x="${x}" y="${y}" width="12" height="26" rx="3" class="rtg"/>` +
      [4, 10, 16, 22].map(f => `<line x1="${x - 4}" y1="${y + f}" x2="${x + 16}" y2="${y + f}" class="fin"/>`).join('') + `</g>`);
  }

  // Magnetometer boom, lower right
  if (build.instruments.includes('magnetometer') && !lost.includes('magnetometer')) {
    parts.push(`<line x1="${bx + bw - 6}" y1="${by + bh - 4}" x2="${bx + bw + 70}" y2="${by + bh + 62}" class="boom"/>`);
    parts.push(`<rect x="${bx + bw + 66}" y="${by + bh + 58}" width="9" height="9" class="inst-mag"/>`);
  }

  // Radar dipole antennas
  if (build.instruments.includes('radar') && !lost.includes('radar')) {
    parts.push(`<line x1="${cx}" y1="${by + bh}" x2="${cx - 110}" y2="${by + bh + 70}" class="dipole"/>`);
    parts.push(`<line x1="${cx}" y1="${by + bh}" x2="${cx + 110}" y2="${by + bh + 70}" class="dipole"/>`);
  }

  // Engine nozzle
  if (engine.id !== 'none') {
    const nw = engine.id === 'biprop' ? 26 : 14, nh = engine.id === 'biprop' ? 22 : 12;
    parts.push(`<path d="M${cx - nw / 4} ${by + bh} L${cx + nw / 4} ${by + bh} L${cx + nw / 2} ${by + bh + nh} L${cx - nw / 2} ${by + bh + nh} Z" class="nozzle"/>`);
  }

  // Bus body in gold foil
  parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="url(#foil)" class="bus"/>`);
  parts.push(`<path d="M${bx + 8} ${by + 12} l${bw * 0.3} ${bh * 0.18} l${bw * 0.2} -${bh * 0.1} l${bw * 0.3} ${bh * 0.22} M${bx + 10} ${by + bh - 14} l${bw * 0.25} -${bh * 0.2} l${bw * 0.35} ${bh * 0.12}" class="crinkle"/>`);
  if (shield.id !== 'none') {
    const inset = shield.id === 'heavy' ? 10 : 14;
    parts.push(`<rect x="${bx + inset}" y="${by + inset}" width="${bw - inset * 2}" height="${bh - inset * 2}" class="vault ${shield.id}"/>`);
  }

  // Instruments on the front face
  const faceInst = build.instruments.filter(id => !['magnetometer', 'radar'].includes(id));
  faceInst.forEach((id, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = bx + 12 + col * ((bw - 24) / 2.4), y = by + bh - 22 - row * 22;
    const dead = lost.includes(id) ? ' dead' : '';
    if (id === 'hires') parts.push(`<rect x="${x - 2}" y="${by - 22}" width="20" height="24" class="inst${dead}"/><circle cx="${x + 8}" cy="${by - 22}" r="8" class="lens${dead}"/>`);
    else if (id === 'camera') parts.push(`<rect x="${x}" y="${y}" width="14" height="14" class="inst${dead}"/><circle cx="${x + 7}" cy="${y + 7}" r="4" class="lens${dead}"/>`);
    else parts.push(`<rect x="${x}" y="${y}" width="16" height="12" class="inst alt${dead}"/>`);
  });

  // Antenna on top
  if (antenna.size === 0) {
    parts.push(`<line x1="${bx + bw - 14}" y1="${by}" x2="${bx + bw - 14}" y2="${by - 18}" class="mast"/><circle cx="${bx + bw - 14}" cy="${by - 20}" r="3" class="dish-feed"/>`);
  } else {
    const r = [0, 16, 32, 52][antenna.size];
    const ay = by - 10 - r * 0.35;
    const off = antenna.size === 3 ? 0 : 0;
    const dishStuck = opts.dishStuck ? ' stuck' : '';
    parts.push(`<line x1="${cx + off}" y1="${by}" x2="${cx + off}" y2="${ay}" class="mast"/>`);
    parts.push(`<path d="M${cx - r} ${ay - r * 0.45} Q${cx} ${ay + r * 0.35} ${cx + r} ${ay - r * 0.45}" class="dish${dishStuck}"/>`);
    parts.push(`<line x1="${cx}" y1="${ay}" x2="${cx}" y2="${ay - r * 0.55}" class="mast"/><circle cx="${cx}" cy="${ay - r * 0.6}" r="2.5" class="dish-feed"/>`);
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="craft-svg" role="img" aria-label="Drawing of your spacecraft">
    <defs>
      <linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#F2D27A"/><stop offset="0.45" stop-color="#D9A93A"/>
        <stop offset="0.7" stop-color="#B98524"/><stop offset="1" stop-color="#E3BB55"/>
      </linearGradient>
    </defs>
    ${parts.join('\n')}
  </svg>`;
}
