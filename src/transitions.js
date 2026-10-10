/* Freeze only while a new screen crossfades in. No gameplay geometry changes. */
(function (NS) {
  'use strict';
  var T = NS.Transitions = { remaining: 0, duration: 0, release: false };
  var previous = document.createElement('canvas');
  previous.width = NS.SCREEN_W; previous.height = NS.SCREEN_H;
  var ctx = previous.getContext('2d');
  T.key = function (G) {
    if (G.state === 'title') return 'title:' + G.titleMenu.screen + ':' + !!G.titleMenu.profileConfirm;
    if (G.state === 'paused') return 'paused:' + (G.pause.submenu || 'main') + ':' + !!G.pause.confirm;
    if (G.state === 'play' || G.state === 'dying' || G.state === 'departing') return 'world:' + G.stage;
    return G.state;
  };
  T.observe = function (before, G, buffer) {
    var after = T.key(G); if (before === after) return;
    T.duration = NS.reducedMotion() ? 0 : before.indexOf('world:') === 0 || after.indexOf('world:') === 0 ? 24 : 12;
    T.remaining = T.duration; T.release = true;
    ctx.clearRect(0, 0, previous.width, previous.height); ctx.drawImage(buffer, 0, 0);
  };
  T.tick = function (G, I) {
    if (T.remaining > 0) { T.remaining--; return true; }
    if (T.release) {
      var menu = G.state !== 'play' && G.state !== 'dying' && G.state !== 'departing';
      var held = ['fire', 'power', 'pause', 'start', 'enter', 'up', 'down', 'left', 'right'].some(function (a) { return I.held(a); });
      if (menu && held) return true;
      T.release = false;
      /* Discard edges received while the destination was being revealed. */
      I.endFrame();
    }
    return false;
  };
  T.draw = function (g) {
    if (!T.remaining || !T.duration) return;
    var t = T.remaining / T.duration;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = t * t * (3 - 2 * t); g.drawImage(previous, 0, 0); g.restore();
  };
  T.finish = function () { T.remaining = 0; T.release = false; };
})(NS);
