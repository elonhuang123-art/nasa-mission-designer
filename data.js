// All game numbers live here. Values are simplified but based on real mission classes.
// Mass in kg, power in watts, cost in millions of US dollars, data in megabits per second.

const MISSIONS = [
  {
    id: 'earth',
    name: 'Earth Watch',
    tagline: 'Launch an ocean and water satellite like NASA\u2019s SWOT, measure sea level, rivers and storms, then end the mission cleanly.',
    target: 'low Earth orbit',
    difficulty: 'Earth satellite mission',
    budget: 1000,
    solarDist: 1.0,      // AU from the Sun (sets sunlight)
    eclipse: 0.35,       // fraction of each orbit spent in Earth's shadow
    eclipseHours: 0.6,   // longest stretch the battery must cover
    commDist: 0.3,       // effective AU for radio link (close = fast)
    radiation: 0.1,
    cruiseMonths: 0,
    scienceMonths: 36,
    sciencePhases: 6,
    opsPerMonth: 1.0,
    dvRequired: 0.15,    // km/s needed after launch
    signalDelay: 'under 1 second',
    // Science goals modeled on NASA/CNES SWOT. Instruments that work together add up: 1 - (1-a)(1-b)...
    objectives: [
      { name: 'Measure sea level rise', weight: 25, instruments: { altimeter: 0.6, gps: 0.35, radiometer: 0.25 } },
      { name: 'Map rivers and lakes', weight: 20, instruments: { altimeter: 0.7, hires: 0.45, camera: 0.2 } },
      { name: 'Track hurricanes and ocean heat', weight: 20, instruments: { radiometer: 0.8, irspec: 0.45, camera: 0.25 } },
      // NASA's AAOE (1987) and AASE (1989) airborne campaigns tied the ozone hole to chlorine from CFCs
      { name: 'Track the ozone hole', weight: 15, instruments: { irspec: 0.7, radiometer: 0.6 } },
      { name: 'Watch wildfires and farmland', weight: 10, instruments: { hires: 0.8, irspec: 0.6, camera: 0.6 } },
      { name: 'Measure polar ice thickness', weight: 10, instruments: { radar: 0.9, altimeter: 0.5 } }
    ],
    events: ['hurricane', 'wildfire', 'volcano', 'debris', 'solarStorm', 'groundOutage', 'orbitDecay', 'ozoneHole']
  }
];

const BUSES = [
  { id: 'small', name: 'Small bus', mass: 150, power: 60, cost: 25, slots: 3, desc: 'Fits 3 instruments. Cheap and light.' },
  { id: 'medium', name: 'Medium bus', mass: 350, power: 120, cost: 60, slots: 5, desc: 'Fits 5 instruments. A solid all-rounder.' },
  { id: 'large', name: 'Large bus', mass: 800, power: 220, cost: 130, slots: 8, desc: 'Fits 8 instruments. Heavy and power hungry.' }
];

const INSTRUMENTS = [
  { id: 'altimeter', name: 'Radar altimeter (KaRIn-style)', mass: 95, power: 220, cost: 85, data: 2.5, desc: 'Measures water height to within centimeters across a 120 km wide strip. The heart of an ocean mission.' },
  { id: 'gps', name: 'Precise orbit receiver', mass: 6, power: 15, cost: 10, data: 0.001, desc: 'Knows your height to 1 or 2 cm. Altimeter readings mean little without it.' },
  { id: 'camera', name: 'Wide-angle camera', mass: 25, power: 30, cost: 20, data: 0.3, desc: 'Takes broad color images of whole regions.' },
  { id: 'hires', name: 'High-resolution telescope', mass: 110, power: 80, cost: 75, data: 2.0, desc: 'Sees objects the size of a desk. Makes huge files.' },
  { id: 'irspec', name: 'Infrared spectrometer', mass: 40, power: 45, cost: 40, data: 0.4, desc: 'Reads the chemical fingerprint of rocks, ice and gas.' },
  { id: 'radar', name: 'Ice-penetrating radar', mass: 75, power: 160, cost: 55, data: 0.8, desc: 'Sees kilometers below the surface. Needs lots of power.' },
  { id: 'magnetometer', name: 'Magnetometer', mass: 8, power: 6, cost: 8, data: 0.005, desc: 'Measures magnetic fields. Tiny and cheap.' },
  { id: 'radiometer', name: 'Microwave radiometer', mass: 55, power: 50, cost: 35, data: 0.15, desc: 'Measures temperature and water through clouds.' },
  { id: 'particle', name: 'Charged-particle detector', mass: 15, power: 12, cost: 12, data: 0.01, desc: 'Counts the charged particles streaming through space.' }
];

const SOLAR = [
  { id: 'none', name: 'No solar panels', power: 0, mass: 0, cost: 0, desc: 'Only works if you bring RTGs.' },
  { id: 'small', name: 'Small panels', power: 600, mass: 20, cost: 6, desc: '600 W at Earth’s distance from the Sun.' },
  { id: 'medium', name: 'Medium panels', power: 1800, mass: 55, cost: 15, desc: '1,800 W at Earth’s distance.' },
  { id: 'large', name: 'Large panels', power: 5000, mass: 150, cost: 35, desc: '5,000 W at Earth’s distance.' },
  { id: 'giant', name: 'Giant panels', power: 12000, mass: 340, cost: 70, desc: '12,000 W at Earth’s distance. As wide as a basketball court.' }
];

const RTG = { power: 110, mass: 45, cost: 75, max: 3 };

const BATTERIES = [
  { id: 'none', name: 'No battery', wh: 0, mass: 0, cost: 0, desc: 'Nothing keeps the lights on in shadow.' },
  { id: 'small', name: 'Small battery', wh: 1000, mass: 10, cost: 2, desc: 'Stores 1,000 Wh.' },
  { id: 'large', name: 'Large battery', wh: 3000, mass: 25, cost: 5, desc: 'Stores 3,000 Wh.' }
];

const ANTENNAS = [
  { id: 'lga', name: 'Low-gain antenna', rate: 0.05, mass: 4, power: 8, cost: 2, size: 0, desc: 'Works from any angle, but slow.' },
  { id: 'mga', name: 'Medium-gain antenna', rate: 0.6, mass: 15, power: 35, cost: 8, size: 1, desc: 'Ten times faster. Must roughly face Earth.' },
  { id: 'hga', name: 'High-gain dish, 2 m', rate: 6, mass: 45, power: 70, cost: 22, size: 2, desc: 'Fast, focused beam. Must point right at Earth.' },
  { id: 'hga4', name: 'High-gain dish, 4 m', rate: 20, mass: 110, power: 110, cost: 45, size: 3, desc: 'The big one. Built for the outer planets.' }
];

const ENGINES = [
  { id: 'none', name: 'No engine', isp: 0, mass: 0, cost: 0, desc: 'Cannot change orbit or dodge anything.' },
  { id: 'mono', name: 'Monopropellant thrusters', isp: 225, mass: 20, cost: 6, desc: 'Simple and cheap, but burns more fuel per push.' },
  { id: 'biprop', name: 'Bipropellant engine', isp: 320, mass: 45, cost: 18, desc: 'Gets about 40% more push from the same fuel.' },
  // Electric propulsion like NASA's Dawn, which orbited Vesta and Ceres
  { id: 'ion', name: 'Ion thruster (like NASA\u2019s Dawn)', isp: 3000, mass: 35, cost: 28, power: 600, desc: 'About 10 times more efficient than chemical engines, but gentle and needs 600 W of power. NASA\u2019s Dawn used ion engines to orbit Vesta and Ceres.' }
];

const SHIELDS = [
  { id: 'none', name: 'No shielding', mass: 0, cost: 0, protect: 0, desc: 'Electronics take the full radiation dose.' },
  { id: 'vault', name: 'Electronics vault', mass: 40, cost: 8, protect: 0.6, desc: 'Titanium box around the computers. Blocks 60%.' },
  { id: 'heavy', name: 'Heavy vault', mass: 120, cost: 20, protect: 0.85, desc: 'Thick walls. Blocks 85%.' }
];

const TESTING = [
  { id: 'basic', name: 'Basic testing', cost: 0, mult: 1.8, desc: 'Skip the shake and vacuum tests. Parts fail more often.' },
  { id: 'standard', name: 'Standard testing', cost: 25, mult: 1.0, desc: 'The normal campaign of shake, thermal and vacuum tests.' },
  { id: 'rigorous', name: 'Rigorous testing', cost: 60, mult: 0.5, desc: 'Test everything twice. Half as many failures.' }
];

const BACKUP = { mass: 20, power: 25, cost: 15 };

// Fictional rockets modeled on real capability classes.
const ROCKETS = [
  { id: 'kestrel', name: 'Kestrel', cls: 'Light lift', cost: 35, reliability: 0.95, capacity: { earth: 1200, mars: 0, jupiter: 0 } },
  { id: 'condor', name: 'Condor', cls: 'Medium lift', cost: 90, reliability: 0.98, capacity: { earth: 8000, mars: 2200, jupiter: 600 } },
  { id: 'albatross', name: 'Albatross', cls: 'Heavy lift', cost: 160, reliability: 0.98, capacity: { earth: 22000, mars: 6000, jupiter: 2500 } },
  { id: 'leviathan', name: 'Leviathan', cls: 'Super-heavy lift', cost: 400, reliability: 0.97, capacity: { earth: 60000, mars: 18000, jupiter: 7000 } }
];

const G0 = 9.80665;

// NASA data and sources used in this game (shown under "NASA data & sources")
const SOURCES = [
  { name: 'NASA JPL: SWOT launch press kit', url: 'https://www.jpl.nasa.gov/press-kits/swot/',
    used: 'The launch timeline (Vandenberg Space Force Base, December 2022) and the satellite\u2019s ocean, river and lake science goals.' },
  { name: 'NASA Earth Science Project Office: Airborne Antarctic Ozone Experiment (AAOE)', url: 'https://espo.nasa.gov/aaoe',
    used: 'The ozone hole goal and event. NASA\u2019s ER-2 and DC-8 aircraft flew from Punta Arenas, Chile, in 1987 (AAOE) and from Stavanger, Norway, in 1989 (AASE) and showed that chlorine from CFCs destroys polar ozone.' },
  { name: 'NASA PUNCH mission (Polarimeter to Unify the Corona and Heliosphere)', url: 'https://science.nasa.gov/mission/punch/',
    used: 'The solar storm event. Four suitcase-sized satellites in low Earth orbit, launched March 11, 2025, watch the Sun\u2019s corona turn into the solar wind.' },
  { name: 'PILOT magnetosphere mission design (Advanced Space, CU Boulder LASP)', url: 'https://advancedspace.com/pilot-magnetosphere-science-mission-design/',
    used: 'The magnetosphere fact card at the end of the launch. A proposed fleet of 34 satellites that would image cold plasma around Earth \u201clike a CT scan.\u201d' },
  { name: 'NASA Dawn mission', url: 'https://science.nasa.gov/mission/dawn/',
    used: 'The ion thruster option. Dawn launched September 27, 2007 and orbited the giant asteroid Vesta and the dwarf planet Ceres.' },
  { name: 'NASA Glenn Research Center: COMPASS concept design lab', url: 'https://www.nasa.gov/glenn-labs-and-test-facilities/',
    used: 'How real teams design missions. COMPASS runs rapid spacecraft concept designs for NASA, industry and scientists, such as the Mars Moon Sampler idea for returning samples from Phobos and Deimos.' },
  { name: 'S. D. Creech, \u201cGame Changing: NASA\u2019s Space Launch System and Science Mission Design,\u201d NASA Marshall, IEEE Aerospace Conference 2013', url: 'https://ntrs.nasa.gov/api/citations/20130013034/downloads/20130013034.pdf',
    used: 'The Rocket Designer\u2019s real rocket check: SLS lifts 70 metric tons to low Earth orbit (evolvable to 130 t) with 10% more thrust than Saturn V, using four RS-25 engines and two 5-segment boosters.' },
  { name: 'Artemis program', url: 'https://en.wikipedia.org/wiki/Artemis_program',
    used: 'SLS flew Artemis I on November 16, 2022. Orion traveled more than 2.3 million km in 25 days. Artemis II carried the first crew in April 2026.' },
  { name: 'Stanford AA 118N: How to design a space mission, from concept to execution', url: 'https://exploreintrosems.stanford.edu/news/aa-118n-how-design-space-mission-concept-execution',
    used: 'Background on the mission design process the game follows (the page needs a Stanford login).' },
  { name: 'NASA Glenn, NASA Science, UCAR and NASA Goddard', url: null,
    used: 'Speed of sound for the Mach number, atmosphere layer heights for the fact cards and altitude bar, and the magnetosphere and Van Allen belts.' },
  { name: 'NASA Blue Marble imagery', url: null,
    used: 'The Earth you see in the 3D orbit view (via the three.js example textures).' }
];
