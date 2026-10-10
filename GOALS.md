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
- [x] **Local pilot records.** Four profiles retain progression, firing style,
      career statistics and achievements; records are reachable from title and
      pause.
- [x] **Temple block fields.** Selected Stage 5 barriers now run three, four
      and five layers deep, hide limited capsules and rebuild behind the ship.

## 1. Make the campaign finishable

_Progress: complete._

- [x] **Continue flow.** Two continues per run, with a ten-second decision
      window. Continuing restarts the current stage with a fresh credit.
- [x] **Persist campaign progress.** Reaching a new stage saves the furthest
      stage through `S.write` and its visible save throbber.
- [x] **Stage select on the title screen**, gated by furthest stage reached.

## 2. Options and accessibility

_Progress: complete._

- [x] **Gameplay options.** Persisted 1–9 starting lives and a wall-damage
      toggle; nonlethal walls block the ship while preserving surface-parallel
      movement, without disabling enemy or active-hazard damage.
- [x] **Volume control.** Persisted master, music and SFX levels.
- [x] **Options menu** reachable from title and pause, hosting the above.
- [x] **Reduced-flash toggle.** Suppresses the boss-intro flash/shake, enemy
      and boss hit flashes, and the Stage 6 escape overlay.
- [x] **Key remapping.** Keyboard and gamepad bindings can be changed safely;
      assigning a used input swaps the conflicting action.

## 3. Ending and audio variety

_Progress: ending presentation and per-stage music are complete._

- [x] **Ending sequence.** Beating Zelos Force runs an accelerating lockdown
      escape into a silent-serial victory card.
- [x] **Per-stage music.** `STAGE_MUSIC` in `src/audio.js` reorders `SECTIONS`,
      transposes them and changes tempo per stage. The boss theme uses that
      stage's key.
- [x] **Victory / ending theme.** The Stage 6 lockdown stays silent. The clear
      card plays a slower, brighter loop of the main theme.

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

### Separately authorized visual upgrade — Sep 28

_Progress: santi approved the four concepts 100%. The painted production upgrade and its gallery are retained in `zoeforce2/`. This original `zoeforce/` runtime uses the earlier pixel/voxel presentation._

- [x] Capture all main UI states, six stages, bosses, special encounters, gameplay details and touch layouts in an isolated browser context.
- [x] Deliver original 2D/voxel pairs, transition recordings, contact sheets, a sprite inventory and source-baseline verification in `docs/visual-upgrade/`.
- [x] Generate title/menu, HUD, Bio-Cathedral and Golem Ossuary concepts with the built-in imagegen tool and provide before/after review controls.
- [x] Apply santi's concept feedback and obtain the requested approval before expanding the art direction.
- [x] Expand the approved direction into production designs for six environments, bosses, miniboss/fortress and main UI.
- [x] Implement painted 2D assets, external asset manifest/replacement guide, and smoother screen transitions; validate gameplay and desktop/mobile presentation. 15 browser checks and 46 gameplay checks pass, including a full six-stage CPU clear. Most animation variants share a painted pose in this first production set.
- [x] Polish boss shots and small fireballs; keep selected maxed upgrades gold with a separate cyan selection marker. Repair loose-Option edge loss during death/respawn across all six stages; add green recovery markers and remove the visible-drop timeout. 16 targeted checks pass, including rendered selection pixels and real death/recovery; 46 gameplay checks still pass with a full six-stage CPU clear. Review in `docs/visual-upgrade/combat-polish/`.

Real work, deliberately not scheduled yet.

- [ ] Rank / difficulty scaling.
- [ ] Two-player co-op.
- [ ] Free or orbitable voxel camera (currently fixed side-on with a drift).
- [ ] Replace placeholder pixel art in this original build. Its pixel sprites
      remain active; the painted replacements are used by `zoeforce2/`.
