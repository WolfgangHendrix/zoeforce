# Zoe Force — outstanding work

Ordered so each item unblocks or de-risks the ones after it. Player-facing
shell first (the game is unfinishable without it), then content depth, then
polish.

## Working agreement

**Whoever picks up an item updates this file in the same commit.** Mark the
item `[ ]` → `[~]` when you start and `[x]` when it lands, and keep the
_Progress_ line at the top of each section current. Keep notes short — one or
two sentences on where things stand, not a changelog. Detail belongs in the
commit message and the README.

Status key: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Completed supporting work

- [x] **Watermark-free CPU showcase.** A concealed debug-menu toggle runs a
      complete Stage 1–6 capture pass and stops on the final clear screen.

## 1. Make the campaign finishable

_Progress: complete._

- [x] **Continue flow.** Two continues per run, with a ten-second decision
      window. Continuing restarts the current stage with a fresh credit.
- [x] **Persist campaign progress.** Reaching a new stage saves the furthest
      stage through `S.write` and its visible save throbber.
- [x] **Stage select on the title screen**, gated by furthest stage reached.

## 2. Options and accessibility

_Progress: gameplay, volume and accessibility options complete; remapping remains._

- [x] **Gameplay options.** Persisted 1–9 starting lives and a wall-damage
      toggle; nonlethal walls block the ship while preserving surface-parallel
      movement, without disabling enemy or active-hazard damage.
- [x] **Volume control.** Persisted master, music and SFX levels.
- [x] **Options menu** reachable from title and pause, hosting the above.
- [x] **Reduced-flash toggle.** Suppresses the boss-intro flash/shake, enemy
      and boss hit flashes, and the Stage 6 escape overlay.
- [ ] **Key remapping.** Lower priority than the rest of this section.

## 3. Ending and audio variety

_Progress: not started._

- [ ] **Ending sequence.** Beating Zelos Force runs the escape and returns to
      title with no victory screen or credits.
- [ ] **Per-stage music.** `SECTIONS` (`src/audio.js`) drives everything from
      a named section order — vary order and transposition per stage rather
      than authoring six arrangements.
- [ ] **Victory / ending theme.**

## 4. Content depth for Stages 3–6

_Progress: Stage 4 repair and an environmental pacing pass are complete; full authoring remains._

- [x] **Repair Stage 4's opening combat.** Corrected seven outward-mirrored
      cell rows and softened the capillary scroll spike from 1.55× to 1.35×.
- [x] **Environmental pacing pass.** Filled quiet transitions in Stages 3–6;
      Stage 5 now follows its checkpoint with shoot-through masonry seals,
      breached route walls, pillars and embedded defenses.
- [ ] **Author the stages instead of generating them.** `src/campaign.js` is
      roughly 470 lines and still mixes authored phrases with generated loops
      across four stages, against the dedicated systems for Stages 1 and 2.
      Move toward per-stage wave tables and a terrain description like
      `KEYFRAMES`.
- [ ] **Pacing pass per stage** once the content is authored.

## 5. Verification

_Progress: not started._

- [ ] **Generalise the passability sweep.** `scratchpad/feasible.js` proves
      only Stage 1 crossable and found two genuine dead ends there. Stages
      2–6 have moving pillars, crossing barriers and rock storms with no such
      proof. Run it against every stage at every speed level.

## 6. Deferred

Real work, deliberately not scheduled yet.

- [ ] Rank / difficulty scaling.
- [ ] Two-player co-op.
- [ ] Free or orbitable voxel camera (currently fixed side-on with a drift).
- [ ] Replace placeholder programmer pixel art. Sprites are character grids in
      `src/sprites.js` sized to the NES silhouettes, so real assets drop in at
      the same dimensions and the voxel models follow automatically.
