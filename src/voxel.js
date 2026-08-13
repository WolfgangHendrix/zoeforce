/* voxel.js — the 3D view layer.

   This is the 3dSen trick, done from the inside. That emulator renders NES
   games in 3D by pulling tiles out of the PPU and extruding each one into a
   slab of voxels, then guessing a depth for every tile class from a
   hand-authored per-game profile.

   We do the same extrusion, but we own the source data, so both of the hard
   parts disappear:

     • No depth guessing. An emulator sees an undifferentiated wall of tiles.
       We already know what everything is, because the simulation draws in
       named layers — background, terrain, enemies, player, shots, effects.
       Depth is a constant per layer (LAYER below), not a research project.

     • No sprite reverse-engineering. src/sprites.js defines every sprite as
       a character grid baked to a canvas, so a voxel model is just that
       grid with the transparent cells dropped and the rest extruded. Edit
       the grids for the reskin and the voxel models change with them.

   The simulation is untouched and stays authoritative. Collision, hitboxes,
   the power meter, the boss's eye-channel rule — all of it still runs in
   256x224 two-dimensional space. This file only reads that state and draws
   it differently. The camera lies; the game does not.

   three.js is ESM-only, so it is pulled in with a dynamic import the first
   time the view is switched on. That import needs a real server — from a
   file:// URL it will fail, and we fall back to the 2D renderer with a
   message rather than breaking the game. */
(function (NS) {
  'use strict';

  var V = {};
  NS.Voxel = V;

  var THREE = null;
  var state = 'off';        // off | loading | on | failed
  var failMsg = '';

  var renderer, scene, camera, canvasEl;
  var keyLight = null, rimLight = null;
  var pools = {};           // sprite key -> InstancedMesh pool
  var terrainMesh = null, terrainDummy = null;
  var lightRig = null;
  var frame = 0;

  /* ---- the depth table -------------------------------------------------
     Z position and thickness per layer, in simulation pixels. This is the
     entire "profile" that 3dSen needs a human to author per game. */
  var LAYER = {
    backdrop:  { z: -150, d: 8 },
    terrain:   { z: -26,  d: 76 },   // deep, so the corridor reads as a tunnel
    hazard:    { z: 4,    d: 6 },
    enemy:     { z: 4,    d: 8 },
    capsule:   { z: 4,    d: 6 },
    player:    { z: 8,    d: 9 },
    shot:      { z: 8,    d: 4 },
    boss:      { z: 0,    d: 26 }
  };

  /* voxel edge length in sim pixels — 1 keeps sprite pixels square */
  var VOX = 1;

  /* ---- art direction ---------------------------------------------------
     Two hues per stage, and a rule about which layer may use which.

     `world` dresses the terrain and the backdrop. `accent` sits roughly 150
     degrees away and is reserved for the interactive layer — the rim light,
     the wet glints on the wall, and the halos on things you shoot. One hue
     plus black reads as a colour filter over the whole game; two hues, used
     with discipline about where each is allowed to appear, read as design.

     `sky` is the backdrop gradient, top to bottom, and it is also the fog
     colour, so the far end of the corridor dissolves into the backdrop
     instead of clipping against a black void.

     The stage 2 fortress and the mid-stage theme changes get their own
     entries, because the room changing colour is the point of them. */
  var PALETTE = {
    1:  { world: '#8d2a4a', accent: '#4fe6a0', sky: ['#46183a', '#0d0610'] },
    2:  { world: '#7d2e2a', accent: '#46c8ff', sky: ['#4a1c13', '#0e0708'] },
    '2f': { world: '#354f6b', accent: '#ffb347', sky: ['#21405e', '#060c16'] },
    3:  { world: '#9f2c12', accent: '#2fd4c4', sky: ['#551c0b', '#110605'] },
    4:  { world: '#7b294f', accent: '#9ce85a', sky: ['#42193a', '#0d0610'] },
    5:  { world: '#7b6a38', accent: '#6aa8ff', sky: ['#423a1e', '#0e0c0b'] },
    6:  { world: '#344b62', accent: '#ff8a3d', sky: ['#1d3850', '#050a12'] }
  };

  /* How far each depth slice of the wall falls off, against a base value
     already pulled well down from the flat art. The corridor is scenery: it
     has to lose the contrast fight with everything that can kill you. */
  var SLAB_FALLOFF = [1.0, 0.72, 0.50, 0.33];
  var WORLD_VALUE = 0.78;      // terrain lightness, as a fraction of the hue's
  var WORLD_SAT = 0.70;        // terrain saturation, likewise

  var palKey = null;           // which PALETTE entry is currently applied
  var pal = null;              // { slabs: [Color], accent: Color, ... }

  /* Deterministic per-column grain for the near face of the wall. A surface
     this large rendered at one flat value reads as painted scenery no matter
     how good the colour is; a few percent of variation per column gives it
     grain without touching the palette or costing a texture. */
  function grain(w) {
    var v = Math.sin(w * 12.9898) * 43758.5453;
    return 0.88 + 0.20 * (v - Math.floor(v));
  }

  function gradeWorld(hex) {
    var base = new THREE.Color(hex), hsl = {};
    base.getHSL(hsl);
    var slabs = [];
    for (var i = 0; i < SLAB_FALLOFF.length; i++) {
      var c = new THREE.Color();
      c.setHSL(hsl.h, hsl.s * WORLD_SAT, hsl.l * WORLD_VALUE * SLAB_FALLOFF[i]);
      slabs.push(c);
    }
    return slabs;
  }

  /* Which PALETTE entry a given frame wants. Stage 2 swaps to its fortress
     palette when the fortress phase starts, which is the only mid-stage
     change in the game. */
  function paletteFor(G) {
    if (G.stage === 2 && NS.Level2.phase === 'fortress') return '2f';
    return PALETTE[G.stage] ? G.stage : 1;
  }

  function applyPalette(key) {
    if (key === palKey) return;
    palKey = key;
    var entry = PALETTE[key] || PALETTE[1];
    pal = {
      slabs: gradeWorld(entry.world),
      accent: new THREE.Color(entry.accent),
      skyTop: new THREE.Color(entry.sky[0]),
      skyBottom: new THREE.Color(entry.sky[1])
    };
    if (scene) {
      /* The fog has to end on the colour the backdrop is actually painted
         where the two meet — the horizon, not the darkest corner of it.
         Fogging to the bottom tone turned the far corridor into a
         silhouette against a lighter sky, which is the opposite of the
         dissolve we want. */
      pal.fog = pal.skyBottom.clone().lerp(pal.skyTop, 0.42);
      scene.fog.color.copy(pal.fog);
      scene.background.copy(pal.skyBottom);
    }
    if (rimLight) rimLight.color.copy(pal.accent);
    if (keyLight) keyLight.color.setHex(0xfff2e6);
    paintBackdrop();
  }

  V.active = function () { return state === 'on'; };
  V.status = function () { return state; };
  V.error = function () { return failMsg; };

  /* ======================================================================
     Sprite -> voxel model
     ====================================================================== */

  /* Read a baked sprite canvas back to pixels and build one merged
     geometry: a box per opaque pixel, coloured by that pixel. Sprites are
     tiny (at most 16x12), so a merged geometry per sprite is cheap and
     lets a whole sprite type draw as one instanced call. */
  function buildSpriteGeometry(canvas, depth, round, mono) {
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d');
    var img;
    try {
      img = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return null;                       // tainted canvas; should not happen
    }

    var positions = [], colors = [], normals = [], indices = [];
    var base = new THREE.BoxGeometry(VOX, VOX, depth);
    var bp = base.attributes.position.array;
    var bn = base.attributes.normal.array;
    var bi = base.index.array;
    var vertsPerBox = base.attributes.position.count;

    /* Round sprites (see ROUND) are discs in the 2D art, and a disc extruded
       at one constant depth is a cylinder — an orb seen edge-on reads as a
       puck. Give every column the depth of the sphere chord at its distance
       from the centre instead, so the same pixel grid bulges into a ball. */
    var radius = round ? spriteRadius(img, w, h) : 0;

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (img[i + 3] < 40) continue;   // transparent cell — no voxel

        var r = img[i] / 255, g = img[i + 1] / 255, b = img[i + 2] / 255;
        /* A tintable pool bakes luminance instead of colour, so the
           per-instance tint multiplies to exactly the requested hue while the
           sprite keeps its own internal shading. */
        if (mono) {
          var lum = 0.299 * r + 0.587 * g + 0.114 * b;
          /* lift the floor so the darkest cells still take the tint rather
             than staying near-black whatever colour is asked for */
          lum = 0.45 + lum * 0.55;
          r = g = b = lum;
        }
        /* sprite space is y-down; three is y-up, so flip within the sprite */
        var ox = x - w / 2 + 0.5;
        var oy = -(y - h / 2 + 0.5);
        var vstart = positions.length / 3;

        /* z scale relative to the flat extrusion: 1 at the centre, tapering
           to a single voxel at the rim */
        var zs = 1;
        if (round) {
          var q = Math.min(1, Math.hypot(ox, oy) / radius);
          var chord = radius * Math.sqrt(1 - q * q) * 2;
          zs = Math.max(VOX, chord) / depth;
        }

        for (var v = 0; v < vertsPerBox; v++) {
          var vx = bp[v * 3] + ox, vy = bp[v * 3 + 1] + oy;
          var vz = bp[v * 3 + 2] * zs;
          positions.push(vx, vy, vz);
          /* on a ball, the outward direction from the centre *is* the normal;
             that shades it round while the silhouette stays voxel-stepped */
          var nl = round ? Math.hypot(vx, vy, vz) : 0;
          if (nl > 1e-4) normals.push(vx / nl, vy / nl, vz / nl);
          else normals.push(bn[v * 3], bn[v * 3 + 1], bn[v * 3 + 2]);
          colors.push(r, g, b);
        }
        for (var k = 0; k < bi.length; k++) indices.push(bi[k] + vstart);
      }
    }
    base.dispose();
    if (!positions.length) return null;

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }

  /* Radius of the opaque part of a sprite, in sprite pixels, measured from
     its centre. The half-voxel reach of the outermost cell counts, so the rim
     keeps a little thickness rather than tapering to nothing. */
  function spriteRadius(img, w, h) {
    var best = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (img[(y * w + x) * 4 + 3] < 40) continue;
        var d = Math.hypot(x - w / 2 + 0.5, y - h / 2 + 0.5);
        if (d > best) best = d;
      }
    }
    return best + 0.5 || 1;
  }

  /* Sprites drawn as spheres rather than flat extrusions: the option orbs
     (and their loose, uncollected form), the enemy fireballs, and every
     campaign boss part the 2D renderer draws with arc(). Matched by pool key
     prefix so every call site agrees without having to pass a flag. */
  var ROUND = /^(option|looseOption|eshot)/;

  /* An instanced pool for one sprite. Pools grow on demand and are reset
     each frame; unused instances are parked off-screen.

     `tint` makes the pool tintable: the geometry bakes luminance and each
     instance carries its own colour. Several campaign bosses are drawn from
     the same stand-in sprite, so without this they all inherit that sprite's
     palette — which is why they were all purple. */
  function pool(key, canvas, depth, cap, tint, glow) {
    var p = pools[key];
    if (p) return p;
    var geo = buildSpriteGeometry(canvas, depth, ROUND.test(key), !!tint);
    if (!geo) { pools[key] = { mesh: null, used: 0, cap: 0 }; return pools[key]; }
    /* GLOW marks the gameplay layer: shots, pickups, weak points. Those are
       drawn unlit, so they keep their full painted brightness while the lit
       world around them sits in shadow. After the ambient cut that one flag
       is what makes the things that matter the brightest pixels on screen —
       no post-processing, no bloom pass, no per-frame cost. */
    var mat = glow
      ? new THREE.MeshBasicMaterial({ vertexColors: true })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
    var n = cap || 96;
    var mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (tint) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = key;                     // so pools are identifiable when debugging
    scene.add(mesh);
    p = pools[key] = { mesh: mesh, used: 0, cap: n, tinted: !!tint };
    return p;
  }

  /* '#rrggbb' -> a reusable THREE.Color, so call sites can name the same
     colour string the 2D renderer uses and the two cannot drift apart */
  var tintCache = {};
  function asColor(hex) {
    var c = tintCache[hex];
    if (!c) c = tintCache[hex] = new THREE.Color(hex);
    return c;
  }

  var dummy = null;

  /* Place one sprite instance. Sim coordinates in, world coordinates out. */
  function place(key, canvas, x, y, layer, opt) {
    opt = opt || {};
    var L = LAYER[layer] || LAYER.enemy;
    var p = pool(key, canvas, opt.depth || L.d, opt.cap, opt.tint, opt.glow);
    if (!p.mesh || p.used >= p.cap) return;

    dummy.position.set(
      x + canvas.width / 2,
      simY(y + canvas.height / 2),
      (opt.z != null ? opt.z : L.z)
    );
    dummy.rotation.set(opt.rx || 0, opt.ry || 0, opt.rz || 0);
    dummy.scale.set(opt.sx || 1, opt.sy || 1, opt.sz || 1);
    dummy.updateMatrix();
    if (p.tinted) p.mesh.setColorAt(p.used, asColor(opt.tint || '#ffffff'));
    p.mesh.setMatrixAt(p.used++, dummy.matrix);
  }

  /* Sprite pools bake their material on first use, so damage instances need
     a distinct key. Clone the small options object and tint it red without
     mutating the caller's normal rendering setup. */
  function placeDamage(key, canvas, x, y, layer, target, opt) {
    var kick = NS.hitOffset(target);
    x += kick.x; y += kick.y;
    if (!NS.damageFlashing(target)) { place(key, canvas, x, y, layer, opt); return; }
    var flashOpt = {}, k;
    opt = opt || {};
    for (k in opt) if (Object.prototype.hasOwnProperty.call(opt, k)) flashOpt[k] = opt[k];
    flashOpt.tint = NS.DAMAGE_FLASH_COLOR;
    flashOpt.glow = true;
    place(key + 'Hit', canvas, x, y, layer, flashOpt);
  }

  /* sim y is measured downward from the top of the screen */
  function simY(y) { return NS.PLAYFIELD_H - y; }

  /* place() anchors a sprite by its top-left corner, which is what the flat
     renderer's blits use. Anything sized by its bounding box — a 46px beam,
     a missile turned to face its wall — wants its centre instead. */
  function placeAt(key, canvas, cx, cy, layer, opt) {
    place(key, canvas, cx - canvas.width / 2, cy - canvas.height / 2, layer, opt);
  }

  /* One placer for every player projectile, whichever list it came from.
     The three world renderers each carried their own copy of this and they
     had drifted apart: stage 2 drew its laser as a stretched normal shot,
     and its flat view painted yellow rectangles while its voxel view drew
     stage 1's blue sprite. Now all three ask this. */
  function placeShot(p) {
    var cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    var vertical = p.h > p.w;
    var contrast = NS.projectileContrast();

    if (p.type === 'missile') {
      if (contrast) placeAt('missileHalo', NS.S.missile, cx, cy, 'shot',
              { rz: -NS.Weapons.missileAngle(p), sx: 1.55, sy: 1.55, sz: 1.3,
                cap: 64, glow: true, tint: '#ffffff', z: LAYER.shot.z - 1 });
      placeAt('missile', NS.S.missile, cx, cy, 'shot',
              { rz: -NS.Weapons.missileAngle(p), rx: p.anim * 0.3,
                cap: 64, glow: true });
      return;
    }
    if (p.type === 'laser') {
      /* the sprite is 6px long, so sx carries the beam's real length; the
         model is centred on the beam rather than parked at its leading end */
      if (contrast) placeAt('laserHalo', NS.S.shot, cx, cy, 'shot',
              { rz: vertical ? Math.PI / 2 : 0,
                sx: (vertical ? p.h : p.w) / 6, sy: 3.2, sz: 3.2,
                cap: 48, glow: true, tint: '#ffffff', z: LAYER.shot.z - 1 });
      placeAt('laserSeg', NS.S.shot, cx, cy, 'shot',
              { rz: vertical ? Math.PI / 2 : 0,
                sx: (vertical ? p.h : p.w) / 6, sy: 2, sz: 2,
                cap: 48, glow: true });
      return;
    }
    if (contrast) placeAt('shotHalo', NS.S.shot, cx, cy, 'shot',
            { rz: vertical ? Math.PI / 2 : 0, sx: 1.4, sy: 1.8, sz: 2.2,
              cap: 128, glow: true, tint: '#ffffff', z: LAYER.shot.z - 1 });
    placeAt('shot', NS.S.shot, cx, cy, 'shot',
            { rz: vertical ? Math.PI / 2 : 0, sz: 1.5, cap: 128, glow: true });
  }

  /* three.js only multiplies instanceColor into the shaded colour when the
     material declares vertexColors, and that path reads a per-vertex `color`
     attribute which defaults to black when the geometry has none. So every
     instanced-colour mesh needs both: the flag, and a white attribute for it
     to multiply. Without this the tint is silently dropped and the mesh
     renders in the material's flat white — which is what the corridor walls,
     the background motes and every explosion particle were doing. */
  function whiteColors(geo) {
    var n = geo.attributes.position.count;
    var c = new Float32Array(n * 3);
    for (var i = 0; i < c.length; i++) c[i] = 1;
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    return geo;
  }

  /* ======================================================================
     Procedural voxel primitives

     The bosses are the one part of the game with no sprite grid behind them:
     2D draws them from ellipses, rectangles and arcs, so there is nothing to
     extrude. They were all standing in the same purple `spore` sprite scaled
     to different sizes, which is why they read as a different creature in
     this view than in the flat one. These build the same primitives the 2D
     renderer uses, out of cubes, and take the same hex strings — so the two
     silhouettes are the same shape in the same colours by construction.
     ====================================================================== */
  var primPools = {};
  var primOffsetX = 0, primOffsetY = 0;

  function primPool(key, build, cap, glow) {
    var p = primPools[key];
    if (p) return p;
    var geo = build();
    if (!geo) { primPools[key] = { mesh: null, used: 0, cap: 0 }; return primPools[key]; }
    whiteColors(geo);
    var n = cap || 8;
    var mesh = new THREE.InstancedMesh(
      geo, glow ? new THREE.MeshBasicMaterial({ vertexColors: true })
                : new THREE.MeshLambertMaterial({ vertexColors: true }), n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = key;
    scene.add(mesh);
    p = primPools[key] = { mesh: mesh, used: 0, cap: n };
    return p;
  }

  /* Geometry is built once per key from the dimensions of the first call, so
     a key must always be asked for the same size; anything that animates its
     size does it through opt.sx/sy/sz. */
  function putPrim(p, x, y, z, tint, o) {
    if (!p.mesh || p.used >= p.cap) return;
    o = o || {};
    dummy.position.set(x + primOffsetX, simY(y + primOffsetY), z);
    dummy.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    dummy.scale.set(o.sx || 1, o.sy || 1, o.sz || 1);
    dummy.updateMatrix();
    p.mesh.setColorAt(p.used, asColor(tint || '#ffffff'));
    p.mesh.setMatrixAt(p.used++, dummy.matrix);
  }

  function vbox(key, x, y, z, w, h, d, tint, o) {
    putPrim(primPool('B:' + key,
      function () { return new THREE.BoxGeometry(w, h, d); },
      o && o.cap, o && o.glow), x, y, z, tint, o);
  }

  function vell(key, x, y, z, rx, ry, rz, tint, o) {
    putPrim(primPool('E:' + key,
      function () { return ellipsoidGeometry(rx, ry, rz, Math.max(1, Math.min(3, rx / 4))); },
      o && o.cap, o && o.glow), x, y, z, tint, o);
  }

  function vball(key, x, y, z, r, tint, o) { vell(key, x, y, z, r, r, r, tint, o); }

  /* A ring of cubes, which is how the flat renderer's stroked circles (boss
     shields, core halos) survive the trip into a world made of boxes. */
  function vring(key, x, y, z, radius, cube, tint, seg, phase, cap, glow) {
    for (var i = 0; i < seg; i++) {
      var a = (i / seg) * Math.PI * 2 + phase;
      vbox(key, x + Math.cos(a) * radius, y + Math.sin(a) * radius, z,
           cube, cube, cube, tint, { rz: -a, cap: cap || seg + 2, glow: glow });
    }
  }

  function beginFrame() {
    var k;
    for (k in pools) if (pools.hasOwnProperty(k)) pools[k].used = 0;
    for (k in primPools) if (primPools.hasOwnProperty(k)) primPools[k].used = 0;
  }
  function flushPools(map) {
    for (var k in map) {
      if (!map.hasOwnProperty(k)) continue;
      var p = map[k];
      if (!p.mesh) continue;
      p.mesh.count = p.used;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
  }
  function endFrame() { flushPools(pools); flushPools(primPools); }

  /* ======================================================================
     Terrain — the heightmap becomes a real tunnel
     ====================================================================== */
  /* Perspective reveals more than the nominal 256px simulation rectangle.
     Keep real world columns well beyond both edges so the player never sees
     the tunnel being populated on the right or removed on the left. */
  var TERRAIN_MARGIN = 96;
  var TERRAIN_COLS = NS.W + TERRAIN_MARGIN * 2;
  var TERRAIN_SLABS = 4;           // depth slices, so the walls have relief

  function buildTerrain() {
    var geo = whiteColors(new THREE.BoxGeometry(1, 1, 1));
    var mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    var count = TERRAIN_COLS * 2 * TERRAIN_SLABS;
    terrainMesh = new THREE.InstancedMesh(geo, mat, count);
    terrainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    terrainMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(count * 3), 3);
    terrainMesh.frustumCulled = false;
    scene.add(terrainMesh);
    terrainDummy = new THREE.Object3D();
  }

  function updateTerrain(scrollX, time) {
    if (!terrainMesh) return;
    var n = 0;
    var col = new THREE.Color();
    var pulse = Math.sin(time * 0.04) * 0.5 + 0.5;

    for (var ci = 0; ci < TERRAIN_COLS; ci++) {
      var sx = ci - TERRAIN_MARGIN;
      var wx = (scrollX + sx) | 0;
      var ty = NS.Terrain.topAt(wx);
      var by = NS.Terrain.botAt(wx);

      for (var s = 0; s < TERRAIN_SLABS; s++) {
        var slabD = LAYER.terrain.d / TERRAIN_SLABS;
        var z = LAYER.terrain.z + slabD * (s + 0.5);
        /* deeper slices pull back from the corridor mouth, so the tunnel
           visibly opens away from the camera instead of being a flat box */
        var inset = s * 1.6;
        var t = pal.slabs[s];

        // ceiling slab
        var ch = ty + inset;
        if (ch > 0.5) {
          terrainDummy.position.set(sx + 0.5, simY(ch / 2), z);
          terrainDummy.scale.set(1.02, ch, slabD * 0.98);
          terrainDummy.updateMatrix();
          terrainMesh.setMatrixAt(n, terrainDummy.matrix);
          col.copy(t);
          if (s < 2) col.multiplyScalar(grain(wx + s * 37));
          /* the wet glints are where the stage's second hue touches the
             world layer — sparse, on the near face only, and never bright
             enough to be mistaken for something you can shoot */
          if (s === 0 && ((wx * 7) & 255) > 232) {
            col.lerp(pal.accent, 0.16 + 0.13 * pulse);
          }
          terrainMesh.setColorAt(n, col);
          n++;
        }

        // floor slab
        var fy = by - inset;
        var fh = NS.PLAYFIELD_H - fy;
        if (fh > 0.5) {
          terrainDummy.position.set(sx + 0.5, simY(fy + fh / 2), z);
          terrainDummy.scale.set(1.02, fh, slabD * 0.98);
          terrainDummy.updateMatrix();
          terrainMesh.setMatrixAt(n, terrainDummy.matrix);
          col.copy(t);
          if (s < 2) col.multiplyScalar(grain(wx * 1.7 + s * 91));
          if (s === 0 && ((wx * 13) & 255) > 236) {
            col.lerp(pal.accent, 0.16 + 0.13 * pulse);
          }
          terrainMesh.setColorAt(n, col);
          n++;
        }
      }
    }
    terrainMesh.count = n;
    terrainMesh.instanceMatrix.needsUpdate = true;
    if (terrainMesh.instanceColor) terrainMesh.instanceColor.needsUpdate = true;
  }

  /* The ascent crosses from volcanic rock into the fortress, so it needs both
     palettes on screen at once: the wall ahead has already changed colour
     while the wall behind the ship has not. */
  var rockSlabs = null, fortSlabs = null;
  function updateTerrain2(scrollY, time) {
    if (!terrainMesh) return;
    if (!fortSlabs) {
      rockSlabs = gradeWorld(PALETTE[2].world);
      fortSlabs = gradeWorld(PALETTE['2f'].world);
    }
    var n = 0, col = new THREE.Color();
    for (var sy = -TERRAIN_MARGIN; sy < NS.PLAYFIELD_H + TERRAIN_MARGIN; sy++) {
      var wy = scrollY + NS.PLAYFIELD_H - sy;
      var edge = NS.Level2.edgesAt(wy);
      var fortress = wy > NS.Level2.FORTRESS_Y;
      for (var s = 0; s < TERRAIN_SLABS; s++) {
        var slabD = LAYER.terrain.d / TERRAIN_SLABS;
        var z = LAYER.terrain.z + slabD * (s + 0.5);
        var inset = s * 1.3;
        col.copy((fortress ? fortSlabs : rockSlabs)[s]);
        if (s < 2) col.multiplyScalar(grain(wy + s * 53));
        var lw = Math.max(1, edge.left + inset + TERRAIN_MARGIN);
        terrainDummy.position.set((edge.left + inset - TERRAIN_MARGIN) / 2, simY(sy + 0.5), z);
        terrainDummy.scale.set(lw, 1.03, slabD * 0.98); terrainDummy.updateMatrix();
        terrainMesh.setMatrixAt(n, terrainDummy.matrix);
        terrainMesh.setColorAt(n++, col);
        var rw = Math.max(1, edge.right + inset + TERRAIN_MARGIN);
        terrainDummy.position.set(NS.W + (TERRAIN_MARGIN - edge.right - inset) / 2, simY(sy + 0.5), z);
        terrainDummy.scale.set(rw, 1.03, slabD * 0.98); terrainDummy.updateMatrix();
        terrainMesh.setMatrixAt(n, terrainDummy.matrix); terrainMesh.setColorAt(n++, col);
      }
    }
    terrainMesh.count = n; terrainMesh.instanceMatrix.needsUpdate = true;
    if (terrainMesh.instanceColor) terrainMesh.instanceColor.needsUpdate = true;
  }

  function updateCampaignTerrain(C) {
    if (!terrainMesh) return;
    var n=0,col=new THREE.Color(),slabs=pal.slabs;
    if(C.horizontal()){
      for(var sx=-TERRAIN_MARGIN;sx<NS.W+TERRAIN_MARGIN;sx++){
        var b=C.bounds(C.scroll+sx);
        for(var s=0;s<TERRAIN_SLABS;s++){
          var d=LAYER.terrain.d/TERRAIN_SLABS,z=LAYER.terrain.z+d*(s+.5),inset=s*1.2;
          var th=b.a+inset;terrainDummy.position.set(sx+.5,simY(th/2),z);terrainDummy.scale.set(1.03,th,d*.98);terrainDummy.updateMatrix();terrainMesh.setMatrixAt(n,terrainDummy.matrix);col.copy(slabs[s]);if(s<2)col.multiplyScalar(grain(C.scroll+sx+s*53));terrainMesh.setColorAt(n++,col);
          var bh=NS.PLAYFIELD_H-b.z+inset;terrainDummy.position.set(sx+.5,simY(b.z+bh/2),z);terrainDummy.scale.set(1.03,bh,d*.98);terrainDummy.updateMatrix();terrainMesh.setMatrixAt(n,terrainDummy.matrix);terrainMesh.setColorAt(n++,col);
        }
      }
    }else{
      for(var sy=-TERRAIN_MARGIN;sy<NS.PLAYFIELD_H+TERRAIN_MARGIN;sy++){
        b=C.bounds(C.scroll+NS.PLAYFIELD_H-sy);
        for(s=0;s<TERRAIN_SLABS;s++){
          d=LAYER.terrain.d/TERRAIN_SLABS;z=LAYER.terrain.z+d*(s+.5);inset=s*1.2;
          var lw=b.a+inset+TERRAIN_MARGIN;terrainDummy.position.set((b.a+inset-TERRAIN_MARGIN)/2,simY(sy+.5),z);terrainDummy.scale.set(lw,1.03,d*.98);terrainDummy.updateMatrix();terrainMesh.setMatrixAt(n,terrainDummy.matrix);col.copy(slabs[s]);if(s<2)col.multiplyScalar(grain(C.scroll+NS.PLAYFIELD_H-sy+s*53));terrainMesh.setColorAt(n++,col);
          var rw=NS.W-b.z+inset+TERRAIN_MARGIN;terrainDummy.position.set(NS.W+(TERRAIN_MARGIN-(NS.W-b.z)-inset)/2,simY(sy+.5),z);terrainDummy.scale.set(rw,1.03,d*.98);terrainDummy.updateMatrix();terrainMesh.setMatrixAt(n,terrainDummy.matrix);terrainMesh.setColorAt(n++,col);
        }
      }
    }
    terrainMesh.count=n;terrainMesh.instanceMatrix.needsUpdate=true;if(terrainMesh.instanceColor)terrainMesh.instanceColor.needsUpdate=true;
  }

  /* ======================================================================
     Scene assembly
     ====================================================================== */
  function buildScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);
    scene.fog = new THREE.Fog(0x05060a, 210, 460);

    dummy = new THREE.Object3D();

    /* The fov here is only a seed: frameCorridor() rewrites the projection
       from the corridor's own corners every frame. The camera sits slightly
       above and to the side of dead-on, which is the whole point: that
       offset is what reveals the depth the extrusion just created. */
    camera = new THREE.PerspectiveCamera(42, 16 / 9, 1, 900);
    camera.position.set(NS.W * 0.5 - 6, NS.PLAYFIELD_H * 0.5 + 14, 268);
    camera.lookAt(NS.W * 0.5, NS.PLAYFIELD_H * 0.5, -10);
    frameCorridor();

    /* ---- the light rig ------------------------------------------------
       The old rig was a white key over an ambient of 1.5, and that ambient
       was the whole problem: it filled in exactly the shadows that describe
       a cube's form, so every model rendered as a flat silhouette in its own
       colour. Voxel work lives or dies on the shading across faces.

       So: ambient down to a quarter of what it was, a warm key doing the
       modelling, and — the part that actually matters — a rim light behind
       and below in the stage's accent hue. A rim draws a bright edge along
       every cube silhouette facing away from the key, and that edge is the
       difference between a blob and a sculpted object. It is also where the
       stage's second hue enters the picture, on the geometry rather than on
       a filter over it. */
    lightRig = new THREE.Group();
    keyLight = new THREE.DirectionalLight(0xfff2e6, 2.4);
    keyLight.position.set(0.45, 0.85, 0.9);
    lightRig.add(keyLight);
    var fill = new THREE.DirectionalLight(0x5f86c8, 0.40);
    fill.position.set(-0.9, -0.2, 0.45);
    lightRig.add(fill);
    rimLight = new THREE.DirectionalLight(0x4fe6a0, 1.75);
    rimLight.position.set(-0.55, -0.75, -1.0);
    lightRig.add(rimLight);
    scene.add(lightRig);
    /* a quarter of the old ambient: enough that an unlit face is still
       readable, far too little to fill in the shading that describes it */
    scene.add(new THREE.AmbientLight(0x33405e, 0.58));

    /* a warm point light riding with the ship, so the corridor lights up
       around you as you move through it */
    V.shipLight = new THREE.PointLight(0xffd0a0, 120, 150, 2);
    scene.add(V.shipLight);

    buildTerrain();
    buildBackdrop();
  }

  /* ---- backdrop --------------------------------------------------------
     Without this the tunnel hangs in a black void. The 2D renderer paints a
     deep tissue gradient with drifting motes behind the corridor; here that
     becomes a far wall plus a parallax field of voxel motes between it and
     the corridor, which is what gives the gap real distance. */
  var backWall = null, moteMesh = null, moteDummy = null, motes = [];
  var MOTE_COUNT = 150;

  function buildBackdrop() {
    /* A flat dark plate here left the centre of every frame reading as pure
       black — objects in a void rather than a place. A vertical gradient in
       the stage palette costs one extra attribute and gives the corridor
       something to sit in front of; the fog is set to the same bottom colour
       so distant geometry dissolves into it instead of ending on an edge. */
    var geo = new THREE.PlaneGeometry(NS.W * 3.2, NS.PLAYFIELD_H * 3.2, 1, 12);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(
      new Float32Array(geo.attributes.position.count * 3), 3));
    /* fog:false is load-bearing. This plane sits ~450 units out, well past
       the fog's far distance, so with fog on it was being washed entirely to
       the fog colour and the gradient never appeared — the void stayed black
       no matter what was painted into it. */
    backWall = new THREE.Mesh(geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    backWall.position.set(NS.W * 0.5, NS.PLAYFIELD_H * 0.5, LAYER.backdrop.z - 30);
    scene.add(backWall);
    paintBackdrop();

    var rng = NS.makeRng(0xC0FFEE);
    motes.length = 0;
    for (var i = 0; i < MOTE_COUNT; i++) {
      motes.push({
        x: rng() * NS.W * 1.4 - NS.W * 0.2,
        y: rng() * NS.PLAYFIELD_H,
        z: LAYER.backdrop.z + rng() * 110,
        s: 0.8 + rng() * 2.4,
        p: rng() * 6.28,
        c: rng() < 0.34 ? 0x7fd4ff : (rng() < 0.5 ? 0xffb9d0 : 0xc8a0d8)
      });
    }
    moteMesh = new THREE.InstancedMesh(
      whiteColors(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      MOTE_COUNT
    );
    moteMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MOTE_COUNT * 3), 3);
    moteMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    moteMesh.frustumCulled = false;
    scene.add(moteMesh);
    moteDummy = new THREE.Object3D();
  }

  /* Repaint the gradient into the plane's vertex colours. Called once per
     palette change, never per frame. */
  function paintBackdrop() {
    if (!backWall || !pal) return;
    var pos = backWall.geometry.attributes.position;
    var col = backWall.geometry.attributes.color;
    var h = NS.PLAYFIELD_H * 3.2, mix = new THREE.Color();
    for (var i = 0; i < pos.count; i++) {
      /* The plane is 3.2x the playfield so it still covers the frame from
         180 units back, which means only its middle ~55% is ever on screen.
         Ramping across the whole plane therefore produced a near-constant
         mid-tone — a flat wash, not a gradient. Compress the ramp into the
         band that is actually visible and it reads as a lit space. */
      var v = pos.getY(i) / h + 0.5;
      var u = NS.clamp((v - 0.22) / 0.56, 0, 1);
      mix.copy(pal.skyBottom).lerp(pal.skyTop, Math.pow(u, 1.35));
      col.setXYZ(i, mix.r, mix.g, mix.b);
    }
    col.needsUpdate = true;
  }

  function updateBackdrop(scroll, vertical) {
    if (!moteMesh) return;
    var col = new THREE.Color();
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      /* parallax: the nearer a mote sits to the corridor, the faster it
         slides past, which is what sells the empty middle as depth */
      var par = 0.10 + (m.z - LAYER.backdrop.z) / 110 * 0.5;
      var x = m.x;
      var y = m.y;
      if (vertical) {
        /* The camera travels upward in Stage 2, so distant stars cross the
           screen downward. Wrap beyond both vertical frustum margins. */
        y = m.y + (scroll * par) % (NS.PLAYFIELD_H * 1.6);
        if (y > NS.PLAYFIELD_H * 1.3) y -= NS.PLAYFIELD_H * 1.6;
      } else {
        x = m.x - (scroll * par) % (NS.W * 1.6);
        if (x < -NS.W * 0.3) x += NS.W * 1.6;
      }
      m.p += 0.01;
      moteDummy.position.set(x, simY(y + Math.sin(m.p) * 2), m.z);
      moteDummy.scale.set(m.s, m.s, m.s);
      moteDummy.rotation.set(m.p * 0.3, m.p * 0.2, 0);
      moteDummy.updateMatrix();
      moteMesh.setMatrixAt(i, moteDummy.matrix);
      /* background dust is scenery: held well down so it cannot be confused
         with a pickup or a bullet at a glance */
      col.setHex(m.c).multiplyScalar(0.42);
      moteMesh.setColorAt(i, col);
    }
    moteMesh.count = motes.length;
    moteMesh.instanceMatrix.needsUpdate = true;
    if (moteMesh.instanceColor) moteMesh.instanceColor.needsUpdate = true;
  }

  /* ======================================================================
     Per-frame: read the simulation, draw it as voxels
     ====================================================================== */
  function drawWorld(G) {
    var i;

    if (G.stage === 2) { drawStage2World(G); return; }
    if (G.stage >= 3) { drawCampaignWorld(G); return; }

    updateBackdrop(G.scrollX);
    updateTerrain(G.scrollX, G.frame);

    /* capsules */
    for (i = 0; i < G.capsules.length; i++) {
      var c = G.capsules[i];
      if (c.dead) continue;
      var cs = NS.S.capsule[(c.t >> 3) & 1];
      place('capsule' + ((c.t >> 3) & 1), cs, c.x, c.y, 'capsule',
            { rz: Math.sin((c.t + i * 9) * 0.06) * 0.35, cap: 32, glow: true });
    }

    /* Options released by a dead ship are real green voxel pickups too. */
    for (i = 0; i < G.looseOptions.length; i++) {
      var lo = G.looseOptions[i];
      if (lo.dead) continue;
      var lf = (lo.t >> 3) & 1;
      place('looseOption' + lf, NS.S.looseOption[lf], lo.x - 2, lo.y - 2,
            'capsule', { ry: lo.t * 0.055, cap: 16, glow: true });
    }

    /* enemies — each kind maps to the same sprite the 2D renderer uses,
       so the bestiary needs no separate 3D art */
    var list = NS.Enemies.list;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.spawnDelay > 0) continue;
      var f = (e.t >> 3) & 1;

      switch (e.kind) {
        case 'flapper':
          var fs = e.bonus ? NS.S.carrier[f] : NS.S.flapper[f];
          placeDamage((e.bonus ? 'carrier' : 'flapper') + f, fs, e.x, e.y, 'enemy', e,
                { ry: Math.sin(e.t * 0.08) * 0.5, cap: 128 });
          break;
        case 'rusher':
          placeDamage('rusher' + ((e.t >> 2) & 1), NS.S.rusher[(e.t >> 2) & 1],
                e.x, e.y, 'enemy', e, { rz: -0.25, cap: 96 });
          break;
        case 'splitter':
          var ss = e.tier === 1 ? NS.S.splitterBig[f] : NS.S.splitterSmall[f];
          placeDamage('split' + e.tier + f, ss, e.x, e.y, 'enemy', e,
                { ry: e.t * 0.04, rz: Math.sin(e.t * 0.05) * 0.3, cap: 64 });
          break;
        case 'spore':
          placeDamage('spore', NS.S.spore, e.x, e.y, 'enemy', e,
                { ry: e.t * 0.03, rx: e.t * 0.02, cap: 48 });
          break;
        case 'ducker': {
          var dw = (e.walk | 0) & 1;
          placeDamage('ducker' + dw + (e.carrier ? 'C' : ''),
                NS.Enemies.skin(e, NS.S.ducker[dw]),
                e.x, e.y, 'enemy', e, { rz: e.onCeiling ? Math.PI : 0, cap: 48 });
          break;
        }
        case 'mouth':
          var ms = NS.Enemies.skin(e, e.open ? NS.S.mouthOpen : NS.S.mouthClosed);
          placeDamage((e.open ? 'mouthO' : 'mouthC') + (e.carrier ? 'C' : ''),
                ms, e.x, e.y, 'enemy',
                e, { rz: e.onCeiling ? Math.PI : 0, depth: 14, cap: 32 });
          break;
        case 'hatch':
          var hs = NS.Enemies.skin(e, e.open ? NS.S.hatchOpen : NS.S.hatchClosed);
          placeDamage((e.open ? 'hatchO' : 'hatchC') + (e.carrier ? 'C' : ''),
                hs, e.x, e.y, 'enemy',
                e, { rz: e.onCeiling ? Math.PI : 0, depth: 14, cap: 32 });
          break;
        case 'tentacle':
          for (var q = 0; q < e.joints.length; q++) {
            var jt = e.joints[q];
            var seg = jt.tip ? NS.S.tentacleTip : NS.S.tentacleSeg;
            placeDamage(jt.tip ? 'tentTip' : 'tentSeg', seg,
                  jt.x - seg.width / 2, jt.y - seg.height / 2, 'hazard',
                  e, { ry: q * 0.4 + e.t * 0.03, cap: 128 });
          }
          placeDamage('tentRoot' + f + (e.carrier ? 'C' : ''),
                NS.Enemies.skin(e, NS.S.tentacleRoot[f]), e.x, e.y, 'enemy',
                e, { rz: e.onCeiling ? Math.PI : 0, depth: 12, cap: 24 });
          break;
        case 'prominence':
          var charge = NS.Feedback.hazardCharge({ t: e.t + e.offset, period: e.period });
          if (charge > 0) place('promCharge', NS.S.prom[0], e.x - 4,
                e.y + (e.onCeiling ? 0 : -3), 'hazard',
                { sx: 2.4, sy: 0.8, sz: 2, cap: 16, glow: true, tint: '#fff3a0' });
          for (var j = 0; j < e.flames.length; j++) {
            var fl = e.flames[j];
            var ps = NS.S.prom[(fl.t >> 2) & 1];
            place('prom' + ((fl.t >> 2) & 1), ps, fl.x - 2, fl.y - 2, 'hazard',
                  { ry: fl.t * 0.2, rz: fl.t * 0.14,
                    sx: 1.2, sy: 1.2, sz: 1.6, cap: 256 });
          }
          break;
      }
    }

    /* boss: the shell is drawn procedurally in 2D, so here it is built from
       stacked voxel slabs, with the eye sprite riding in the channel */
    if (G.boss) drawBoss(G.boss);

    /* projectiles */
    var W = NS.Weapons;
    for (i = 0; i < W.player.length; i++) {
      var p = W.player[i];
      if (p.dead) continue;
      placeShot(p);
    }
    for (i = 0; i < W.enemy.length; i++) {
      var es = W.enemy[i];
      if (es.dead) continue;
      if (NS.projectileContrast()) place('eshotHalo', NS.S.eshot, es.x, es.y, 'shot',
            { ry: es.t * 0.25, sx: es.big ? 2.2 : 1.7, sy: es.big ? 2.2 : 1.7,
              sz: es.big ? 2.2 : 1.7, cap: 128, glow: true, tint: '#ffffff', z: LAYER.shot.z - 1 });
      place('eshot', NS.S.eshot, es.x, es.y, 'shot',
            { ry: es.t * 0.25, sx: es.big ? 1.5 : 1, sy: es.big ? 1.5 : 1,
              sz: es.big ? 1.5 : 1, cap: 128, glow: true });
    }

    /* the ship, its Options and its exhaust */
    var pl = G.player;
    if (pl.alive && !(pl.invuln > 0 && (pl.anim >> 1) % 2 === 0 && pl.invuln > 14)) {
      var shipSpr = pl.bank < 0 ? NS.S.shipUp : (pl.bank > 0 ? NS.S.shipDown : NS.S.ship);
      var shipKey = pl.bank < 0 ? 'shipUp' : (pl.bank > 0 ? 'shipDown' : 'ship');
      place(shipKey, shipSpr, pl.x - shipSpr.cx, pl.y - shipSpr.cy, 'player',
            { rz: pl.bank * -0.16, cap: 4 });
      var flameSpr = NS.S.flame[(pl.anim >> 2) & 1];
      place('flame' + ((pl.anim >> 2) & 1), flameSpr,
            pl.x - shipSpr.cx - flameSpr.width + 1, pl.y - flameSpr.cy,
            'player', { sx: 1.4, sz: 1.4, cap: 4 });
      var of = (pl.anim >> 3) & 1;
      for (i = 0; i < pl.options.length; i++) {
        place('option' + of, NS.S.option[of],
              pl.options[i].x - 2, pl.options[i].y - 2, 'player',
              { ry: pl.anim * 0.1, cap: 8 });
      }
      if (V.shipLight) {
        V.shipLight.position.set(pl.x + 6, simY(pl.y), LAYER.player.z + 26);
        V.shipLight.intensity = 120;
      }
    } else if (V.shipLight) {
      V.shipLight.intensity = 0;
    }

    /* explosion and spark particles */
    drawFx();
  }

  function drawStage2World(G) {
    var i, L = NS.Level2;
    updateBackdrop(L.scrollY, true);
    updateTerrain2(L.scrollY, G.frame);

    /* Central volcanic islands and destructible defenses share the same
       deep voxel terrain layer as the side banks. */
    for (i = 0; i < L.islands.length; i++) {
      var a = L.islands[i], ay = L.screenY(a.wy);
      if (ay < -a.ry - 20 || ay > NS.PLAYFIELD_H + a.ry + 20) continue;
      place('v2island', NS.S.spore, a.x - NS.S.spore.width / 2, ay - NS.S.spore.height / 2,
            'terrain', { sx: a.rx / 3.5, sy: a.ry / 3.5, sz: 1.5, depth: 38, ry: 0.25, cap: 12 });
    }
    for (i = 0; i < L.volcanoes.length; i++) {
      var v = L.volcanoes[i]; if (v.dead || v.y < -35 || v.y > NS.PLAYFIELD_H + 35) continue;
      placeDamage('v2volcano', NS.S.spore, v.x - NS.S.spore.width / 2, v.y - NS.S.spore.height / 2,
            'hazard', v, { sx: 3.2, sy: 3.5, sz: 2.5, rx: -0.25, cap: 8 });
    }
    for (i = 0; i < L.gates.length; i++) {
      var gate = L.gates[i]; if (gate.y < -25 || gate.y > NS.PLAYFIELD_H + 25) continue;
      for (var gc = 0; gc < gate.cells.length; gc++) {
        var cell = gate.cells[gc]; if (cell.dead) continue;
        placeDamage('v2gate', NS.S.spore, cell.x, gate.y - 7, 'terrain', cell,
              { sx: cell.w / NS.S.spore.width, sy: 2, sz: 1.8, depth: 20, cap: 40 });
      }
    }
    for (i = 0; i < L.rocks.length; i++) {
      var rock = L.rocks[i]; if (rock.dead) continue;
      placeDamage('v2rock', NS.S.spore, rock.x - 3, rock.y - 3, 'hazard', rock,
            { sx: 0.9, sy: 0.9, sz: 1.2, ry: rock.t * 0.08, cap: 48 });
    }
    var fort = L.fortress;
    if (fort && L.phase === 'fortress') {
      var fz = LAYER.boss.z;
      /* the ceiling plate the cores are socketed into, grinding down during
         the entrance exactly as the flat renderer draws it */
      var fdrop = fort.drop == null ? 1 : fort.drop;
      vbox('v2fortPlate', NS.W / 2, 22 * fdrop - 11, LAYER.terrain.z + 30,
           NS.W, 22, 44, '#263c58', { cap: 2 });
      for (i = 0; i < fort.cores.length; i++) {
        var fc = fort.cores[i]; if (fc.dead) continue;
        var fck = NS.hitOffset(fc), fcx = fc.x + fck.x, fcy = fc.y + fck.y;
        var fcFlash = NS.damageFlashing(fc);
        vball('v2fortCore' + (fcFlash ? 'Hit' : ''), fcx, fcy, fz, 12, fcFlash ? NS.DAMAGE_FLASH_COLOR : '#184b78', { cap: 4, ry: fort.t * 0.02, glow: fcFlash });
        vball('v2fortPip' + (fcFlash ? 'Hit' : ''), fcx, fcy, fz + 13, 5, fcFlash ? '#ff9ba0' : '#ff7b4c', { cap: 4, glow: true });
        if (fc.shield > 0) {
          vring('v2fortShield', fcx, fcy, fz + 4, 15, 2.6, '#8ee8ff',
                14, fort.t * 0.03 + i, 48, true);
        }
      }
      for (i = 0; i < fort.balls.length; i++) {
        var ball = fort.balls[i];
        vball('v2fortBall', ball.x, ball.y, LAYER.hazard.z + 6, 5, '#8fcaff',
              { cap: 8, ry: ball.t * 0.12, rx: ball.t * 0.09, glow: true });
      }
    }

    for (i = 0; i < L.enemies.length; i++) {
      var e = L.enemies[i];
      if (e.dead || !e.active || e.y < -30 || e.y > NS.PLAYFIELD_H + 30) continue;
      var squadCarrier = e.carrier || e.bonus;
      var spr = e.kind === 'turret' ? NS.S.spore : (squadCarrier ? NS.S.carrier[(e.t >> 3) & 1] : NS.S.flapper[(e.t >> 3) & 1]);
      placeDamage('v2' + e.kind + (squadCarrier ? 'C' : '') + ((e.t >> 3) & 1), spr,
            e.x - spr.width / 2, e.y - spr.height / 2, 'enemy',
            e, { rz: Math.PI / 2, ry: e.t * 0.025, depth: e.kind === 'turret' ? 13 : 8, cap: 160 });
    }
    for (i = 0; i < L.pickups.length; i++) {
      var c = L.pickups[i]; if (c.dead) continue;
      var cp = c.kind === 'crash' ? NS.S.crashCapsule : NS.S.capsule;
      place((c.kind === 'crash' ? 'crash' : 'capsule') + ((c.t >> 3) & 1), cp[(c.t >> 3) & 1], c.x - 3, c.y - 3, 'capsule', { ry: c.t * 0.06, cap: 32, glow: true });
    }
    for (i = 0; i < G.looseOptions.length; i++) {
      var o = G.looseOptions[i]; if (o.dead) continue;
      place('looseOption' + ((o.t >> 3) & 1), NS.S.looseOption[(o.t >> 3) & 1], o.x - 2, o.y - 2, 'capsule', { ry: o.t * 0.05, cap: 16, glow: true });
    }
    for (i = 0; i < L.shots.length; i++) {
      if (!L.shots[i].dead) placeShot(L.shots[i]);
    }
    for (i = 0; i < L.enemyShots.length; i++) {
      var es = L.enemyShots[i]; if (es.dead) continue;
      if (NS.projectileContrast()) place('eshotHalo', NS.S.eshot, es.x - 2, es.y - 2, 'shot', { ry: es.t * 0.2, sx: 1.7, sy: 1.7, sz: 1.7, cap: 128, glow: true, tint: '#ffffff', z: LAYER.shot.z - 1 });
      place('eshot', NS.S.eshot, es.x - 2, es.y - 2, 'shot', { ry: es.t * 0.2, cap: 128, glow: true });
    }

    /* Cruiser Tetran, built from the same parts the flat renderer draws:
       a dark hull disc, a red core, four arms, four pods on their ends, and
       one halo per surviving shield. It used to be a single purple blob with
       four capsules parked around it, which is neither the right shape nor
       the right colour. */
    var b = L.boss;
    if (b && (!b.dead || (b.dying >> 2) % 2 === 0)) {
      var bk = NS.hitOffset(b), bx = b.x + bk.x, by = b.y + bk.y;
      var bz = LAYER.boss.z, dep = b.deploy == null ? 1 : b.deploy;
      var bFlash = NS.damageFlashing(b), bSuffix = bFlash ? 'Hit' : '';
      vball('v2hull' + bSuffix, bx, by, bz, 22, bFlash ? NS.DAMAGE_FLASH_COLOR : '#273d61', { cap: 2, sz: 0.85, ry: b.spin * 0.4, glow: bFlash });
      vball('v2coreLamp' + bSuffix, bx, by, bz + 17, 8,
            bFlash ? '#ff9ba0' : (b.shield ? '#ff5964' : '#ffd0d0'), { cap: 2, glow: true });
      for (var q = 0; q < 4; q++) {
        var a = q * Math.PI / 2 + b.spin;
        /* the arm spans radius 7..35 in 2D, so its centre is at 21 */
        vbox('v2arm' + bSuffix, bx + Math.cos(a) * 21 * dep, by + Math.sin(a) * 21 * dep,
             bz + 4, 28, 5, 8, bFlash ? '#d9162c' : '#7a9ab8', { rz: -a, sx: Math.max(0.05, dep), cap: 8, glow: bFlash });
        vball('v2pod' + bSuffix, bx + Math.cos(a) * 36 * dep, by + Math.sin(a) * 36 * dep,
              bz + 6, 7, bFlash ? '#ff5961' : '#d8e7ef', { cap: 8, ry: b.spin * 2, rx: b.spin, glow: bFlash });
      }
      for (var ring = 0; ring < b.shield; ring++) {
        vring('v2shield', bx, by, bz + 2, 26 + ring * 4, 2.4,
              ring === b.shield - 1 ? '#a9f4ff' : '#5fc8e0',
              20, b.t * 0.012 * (ring + 1), 72, true);
      }
    }

    var p = G.player;
    if (p.alive && !(p.invuln > 14 && (p.anim >> 1) % 2 === 0)) {
      place('shipTop', NS.S.shipTop, p.x - NS.S.shipTop.cx, p.y - NS.S.shipTop.cy,
            'player', { rz: p.bank * -0.08, cap: 4 });
      place('flameTop', NS.S.flameTop, p.x - NS.S.flameTop.cx,
            p.y + NS.S.shipTop.height / 2 - 1, 'player', { sz: 1.4, cap: 4 });
      var of = (p.anim >> 3) & 1;
      for (i = 0; i < p.options.length; i++) place('option' + of, NS.S.option[of], p.options[i].x - 2, p.options[i].y - 2, 'player', { ry: p.anim * 0.1, cap: 8 });
      if (V.shipLight) { V.shipLight.position.set(p.x, simY(p.y), LAYER.player.z + 26); V.shipLight.intensity = 120; }
    } else if (V.shipLight) V.shipLight.intensity = 0;
    drawFx();
  }

  /* ----------------------------------------------------------------------
     Campaign bosses

     campaign.js draws these four out of ellipses, rectangles and arcs. The
     voxel view used to substitute a scaled `spore` sprite for every part of
     every one of them, so a stone sarcophagus and a fleshy maw came out as
     the same blob in the same purple, and the shapes shared nothing with the
     flat art beyond a rough size.

     Each is rebuilt below from the primitives above, quoting the same hex
     strings and the same radii the 2D renderer uses, so the two views are
     the same design and cannot drift apart. `deploy` scales whatever unfolds
     during the entrance cut, matching the flat renderer part for part.
     ---------------------------------------------------------------------- */

  /* The serpent reads as one creature only if its body has depth, so the
     coil weaves through z as well as the plane. x/y still follow the 2D
     curve exactly — only z is invented, and the body carries no hitbox
     (collide() targets dragonX/dragonY), so nothing about the fight moves. */
  var DRAGON_SEGS = 54;
  var DRAGON_TINT = ['#3f8c39', '#4a9e42', '#57ad4c', '#63bc57',
                     '#6fcb5f', '#72dc67', '#80e772', '#8ef07f'];

  function drawCampaignBoss(C, b) {
    var bz = LAYER.boss.z, i;
    var dep = b.deploy == null ? 1 : b.deploy;
    var flash = NS.damageFlashing(b), red = NS.DAMAGE_FLASH_COLOR, redHi = '#ff9ba0';
    var kick = NS.hitOffset(b);
    primOffsetX = kick.x; primOffsetY = kick.y;

    if (C.stage === 3) {
      /* Intruder: an upright ovoid with a maw cut into its leading face.
         Wide open is the tell that it can be hurt. */
      vell('c3Body', b.x, b.y, bz, 28, 38, 26, flash ? red : '#9b3020', { cap: 2, ry: Math.sin(b.t * 0.01) * 0.2 });
      vell('c3Ridge', b.x + 6, b.y, bz + 16, 16, 30, 10, flash ? redHi : '#c4532f', { cap: 2 });
      /* Open and shut are two pools, not one: a pool bakes its material when
         it is first built, so a single key could not be lit in one state and
         unlit in the other — it would keep whichever it was born with. */
      vbox(b.open ? 'c3MawOpen' : 'c3MawShut', b.x - 18, b.y - 7 + (b.open ? 7 : 2),
           bz + 20, 14, 14, 12, flash ? redHi : (b.open ? '#ffe0a0' : '#5d1515'),
           { sy: b.open ? 1 : 0.3, cap: 2, glow: b.open });
      for (i = -1; i <= 1; i += 2) {
        vbox('c3Tusk', b.x - 24, b.y + i * 13, bz + 14, 8, 5, 8, flash ? redHi : '#e8c9a0', { cap: 4 });
      }

    } else if (C.stage === 4) {
      /* Giga: a pale sphere with a mouth on its underside and eyes that
         detach and hunt as it loses health. */
      vball('c4Body', b.x, b.y, bz, 25, flash ? red : '#d5d5c9', { cap: 2, ry: b.t * 0.012 });
      vbox(b.open ? 'c4MawOpen' : 'c4MawShut', b.x, b.y + 8 + (b.open ? 6 : 1.5),
           bz + 20, 18, 12, 12, flash ? redHi : (b.open ? '#ff704f' : '#342020'),
           { sy: b.open ? 1 : 0.25, cap: 2, glow: b.open });
      for (i = -1; i <= 1; i += 2) {
        vball('c4Socket', b.x + i * 13, b.y - 5, bz + 18, 7, flash ? redHi : '#9c9c92', { cap: 4 });
      }
      if (b.eyeList) for (i = 0; i < b.eyeList.length; i++) {
        var eye = b.eyeList[i];
        vball('c4Eye', eye.x, eye.y, bz + 16, 5, flash ? redHi : '#ffef8b', { cap: 4, ry: eye.t * 0.08, glow: true });
      }

    } else if (C.stage === 5) {
      /* Tutanhamanattack: a rectangular gilt sarcophagus. 2D draws it with
         fillRect, so a rounded blob was simply the wrong object. */
      vbox('c5Body', b.x, b.y, bz, 34, 50, 28, flash ? red : '#d1a336', { cap: 2 });
      vbox('c5Crown', b.x, b.y - 22, bz + 6, 40, 8, 32, flash ? redHi : '#8f6a18', { cap: 2 });
      vbox('c5Band', b.x, b.y + 6, bz + 15, 34, 5, 6, flash ? redHi : '#8f6a18', { cap: 4 });
      vbox('c5Chin', b.x, b.y + 20, bz + 12, 20, 10, 14, flash ? redHi : '#b98c22', { cap: 2 });
      vbox('c5Eye', b.x - b.side * 13 + 4, b.y - 5, bz + 17, 8, 8, 8, flash ? redHi : '#62d8ff', { cap: 2, glow: true });
      for (i = 0; i < 8; i++) {
        var oa = i * Math.PI / 4 + b.t * 0.025;
        vball('c5Orb', b.x + Math.cos(oa) * 29 * dep, b.y + Math.sin(oa) * 29 * dep,
              bz + Math.sin(oa) * 16, 4, flash ? redHi : '#ffd96b', { cap: 8, ry: b.t * 0.06, glow: true });
      }

    } else {
      /* Zelos: the core, ringed by the serpent until the serpent dies. */
      vball('c6Core', b.x, b.y, bz, 24, flash ? red : '#b81735', { cap: 2, ry: b.t * 0.015 });
      if (b.form === 'dragon') {
        var near = null, nd = 1e9;
        for (i = 0; i <= DRAGON_SEGS; i++) {
          var u = i / DRAGON_SEGS, a = u * Math.PI * 2 + b.t * 0.025;
          var weave = Math.sin(a * 3);
          var sxp = b.x + Math.cos(a) * 48 * dep;
          var syp = b.y + Math.sin(a * 2) * 40 * dep;
          var szp = bz + weave * 15;
          /* nearer coils are lit brighter, which is what makes the weave
             legible instead of reading as a flat ring */
          var t = flash ? red : DRAGON_TINT[Math.min(DRAGON_TINT.length - 1,
                    ((weave + 1) * 0.5 * DRAGON_TINT.length) | 0)];
          vball('c6Coil', sxp, syp, szp, 4 + Math.sin(a) * 0.8, t,
                { cap: DRAGON_SEGS + 2, ry: a });
          /* remember where the coil passes closest to the head, so the neck
             can join the two — 2D leaves the head floating unattached */
          var d2 = NS.dist2(sxp, syp, b.dragonX, b.dragonY);
          if (d2 < nd) { nd = d2; near = [sxp, syp, szp]; }
        }
        var NECK = 7;
        for (i = 1; i < NECK; i++) {
          var k = i / NECK;
          vball('c6Neck',
                NS.lerp(near[0], b.dragonX, k), NS.lerp(near[1], b.dragonY, k),
                NS.lerp(near[2], bz + 18, k), 4,
                flash ? red : DRAGON_TINT[Math.min(DRAGON_TINT.length - 1, (4 + k * 4) | 0)],
                { cap: NECK + 1 });
        }
        vball('c6Head', b.dragonX, b.dragonY, bz + 18, 8, flash ? redHi : '#baff88',
              { cap: 2, ry: b.t * 0.04, glow: true });
        for (i = -1; i <= 1; i += 2) {
          vball('c6Eye', b.dragonX - 3, b.dragonY + i * 4, bz + 25, 2, flash ? redHi : '#ff5a5a', { cap: 4, glow: true });
        }
      } else {
        vball('c6Heart', b.x, b.y, bz + 16, 12, flash ? redHi : '#ff8aa0', { cap: 2, ry: b.t * 0.05, glow: true });
        vring('c6Pulse', b.x, b.y, bz + 6, 20 + Math.sin(b.t * 0.08) * 3, 2.4,
              flash ? red : '#ff5a7a', 16, b.t * 0.02, 48, true);
      }
    }
    primOffsetX = primOffsetY = 0;
  }

  function drawCampaignWorld(G) {
    var C=NS.Campaign,i;
    updateBackdrop(C.scroll,!C.horizontal());updateCampaignTerrain(C);
    for(i=0;i<C.hazards.length;i++){
      var h=C.hazards[i],m=C.horizontal()?h.world-C.scroll:NS.PLAYFIELD_H-(h.world-C.scroll);
      var ex=Math.max(0,Math.sin(((h.t%h.period)/h.period)*Math.PI))*h.span;
      if(C.horizontal())place('campHaz',NS.S.prom[(h.t>>2)&1],m-3,h.side==='top'?0:NS.PLAYFIELD_H-ex,'hazard',{sx:2,sy:Math.max(1,ex/5),sz:2,cap:64});
      else place('campHaz',NS.S.prom[(h.t>>2)&1],h.side==='left'?0:NS.W-ex,m-3,'hazard',{sx:Math.max(1,ex/5),sy:2,sz:2,cap:64});
      if(NS.Feedback.hazardCharge(h)>0){
        if(C.horizontal())place('campHazCharge',NS.S.prom[0],m-5,h.side==='top'?0:NS.PLAYFIELD_H-3,'hazard',{sx:3,sy:.8,sz:2,cap:32,glow:true,tint:'#fff3a0'});
        else place('campHazCharge',NS.S.prom[0],h.side==='left'?0:NS.W-3,m-5,'hazard',{sx:.8,sy:3,sz:2,cap:32,glow:true,tint:'#fff3a0'});
      }
    }
    /* Stage 5's shoot-through masonry uses actual box cells here instead of
       borrowing an enemy sprite, preserving the wall silhouette and making
       damage visible through the same darkening used by the 2D renderer. */
    for(i=0;i<C.barriers.length;i++){
      var wall=C.barriers[i],wx=C.barrierScreenX(wall);
      if(wx>NS.W+25||wx+wall.w<-25)continue;
      for(var bc=0;bc<wall.cells.length;bc++){
        var cell=wall.cells[bc];if(cell.dead)continue;
        var cellFlash=NS.damageFlashing(cell),ck=NS.hitOffset(cell);
        var tint=cellFlash?NS.DAMAGE_FLASH_COLOR:(cell.hp/cell.maxHp>.5?'#b39749':'#80652e');
        vbox('campBarrier',wx+wall.w/2+ck.x,cell.y+cell.h/2+ck.y,LAYER.terrain.z+18,
             wall.w,Math.max(2,cell.h-1),28,tint,{cap:48});
        vbox('campBarrierRim',wx+wall.w/2+ck.x,cell.y+2+ck.y,LAYER.terrain.z+34,
             wall.w-3,2,3,cellFlash?'#ff9ba0':'#d7bd66',{cap:48});
      }
    }
    for(i=0;i<C.enemies.length;i++){
      var e=C.enemies[i];if(e.dead||!e.active)continue;var spr=(e.bonus?NS.S.carrier:NS.S.flapper)[(e.t>>3)&1];
      if(e.kind==='moai'||e.kind==='rock'||e.kind==='lung')spr=NS.S.spore;
      placeDamage('camp'+e.kind+(e.bonus?'C':'')+((e.t>>3)&1),spr,e.x-spr.width/2,e.y-spr.height/2,'enemy',e,{rz:C.horizontal()?0:Math.PI/2,ry:e.t*.025,sx:e.kind==='dragon'?2:1,sy:e.kind==='dragon'?1.5:1,cap:128});
    }
    if(C.mini&&!C.mini.dead)for(i=0;i<C.mini.cores.length;i++){var mc=C.mini.cores[i];if(mc.hp>0){
      var miniFlash=NS.damageFlashing(mc),mck=NS.hitOffset(mc);primOffsetX=mck.x;primOffsetY=mck.y;
      vball('campMiniCore',mc.x,mc.y,LAYER.boss.z+10,10,miniFlash?NS.DAMAGE_FLASH_COLOR:'#72c6ff',{cap:4,ry:C.mini.t*.03,glow:true});
      vring('campMiniRing',mc.x,mc.y,LAYER.boss.z+4,13,2.2,miniFlash?'#ff9ba0':'#bde8ff',12,C.mini.t*.04+i,40,true);primOffsetX=primOffsetY=0;}}
    for(i=0;i<C.pickups.length;i++){var c=C.pickups[i];place('capsule'+((c.t>>3)&1),NS.S.capsule[(c.t>>3)&1],c.x-3,c.y-3,'capsule',{ry:c.t*.06,cap:32,glow:true});}
    for(i=0;i<G.looseOptions.length;i++){var o=G.looseOptions[i];place('looseOption'+((o.t>>3)&1),NS.S.looseOption[(o.t>>3)&1],o.x-2,o.y-2,'capsule',{ry:o.t*.05,cap:16,glow:true});}
    for(i=0;i<C.shots.length;i++)if(!C.shots[i].dead)placeShot(C.shots[i]);
    for(i=0;i<C.enemyShots.length;i++){var q=C.enemyShots[i];if(NS.projectileContrast())place('eshotHalo',NS.S.eshot,q.x-2,q.y-2,'shot',{ry:q.t*.2,sx:1.7,sy:1.7,sz:1.7,cap:128,glow:true,tint:'#ffffff',z:LAYER.shot.z-1});place('eshot',NS.S.eshot,q.x-2,q.y-2,'shot',{ry:q.t*.2,cap:128,glow:true});}
    var b=C.boss;if(b&&(!b.dead||(b.dying>>2)%2===0))drawCampaignBoss(C,b);
    if(C.ending)for(i=0;i<C.escapeBars.length;i++){var eb=C.escapeBars[i],bx=eb.side==='left'?0:NS.W-eb.w;place('campEscapeBar',NS.S.prom[0],bx,eb.y,'hazard',{sx:Math.max(2,eb.w/3),sy:2.4,sz:3,cap:16});}
    var p=G.player;if(p.alive&&!(p.invuln>14&&(p.anim>>1)%2===0)){
      var ps=p.orientation==='vertical'?NS.S.shipTop:NS.S.ship;
      place(p.orientation==='vertical'?'shipTop':'ship',ps,p.x-ps.cx,p.y-ps.cy,'player',{rz:p.bank*-.1,cap:4});
      var fl=p.orientation==='vertical'?NS.S.flameTop:NS.S.flame[(p.anim>>2)&1];
      place(p.orientation==='vertical'?'flameTop':'flame'+((p.anim>>2)&1),fl,p.orientation==='vertical'?p.x-fl.cx:p.x-ps.cx-fl.width+1,p.orientation==='vertical'?p.y+ps.height/2-1:p.y-fl.cy,'player',{cap:4});
      var of=(p.anim>>3)&1;for(i=0;i<p.options.length;i++)place('option'+of,NS.S.option[of],p.options[i].x-2,p.options[i].y-2,'player',{ry:p.anim*.1,cap:8});
      if(V.shipLight){V.shipLight.position.set(p.x,simY(p.y),LAYER.player.z+26);V.shipLight.intensity=120;}
    }else if(V.shipLight)V.shipLight.intensity=0;
    drawFx();
  }

  function drawBoss(b) {
    var kick = NS.hitOffset(b), bx = b.x + kick.x, cy = b.y + b.bob + kick.y;
    var flash = NS.damageFlashing(b);
    /* body: concentric slabs approximating the drawn blobs */
    var rings = [
      { rx: 30, ry: 41, z: -14, c: 0x8d2a4a },
      { rx: 24, ry: 33, z: 2,   c: 0xb23d61 },
      { rx: 16, ry: 22, z: 14,  c: 0xd2618a }
    ];
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      bossSlab(i, bx + (i === 1 ? 4 : (i === 2 ? 2 : 0)), cy, r, flash);
    }
    /* armour plates slide apart as the eye opens. 2D draws them as 26x8
       rects whose centres sit 12px off the core, not 20 — at 20 they hung
       clear of the mass with a gap the flat art does not have. */
    var sep = b.eyeOpen * 9;
    bossPlate(0, bx - 1, cy - 12 - sep, flash);
    bossPlate(1, bx - 1, cy + 12 + sep, flash);

    /* the tendrils rooting it to the chamber wall — the single loudest part
       of the 2D silhouette, and absent here entirely until now */
    var bz = LAYER.boss.z;
    b.eachTendril(7, function (tx, ty, strand, u) {
      vball('golemTendril', tx + kick.x, ty + kick.y, bz - 8 + Math.sin(strand * 2 + u * 5) * 7,
            2.2, flash ? NS.DAMAGE_FLASH_COLOR : (u > 0.75 ? '#5a1530' : '#7a2440'), { cap: 48 });
    });

    if (b.eyeOpen > 0.05) {
      var spr = flash ? NS.S.bossEyeHit : NS.S.bossEye;
      /* the innermost body blob reaches z+23, so the eye has to sit past
         that or it renders buried inside the mass */
      place('bossEye', spr, bx - 6, cy - 6, 'boss',
            { z: LAYER.boss.z + 30, sy: Math.max(0.15, b.eyeOpen),
              depth: 10, cap: 2, glow: true });
      /* the halo is the stage accent doing its one job: marking the only
         place on this thing that a shot does anything */
      vring('golemEyeHalo', bx, cy, LAYER.boss.z + 26,
            9 + Math.sin(b.t * 0.14) * 1.5, 2.0, flash ? '#ff9ba0' : PALETTE[1].accent,
            12, b.t * 0.05, 40, true);
    }
    for (var j = 0; j < b.cells.length; j++) {
      var c = b.cells[j];
      if (c.dead) continue;
      place('bossCell', NS.S.cell, c.x - 2, c.y - 2, 'enemy',
            { ry: c.phase, cap: 48, tint: PALETTE[1].accent, glow: true });
    }
  }

  /* The boss body is drawn procedurally in 2D — there is no sprite grid to
     extrude — so it gets voxelised directly: each blob becomes an ellipsoid
     sampled on a lattice, one cube per cell, with the cube's depth set by
     how far through the ellipsoid that column runs. A smooth sphere would
     read as a foreign object in a scene made entirely of cubes. */
  var bossMeshes = [], plateMeshes = [];
  var BOSS_CELL = 3;         // voxel size for the body lattice

  function ellipsoidGeometry(rx, ry, rz, cell) {
    cell = cell || BOSS_CELL;
    var boxes = [];
    for (var x = -rx; x <= rx; x += cell) {
      for (var y = -ry; y <= ry; y += cell) {
        var q = (x * x) / (rx * rx) + (y * y) / (ry * ry);
        if (q > 1) continue;
        var d = 2 * rz * Math.sqrt(1 - q);
        if (d < 1) continue;
        boxes.push([x, y, d]);
      }
    }
    if (!boxes.length) return null;

    var base = new THREE.BoxGeometry(1, 1, 1);
    var bp = base.attributes.position.array;
    var bn = base.attributes.normal.array;
    var bi = base.index.array;
    var vpb = base.attributes.position.count;

    var positions = [], normals = [], indices = [];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var vs = positions.length / 3;
      for (var v = 0; v < vpb; v++) {
        positions.push(
          bp[v * 3] * cell + b[0],
          bp[v * 3 + 1] * cell + b[1],
          bp[v * 3 + 2] * b[2]
        );
        normals.push(bn[v * 3], bn[v * 3 + 1], bn[v * 3 + 2]);
      }
      for (var k = 0; k < bi.length; k++) indices.push(bi[k] + vs);
    }
    base.dispose();

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }

  function bossSlab(i, x, y, r, flash) {
    var m = bossMeshes[i];
    if (!m) {
      var geo = ellipsoidGeometry(r.rx, r.ry, r.rx * 0.55);
      if (!geo) return;
      m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: r.c }));
      scene.add(m);
      bossMeshes[i] = m;
    }
    m.visible = true;
    m.position.set(x, simY(y), LAYER.boss.z + r.z);
    m.material.color.setHex(flash ? 0xff3038 : r.c);
  }
  function bossPlate(i, x, y, flash) {
    var m = plateMeshes[i];
    if (!m) {
      m = new THREE.Mesh(
        new THREE.BoxGeometry(26, 8, 22),
        new THREE.MeshLambertMaterial({ color: 0xe6a5bd })
      );
      scene.add(m);
      plateMeshes[i] = m;
    }
    m.visible = true;
    m.position.set(x, simY(y), LAYER.boss.z + 16);
    m.material.color.setHex(flash ? 0xff3038 : 0xe6a5bd);
  }
  function hideBoss() {
    for (var i = 0; i < bossMeshes.length; i++) if (bossMeshes[i]) bossMeshes[i].visible = false;
    for (var j = 0; j < plateMeshes.length; j++) if (plateMeshes[j]) plateMeshes[j].visible = false;
  }

  /* ---- particles -------------------------------------------------------
     FX.list holds sparks, expanding flash rings and floating score text.
     Sparks and rings become voxel cubes here; the text stays in the 2D
     overlay, where it is legible. Colours come from the same hue ramps the
     2D renderer uses, so explosions match across both views. */
  var FIRE = ['#fffbe0', '#ffe066', '#ffa02a', '#e8461e', '#8c1c10'];
  var HIT  = ['#ffffff', '#bfe9ff', '#5fb0ff', '#2a5bd0'];
  var BIO  = ['#e8ffe8', '#8cff9e', '#2fbf6a', '#0e5a35'];
  function ramp(hue) { return hue === 'hit' ? HIT : (hue === 'bio' ? BIO : FIRE); }
  function rampAt(hue, k) {
    var pal = ramp(hue);
    return pal[Math.min(pal.length - 1, (k * pal.length) | 0)];
  }

  var fxMesh = null, fxDummy = null;
  function drawFx() {
    if (!NS.FX.list) return;
    if (!fxMesh) {
      fxMesh = new THREE.InstancedMesh(
        whiteColors(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.MeshBasicMaterial({ vertexColors: true }),
        512
      );
      fxMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(512 * 3), 3);
      fxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      fxMesh.frustumCulled = false;
      scene.add(fxMesh);
      fxDummy = new THREE.Object3D();
    }
    var ps = NS.FX.list;
    var n = 0;
    var col = new THREE.Color();
    for (var i = 0; i < ps.length && n < 512; i++) {
      var p = ps[i];
      if (p.dead || p.kind === 'text') continue;
      var k = p.t / p.life;

      if (p.kind === 'spark' || p.kind === 'chunk') {
        var s = (p.size || 1) * 1.8;
        fxDummy.position.set(p.x, simY(p.y), LAYER.player.z + 6);
        fxDummy.scale.set(s, p.kind === 'chunk' ? s * 0.72 : s, s);
        fxDummy.rotation.set(p.t * 0.2, p.t * 0.15, 0);
        fxDummy.updateMatrix();
        fxMesh.setMatrixAt(n, fxDummy.matrix);
        col.set(rampAt(p.hue, k));
        fxMesh.setColorAt(n, col);
        n++;
      } else if (p.kind === 'trail') {
        var ts = Math.max(0.2, (p.size || 1) * (1 - k) * 1.8);
        fxDummy.position.set(p.x, simY(p.y), LAYER.player.z + 4);
        fxDummy.scale.set(ts, ts, ts);
        fxDummy.rotation.set(0, p.t * 0.2, 0);
        fxDummy.updateMatrix();
        fxMesh.setMatrixAt(n, fxDummy.matrix);
        col.set(p.color || '#8fd0ff').multiplyScalar(1 - k * 0.55);
        fxMesh.setColorAt(n, col); n++;
      } else if (p.kind === 'muzzle') {
        var ms = (1.5 + (p.power || 1) * 1.2) * (1 - k);
        fxDummy.position.set(p.x + p.dx * 4, simY(p.y + p.dy * 4), LAYER.player.z + 7);
        fxDummy.scale.set(Math.max(.2, ms), Math.max(.2, ms), Math.max(.2, ms));
        fxDummy.rotation.set(p.t * .4, p.t * .3, 0);
        fxDummy.updateMatrix();
        fxMesh.setMatrixAt(n, fxDummy.matrix);col.set('#ffffff');fxMesh.setColorAt(n,col);n++;
      } else if (p.kind === 'flash') {
        /* the 2D flash is a ring; in 3D it reads better as a thin shell of
           cubes stepped around the circle */
        var r = NS.lerp(p.r0, p.r1, k);
        var seg = 10;
        for (var a = 0; a < seg && n < 512; a++) {
          var ang = (a / seg) * Math.PI * 2;
          fxDummy.position.set(
            p.x + Math.cos(ang) * r,
            simY(p.y + Math.sin(ang) * r),
            LAYER.player.z + 6 + Math.sin(ang * 2) * 3
          );
          fxDummy.scale.set(2, 2, 2);
          fxDummy.rotation.set(0, ang, ang);
          fxDummy.updateMatrix();
          fxMesh.setMatrixAt(n, fxDummy.matrix);
          col.set(rampAt(p.hue, k));
          fxMesh.setColorAt(n, col);
          n++;
        }
      }
    }
    fxMesh.count = n;
    fxMesh.instanceMatrix.needsUpdate = true;
    if (fxMesh.instanceColor) fxMesh.instanceColor.needsUpdate = true;
  }

  /* ======================================================================
     Camera framing
     ====================================================================== */

  /* The 2D path stretches the whole 256x224 buffer onto the 1920x1080 frame,
     so x=0 and x=NS.W land exactly on the screen edges and the player can fly
     right up to them. A plain perspective camera cannot reproduce that: fit
     the 208-tall playfield vertically at 16:9 and you get ~366 units of width
     for a 256-wide corridor, i.e. ~55 units of look-but-can't-reach void on
     each side — the "invisible wall".

     So we don't ask for a fov at all. We take the corridor's edge midpoints,
     move them into camera space, and solve for the two projection rows that
     put them exactly on the frame edges. That is a shifted, anamorphic lens:
     the corridor is pinned to the frame in both axes no matter where the
     drift moves the camera, while depth, keystone and parallax are untouched.

     Vertically the target is not the full frame — the 2D HUD strip is drawn
     over the bottom NS.HUD_H/NS.H of the picture, so the playfield floor maps
     to the top of that strip rather than to the bottom of the canvas. */
  var framePt = null;

  function cameraSpace(x, y, z) {
    framePt.set(x, y, z);
    camera.worldToLocal(framePt);
    return framePt;
  }

  function frameCorridor() {
    if (!camera) return;
    if (!framePt) framePt = new THREE.Vector3();
    camera.updateMatrixWorld();

    /* Normally the framed rectangle is the whole corridor. The boss entrance
       cut hands us a smaller one centred on what is arriving — and because
       the projection is solved from that rectangle every frame, handing over
       a smaller rectangle *is* the dolly in. There is no second camera path:
       the push, the settle and the pull back out are all one interpolation
       of these four numbers. The rectangle keeps the corridor's aspect, so
       nothing stretches while it moves. */
    var cx = NS.W * 0.5, cy = NS.PLAYFIELD_H * 0.5, k = 1;
    var focus = NS.Intro && NS.Intro.focus && NS.Intro.focus();
    if (focus) { cx = focus.x; cy = focus.y; k = focus.k; }
    var hw = NS.W * 0.5 * k, hh = NS.PLAYFIELD_H * 0.5 * k;

    var p;
    p = cameraSpace(cx - hw, cy, 0);  var l = p.x / p.z, lz = p.z;
    p = cameraSpace(cx + hw, cy, 0);  var r = p.x / p.z, rz = p.z;
    p = cameraSpace(cx, cy + hh, 0);  var tp = p.y / p.z, tz = p.z;
    p = cameraSpace(cx, cy - hh, 0);  var b = p.y / p.z, bz = p.z;

    /* every reference point must be in front of the lens, and the two of a
       pair must not collapse onto each other, or the solve blows up */
    if (lz > -1 || rz > -1 || tz > -1 || bz > -1) return;
    var dx = l - r, dy = tp - b;
    if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) return;

    /* ndc.x = -(m00 * xc / zc) - m02, solved for ndc -1 at the left edge and
       +1 at the right; same shape vertically, with the floor lifted to sit on
       top of the HUD strip instead of on the bottom of the frame */
    var floor = -1 + 2 * (NS.HUD_H / NS.H);
    var m00 = 2 / dx;
    var m02 = 1 - m00 * l;
    var m11 = (floor - 1) / dy;
    var m12 = -m11 * tp - 1;

    camera.updateProjectionMatrix();
    var e = camera.projectionMatrix.elements;
    e[0] = m00; e[8] = m02;
    e[5] = m11; e[9] = m12;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  /* ======================================================================
     Public entry points
     ====================================================================== */
  V.render = function (G) {
    if (state !== 'on') return;
    frame++;

    applyPalette(paletteFor(G));
    beginFrame();
    if (!G.boss) hideBoss();
    drawWorld(G);
    endFrame();

    /* a slow drift on the camera keeps the depth legible without ever
       moving far enough to change what you can see of the corridor */
    var t = frame * 0.006;
    var shake = NS.Feedback ? NS.Feedback.cameraOffset() : { x: 0, y: 0 };
    camera.position.x = NS.W * 0.5 - 6 + Math.sin(t) * 5 + shake.x;
    camera.position.y = NS.PLAYFIELD_H * 0.5 + 14 + Math.cos(t * 0.8) * 3 - shake.y;
    camera.lookAt(NS.W * 0.5, NS.PLAYFIELD_H * 0.5, -10);
    frameCorridor();

    renderer.render(scene, camera);
  };

  V.resize = function () {
    if (!renderer) return;

    /* Render at the physical size of the displayed canvas.  The old fixed
       1920x1080 drawing buffer looked good on a 1080p monitor, but a 4K or
       high-DPI display enlarged it again in CSS and softened every voxel
       edge.  Keep 1080p as a supersampled floor on smaller screens and
       grow to the real device resolution, capped at 4K for predictable GPU
       cost.  CSS still controls the canvas box; this only changes the
       number of WebGL pixels inside it. */
    var screen = document.getElementById('screen');
    var rect = screen ? screen.getBoundingClientRect() : null;
    var cssW = rect && rect.width ? rect.width : NS.SCREEN_W;
    var cssH = rect && rect.height ? rect.height : NS.SCREEN_H;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var scale = Math.max(NS.SCREEN_W / cssW, NS.SCREEN_H / cssH, dpr);
    var renderW = Math.min(3840, Math.round(cssW * scale));
    var renderH = Math.min(2160, Math.round(cssH * scale));

    renderer.setSize(renderW, renderH, false);
    /* aspect only seeds the near/far rows now — frameCorridor() pins the
       corridor to the canvas edges, so the fit follows the box, not the fov */
    camera.aspect = cssW / cssH;
    frameCorridor();
    syncCanvasBox();
  };

  /* the WebGL canvas tracks the 2D canvas's CSS box exactly, so the HUD
     drawn on top lines up with the world underneath */
  function syncCanvasBox() {
    var screen = document.getElementById('screen');
    if (!screen || !canvasEl) return;
    canvasEl.style.width = screen.style.width;
    canvasEl.style.height = screen.style.height;
  }
  V.syncBox = syncCanvasBox;

  V.enable = function (onDone) {
    if (state === 'on' || state === 'loading') return;
    if (state === 'failed') { onDone && onDone(false, failMsg); return; }
    state = 'loading';

    import('../vendor/three.module.js').then(function (mod) {
      THREE = mod;
      try {
        canvasEl = document.createElement('canvas');
        canvasEl.id = 'voxel';
        canvasEl.width = NS.SCREEN_W;
        canvasEl.height = NS.SCREEN_H;
        var screen = document.getElementById('screen');
        screen.parentNode.insertBefore(canvasEl, screen);

        renderer = new THREE.WebGLRenderer({
          canvas: canvasEl,
          antialias: true,
          powerPreference: 'high-performance'
        });
        renderer.setPixelRatio(1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setSize(NS.SCREEN_W, NS.SCREEN_H, false);

        buildScene();
        document.body.classList.add('ns-voxel-on');
        syncCanvasBox();
        state = 'on';
        onDone && onDone(true, '');
      } catch (e) {
        state = 'failed';
        failMsg = 'WEBGL INIT FAILED';
        onDone && onDone(false, failMsg);
      }
    }).catch(function () {
      state = 'failed';
      /* the overwhelmingly common cause: opened from file://, where ES
         module imports are blocked by the browser */
      failMsg = 'VOXEL NEEDS A SERVER';
      onDone && onDone(false, failMsg);
    });
  };

  V.disable = function () {
    if (state !== 'on') return;
    state = 'off';
    if (canvasEl) canvasEl.style.display = 'none';
    document.body.classList.remove('ns-voxel-on');
  };

  V.toggle = function (onDone) {
    if (state === 'on') { V.disable(); onDone && onDone(false, ''); return; }
    if (canvasEl && state === 'off') {
      canvasEl.style.display = '';
      document.body.classList.add('ns-voxel-on');
      syncCanvasBox();
      state = 'on';
      onDone && onDone(true, '');
      return;
    }
    V.enable(onDone);
  };

})(NS);
