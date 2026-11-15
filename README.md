# Mission Designer

A NASA Space Apps Challenge game. You design, launch and fly an Earth science satellite modeled on NASA's SWOT mission, and every choice is a trade-off between mass, power, money and risk.

## How to play

1. **Build the spacecraft.** Pick a bus, instruments, power, antenna, engine and fuel within a $1,000M budget.
2. **Design the rocket.** Set stages, engines, thrust and fuel. Fly free test flights in 3D before you commit.
3. **Launch.** Watch the 3D launch on the SWOT timeline from Vandenberg. Drag to take over the camera, and on the finale fly around Earth's magnetosphere.
4. **Fly the mission.** The control center shows your satellite at real scale and real speed (one orbit takes 1 h 43 min, with ×10, ×100 and ×1000 time controls). Handle debris, solar storms, hurricanes, wildfires, eruptions and the ozone hole as they happen.
5. **Bring it home.** Fly the deorbit burn yourself with the arrow keys and land the surviving pieces in the safe zone around Point Nemo.
6. **Results.** Score, discoveries, lessons and a leaderboard.

## Run it locally

No build step. Serve the folder with any static web server, for example:

```
python -m http.server 8000
```

Then open http://localhost:8000/

## Deploy

`render.yaml` deploys the folder as a Render static site.

## NASA data and sources

The in-game "NASA data & sources" panel lists every source and what it is used for, including the NASA JPL SWOT press kit, the AAOE and AASE ozone campaigns, PUNCH, PILOT, Dawn, COMPASS, the Space Launch System paper on NTRS (Creech 2013) and the Artemis program.

## Built with

Plain HTML, CSS and JavaScript, with [three.js](https://threejs.org/) r147 bundled in `vendor/three`.
