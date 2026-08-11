/* touch.js — on-screen controls for phones and tablets.

   Built on Pointer Events, so it works for touch, pen and mouse alike, and
   supports genuine multi-touch: you can hold a direction, fire, and hit the
   power key with three separate fingers at once.

   Layout is the arcade convention — movement under the left thumb, the two
   action buttons under the right. The stick is "floating": it appears where
   your thumb first lands anywhere in the left zone rather than at a fixed
   spot, which is what makes a virtual stick playable at all.

   Everything here feeds NS.Input, so the rest of the game never learns that
   touch exists. */
(function (NS) {
  'use strict';

  var T = {};
  NS.Touch = T;

  var root = null;
  var visible = false;
  var stickBase = null, stickKnob = null;
  var STICK_RADIUS = 46;      // px from centre to full deflection
  var DEADZONE = 0.16;

  /* pointerId -> what that finger is currently doing */
  var pointers = {};

  /* Can the pad work here at all? */
  T.isSupported = function () {
    return typeof window !== 'undefined' &&
           ('PointerEvent' in window) &&
           (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  };

  /* Should it come up on its own? Only when touch is the *primary* input.
     Plenty of laptops report touch points while being driven by a mouse,
     and covering a third of their screen with thumb furniture is wrong —
     they can still summon the pad with T. */
  T.isPrimary = function () {
    if (!T.isSupported()) return false;
    if (!window.matchMedia) return false;
    return window.matchMedia('(pointer: coarse)').matches &&
           !window.matchMedia('(pointer: fine)').matches;
  };

  /* ---- construction ---------------------------------------------------- */
  function el(cls, text) {
    var d = document.createElement('div');
    d.className = cls;
    if (text) d.textContent = text;
    return d;
  }

  function build() {
    root = el('ns-touch');

    var stickZone = el('ns-stick-zone');
    stickBase = el('ns-stick-base');
    stickKnob = el('ns-stick-knob');
    stickBase.appendChild(stickKnob);
    stickZone.appendChild(stickBase);
    root.appendChild(stickZone);

    var pad = el('ns-pad');
    pad.appendChild(button('ns-btn ns-btn-power', 'POW', 'power'));
    pad.appendChild(button('ns-btn ns-btn-fire', 'FIRE', 'fire'));
    root.appendChild(pad);

    var util = el('ns-util');
    util.appendChild(button('ns-ubtn', 'START', 'start'));
    util.appendChild(button('ns-ubtn', 'MODE', 'firemode'));
    util.appendChild(button('ns-ubtn', 'II', 'pause'));
    root.appendChild(util);

    document.body.appendChild(root);

    stickZone.addEventListener('pointerdown', onStickDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    /* never let a control gesture scroll or zoom the page */
    root.addEventListener('touchmove', function (e) { e.preventDefault(); },
                          { passive: false });
  }

  function button(cls, label, key) {
    var b = el(cls, label);
    b.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      b.classList.add('is-down');
      pointers[e.pointerId] = { kind: 'button', key: key, node: b };
      NS.Input.setVirtual(key, true);
      NS.Audio.resume();
    });
    return b;
  }

  /* ---- the floating stick --------------------------------------------- */
  function onStickDown(e) {
    e.preventDefault();
    var r = root.getBoundingClientRect();
    var cx = e.clientX - r.left, cy = e.clientY - r.top;
    stickBase.style.left = cx + 'px';
    stickBase.style.top = cy + 'px';
    stickBase.classList.add('is-active');
    pointers[e.pointerId] = { kind: 'stick', cx: cx, cy: cy };
    moveStick(e, pointers[e.pointerId]);
    NS.Audio.resume();
  }

  function moveStick(e, p) {
    var r = root.getBoundingClientRect();
    var dx = (e.clientX - r.left) - p.cx;
    var dy = (e.clientY - r.top) - p.cy;
    var len = Math.sqrt(dx * dx + dy * dy);

    /* clamp the knob to the ring, and normalise the reported vector to the
       unit circle so diagonals are not faster than the cardinals */
    var kx = dx, ky = dy;
    if (len > STICK_RADIUS) {
      kx = dx / len * STICK_RADIUS;
      ky = dy / len * STICK_RADIUS;
    }
    stickKnob.style.transform = 'translate(' + kx + 'px,' + ky + 'px)';

    var mag = Math.min(1, len / STICK_RADIUS);
    if (mag < DEADZONE) {
      NS.Input.setStick(0, 0);
    } else {
      /* rescale past the deadzone so the first millimetre of travel is not
         a jump from nothing to a sixth of full speed */
      var scaled = (mag - DEADZONE) / (1 - DEADZONE);
      NS.Input.setStick(dx / len * scaled, dy / len * scaled);
    }
  }

  function onPointerMove(e) {
    var p = pointers[e.pointerId];
    if (!p || p.kind !== 'stick') return;
    e.preventDefault();
    moveStick(e, p);
  }

  function onPointerUp(e) {
    var p = pointers[e.pointerId];
    if (!p) return;
    delete pointers[e.pointerId];
    if (p.kind === 'stick') {
      NS.Input.setStick(0, 0);
      stickKnob.style.transform = 'translate(0,0)';
      stickBase.classList.remove('is-active');
    } else {
      p.node.classList.remove('is-down');
      NS.Input.setVirtual(p.key, false);
    }
  }

  /* ---- visibility ------------------------------------------------------ */
  T.show = function () {
    if (visible) return;
    if (!root) build();
    visible = true;
    root.classList.add('is-on');
    document.body.classList.add('ns-touch-on');
  };

  T.hide = function () {
    if (!visible || !root) return;
    visible = false;
    root.classList.remove('is-on');
    document.body.classList.remove('ns-touch-on');
  };

  T.toggle = function () { visible ? T.hide() : T.show(); return visible; };
  T.visible = function () { return visible; };

  T.init = function () {
    /* Desktop with a mouse stays clean; T summons the pad on demand for
       anyone on a hybrid laptop or a docked tablet. */
    if (T.isPrimary()) T.show();
  };

})(NS);
