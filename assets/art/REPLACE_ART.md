# Replacing Zoe Force art

The painted 2D renderer is the default. Everything in this folder is local and
works without an image service or API key. The original simulation and voxel
geometry remain in `src/sprites.js` and the gameplay modules.

## Find the image

| Folder | Contents |
| --- | --- |
| `backgrounds/` | Six stage panoramas, numbered and named by stage |
| `terrain/` | Six wall materials and the destructible temple block |
| `player/` | Side/top Seraph, cyan exhaust/bolt, missile, support drone, pickups |
| `enemies/` | Named flying enemies, wall units, cells, tentacle parts and hostile fire |
| `bosses/` | Six numbered/named bodies, open/closed core and Tetran arm |
| `projectiles/` | `boss-plasma-v2.png` and `fireball-v2.png`; exact prompts in `prompts.json` |
| `ui/` | Title background, transparent logo, blank menu/HUD/dialog frames |
| `sources/` | Original generated atlases, retained for future edits |

`manifest.json` lists every production image, its native dimensions and role.
Its `sprites` table maps all 128 original frame names to their external image,
logical dimensions, anchor and frame number. `manifest.js` is the matching
browser-readable version; plain script loading preserves offline `file://` use.
`production-prompts.json` records the exact built-in imagegen prompts.
The later projectile pass is recorded separately in `projectiles/prompts.json`.

## Projectile and pickup polish

`bossPlasma` and `fireball` in the manifest are standalone transparent PNGs.
Their originals live in `sources/`; `build-art.cjs` registers the production
files without overwriting them. `src/art.js` draws their compact heads and
cosmetic trails; `src/weapons.js` shares this painter across all six stages.
The first boss uses a 6-unit plasma head around its unchanged 4-unit hitbox;
normal shots use 4 units, prominence particles 5, fortress balls 10. Trails
point opposite velocity in screen coordinates and do not deal damage.
Projectile Clarity adds a dark backing and ivory outline. The highlight is
steady; Reduced Motion disables fireball rotation.

Loose Options use the existing drone PNG with a green tint and recovery marker.
`Game.driftOption` keeps drops in the visible corridor throughout death and for
90 simulation frames (1.5 seconds) after respawn, while they drift slowly.
After this window they can drift offscreen. No timeout removes a visible drop.
Collecting one directly restores an Option without advancing the power meter.
The meter retains gold for maxed upgrades; a cyan frame, pointer and underline
independently mark the selected slot, without flashing.

## Replace one asset

1. Open the named PNG you want to replace. Keep its canvas dimensions and
   transparent padding. Save a copy of the old image outside the production path.
2. Export your new art as PNG to that same filename. Use real alpha for ships,
   enemies, bosses, cores, logo and UI frames; opaque backgrounds and wall tiles
   do not need alpha. No black/checkerboard backdrop baked into a cutout.
3. Reload `index.html` and visit the relevant stage/screen. Use the local
   implementation gallery and concealed QA console for comparison.

Same-size replacement needs no code changes. If you change native dimensions,
update `images[id].width/height` and every matching `sprites[id].rect` in BOTH
manifest files. Keep logical dimensions/anchors unchanged unless you deliberately
want to redesign gameplay. A replacement manifest entry may point to its own PNG
to split currently shared animation variants into distinct painted frames.

## Direction, anchors and animation

- Screen-left is decreasing X; screen-right is increasing X.
- `seraph-side.png` has its nose on screen-right and engine on screen-left.
  `seraph-top.png` points toward screen-up. Hostile side-view fliers face screen-left.
- Sprite logical coordinates retain the original top-left placement and `cx/cy`
  anchors. Artwork is drawn directly from the high-resolution image into these
  bounds; it is never baked back down into a 9-pixel image.
- Existing two-frame timing, movement, recoil, banking, invulnerability and
  damage rules remain. Most two-frame variants share one detailed painted image
  in this first production set; distinct mouth/head and core states have separate
  artwork. There is no newly authored character animation sheet.
- The 256×224 simulation expands to a 1920×1080 target. Check the final rendered
  pixels: nonuniform expansion means a square source can appear wider onscreen.
- Enemy carrier glow and hit tint are renderer effects. Keep neutral body art
  in the file; do not permanently paint a damage flash into every frame.
- Boss cores are separate from bodies and follow the REAL collision targets.
  Golem's shell has a 5.5-logical-pixel presentation offset so its painted socket
  lines up with its original weak point. Keep that socket location when replacing
  its body, or adjust the visual offset in `src/art.js` after rendered validation.
- Tetran arms, Giga's detachable eyes, temple orbs, the final serpent/head and
  exposed heart still follow the existing encounter state. Some connectors,
  hazards, sparks, warning marks and shield outlines are drawn in Canvas.

## Backgrounds, walls and UI

Panoramas pan within a 15% overscan region; they do not need to tile. Keep the
central lane subdued, with cyan reserved for friendly energy and warm hostile
fire. Wall materials repeat at world scroll speed and are masked to actual
terrain bounds; make their edges seam-friendly and avoid a unique focal object.
Temple blocks, fortress plates and gates still use their existing hit geometry.

Keep UI frame interiors blank. Menu labels, power-slot labels, score, lives,
records, settings and confirmation messages are live text. The HUD has exactly
five slots: SPEED, MISSILE, LASER, OPTION, FORCE. There is no new health bar.

## Rebuild atlas extraction and verify

From the game folder:

```powershell
node docs/visual-upgrade/build-art.cjs
node docs/visual-upgrade/verify-upgrade.cjs
```

The first command REGENERATES the production sprite/UI/wall PNGs from `sources/`
and both manifests, so do not run it over individual hand-edited replacements
without saving them first. The generated UI sheet uses custom extraction regions
in the script; a newly arranged source atlas needs matching region changes.
Playwright and Sharp are reused from neighboring workspace projects; no packages
are downloaded. The second command checks rendering, transitions and asset
loading and refreshes actual-build screenshots. It is not a passability proof.

Menu transitions use 12 simulation ticks (200 ms), world handoffs 24 (400 ms).
`src/transitions.js` holds these defaults. Reduced Motion removes the fade;
confirmation input must be released before another menu action is accepted.
Missing image files fall back to the original drawing for that asset. The voxel
view remains based on the original pixel grids; painted PNG replacements affect
the 2D presentation only.
