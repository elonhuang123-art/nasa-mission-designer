// Screens and interaction. Uses data.js, engine.js, designer.js, craft.js, scenes.js and orbiter3d.js.

const STEPS = ['Mission', 'Spacecraft', 'Rocket', 'Launch', 'Flight', 'Results'];

const defaultBuild = () => ({
  bus: 'medium', instruments: [], solar: 'medium', rtg: 0, battery: 'small',
  antenna: 'mga', engine: 'mono', fuel: 100, shield: 'none', backup: false, testing: 'standard'
});

const state = {
  screen: 'mission',
  mission: null,
  builds: {},
  designs: {},
  sim: null,
  flight: null,      // { kind: 'test' | 'mission', outcome, analysis, plan }
  report: null
};

const $ = (sel) => document.querySelector(sel);
const app = () => $('#app');
const money = (m) => `${m < 0 ? '−' : ''}$${Math.abs(Math.round(m)).toLocaleString()}M`;
const kg = (v) => `${Math.round(v).toLocaleString()} kg`;
const num = (v) => Math.round(v).toLocaleString();
const build = () => state.builds[state.mission.id];
const design = () => state.designs[state.mission.id];
let raf = null;

function loadBest(id) { try { return Number(localStorage.getItem('md-best-' + id)) || 0; } catch (e) { return 0; } }
function saveBest(id, v) { try { localStorage.setItem('md-best-' + id, String(v)); } catch (e) { /* storage unavailable */ } }

// ---------- Saving progress (so a reload continues where you left off) ----------

function saveState() {
  try {
    const f = state.flight;
    const data = {
      screen: state.screen, missionId: state.mission ? state.mission.id : null, builds: state.builds, designs: state.designs,
      flight: f && state.screen === 'liftoff' ? { kind: f.kind, outcome: f.outcome, P: Orbiter3D.info ? safeP() : 0 } : null
    };
    localStorage.setItem('md-state', JSON.stringify(data));
  } catch (e) { /* storage unavailable */ }
}
function safeP() { try { return Orbiter3D.info().P; } catch (e) { return 0; } }

function restoreState() {
  let data;
  try { data = JSON.parse(localStorage.getItem('md-state') || 'null'); } catch (e) { data = null; }
  if (!data || !data.missionId) return false;
  state.mission = byId(MISSIONS, data.missionId);
  if (!state.mission) return false;
  state.builds = data.builds || {};
  state.designs = data.designs || {};
  if (!state.builds[state.mission.id]) state.builds[state.mission.id] = defaultBuild();
  if (!state.designs[state.mission.id]) state.designs[state.mission.id] = designDefaults();
  // The game always opens on the mission page. Your spacecraft and rocket designs are kept.
  state.screen = 'mission';
  return true;
}

// ---------- Shared pieces ----------

function header() {
  const idx = { mission: 0, build: 1, launch: 2, liftoff: 3, fly: 4, review: 5 }[state.screen];
  const target = ['mission', 'build', 'launch', 'liftoff', 'fly', 'review'];
  const reachable = (i) => i === 0 || (state.mission && (i <= 2 || (i === 3 && state.flight) || (i === 4 && state.sim && state.sim.alive && state.screen !== 'mission' && ['fly', 'review'].includes(state.screen)) || (i === 5 && state.report && state.screen === 'review')));
  const items = STEPS.map((s, i) => {
    const cls = i === idx ? 'current' : i < idx ? 'done' : '';
    const inner = `<span class="num">${i + 1}</span><span class="lbl">${s}</span>`;
    const body = i !== idx && reachable(i) ? `<button data-action="step" data-to="${target[i]}">${inner}</button>` : `<span class="step-static">${inner}</span>`;
    return `<li class="${cls}" ${i === idx ? 'aria-current="step"' : ''}>${body}</li>`;
  }).join('');
  const m = state.mission;
  return `<header class="top">
    <button class="brand" data-action="home" aria-label="Mission Designer: back to the main page">
      <svg class="logo-mark brand-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(-25 12 12)"/></svg>Mission Designer
    </button>
    <ol class="stepper">${items}</ol>
    <button class="nasa-btn" data-action="sources">NASA data &amp; sources</button>
    <div class="mission-chip">${m && state.screen !== 'mission' ? `${m.name}<span>${money(m.budget)} budget</span>` : '<span>NASA Space Apps Challenge</span>'}</div>
  </header>`;
}

function render() {
  const screens = { mission: renderMission, build: renderBuild, launch: renderDesigner, liftoff: renderLiftoff, fly: renderFly, review: renderReview };
  const focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focus : null;
  app().innerHTML = (state.screen === 'mission' ? '' : header()) + `<main class="screen screen-${state.screen}">${screens[state.screen]()}</main>`;
  document.body.classList.toggle('is-orb', state.screen === 'liftoff');
  document.body.classList.toggle('is-hero', state.screen === 'mission');
  if (focusId) {
    const el = document.querySelector(`[data-focus="${CSS.escape(focusId)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  if (state.screen === 'fly') mountSatView();
  if (state.screen === 'mission') mountHeroSat();
  if (state.screen === 'build') mountBuildSat();
  if (state.screen === 'launch') mountRocket();
  if (state.screen === 'build' || state.screen === 'launch') warm3D();
  saveState();
}

function go(screen) {
  if (['liftoff', 'fly', 'mission', 'build', 'launch'].includes(state.screen) && screen !== state.screen) Orbiter3D.close();
  state.screen = screen;
  render();
  window.scrollTo({ top: 0 });
  if (screen === 'liftoff') openOrbiter();
}

// ---------- 1. Mission select ----------

function renderMission() {
  const cards = MISSIONS.map((m) => {
    const best = loadBest(m.id);
    return `<button class="hcard" data-action="pick-mission" data-id="${m.id}" data-focus="pick-${m.id}" aria-label="Plan ${m.name}">
      <span class="hthumb sat-thumb" id="hero-sat"><img class="hero-sat-img" src="assets/hero-sat.jpg" alt="An ocean satellite with unfolded solar panels, above Earth" width="438" height="240"></span>
      <span class="hcard-body">
        <span class="hcard-diff">${m.difficulty}${best ? ` \u00b7 best ${best}` : ''}</span>
        <span class="hcard-name">${m.name}</span>
        <span class="hcard-target">${m.tagline}</span>
        <span class="hcard-target">${money(m.budget)} budget</span>
        <span class="hcard-go">Start the mission -&gt;</span>
      </span>
    </button>`;
  }).join('');
  return `<div class="hero">
    <div class="hui">
      <header class="htitle">
        <svg class="logo-mark hmark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(-25 12 12)"/></svg>
        <div><h1>Mission Designer</h1><p>NASA Space Apps Challenge \u00b7 design, launch and fly an Earth satellite</p></div>
      </header>
      <div class="hmissions" aria-label="Choose a mission">${cards}</div>
    </div>
  </div>`;
}

// ---------- 2. Spacecraft ----------

function specLine(o) {
  const bits = [];
  if (o.mass) bits.push(`<span>${o.mass} kg</span>`);
  if (o.power) bits.push(`<span>${o.power} W</span>`);
  if (o.cost) bits.push(`<span>${money(o.cost)}</span>`);
  return bits.length ? `<span class="specs">${bits.join('')}</span>` : '';
}

function radioGroup(key, list, extra = () => '') {
  const b = build();
  return `<div class="options" role="radiogroup">${list.map(o => `
    <button class="opt ${b[key] === o.id ? 'on' : ''}" role="radio" aria-checked="${b[key] === o.id}"
      data-action="set" data-key="${key}" data-value="${o.id}" data-focus="${key}-${o.id}">
      <span class="opt-name">${o.name}</span>${specLine(o)}
      <span class="opt-desc">${o.desc}</span>${extra(o)}
    </button>`).join('')}</div>`;
}

function section(title, why, body) {
  return `<section class="cat"><h3>${title}</h3><p class="why">${why}</p>${body}</section>`;
}

function renderBuild() {
  const m = state.mission, b = build();
  const a = analyze(b, m);

  const instButtons = INSTRUMENTS.map(i => {
    const on = b.instruments.includes(i.id);
    const helps = m.objectives.filter(o => o.instruments[i.id]).length;
    const tag = helps ? `<span class="tag good">Helps ${helps} goal${helps > 1 ? 's' : ''}</span>` : `<span class="tag muted">No use on this mission</span>`;
    return `<button class="opt ${on ? 'on' : ''}" role="checkbox" aria-checked="${on}" data-action="toggle-inst" data-value="${i.id}" data-focus="inst-${i.id}">
      <span class="opt-name">${i.name}</span>${specLine(i)}
      <span class="opt-desc">${i.desc} Makes ${i.data >= 0.1 ? i.data + ' Mbps' : 'very little data'}.</span>${tag}
    </button>`;
  }).join('');

  const fuelDisabled = b.engine === 'none';
  const catalog = [
    section('Spacecraft body', 'The bus holds the computer, wiring and heaters. Bigger buses carry more instruments but weigh more.',
      radioGroup('bus', BUSES)),
    section(`Science instruments <span class="count">${b.instruments.length} of ${a.slots} slots</span>`,
      'These answer your mission’s questions. Check which goals each one helps.',
      `<div class="options">${instButtons}</div>`),
    section('Solar panels', `Sunlight at your destination is ${Math.round(a.sunlight * 100)}% of what reaches Earth${m.eclipse ? `, and you’ll spend ${Math.round(m.eclipse * 100)}% of each orbit in shadow` : ''}.`,
      radioGroup('solar', SOLAR, o => o.power ? `<span class="tag">${Math.round(o.power * a.sunlight * (1 - m.eclipse))} W here</span>` : '')),
    section('Nuclear power (RTGs)', 'Radioisotope generators make steady power from decaying plutonium, anywhere, day or night. Each gives 110 W.',
      `<div class="stepper-input">
        <button class="btn small" data-action="rtg" data-delta="-1" data-focus="rtg-minus" ${b.rtg === 0 ? 'disabled' : ''} aria-label="Remove an RTG">−</button>
        <output aria-live="polite">${b.rtg} RTG${b.rtg === 1 ? '' : 's'}</output>
        <button class="btn small" data-action="rtg" data-delta="1" data-focus="rtg-plus" ${b.rtg >= RTG.max ? 'disabled' : ''} aria-label="Add an RTG">+</button>
        ${specLine(RTG)}<span class="opt-desc">each</span>
      </div>`),
    section('Battery', `Keeps everything running in shadow and during launch. You need about ${Math.round(a.batteryNeeded)} Wh.`,
      radioGroup('battery', BATTERIES)),
    section('Antenna', `Your signal has to cross ${m.signalDelay} of light travel. Weaker with distance squared.`,
      radioGroup('antenna', ANTENNAS, o => `<span class="tag">${fmtRate(o.rate / (m.commDist * m.commDist))} here</span>`)),
    section('Engine and fuel', `You need ${m.dvRequired} km/s of push (delta-v) after launch to ${m.cruiseMonths ? 'brake into orbit and steer' : 'reach and hold your orbit'}.`,
      radioGroup('engine', ENGINES) +
      `<label class="fuel ${fuelDisabled ? 'disabled' : ''}">
        <span>Fuel load <output id="fuel-out">${kg(b.fuel)}</output></span>
        <input type="range" min="0" max="3000" step="10" value="${b.fuel}" data-action="fuel" data-focus="fuel" ${fuelDisabled ? 'disabled' : ''}>
      </label>`),
    section('Protection and reliability', 'Radiation scrambles electronics. Testing and spare parts cost money now but save missions later.',
      radioGroup('shield', SHIELDS) +
      `<button class="opt wide ${b.backup ? 'on' : ''}" role="checkbox" aria-checked="${b.backup}" data-action="backup" data-focus="backup">
        <span class="opt-name">Backup flight computer</span>${specLine(BACKUP)}
        <span class="opt-desc">If the main computer dies, this one takes over.</span>
      </button>` + radioGroup('testing', TESTING))
  ].join('');

  return `<div class="page-head"><h1>Build your spacecraft</h1><p>${m.name}: ${m.tagline}</p>
      <p class="real-note"><b>How NASA does it</b> Engineers at NASA Glenn\u2019s COMPASS lab design spacecraft concepts the same way, trading power, mass and cost, from Earth satellites to the Mars Moon Sampler idea for returning samples from Phobos and Deimos. <button class="link-btn" data-action="sources">See the NASA data</button></p></div>
    <div class="build-grid">
    <div class="catalog">${catalog}</div>
    <aside class="status" id="status" aria-label="Spacecraft status">${statusPanel(a)}</aside>
  </div>`;
}

function fmtRate(r) {
  if (r >= 1) return `${r.toFixed(r >= 10 ? 0 : 1)} Mbps`;
  if (r >= 0.01) return `${(r * 1000).toFixed(0)} kbps`;
  return `${(r * 1000).toFixed(1)} kbps`;
}

function meter(label, valueText, used, limit, opts = {}) {
  const ratio = limit > 0 ? used / limit : (used > 0 ? 2 : 0);
  let cls;
  if (opts.higherIsBetter) cls = ratio >= 1.1 ? 'ok' : ratio >= 1 ? 'warn' : 'bad';
  else cls = ratio <= 0.85 ? 'ok' : ratio <= 1 ? 'warn' : 'bad';
  const fill = Math.min(1, ratio);
  const mark = opts.mark ? `<span class="mark" style="left:${Math.min(100, opts.mark * 100).toFixed(1)}%"></span>` : '';
  return `<div class="meter ${cls}">
    <div class="meter-top"><span>${label}</span><span class="val">${valueText}</span></div>
    <div class="bar"><div class="fill" style="width:${(fill * 100).toFixed(1)}%"></div>${mark}</div>
  </div>`;
}

function statusPanel(a) {
  const m = state.mission, b = build();
  const spent = a.buildCost + a.opsCost;
  const pot = Math.round(sciencePotential(m, b.instruments));
  const warns = warnings(a, m);
  const blocked = warns.some(w => w.level === 'block');

  return `<div class="build3d" id="build3d" aria-label="Your satellite in 3D. Parts appear as you choose them.">
      <div class="craft-frame b3-flat">${drawCraft(b)}</div>
      <span class="b3-cap" id="b3-cap" aria-live="polite"></span>
      <span class="b3-help">Drag to turn it \u00b7 scroll to zoom</span>
    </div>
    <div class="potential"><span>Science potential</span><strong>${pot}<small>/100</small></strong></div>
    <ul class="goals">${objectiveScores(m, b.instruments).map(o =>
      `<li><span class="goal-bar"><span style="width:${o.coverage * 100}%"></span></span>${o.name}<em>${o.weight}</em></li>`).join('')}</ul>
    <div class="meters">
      ${meter('Budget used', `${money(spent)} of ${money(m.budget)}`, spent, m.budget)}
      <p class="note">Includes ${money(a.opsCost)} for the mission team. You design the rocket next.</p>
      ${meter('Power', `${Math.round(a.powerNeeded)} W needed, ${Math.round(a.powerAvailable)} W made`, a.powerNeeded, a.powerAvailable)}
      ${meter('Data', `${fmtRate(a.dataMade)} made, ${fmtRate(a.downlink)} sent`, a.dataMade, a.downlink)}
      ${meter('Push (delta-v)', `${a.dv.toFixed(2)} of ${m.dvRequired.toFixed(2)} km/s`, a.dv, m.dvRequired, { higherIsBetter: true })}
      ${meter('Battery', `${Math.round(a.batteryNeeded)} Wh needed, ${a.battery.wh.toLocaleString()} Wh stored`, a.batteryNeeded, a.battery.wh || (a.rtgPower ? a.batteryNeeded * 2 : 0))}
      <div class="mass"><span>Launch mass (your rocket’s payload)</span><strong>${kg(a.wetMass)}</strong></div>
    </div>
    ${warns.length ? `<ul class="warnings">${warns.map(w => `<li class="${w.level}">${w.text}</li>`).join('')}</ul>` : `<p class="all-clear">No problems found. Ready to design a rocket.</p>`}
    <div class="actions">
      <button class="btn ghost" data-action="go" data-to="mission">Change mission</button>
      <button class="btn primary" data-action="go" data-to="launch" ${blocked ? 'disabled' : ''}>Design the rocket</button>
    </div>`;
}

// ---------- 3. Rocket Designer ----------

function slider(key, label, min, max, step, fmt, help, disabled) {
  const d = design();
  return `<label class="slider ${disabled ? 'disabled' : ''}">
    <span class="slider-top"><span>${label}</span><output id="out-${key}">${fmt(d[key])}</output></span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${d[key]}" data-action="dslider" data-key="${key}" data-focus="ds-${key}" ${disabled ? 'disabled' : ''} aria-label="${label}">
    ${help ? `<span class="slider-help">${help}</span>` : ''}
  </label>`;
}

function segmented(key, label, items) {
  const d = design();
  return `<div class="seg-field"><span class="seg-label">${label}</span><div class="seg" role="radiogroup" aria-label="${label}">${items.map(([v, name]) =>
    `<button role="radio" aria-checked="${String(d[key]) === String(v)}" class="${String(d[key]) === String(v) ? 'on' : ''}" data-action="dset" data-key="${key}" data-value="${v}" data-focus="dset-${key}-${v}">${name}</button>`).join('')}</div></div>`;
}

function rocketAnalysis() {
  const pay = analyze(build(), state.mission).wetMass;
  return analyzeRocket(design(), pay, state.mission);
}

function renderDesigner() {
  const m = state.mission, d = design();
  const pay = analyze(build(), m).wetMass;
  const presets = ROCKET_PRESETS.map(p => `<button class="preset" data-action="preset" data-id="${p.id}" data-focus="preset-${p.id}"><strong>${p.name} <em>${money(analyzeRocket(p.d, pay, m).cost)}</em></strong><span>${p.note}</span></button>`).join('');
  return `<div class="page-head">
      <h1>Rocket Designer</h1>
      <p>Your payload is the ${kg(pay)} spacecraft you built. ${m.id === 'earth' ? 'Reaching low Earth orbit takes about 7.8 km/s of speed, plus extra to fight gravity and air drag.' : `Leaving Earth for ${m.id === 'mars' ? 'Mars' : 'Jupiter'} takes ${DV_EXTRA[m.id]} km/s on top of reaching orbit.`} Test-fly as often as you like. Test flights are free.</p>
      <div class="presets"><span>Start from a preset</span>${presets}</div>
      <p class="real-note"><b>Real rocket check</b> NASA\u2019s Space Launch System lifts 70 metric tons to low Earth orbit (more than 154,000 pounds, evolvable to 130 t) with 10% more thrust than Saturn V, using four RS-25 engines and two 5-segment solid boosters. It flew Artemis I on Nov 16, 2022. Source: NASA Marshall, Creech 2013. <button class="link-btn" data-action="sources">All sources</button></p>
    </div>
    <div class="designer-grid">
      <div class="d-inputs">
        <section class="cat"><h3>Structure</h3>
          ${slider('dryMass', 'Dry weight (empty rocket)', 2000, 150000, 500, v => kg(v), 'Tanks, engines and structure, without fuel.')}
          ${segmented('stages', 'Stages', [[1, '1 stage'], [2, '2 stages'], [3, '3 stages']])}
          ${segmented('strength', 'Structural strength', Object.entries(STRENGTH).map(([k, s]) => [k, s.name]))}
          <p class="why">${STRENGTH[d.strength].desc}</p>
        </section>
        <section class="cat"><h3>Propulsion</h3>
          ${segmented('fuelType', 'Fuel type', Object.entries(FUELS).map(([k, f]) => [k, f.name.split(' (')[0]]))}
          <p class="why">${FUELS[d.fuelType].name}. ${FUELS[d.fuelType].desc} Efficiency (Isp): ${FUELS[d.fuelType].ispSl} s at sea level, ${FUELS[d.fuelType].ispVac} s in vacuum.</p>
          ${slider('fuelMass', 'Fuel load', 10000, 2000000, 5000, v => kg(v), 'Split between stages: the first stage carries most of it.')}
          ${slider('engines', 'Engines on the first stage', 1, 15, 1, v => `${v}`, 'Upper stages use one engine each.')}
          ${slider('thrust', 'Thrust per engine', 100, 3000, 50, v => `${num(v)} kN`, 'Above 2,000 kN, engines are pushed hard and fail more often.')}
          ${slider('burnTime', 'Burn time per stage', 30, 900, 10, v => `${v} s`, d.fuelType === 'solid' ? 'Solid motors burn until empty.' : 'How long each stage is allowed to fire.', d.fuelType === 'solid')}
        </section>
        <section class="cat"><h3>Aerodynamics</h3>
          ${segmented('fins', 'Fin size', FINS.map(f => [f.id, f.name]))}
          ${segmented('nose', 'Nose cone', Object.entries(NOSES).map(([k, n]) => [k, n.name]))}
          <p class="why">Fins move the center of pressure back, which keeps the rocket pointed straight. They also add drag.</p>
        </section>
        <section class="cat"><h3>Payload</h3>
          <div class="payload-row"><span>Your spacecraft</span><strong>${kg(pay)}</strong></div>
          <p class="why">Set by what you built. Change it on the Spacecraft step.</p>
        </section>
      </div>
      <aside class="status d-live" id="d-live" aria-label="Rocket checks">${designerLive(rocketAnalysis())}</aside>
    </div>`;
}

function rocketDiagram(a) {
  const d = a.d, H = 300, W = 30, base = 336, cx = 70;
  const scale = H / a.L;
  let y = base, parts = '';
  a.per.forEach((s, i) => {
    const h = a.heights[i] * scale;
    parts += `<rect x="${cx - W / 2}" y="${y - h}" width="${W}" height="${h}" class="d-stage"/>
      <text x="${cx}" y="${y - h / 2 + 4}" class="d-stage-num">${i + 1}</text>`;
    if (i > 0) parts += `<line x1="${cx - W / 2}" y1="${y}" x2="${cx + W / 2}" y2="${y}" class="d-joint"/>`;
    y -= h;
  });
  const fh = a.fairH * scale;
  const noseTop = y - fh;
  const nosePath = d.nose === 'blunt' ? `M${cx - W / 2},${y} L${cx - W / 2},${y - fh * 0.55} Q${cx - W / 2},${noseTop} ${cx},${noseTop} Q${cx + W / 2},${noseTop} ${cx + W / 2},${y - fh * 0.55} L${cx + W / 2},${y} Z`
    : d.nose === 'conical' ? `M${cx - W / 2},${y} L${cx},${noseTop} L${cx + W / 2},${y} Z`
    : `M${cx - W / 2},${y} Q${cx - W / 2},${y - fh * 0.8} ${cx},${noseTop} Q${cx + W / 2},${y - fh * 0.8} ${cx + W / 2},${y} Z`;
  parts += `<path d="${nosePath}" class="d-nose"/><rect x="${cx - 6}" y="${y - fh * 0.45}" width="12" height="10" class="d-payload"/>`;
  if (d.fins > 0) {
    const fs = [0, 12, 20, 30][d.fins];
    parts += `<path d="M${cx - W / 2},${base - fs * 1.8} L${cx - W / 2 - fs},${base} L${cx - W / 2},${base} Z" class="d-fin"/>
      <path d="M${cx + W / 2},${base - fs * 1.8} L${cx + W / 2 + fs},${base} L${cx + W / 2},${base} Z" class="d-fin"/>`;
  }
  const n = Math.min(d.engines, 5);
  for (let i = 0; i < n; i++) {
    const ex = cx - W / 2 + (W / (n + 1)) * (i + 1);
    parts += `<path d="M${ex - 2.5},${base} L${ex + 2.5},${base} L${ex + 4},${base + 9} L${ex - 4},${base + 9} Z" class="d-bell"/>`;
  }
  const cmY = base - a.cm * (base - noseTop), cpY = base - a.cp * (base - noseTop);
  parts += `<g class="d-cm"><circle cx="${cx}" cy="${cmY}" r="7"/><path d="M${cx},${cmY - 7} A7,7 0 0 1 ${cx + 7},${cmY} L${cx},${cmY} Z M${cx},${cmY + 7} A7,7 0 0 1 ${cx - 7},${cmY} L${cx},${cmY} Z" class="d-cm-fill"/></g>
    <line x1="${cx + 12}" y1="${cmY}" x2="${cx + 34}" y2="${cmY}" class="d-lead"/><text x="${cx + 38}" y="${cmY + 4}" class="d-lab">Center of mass</text>
    <g class="d-cp"><circle cx="${cx}" cy="${cpY}" r="6"/><circle cx="${cx}" cy="${cpY}" r="2"/></g>
    <line x1="${cx + 12}" y1="${cpY}" x2="${cx + 34}" y2="${cpY}" class="d-lead red"/><text x="${cx + 38}" y="${cpY + 4}" class="d-lab red">Center of pressure</text>`;
  return `<svg viewBox="0 0 230 360" class="rocket-diagram" role="img" aria-label="Side view of your rocket with center of mass and center of pressure">${parts}</svg>`;
}

function designerLive(a) {
  const m = state.mission;
  const craft = analyze(build(), m);
  const v = rocketVerdict(a);
  const tips = rocketTips(a);
  const total = craft.buildCost + craft.opsCost + a.cost;
  const over = total > m.budget;
  const stabText = { stable: 'Stable', marginal: 'Marginal: will wobble', unstable: 'Unstable: will spin out' }[a.stability];
  const canLaunch = a.twr >= 1 && !over;
  return `<div class="verdict v-${v.level}">${v.text}</div>
    <div class="test-box">
      <button class="btn test-btn" data-action="test-flight" data-focus="test-flight">Test flight: free</button>
      <p>Try this design in 3D as many times as you like. Test flights cost nothing and don’t use your budget.</p>
    </div>
    <div class="d-live-grid">
      <div class="diagram-frame rk3d" id="rk3d" aria-label="Your rocket in 3D. It changes as you edit the design.">
        <div class="rk-flat">${rocketDiagram(a)}</div>
        <span class="b3-cap" id="rk-cap" aria-live="polite"></span>
      </div>
      <div class="checks">
        ${meter('Thrust-to-weight', `${a.twr.toFixed(2)} (needs above 1)`, a.twr, 1.2, { higherIsBetter: true })}
        ${meter('Delta-v', `${a.dv.toFixed(1)} of ${a.needed.toFixed(1)} km/s`, a.dv, a.needed, { higherIsBetter: true, mark: m.id !== 'earth' ? a.needOrbit / a.needed : 0 })}
        ${meter('Max-Q stress', `${Math.round(a.stress * 100)}% of the limit`, a.stress, 1)}
        <div class="check-row ${a.stability}"><span>Stability</span><strong>${stabText}</strong></div>
        <div class="check-row ${a.pIgn > 0.08 ? 'marginal' : 'stable'}"><span>Engine start risk</span><strong>${(a.pIgn * 100).toFixed(1)}%</strong></div>
        ${a.unburned > 500 ? `<div class="check-row marginal"><span>Fuel never burned</span><strong>${kg(a.unburned)}</strong></div>` : ''}
      </div>
    </div>
    ${m.id !== 'earth' ? `<p class="note">The tick on the delta-v bar marks reaching orbit. The rest is the push to leave Earth.</p>` : ''}
    <div class="ledger compact">
      <div><span>Rocket</span><strong>${money(a.cost)}</strong></div>
      <div><span>Spacecraft and team</span><strong>${money(craft.buildCost + craft.opsCost)}</strong></div>
      <div class="total ${over ? 'over' : ''}"><span>Total of ${money(m.budget)}</span><strong>${money(total)}</strong></div>
    </div>
    ${tips.length ? `<ul class="warnings">${tips.map(t => `<li class="warn">${t}</li>`).join('')}</ul>` : ''}
    <div class="actions">
      <button class="btn ghost" data-action="go" data-to="build">Back to the spacecraft</button>
      <button class="btn primary" data-action="launch" ${canLaunch ? '' : 'disabled'}>Launch the mission</button>
    </div>
    ${canLaunch ? '' : `<p class="launch-block">${over
      ? `Launch is locked: you are ${money(total - m.budget)} over budget. Pick a cheaper rocket preset, use fewer or weaker engines, or cut spacecraft costs.`
      : `Launch is locked: thrust-to-weight is ${a.twr.toFixed(2)}, so the rocket cannot leave the pad. Add engines or thrust, or carry less fuel.`}</p>`}`;
}

// ---------- 4. 3D launch ----------

function renderLiftoff() {
  const f = state.flight, m = state.mission;
  const title = f.kind === 'test' ? 'Test flight' : `${m.name} launch`;
  const d = f.analysis.d;
  return `<div class="orb" id="orb">
    <div class="orb-stage" id="orb-stage"><div class="orb-loading" id="orb-loading">Loading the ORBITER-1 model</div></div>
    <div class="orb-split" id="orb-split" hidden>
      <span style="left:12px;top:12px">Onboard camera</span><span style="left:calc(50% + 12px);top:12px">Nose camera</span>
      <span style="left:12px;top:calc(50% + 12px)">Spectator on the beach</span><span style="left:calc(50% + 12px);top:calc(50% + 12px)">View from space</span>
    </div>
    <div class="orb-center" id="orb-center" aria-live="assertive"></div>
    <div class="orb-count" id="orb-count" aria-live="polite"></div>
    <div class="orb-fact" id="orb-fact" aria-live="polite"></div>
    <div class="orb-altbar" id="orb-altbar">${altBarSvg()}</div>
    <aside class="orb-panel orb-left">
      <p class="kicker">ORBITER-1</p>
      <h1>${title}</h1>
      <p class="orb-sub">${d.stages}-stage rocket, ${d.engines} engine${d.engines > 1 ? 's' : ''}, ${FUELS[d.fuelType].name.split(' (')[0].toLowerCase()}. Payload ${kg(f.analysis.payloadKg)}.</p>
      <ol class="orb-phases" id="orb-phases"></ol>
      <p class="orb-note">Event times follow NASA’s SWOT launch (Falcon 9, SLC-4E, Vandenberg Space Force Base, Dec 16 2022), from the NASA JPL SWOT press kit. ≈ marks approximate times.</p>
    </aside>
    <aside class="orb-panel orb-right">
      <dl class="orb-tel">
        <div><dt>Mission clock</dt><dd id="tel-clock">T−0:10</dd></div>
        <div><dt>Altitude (est)</dt><dd id="tel-alt">0 km</dd></div>
        <div><dt>Status</dt><dd id="tel-stage">On the pad</dd></div>
      </dl>
      <div class="speed-panel">
        <div class="speed-top"><span>Speed (est)</span><strong id="tel-speed">0 km/h</strong></div>
        <p class="speed-mach" id="tel-mach">Mach 0.0</p>
        <div class="speed-bar">${SPEEDS.map(([v, n], i) => `<span class="tick ${i % 2 ? 'low' : ''}" style="left:${speedX(v)}%"><i></i><em>${n}</em></span>`).join('')}<span class="now" id="speed-now"></span></div>
      </div>
      <p class="orb-note">Altitude and speed are estimates, not NASA telemetry. Speed of sound: NASA Glenn. ISS and escape speeds: NASA.</p>
      <div class="seg-field"><span class="seg-label">Earth’s field</span><div class="seg">
        <button data-action="orb-mag" id="orb-mag">Magnetosphere</button>
      </div></div>
      <div class="seg-field"><span class="seg-label">Satellite</span><div class="seg">
        <button data-action="orb-stowed">Stowed</button><button data-action="orb-deployed">Deployed</button>
      </div></div>
      <div class="seg-field"><span class="seg-label">Download the model</span><div class="seg">
        <button data-action="orb-glb">GLB</button><button data-action="orb-obj">OBJ + MTL</button>
      </div></div>
      <div id="orb-report"></div>
    </aside>
    <div class="orb-panel orb-bottom">
      <button class="btn primary orb-play" id="orb-play" data-action="orb-play">Launch</button>
      <span class="orb-clock" id="orb-clock">T−0:10</span>
      <div class="seg" id="orb-cams" role="group" aria-label="Camera">
        <button data-action="orb-cam" data-mode="cinematic" class="on">Cinematic</button><button data-action="orb-cam" data-mode="split">Split</button><button data-action="orb-cam" data-mode="free">Free</button>
      </div>
    </div>
  </div>`;
}

// Speed comparison (log scale) and altitude bar (log scale), from the ORBITER-1 prompt
const SPEEDS = [[100, 'Highway car'], [900, 'Airliner'], [1225, 'Sound'], [28000, 'ISS orbit'], [40300, 'Escape']];
const speedX = (v) => Math.max(0, Math.min(1, Math.log10(Math.max(v, 10) / 10) / Math.log10(5000))) * 100;
const ALT_H = 440, altY = (km) => ALT_H - ALT_H * Math.log10(1 + Math.max(0, km)) / Math.log10(70001);
function altBarSvg() {
  const LAYERS = [[0, 12, 'Troposphere'], [12, 50, 'Stratosphere'], [50, 80, 'Mesosphere'], [80, 700, 'Thermosphere'], [700, 10000, 'Exosphere']];
  const marks = [[100, 'K\u00e1rm\u00e1n line 100 km'], [857, 'SWOT orbit 857 km'], [65000, 'Magnetopause \u224865,000 km']];
  const bands = [[1000, 12000, 'Inner Van Allen belt', '#ff9a3c'], [13000, 60000, 'Outer Van Allen belt', '#b46bff']];
  let g = LAYERS.map(([a, b, n], i) => `<rect x="0" y="${altY(b)}" width="14" height="${altY(a) - altY(b)}" fill="${i % 2 ? '#1b2b48' : '#13213a'}"/><text x="20" y="${(altY(a) + altY(b)) / 2 + 3}" class="ab-layer">${n}</text>`).join('');
  g += bands.map(([a, b, n, c]) => `<rect x="0" y="${altY(b)}" width="5" height="${altY(a) - altY(b)}" fill="${c}"/><text x="20" y="${(altY(a) + altY(b)) / 2 + 3}" class="ab-band">${n}</text>`).join('');
  g += marks.map(([km, n]) => `<line x1="0" x2="16" y1="${altY(km)}" y2="${altY(km)}" class="ab-mark"/><text x="20" y="${altY(km) - 3}" class="ab-mark-t">${n}</text>`).join('');
  g += `<g id="alt-now" class="ab-now"><line x1="-6" x2="20" y1="0" y2="0"/><path d="M-10,-5 L-3,0 L-10,5 Z"/></g>`;
  return `<p class="kicker">Altitude (log scale)</p><svg viewBox="-12 -6 200 ${ALT_H + 12}" class="ab-svg" role="img" aria-label="Altitude on a log scale with atmosphere layers">${g}</svg>`;
}

function phasesHtml(plan) {
  return plan.events.map((e, i) => `<li data-i="${i}" class="${e.tone ? 't-' + e.tone : ''}"><button data-action="orb-seek" data-t="${e.T}"><span class="ph-t">${e.label}</span><span class="ph-x">${e.text}</span></button></li>`).join('');
}

let hudLast = {};
function openOrbiter() {
  const f = state.flight;
  $('#orb-phases').innerHTML = phasesHtml(f.plan);
  hudLast = {};
  Orbiter3D.ensure().then(() => {
    if (state.screen !== 'liftoff') return;
    const ld = $('#orb-loading'); if (ld) ld.remove();
    Orbiter3D.open($('#orb-stage'), f.plan, { onTick: updateHud, onEnd: () => { updateHud(Orbiter3D.info()); saveState(); },
      onMode: (m) => { document.querySelectorAll('#orb-cams button').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); flashCenter('Free camera: drag to look around, scroll to zoom'); } }, f.startP || 0);
    Orbiter3D.setMode('cinematic');
    if (f.autoplay) Orbiter3D.play();
  }).catch((e) => {
    const ld = $('#orb-loading');
    if (ld) ld.textContent = '3D view could not start: ' + e.message + '.';
  });
}

let lastSave = 0;
function updateHud(info) {
  if (state.screen !== 'liftoff') return;
  const set = (id, v) => { if (hudLast[id] !== v) { hudLast[id] = v; const el = document.getElementById(id); if (el) el.textContent = v; } };
  set('tel-clock', info.clock); set('orb-clock', info.clock);
  set('tel-alt', `${info.alt < 10 ? info.alt.toFixed(1) : Math.round(info.alt)} km`);
  set('tel-speed', `${Math.round(info.kmh).toLocaleString()} km/h`);
  set('tel-mach', info.mach === null ? 'Mach \u2014 no air' : `Mach ${info.mach.toFixed(1)}`);
  set('tel-stage', info.stage);
  const sn = document.getElementById('speed-now'); if (sn) sn.style.left = speedX(info.kmh) + '%';
  const an = document.getElementById('alt-now'); if (an) an.setAttribute('transform', `translate(0 ${altY(info.alt).toFixed(1)})`);
  // Countdown at the top, next to the title panel
  const cd = info.countdown !== null && info.countdown > 0 ? `T\u2212${info.countdown}` : (info.T >= 0 && info.T < 3 && !['scrub', 'nothrust'].includes(info.kind) ? 'LIFTOFF' : '');
  set('orb-count', cd);
  // One fact card at a time, with its source
  const cardKey = info.card ? info.card.k : '';
  if (hudLast.card !== cardKey) {
    hudLast.card = cardKey;
    const fc = $('#orb-fact');
    if (fc) { fc.innerHTML = info.card ? `<p class="kicker">${info.card.k}</p><p class="fact-t">${info.card.t}</p><p class="fact-s">Source: ${info.card.s}</p>` : ''; fc.classList.toggle('on', !!info.card); }
  }
  const mb = document.getElementById('orb-mag'); if (mb) mb.classList.toggle('on', !!info.magForced);
  const scrub = $('#orb-scrub');
  if (scrub && document.activeElement !== scrub) scrub.value = info.P.toFixed(2);
  const label = info.playing ? 'Pause' : info.ended ? 'Replay' : info.P > 0.01 ? 'Resume' : 'Launch';
  set('orb-play', label);

  // Active phase
  let cur = -1;
  info.events.forEach((e, i) => { if (info.T >= e.T - 0.01) cur = i; });
  if (hudLast.phase !== cur) {
    hudLast.phase = cur;
    document.querySelectorAll('#orb-phases li').forEach((li, i) => { li.classList.toggle('done', i < cur); li.classList.toggle('now', i === cur); });
    const now = document.querySelector('#orb-phases li.now');
    if (now) now.scrollIntoView({ block: 'nearest' });
  }

  // Center message
  let msg = '', cls = '';
  if (info.kind === 'scrub' && info.T > -1.2) { msg = 'Scrub'; cls = 'bad'; }
  else if (info.kind === 'nothrust' && info.T > 3 && !info.lost) { msg = 'Not enough thrust'; cls = 'bad'; }
  else if (info.lost) { msg = info.kind === 'suborbital' ? 'Suborbital: fell back to Earth' : 'Vehicle lost'; cls = 'bad'; }
  else if (info.warn) { msg = info.warn; cls = 'warn'; }
  const key = msg + cls;
  if (hudLast.center !== key) {
    hudLast.center = key;
    const c = $('#orb-center');
    const reason = info.lost || cls === 'bad' ? state.flight.outcome.reason : '';
    c.className = 'orb-center ' + cls;
    c.innerHTML = msg ? `<strong>${msg}</strong>${reason && cls === 'bad' ? `<span>${reason}</span>` : ''}` : '';
  }

  // Report card and next step
  const reportKey = `${info.ended}-${info.T >= 504}`;
  if (hudLast.report !== reportKey) { hudLast.report = reportKey; renderReport(info); }

  if (performance.now() - lastSave > 1500) { lastSave = performance.now(); saveState(); }
}

function renderReport(info) {
  const f = state.flight, o = f.outcome;
  const el = $('#orb-report');
  if (!el) return;
  const success = o.kind === 'orbit' || o.kind === 'wobble';
  const decided = info.ended || (success && info.T >= 504);
  if (!decided) { el.innerHTML = ''; return; }
  const rep = flightReport(f.analysis, o, state.mission);
  let actions = '';
  if (f.kind === 'test') {
    actions = `<button class="btn primary" data-action="go" data-to="launch">Back to the designer</button><button class="btn" data-action="test-flight">Fly the test again</button>`;
  } else if (o.kind === 'scrub') {
    actions = `<button class="btn primary" data-action="recycle">Recycle and try again</button><button class="btn" data-action="go" data-to="launch">Back to the designer</button>`;
  } else if (o.kind === 'nothrust') {
    actions = `<button class="btn primary" data-action="go" data-to="launch">Back to the designer</button>`;
  } else if (success) {
    actions = `<button class="btn primary" data-action="continue-flight">Take control of your spacecraft</button>`;
  } else {
    actions = `<button class="btn primary" data-action="results">See mission results</button>`;
  }
  const title = success ? (f.kind === 'test' ? 'Test passed' : 'Orbit reached') : { scrub: 'Scrubbed on the pad', nothrust: 'Toppled and exploded on the pad', stranded: 'Stuck in Earth orbit', suborbital: 'Suborbital', explode: 'Vehicle lost', unstable: 'Vehicle lost' }[o.kind];
  el.innerHTML = `<div class="report ${rep.pass ? 'pass' : 'fail'}">
    <p class="report-verdict">${rep.pass ? 'Pass' : 'Fail'}</p>
    <h3>${title}</h3>
    ${!success && o.reason ? `<p>${o.reason}</p>` : ''}
    <dl class="report-grid">
      <div><dt>Max altitude</dt><dd>${Math.round(rep.maxAlt)} km</dd></div>
      <div><dt>Top speed</dt><dd>${rep.topSpeed.toFixed(1)} km/s</dd></div>
      <div><dt>Thrust-to-weight</dt><dd>${rep.twr.toFixed(2)}</dd></div>
      <div><dt>Delta-v</dt><dd>${rep.dv.toFixed(1)} of ${rep.needed.toFixed(1)}</dd></div>
      <div><dt>Stability</dt><dd>${rep.stability[0].toUpperCase() + rep.stability.slice(1)}</dd></div>
    </dl>
    ${rep.tips.length ? `<ul class="report-tips">${rep.tips.slice(0, 3).map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
    <div class="actions stack">${actions}</div>
  </div>`;
}

// ---------- 5. Flight ----------

const PHASE_NAMES = { launch: 'Launch', deploy: 'Deploy', calibration: 'Calibration', cruise: 'Cruise', arrival: 'Arrival', orbitRaise: 'Orbit raise',
  science1: 'Science 1', science2: 'Science 2', science3: 'Science 3', science4: 'Science 4', science5: 'Science 5', science6: 'Science 6', wrapup: 'Wrap-up', endOfLife: 'End of life' };

function steerPad(hint) {
  return `<div class="steer"><div class="steer-pad" role="group" aria-label="Steer the satellite">
      <button class="sp-up" data-steer="up" aria-label="Burn harder">\u25b2</button>
      <button class="sp-left" data-steer="left" aria-label="Steer left">\u25c0</button>
      <button class="sp-down" data-steer="down" aria-label="Burn softer">\u25bc</button>
      <button class="sp-right" data-steer="right" aria-label="Steer right">\u25b6</button>
    </div><p class="steer-hint">${hint}</p></div>`;
}

// Arrow keys (and the on-screen pad) steer the satellite during the landing
const STEER_KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
function steering() { return state.screen === 'fly' && state.sim && (state.sim.landing === 'aim' || state.sim.landing === 'reentry'); }
document.addEventListener('keydown', (e) => {
  if (!STEER_KEYS[e.key] || !steering() || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  e.preventDefault(); Orbiter3D.steer(STEER_KEYS[e.key], true);
  const b = document.querySelector(`[data-steer=${STEER_KEYS[e.key]}]`); if (b) b.classList.add('on');
});
document.addEventListener('keyup', (e) => {
  if (!STEER_KEYS[e.key]) return;
  Orbiter3D.steer(STEER_KEYS[e.key], false);
  const b = document.querySelector(`[data-steer=${STEER_KEYS[e.key]}]`); if (b) b.classList.remove('on');
});
window.addEventListener('blur', () => { for (const k of Object.values(STEER_KEYS)) Orbiter3D.steer(k, false); });
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest && e.target.closest('[data-steer]');
  if (!b || !steering()) return;
  e.preventDefault(); Orbiter3D.steer(b.dataset.steer, true); b.classList.add('on');
  const stop = () => { Orbiter3D.steer(b.dataset.steer, false); b.classList.remove('on'); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
});

function renderFly() {
  const sim = state.sim;
  const done = simDone(sim);
  const groups = [];
  for (const entry of sim.log) {
    const last = groups[groups.length - 1];
    if (last && last.phase === entry.phase) last.items.push(entry);
    else groups.push({ phase: entry.phase, items: [entry] });
  }
  const logHtml = groups.map((g, gi) => `<li class="${gi === groups.length - 1 ? 'latest' : ''}"><h4>${g.phase}</h4>${g.items.map(e => `<p class="t-${e.tone}">${e.text}</p>`).join('')}</li>`).join('');

  const phases = sim.steps.map((s, i) => {
    let cls = i < sim.stepIndex ? 'done' : i === sim.stepIndex && !done ? 'current' : '';
    if (!sim.alive && i === Math.min(sim.stepIndex, sim.steps.length - 1)) cls = 'failed';
    return `<li class="${cls}">${PHASE_NAMES[s]}</li>`;
  }).join('');

  let control;
  if (sim.landing === 'aim') {
    control = `<div class="choice land" role="group" aria-labelledby="land-title">
      <p class="choice-kicker">Your turn: land it</p>
      <h3 id="land-title">Fly the deorbit burn</h3>
      <p>A satellite like SWOT can\u2019t land in one piece. Reentry at about 27,000 km/h melts most of it. What you can steer is where the surviving pieces come down. The red X shows where they would land if you fired right now. Fire when the X is inside the blue circle around Point Nemo, the spot in the South Pacific farthest from any land.</p>
      <p class="land-status" id="land-status" aria-live="polite">Working out the landing point\u2026</p>
      ${steerPad('Plan the burn with the arrow keys: \u25b2 burn harder (lands sooner), \u25bc burn softer (lands farther), \u25c0 \u25b6 tilt the burn sideways.')}
      <div class="actions"><button class="btn primary" id="fire-btn" data-action="fire-burn" data-focus="fire">Fire the deorbit burn</button>
        <button class="btn ghost" data-action="skip-window">Skip to the next window</button></div>
    </div>`;
  } else if (sim.landing === 'reentry') {
    control = `<div class="choice land"><p class="choice-kicker">Reentry</p><h3>Coming down</h3>
      <p class="land-status" id="land-status" aria-live="polite">Engine burn complete. Coasting down\u2026</p>
      ${steerPad('Keep steering with the arrow keys until about 130 km up. Each push uses thruster fuel.')}
      <p class="steer-fuel">Thruster fuel <span class="fuel-bar"><i id="steer-fuel" style="width:100%"></i></span></p></div>`;
  } else if (sim.pendingChoice) {
    const c = sim.pendingChoice;
    control = `<div class="choice" role="group" aria-labelledby="choice-title">
      <p class="choice-kicker">Decision needed</p>
      <h3 id="choice-title">${c.title}</h3><p>${c.text}</p>
      <div class="choice-opts">${c.options.map((o, i) => `
        <button class="opt" data-action="choose" data-index="${i}" data-focus="choice-${i}" ${o.disabled ? 'disabled' : ''}>
          <span class="opt-name">${o.label}</span><span class="opt-desc">${o.detail}</span>
        </button>`).join('')}</div>
    </div>`;
  } else if (done) {
    control = `<div class="actions"><button class="btn primary" data-action="results" data-focus="results">See mission results</button></div>`;
  } else {
    const next = sim.steps[sim.stepIndex];
    const label = { deploy: 'Open panels and antenna', calibration: 'Start calibration', cruise: 'Cruise to destination', arrival: 'Fire engine for orbit insertion',
      orbitRaise: 'Raise to the 891 km science orbit', wrapup: 'Wrap up the science', endOfLife: 'Decide how the mission ends' }[next] || 'Continue the mission';
    control = `<div class="actions"><button class="btn primary" data-action="advance" data-focus="advance">${label}</button>
      ${sim.alive && sim.stepIndex >= 1 ? '<button class="btn ghost home-btn" data-action="send-home">Send it home</button>' : ''}</div>`;
  }

  return `<div class="page-head"><h1>Fly the mission</h1><p>Your satellite in its 891 km polar orbit. Make the calls as events happen. Every choice is a trade-off.</p></div>
    <section class="orbit-stage" id="orbit3d" aria-label="Live 3D view of your satellite in orbit">
      <div class="orbit-hud">
        <span class="oh-chip" id="oh-orbit">Orbit 1</span>
        <span class="oh-chip" id="oh-alt">891 km up</span>
        <span class="oh-chip" id="oh-speed">7.40 km/s</span>
        <span class="oh-chip" id="oh-clock">T+ 0 min</span>
        <span class="oh-chip" id="oh-contact">No ground station in view</span>
        <span class="oh-chip" id="oh-data">0 GB sent home</span>
        <span class="oh-chip alert" id="oh-alert" hidden></span>
      </div>
      <div class="ov-ctrl">
        <div class="ov-group" role="group" aria-label="Time speed"><span>Time</span>${[[1, 'Real time'], [10, '\u00d710'], [100, '\u00d7100'], [1000, '\u00d71000']].map(([w, l]) => `<button class="ov-b" data-action="ov-warp" data-w="${w}">${l}</button>`).join('')}</div>
        <div class="ov-group" role="group" aria-label="Camera"><span>View</span><button class="ov-b" data-action="ov-view" data-v="close">Close-up</button><button class="ov-b" data-action="ov-view" data-v="earth">Whole orbit</button><button class="ov-b" data-action="ov-zoom" data-z="in" aria-label="Zoom in">+</button><button class="ov-b" data-action="ov-zoom" data-z="out" aria-label="Zoom out">\u2212</button></div>
      </div>
      <span class="orbit-help">Drag to look around. Scroll or use + and \u2212 to zoom out to the whole orbit. At real time one orbit takes 1 h 43 min, like the real satellite.</span>
    </section>
    <div class="fly-grid">
    <section class="flight">
      <ol class="phase-row">${phases}</ol>
      <ol class="log" aria-live="polite">${logHtml}</ol>
      <div id="control">${control}</div>
    </section>
    <aside class="status">
      <dl class="telemetry">
        <div><dt>Status</dt><dd class="${sim.alive ? 'good' : 'bad'}">${sim.alive ? 'Healthy' : 'Lost'}</dd></div>
        <div><dt>Science collected</dt><dd>${Math.round(sim.science + sim.bonus)}</dd></div>
        <div><dt>Instruments working</dt><dd>${sim.instruments.length} of ${sim.build.instruments.length}</dd></div>
        <div><dt>Fuel left</dt><dd>${kg(sim.fuel)}</dd></div>
        <div><dt>Push left</dt><dd>${dvLeft(sim).toFixed(2)} km/s</dd></div>
        <div><dt>Money in reserve</dt><dd>${money(sim.reserve)}</dd></div>
      </dl>
    </aside>
  </div>`;
}

// Front-page card: your satellite in 3D, slowly turning above Earth
const SHOWCASE_BUILD = { bus: 'medium', instruments: ['altimeter', 'gps', 'radiometer', 'camera'], solar: 'medium', rtg: 0, battery: 'small',
  antenna: 'mga', engine: 'biprop', fuel: 150, shield: 'none', backup: true, testing: 'standard' };
function mountHeroSat() {
  const el = document.getElementById('hero-sat');
  if (!el) return;
  const m = MISSIONS[0];
  const custom = state.builds[m.id] && state.builds[m.id].instruments.length ? state.builds[m.id] : null;
  // The picture shows instantly. Download the 3D files quietly while the player reads the page.
  if (!custom) { whenIdle(() => Orbiter3D.preload().catch(() => {})); return; }
  // A returning player sees their own satellite: swap the picture for the live 3D model once it is ready
  whenIdle(() => Orbiter3D.ensure().then(() => {
    if (state.screen !== 'mission' || !document.body.contains(el)) return;
    Orbiter3D.openSat(el, { mission: m, build: custom, phase: 'orbit', alive: true, interactive: false, dmg: {} });
    const img = el.querySelector('.hero-sat-img'); if (img) img.remove();
  }).catch(() => {}));
}
// Build screen: the live 3D satellite. Each part you choose is installed on it with a short animation.
let lastBuildSnap = null;
function partNames(b) {
  const nm = (list, id) => { const x = list.find(o => o.id === id); return x ? x.name : id; };
  const out = new Set(b.instruments.map(i => nm(INSTRUMENTS, i)));
  out.add(`${nm(BUSES, b.bus)}`); if (b.solar !== 'none') out.add(`${nm(SOLAR, b.solar)} solar panels`);
  out.add(nm(ANTENNAS, b.antenna)); if (b.engine !== 'none') out.add(nm(ENGINES, b.engine));
  if (b.rtg) out.add(`${b.rtg} nuclear power unit${b.rtg > 1 ? 's' : ''}`);
  return out;
}
function mountBuildSat() {
  const el = document.getElementById('build3d');
  if (!el) return;
  const b = JSON.parse(JSON.stringify(build()));
  const now = partNames(b), before = lastBuildSnap;
  lastBuildSnap = now;
  const added = before ? [...now].filter(n => !before.has(n)) : [];
  const removed = before ? [...before].filter(n => !now.has(n)) : [];
  const cap = document.getElementById('b3-cap');
  if (cap && (added.length || removed.length)) {
    cap.textContent = added.length ? `Installing: ${added.join(', ')}` : `Removed: ${removed.join(', ')}`;
    cap.classList.add('show'); clearTimeout(mountBuildSat.t); mountBuildSat.t = setTimeout(() => { const c = document.getElementById('b3-cap'); if (c) c.classList.remove('show'); }, 1800);
  }
  Orbiter3D.ensure().then(() => {
    if (state.screen !== 'build' || !document.body.contains(el)) return;
    Orbiter3D.openSat(el, { mission: state.mission, build: b, phase: 'orbit', alive: true, interactive: true, dmg: {}, assemble: true, zoom: 0.62 });
    const flat = el.querySelector('.b3-flat'); if (flat) flat.remove();
  }).catch(() => {});
}

// Rocket Designer: the live 3D rocket, built part by part
let lastDesignSnap = null;
function designChange(a, b) {
  if (!a) return '';
  if (b.stages !== a.stages) return b.stages > a.stages ? `Stacking stage ${b.stages}` : `Removing stage ${a.stages}`;
  if (b.engines !== a.engines) return b.engines > a.engines ? `Adding engines: ${b.engines} on stage 1` : `Removing engines: ${b.engines} on stage 1`;
  if (b.fins !== a.fins) return b.fins ? `Fitting ${FINS[b.fins].name.toLowerCase()} fins` : 'Fins removed';
  if (b.nose !== a.nose) return `Nose cone: ${NOSES[b.nose].name.toLowerCase()}`;
  if (b.fuelType !== a.fuelType) return `New tanks for ${FUELS[b.fuelType].name}`;
  if (b.strength !== a.strength) return `Structure: ${STRENGTH[b.strength].name.toLowerCase()}`;
  return '';
}
function mountRocket() {
  const el = document.getElementById('rk3d');
  if (!el) return;
  const d = JSON.parse(JSON.stringify(design())), a = rocketAnalysis();
  const msg = designChange(lastDesignSnap, d);
  lastDesignSnap = d;
  const cap = document.getElementById('rk-cap');
  if (cap && msg) {
    cap.textContent = msg; cap.classList.add('show');
    clearTimeout(mountRocket.t); mountRocket.t = setTimeout(() => { const c = document.getElementById('rk-cap'); if (c) c.classList.remove('show'); }, 1800);
  }
  Orbiter3D.ensure().then(() => {
    if (state.screen !== 'launch' || !document.body.contains(el)) return;
    Orbiter3D.openRocket(el, { design: d, cm: a.cm, cp: a.cp });
    const flat = el.querySelector('.rk-flat'); if (flat) flat.remove();
  }).catch(() => {});
}

function whenIdle(fn) { if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1500 }); else setTimeout(fn, 300); }
// Get the 3D scene ready in the background while the player designs, so the launch starts without waiting
let warmed = false;
function warm3D() { if (warmed) return; warmed = true; whenIdle(() => Orbiter3D.ensure().catch(() => { warmed = false; })); }

// Live 3D orbit view on the flight screen: your satellite (with your parts and any damage) circling Earth
let orbitSim = null;
function mountSatView() {
  const el = document.getElementById('orbit3d'), sim = state.sim;
  if (!el || !sim) return;
  const fresh = orbitSim !== sim; orbitSim = sim;
  Orbiter3D.ensure().then(() => {
    if (state.screen !== 'fly' || !document.body.contains(el)) return;
    const pend = sim.pendingChoice, le = sim.lastEvent;
    const event = pend && pend.id ? { id: pend.id, stage: 'pending' } : le && Date.now() - le.at < 8000 ? { id: le.id, stage: 'resolve', opt: le.opt, alive: le.alive, n: le.n } : null;
    const lr = sim.landingResult || {};
    Orbiter3D.openOrbit(el, {
      mission: state.mission, build: sim.build, alive: sim.alive, reset: fresh, event,
      disposal: sim.disposal || null, landing: sim.landing || null,
      landingDist: lr.distKm, landingInZone: lr.inZone, landingLat: lr.lat, landingLon: lr.lon,
      rate: sim.a.downlink * sim.antennaMult,
      dmg: { halfWing: sim.solarMult < 1, dishStuck: sim.antennaMult < 1, lost: sim.lostInstruments },
      onTick: (i) => {
        const set = (id, v) => { const e = document.getElementById(id); if (e && e.textContent !== v) e.textContent = v; };
        set('oh-orbit', `Orbit ${i.orbit}`);
        set('oh-alt', i.landDone ? 'Splashed down' : `${i.alt.toLocaleString('en-US')} km up`);
        set('oh-speed', i.landDone ? '0 km/s' : `${i.speed.toFixed(2)} km/s`);
        const hh = Math.floor(i.clock / 3600), mm = Math.floor(i.clock / 60) % 60;
        set('oh-clock', `T+ ${hh ? hh + ' h ' : ''}${mm} min \u00b7 ${i.warp > 1 ? '\u00d7' + i.warp : 'real time'}`);
        const al = document.getElementById('oh-alert');
        if (al) { al.hidden = !i.alert; set('oh-alert', i.alert || ''); }
        document.querySelectorAll('[data-action=ov-warp]').forEach(b => b.classList.toggle('on', Number(b.dataset.w) === i.warp));
        if (i.land) {
          const st = document.getElementById('land-status'), fire = document.getElementById('fire-btn');
          let msg = '';
          if (i.land.stage === 'aim') {
            const win = i.land.nextWin;
            const wt = win === null || win === undefined ? '' : win < 60 ? ' Window open now.' : ` Next window in ${Math.floor(win / 3600) ? Math.floor(win / 3600) + ' h ' : ''}${Math.round(win / 60) % 60} min of mission time.`;
            msg = i.land.inZone ? `Inside the safe zone: ${Math.round(i.land.distKm).toLocaleString('en-US')} km from Point Nemo. Fire now!`
              : `Predicted landing: ${Math.round(i.land.distKm).toLocaleString('en-US')} km from Point Nemo, outside the safe zone.${wt}`;
          } else if (i.land.stage === 'reentry') {
            const zone = i.land.inZone ? `inside the safe zone (${Math.round(i.land.distKm).toLocaleString('en-US')} km from Point Nemo)` : `${Math.round(i.land.distKm).toLocaleString('en-US')} km from Point Nemo, outside the safe zone`;
            msg = i.alt > 135 ? `Coasting down: ${i.alt.toLocaleString('en-US')} km up. Landing point: ${zone}.` : i.alt > 78 ? `Reentry: ${i.alt} km up. The plasma around the satellite is about 1,600 \u00b0C.` : `Breaking apart: ${i.alt} km up. The pieces fall toward the ocean.`;
          }
          if (st && msg && st.textContent !== msg) st.textContent = msg;
          if (fire) fire.classList.toggle('hot', !!i.land.inZone);
          const fb = document.getElementById('steer-fuel'); if (fb) fb.style.width = `${Math.round(i.land.fuel * 100)}%`;
          if (i.land.stage === 'reentry' && !i.land.canSteer) { const pad = document.querySelector('.steer'); if (pad) pad.classList.add('off'); }
        }
        if (i.landDone && sim.landing === 'reentry') {
          sim.landing = 'done';
          sim.landingResult = { inZone: i.landDone.inZone, distKm: Math.round(i.landDone.distKm), lat: i.landDone.lat, lon: i.landDone.lon };
          const km = Math.round(i.landDone.distKm).toLocaleString('en-US');
          log(sim, 'Splashdown', i.landDone.inZone ? `The surviving pieces splashed down ${km} km from Point Nemo, inside the safe zone. Nothing was left in orbit.` : `The surviving pieces splashed down ${km} km from Point Nemo, outside the safe zone. Nothing was left in orbit, but the debris fell far from the target.`, i.landDone.inZone ? 'good' : 'warn');
          render();
        }
        set('oh-contact', i.contact ? `Downlink: ${i.contact}` : 'No ground station in view');
        set('oh-data', `${i.data.toFixed(1)} GB sent home`);
        const c = document.getElementById('oh-contact'); if (c) c.classList.toggle('on', !!i.contact);
      }
    });
  }).catch(() => {
    el.innerHTML = `<div class="craft-frame">${drawCraft(sim.build, { lost: sim.lostInstruments, halfWing: sim.solarMult < 1, dishStuck: sim.antennaMult < 1 })}</div>`;
  });
}

// NASA data and sources: every real number in the game and where it came from
function openSources() {
  const old = document.getElementById('sources-modal'); if (old) old.remove();
  const items = SOURCES.map(s => `<li><p class="src-name">${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>` : s.name}</p><p class="src-used">${s.used}</p></li>`).join('');
  document.body.insertAdjacentHTML('beforeend', `<div class="sources-modal" id="sources-modal" role="dialog" aria-modal="true" aria-labelledby="src-title">
    <div class="sources-box">
      <div class="sources-head"><h2 id="src-title">NASA data &amp; sources</h2><button class="btn" data-action="close-sources">Close</button></div>
      <p class="why">Event times, science goals, rocket figures and fact cards come from these NASA sources. Anything estimated is marked \u201cest\u201d or \u2248 in the game.</p>
      <ol class="sources-list">${items}</ol>
    </div>
  </div>`);
  const btn = document.querySelector('#sources-modal [data-action=close-sources]'); if (btn) btn.focus();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const d = document.getElementById('sources-modal'); if (d) d.remove(); } });

function revealControl() {
  const c = $('#control');
  if (c) c.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// ---------- 6. Results ----------

function starsFor(total, fate) {
  if (fate === 'launch') return 0;
  if (total >= 85) return 5;
  if (total >= 70) return 4;
  if (total >= 50) return 3;
  if (total >= 30) return 2;
  return total > 0 ? 1 : 0;
}

// Leaderboard of your best runs (kept in this browser)
function loadBoard() { try { return JSON.parse(localStorage.getItem('md-board') || '[]'); } catch (e) { return []; } }
function saveBoard(b) { try { localStorage.setItem('md-board', JSON.stringify(b)); } catch (e) { /* storage unavailable */ } }
function playerName() { try { return localStorage.getItem('md-name') || 'Player'; } catch (e) { return 'Player'; } }
function escapeHtml(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function renderReview() {
  const rep = state.report, m = state.mission, sim = state.sim;
  const board = loadBoard();
  const bestLine = rep.newBest
    ? `<p class="best new">New personal best${rep.prevBest ? `, up from ${rep.prevBest}` : ''}.</p>`
    : `<p class="best">Your best: ${rep.prevBest}</p>`;
  return `<section class="result-hero">
      <div class="patch">${missionPatch(m, sim.rocket, rep.stars)}</div>
      <div class="result-text">
        <p class="grade g-${rep.stars}">${rep.grade}</p>
        <div class="score"><strong>${rep.total}</strong><span>mission score<br>out of 100</span></div>
        ${bestLine}
        <dl class="result-stats breakdown">${rep.breakdown.map(b => `<div><dt>${b.name}</dt><dd>${b.pts}<small> / ${b.max}</small></dd></div>`).join('')}</dl>
      </div>
    </section>
    <div class="review-grid">
      <section>
        <h2>What your satellite discovered</h2>
        <p class="why">Game estimates, modeled on the real goals of NASA\u2019s SWOT mission.</p>
        <ul class="discoveries">${rep.discoveries.map(d => `<li class="${d.none ? 'none' : ''}"><b>${d.name}</b><span>${d.text}</span></li>`).join('')}</ul>
        <h2>What your choices did</h2>
        <ul class="lessons">${rep.lessons.map(l => {
          const i = l.indexOf(':');
          return i > 0 && i < 16 ? `<li><b>${l.slice(0, i)}</b>${l.slice(i + 1)}</li>` : `<li>${l}</li>`;
        }).join('')}</ul>
      </section>
      <section>
        <h2>Leaderboard</h2>
        <label class="name-field"><span>Your name</span><input type="text" maxlength="20" value="${escapeHtml(playerName())}" data-action="player-name" aria-label="Your name for the leaderboard"></label>
        <ol class="board">${board.map((b, i) => `<li class="${i === rep.boardIndex ? 'me' : ''}"><span class="b-rank">${i + 1}</span><span class="b-name">${escapeHtml(b.name)}</span><span class="b-stars">${'\u2605'.repeat(b.stars)}${'\u2606'.repeat(5 - b.stars)}</span><strong>${b.score}</strong></li>`).join('') || '<li class="empty">No runs yet.</li>'}</ol>
        <p class="why">Your 8 best runs, saved in this browser.</p>
        <div class="actions stack">
          <button class="btn primary" data-action="go" data-to="build">Fly again with a better satellite</button>
          <button class="btn" data-action="go" data-to="launch">Redesign the rocket</button>
          <button class="btn ghost" data-action="home">Back to the start</button>
          <button class="btn ghost" data-action="sources">NASA data &amp; sources</button>
        </div>
        <h2 class="mt">Science goals</h2>
        <ul class="goals big">${rep.originalObjectives.map(o =>
          `<li><span class="goal-bar"><span style="width:${o.coverage * 100}%"></span></span>${o.name}<em>${Math.round(o.coverage * o.weight)} of ${o.weight}</em></li>`).join('')}</ul>
        <details class="flight-log">
          <summary>Full flight log</summary>
          <ol class="log compact">${sim.log.map(e => `<li class="t-${e.tone}"><b>${e.phase}.</b> ${e.text}</li>`).join('')}</ol>
        </details>
      </section>
    </div>`;
}

// ---------- Flights ----------

function startFlight(kind, presetOutcome, startP) {
  const m = state.mission;
  const analysis = rocketAnalysis();
  const outcome = presetOutcome || rollOutcome(analysis, m);
  const plan = Orbiter3D.makeFlight(outcome, m);
  plan.build = JSON.parse(JSON.stringify(build()));   // the 3D satellite shows the parts you picked
  plan.design = JSON.parse(JSON.stringify(design())); // and the 3D rocket is the one you designed
  state.flight = { kind, outcome, analysis, plan, startP: startP || 0, autoplay: !presetOutcome };
  if (kind === 'mission' && !['scrub', 'nothrust'].includes(outcome.kind)) {
    const rocket = { name: 'your rocket', cost: analysis.cost, outcome, analysis };
    state.sim = newSim(JSON.parse(JSON.stringify(build())), m, rocket);
    stepSim(state.sim);
  } else if (kind === 'mission') {
    state.sim = null;
  }
  state.screen = 'liftoff';
  if (presetOutcome) return; // restoring on page load: render happens after
  go('liftoff');
}

// ---------- Events ----------

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled) return;
  const act = t.dataset.action;

  if (act === 'home') {
    go('mission');
  } else if (act === 'pick-mission') {
    state.mission = byId(MISSIONS, t.dataset.id);
    if (!state.builds[state.mission.id]) state.builds[state.mission.id] = defaultBuild();
    if (!state.designs[state.mission.id]) state.designs[state.mission.id] = designDefaults();
    go('build');
  } else if (act === 'go' || act === 'step') {
    go(t.dataset.to);
  } else if (act === 'set') {
    build()[t.dataset.key] = t.dataset.value;
    render();
  } else if (act === 'toggle-inst') {
    const list = build().instruments, id = t.dataset.value;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    render();
  } else if (act === 'rtg') {
    build().rtg = Math.max(0, Math.min(RTG.max, build().rtg + Number(t.dataset.delta)));
    render();
  } else if (act === 'backup') {
    build().backup = !build().backup;
    render();
  } else if (act === 'preset') {
    state.designs[state.mission.id] = { ...byId(ROCKET_PRESETS, t.dataset.id).d };
    render();
  } else if (act === 'dset') {
    const v = t.dataset.value;
    design()[t.dataset.key] = ['stages', 'fins'].includes(t.dataset.key) ? Number(v) : v;
    render();
  } else if (act === 'test-flight') {
    startFlight('test');
  } else if (act === 'launch') {
    startFlight('mission');
  } else if (act === 'recycle') {
    startFlight('mission');
  } else if (act === 'continue-flight') {
    go('fly');
  } else if (act === 'ov-warp') {
    Orbiter3D.orbitWarp(Number(t.dataset.w));
  } else if (act === 'ov-view') {
    Orbiter3D.orbitView(t.dataset.v);
  } else if (act === 'ov-zoom') {
    Orbiter3D.orbitZoom(t.dataset.z);
  } else if (act === 'send-home') {
    if (requestHome(state.sim)) { render(); revealControl(); }
  } else if (act === 'skip-window') {
    Orbiter3D.orbitSkip();
  } else if (act === 'fire-burn') {
    const sim = state.sim;
    if (!sim || sim.landing !== 'aim') return;
    let r = null;
    try { r = Orbiter3D.fireDeorbit(); } catch (e) { r = null; }
    if (!r) { r = { inZone: true, distKm: 420, lat: -50, lon: -126 }; sim.landing = 'done'; } else sim.landing = 'reentry';
    sim.landingResult = { inZone: r.inZone, distKm: Math.round(r.distKm), lat: r.lat, lon: r.lon };
    const km = sim.landingResult.distKm.toLocaleString('en-US');
    log(sim, 'Deorbit burn', r.inZone ? `Burn complete. The pieces should land ${km} km from Point Nemo, inside the safe zone.` : `Burn complete, but the pieces will land ${km} km from Point Nemo, outside the safe zone.`, r.inZone ? 'good' : 'warn');
    if (sim.landing === 'done') log(sim, 'Splashdown', 'The surviving pieces splashed down in the South Pacific.', 'good');
    render();
  } else if (act === 'advance') {
    stepSim(state.sim);
    render();
    revealControl();
  } else if (act === 'choose') {
    chooseOption(state.sim, Number(t.dataset.index));
    render();
    revealControl();
  } else if (act === 'results') {
    const rep = finalReport(state.sim);
    rep.stars = starsFor(rep.total, state.sim.fate);
    rep.prevBest = loadBest(state.mission.id);
    rep.newBest = rep.total > rep.prevBest;
    if (rep.newBest) saveBest(state.mission.id, rep.total);
    // add this run to the leaderboard
    const entry = { name: playerName(), score: rep.total, stars: rep.stars, at: Date.now() };
    const board = loadBoard().concat([entry]).sort((a, b) => b.score - a.score || a.at - b.at).slice(0, 8);
    saveBoard(board);
    rep.boardIndex = board.indexOf(board.find(b => b.at === entry.at));
    rep.entryAt = entry.at;
    state.report = rep;
    go('review');
  } else if (act === 'orb-play') {
    Orbiter3D.toggle(); t.blur();
  } else if (act === 'orb-seek') {
    Orbiter3D.seekT(Number(t.dataset.t));
  } else if (act === 'orb-cam') {
    Orbiter3D.setMode(t.dataset.mode);
    document.querySelectorAll('#orb-cams button').forEach(b => b.classList.toggle('on', b === t));
    $('#orb-split').hidden = t.dataset.mode !== 'split';
    $('#orb').classList.toggle('is-split', t.dataset.mode === 'split');
    if (t.dataset.mode === 'free') flashCenter('Drag to look around, scroll to zoom. On the finale you can fly around the magnetosphere.');
  } else if (act === 'orb-stowed') {
    Orbiter3D.stowed();
  } else if (act === 'orb-deployed') {
    if (!Orbiter3D.deployed()) flashCenter('The satellite only deploys after a successful flight');
  } else if (act === 'sources') {
    openSources();
  } else if (act === 'close-sources') {
    const d = document.getElementById('sources-modal'); if (d) d.remove();
  } else if (act === 'hero-filter') {
    const diff = t.dataset.diff;
    document.querySelectorAll('.chip').forEach(c => { const on = c === t; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); });
    document.querySelectorAll('.hcard').forEach(c => { c.hidden = diff !== 'All' && c.dataset.diff !== diff; });
  } else if (act === 'orb-mag') {
    Orbiter3D.toggleMagnetosphere();
  } else if (act === 'orb-glb') {
    Orbiter3D.downloadGLB();
  } else if (act === 'orb-obj') {
    Orbiter3D.downloadOBJ();
  }
});

function flashCenter(text) {
  const c = $('#orb-center');
  if (!c) return;
  c.className = 'orb-center warn'; c.innerHTML = `<strong>${text}</strong>`;
  hudLast.center = 'flash';
  setTimeout(() => { hudLast.center = null; }, 1800);
}

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.action === 'player-name') {
    const name = t.value.trim() || 'Player';
    try { localStorage.setItem('md-name', name); } catch (err) { /* storage unavailable */ }
    const board = loadBoard(), mine = state.report && board.find(b => b.at === state.report.entryAt);
    if (mine) { mine.name = name; saveBoard(board); const li = document.querySelector('.board li.me .b-name'); if (li) li.textContent = name; }
    return;
  }
  if (t.dataset.action === 'fuel') {
    build().fuel = Number(t.value);
    $('#fuel-out').textContent = kg(build().fuel);
    $('#status').innerHTML = statusPanel(analyze(build(), state.mission));
    mountBuildSat();
  } else if (t.dataset.action === 'dslider') {
    const key = t.dataset.key;
    design()[key] = Number(t.value);
    const fmt = { dryMass: kg, fuelMass: kg, engines: v => `${v}`, thrust: v => `${num(v)} kN`, burnTime: v => `${v} s` }[key];
    $('#out-' + key).textContent = fmt(design()[key]);
    $('#d-live').innerHTML = designerLive(rocketAnalysis());
    mountRocket();
    saveState();
  } else if (t.id === 'orb-scrub') {
    Orbiter3D.seekP(Number(t.value));
  }
});

document.addEventListener('keydown', (e) => {
  if (state.screen !== 'liftoff' || e.code !== 'Space') return;
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  e.preventDefault();
  Orbiter3D.toggle();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
});

window.addEventListener('beforeunload', saveState);

if (restoreState()) {
  render();
  if (state.screen === 'liftoff') openOrbiter();
} else {
  render();
}
