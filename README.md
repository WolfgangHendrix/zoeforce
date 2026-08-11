# Nephelim Squadron — six-stage campaign

A playable **Life Force**-inspired six-stage campaign alternating horizontal
and vertical combat from the organic corridor through Mechanical City.
Vanilla JS, no build step. The simulation runs at 256×224 and is presented by
a **real-geometry Three.js voxel view** by default, with the original pixel 2D
renderer retained as a fallback and alternate view.

## Run it

Double-click `index.html` for the fallback 2D game — it still works from
`file://` (plain `<script>` tags, no modules).

The default voxel view needs a real server, because three.js is ESM-only and
browsers block module imports over `file://`:

```
python -m http.server 8791
# http://localhost:8791/index.html   then press V
```

## Controls

| Key | Action |
| --- | --- |
| Arrows / WASD | Move |
| Z / J / Space | Fire (hold) — Manual mode only |
| X / K / Shift | Spend the highlighted power-meter slot |
| **M** | Cycle fire mode: MANUAL → AUTO → AI ASSIST |
| **V** | Toggle between voxel 3D and pixel 2D |
| **T** | Toggle the on-screen touch pad |
| Enter | Start / continue |
| P | Pause |
| F | Fullscreen |

### Xbox 360 controller

| Control | Action |
| --- | --- |
| Left stick / D-pad | Move (analog stick includes a radial dead zone) |
| A / X / right trigger | Fire |
| B / Y / either bumper | Spend the highlighted power-meter slot |
| Back | Cycle fire mode |
| Start | Start / continue / pause |
| Right-stick click | Toggle between voxel 3D and pixel 2D |

Controllers use the browser Gamepad API and can be connected before or during
play. Keyboard, controller, and touch input remain active together.

On touch devices the pad appears automatically: a floating thumbstick on the
left, FIRE and POW under the right thumb, START/MODE/pause along the top. It
is multi-touch and analog, and feeds the same `NS.Input` the keyboard does.

## What's implemented

**Power meter** — the Gradius/Life Force capsule system, six slots:
`SPEED · MISSILE · RIPPLE · LASER · OPTION · FORCE`. Each capsule advances the
highlight; `X` spends it. Speed has 5 NES-style levels, Options cap at 2 and trail the
ship along its own flight path, Ripple and Laser are mutually exclusive, Force
Field absorbs 4 hits.

**Capsule drops** — rows, exactly as Life Force does it. Wipe a **complete
row** — every craft in the formation, before any of them escapes off the left
edge — and it pays **one capsule**. Clear a row, take the cube, move to the
next row, clear that. Every formation pays, so the opening is deliberately
generous; the power curve comes from how hard a *full* clear is, not from the
game rationing drops.

Letting a single member slip past is the whole tension: off-screen culling
never routes through `destroy()`, so `killed` never reaches `total` and the
row simply does not pay.

**Lone carriers** — some single wall enemies hold a capsule too. They wear the
red carrier livery so you can see at a glance that one is worth going out of
your way for, and they *always* drop. No dice roll: if it looks like it has
one, it has one. Eight are placed across the stage, weighted toward the
opening. Plain wall enemies are worth score only.

Sixteen formations are additionally marked as red carrier squads — tougher,
worth double score, and still paying their capsule like any other row.

`NS.Enemies.everySetDrops = false` restricts payouts to only those marked
sets, if you ever want the stingier economy back.

**Weapons** — 2-shot-limit vanilla gun (limit rises with Options), paired
floor/ceiling crawling missiles, piercing Ripple rings, and a piercing Laser
beam. Missile can be selected three times: each level increases travel speed
and adds another twin pair to the salvo. Options also launch missile pairs.

**Terrain** — a 9,400px authored heightmap corridor (`KEYFRAMES` in
`src/terrain.js`): pinches, tunnels, ceiling galleries, an open cavern, and the
boss chamber. Touching the flesh kills instantly, shield or not, as in the
original. Layered tissue banding, pulsing capillaries, parallax membranes.

**Fire modes** (`src/gunner.js`) — three ways to shoot, switchable mid-wave
with `M` and persisted:

- **MANUAL** — the original. Hold the fire key.
- **AUTO** — the gun never stops; you only ever have to fly.
- **AI ASSIST** — an expert gunner runs your guns. It is deliberately *not* a
  held trigger: it leads every shot off the target's measured per-frame
  velocity, checks the flight path against the flesh before spending a volley,
  counts each Option as an extra muzzle, holds fire when nothing is solvable
  to keep the shot budget free, and on the boss fires only when the shot will
  *arrive* inside the eye-open window. Measured over a full stage it clears
  with ~460 volleys where a held trigger uses ~1300, for the same score.

You still fly, dodge and manage the power meter in every mode.

**Enemies** — flapper squadrons (`sine` / `swoop` / `loop` / `strafe` / `curl`
/ `rush` / `dive`), red carrier squadrons, fast **rushers**, dividing
**splitters** (kill the big amoeba and it releases two small ones),
wall-mounted mouths, **hatches** that crack open and launch rusher flights,
**tentacles** that lash across the corridor, floor/ceiling duckers, drifting
spores, and the stage's signature **prominences**: erupting fire arcs that you
weave through (indestructible, scaled to the corridor width so tight sections
stay passable).

**Difficulty ramp** — the stage does not open at full strength. It arms itself
in four tiers keyed to world position (`TIERS` in `src/level1.js`,
`E.tier` in `src/enemies.js`):

| Tier | From | What changes |
| --- | --- | --- |
| 0 | 0 | **Nothing fires.** The opening formations attack by *flying at you* — fan turns, swoops, a pincer. Collision is the only danger in the air. Wall pods are present and visibly alive (the mouth still opens and closes) but dormant, teaching you what they are before they can hurt you. |
| 1 | 960 | Flyers arm: one aimed shot each, once in their life, never a stream. Pods stay silent — one new thing to read at a time. |
| 2 | 1900 | Wall pods wake up, single shots only, arriving just as the corridor narrows. |
| 3 | 3000 | Full strength: mouths spit three-way spreads, duckers fire bursts. |

Whether a flyer is armed is decided **when it spawns**, so a flight launched
during the silent opening stays unarmed for its whole life. Pods use a live
gate instead and keep their cycle running while dormant, so they are already
out of phase when they do wake rather than all opening up on the same frame.

Measured across a run, enemy shots per 500px band: `0 0 | 10 10 | 3 6 | 17 17 10`.

**The passability guarantee** — a tight section should be threading a needle,
never a wall with no door in it. The corridor's indestructible hazards —
erupting prominences and lashing tentacle arms — are sized against the gap
they sit in and always leave `MIN_LANE` (28px) of corridor open. An eruption
is launched from the apex it is allowed to reach rather than a raw speed
(`apex = v²/2g`), so it can never reach more than halfway into what is left
after reserving the lane. Two prominences on opposite walls firing on the same
frame therefore still cannot close the passage — and tight tunnels get short
fast jets while open caverns get tall dramatic ones, for free, because the
budget scales with the gap.

This is verified, not assumed. `scratchpad/feasible.js` sweeps the whole stage
as a 1D reachability problem: every frame it builds the set of survivable `y`
positions, dilates the previous frame's reachable set by the ship's top speed,
and intersects. If the reachable set ever empties, the stage is genuinely
impassable there — no reflexes could save it. It reports clean at **every**
speed level, with a 29px minimum lane.

It found two real ones: the prominence gauntlet at worldX 5135 and 5201 had
*no safe lane at all*, and an un-upgraded ship could not cross a closing
pocket at ~6690 (which is why base SPEED is 1.1, not 0.85 — the speed table's
first entry is a survivability floor, not just a feel knob).

**Formations & pacing** — the NES opening is reproduced as twelve rows of five
enemies over roughly 65 seconds. The first four alternate middle/top entry and
the remaining eight arrive in pairs. Every member follows the same exact
straight–diagonal–straight Z equation with frame-delayed spacing; no random
phase offsets can deform a row. Later shapes (`line`, `vee`, `column`,
`ladder`, `pincer`, `cross`, `dash`, and `rear`) use the same deterministic
formation machinery. Enemy phase, firing, and hazard variation come from a
stage-seeded generator, so a fresh run has identical timing every time.

**Boss** — a Golem-class organic mass in the sealed chamber. Armoured shell;
the eye core only opens periodically, and only shots lined up with the open
channel reach it. Enrages below 45% HP. ~18s fight with the base gun.

**Music** (`src/audio.js`) — a written-out arrangement rather than a bar loop.
Seven sections in A minor with their own chord progressions, four-bar melodic
phrases that answer each other, a bridge that lifts to the relative major,
per-section drum kits with fills on the turnarounds, and a separate boss
theme. Runs ~70s before repeating, and repeats past the intro rather than back
into it. Still synthesised at schedule time — no audio assets.

**Voxel view** (`src/voxel.js`) — see below.

**Death and recovery** — the stage keeps scrolling while the next life flies
in instead of rewinding to a Gradius checkpoint. Power is wiped, but equipped
Options turn green, drift slowly toward the left edge, and can be reclaimed by
touching them. 3 lives, score + persisted hi-score, chiptune WebAudio SFX.

**Score extends** — matching NES *Life Force*, the first extra life is awarded
at 10,000 points and another is awarded every 30,000 points afterward (40k,
70k, 100k, and so on). Crossing multiple thresholds with one large boss bonus
awards every life earned rather than skipping an extend.

Stage 1 runs about 3:45 including the boss, aligned to the NES reference's
roughly 3:48 transition into Stage 2.

**Stage 2** (`src/level2.js`) — a top-down volcanic ascent authored entirely
in world coordinates before play begins. Eleven five-ship opening squadrons
share fixed straight–diagonal–straight Z paths: three alternating single
origins followed by four mirrored pairs. Their members sample one squad path
at fixed 16px spacing rather than steering independently. Clearing all five
ships pays ten regular power capsules across the opening; the second-to-last
squad pays a blue Crash capsule that clears active enemies, shots and rocks.
Later fortress-approach squads add four more complete-row capsule rewards. Split-path
islands, destructible volcano peaks, rock storms and blast-through dirt gates
lead to Valis Fortress, where three shielded generators release no more than
four ricocheting energy marbles. Destroying all generators opens a scrolling
metal core passage into Cruiser Tetran's arena. Tetran has three independent
shield layers, a durable core and four lethal rotating arms. Defeating Golem
first sends the ship accelerating off the right edge, then rotates play into
the vertical stage.

**Stages 3–6** (`src/campaign.js`) — a deterministic continuation based on the
NES campaign structure:

- Prominence Inferno has six tight five-Phoenix power formations, alternating
  lava eruptions, continuous flame sections, red dragons, and Intruder's
  mouth weak point.
- Cellular Current accelerates through capillaries into lung sacs that release
  bouncing cells, rib hazards, and Giga's open-mouth fight with detachable
  homing eyes.
- Latis Temple opens with ten paired three-ship power waves, then hatches,
  rocks, moving pillars, destructible blocks, a three-core capsule-paying
  miniboss, and Tutanhamanattack's orbiting shield and eye weak point.
- Mechanical City combines blue/gold formations, crystal bombs, cannons,
  crossing barriers and mouth-gated Moai. Zelos Force requires destroying the
  circling dragon before the heart, followed by a high-speed barrier escape.

The campaign reference and source reconciliation are recorded in
`docs/life-force-reference.md`.

## The voxel view

The game starts in this view; press `V` to compare it with the original 2D
renderer. This is the **3dSen** technique, done from the inside.

That emulator renders NES games in 3D by pulling tiles out of the PPU and
extruding each into a slab of voxels — but it has to *guess* how deep each
tile class should sit, which is why it needs a hand-authored profile per game,
and it has to reverse-engineer sprites out of pattern tables. We do the same
extrusion and both hard parts disappear:

- **No depth guessing.** The sim already draws in named layers, so depth is a
  constant per layer (`LAYER` in `src/voxel.js`), not a research project.
- **No sprite reverse-engineering.** `src/sprites.js` already defines every
  sprite as a character grid, so a voxel model is that grid with the
  transparent cells dropped and the rest extruded. Edit the grids for the
  reskin and the voxel models change with them — no separate 3D art.

The corridor heightmap extrudes into a real tunnel; the boss, which has no
sprite grid, is voxelised from its ellipsoids directly.

The tunnel maintains 96 simulation pixels of overscan beyond each horizontal
edge. New wall columns are therefore generated outside the camera frustum and
old columns are retained until they have passed fully behind it; the player
never sees terrain appear or disappear at the viewport boundary.

**The simulation is untouched and stays authoritative.** Collision, hitboxes,
the power meter, the boss's eye-channel rule all still run in flat 256×224
space. The voxel layer only reads that state and draws it differently — which
is exactly why 3dSen works on games it was never designed for. The camera
lies; the game does not.

The WebGL drawing buffer follows the physical display resolution (with a 1080p
floor and 4K cap), so voxel edges stay crisp instead of stretching a fixed
1080p frame on high-DPI displays. Falls back to 2D with a message if the module
import fails.

## Layout

```
index.html
vendor/three.module.js   three.js r160, vendored (voxel view only)
src/core.js      constants, math, input (keyboard+touch+analog), THEME
src/sprites.js   pixel art as character grids — also the voxel model source
src/audio.js     WebAudio SFX + the multi-section stage & boss arrangements
src/fx.js        explosions, sparks, score pops, parallax background
src/terrain.js   corridor heightmap: authoring, collision, rendering
src/weapons.js   every projectile, player and enemy
src/gunner.js    MANUAL / AUTO / AI ASSIST fire modes
src/player.js    ship, power meter, Options
src/enemies.js   bestiary + prominences
src/boss.js      Stage 1 boss
src/level1.js    the spawn script: formation helpers + the wave table
src/level2.js    vertical terrain, formations, weapons, collision + Tetran
src/campaign.js  deterministic Stages 3–6, bosses, miniboss and final escape
src/touch.js     on-screen thumbstick and buttons
src/voxel.js     the three.js voxel view layer
src/game.js      director: states, scroll, collision, HUD, presentation
```

## Display

`NS.W`/`NS.H` (256×224) is the **simulation** resolution — every hitbox,
speed and terrain column is in these units, and it is also exactly how much
corridor you can see, so it is a gameplay constant. `NS.SCREEN_W`/`H`
(1920×1080) is the true edge-to-edge **16:9 presentation** target, scaled
dynamically to any window. Both the 2D fallback and the voxel HUD fill that
frame. The game requests fullscreen on the first keyboard or pointer gesture,
as browsers do not permit pages to enter fullscreen before user interaction.
The logical 256×224 drawing coordinates are transformed onto a native
1920×1080 backing surface, so UI fonts rasterize at output resolution rather
than being enlarged from six-pixel glyphs.

## Reskinning to Nephelim Squadron

Three places, in order of how much they matter:

1. **`NS.THEME` in `src/core.js`** — title, subtitle, ship name, stage name,
   boss name. All UI text reads from here.
2. **`src/sprites.js`** — every sprite is a character grid plus a palette;
   swap grids/palettes and nothing else changes. Terrain colours live in
   `CEIL_BANDS` (`src/terrain.js`), background tints in `FX.drawBackground`.
3. **`src/level1.js`** — the wave table is `[worldX, spawnFn]` pairs, sorted,
   built from the formation helpers at the top of the file. Retiming or
   reauthoring the stage means editing this one array; `KEYFRAMES` in
   `src/terrain.js` reshapes the corridor itself.

## Debug hook

Type `userspacechakra`, then press tilde/backquote to unlock and open the
concealed QA console. After it has been unlocked, tilde toggles it for the
rest of the page session. Opening the console freezes gameplay. It provides
encounter warps for all six stages, direct jumps to every boss and the Stage 5
miniboss, invincibility, full loadout and recovery controls, frame stepping,
enemy/bullet cleanup, boss damage controls, pickup spawning, live telemetry,
hitbox overlays, fullscreen, and 2D/voxel switching.

`NS.Game.step(n)` advances the simulation `n` frames and renders once — used
for automated smoke tests (browsers throttle `requestAnimationFrame` in hidden
tabs). `NS.Game.scrollX` can be set directly to jump around the stage; follow
it with `NS.Level1.seek(NS.Game.scrollX)` to resync the wave cursor and the
threat tier without spawning everything you skipped over. (`Level1.update()`
spawns as it advances — that is what you want per frame, not for a jump.)

## Notes / next steps

- Two-player co-op, rank/difficulty scaling, and the arcade continue flow
  are not implemented.
- AI ASSIST runs the guns only. It does not fly the ship or spend the power
  meter — dodging and build order stay yours.
- The voxel view is a fixed side-on camera with a slow drift. A free/
  orbitable camera would be a natural next step now the scene graph exists.
- Art is placeholder programmer pixel art, sized and shaped to the NES
  original's silhouettes so real assets can drop in at the same dimensions.
