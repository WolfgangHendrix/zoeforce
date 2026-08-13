/* core.js — constants, math helpers, input, entity pool base.
   Everything hangs off the global NS namespace so the game runs from file://
   with plain <script> tags (no bundler, no module server needed). */
var NS = window.NS || {};
window.NS = NS;

/* ---- screen / timing --------------------------------------------------
   Two resolutions, deliberately separate:

   NS.W/NS.H is the *simulation* resolution — 256x224, NES-ish. Every
   hitbox, sprite, terrain column and speed constant in the game is
   expressed in these units, and none of that changes no matter how the
   game is presented. It is also exactly how much of the corridor you can
   see, so it is a gameplay constant, not a display one.

   NS.SCREEN_W/H is the *presentation* target: a native 1920x1080 frame
   that is then scaled dynamically to whatever window or device it lands
   in. The 2D renderer letterboxes the sim into it; the voxel renderer
   fills it with 3D framing instead. */
NS.W = 256;           // simulation width  (also the visible corridor window)
NS.H = 224;           // simulation height
NS.SCREEN_W = 1920;   // native presentation resolution
NS.SCREEN_H = 1080;
NS.HUD_H = 16;        // reserved strip at the bottom for the power meter
NS.PLAYFIELD_H = NS.H - NS.HUD_H;
NS.FPS = 60;
NS.DT = 1 / NS.FPS;

/* Stage scroll speed in pixels per frame. Life Force stage 1 is a slow,
   steady crawl; speed-ups only affect the ship, never the scroll. */
/* The NES Cell Stage runs from entry to Stage 2 in about 3:48. With the
   8,600px authored approach and the boss fight, 0.68px/frame reproduces
   that presentation pace instead of reaching Golem roughly a minute early. */
NS.SCROLL_SPEED = 0.68;

/* ---- theming ----------------------------------------------------------
   All player-visible naming lives here so the Life Force base can be
   reskinned to the Zoe Force IP without touching game logic. */
NS.THEME = {
  title: 'ZOE FORCE',
  subtitle: 'SIX TERROR ZONES',
  shipName: 'ZF-01 SERAPH',
  stage1Name: 'BIO-CATHEDRAL',
  bossName: 'GOLEM OSSUARY',
  stage2Name: 'VOLCANIC ASCENT',
  boss2Name: 'CRUISER TETRAN',
  stage3Name: 'PROMINENCE INFERNO',
  boss3Name: 'INTRUDER',
  stage4Name: 'CELLULAR CURRENT',
  boss4Name: 'GIGA',
  stage5Name: 'LATIS TEMPLE',
  boss5Name: 'TUTANHAMANATTACK',
  stage6Name: 'MECHANICAL CITY',
  boss6Name: 'ZELOS FORCE',
  prologue: 'THE YEAR IS ALWAYS NOW.  THE FUTURE IS LATE.',
  stageStories: [
    null,
    ['THE GALAXY HAS A HEART CONDITION.', 'ZOE HAS AN APPOINTMENT.'],
    ['THE PLANET BOILS.', 'MANAGEMENT CALLS IT GROWTH.'],
    ['THE SUN IS ON STRIKE.', 'THE FLAMES ARE NOT.'],
    ['PROGRESS RUSHES THROUGH EVERY VEIN.', 'NOBODY ASKED WHERE.'],
    ['THE OLD GODS HAVE REBRANDED.', 'THE RENT REMAINS DUE.'],
    ['THE MACHINE PROMISED TOMORROW.', 'IT DELIVERED MORE MACHINE.']
  ],
  epilogue: ['THE UNIVERSE IS SAVED.', 'MONDAY REMAINS.']
};

/* Accessibility is owned by the director, but renderers load before it and
   need one stable question to ask. Keeping the fallback false also makes the
   individual modules safe during the boot queue. */
NS.reducedFlash = function () {
  return !!(NS.Game && NS.Game.settings && NS.Game.settings.reducedFlash);
};
NS.reducedMotion = function () {
  return !!(NS.Game && NS.Game.settings && NS.Game.settings.reducedMotion);
};
NS.projectileContrast = function () {
  return !!(NS.Game && NS.Game.settings && NS.Game.settings.projectileContrast);
};

/* One damage-feedback contract shared by every stage. Gameplay owns the
   short timer; renderers decide how to display it and honor Reduced Flash. */
NS.DAMAGE_FLASH_FRAMES = 5;
NS.DAMAGE_FLASH_COLOR = '#ff3038';
NS.flashDamage = function (target) {
  if (target) target.hitFlash = NS.DAMAGE_FLASH_FRAMES;
};
NS.tickDamageFlash = function (target) {
  if (target && target.hitFlash > 0) target.hitFlash--;
  if (target && target.hitKick > 0) target.hitKick--;
};
NS.damageFlashing = function (target) {
  return !!(target && target.hitFlash > 0 && !NS.reducedFlash());
};
NS.hitOffset = function (target) {
  if (!target || !target.hitKick || NS.reducedMotion()) return { x: 0, y: 0 };
  var k = target.hitKick / 4;
  return {
    x: (target.hitKickX == null ? -1 : target.hitKickX) * k,
    y: (target.hitKickY == null ? 0 : target.hitKickY) * k
  };
};

/* ---- math ------------------------------------------------------------- */
NS.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
NS.lerp = function (a, b, t) { return a + (b - a) * t; };
NS.sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };
NS.dist2 = function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

NS.rectHit = function (a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
};

/* deterministic RNG so the stage layout is identical every run */
NS.makeRng = function (seed) {
  var s = seed >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};

/* angle helpers — enemies aim at the player a lot in this stage */
NS.angleTo = function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); };

/* ---- input ------------------------------------------------------------
   Three sources feed one state: the keyboard, the on-screen touch pad, and
   (for movement) an analog stick. Buttons are digital and merge by OR;
   movement is analog, with the keyboard taking precedence when both are
   active so a stray thumb never fights the arrow keys. */
NS.Input = (function () {
  var down = {}, vdown = {}, pdown = {}, pressed = {};
  var stick = { x: 0, y: 0 };
  var padStick = { x: 0, y: 0 };
  var activePad = '';
  var activity = 0;
  var capture = null;
  var ACTIONS = ['up', 'down', 'left', 'right', 'fire', 'power', 'pause', 'firemode'];
  var DEFAULT_KEYS = {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    fire: 'KeyZ', power: 'KeyX', pause: 'KeyP', firemode: 'KeyM'
  };
  var DEFAULT_PAD = {
    up: 12, down: 13, left: 14, right: 15,
    fire: 0, power: 1, pause: 9, firemode: 8
  };
  var keys = {}, padMap = {}, MAP = {};

  function cloneDefaults() {
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i]; keys[a] = DEFAULT_KEYS[a]; padMap[a] = DEFAULT_PAD[a];
    }
  }
  function rebuildMap() {
    MAP = {
      Enter: 'start', KeyF: 'fullscreen', KeyR: 'restart',
      KeyT: 'touchpad', KeyV: 'voxel'
    };
    for (var i = 0; i < ACTIONS.length; i++) MAP[keys[ACTIONS[i]]] = ACTIONS[i];
    /* Keep the original convenience layout until that action is explicitly
       rebound. This preserves WASD/J/K/Space for returning players without
       creating invisible secondary bindings after they customize a key. */
    if (keys.left === DEFAULT_KEYS.left) MAP.KeyA = 'left';
    if (keys.right === DEFAULT_KEYS.right) MAP.KeyD = 'right';
    if (keys.up === DEFAULT_KEYS.up) MAP.KeyW = 'up';
    if (keys.down === DEFAULT_KEYS.down) MAP.KeyS = 'down';
    if (keys.fire === DEFAULT_KEYS.fire) { MAP.KeyJ = 'fire'; MAP.Space = 'fire'; }
    if (keys.power === DEFAULT_KEYS.power) { MAP.KeyK = 'power'; MAP.ShiftLeft = 'power'; }
  }
  cloneDefaults(); rebuildMap();

  function assignUnique(map, action, value) {
    var old = map[action];
    for (var i = 0; i < ACTIONS.length; i++) {
      var other = ACTIONS[i];
      if (other !== action && map[other] === value) { map[other] = old; break; }
    }
    map[action] = value;
  }

  window.addEventListener('keydown', function (e) {
    if (capture && capture.device === 'keyboard') {
      e.preventDefault();
      if (e.code === 'Escape') { var cancel = capture.done; capture = null; cancel(false); return; }
      assignUnique(keys, capture.action, e.code);
      rebuildMap();
      var done = capture.done; capture = null; activity++; done(true); return;
    }
    var k = MAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (!down[k]) pressed[k] = true;
    down[k] = true;
    activity++;
  });
  window.addEventListener('keyup', function (e) {
    var k = MAP[e.code];
    if (!k) return;
    e.preventDefault();
    down[k] = false;
    activity++;
  });
  window.addEventListener('blur', function () {
    down = {}; vdown = {}; pdown = {}; pressed = {};
    stick.x = stick.y = 0;
    padStick.x = padStick.y = 0;
  });

  function padButton(pad, index) {
    var b = pad && pad.buttons && pad.buttons[index];
    return !!b && (b.pressed || b.value > 0.5);
  }
  function padAction(pad, action) {
    if (padButton(pad, padMap[action])) return true;
    if (action === 'fire' && padMap.fire === DEFAULT_PAD.fire)
      return padButton(pad, 2) || padButton(pad, 7);
    if (action === 'power' && padMap.power === DEFAULT_PAD.power)
      return padButton(pad, 3) || padButton(pad, 4) || padButton(pad, 5);
    return false;
  }

  function setPadButton(action, value) {
    value = !!value;
    if (value && !pdown[action]) pressed[action] = true;
    pdown[action] = value;
  }

  function clearPad() {
    pdown = {};
    padStick.x = padStick.y = 0;
    activePad = '';
  }

  /* Poll once per simulation frame. Xbox 360 controllers expose the W3C
     "standard" layout in current browsers: left stick axes 0/1, A/B/X/Y
     buttons 0..3, Back/Start 8/9, stick clicks 10/11 and D-pad 12..15. */
  function pollGamepads() {
    if (!navigator.getGamepads) { clearPad(); return; }
    var pads;
    try { pads = navigator.getGamepads(); } catch (e) { clearPad(); return; }
    var pad = null;
    for (var i = 0; pads && i < pads.length; i++) {
      if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
    }
    if (!pad) { clearPad(); return; }
    activePad = pad.id || 'GAMEPAD';

    if (capture && capture.device === 'gamepad') {
      var any = -1;
      for (var ci = 0; ci < pad.buttons.length; ci++) if (padButton(pad, ci)) { any = ci; break; }
      if (!capture.armed) { if (any < 0) capture.armed = true; }
      else if (any >= 0) {
        assignUnique(padMap, capture.action, any);
        var done = capture.done; capture = null; activity++; done(true);
      }
      /* Capture owns the controller until it completes; the selected button
         must not also navigate, pause or fire in the same simulation tick. */
      pdown = {}; padStick.x = padStick.y = 0;
      return;
    }

    /* Radial dead zone prevents worn Xbox sticks from moving the ship while
       still preserving fine analog control immediately outside the zone. */
    var x = pad.axes && pad.axes.length > 0 ? pad.axes[0] : 0;
    var y = pad.axes && pad.axes.length > 1 ? pad.axes[1] : 0;
    var mag = Math.sqrt(x * x + y * y);
    var dead = 0.20;
    if (mag <= dead) {
      padStick.x = padStick.y = 0;
    } else {
      var scaled = Math.min(1, (mag - dead) / (1 - dead)) / mag;
      padStick.x = x * scaled;
      padStick.y = y * scaled;
    }

    setPadButton('left',  padButton(pad, padMap.left));
    setPadButton('right', padButton(pad, padMap.right));
    setPadButton('up',    padButton(pad, padMap.up));
    setPadButton('down',  padButton(pad, padMap.down));
    setPadButton('fire', padAction(pad, 'fire'));
    setPadButton('power', padAction(pad, 'power'));
    setPadButton('firemode', padAction(pad, 'firemode'));
    setPadButton('voxel', padButton(pad, 11));         // right-stick click

    /* Start begins/continues on menus and pauses during play. Both actions
       receive the edge; the game state consumes only the relevant one. */
    var start = padButton(pad, padMap.pause);
    setPadButton('start', start);
    setPadButton('pause', start);
  }

  return {
    held: function (k) { return !!down[k] || !!vdown[k] || !!pdown[k]; },
    /* true only on the frame the key went down */
    hit: function (k) { return !!pressed[k]; },
    endFrame: function () { pressed = {}; },

    /* on-screen buttons call this; it synthesises the same press edge that
       a real key does, so hit() works identically for touch */
    setVirtual: function (k, v) {
      v = !!v;
      if (v && !vdown[k]) { pressed[k] = true; activity++; }
      vdown[k] = v;
    },

    /* analog thumbstick, components already clamped to the unit circle */
    setStick: function (x, y) { stick.x = x; stick.y = y; },

    pollGamepads: pollGamepads,
    gamepadName: function () { return activePad; },
    actions: function () { return ACTIONS.slice(); },
    binding: function (action, device) { return device === 'gamepad' ? padMap[action] : keys[action]; },
    matchesKey: function (action, code) { return MAP[code] === action; },
    bindingLabel: function (action, device) {
      if (device === 'gamepad') {
        var names = ['A','B','X','Y','LB','RB','LT','RT','BACK','START','LS','RS','UP','DOWN','LEFT','RIGHT'];
        return names[padMap[action]] || ('B' + padMap[action]);
      }
      return (keys[action] || '').replace(/^Arrow/, '').replace(/^Key/, '').replace(/^Digit/, '');
    },
    beginCapture: function (action, device, done) {
      capture = { action: action, device: device, done: done || function () {}, armed: device !== 'gamepad' };
      if (device === 'gamepad') capture.armed = false;
    },
    capturing: function () { return capture; },
    cancelCapture: function () { if (capture) { var done = capture.done; capture = null; done(false); } },
    resetBindings: function () { cloneDefaults(); rebuildMap(); },
    exportBindings: function () { return JSON.stringify({ keys: keys, pad: padMap }); },
    importBindings: function (raw) {
      try {
        var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!data) return false;
        for (var i = 0; i < ACTIONS.length; i++) {
          var a = ACTIONS[i];
          if (data.keys && typeof data.keys[a] === 'string') keys[a] = data.keys[a];
          if (data.pad && isFinite(data.pad[a])) padMap[a] = data.pad[a] | 0;
        }
        rebuildMap(); return true;
      } catch (e) { return false; }
    },
    activity: function () { return activity; },
    activeNow: function () {
      var a = this.axis();
      if (Math.abs(a.x) > 0.2 || Math.abs(a.y) > 0.2) return true;
      for (var k in pressed) if (pressed[k]) return true;
      return false;
    },
    rumble: function (weak, strong, ms) {
      if (!navigator.getGamepads) return false;
      var pads;
      try { pads = navigator.getGamepads(); } catch (e) { return false; }
      var pad = null;
      for (var i = 0; pads && i < pads.length; i++) if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
      if (!pad) return false;
      var actuator = pad.vibrationActuator || (pad.hapticActuators && pad.hapticActuators[0]);
      if (!actuator) return false;
      try {
        var request;
        if (actuator.playEffect) request = actuator.playEffect('dual-rumble', {
          duration: ms || 80, strongMagnitude: NS.clamp(strong || 0, 0, 1),
          weakMagnitude: NS.clamp(weak || 0, 0, 1), startDelay: 0
        });
        else if (actuator.pulse) request = actuator.pulse(Math.max(weak || 0, strong || 0), ms || 80);
        else return false;
        /* Some browsers expose the API but reject individual effects. That
           is still a normal no-haptics fallback, not an unhandled error. */
        if (request && request.catch) request.catch(function () {});
        return true;
      } catch (e) { return false; }
    },

    /* Unified movement axis. Digital keys resolve to a normalised diagonal
       so keyboard play is unchanged; otherwise the analog stick is used. */
    axis: function () {
      var dx = 0, dy = 0;
      if (down.left || vdown.left || pdown.left) dx -= 1;
      if (down.right || vdown.right || pdown.right) dx += 1;
      if (down.up || vdown.up || pdown.up) dy -= 1;
      if (down.down || vdown.down || pdown.down) dy += 1;
      if (dx || dy) {
        if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
        return { x: dx, y: dy };
      }
      if (stick.x || stick.y) return { x: stick.x, y: stick.y };
      return { x: padStick.x, y: padStick.y };
    }
  };
})();

/* ---- tiny entity list -------------------------------------------------
   Entities are plain objects with .dead; lists are compacted each frame. */
NS.prune = function (list) {
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    if (!list[i].dead) list[n++] = list[i];
  }
  list.length = n;
};

NS.forEachAlive = function (list, fn) {
  for (var i = 0; i < list.length; i++) {
    if (!list[i].dead) fn(list[i], i);
  }
};
