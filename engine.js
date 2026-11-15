// Engineering math and mission simulation. No UI code here.

const byId = (list, id) => list.find(x => x.id === id);

function rand() { return Math.random(); }

// ---------- Spacecraft analysis ----------

function analyze(build, mission) {
  const bus = byId(BUSES, build.bus);
  const instruments = build.instruments.map(id => byId(INSTRUMENTS, id));
  const solar = byId(SOLAR, build.solar);
  const battery = byId(BATTERIES, build.battery);
  const antenna = byId(ANTENNAS, build.antenna);
  const engine = byId(ENGINES, build.engine);
  const shield = byId(SHIELDS, build.shield);
  const testing = byId(TESTING, build.testing);

  const fuel = engine.id === 'none' ? 0 : build.fuel;
  const tank = fuel * 0.1;

  const sum = (key) => instruments.reduce((s, i) => s + i[key], 0);

  // Mass
  const dryMass = bus.mass + sum('mass') + solar.mass + build.rtg * RTG.mass + battery.mass +
    antenna.mass + engine.mass + shield.mass + (build.backup ? BACKUP.mass : 0) + tank;
  const wetMass = dryMass + fuel;

  // Power
  const sunlight = 1 / (mission.solarDist * mission.solarDist);
  const solarPower = solar.power * sunlight * (1 - mission.eclipse);
  const rtgPower = build.rtg * RTG.power;
  const powerAvailable = solarPower + rtgPower;
  const coreLoad = bus.power + antenna.power + (build.backup ? BACKUP.power : 0) + (engine.power || 0);
  const instrumentLoad = sum('power');
  const powerNeeded = coreLoad + instrumentLoad;
  const batteryNeeded = powerNeeded * mission.eclipseHours;

  // Data
  const downlink = antenna.rate / (mission.commDist * mission.commDist);
  const dataMade = sum('data');

  // Propulsion (Tsiolkovsky rocket equation)
  const dv = engine.isp > 0 && fuel > 0 ? engine.isp * G0 * Math.log(wetMass / dryMass) / 1000 : 0;

  // Cost
  const buildCost = bus.cost + sum('cost') + solar.cost + build.rtg * RTG.cost + battery.cost +
    antenna.cost + engine.cost + shield.cost + (build.backup ? BACKUP.cost : 0) + testing.cost;
  const opsCost = mission.opsPerMonth * (mission.cruiseMonths + mission.scienceMonths);

  return {
    bus, instruments, solar, battery, antenna, engine, shield, testing,
    fuel, dryMass, wetMass,
    sunlight, solarPower, rtgPower, powerAvailable, coreLoad, instrumentLoad, powerNeeded, batteryNeeded,
    downlink, dataMade, dv, buildCost, opsCost,
    slotsUsed: instruments.length, slots: bus.slots
  };
}

// Fraction of instrument time the power supply allows (0..1)
function powerFactor(available, coreLoad, instrumentLoad) {
  if (available < coreLoad) return 0;
  if (instrumentLoad === 0) return 1;
  return Math.min(1, (available - coreLoad) / instrumentLoad);
}

function dataFactor(downlink, dataMade) {
  if (dataMade === 0) return 1;
  return Math.min(1, downlink / dataMade);
}

// Science potential (0..100) from which instruments are working.
// Several instruments on one objective combine: 1 - (1-a)(1-b).
function objectiveScores(mission, instrumentIds) {
  return mission.objectives.map(obj => {
    let miss = 1;
    for (const id of instrumentIds) {
      const eff = obj.instruments[id];
      if (eff) miss *= (1 - eff);
    }
    return { name: obj.name, weight: obj.weight, coverage: 1 - miss };
  });
}

function sciencePotential(mission, instrumentIds) {
  return objectiveScores(mission, instrumentIds).reduce((s, o) => s + o.weight * o.coverage, 0);
}

function warnings(a, mission) {
  const w = [];
  if (a.instruments.length === 0) w.push({ level: 'block', text: 'Add at least one instrument. Without one there is no science.' });
  if (a.slotsUsed > a.slots) w.push({ level: 'block', text: `The ${a.bus.name.toLowerCase()} only fits ${a.slots} instruments.` });
  if (a.buildCost > mission.budget) w.push({ level: 'block', text: 'The spacecraft alone costs more than your whole budget.' });

  if (a.powerAvailable < a.coreLoad) w.push({ level: 'bad', text: 'Not enough power to even run the computer and radio. The spacecraft will die.' });
  else if (a.powerAvailable < a.powerNeeded) w.push({ level: 'bad', text: `Power shortfall: instruments can only run ${Math.round(powerFactor(a.powerAvailable, a.coreLoad, a.instrumentLoad) * 100)}% of the time.` });
  else if (a.powerAvailable < a.powerNeeded * 1.2) w.push({ level: 'warn', text: 'Power margin under 20%. Panels lose strength every year.' });

  if (a.battery.wh === 0 && a.rtgPower === 0) w.push({ level: 'bad', text: 'No battery. The spacecraft cannot survive launch before its panels open.' });
  else if (a.battery.wh < a.batteryNeeded) w.push({ level: 'warn', text: `Battery too small to cover ${Math.round(mission.eclipseHours * 60)} minutes in shadow.` });

  if (a.dataMade > a.downlink) w.push({ level: 'warn', text: `Data bottleneck: only ${Math.round(dataFactor(a.downlink, a.dataMade) * 100)}% of observations can be sent home.` });

  if (a.dv < mission.dvRequired) w.push({ level: 'bad', text: `Not enough fuel: you need ${mission.dvRequired.toFixed(2)} km/s of push and have ${a.dv.toFixed(2)}.` });
  else if (a.dv < mission.dvRequired * 1.1) w.push({ level: 'warn', text: 'Fuel margin under 10%. Small surprises could strand you.' });

  if (mission.radiation >= 1 && a.shield.protect < 0.6) w.push({ level: 'warn', text: 'Jupiter’s radiation will fry unshielded electronics.' });

  const useless = a.instruments.filter(i => sciencePotential(mission, [i.id]) === 0);
  for (const i of useless) w.push({ level: 'warn', text: `The ${i.name.toLowerCase()} doesn’t help any goal on this mission.` });
  return w;
}

// ---------- Simulation ----------

function newSim(build, mission, rocket) {
  const a = analyze(build, mission);
  const totalCost = a.buildCost + rocket.cost + a.opsCost;
  return {
    build, mission, rocket, a,
    alive: true,
    fate: null,
    reserve: mission.budget - totalCost,
    fuel: a.fuel,
    dryMass: a.dryMass,
    solarMult: 1,
    antennaMult: 1,
    instruments: [...build.instruments],
    lostInstruments: [],
    computerBackupUsed: false,
    captured: true,
    science: 0,
    bonus: 0,
    log: [],
    steps: buildSteps(mission),
    stepIndex: 0,
    pendingChoice: null,
    chunkMod: 1,
    chunkRisk: 1,
    usedEvents: [],
    monthsDone: 0
  };
}

function buildSteps(mission) {
  const steps = ['launch', 'deploy'];
  if (mission.cruiseMonths > 0) steps.push('cruise', 'arrival');
  else steps.push('calibration', 'orbitRaise');
  const n = mission.sciencePhases || 3;
  for (let i = 1; i <= n; i++) steps.push('science' + i);
  steps.push('wrapup');
  if (mission.id === 'earth') steps.push('endOfLife');
  return steps;
}

function log(sim, phase, text, tone = 'info') {
  sim.log.push({ phase, text, tone });
}

function failMult(sim) { return sim.a.testing.mult; }

function radiationExposure(sim) {
  return sim.mission.radiation * (1 - sim.a.shield.protect);
}

// Burn fuel for a velocity change. Returns true if there was enough.
function burn(sim, dvKmS) {
  if (sim.a.engine.isp === 0) return false;
  const wet = sim.dryMass + sim.fuel;
  const ratio = Math.exp(dvKmS * 1000 / (sim.a.engine.isp * G0));
  const needed = wet - wet / ratio;
  if (needed > sim.fuel) return false;
  sim.fuel -= needed;
  return true;
}

function dvLeft(sim) {
  if (sim.a.engine.isp === 0 || sim.fuel <= 0) return 0;
  return sim.a.engine.isp * G0 * Math.log((sim.dryMass + sim.fuel) / sim.dryMass) / 1000;
}

function currentPower(sim, years) {
  const solar = sim.a.solarPower * sim.solarMult * Math.max(0, 1 - 0.025 * years);
  const rtg = sim.a.rtgPower * Math.max(0, 1 - 0.015 * years);
  return solar + rtg;
}

function currentInstrumentLoad(sim) {
  return sim.instruments.reduce((s, id) => s + byId(INSTRUMENTS, id).power, 0);
}

function currentDataMade(sim) {
  return sim.instruments.reduce((s, id) => s + byId(INSTRUMENTS, id).data, 0);
}

function loseRandomInstrument(sim, phase, cause) {
  if (sim.instruments.length === 0) return;
  const idx = Math.floor(rand() * sim.instruments.length);
  const id = sim.instruments.splice(idx, 1)[0];
  sim.lostInstruments.push(id);
  log(sim, phase, `${cause} The ${byId(INSTRUMENTS, id).name.toLowerCase()} has stopped working.`, 'bad');
}

function computerFault(sim, phase, cause) {
  if (sim.a && sim.build.backup && !sim.computerBackupUsed) {
    sim.computerBackupUsed = true;
    log(sim, phase, `${cause} The main computer failed, and the backup computer took over. Good call packing a spare.`, 'warn');
  } else {
    sim.alive = false;
    sim.fate = 'computer';
    log(sim, phase, `${cause} The flight computer failed and there was no backup. Contact lost.`, 'bad');
  }
}

// Each step returns either nothing (done) or a choice the player must make.
const STEP_RUNNERS = {
  launch(sim) {
    const r = sim.rocket, o = r.outcome;
    log(sim, 'Launch', `Liftoff on ${r.name} carrying ${Math.round(sim.a.wetMass).toLocaleString()} kg.`);
    if (o.lost) {
      sim.alive = false;
      sim.fate = 'launch';
      log(sim, 'Launch', o.reason, 'bad');
      return;
    }
    if (o.kind === 'wobble') log(sim, 'Launch', 'The rocket wobbled on the way up, but held together.', 'warn');
    if (o.engineOut) log(sim, 'Launch', 'One engine shut down early. The others burned longer to make up for it.', 'warn');
    log(sim, 'Launch', 'Clean separation from the rocket. The spacecraft is on its own.', 'good');
  },

  deploy(sim) {
    const a = sim.a;
    if (a.battery.wh === 0 && sim.build.rtg === 0) {
      sim.alive = false;
      sim.fate = 'battery';
      log(sim, 'Deploy', 'With no battery, the spacecraft went dark before its solar panels could open.', 'bad');
      return;
    }
    if (a.solar.power > 0) {
      if (rand() < 0.05 * failMult(sim)) {
        sim.solarMult = 0.5;
        log(sim, 'Deploy', 'One solar wing jammed half-open. You lost half your solar power.', 'bad');
      } else log(sim, 'Deploy', 'Solar panels unfolded and locked.', 'good');
    }
    if (a.antenna.size >= 2) {
      if (rand() < 0.04 * failMult(sim)) {
        sim.antennaMult = 0.1;
        log(sim, 'Deploy', 'The high-gain dish is stuck. You’re talking to Earth through a backup antenna at 10% speed.', 'bad');
      } else log(sim, 'Deploy', 'High-gain dish deployed and pointed at Earth.', 'good');
    }
    if (powerFactor(currentPower(sim, 0), a.coreLoad, 0) === 0) {
      sim.alive = false;
      sim.fate = 'power';
      log(sim, 'Deploy', 'Power generation is too low to run the computer. The batteries drained and the spacecraft froze.', 'bad');
    }
  },

  calibration(sim) {
    if (sim._calDone) return;
    sim._calDone = true;
    log(sim, 'Calibration', 'The satellite starts in an 857 km orbit that passes over the same spots every day, so engineers can check its readings against measurements on the ground.');
    sim.pendingChoice = {
      id: 'calibration', phase: 'Calibration', title: 'How long should calibration last?',
      text: 'Engineers compare your readings with tide gauges, buoys and an instrumented ocean platform. A longer check makes every later measurement more accurate, but costs money.',
      options: [
        { label: 'Extend calibration by a month', detail: 'Costs $4M. All later science is about 8% more accurate.', disabled: sim.reserve < 4,
          apply(s) { s.reserve -= 4; s.calib = 1.08; log(s, 'Calibration', 'Extra passes over the Harvest ocean platform off California pinned down every reading.', 'good'); } },
        { label: 'Keep the standard 3 months', detail: 'Normal accuracy. Science starts on time.',
          apply(s) { s.calib = 1; log(s, 'Calibration', 'Calibration finished on schedule.'); } }
      ]
    };
    return sim.pendingChoice;
  },

  endOfLife(sim) {
    if (sim._eolDone) return;
    sim._eolDone = true;
    const dv = dvLeft(sim), eng = sim.a.engine.isp > 0;
    sim.pendingChoice = {
      id: 'endOfLife', phase: 'End of mission', title: 'Your satellite\u2019s last decision',
      text: `The science mission is over. At 891 km a dead satellite would stay in orbit for centuries, adding to space junk. You have ${dv.toFixed(2)} km/s of push left.`,
      options: [
        { label: 'Bring it down into the ocean', detail: 'You fly the deorbit burn and aim the falling pieces at the empty South Pacific. Needs 0.20 km/s.', disabled: !eng || dv < 0.2,
          apply(s) { burn(s, 0.2); s.disposal = 'deorbit'; s.landing = 'aim'; log(s, 'End of mission', 'The satellite turned around for its deorbit burn. Now time the burn so the pieces that survive reentry fall into the empty South Pacific.', 'good'); } },
        { label: 'Lower the orbit', detail: 'Drop low enough for air drag to pull it down within 5 years, the US rule for new satellites. Needs 0.08 km/s.', disabled: !eng || dv < 0.08,
          apply(s) { burn(s, 0.08); s.disposal = 'lowered'; log(s, 'End of mission', 'The satellite now skims the upper air. Drag will bring it down within 5 years.', 'good'); } },
        { label: 'Boost to a disposal orbit', detail: 'Raise it above 2,000 km, out of the busy lanes, where it will stay for good. Needs 0.35 km/s.', disabled: !eng || dv < 0.35,
          apply(s) { burn(s, 0.35); s.disposal = 'graveyard'; log(s, 'End of mission', 'The satellite now drifts above 2,000 km, away from working satellites.', 'warn'); } },
        { label: 'Leave it where it is', detail: 'Costs nothing now, but it becomes space junk for centuries.',
          apply(s) { s.disposal = 'none'; log(s, 'End of mission', 'The satellite was switched off and left at 891 km. It will circle Earth as debris for centuries.', 'bad'); } }
      ]
    };
    return sim.pendingChoice;
  },

  orbitRaise(sim) {
    const dv = sim.mission.dvRequired * 0.4;
    if (burn(sim, dv)) log(sim, 'Orbit raise', `Engine burns raised the orbit from 857 km to the 891 km science orbit, just as SWOT did. ${Math.round(sim.fuel)} kg of fuel left.`, 'good');
    else {
      sim.chunkMod = 0.75;
      log(sim, 'Orbit raise', 'Not enough fuel to reach the planned orbit. You’re stuck lower, where air drag will shorten the mission.', 'bad');
      sim.shortMission = true;
    }
  },

  cruise(sim) {
    const m = sim.mission;
    const years = m.cruiseMonths / 12;
    log(sim, 'Cruise', `${m.cruiseMonths} months of travel through space${years >= 2 ? `, about ${years.toFixed(1)} years` : ''}.`);
    if (burn(sim, 0.05)) log(sim, 'Cruise', 'Small course-correction burns kept you on target.', 'good');
    else log(sim, 'Cruise', 'Could not make the course corrections. You’ll arrive off target.', 'bad');
    if (rand() < 0.03 * failMult(sim) * (1 + years * 0.3)) computerFault(sim, 'Cruise', 'A cosmic ray hit during the long cruise.');
  },

  arrival(sim) {
    const m = sim.mission;
    const need = m.dvRequired - 0.05;
    if (dvLeft(sim) >= need) {
      burn(sim, need);
      log(sim, 'Arrival', `Orbit insertion burn complete. Captured by ${m.id === 'mars' ? 'Mars' : 'Jupiter'}! ${Math.round(sim.fuel)} kg of fuel left.`, 'good');
    } else {
      sim.captured = false;
      log(sim, 'Arrival', `Only ${dvLeft(sim).toFixed(2)} km/s of push left but the insertion needs ${need.toFixed(2)}. The spacecraft flew past and is heading into deep space. You get one quick flyby of data.`, 'bad');
    }
  },

  science1(sim) { return scienceChunk(sim, 1); },
  science2(sim) { return scienceChunk(sim, 2); },
  science3(sim) { return scienceChunk(sim, 3); },
  science4(sim) { return scienceChunk(sim, 4); },
  science5(sim) { return scienceChunk(sim, 5); },
  science6(sim) { return scienceChunk(sim, 6); },

  wrapup(sim) {
    const m = sim.mission;
    if (dvLeft(sim) > 0.05 && sim.instruments.length > 0 && !sim.shortMission) {
      sim.bonus += 5;
      log(sim, 'Extended mission', 'Healthy spacecraft with fuel to spare. NASA approved a mission extension. Bonus science!', 'good');
    } else {
      log(sim, 'End of mission', 'Planned mission complete. The team sends the final commands.');
    }
  }
};

function scienceChunk(sim, n) {
  const m = sim.mission;
  const total = m.sciencePhases || 3;
  const phase = `Science, part ${n} of ${total}`;

  if (!sim.captured) {
    if (n === 1) {
      const pot = sciencePotential(m, sim.instruments);
      sim.science += pot * 0.08;
      log(sim, 'Flyby', 'You captured a few hours of close-up data as you sped past.', 'warn');
    }
    return;
  }

  // Event with a choice, once per chunk
  if (!sim.pendingChoice && !sim._chunkEventDone) {
    const pool = m.events.filter(e => !sim.usedEvents.includes(e));
    const id = pool[Math.floor(rand() * pool.length)];
    sim.usedEvents.push(id);
    sim._chunkEventDone = true;
    const ev = EVENTS[id](sim);
    if (ev) { sim.pendingChoice = { ...ev, id, phase }; return sim.pendingChoice; }
  }

  // Resolve the chunk
  sim._chunkEventDone = false;
  const years = (m.cruiseMonths + (m.scienceMonths * (n - 0.5)) / total) / 12;
  const pf = powerFactor(currentPower(sim, years), sim.a.coreLoad, currentInstrumentLoad(sim));
  const df = dataFactor(sim.a.downlink * sim.antennaMult, currentDataMade(sim));
  const batteryOk = sim.a.battery.wh >= sim.a.batteryNeeded || m.eclipse === 0;
  const bf = batteryOk ? 1 : 0.7;
  const pot = sciencePotential(m, sim.instruments);
  const gained = (pot / total) * pf * df * bf * sim.chunkMod * (sim.calib || 1);
  sim.science += gained;

  const notes = [];
  if (pf < 1) notes.push(`power only ran instruments ${Math.round(pf * 100)}% of the time`);
  if (df < 1) notes.push(`the antenna sent home only ${Math.round(df * 100)}% of the data`);
  if (!batteryOk) notes.push('instruments shut off in shadow because the battery was too small');
  log(sim, phase, `Collected ${gained.toFixed(1)} science points${notes.length ? '. Limits: ' + notes.join('; ') : ''}.`, notes.length ? 'warn' : 'good');
  sim.chunkMod = sim.shortMission ? 0.75 : 1;

  // Random failures, worse with radiation and poor testing
  const exposure = radiationExposure(sim) * sim.chunkRisk;
  if (rand() < 0.04 * failMult(sim) * (1 + exposure * 3)) {
    loseRandomInstrument(sim, phase, exposure > 0.3 ? 'Radiation damage.' : 'A part wore out.');
  }
  if (rand() < 0.015 * failMult(sim) * (1 + exposure * 5)) {
    computerFault(sim, phase, exposure > 0.3 ? 'Radiation struck the electronics.' : 'A memory chip failed.');
  }
  sim.chunkRisk = 1;
}

// Event definitions. Each returns { title, text, options: [{ label, detail, apply(sim) }] } or null.
const EVENTS = {
  ozoneHole(sim) {
    const can = ['irspec', 'radiometer'].some(i => sim.instruments.includes(i));
    return {
      title: 'The ozone hole is opening',
      text: 'Every September an ozone hole opens over Antarctica. In 1987 NASA\u2019s ER-2 and DC-8 airplanes, flying from Punta Arenas, Chile, showed that chlorine from man-made CFCs destroys the ozone. Scientists ask you to measure this year\u2019s hole.',
      options: [
        { label: 'Measure ozone and chlorine over the pole', detail: can ? 'Adds ozone science. Ocean measurements pause for a week.' : 'You need an infrared spectrometer or a microwave radiometer.', disabled: !can,
          apply(s) { s.chunkMod *= 0.95; s.bonus += 3; log(s, 'Ozone hole', 'You mapped this year\u2019s ozone hole and the chlorine monoxide inside the polar vortex, the chemical NASA\u2019s airplanes first caught in 1987.', 'good'); } },
        { label: 'Stay on the ocean plan', detail: 'Keep your measurements continuous.',
          apply(s) { log(s, 'Ozone hole', 'You stayed on plan.'); } }
      ]
    };
  },
  wildfire(sim) {
    const can = ['camera', 'hires', 'irspec'].some(i => sim.instruments.includes(i));
    return {
      title: 'Wildfires spreading',
      text: 'Huge fires are burning across western Canada. Firefighters ask for fresh images showing where the fire front is moving.',
      options: [
        { label: 'Point your cameras at the fires', detail: can ? 'Helps firefighters and adds science. Ocean measurements pause for a few days.' : 'You have no camera or infrared instrument that can see fires.', disabled: !can,
          apply(s) { s.chunkMod *= 0.95; s.bonus += 3; log(s, 'Wildfires', 'Your images mapped the fire front. Firefighters used them to plan evacuations.', 'good'); } },
        { label: 'Stay on the ocean plan', detail: 'Keep your measurements continuous.',
          apply(s) { log(s, 'Wildfires', 'You stayed on the ocean plan.'); } }
      ]
    };
  },
  volcano(sim) {
    const can = ['radiometer', 'irspec'].some(i => sim.instruments.includes(i));
    return {
      title: 'Undersea volcano erupts',
      text: 'A volcano near Tonga just blasted water vapor more than 50 km into the sky, like the real 2022 eruption. Scientists want measurements of the plume.',
      options: [
        { label: 'Measure the plume', detail: can ? 'Rare science, and a little ocean time lost.' : 'You need a radiometer or infrared spectrometer to measure it.', disabled: !can,
          apply(s) { s.chunkMod *= 0.95; s.bonus += 3; log(s, 'Volcano', 'You measured how much water the eruption pushed into the upper atmosphere.', 'good'); } },
        { label: 'Keep watching the oceans', detail: 'Stay on plan.',
          apply(s) { log(s, 'Volcano', 'You stayed on plan. Other satellites covered the eruption.'); } }
      ]
    };
  },
  groundOutage(sim) {
    const cost = 6;
    return {
      title: 'Ground station down',
      text: `A storm knocked out the Svalbard ground station, your main downlink, for two weeks. Reserve left: $${Math.round(sim.reserve)}M.`,
      options: [
        { label: `Rent a commercial station ($${cost}M)`, detail: 'Every bit of data still gets home.', disabled: sim.reserve < cost,
          apply(s) { s.reserve -= cost; log(s, 'Ground station', 'A commercial antenna in Alaska picked up your data. Nothing was lost.', 'good'); } },
        { label: 'Store data on board and wait', detail: 'Free, but the recorder fills up and some data is overwritten.',
          apply(s) { s.chunkMod *= 0.85; log(s, 'Ground station', 'The recorder filled up. Two weeks of measurements were partly lost.', 'warn'); } }
      ]
    };
  },
  orbitDecay(sim) {
    const can = sim.a.engine.isp > 0 && dvLeft(sim) > 0.02;
    return {
      title: 'Orbit is sinking',
      text: 'The Sun is near the peak of its 11-year cycle. Its heat puffs up the upper atmosphere, and the extra drag is slowly pulling your orbit down.',
      options: [
        { label: 'Fire thrusters to boost back up', detail: can ? 'Uses a little fuel. Measurements stay on their exact track.' : 'You have no engine or fuel left to boost.', disabled: !can,
          apply(s) { burn(s, 0.015); log(s, 'Orbit decay', 'A short burn put the satellite back on its exact track.', 'good'); } },
        { label: 'Let it sink a little', detail: 'Saves fuel, but measurements drift off their repeat track.',
          apply(s) { s.chunkMod *= 0.88; log(s, 'Orbit decay', 'The orbit sank a few hundred meters, and repeat measurements no longer lined up perfectly.', 'warn'); } }
      ]
    };
  },
  solarStorm(sim) {
    return {
      title: 'Solar storm incoming',
      text: 'NASA\u2019s PUNCH satellites, which watch the Sun\u2019s corona turn into the solar wind, just saw a huge burst of particles leave the Sun. It reaches your spacecraft in 6 hours.',
      options: [
        { label: 'Switch to safe mode', detail: 'Instruments off for two weeks. Lose some science, no risk.',
          apply(s) { s.chunkMod *= 0.85; log(s, 'Solar storm', 'Safe mode held. The storm passed harmlessly.', 'good'); } },
        { label: 'Keep observing', detail: `Risk an instrument. Shielding lowers the odds (now about ${Math.round(40 * (1 - sim.a.shield.protect))}%).`,
          apply(s) {
            if (rand() < 0.4 * (1 - s.a.shield.protect)) loseRandomInstrument(s, 'Solar storm', 'Particle strike.');
            else log(s, 'Solar storm', 'You kept observing and got lucky. No damage.', 'good');
          } }
      ]
    };
  },
  debris(sim) {
    const canDodge = sim.a.engine.isp > 0 && dvLeft(sim) > 0.01;
    return {
      title: 'Space debris warning',
      text: 'An old rocket part will pass within 200 m. Ground teams put the chance of a hit at 1 in 25.',
      options: [
        { label: 'Fire thrusters to dodge', detail: canDodge ? 'Uses a little fuel.' : 'You have no engine or fuel. Not possible.', disabled: !canDodge,
          apply(s) { burn(s, 0.005); log(s, 'Debris', 'Dodged. The debris passed safely.', 'good'); } },
        { label: 'Hold course and hope', detail: '4% chance of losing the spacecraft.',
          apply(s) {
            if (rand() < 0.04) { s.alive = false; s.fate = 'debris'; log(s, 'Debris', 'Impact. The spacecraft broke apart.', 'bad'); }
            else log(s, 'Debris', 'The debris missed.', 'good');
          } }
      ]
    };
  },
  hurricane(sim) {
    const cost = 8;
    return {
      title: 'Hurricane forming',
      text: `A major hurricane is forming in the Atlantic. Scientists want extra ground-station time to download every image. Reserve left: $${Math.round(sim.reserve)}M.`,
      options: [
        { label: `Pay $${cost}M for extra downlinks`, detail: 'More science this period.', disabled: sim.reserve < cost,
          apply(s) { s.reserve -= cost; s.chunkMod *= 1.15; log(s, 'Hurricane', 'Extra passes booked. Forecasters used your data.', 'good'); } },
        { label: 'Save the money', detail: 'Normal operations.',
          apply(s) { log(s, 'Hurricane', 'Normal operations continued.'); } }
      ]
    };
  },
  relay(sim) {
    return {
      title: 'A rover needs help',
      text: 'A rover on the surface lost its own link to Earth. It asks to send its data through your spacecraft.',
      options: [
        { label: 'Relay the rover’s data', detail: 'Shares your antenna. Less of your own science, but NASA adds $20M to your reserve.',
          apply(s) { s.chunkMod *= 0.85; s.reserve += 20; s.bonus += 3; log(s, 'Relay', 'You relayed the rover’s data. The rover team is grateful.', 'good'); } },
        { label: 'Decline', detail: 'Keep your antenna for your own science.',
          apply(s) { log(s, 'Relay', 'Request declined. Your own science continued.'); } }
      ]
    };
  },
  conjunction(sim) {
    return {
      title: 'The Sun is in the way',
      text: 'For two weeks, Mars sits behind the Sun as seen from Earth. Radio signals can’t get through.',
      options: [
        { label: 'Store data and wait', detail: 'Keep observing, send it all later. The recorder may fill up.',
          apply(s) { s.chunkMod *= 0.93; log(s, 'Conjunction', 'Recorder filled near the end. A little data was overwritten.', 'warn'); } },
        { label: 'Pause instruments', detail: 'Simple and safe, but lose two weeks.',
          apply(s) { s.chunkMod *= 0.9; log(s, 'Conjunction', 'Instruments paused until the link came back.'); } }
      ]
    };
  },
  radiation(sim) {
    return {
      title: 'Closer Europa flybys?',
      text: 'Scientists want to dive lower over Europa. Sharper data, but deeper into Jupiter’s radiation belts.',
      options: [
        { label: 'Fly closer', detail: '+30% science this period, triple the radiation risk.',
          apply(s) { s.chunkMod *= 1.3; s.chunkRisk = 3; log(s, 'Flyby plan', 'Flyby altitude lowered to 25 km.', 'warn'); } },
        { label: 'Keep a safe distance', detail: 'Normal science and risk.',
          apply(s) { log(s, 'Flyby plan', 'Kept the planned 100 km altitude.'); } }
      ]
    };
  },
  plume(sim) {
    const canGo = sim.a.engine.isp > 0 && dvLeft(sim) > 0.04;
    return {
      title: 'Water plume spotted!',
      text: 'Telescopes on Earth may have seen water spraying out of Europa. Change course to fly through it?',
      options: [
        { label: 'Retarget the next flyby', detail: canGo ? 'Uses 40 m/s of fuel. Big science bonus if it’s real.' : 'Not enough fuel left.', disabled: !canGo,
          apply(s) {
            burn(s, 0.04);
            if (rand() < 0.6) { s.bonus += 8; log(s, 'Plume', 'You flew through the plume and tasted Europa’s ocean water!', 'good'); }
            else log(s, 'Plume', 'The plume had faded by the time you arrived. Fuel spent, no bonus.', 'warn');
          } },
        { label: 'Stay on plan', detail: 'Save your fuel.',
          apply(s) { log(s, 'Plume', 'You stayed on the planned path.'); } }
      ]
    };
  }
};

// Advance one step. Returns a choice object if the player must decide.
function stepSim(sim) {
  if (!sim.alive || sim.stepIndex >= sim.steps.length) return null;
  const name = sim.steps[sim.stepIndex];
  const result = STEP_RUNNERS[name](sim);
  if (result) return result;
  sim.stepIndex++;
  return null;
}

// "Send it home" button: end the mission early and fly the satellite down
function requestHome(sim) {
  if (!sim.alive || sim.pendingChoice || sim.landing || sim.stepIndex >= sim.steps.length) return null;
  const dv = dvLeft(sim), eng = sim.a.engine.isp > 0;
  sim.pendingChoice = {
    id: 'sendHome', phase: 'Send it home', title: 'Send your satellite home now?', noStep: true,
    text: `Bringing it down ends the science mission early. You have collected ${Math.round(sim.science + sim.bonus)} science points so far. A deorbit needs 0.20 km/s of push and you have ${dv.toFixed(2)} km/s.`,
    options: [
      { label: 'Yes, fly it home', detail: eng && dv >= 0.2 ? 'You steer it down with the arrow keys and aim for the safe zone.' : 'Not enough fuel or no engine. It cannot come down on purpose.', disabled: !eng || dv < 0.2,
        apply(s) { burn(s, 0.2); s.disposal = 'deorbit'; s.landing = 'aim'; s.endedEarly = true; s._eolDone = true; s.stepIndex = s.steps.length;
          log(s, 'Send it home', 'Mission control ended the science early and turned the satellite around for its deorbit burn.', 'warn'); } },
      { label: 'No, keep doing science', detail: 'Carry on with the mission.', apply(s) { log(s, 'Send it home', 'You kept the mission going.'); } }
    ]
  };
  return sim.pendingChoice;
}

function chooseOption(sim, optionIndex) {
  const choice = sim.pendingChoice;
  if (!choice) return;
  const opt = choice.options[optionIndex];
  if (opt.disabled) return;
  opt.apply(sim);
  sim.pendingChoice = null;
  if (choice.noStep) return;
  sim.lastEvent = { id: choice.id, opt: optionIndex, alive: sim.alive, n: ((sim.lastEvent && sim.lastEvent.n) || 0) + 1, at: Date.now() };
  if (sim.alive) {
    // Finish the science chunk this event belonged to
    STEP_RUNNERS[sim.steps[sim.stepIndex]](sim);
  }
  sim.stepIndex++;
}

function simDone(sim) {
  return !sim.alive || sim.stepIndex >= sim.steps.length;
}

// ---------- Scoring and lessons ----------

function finalReport(sim) {
  const m = sim.mission;
  const a = sim.a;
  const science = Math.min(100, Math.round(sim.science + sim.bonus));

  // Final score out of 100: science, a clean ending, money left and a healthy satellite
  const lr = sim.landingResult;
  const disposalPts = sim.disposal === 'deorbit' && lr && !lr.inZone ? 8 : ({ deorbit: 15, lowered: 12, graveyard: 10 }[sim.disposal] || 0);
  const moneyPts = Math.max(0, Math.min(10, (sim.reserve / m.budget) * 10));   // 1 point per 10% of the budget left
  const healthPts = sim.alive ? 5 + 5 * (sim.instruments.length / Math.max(1, sim.build.instruments.length)) : 0;
  const breakdown = [
    { name: 'Science', pts: Math.round(science * 0.65), max: 65 },
    { name: 'Clean ending', pts: disposalPts, max: 15 },
    { name: 'Money left', pts: Math.round(moneyPts), max: 10 },
    { name: 'Satellite health', pts: Math.round(healthPts), max: 10 }
  ];
  const total = breakdown.reduce((t, b) => t + b.pts, 0);
  let grade;
  if (sim.fate === 'launch') grade = 'Lost at launch';
  else if (total >= 85) grade = 'Flagship success';
  else if (total >= 70) grade = 'Mission success';
  else if (total >= 50) grade = 'Partial success';
  else if (total > 0) grade = 'Limited success';
  else grade = 'Mission lost';

  const lessons = [];
  const pMargin = (a.powerAvailable - a.powerNeeded) / a.powerNeeded;
  if (pMargin < 0) lessons.push(`Power: your spacecraft needed ${Math.round(a.powerNeeded)} W but made only ${Math.round(a.powerAvailable)} W at ${m.target}. Sunlight there is ${Math.round(a.sunlight * 100)}% of what Earth gets, so panels shrink fast as you go farther out.`);
  else if (pMargin < 0.2) lessons.push(`Power: only ${Math.round(pMargin * 100)}% spare power. Real teams aim for 20 to 30% because panels weaken every year.`);
  else if (pMargin > 1) lessons.push(`Power: you made more than twice the power you needed. Smaller panels would have saved mass and money.`);
  else lessons.push(`Power: a healthy ${Math.round(pMargin * 100)}% margin. Nicely sized.`);

  if (a.dataMade > a.downlink) lessons.push(`Data: your instruments produced ${a.dataMade.toFixed(2)} Mbps, but your antenna could send only ${a.downlink.toFixed(2)} Mbps home. Radio signals get weaker with the square of distance.`);

  const dvMargin = (a.dv - m.dvRequired) / m.dvRequired;
  if (dvMargin < 0) lessons.push(`Fuel: you were ${(m.dvRequired - a.dv).toFixed(2)} km/s short. In the rocket equation, every extra kilogram of spacecraft needs more fuel to push it.`);
  else if (dvMargin > 0.5) lessons.push(`Fuel: you carried ${Math.round(dvMargin * 100)}% more push than needed. That extra fuel was mass the rocket had to lift.`);

  const ra = sim.rocket.analysis;
  if (ra) {
    if (sim.fate === 'launch') lessons.unshift(`Rocket: ${sim.rocket.outcome.reason} ${rocketTips(ra)[0] || ''}`.trim());
    else if (ra.dv > ra.needed + 2.5) lessons.push(`Rocket: it had ${(ra.dv - ra.needed).toFixed(1)} km/s more push than the mission needed. A smaller rocket could have freed money for science.`);
    else if (ra.dv - ra.needed < 0.3) lessons.push(`Rocket: only ${(ra.dv - ra.needed).toFixed(2)} km/s of spare push. Real launches keep a reserve for surprises.`);
  }

  const useless = a.instruments.filter(i => sciencePotential(m, [i.id]) === 0);
  for (const i of useless) lessons.push(`Instruments: the ${i.name.toLowerCase()} added ${i.mass} kg and $${i.cost}M but answered none of this mission’s questions.`);

  const scores = objectiveScores(m, a.instruments.map(i => i.id));
  for (const o of scores) if (o.coverage === 0) lessons.push(`Goals: nothing on board could "${o.name.toLowerCase()}". That was ${o.weight} points out of reach from the start.`);

  if (a.testing.id === 'basic') lessons.push('Testing: skipping tests saved money but made every part more likely to fail. Many real missions were lost to problems testing would have caught.');
  if (m.radiation >= 1 && a.shield.protect < 0.6) lessons.push('Radiation: Juno and Europa Clipper both put their electronics in a thick titanium vault for exactly this reason.');
  if (sim.computerBackupUsed) lessons.push('Backup: your spare computer saved the mission. That’s why real spacecraft carry redundant systems.');
  if (m.id === 'earth' && sim.fate !== 'launch') {
    if (sim.endedEarly) lessons.push('Early ending: you brought the satellite home before its science plan was finished. Real missions sometimes end early when fuel or money runs low, but every month in orbit adds data.');
    if (sim.disposal === 'none') lessons.push('Space junk: you left a dead satellite at 891 km, where it will stay for centuries. Since 2024 the US requires new low-orbit satellites to come down within 5 years.');
    else if (!sim.disposal) lessons.push('Space junk: the satellite died before it could be brought down, so it is now debris. Spare fuel and a backup computer help a satellite finish its job.');
    else if (sim.disposal === 'deorbit' && sim.landingResult && !sim.landingResult.inZone) lessons.push(`Off target: the surviving pieces fell ${sim.landingResult.distKm.toLocaleString('en-US')} km from Point Nemo, outside the safe zone. Real teams time the deorbit burn so debris lands in the empty South Pacific, far from ships and people.`);
    else if (sim.disposal === 'deorbit') lessons.push(`Clean ending: you kept fuel for a controlled deorbit${sim.landingResult ? ` and landed the pieces ${sim.landingResult.distKm.toLocaleString('en-US')} km from Point Nemo, the ocean spot farthest from any land` : ''}. That is the safest way to end a mission.`);
  }

  // What your satellite discovered (game estimates based on real SWOT goals)
  const pot = sciencePotential(m, a.instruments.map(i => i.id));
  const realized = Math.max(0, Math.min(1, (sim.science + sim.bonus) / Math.max(1, pot)));
  const fmt = (n) => Math.round(n).toLocaleString();
  const FIND = {
    'Measure sea level rise': (q) => `Measured global sea level rising about 3.4 mm per year, accurate to \u00b1${(0.3 + 2.2 * (1 - q)).toFixed(1)} mm.`,
    'Map rivers and lakes': (q) => `Measured water heights in ${fmt(q * 1.2e6)} lakes and ${fmt(q * 2.1e6)} km of rivers.`,
    'Track hurricanes and ocean heat': (q) => `Tracked ${fmt(q * 85)} tropical storms and mapped the warm water that feeds them.`,
    'Track the ozone hole': (q) => `Mapped the Antarctic ozone hole in ${Math.max(1, Math.round(q * 3))} of 3 spring seasons, following the CFC chlorine NASA\u2019s 1987 AAOE flights discovered.`,
    'Watch wildfires and farmland': (q) => `Spotted ${fmt(q * 9000)} large wildfires and mapped crops across ${fmt(q * 60)}% of farmland.`,
    'Measure polar ice thickness': (q) => `Measured ice thickness over ${fmt(q * 100)}% of Greenland and Antarctica.`
  };
  const discoveries = scores.map(o => {
    const q = o.coverage * realized;
    if (q < 0.05 || sim.fate === 'launch') return { name: o.name, text: o.coverage === 0 ? 'Not measured: nothing on board could do this.' : 'Hardly measured: too little data made it home.', none: true };
    return { name: o.name, text: (FIND[o.name] || (() => `Covered ${fmt(q * 100)}% of this goal.`))(q) };
  });

  return {
    science, grade, total, breakdown, discoveries, disposal: sim.disposal || null,
    objectives: objectiveScores(m, sim.instruments),
    originalObjectives: scores,
    reserve: Math.round(sim.reserve),
    lessons
  };
}
