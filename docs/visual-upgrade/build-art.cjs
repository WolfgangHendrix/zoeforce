/* Slice authored atlases into replaceable PNGs. No game bundler required. */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const ART = path.join(ROOT, 'assets/art');
const sharp = require(require.resolve('sharp', { paths: [path.resolve(ROOT, '../SpaceChakra')] }));
const manifest = { version: 1, simulation: { width: 256, height: 224, playfieldHeight: 208 }, images: {}, sprites: {}, stages: [] };
async function image(id, file, role) {
  const m = await sharp(path.join(ART, file)).metadata();
  manifest.images[id] = { file, width: m.width, height: m.height, role, alpha: !!m.hasAlpha };
}
async function atlas(file, columns, rows, targets, transparent = true) {
  const source = path.join(ART, 'sources', file);
  const m = await sharp(source).metadata();
  for (let i = 0; i < targets.length; i++) {
    const [id, output, role] = targets[i], col = i % columns, row = Math.floor(i / columns);
    const custom = targets[i][3];
    const left = custom ? Math.floor(custom[0]*m.width) : Math.floor(col * m.width / columns);
    const top = custom ? Math.floor(custom[1]*m.height) : Math.floor(row * m.height / rows);
    const width = custom ? Math.floor(custom[2]*m.width) : Math.floor((col + 1) * m.width / columns) - left;
    const height = custom ? Math.floor(custom[3]*m.height) : Math.floor((row + 1) * m.height / rows) - top;
    let tile = sharp(source).extract({ left, top, width, height });
    if (transparent) {
      const { data, info } = await tile.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let x0 = width, y0 = height, x1 = -1, y1 = -1, opaque = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * info.channels + 3] > 12) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); opaque++;
        }
      }
      if (!opaque || opaque > width * height * .95) throw Error('Missing transparency or empty sprite: ' + id);
      x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2);
      x1 = Math.min(width - 1, x1 + 2); y1 = Math.min(height - 1, y1 + 2);
      tile = sharp(data, { raw: info }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
    }
    await tile.png().toFile(path.join(ART, output));
    await image(id, output, role);
  }
}
async function main() {
  const names = ['bio-cathedral', 'volcanic-ascent', 'prominence-inferno', 'cellular-current', 'latis-temple', 'mechanical-city'];
  const bosses = ['golem-ossuary','cruiser-tetran','intruder','giga','tutanhamanattack','zelos-force'];
  for (let i = 0; i < names.length; i++) {
    await image('stage' + (i + 1), `backgrounds/stage-0${i + 1}-${names[i]}.png`, 'Distant environment / stage concept');
    manifest.stages.push({ stage: i + 1, name: names[i], orientation: [2,4,6].includes(i + 1) ? 'vertical' : 'side', background: 'stage' + (i+1), wall: 'wall' + (i+1), boss: 'boss' + (i+1) });
  }
  await image('title', 'ui/title-background.png', 'Clean menu environment');
  await sharp(path.join(ART,'sources/title-logo.png')).trim({background:'#00000000',threshold:5}).png().toFile(path.join(ART,'ui/title-logo.png'));
  await image('logo', 'ui/title-logo.png', 'Approved title wordmark');
  await atlas('player-sheet.png',3,3,[
    ['ship','player/seraph-side.png','Ship nose screen-right'],['shipTop','player/seraph-top.png','Ship nose screen-up'],['flame','player/engine-cyan.png','Cyan exhaust toward screen-left'],
    ['option','player/option-drone.png','Friendly support drone'],['capsule','player/power-capsule.png','Power pickup'],['shot','player/bolt-cyan.png','Friendly energy bolt'],
    ['missile','player/missile.png','Friendly missile'],['eshot','enemies/hostile-orb.png','Hostile red-orange fire'],['crashCapsule','player/crash-capsule.png','Crash pickup']
  ]);
  const enemyNames = ['flapper','ducker','mouthClosed','mouthOpen','spore','phoenix','cellEnemy','gold','blue','corpuscle','lung','nodule','dragon','rock','hatch','cannon'];
  await atlas('enemy-sheet.png',4,4,enemyNames.map(n=>[n,'enemies/'+n+'.png','Enemy silhouette']));
  await atlas('boss-sheet.png',3,3,[
    ...bosses.map((n,i)=>['boss'+(i+1),'bosses/stage-0'+(i+1)+'-'+n+'.png','Boss body; core rendered separately']),
    ['coreOpen','bosses/core-open.png','Exposed weak point'],['coreClosed','bosses/core-closed.png','Armored weak point'],['tetranArm','bosses/tetran-arm.png','Rotating arm']
  ]);
  await atlas('detail-sheet.png',3,3,[
    ['moaiClosed','enemies/moai-closed.png','Closed head turret'],['moaiOpen','enemies/moai-open.png','Open head turret'],['crystal','enemies/crystal.png','Crystal'],
    ['block','terrain/temple-block.png','Destructible masonry'],['tentacleRoot','enemies/tentacle-root.png','Vulnerable tentacle root'],['tentacleSeg','enemies/tentacle-segment.png','Tentacle hazard segment'],
    ['splitterBig','enemies/splitter-large.png','Large dividing cell'],['splitterSmall','enemies/splitter-small.png','Small dividing cell'],['prom','enemies/prominence.png','Fire hazard']
  ]);
  await atlas('terrain-sheet.png',3,2,names.map((n,i)=>['wall'+(i+1),'terrain/stage-0'+(i+1)+'-'+n+'.png','Opaque world-speed wall texture']),false);
  await atlas('ui-sheet.png',2,2,[
    ['menuSelected','ui/menu-selected.png','Selected menu frame',[0,0,.5,.265]],['menuIdle','ui/menu-idle.png','Idle menu frame',[.5,0,.5,.265]],
    ['hud','ui/hud-frame.png','Blank score / five slots / stats frame',[0,.265,1,.218]],['modal','ui/modal-frame.png','Blank dialog frame',[0,.483,1,.517]]
  ]);
  /* Sprite logical size, anchor and collision rules stay in the original game.
     Artists can replace a single image; multiple original variants share it. */
  const originals = JSON.parse(fs.readFileSync(path.join(__dirname,'reference/sprite-index.json'),'utf8'));
  for (const sprite of originals) {
    let n = sprite.id.split('.')[0], kind = sprite.id.split('.')[1];
    if (/^campaign(Enemy|Carrier|Hit)$/.test(n)) {
      n = kind === 'cell' ? 'cellEnemy' : kind === 'moai' ? (sprite.id.endsWith('.1') ? 'moaiOpen' : 'moaiClosed') : kind;
    }
    const aliases = { shipUp:'ship',shipDown:'ship',flameTop:'flame',looseOption:'option',carrier:'flapper',cell:'cellEnemy',bossEye:'coreOpen',bossEyeHit:'coreOpen',rusher:'blue',hatchClosed:'hatch',hatchOpen:'hatch',tentacleTip:'splitterSmall' };
    n = aliases[n] || n;
    if (!manifest.images[n]) throw Error('No painted mapping: '+sprite.id+' -> '+n);
    const entry = manifest.images[n];
    manifest.sprites[sprite.id] = { image:n,rect:[0,0,entry.width,entry.height],logicalWidth:sprite.width,logicalHeight:sprite.height,anchor:sprite.anchor,frame:/\.1$/.test(sprite.id)?1:0 };
  }
  manifest.images.dragonHead = { ...manifest.images.dragon, role:'Dragon phase head' };
  await image('bossPlasma','projectiles/boss-plasma-v2.png','Large hostile shot; bright core, cosmetic velocity trail');
  await image('fireball','projectiles/fireball-v2.png','Small hostile fire and prominence / fortress fireballs');
  fs.writeFileSync(path.join(ART,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  fs.writeFileSync(path.join(ART,'manifest.js'),'/* Generated from manifest.json by build-art.cjs; file:// safe. */\nwindow.NS.ART_MANIFEST = '+JSON.stringify(manifest,null,2)+';\n');
  console.log(JSON.stringify({images:Object.keys(manifest.images).length,spriteMappings:Object.keys(manifest.sprites).length,stages:manifest.stages.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
