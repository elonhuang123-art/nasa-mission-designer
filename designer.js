// Rocket Designer: simplified but real rocket physics.
// Rocket equation for delta-v, thrust-to-weight, center of pressure vs center of mass, and Max-Q stress.

const FUELS = {
  rp1: { name: 'Kerosene (RP-1 / LOX)', ispSl: 282, ispVac: 311, pFail: 0.006, cost: 0.0042, desc: 'Proven and dense. Moderate efficiency.' },
  methane: { name: 'Methane (CH4 / LOX)', ispSl: 315, ispVac: 350, pFail: 0.008, cost: 0.005, desc: 'More efficient, but newer engines fail a bit more.' },
  solid: { name: 'Solid propellant', ispSl: 250, ispVac: 268, pFail: 0.003, cost: 0.0028, desc: 'Simple and reliable. Burns until empty: burn time has no effect.' }
};

const NOSES = {
  blunt: { name: 'Blunt', drag: 1.25, cp: 0.06, desc: 'Lots of drag.' },
  conical: { name: 'Conical', drag: 1.0, cp: 0, desc: 'Simple cone.' },
  ogive: { name: 'Ogive', drag: 0.85, cp: -0.02, desc: 'Smooth curve. Least drag.' }
};

const FINS = [
  { id: 0, name: 'None', drag: 0, cp: 0 },
  { id: 1, name: 'Small', drag: 0.04, cp: -0.08 },
  { id: 2, name: 'Medium', drag: 0.08, cp: -0.16 },
  { id: 3, name: 'Large', drag: 0.14, cp: -0.26 }
];

const STRENGTH = {
  light: { name: 'Light', mass: 0.85, tol: 0.8, cost: -3, desc: '15% lighter, but fragile.' },
  standard: { name: 'Standard', mass: 1, tol: 1, cost: 0, desc: 'Normal margins.' },
  heavy: { name: 'Heavy', mass: 1.2, tol: 1.25, cost: 8, desc: '20% heavier, very strong.' }
};

const DV_EXTRA = { earth: 0, mars: 3.6, jupiter: 6.3 };   // km/s beyond low Earth orbit
const ORBIT_SPEED = 7.8;
const STAGE_SPLITS = { 1: [1], 2: [0.78, 0.22], 3: [0.70, 0.23, 0.07] };

const ROCKET_PRESETS = [
  { id: 'kestrel', name: 'Kestrel', note: 'Light lift', d: { stages: 2, dryMass: 6000, fuelMass: 60000, fuelType: 'rp1', engines: 1, thrust: 900, burnTime: 420, fins: 2, nose: 'ogive', strength: 'standard' } },
  { id: 'condor', name: 'Condor', note: 'Medium lift', d: { stages: 2, dryMass: 26000, fuelMass: 520000, fuelType: 'rp1', engines: 9, thrust: 900, burnTime: 420, fins: 2, nose: 'ogive', strength: 'standard' } },
  { id: 'albatross', name: 'Albatross', note: 'Heavy lift', d: { stages: 2, dryMass: 40000, fuelMass: 800000, fuelType: 'methane', engines: 9, thrust: 1500, burnTime: 480, fins: 2, nose: 'ogive', strength: 'standard' } },
  { id: 'leviathan', name: 'Leviathan', note: 'Super-heavy, SLS class', d: { stages: 3, dryMass: 70000, fuelMass: 1500000, fuelType: 'methane', engines: 15, thrust: 1900, burnTime: 640, fins: 2, nose: 'ogive', strength: 'heavy' } }
];

const designDefaults = () => ({ ...ROCKET_PRESETS[1].d });

function analyzeRocket(d, payloadKg, mission) {
  const fuel = FUELS[d.fuelType], str = STRENGTH[d.strength], fins = FINS[d.fins], nose = NOSES[d.nose];
  const split = STAGE_SPLITS[d.stages];
  const dry = d.dryMass * str.mass;
  const stages = split.map((f, i) => ({
    fuel: d.fuelMass * f, dry: dry * f,
    thrust: i === 0 ? d.engines * d.thrust : d.thrust,
    isp: i === 0 ? (fuel.ispSl + fuel.ispVac) / 2 : fuel.ispVac * 1.05,
    engines: i === 0 ? d.engines : 1
  }));

  let dv = 0, unburned = 0;
  const per = stages.map((s, i) => {
    const above = stages.slice(i + 1).reduce((a, x) => a + x.fuel + x.dry, 0) + payloadKg;
    const mdot = (s.thrust * 1000) / (s.isp * G0);
    const burnLimit = d.fuelType === 'solid' ? Infinity : d.burnTime;
    const burn = Math.min(s.fuel / mdot, burnLimit);
    const burned = mdot * burn;
    const m0 = s.dry + s.fuel + above, mf = m0 - burned;
    const sdv = (s.isp * G0 * Math.log(m0 / mf)) / 1000;
    dv += sdv; unburned += s.fuel - burned;
    return { ...s, mdot, burn, burned, m0, mf, dv: sdv, fullBurn: s.fuel / mdot };
  });

  const liftoffMass = per[0].m0;
  const twr = (per[0].thrust * 1000) / (liftoffMass * G0);
  const drag = nose.drag + fins.drag;
  const losses = 1.5 + (drag - 0.85) * 1.0 + (twr < 1.3 ? (1.3 - Math.max(twr, 0.5)) * 3 : 0);
  const needOrbit = ORBIT_SPEED + losses;
  const needed = needOrbit + DV_EXTRA[mission.id];

  // Center of mass and center of pressure, as fractions of rocket length from the base
  const heights = per.map(s => s.fuel / 1000 * (d.fuelType === 'solid' ? 0.7 : 1) + 6);
  const bodyH = heights.reduce((a, b) => a + b, 0);
  const fairH = Math.max(8, bodyH * 0.15);
  const L = bodyH + fairH;
  let h = 0, mSum = 0, mh = 0;
  per.forEach((s, i) => { const c = h + heights[i] / 2; mh += (s.dry + s.fuel) * c; mSum += s.dry + s.fuel; h += heights[i]; });
  mh += payloadKg * (bodyH + fairH * 0.4); mSum += payloadKg;
  const cm = mh / mSum / L;
  const cp = 0.5 + nose.cp + fins.cp;
  const margin = (cm - cp) * 15 + (d.engines >= 3 ? 0.3 : 0);
  const stability = margin < 0 ? 'unstable' : margin < 1 ? 'marginal' : 'stable';

  const stress = Math.pow(twr / 2, 1.5) * drag / str.tol * (d.fuelType === 'solid' ? 1.15 : 1);
  const push = 1 + Math.max(0, (d.thrust - 2000) / 1000) * 1.5;
  const pEng = fuel.pFail * push;
  const pIgn = 1 - Math.pow(1 - pEng, d.engines);
  // Priced like real launch vehicles: a medium rocket runs about $130M, a super-heavy one over $400M.
  const cost = Math.max(25, 20 + d.stages * 12 + (d.engines * d.thrust + (d.stages - 1) * d.thrust) * fuel.cost * 1.7 + (d.dryMass / 1000) * 1.0 + str.cost * 2);

  return { d, payloadKg, per, dv, liftoffMass, twr, drag, losses, needOrbit, needed, cm, cp, margin, stability, stress, pEng, pIgn, cost, unburned, L, heights, fairH };
}

function rocketTips(a) {
  const t = [];
  if (a.twr < 1) t.push('Not enough thrust to leave the pad. Add engines or thrust, or carry less fuel and structure.');
  else if (a.twr < 1.2) t.push('Thrust-to-weight is low, so gravity steals a lot of speed. Aim for 1.2 to 1.6.');
  if (a.stress > 1) t.push('Too much stress at Max-Q. Lower the thrust, choose a smoother nose or a stronger structure.');
  else if (a.stress > 0.85) t.push('Max-Q stress is close to the limit. A stronger structure or less thrust adds margin.');
  if (a.stability === 'unstable') t.push('The center of pressure is ahead of the center of mass, so the rocket will flip. Add bigger fins.');
  else if (a.stability === 'marginal') t.push('Barely stable: expect wobbling. Bigger fins or an ogive nose help.');
  if (a.dv < a.needed) {
    const short = a.needed - a.dv;
    t.push(`${short.toFixed(1)} km/s short of what this mission needs. Add fuel, a stage, burn longer, or cut dry weight.`);
  }
  if (a.unburned > 500) t.push(`${Math.round(a.unburned).toLocaleString()} kg of fuel never burns. Increase the burn time.`);
  if (a.pIgn > 0.08) t.push(`${Math.round(a.pIgn * 100)}% chance an engine fails to start. Fewer or less-pushed engines are more reliable.`);
  if (a.dv > a.needed + 2.5 && a.twr >= 1.2) t.push('Lots of spare delta-v. A smaller rocket would save money for science.');
  return t;
}

function rocketVerdict(a) {
  if (a.twr < 1) return { level: 'nogo', text: 'No-go: it cannot lift off' };
  if (a.stability === 'unstable') return { level: 'nogo', text: 'No-go: unstable, it will spin out' };
  if (a.stress > 1) return { level: 'nogo', text: 'No-go: it will break apart at Max-Q' };
  if (a.dv < a.needOrbit) return { level: 'nogo', text: 'No-go: it cannot reach orbit' };
  if (a.dv < a.needed) return { level: 'nogo', text: 'No-go: it reaches orbit but not your destination' };
  if (a.stability === 'marginal' || a.stress > 0.85 || a.twr < 1.2) return { level: 'warn', text: 'Go, with risks' };
  return { level: 'go', text: 'Go for launch' };
}

// Decide what happens on one flight. Ignition and the risky-stress case are random.
function rollOutcome(a, mission, rng = Math.random) {
  if (a.twr < 1) return { kind: 'nothrust', lost: false, reason: `Not enough thrust. Thrust-to-weight is ${a.twr.toFixed(2)}, below 1.` };
  if (rng() < a.pIgn) return { kind: 'scrub', lost: false, reason: 'An engine failed to ignite. The computer stopped the launch before liftoff.' };
  if (a.stability === 'unstable') return { kind: 'unstable', lost: true, t: 44, reason: 'Lost control. The rocket was unstable and spun out.' };
  if (a.stress > 1 || (a.stress > 0.85 && rng() < 0.4)) return { kind: 'explode', lost: true, t: 72, reason: 'Structural failure at Max-Q.' };

  let dvEff = a.dv, engineOut = false;
  if (rng() < a.pIgn * 0.5) {
    engineOut = true;
    if (a.d.engines >= 5) dvEff -= 0.25;
    else dvEff *= 0.55;
  }
  if (dvEff < a.needOrbit) {
    const vb = Math.max(0.6, dvEff - a.losses * 0.7);
    const apex = Math.max(3, Math.pow(vb * 0.4, 2) / (2 * 0.0098));
    const Tb = Math.max(40, 504 * Math.pow(Math.min(1, dvEff / a.needOrbit), 1.6));
    return { kind: 'suborbital', lost: true, engineOut, Tb, apex, vb,
      reason: engineOut && a.d.engines < 5 ? 'An engine shut down early and there were too few left to make up for it.' : 'Out of fuel before reaching orbital speed.' };
  }
  if (dvEff < a.needed) return { kind: 'stranded', lost: true, engineOut, reason: 'The upper stage ran dry. The spacecraft is stuck in Earth orbit.' };
  return { kind: a.stability === 'marginal' ? 'wobble' : 'orbit', lost: false, engineOut };
}

function flightReport(a, outcome, mission) {
  let maxAlt = 0, topSpeed = 0;
  switch (outcome.kind) {
    case 'orbit': case 'wobble': maxAlt = 857; topSpeed = mission.id === 'earth' ? 7.53 : ORBIT_SPEED + DV_EXTRA[mission.id] * 0.95; break;
    case 'stranded': maxAlt = 857; topSpeed = 7.53; break;
    case 'explode': maxAlt = 21; topSpeed = 0.84; break;
    case 'unstable': maxAlt = 7.5; topSpeed = 0.45; break;
    case 'suborbital': maxAlt = outcome.apex; topSpeed = outcome.vb; break;
    default: maxAlt = 0; topSpeed = 0;
  }
  const pass = outcome.kind === 'orbit' || outcome.kind === 'wobble';
  const tips = rocketTips(a);
  if (outcome.kind === 'scrub' && !tips.length) tips.push('Ignition failures are partly luck. Try again, or use fewer engines to lower the odds.');
  if (outcome.kind === 'explode' && a.stress <= 1) tips.push('This design was close to its stress limit and got unlucky. More margin removes the risk.');
  return { maxAlt, topSpeed, twr: a.twr, dv: a.dv, needed: a.needed, stability: a.stability, pass, tips };
}
