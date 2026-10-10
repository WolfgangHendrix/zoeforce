/* Painted presentation only. Simulation sprites remain the source for hitboxes
   and voxel geometry; external images are sampled directly at display resolution. */
(function (NS) {
  'use strict';
  var A = NS.Art = { images: {}, failed: [], loaded: 0, total: 0, ready: false };
  var manifest = NS.ART_MANIFEST;
  var originalDraw = CanvasRenderingContext2D.prototype.drawImage;
  A.active = function () { return A.ready && !(NS.Voxel && NS.Voxel.active()); };
  A.load = function (done) {
    var entries = Object.keys(manifest.images);
    A.total = entries.length;
    var remaining = entries.length;
    function settled() { if (--remaining === 0) { A.ready = true; done(); } }
    entries.forEach(function (id) {
      var img = new Image(), finished = false;
      var timer = setTimeout(function () { finish(false); }, 15000);
      function finish(ok) {
        if (finished) return; finished = true; clearTimeout(timer);
        if (ok) { A.images[id] = img; A.loaded++; } else A.failed.push(id);
        settled();
      }
      img.onload = function () { finish(true); }; img.onerror = function () { finish(false); };
      img.src = 'assets/art/' + manifest.images[id].file;
    });
    if (!remaining) { A.ready = true; done(); }
    function mark(tree, prefix) {
      Object.keys(tree).forEach(function (key) {
        var value = tree[key], id = prefix ? prefix + '.' + key : key;
        if (value instanceof HTMLCanvasElement) {
          /* Aliased ship poses deliberately share one art frame. */
          if (!value.artId) value.artId = id;
          if (id.indexOf('campaignCarrier.') === 0 || id.indexOf('carrier.') === 0) { value.artCarrier = true; value.artHit = false; }
          if (id.indexOf('campaignHit.') === 0) value.artHit = true;
        } else if (value && typeof value === 'object') mark(value, id);
      });
    }
    mark(NS.S, '');
  };
  A.install = function (g) {
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage = function (source) {
      var entry = A.active() && source.artId && manifest.sprites[source.artId];
      if (!entry || !A.images[entry.image]) return originalDraw.apply(g, arguments);
      var args = Array.prototype.slice.call(arguments, 1), dx, dy, dw, dh;
      if (args.length === 2) { dx = args[0]; dy = args[1]; dw = source.width; dh = source.height; }
      else if (args.length === 4) { dx = args[0]; dy = args[1]; dw = args[2]; dh = args[3]; }
      else return originalDraw.apply(g, arguments);
      var rect = entry.rect, image = A.images[entry.image];
      g.save();
      if (source.artFlip) { g.translate(dx + dw, dy); g.scale(-1, 1); dx = dy = 0; }
      if (source.artId === 'flameTop') { g.translate(dx + dw/2, dy + dh/2); g.rotate(-Math.PI/2); dx=-dh/2; dy=-dw/2; var temp=dw; dw=dh; dh=temp; }
      if (source.artHit && !NS.reducedFlash()) g.filter = 'sepia(1) saturate(5) hue-rotate(315deg) brightness(1.5)';
      if (source.artCarrier) { g.shadowColor = '#ffb654'; g.shadowBlur = 10; }
      originalDraw.call(g, image, rect[0], rect[1], rect[2], rect[3], dx, dy, dw, dh);
      g.restore();
    };
  };
  A.image = function (g, id, x, y, w, h) {
    var img = A.images[id]; if (!img) return false;
    originalDraw.call(g, img, x, y, w, h); return true;
  };
  /* A compact painted head marks the original hit area. The dim, tapering
     wake is cosmetic and points opposite velocity in screen coordinates. */
  A.projectile = function (g, p, id, size) {
    if (!A.active() || !A.images[id]) return false;
    var x=p.x, y=p.y, vx=p.vx||0, vy=p.vy||0, speed=Math.sqrt(vx*vx+vy*vy);
    var contrast=NS.projectileContrast();
    g.save();
    if (speed>.05 && !contrast) {
      var length=size*1.35, dx=vx/speed, dy=vy/speed;
      var wake=g.createLinearGradient(x-dx*length,y-dy*length,x,y);
      wake.addColorStop(0,'rgba(240,52,14,0)');wake.addColorStop(1,'rgba(255,139,48,.55)');
      g.strokeStyle=wake;g.lineWidth=size*.35;g.lineCap='round';
      g.beginPath();g.moveTo(x-dx*length,y-dy*length);g.lineTo(x,y);g.stroke();
    }
    if (contrast) {
      g.fillStyle='#080a10';g.beginPath();g.arc(x,y,size/2+1,0,Math.PI*2);g.fill();
      g.strokeStyle='#fff8d4';g.lineWidth=.7;g.beginPath();g.arc(x,y,size/2+.3,0,Math.PI*2);g.stroke();
    }
    g.save();g.translate(x,y);
    if (id==='fireball' && !NS.reducedMotion()) g.rotate((p.t||0)*.035);
    A.image(g,id,-size/2,-size/2,size,size);g.restore();
    // A tiny steady highlight survives downsampling and never strobes.
    g.fillStyle='#fff3cb';g.beginPath();g.arc(x,y,size*.12,0,Math.PI*2);g.fill();
    g.restore();return true;
  };
  A.hud = function (g,y) {
    var img=A.images.hud;if(!img)return;
    var w=img.width,h=img.height;
    /* Refit the three authored frame sections to the actual meter layout. */
    originalDraw.call(g,img,0,0,w*.18,h,0,y,42,NS.HUD_H);
    originalDraw.call(g,img,w*.18,0,w*.635,h,44,y,145,NS.HUD_H);
    originalDraw.call(g,img,w*.815,0,w*.185,h,193,y,63,NS.HUD_H);
  };
  A.background = function (g, stage, scroll) {
    var id = 'stage' + stage, img = A.images[id]; if (!img) return false;
    var vertical = stage === 2 || stage === 4 || stage === 6;
    /* Overscan keeps generated architectural edges offscreen, avoiding a
       visible seam when a non-tileable panorama repeats. Walls supply the
       continuous world-speed motion; the distant panorama pans gently. */
    var drift = NS.reducedMotion() ? 0 : Math.sin(scroll / 1200) * .025;
    g.save();
    g.fillStyle = '#08090c'; g.fillRect(0, 0, NS.W, NS.PLAYFIELD_H);
    g.globalAlpha = 0.72;
    A.image(g,id,-NS.W*.075+(vertical?0:drift*NS.W),-NS.PLAYFIELD_H*.075+(vertical?drift*NS.PLAYFIELD_H:0),NS.W*1.15,NS.PLAYFIELD_H*1.15);
    /* Dark center keeps live fire and silhouettes readable. */
    var shade = g.createRadialGradient(NS.W / 2, 104, 12, NS.W / 2, 104, 150);
    shade.addColorStop(0, 'rgba(4,7,10,.24)'); shade.addColorStop(1, 'rgba(0,0,0,.02)');
    g.fillStyle = shade; g.fillRect(0, 0, NS.W, NS.PLAYFIELD_H); g.restore();
    return true;
  };
  A.terrain = function (g, stage, scroll, edgeAt, horizontal) {
    if (!A.active() || !A.background(g, stage, scroll)) return false;
    var span = horizontal ? NS.W : NS.PLAYFIELD_H, edges = [];
    for (var i = 0; i <= span; i++) edges.push(edgeAt(i));
    g.save(); g.beginPath();
    if (horizontal) {
      g.moveTo(0, 0); g.lineTo(NS.W, 0);
      for (i = span; i >= 0; i--) g.lineTo(i, edges[i].a);
      g.closePath(); g.moveTo(0, NS.PLAYFIELD_H); g.lineTo(NS.W, NS.PLAYFIELD_H);
      for (i = span; i >= 0; i--) g.lineTo(i, edges[i].z);
    } else {
      g.moveTo(0, 0); g.lineTo(0, span);
      for (i = span; i >= 0; i--) g.lineTo(edges[i].a, i);
      g.closePath(); g.moveTo(NS.W, 0); g.lineTo(NS.W, span);
      for (i = span; i >= 0; i--) g.lineTo(edges[i].z, i);
    }
    g.closePath(); g.clip();
    g.fillStyle = '#3c302b'; g.fillRect(0, 0, NS.W, NS.PLAYFIELD_H);
    var wall = A.images['wall' + stage];
    if (wall) {
      /* The texture scrolls at WORLD speed, independently of distant art. */
      var tile = 96, offset = scroll % tile;
      for (var y = -tile; y < NS.PLAYFIELD_H + tile; y += tile) {
        for (var x = -tile; x < NS.W + tile; x += tile) {
          originalDraw.call(g, wall, horizontal ? x - offset : x,
            horizontal ? y : y + offset, tile, tile);
        }
      }
    } else A.image(g, 'stage' + stage, 0, 0, NS.W, NS.PLAYFIELD_H);
    var depth = g.createLinearGradient(0,0, horizontal ? 0 : NS.W, horizontal ? NS.PLAYFIELD_H : 0);
    depth.addColorStop(0,'rgba(0,0,0,.52)'); depth.addColorStop(.3,'rgba(0,0,0,.08)');
    depth.addColorStop(.7,'rgba(0,0,0,.08)'); depth.addColorStop(1,'rgba(0,0,0,.52)');
    g.fillStyle=depth;g.fillRect(0,0,NS.W,NS.PLAYFIELD_H);
    g.restore();
    /* Collision boundaries are traced exactly from the simulation. */
    g.save(); g.lineWidth = 0.65; g.strokeStyle = stage === 2 || stage === 3 ? '#e28654' : '#c5aa93';
    g.shadowColor = stage === 2 || stage === 3 ? '#ff4818' : '#7e282c'; g.shadowBlur = 6;
    for (var side = 0; side < 2; side++) {
      g.beginPath();
      for (i = 0; i <= span; i++) {
        var e = side ? edges[i].z : edges[i].a;
        var px = horizontal ? i : e, py = horizontal ? e : i;
        if (!i) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
    }
    g.restore(); return true;
  };
  A.panel = function (g, x, y, w, h, selected) {
    g.save();
    if (A.images.menuSelected && A.images.menuIdle) {
      A.image(g, selected ? 'menuSelected' : 'menuIdle', x, y, w, h);
      g.restore(); return;
    }
    var grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, selected ? '#3b3027' : '#201b19');
    grad.addColorStop(.45, selected ? '#181b1d' : '#101315');
    grad.addColorStop(1, '#080c10'); g.fillStyle = grad; g.fillRect(x, y, w, h);
    g.lineWidth = 0.45; g.strokeStyle = selected ? '#dcbaa0' : '#776451';
    g.strokeRect(x + .3, y + .3, w - .6, h - .6);
    g.strokeStyle = selected ? '#7bd6ed' : '#34383b'; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    if (selected) {
      g.fillStyle = '#bfeef7'; g.beginPath(); g.moveTo(x + 3, y + h / 2);
      g.lineTo(x + 6, y + h / 2 - 2); g.lineTo(x + 6, y + h / 2 + 2); g.fill();
    }
    g.restore();
  };
  A.titleBackdrop = function (g, full) {
    if (!A.active() || !A.images.title) return false;
    A.image(g, 'title', 0, 0, NS.W, NS.H);
    if (full) A.modal(g, 30, 16, 196, 188);
    else {
      var shade = g.createLinearGradient(30,0,226,0);
      shade.addColorStop(0,'rgba(4,7,10,0)'); shade.addColorStop(.2,'rgba(4,7,10,.63)');
      shade.addColorStop(.8,'rgba(4,7,10,.63)'); shade.addColorStop(1,'rgba(4,7,10,0)');
      g.fillStyle=shade; g.fillRect(30,30,196,174);
    }
    return true;
  };
  A.modal = function (g,x,y,w,h) {
    if (!A.ready) return;
    g.fillStyle='rgba(4,7,10,.88)'; g.fillRect(x+2,y+2,w-4,h-4);
    A.image(g,'modal',x,y,w,h);
  };
  A.block = function (g,x,y,w,h,stage,flash) {
    if (!A.active()) return false;
    g.save();
    if (flash && !NS.reducedFlash()) g.filter='sepia(1) saturate(5) hue-rotate(315deg) brightness(1.5)';
    var drawn=A.image(g,stage===5?'block':'wall'+stage,x,y,w,h);
    g.strokeStyle='#a1856d'; g.lineWidth=.4; g.strokeRect(x,y,w,h); g.restore(); return drawn;
  };
  A.boss = function (g, stage, b) {
    if (!A.active() || !A.images['boss' + stage]) return false;
    if (b.dead && (b.dying >> 2) % 2) return true;
    var kick = NS.hitOffset(b), x = b.x + kick.x, y = b.y + kick.y + (b.bob || 0);
    var dep = b.deploy == null ? 1 : b.deploy;
    var size = stage === 1 ? [66, 84] : stage === 2 ? [44, 44] : stage === 3 ? [56, 76] : stage === 5 ? [34, 50] : [50, 50];
    g.save();
    if (NS.damageFlashing(b)) g.filter = 'sepia(1) saturate(5) hue-rotate(315deg) brightness(1.5)';
    if (stage === 1) {
      var strand = -1, previous = null;
      b.eachTendril(10, function (tx, ty, index) {
        if(index===strand&&previous){var dx=tx-previous.x,dy=ty-previous.y,len=Math.sqrt(dx*dx+dy*dy);g.save();g.translate(previous.x,previous.y);g.rotate(Math.atan2(dy,dx));A.image(g,'tentacleSeg',-.2,-1.3,len+.4,2.6);g.restore();}
        strand=index;previous={x:tx,y:ty};
      });
    }
    if (stage === 2) {
      for (var arm = 0; arm < 4; arm++) {
        var angle = b.spin + arm * Math.PI / 2;
        g.save(); g.translate(x, y); g.rotate(angle);
        A.image(g, 'tetranArm', 6 * dep, -5, 35 * dep, 10); g.restore();
      }
    }
    if (stage === 5 && b.side < 0) {
      g.save(); g.translate(x, y); g.scale(-1, 1);
      A.image(g, 'boss5', -size[0]/2, -size[1]/2, size[0], size[1]); g.restore();
    } else A.image(g, 'boss' + stage, x - size[0]/2 + (stage===1?5.5:0), y - size[1]/2, size[0], size[1]);
    var coreX = x, coreY = y, exposed = true;
    if (stage === 1) exposed = b.eyeOpen > .5;
    if (stage === 2) exposed = !b.shield;
    if (stage === 3) { coreX -= 15; exposed = b.open; }
    if (stage === 4) { coreY += 12; exposed = b.open; }
    if (stage === 5) { coreX -= b.side * 9; coreY -= 5; }
    if (stage === 6 && b.form === 'dragon') {
      var lastSegment=null;
      for (var seg = 0; seg < 18; seg++) {
        var a = seg / 17 * Math.PI * 2 + b.t * .025;
        var sx = x + Math.cos(a) * 48 * dep, sy = y + Math.sin(a * 2) * 40 * dep;
        if(lastSegment){var ddx=sx-lastSegment.x,ddy=sy-lastSegment.y;g.save();g.translate(lastSegment.x,lastSegment.y);g.rotate(Math.atan2(ddy,ddx));A.image(g,'tentacleSeg',-.3,-3.5,Math.sqrt(ddx*ddx+ddy*ddy)+.6,7);g.restore();}
        lastSegment={x:sx,y:sy};
      } coreX = b.dragonX; coreY = b.dragonY;
      A.image(g, 'dragonHead', coreX - 10, coreY - 10, 20, 20);
    }
    A.image(g, exposed ? 'coreOpen' : 'coreClosed', coreX - 7, coreY - 7, 14, 14);
    if(stage===1&&b.eyeOpen>.05){g.save();g.globalAlpha=NS.clamp(b.eyeOpen*1.4,0,1);var aperture=Math.max(2,14*b.eyeOpen);A.image(g,'coreOpen',coreX-7,coreY-aperture/2,14,aperture);g.restore();}
    if (stage === 2 && b.shield) {
      for (var ring = 0; ring < b.shield; ring++) {
        g.strokeStyle = 'rgba(245,144,92,.55)'; g.lineWidth = .7;
        g.beginPath(); g.arc(x, y, 26 + ring * 4, 0, Math.PI * 2); g.stroke();
      }
    }
    if (stage === 4) {
      for(var eyeIndex=0;eyeIndex<b.eyes;eyeIndex++){var eyeSide=b.eyes===2?(eyeIndex?-1:1):1;A.image(g,'coreOpen',x+eyeSide*13-4,y-9,8,8);}
      b.eyeList.forEach(function (eye) { A.image(g, 'coreOpen', eye.x - 5, eye.y - 5, 10, 10); });
    }
    if (stage === 5) for (var orb = 0; orb < 8; orb++) {
      var oa = orb * Math.PI / 4 + b.t * .025;
      A.image(g, 'coreOpen', x + Math.cos(oa) * 29 * dep - 4, y + Math.sin(oa) * 29 * dep - 4, 8, 8);
    }
    if (stage === 1) b.cells.forEach(function (c) { if (!c.dead) g.drawImage(NS.S.cell, c.x - 2, c.y - 2); });
    g.restore(); return true;
  };
})(NS);
