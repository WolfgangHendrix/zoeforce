/* sprites.js — pixel art defined as character grids, baked to offscreen
   canvases once at boot. Swapping art for the Zoe Force reskin means editing
   these grids (and nothing else). '.' = transparent. */
(function (NS) {
  'use strict';

  function bake(rows, pal) {
    var h = rows.length, w = rows[0].length;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    var img = g.createImageData(w, h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ch = rows[y][x];
        var col = pal[ch];
        var i = (y * w + x) * 4;
        if (!col) { img.data[i + 3] = 0; continue; }
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = col.length > 3 ? col[3] : 255;
      }
    }
    g.putImageData(img, 0, 0);
    c.cx = w / 2; c.cy = h / 2;
    return c;
  }
  NS.bake = bake;

  /* recolor a baked sprite (used for flash-on-hit and palette variants) */
  function tint(src, r, g, b, amt) {
    var c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    var img = ctx.getImageData(0, 0, c.width, c.height);
    for (var i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) continue;
      img.data[i] = img.data[i] * (1 - amt) + r * amt;
      img.data[i + 1] = img.data[i + 1] * (1 - amt) + g * amt;
      img.data[i + 2] = img.data[i + 2] * (1 - amt) + b * amt;
    }
    ctx.putImageData(img, 0, 0);
    c.cx = src.cx; c.cy = src.cy;
    return c;
  }
  NS.tint = tint;

  function flipX(src) {
    var c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    var ctx = c.getContext('2d');
    ctx.translate(src.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0);
    c.cx = src.cx; c.cy = src.cy;
    return c;
  }
  NS.flipX = flipX;

  var S = {};
  NS.S = S;

  /* ---------------- player ship ---------------- */
  var shipPal = {
    W: [232, 240, 255], G: [150, 168, 200], D: [70, 88, 124],
    C: [ 90, 220, 255], B: [ 40, 110, 220], R: [255, 120,  60]
  };
  /* Thin side profile: engine at left, pointed nose at right, cockpit above
     the fuselage and a small ventral fin. The former symmetrical silhouette
     read as a top-down ship after voxel extrusion. */
  S.ship = bake([
    '............C.......',
    '...........CWC......',
    '.........DWWWWG.....',
    '...DWWWWWWWWWWWWWWG.',
    'RDWCCBBBCCWWWWWWWWWG',
    '...DWWWWWWWWWWWWWWG.',
    '.........DDWWWG.....',
    '...........DWWD.....',
    '............DD......'
  ], shipPal);

  /* The voxel renderer pitches this model geometrically. Keeping one clean
     side silhouette in 2D avoids swapping back to overhead-looking frames. */
  S.shipUp = S.ship;
  S.shipDown = S.ship;

  /* Stage 2 rotates the presentation overhead. This is a separate top-view
     model rather than rotating the side silhouette into an unreadable slab. */
  S.shipTop = bake([
    '.....W.....',
    '....WWW....',
    '....WCW....',
    '...WCCCW...',
    '...WCCCW...',
    '..DWWBWWD..',
    '..DWWBWWD..',
    '.DWWWGWWWD.',
    '.DWWGGGWWD.',
    'DWWWGGGWWWD',
    '...DWBWD...',
    '...DWBWD...',
    '...DWBWD...',
    '....DRD....',
    '....ROR....',
    '.....R.....'
  ], shipPal);

  function flipYlike(src) {
    var c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    var ctx = c.getContext('2d');
    ctx.translate(0, src.height); ctx.scale(1, -1);
    ctx.drawImage(src, 0, 0);
    c.cx = src.cx; c.cy = src.cy;
    return c;
  }
  NS.flipY = flipYlike;

  /* engine flame, 2 frames */
  var flamePal = { Y: [255, 240, 140], O: [255, 150, 40], R: [230, 60, 30] };
  S.flame = [
    bake([
      '..OY..',
      'ROYYYO',
      '..OY..'
    ], flamePal),
    bake([
      '...OY.',
      'ROYYO.',
      '...OY.'
    ], flamePal)
  ];
  S.flameTop = bake([
    '.Y.',
    'OYO',
    '.R.',
    '.R.'
  ], flamePal);

  /* option / multiple orb */
  var optPal = { A: [255, 230, 120], B: [255, 160, 40], C: [200, 60, 20] };
  S.option = [
    bake([
      '.CBC.',
      'CBABC',
      'BAAAB',
      'CBABC',
      '.CBC.'
    ], optPal),
    bake([
      '.BCB.',
      'BCACB',
      'CAAAC',
      'BCACB',
      '.BCB.'
    ], optPal)
  ];

  /* A dead pilot's Options become neutral green pickups.  They keep the
     same silhouette so players recognise what can be recovered instantly. */
  var looseOptPal = { A: [210, 255, 185], B: [80, 225, 105], C: [20, 120, 65] };
  S.looseOption = [
    bake([
      '.CBC.',
      'CBABC',
      'BAAAB',
      'CBABC',
      '.CBC.'
    ], looseOptPal),
    bake([
      '.BCB.',
      'BCACB',
      'CAAAC',
      'BCACB',
      '.BCB.'
    ], looseOptPal)
  ];

  /* power-up capsule (the classic pulsing red pod) */
  var capPal = { R: [255, 70, 70], D: [150, 20, 20], W: [255, 220, 220] };
  S.capsule = [
    bake([
      '.DDDD.',
      'DRWWRD',
      'DRWWRD',
      'DRRRRD',
      '.DDDD.'
    ], capPal),
    bake([
      '.DDDD.',
      'DRRRRD',
      'DWRRWD',
      'DRRRRD',
      '.DDDD.'
    ], capPal)
  ];
  var crashPal = { R: [70, 175, 255], D: [20, 70, 165], W: [220, 250, 255] };
  S.crashCapsule = [
    bake(['.DDDD.','DRWWRD','DRWWRD','DRRRRD','.DDDD.'], crashPal),
    bake(['.DDDD.','DRRRRD','DWRRWD','DRRRRD','.DDDD.'], crashPal)
  ];

  /* ---------------- shots ---------------- */
  var shotPal = { W: [255, 255, 255], C: [140, 230, 255], B: [60, 140, 255] };
  S.shot = bake([
    'BCWWCB'
  ], shotPal);

  S.missile = bake([
    '.WWC.',
    'BWWWC',
    '.WWC.'
  ], { W: [255, 220, 120], C: [255, 140, 40], B: [220, 60, 30] });

  var eShotPal = { W: [255, 240, 240], R: [255, 90, 90], D: [180, 30, 30] };
  S.eshot = bake([
    '.RR.',
    'RWWR',
    'RWWR',
    '.RR.'
  ], eShotPal);

  /* ---------------- enemies ---------------- */
  /* "flapper" — the small swooping cell-craft that comes in squadrons */
  var flapPal = {
    A: [120, 255, 190], B: [40, 190, 140], C: [20, 110, 90],
    W: [240, 255, 250], R: [255, 80, 80]
  };
  S.flapper = [
    bake([
      '..CBBBC..',
      '.CBAAABC.',
      'CBAWWWABC',
      'CBAWRWABC',
      'CBAWWWABC',
      '.CBAAABC.',
      '..CBBBC..'
    ], flapPal),
    bake([
      '.CCBBBCC.',
      'CBBAAABBC',
      'BAAWWWAAB',
      'BAAWRWAAB',
      'BAAWWWAAB',
      'CBBAAABBC',
      '.CCBBBCC.'
    ], flapPal)
  ];

  /* squadron variant that carries a power capsule (red palette) */
  S.carrier = [
    tint(S.flapper[0], 255, 70, 40, 0.65),
    tint(S.flapper[1], 255, 70, 40, 0.65)
  ];

  /* "mouth" — wall-mounted organic turret that opens and spits */
  var mouthPal = {
    D: [110, 40, 60], M: [190, 80, 100], L: [240, 150, 165],
    W: [255, 235, 235], K: [40, 12, 20]
  };
  S.mouthClosed = bake([
    '..DDMMDD..',
    '.DMMLLMMD.',
    'DMLLLLLLMD',
    'DMLKKKKLMD',
    'DMLLLLLLMD',
    '.DMMLLMMD.',
    '..DDMMDD..'
  ], mouthPal);
  S.mouthOpen = bake([
    '..DDMMDD..',
    '.DMMLLMMD.',
    'DMLKKKKLMD',
    'DKKWWWWKKD',
    'DMLKKKKLMD',
    '.DMMLLMMD.',
    '..DDMMDD..'
  ], mouthPal);

  /* "spore" — slow drifting mine that splits */
  var sporePal = { A: [200, 180, 255], B: [130, 100, 220], C: [70, 45, 140], W: [255, 255, 255] };
  S.spore = bake([
    '.CBBBC.',
    'CBAAABC',
    'BAAWAAB',
    'BAWWWAB',
    'BAAWAAB',
    'CBAAABC',
    '.CBBBC.'
  ], sporePal);

  /* Stages 3–6 used to paint every campaign enemy as the same triangle in
     2D and reuse flapper/spore geometry in voxel mode.  These compact grids
     give each gameplay verb its own silhouette while remaining the single
     source for both renderers. */
  var firePal = { D:[120,30,18], R:[210,55,22], O:[255,125,28], Y:[255,225,105], W:[255,245,210] };
  var cellPal = { D:[70,24,62], P:[145,54,122], L:[224,118,184], W:[255,225,244], K:[60,12,38] };
  var goldPal = { D:[88,59,10], B:[170,111,18], Y:[239,190,54], W:[255,242,168], C:[80,225,255] };
  var mechPal = { D:[31,53,76], B:[52,106,150], C:[72,190,224], W:[210,244,255], O:[255,126,54], K:[12,24,38] };
  var stonePal = { D:[54,49,44], B:[104,93,77], L:[166,148,116], W:[222,205,166], K:[27,24,22], C:[83,218,255] };

  S.campaignEnemy = {
    phoenix: [
      bake(['......Y......','...R.OYO.R...','..ROOYYYOOR..','RROYYYYYYYORR','..ROOYYYOOR..','...R.OYO.R...','......R......'], firePal),
      bake(['..R...Y...R..','.ROO.OYO.OOR.','..ROOYYYOOR..','...OYYYYYO...','..ROOYYYOOR..','.ROO.OYO.OOR.','..R...R...R..'], firePal)
    ],
    cell: [
      bake(['....L.L....','..DLLWLLD..','.DPPWWWPPD.','DPPWKKKWPPD','DPPWKKKWPPD','.DPPWWWPPD.','..DLLWLLD..','....L.L....'], cellPal),
      bake(['...L...L...','..DPLWLPD..','.DPPWWWPPD.','DPLWKKKWLPD','DPLWKKKWLPD','.DPPWWWPPD.','..DPLWLPD..','...L...L...'], cellPal)
    ],
    gold: [
      bake(['.....W.....','..D.WWW.D..','.DBYYYYYBD.','DYYYYYYYYYD','.DBYYYYYBD.','..D.WWW.D..','.....D.....'], goldPal),
      bake(['..D..W..D..','...DWWWD...','.DBYYYYYBD.','DYYYYCYYYYD','.DBYYYYYBD.','...DWWWD...','..D..D..D..'], goldPal)
    ],
    blue: [
      bake(['.....W.....','...BWWWB...','..BCCWCCB..','.BCWWOWWCB.','..BCCWCCB..','...BWWWB...','.....B.....'], mechPal),
      bake(['..B..W..B..','...BWWW.B..','..BCCWCCB..','.BCWWOWWCB.','..BCCWCCB..','..B.WWWB...','..B..B..B..'], mechPal)
    ],
    corpuscle: [bake(['...DDDDD...','.DDRRRRRDD.','DRRWWWWWRRD','DRRWWWWWRRD','.DDRRRRRDD.','...DDDDD...'], {D:[105,20,38],R:[206,48,70],W:[255,142,150]})],
    lung: [bake(['...L...L...','..LPP.PPL..','.LPPWWWPPL.','LPPWKKKWPPL','LPPWKKKWPPL','.LPPWWWPPL.','..LPP.PPL..','...L...L...'], cellPal)],
    nodule: [bake(['....D.D....','..D.PLP.D..','.DPLWWWLPD.','DPLWKKKWLPD','.LWWKKKWWL.','DPLWKKKWLPD','.DPLWWWLPD.','..D.PLP.D..','....D.D....'], cellPal)],
    dragon: [bake(['..........YY.','......RR.OYYO','..RRROOOYYYYY','RROOYYYYWWWYY','..RRROOOYYYYY','......RR.OYYO','..........YY.'], firePal)],
    rock: [bake(['...BBB....','..BLLBB...','.BLLWLB...','BLLWKLLB..','BLLLLLBB..','.BBLLLB...','..BBBB....'], stonePal)],
    hatch: [bake(['DDDDDDDDDDD','DBLLLLLLLBD','DLWDDDDDWLD','DLDCWWWCDLD','DLDCWKKCDLD','DLDCWWWCDLD','DLWDDDDDWLD','DBLLLLLLLBD','DDDDDDDDDDD'], stonePal)],
    block: [bake(['DDDDDDDDDD','DLLLLLLLLD','DLWDDDDWLD','DLDLLLLDLD','DLDLWWLDLD','DLDLLLLDLD','DLWDDDDWLD','DLLLLLLLLD','DDDDDDDDDD'], stonePal)],
    crystal: [bake(['....C....','...CWC...','..CWWWC..','.CWWCWWC.','CWWCKCWWC','.BCWKCWB.','..BWKWB..','...BKB...','....B....'], mechPal)],
    cannon: [bake(['....DDD....','..DBBBBBD..','.DBLWWWLBD.','DBLWCCCWLBD','DBLCKKKCLBD','.DBLWWWLBD.','..DBCCCBD..','...DDBDD...','.....D.....'], mechPal)],
    moai: [
      bake(['...BBBB....','..BLLLLB...','.BLLWWLLB..','.BLWKKWLB..','.BLLLLLLB..','.BLDDDDLB..','.BLDLLDLB..','.BLLWWLLB..','..BLLLLB...','...BBBB....'], stonePal),
      bake(['...BBBB....','..BLLLLB...','.BLLWWLLB..','.BLWKKWLB..','.BLLLLLLB..','.BLDCCDLB..','.BLCKKCLB..','.BLLCCLLB..','..BLLLLB...','...BBBB....'], stonePal)
    ]
  };

  S.campaignCarrier = {};
  S.campaignHit = {};
  for (var campaignKind in S.campaignEnemy) {
    var campaignFrames = S.campaignEnemy[campaignKind];
    if (campaignFrames.length === 1) campaignFrames.push(campaignFrames[0]);
    S.campaignCarrier[campaignKind] = [
      tint(campaignFrames[0], 255, 58, 46, 0.58),
      tint(campaignFrames[1], 255, 58, 46, 0.58)
    ];
    S.campaignHit[campaignKind] = [
      tint(campaignFrames[0], 255, 36, 44, 0.82),
      tint(campaignFrames[1], 255, 36, 44, 0.82)
    ];
  }
  NS.campaignSprite = function (kind, frame, carrier, hit) {
    var table = hit ? S.campaignHit : (carrier ? S.campaignCarrier : S.campaignEnemy);
    var pair = table[kind] || (hit ? S.campaignHit.blue : (carrier ? S.campaignCarrier.blue : S.campaignEnemy.blue));
    return pair[frame & 1];
  };

  /* "ducker" — walks along the flesh floor/ceiling and fires up at you */
  var duckPal = { A: [230, 200, 120], B: [180, 140, 60], C: [110, 80, 30], K: [30, 20, 10], R: [255, 90, 60] };
  S.ducker = [
    bake([
      '..BAAB..',
      '.BAAAAB.',
      'BAAKKAAB',
      'BAKRRKAB',
      'BAAAAAAB',
      'CB.CC.BC',
      'C..CC..C'
    ], duckPal),
    bake([
      '..BAAB..',
      '.BAAAAB.',
      'BAAKKAAB',
      'BAKRRKAB',
      'BAAAAAAB',
      '.CB..BC.',
      '.C....C.'
    ], duckPal)
  ];

  /* boss eye core + shell plate (boss body itself is drawn procedurally) */
  var eyePal = {
    W: [255, 250, 245], R: [220, 40, 50], D: [110, 15, 25],
    K: [20, 8, 12], Y: [255, 210, 120]
  };
  S.bossEye = bake([
    '...DDRRDD...',
    '.DDRRWWRRDD.',
    '.DRWWWWWWRD.',
    'DRWWWKKWWWRD',
    'DRWWKKKKWWRD',
    'RWWWKKKKWWWR',
    'RWWWKKKKWWWR',
    'DRWWKKKKWWRD',
    'DRWWWKKWWWRD',
    '.DRWWWWWWRD.',
    '.DDRRWWRRDD.',
    '...DDRRDD...'
  ], eyePal);
  S.bossEyeHit = tint(S.bossEye, 255, 255, 255, 0.7);

  /* boss "cell" spawn — the little orbiting blobs Golem coughs up */
  S.cell = bake([
    '.BBB.',
    'BAWAB',
    'BWWWB',
    'BAWAB',
    '.BBB.'
  ], { A: [255, 150, 160], B: [190, 60, 80], W: [255, 240, 240] });

  /* prominence flame particle (the erupting fire arcs of stage 1) */
  var promPal = { Y: [255, 240, 160], O: [255, 160, 50], R: [235, 70, 40], D: [140, 30, 20] };
  S.prom = [
    bake([
      '.OYO.',
      'OYYYO',
      'RYYYR',
      'ROYOR',
      '.RDR.'
    ], promPal),
    bake([
      '.RYR.',
      'ROYOR',
      'OYYYO',
      'ROYOR',
      '.DRD.'
    ], promPal)
  ];

  /* "rusher" — the fast dart that arrives in tight arrowhead formations */
  var rushPal = {
    A: [255, 220, 140], B: [230, 150, 60], C: [150, 80, 25],
    W: [255, 255, 240], K: [50, 25, 10]
  };
  S.rusher = [
    bake([
      '..CBBB..',
      '.CBAAAB.',
      'CBAWWKAB',
      '.CBAAAB.',
      '..CBBB..'
    ], rushPal),
    bake([
      '.CCBBBC.',
      'CBBAAABB',
      'BAAWWKAB',
      'CBBAAABB',
      '.CCBBBC.'
    ], rushPal)
  ];

  /* "splitter" — the dividing cell of the organic stage. Killing the large
     one releases two small ones, exactly like the amoebae in Life Force. */
  var splitPal = {
    A: [190, 255, 220], B: [90, 210, 170], C: [30, 120, 100],
    N: [255, 240, 180], K: [15, 60, 50]
  };
  S.splitterBig = [
    bake([
      '..CBBBC..',
      '.CBAAABC.',
      'CBAANAABC',
      'BAANNNAAB',
      'BANNKNNAB',
      'BAANNNAAB',
      'CBAANAABC',
      '.CBAAABC.',
      '..CBBBC..'
    ], splitPal),
    bake([
      '..CBBBC..',
      '.CBBABBC.',
      'CBAANAABC',
      'BAANKNAAB',
      'BAKNNNKAB',
      'BAANKNAAB',
      'CBAANAABC',
      '.CBBABBC.',
      '..CBBBC..'
    ], splitPal)
  ];
  S.splitterSmall = [
    bake([
      '.CBC.',
      'CBABC',
      'BANAB',
      'CBABC',
      '.CBC.'
    ], splitPal),
    bake([
      '.CBC.',
      'CBNBC',
      'BNANB',
      'CBNBC',
      '.CBC.'
    ], splitPal)
  ];

  /* "hatch" — wall pod that cracks open and disgorges a rusher flight */
  var hatchPal = {
    D: [90, 45, 70], M: [165, 85, 115], L: [225, 160, 185],
    K: [25, 10, 18], W: [255, 240, 245], R: [255, 110, 110]
  };
  S.hatchClosed = bake([
    '.DDMMMMDD.',
    'DMLLLLLLMD',
    'DMLLWWLLMD',
    'DMLLLLLLMD',
    'DMMLLLLMMD',
    '.DDMMMMDD.'
  ], hatchPal);
  S.hatchOpen = bake([
    '.DDMMMMDD.',
    'DMLLKKLLMD',
    'DKKKRRKKKD',
    'DKKKRRKKKD',
    'DMLLKKLLMD',
    '.DDMMMMDD.'
  ], hatchPal);

  /* "tentacle" — wall-anchored whip that lashes across the corridor.
     Root is the vulnerable part; the arm segments are pure hazard. */
  var tentPal = {
    A: [255, 170, 200], B: [200, 90, 130], C: [130, 45, 80],
    K: [60, 18, 40], W: [255, 235, 245]
  };
  S.tentacleRoot = [
    bake([
      '.CBBBBC.',
      'CBAAAABC',
      'BAAWWAAB',
      'BAAKKAAB',
      'CBAAAABC',
      '.CBBBBC.'
    ], tentPal),
    bake([
      '.CBBBBC.',
      'CBBAABBC',
      'BAAKKAAB',
      'BAAWWAAB',
      'CBBAABBC',
      '.CBBBBC.'
    ], tentPal)
  ];
  S.tentacleSeg = bake([
    '.BBB.',
    'BAWAB',
    'BAAAB',
    '.BBB.'
  ], tentPal);
  S.tentacleTip = bake([
    '.CBC.',
    'CBWBC',
    'BWWWB',
    'CBWBC',
    '.CBC.'
  ], tentPal);

})(NS);
