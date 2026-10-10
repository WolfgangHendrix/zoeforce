# Zoe Force visual upgrade

Santi approved the four initial concepts 100% on September 28, 2026. The painted
2D upgrade is implemented locally, with six environment designs, separate
ships/enemies/bosses/UI, and smooth menu and world transitions. Open
`implementation/index.html` for actual-build captures and validation, and
`../../assets/art/index.html` for the asset library and replacement guide.

Open `index.html` for the delivery overview or `concepts/index.html` for the
interactive original/concept comparison. The four versioned concept PNGs and
their exact built-in imagegen prompts are saved together in `concepts/`.

## Browse and reuse the references

Open `reference/index.html` in a browser. It works directly from disk. The gallery
filters original 2D and voxel views and links each image at its original resolution.

- `reference/screens/`: individual PNGs, named by stage, UI state or encounter.
- `reference/contact-sheets/`: labeled 2D overviews for each stage, UI, details and touch layouts.
- `reference/videos/`: four WebM recordings of original menu, stage, boss and ending transitions.
- `reference/capture-index.json`: captions, viewports, debug setup, state metadata and source hashes.
- `reference/baseline.diff`: snapshot of the local source changes already present when capture began.
- `reference/validation-report.json`: coverage, image-size, pair-state and source-preservation checks.
- `reference/sprites/` and `reference/sprite-index.json`: 128 original transparent baked sprite frames with dimensions and anchors.

For a separate ChatGPT concept session, use the relevant contact sheet to explain
coverage, then attach the original PNG for the particular screen being redesigned.
The reference package contains real game renders. The concept gallery contains
generated proposals; they are not screenshots of an implemented upgrade.

## Capture method and practical limits

The capture script starts a loopback-only static server and creates a fresh browser
context. It uses existing stage jumps and simulation stepping. It does not modify
production scripts or normal player saves. Captures include invincibility and QA
unlocks where needed, with setup metadata recorded in the index.

Gameplay pairs preserve stage, scroll, player location, weapon and game state.
The voxel camera can frame that same scene differently. Screen-left means decreasing
X; screen-right means increasing X. Validate ship facing from rendered nose/exhaust,
not transform signs.

Videos are frame-stepped at a nominal 60 simulation frames/second and have no captured
audio. They document original screen changes, not hardware performance. They retain
a short boot lead-in so their origin and capture setup are visible. These captures
do not establish that a human can complete every stage or prove passability.

Re-run from the game folder:

```powershell
node docs/visual-upgrade/capture-reference.cjs
node docs/visual-upgrade/validate-reference.cjs
```

The script uses the existing Playwright installation in `neighborwars` and Sharp in
`SpaceChakra`; it downloads no packages. Individual sections can be refreshed with
`--only=ui`, `stage1` through `stage6`, `details`, `mobile`, `entrances`, `assets`, or `videos`.
Add `--append` to retain other sections. A full run creates a complete gallery.

## Concept review and next phases

The approved initial set is title/menu, HUD, Bio-Cathedral and Golem Ossuary. The original
five-slot power meter is preserved: SPEED, MISSILE, LASER, OPTION, FORCE. There is
no new ship-health system, extra upgrade slot, or changed collision geometry.

The intended look is painted 2D, Giger-inspired bone/metal/tissue architecture,
Life Force's organic corridor structure, and detailed machinery comparable to the
user's Contra: Shattered Soldier reference. Cyan friendly fire, warm hostile fire,
and subdued backgrounds keep gameplay readable.

The approved direction now covers all six levels, bosses, the triple-core guard,
fortress, major UI and entities. Production artwork lives under `assets/art/`
with a manifest and replacement guide covering dimensions, alpha, frame timing,
anchors and logical bounds. The renderer maps all 128 original sprite entries
to external painted images; the original grids remain for collision dimensions,
per-asset fallback and the unchanged voxel geometry. Most animation variants
share a painted pose in this production set; there is no new character animation sheet.

Painted 2D is the default; V retains the existing voxel view. Menus crossfade in
200 ms and world handoffs in 400 ms. The simulation rests during the fade;
Reduced Motion removes it. Menu input received during a fade is discarded and
held confirmation requires release. Stage cards now fade instead of repeatedly
blinking; Reduced Flash keeps boss warnings steady.

Validate from the game folder:

```powershell
node docs/visual-upgrade/verify-upgrade.cjs
node docs/visual-upgrade/run-gameplay-checks.cjs
```

The original `reference/` package is a historical baseline. Its preserved-source
report describes the capture phase, before the authorized visual implementation.
Re-running `capture-reference.cjs` against the upgraded build would overwrite
that baseline, so capture future upgrades into a separate directory.

The SpaceChakra listing, promotional clip, GitHub Patreon invitation and seven-day
promotion remain queued after the approved visual implementation is validated.
