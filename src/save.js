/* save.js — persistence, and the small piece of UI that admits it happened.

   Everything the game keeps between runs is a localStorage write: the high
   score and the fire mode. Those writes are instant, so nothing here is
   waiting on I/O — but a save the player never sees is a save the player does
   not trust, and "did that record?" is a bad question to leave unanswered.
   So each write raises a throbber in the corner for a moment.

   write() is the only way to persist, deliberately. A call site that reaches
   for localStorage directly gets no throbber and no failure handling, which
   is exactly the drift this wrapper exists to prevent. */
(function (NS) {
  'use strict';

  var S = {};
  NS.Save = S;

  var HOLD = 78;              // frames the notice stays up after a write
  var notice = null;          // { label, t, failed }

  /* Persist one value. `label` is what the player is told is being saved. */
  S.write = function (key, value, label) {
    var ok = true;
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {
      /* private browsing, a full quota, or storage disabled entirely — the
         run is unaffected, but say so rather than pretending it saved */
      ok = false;
    }
    notice = { label: label || 'SAVED', t: 0, failed: !ok };
    return ok;
  };

  S.read = function (key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  };

  S.update = function () {
    if (!notice) return;
    notice.t++;
    if (notice.t > HOLD) notice = null;
  };

  S.busy = function () { return !!notice; };

  /* ---- the throbber ----------------------------------------------------
     Bottom-right of the playfield, which is the one corner with nothing else
     in it: the boss bar stops at x=196 and the HUD strip starts below. */
  S.draw = function (g) {
    if (!notice) return;

    var x = NS.W - 10, y = NS.PLAYFIELD_H - 9;   // ring reaches 5px, so keep it off the edge
    /* fade out over the last third rather than vanishing mid-word */
    var k = notice.t / HOLD;
    g.globalAlpha = k > 0.66 ? Math.max(0, 1 - (k - 0.66) / 0.34) : 1;

    if (notice.failed) {
      /* a cross, held still — a spinner would imply it was still trying */
      g.fillStyle = '#ff8080';
      g.fillRect(x - 3, y - 3, 6, 1);
      g.fillRect(x - 1, y - 5, 1, 6);
    } else {
      /* eight cubes on a ring with a bright head chasing round them —
         no arcs and no easing, so it belongs to the same art as the rest */
      var TAU = Math.PI * 2;
      var head = (notice.t * 0.17) % TAU;
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * TAU;
        /* how far this cube sits behind the head, 0 at the head to 1 just
           ahead of it, which is what gives the trail its direction */
        var behind = (((head - a) % TAU) + TAU) % TAU / TAU;
        var lit = 1 - behind;
        g.fillStyle = lit > 0.80 ? '#eaf6ff'
                    : (lit > 0.45 ? '#9fe8ff' : '#2f5a80');
        g.fillRect((x + Math.cos(a) * 4) | 0, (y + Math.sin(a) * 4) | 0, 2, 2);
      }
    }

    g.font = '5px monospace';
    g.textAlign = 'right';
    g.fillStyle = notice.failed ? '#ff8080' : '#8fd0ff';
    g.fillText(notice.failed ? notice.label + ' NOT SAVED' : notice.label,
               x - 8, y + 2);
    g.textAlign = 'left';
    g.font = '6px monospace';
    g.globalAlpha = 1;
  };

  S.reset = function () { notice = null; };

})(NS);
